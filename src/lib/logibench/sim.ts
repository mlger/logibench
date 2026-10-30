import type {
  ChipDef, Drive, Family, Logic, Net, PartInstance, Project, SimIssue, SimResult,
  SegmentState, LedState, NetLevel,
} from './types';
import { getChipDef, FAMILIES } from '@/data/chips';
import { buildNetlist, type NetlistResult } from './netlist';
import { holeKey } from './geometry';
import { runErc, type ErcContext } from './erc';

/**
 * 4-state event-driven-ish logic simulator (plan §5.3).
 * Fixed-point iteration with a cap (small nets converge in a few passes),
 * edge-detected sequential models, quasi-electrical LED/segment evaluation.
 * Pure TypeScript, zero DOM.
 */

export interface SeqState {
  /** 7490: q0 + q123 (÷5 section 0..4) */
  q0: number;
  q123: number;
  /** 4511 latched BCD code */
  latch?: number;
}

const MAX_ITER = 60;

export interface ComputeOutput {
  result: SimResult;
  ctx: ErcContext;
  netlist: NetlistResult;
  netLevels: Map<number, NetLevel>;
}

interface NetDrive {
  partId: string;
  value: Logic;
  strength: 'strong' | 'weak';
  family: Family;
  kind: 'out' | 'rail' | 'pull';
}

export class Simulator {
  private project: Project;
  private switchStates: Map<string, boolean> = new Map();
  seq: Map<string, SeqState> = new Map();
  private prevPinLevel: Map<string, Logic[]> = new Map();
  private clock555: Map<string, { phase: number; out: 0 | 1 }> = new Map();

  constructor(project: Project) {
    this.project = project;
    for (const p of project.parts) {
      if (p.type === 'clock555') this.clock555.set(p.id, { phase: 0, out: 1 });
      if (p.type === 'chip' && p.defId === '7490') this.seq.set(p.id, { q0: 0, q123: 0 });
      if (p.type === 'chip' && p.defId === '4511') this.seq.set(p.id, { q0: 0, q123: 0, latch: 0 });
    }
  }

  updateProject(project: Project) {
    // preserve seq/clock state for parts that still exist
    const ids = new Set(project.parts.map((p) => p.id));
    for (const id of [...this.seq.keys()]) if (!ids.has(id)) this.seq.delete(id);
    for (const id of [...this.clock555.keys()]) if (!ids.has(id)) this.clock555.delete(id);
    for (const p of project.parts) {
      if ((p.type === 'chip' && (p.defId === '7490' || p.defId === '4511')) && !this.seq.has(p.id)) {
        this.seq.set(p.id, { q0: 0, q123: 0, latch: 0 });
      }
      if (p.type === 'clock555' && !this.clock555.has(p.id)) {
        this.clock555.set(p.id, { phase: 0, out: 1 });
      }
    }
    this.project = project;
  }

  setSwitch(id: string, closed: boolean) {
    this.switchStates.set(id, closed);
  }

  getSwitch(id: string): boolean {
    return this.switchStates.get(id) ?? false;
  }

  resetCounters() {
    for (const s of this.seq.values()) { s.q0 = 0; s.q123 = 0; if (s.latch !== undefined) s.latch = 0; }
  }

  /** Advance time by dtMs (555 modules oscillate), then recompute everything. */
  step(dtMs: number): ComputeOutput {
    for (const [id, st] of this.clock555) {
      const part = this.project.parts.find((p) => p.id === id);
      if (!part) continue;
      const f = part.props.freqHz ?? 1;
      const half = 500 / Math.max(f, 0.001); // ms per half period
      st.phase += dtMs;
      while (st.phase >= half) {
        st.phase -= half;
        st.out = st.out === 1 ? 0 : 1;
      }
    }
    return this.compute();
  }

  /** Full fixed-point evaluation + edge-triggered sequential update. */
  compute(): ComputeOutput {
    const before = this.prevPinLevel;
    const out = this.evaluate();
    // sequential edge pass: compare current pin levels against the snapshot
    // taken BEFORE this evaluation (evaluate() must not have clobbered it)
    const seqChanged = this.sequentialPass(out, before);
    if (seqChanged) {
      const out2 = this.evaluate();
      this.prevPinLevel = this.snapshotPinLevels(out2);
      return out2;
    }
    this.prevPinLevel = this.snapshotPinLevels(out);
    return out;
  }

  private snapshotPinLevels(out: ComputeOutput): Map<string, Logic[]> {
    const snap = new Map<string, Logic[]>();
    for (const part of this.project.parts) {
      if (part.type !== 'chip') continue;
      const arr: Logic[] = [];
      for (let pin = 1; pin <= part.pins.length; pin++) {
        const net = out.netlist.pinNet(part.id, pin);
        arr.push(net !== undefined ? (out.netLevels.get(net) ?? 'Z') as Logic : 'Z');
      }
      snap.set(part.id, arr);
    }
    return snap;
  }

  private evaluate(): ComputeOutput {
    const project = this.project;
    const seqMap = this.seq;
    const netlist = buildNetlist(project, { switchStates: this.switchStates });
    const { nets, pinNet } = netlist;

    // --- supplies (multi-supply: EVERY supply drives its own two nets) ---
    const supplies = project.parts.filter((p) => p.type === 'supply' && p.pins.length >= 2);
    const suppliedHigh = new Set<number>();
    const suppliedLow = new Set<number>();
    const supplyNets: { partId: string; high: number | undefined; low: number | undefined; volts: number }[] = [];
    for (const s of supplies) {
      const high = netlist.holeNet.get(holeKey(s.pins[0]));
      const low = netlist.holeNet.get(holeKey(s.pins[1]));
      supplyNets.push({ partId: s.id, high, low, volts: s.props.volts ?? 5 });
      if (high !== undefined) suppliedHigh.add(high);
      if (low !== undefined) suppliedLow.add(low);
    }
    // first supply's nets kept for ERC diagnostics (7490 gotcha hint)
    const vccNet = supplyNets[0]?.high;
    const gndNet = supplyNets[0]?.low;

    // --- chip powered map ---
    const powered = new Map<string, boolean>();
    for (const part of project.parts) {
      if (part.type !== 'chip' || !part.defId) continue;
      const def = getChipDef(part.defId);
      if (!def || def.refOnly) { powered.set(part.id, false); continue; }
      const pv = pinNet(part.id, def.power.vcc);
      const pg = pinNet(part.id, def.power.gnd);
      powered.set(part.id, pv !== undefined && pg !== undefined && suppliedHigh.has(pv) && suppliedLow.has(pg));
    }

    const levels = new Map<number, NetLevel>();
    const drivers = new Map<number, NetDrive[]>();
    const addDrive = (net: number, d: NetDrive) => {
      if (!drivers.has(net)) drivers.set(net, []);
      drivers.get(net)!.push(d);
    };

    const readInput = (part: PartInstance, def: ChipDef, pin: number, iter: number): Logic => {
      const net = pinNet(part.id, pin);
      if (net === undefined) return 'X';
      let lv = levels.get(net) ?? 'Z';
      if (lv === 'Z' && iter > 0) {
        // floating input policy per family
        const fam = (part.family ?? def.families[0] ?? 'generic') as Family;
        lv = FAMILIES[fam]?.floatReads ?? 'X';
      }
      return lv as Logic;
    };

    const evalGate = (fn: string, ins: Logic[]): Logic => {
      if (ins.some((v) => v === 'X' || v === 'Z')) return 'X';
      switch (fn) {
        case 'NAND': return ins.every((v) => v === 1) ? 0 : 1;
        case 'NOR': return ins.some((v) => v === 1) ? 0 : 1;
        case 'AND': return ins.every((v) => v === 1) ? 1 : 0;
        case 'OR': return ins.some((v) => v === 1) ? 1 : 0;
        case 'XOR': return ins.filter((v) => v === 1).length % 2 === 1 ? 1 : 0;
        case 'NOT': return ins[0] === 1 ? 0 : 1;
        default: return 'X';
      }
    };

    // --- fixed point ---
    for (let iter = 0; iter < MAX_ITER; iter++) {
      drivers.clear();
      // supply drives — each supply powers the nets its terminals actually touch
      for (const sn of supplyNets) {
        if (sn.high !== undefined) addDrive(sn.high, { partId: sn.partId, value: 1, strength: 'strong', family: 'generic', kind: 'rail' });
        if (sn.low !== undefined) addDrive(sn.low, { partId: sn.partId, value: 0, strength: 'strong', family: 'generic', kind: 'rail' });
      }
      let changed = false;

      for (const part of project.parts) {
        if (part.type === 'chip' && part.defId) {
          const def = getChipDef(part.defId);
          if (!def || def.refOnly || def.model === 'none') continue;
          const on = powered.get(part.id) ?? false;
          const family = (part.family ?? def.families[0]) as Family;

          if (def.model === 'gates' && def.units) {
            if (part.defId === '74138') { eval74138(def, part, family, on, iter); continue; }
            for (const u of def.units) {
              const ins = u.inputs.map((pin) => (on ? readInput(part, def, pin, iter) : 'X'));
              const outLv: Logic = on ? evalGate(u.fn, ins) : 'X';
              const prev = levels.get(pinNet(part.id, u.output) ?? -1);
              const pinDef = def.pins[u.output - 1];
              const value: Logic = outLv === 0 && pinDef?.activeLow ? 0 : outLv;
              addDrive(pinNet(part.id, u.output)!, {
                partId: part.id, value, strength: 'strong', family, kind: 'out',
              });
              if (prev !== undefined && prev !== value) changed = true;
            }
          } else if (def.model === 'decoder') {
            evalDecoder(def, part, family, on, iter);
          } else if (def.model === 'counter') {
            evalCounter(def, part, family, on, iter);
          }
        } else if (part.type === 'clock555') {
          const net = pinNet(part.id, 3);
          const st = this.clock555.get(part.id)!;
          const p1 = pinNet(part.id, 1);
          const p2 = pinNet(part.id, 2);
          const value: Logic = net !== undefined && p1 !== undefined && p2 !== undefined
            && suppliedHigh.has(p1) && suppliedLow.has(p2) ? st.out : 'X';
          if (net !== undefined) addDrive(net, { partId: part.id, value, strength: 'strong', family: 'NE555', kind: 'out' });
        }
      }

      // resistor pull paths: net --R--> driven net gets weak drive
      for (const net of nets) {
        for (const r of net.resistors) {
          const other = levels.get(r.net);
          if (other === 1) addDrive(net.id, { partId: 'R', value: 1, strength: 'weak', family: 'generic', kind: 'pull' });
          else if (other === 0) addDrive(net.id, { partId: 'R', value: 0, strength: 'weak', family: 'generic', kind: 'pull' });
        }
      }

      // resolve
      for (const net of nets) {
        const ds = drivers.get(net.id) ?? [];
        const strong = ds.filter((d) => d.strength === 'strong');
        const weak = ds.filter((d) => d.strength === 'weak');
        let lv: NetLevel;
        const vals = new Set(strong.map((d) => d.value));
        if (strong.length === 0) {
          const wv = new Set(weak.map((d) => d.value));
          lv = wv.size === 1 ? (wv.values().next().value as NetLevel) : wv.size > 1 ? 'X' : 'Z';
        } else if (vals.size === 1) {
          lv = vals.values().next().value as NetLevel;
        } else {
          lv = 'conflict';
        }
        if (levels.get(net.id) !== lv) { levels.set(net.id, lv); changed = true; }
      }

      if (!changed && iter > 0) break;
    }

    // --- LED & segment quasi-electrical evaluation ---
    const { ledStates, segStates, segCurrents } = evalDiodes(nets, levels, vccNet, gndNet);

    const holeLevels = new Map<string, NetLevel>();
    for (const [k, netId] of netlist.holeNet.entries()) {
      holeLevels.set(k, levels.get(netId) ?? 'Z');
    }

    const counterValues = new Map<string, number>();
    for (const [id, s] of this.seq) {
      counterValues.set(id, s.q0 + s.q123 * 2);
    }

    const ctx: ErcContext = {
      project, netlist, nets, levels, drivers, powered, vccNet, gndNet,
      suppliedHigh, suppliedLow, supplyNets,
      ledStates, segStates, segCurrents, counterValues,
    };
    const issues: SimIssue[] = runErc(ctx);

    const result: SimResult = {
      netLevels: levels,
      holeLevels,
      ledStates,
      segStates,
      poweredChips: new Set([...powered.entries()].filter(([, v]) => v).map(([k]) => k)),
      issues,
      counterValues,
    };
    return { result, ctx, netlist, netLevels: levels };

    /* ---- nested evaluation helpers ---- */

    function eval74138(def: ChipDef, part: PartInstance, family: Family, on: boolean, iter: number) {
      const A = on ? readInput(part, def, 1, iter) : 'X';
      const B = on ? readInput(part, def, 2, iter) : 'X';
      const C = on ? readInput(part, def, 3, iter) : 'X';
      const G1 = on ? readInput(part, def, 6, iter) : 'X';
      const G2A = on ? readInput(part, def, 4, iter) : 'X';
      const G2B = on ? readInput(part, def, 5, iter) : 'X';
      const enabled = G1 === 1 && G2A === 0 && G2B === 0;
      const addr = [C, B, A].every((v) => v === 0 || v === 1) ? (C as number) * 4 + (B as number) * 2 + (A as number) : -1;
      const outPins = [15, 14, 13, 12, 11, 10, 9, 7]; // Y0..Y7
      outPins.forEach((pin, idx) => {
        const val: Logic = !on || !enabled || addr !== idx ? 1 : 0;
        const net = pinNet(part.id, pin);
        if (net !== undefined) addDrive(net, { partId: part.id, value: val, strength: 'strong', family, kind: 'out' });
      });
    }

    function evalDecoder(def: ChipDef, part: PartInstance, family: Family, on: boolean, iter: number) {
      const a = on ? readInput(part, def, 7, iter) : 'X'; // A
      const b = on ? readInput(part, def, 1, iter) : 'X'; // B
      const c = on ? readInput(part, def, 2, iter) : 'X'; // C
      const d = on ? readInput(part, def, 6, iter) : 'X'; // D
      const lt = on ? readInput(part, def, 3, iter) : 'X';
      const bi = def.id === '4511' ? on ? readInput(part, def, 4, iter) : 'X' : on ? readInput(part, def, 4, iter) : 'X';
      const le = def.id === '4511' ? on ? readInput(part, def, 5, iter) : 'X' : 0;
      const rbi = def.id === '4511' ? 1 : on ? readInput(part, def, 5, iter) : 'X';

      const dataValid = [a, b, c, d].every((v) => v === 0 || v === 1);
      const code = dataValid ? (d as number) * 8 + (c as number) * 4 + (b as number) * 2 + (a as number) : -1;

      let lit: string = '0000000';
      if (def.id === '4511') {
        const st = seqMap.get(part.id) ?? { q0: 0, q123: 0, latch: 0 };
        const effCode = le === 1 ? st.latch ?? 0 : code;
        if (le === 0 && code >= 0) st.latch = code;
        if (lt === 0) lit = '1111111';
        else if (bi === 0) lit = '0000000';
        else if (effCode < 0 || effCode > 9) lit = '0000000';
        else lit = def.glyphs![effCode];
      } else {
        // 7447 / 7448
        if (lt === 0) lit = '1111111';
        else if (bi === 0) lit = '0000000';
        else if (code === 0 && rbi === 0) lit = '0000000';
        else if (code < 0) lit = '0000000';
        else lit = def.glyphs![code];
      }

      const segPins: Record<string, number> = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };
      for (const [seg, pin] of Object.entries(segPins)) {
        const isLit = lit[seg.charCodeAt(0) - 97] === '1';
        const net = pinNet(part.id, pin);
        if (net === undefined) continue;
        if (def.id === '7447') {
          // OC active-low: lit → drive 0 (sink); unlit → Z
          addDrive(net, { partId: part.id, value: isLit ? 0 : 'Z', strength: 'strong', family, kind: 'out' });
        } else if (def.id === '7448') {
          // active-high weak pull-up: lit → weak 1; unlit → strong 0 (can sink)
          addDrive(net, { partId: part.id, value: isLit ? 1 : 0, strength: isLit ? 'weak' : 'strong', family, kind: 'out' });
        } else {
          // 4511 active-high push-pull
          addDrive(net, { partId: part.id, value: isLit ? 1 : 0, strength: 'strong', family, kind: 'out' });
        }
      }
    }

    function evalCounter(def: ChipDef, part: PartInstance, family: Family, on: boolean, iter: number) {
      const st = seqMap.get(part.id) ?? { q0: 0, q123: 0 };
      const mr1 = on ? readInput(part, def, 2, iter) : 'X';
      const mr2 = on ? readInput(part, def, 3, iter) : 'X';
      const ms1 = on ? readInput(part, def, 6, iter) : 'X';
      const ms2 = on ? readInput(part, def, 7, iter) : 'X';
      if (on && ms1 === 1 && ms2 === 1) { st.q0 = 1; st.q123 = 4; } // set to 9 (1001)
      else if (on && mr1 === 1 && mr2 === 1) { st.q0 = 0; st.q123 = 0; } // reset
      const qOuts: [number, number][] = [[12, st.q0], [9, (st.q123 >> 0) & 1], [8, (st.q123 >> 1) & 1], [11, (st.q123 >> 2) & 1]];
      for (const [pin, val] of qOuts) {
        const net = pinNet(part.id, pin);
        if (net !== undefined) addDrive(net, { partId: part.id, value: on ? (val as Logic) : 'X', strength: 'strong', family, kind: 'out' });
      }
    }

    function evalDiodes(
      nets: Net[], levels: Map<number, NetLevel>,
      vccNet: number | undefined, gndNet: number | undefined,
    ) {
      const ledStates = new Map<string, LedState>();
      const segStates = new Map<string, Record<string, SegmentState>>();
      const segCurrents = new Map<string, number>(); // decoder partId -> mA total

      const netLevel = (id: number | undefined): NetLevel => (id === undefined ? 'Z' : levels.get(id) ?? 'Z');

      /** find a STRONG source (rail or push-pull high) walking through ≤2 resistors.
       * Weak resistor-pulls are crossed, not endpoints; weak 7448-style outputs are dim endpoints. */
      const findSource = (netId: number | undefined, depth = 2): { v: number; r: number } | null => {
        if (netId === undefined) return null;
        const ds = drivers.get(netId) ?? [];
        const strongHigh = ds.find((d) => d.value === 1 && d.strength === 'strong');
        if (strongHigh) {
          const fam = strongHigh.family;
          const v = fam === 'LS' ? 3.2 : fam === 'HC' || fam === 'HCT' || fam === 'CD4000' ? 4.4 : 5.0;
          return { v, r: 0 };
        }
        const weakOut = ds.find((d) => d.value === 1 && d.strength === 'weak' && d.kind === 'out');
        if (weakOut) return { v: 2.5, r: 0 }; // 7448 internal pull-up: "works, but dim"
        if (depth > 0) {
          const net = nets[netId];
          for (const r of net.resistors) {
            const inner = findSource(r.net, depth - 1);
            if (inner) return { v: inner.v, r: inner.r + r.ohms };
          }
        }
        return null;
      };

      const findSink = (netId: number | undefined, depth = 2): { vol: number; r: number } | null => {
        if (netId === undefined) return null;
        const ds = drivers.get(netId) ?? [];
        const strongLow = ds.find((d) => d.value === 0 && d.strength === 'strong');
        if (strongLow) {
          const vol = strongLow.family === 'LS' ? 0.4 : 0.33;
          return { vol, r: 0 };
        }
        if (depth > 0) {
          const net = nets[netId];
          for (const r of net.resistors) {
            const inner = findSink(r.net, depth - 1);
            if (inner) return { vol: inner.vol, r: inner.r + r.ohms };
          }
        }
        return null;
      };

      const diodeCurrent = (anodeNet: number | undefined, cathodeNet: number | undefined, vf: number) => {
        const src = findSource(anodeNet);
        const snk = findSink(cathodeNet);
        if (!src || !snk) return { i: 0, noResistor: false, ok: false };
        const rTotal = src.r + snk.r;
        const i = (src.v - vf - snk.vol) / rTotal * 1000; // mA
        return { i: Math.max(0, i), noResistor: rTotal === 0, ok: true };
      };

      for (const part of project.parts) {
        if (part.type === 'led' && part.pins.length >= 2) {
          const aNet = netlist.holeNet.get(holeKey(part.pins[0]));
          const kNet = netlist.holeNet.get(holeKey(part.pins[1]));
          const { i, noResistor, ok } = diodeCurrent(aNet, kNet, 2.0);
          // direction matters: pin 1 = anode, pin 2 = cathode. If the LED is
          // dark but would light flipped around, flag it for the ERC.
          const rev = diodeCurrent(kNet, aNet, 2.0);
          const reversed = i <= 0.5 && rev.ok && rev.i > 0.5;
          const brightness = ok ? Math.min(1, i / 15) : 0;
          ledStates.set(part.id, {
            brightness, currentMA: i, noResistor: noResistor && i > 0,
            overcurrent: i > 30,
            ...(reversed ? { reversed: true } : {}),
          });
        } else if (part.type === 'seg7' && part.pins.length >= 10) {
          const states: Record<string, SegmentState> = {};
          const segNetOf = (name: string) => {
            const pin = ['e', 'd', 'c', 'b', 'a', 'f', 'g'].indexOf(name);
            const pinMap: Record<string, number> = { e: 1, d: 2, c: 4, b: 6, a: 7, f: 9, g: 10, dp: 5 };
            const p = pinMap[name];
            return netlist.holeNet.get(holeKey(part.pins[p - 1]));
          };
          const comNets = [3, 8].map((p) => netlist.holeNet.get(holeKey(part.pins[p - 1])));
          const comNet = comNets.find((n) => n !== undefined);
          const ca = part.props.polarity === 'CA';
          let decoderTotal = 0;
          for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const) {
            const sNet = segNetOf(seg);
            // CA: current flows common(anode, high) → segment net (low, sink)
            // CC: current flows segment net (high) → common (cathode, low)
            const { i, noResistor, ok } = ca
              ? diodeCurrent(comNet, sNet, 2.0)
              : diodeCurrent(sNet, comNet, 2.0);
            const lit = ok && i > 0.5;
            states[seg] = {
              lit, brightness: Math.min(1, i / 12),
              noResistor: noResistor && lit, overcurrent: i > 30,
            };
            if (lit) decoderTotal += i;
          }
          segStates.set(part.id, states);
          // attribute package current to decoders driving this display
          if (decoderTotal > 0) {
            for (const p2 of project.parts) {
              if (p2.type === 'chip' && (p2.defId === '4511' || p2.defId === '7447' || p2.defId === '7448')) {
                const def2 = getChipDef(p2.defId)!;
                const segPinNums = def2.id === '4511' ? [13, 12, 11, 10, 9, 15, 14] : [13, 12, 11, 10, 9, 15, 14];
                const driverNets = new Set(segPinNums.map((pin) => netlist.pinNet(p2.id, pin)).filter((x) => x !== undefined));
                const segNets = (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map(segNetOf).filter((x) => x !== undefined);
                if (segNets.some((sn) => driverNets.has(sn))) {
                  segCurrents.set(p2.id, (segCurrents.get(p2.id) ?? 0) + decoderTotal);
                }
              }
            }
          }
        }
      }
      return { ledStates, segStates, segCurrents };
    }
  }

  /** Edge detection for counters; returns true if sequential state changed. */
  private sequentialPass(out: ComputeOutput, before: Map<string, Logic[]>): boolean {
    let changed = false;
    const { netlist, netLevels } = out;
    for (const part of this.project.parts) {
      if (part.type !== 'chip' || part.defId !== '7490') continue;
      const on = out.result.poweredChips.has(part.id);
      if (!on) continue;
      const st = this.seq.get(part.id)!;
      const prev = before.get(part.id) ?? [];
      const cp0 = netlist.pinNet(part.id, 14);
      const cp1 = netlist.pinNet(part.id, 1);
      const lv = (net: number | undefined): Logic => (net === undefined ? 'Z' : (netLevels.get(net) ?? 'Z') as Logic);
      const cp0Now = lv(cp0);
      const cp1Now = lv(cp1);
      const cp0Prev = prev[13] ?? 'Z'; // pin 14 → index 13
      const cp1Prev = prev[0]; // pin 1 → index 0
      // falling edges
      if (cp0Prev === 1 && cp0Now === 0) {
        st.q0 = st.q0 === 1 ? 0 : 1;
        changed = true;
      }
      if (cp1Prev === 1 && cp1Now === 0) {
        st.q123 = (st.q123 + 1) % 5;
        changed = true;
      }
    }
    return changed;
  }
}
