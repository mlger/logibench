import type { HoleRef, Net, NetLevel, PartInstance, Project, SimIssue } from './types';
import { getChipDef, FAMILIES } from '@/data/chips';
import { holeKey, parseHoleKey, isRailRow, holeExists } from './geometry';
import type { NetlistResult } from './netlist';

/**
 * Electrical Rule Check (plan §3.2): pure function
 * (netlist, sim state, chip defs) → Issue[] with datasheet-cited "why"s.
 */

export interface ErcContext {
  project: Project;
  netlist: NetlistResult;
  nets: Net[];
  levels: Map<number, NetLevel>;
  drivers: Map<number, { partId: string; value: unknown; strength: string; family: string; kind: string }[]>;
  powered: Map<string, boolean>;
  vccNet?: number;
  gndNet?: number;
  /** nets contacted by any supply's + / − terminal (multi-supply) */
  suppliedHigh: Set<number>;
  suppliedLow: Set<number>;
  supplyNets: { partId: string; high?: number; low?: number; volts: number }[];
  ledStates: Map<string, { brightness: number; currentMA?: number; noResistor?: boolean; overcurrent?: boolean; reversed?: boolean }>;
  segStates: Map<string, Record<string, { lit: boolean; brightness: number; noResistor?: boolean; overcurrent?: boolean }>>;
  segCurrents: Map<string, number>;
  counterValues: Map<string, number>;
}

type ProjectT = ErcContext['project'];

let issueSeq = 0;
const nid = () => `erc-${++issueSeq}`;

export function runErc(ctx: ErcContext): SimIssue[] {
  const issues: SimIssue[] = [];
  const { project, nets, levels, netlist, powered, vccNet, gndNet } = ctx;
  const partsById = new Map(project.parts.map((p) => [p.id, p]));
  const label = (p: PartInstance | undefined) => {
    if (!p) return '?';
    if (p.type === 'chip' && p.defId) return `U (${p.defId})`;
    return p.id.slice(0, 6);
  };

  /* --- rule: power supply present + wired --- */
  const supplies = ctx.supplyNets;
  if (supplies.length === 0) {
    issues.push({
      id: nid(), rule: 'no-supply', severity: 'error',
      title: 'No power supply in the project',
      detail: 'Place the 5 V supply part and wire its + and − terminals (red/black is the convention).',
      why: 'Every IC needs VCC and GND; the simulator powers chips only through them.',
      refs: [],
    });
  } else {
    for (const s of supplies) {
      if (s.high !== undefined && s.high === s.low) {
        issues.push({
          id: nid(), rule: 'supply-unwired', severity: 'error',
          title: 'A supply\'s + and − terminals land on the same net',
          detail: 'The supply\'s + and − contacts are electrically joined — move them onto separate nets (typically the + and − rails).',
          why: 'A supply shorted across itself delivers no power and on a real bench trips the supply or melts wires.',
          refs: [{ partId: s.partId }],
        });
        break;
      }
    }
    /* --- rule: two supplies fighting on one net --- */
    outer: for (let i = 0; i < supplies.length; i++) {
      for (let j = i + 1; j < supplies.length; j++) {
        const a = supplies[i];
        const b = supplies[j];
        const crossed = (a.high !== undefined && a.high === b.low) || (a.low !== undefined && a.low === b.high);
        const parallelUnequal = (a.high !== undefined && a.high === b.high || a.low !== undefined && a.low === b.low) && a.volts !== b.volts;
        if (crossed || parallelUnequal) {
          issues.push({
            id: nid(), rule: 'supply-conflict', severity: 'error',
            title: `Two supplies fight on one net (${a.volts} V vs ${b.volts} V)`,
            detail: crossed
              ? 'The + terminal of one supply is wired to the − terminal of the other — a dead short across both supplies.'
              : 'Two supplies with different voltages are paralleled on one net. Only supplies at the SAME voltage may share a net.',
            why: 'On the bench, paralleling unequal supplies forces large currents between the regulators — they overheat or shut down.',
            refs: [{ partId: a.partId }, { partId: b.partId }],
          });
          break outer;
        }
      }
    }
  }

  /* --- rule: chip power pins (7490 special case) --- */
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly) continue;
    if (part.props.reversed) {
      issues.push({
        id: nid(), rule: 'chip-reversed', severity: 'error',
        title: `${label(part)} is inserted BACKWARDS — pin 1 is at the wrong end`,
        detail: `A DIP seated 180° puts pin 1 where pin ${def.pins.length} belongs, so power (pins ${def.power.vcc} / ${def.power.gnd}), inputs and outputs all land on the wrong strips. Pull the chip, turn it 180° so the notch marks pin ${def.pins.length} at the opposite end from pin 1, and reseat.`,
        why: 'On the bench a backwards chip gets VCC and GND reversed — it heats within seconds and dies. The simulator mirrors the bench: the pin map is flipped, the chip reads unpowered, and nothing downstream behaves.',
        refs: [{ partId: part.id, pin: 1 }, { partId: part.id, pin: def.pins.length }],
      });
      continue;
    }
    if (powered.get(part.id)) continue;
    const pv = netlist.pinNet(part.id, def.power.vcc);
    const pg = netlist.pinNet(part.id, def.power.gnd);
    const special = part.defId === '7490';
    let detail = `${label(part)}: VCC pin ${def.power.vcc} / GND pin ${def.power.gnd} must reach the supply.`;
    let why = 'An unpowered chip outputs nothing usable — all outputs read X in the simulator, mirroring a dead chip on the bench.';
    if (special) {
      const wrongVcc = pv === vccNet || pg === vccNet;
      detail = '7490 POWER GOTCHA: this chip is powered on pin 5 (VCC) and pin 10 (GND) — NOT pins 14/7 like most 74-series. onsemi SN74LS90/D Rev. 6: "VCC = PIN 5 / GND = PIN 10".';
      why = wrongVcc
        ? 'You wired a 14-pin-style power pair. The 7490 breaks the convention — move the wires to pins 5 and 10.'
        : why;
    }
    issues.push({
      id: nid(), rule: 'unpowered-chip', severity: 'error',
      title: `${label(part)} is not powered`,
      detail, why,
      refs: [{ partId: part.id, pin: def.power.vcc }, { partId: part.id, pin: def.power.gnd }],
    });
  }

  /* --- rule: floating inputs (family-dependent severity) --- */
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly || !powered.get(part.id)) continue;
    if (part.props.reversed) continue; // root cause already reported by chip-reversed
    const family = part.family ?? def.families[0];
    const fam = FAMILIES[family];
    if (!fam) continue;
    for (const pin of def.pins) {
      if (pin.dir !== 'in' && !(pin.dir === 'io' && pin.role === 'bi')) continue;
      // 7447/7448 BI/RBO and RBI may legitimately be left open
      const openOk = (part.defId === '7447' || part.defId === '7448') && (pin.role === 'bi' || pin.role === 'rbi');
      const net = netlist.pinNet(part.id, pin.num);
      if (net === undefined) continue;
      const lv = levels.get(net) ?? 'Z';
      if (lv !== 'Z' && lv !== 'conflict') continue;
      if (openOk && lv === 'Z') continue; // "must be open or HIGH" per TI
      const isCMOS = family === 'HC' || family === 'HCT' || family === 'CD4000';
      const is7490Reset = part.defId === '7490' && (pin.role === 'reset' || pin.role === 'set9');
      issues.push({
        id: nid(), rule: is7490Reset ? 'counter-reset-floating' : 'floating-input',
        severity: is7490Reset ? 'error' : isCMOS ? 'error' : 'warning',
        title: is7490Reset
          ? `${label(part)} reset/set pin ${pin.num} (${pin.name}) is floating`
          : `Floating input: ${label(part)} pin ${pin.num} (${pin.name})`,
        detail: is7490Reset
          ? 'The 7490 MR/MS pins are NOT internally grounded. Both MR pins floating HIGH (TTL) holds the counter in reset; both MS pins HIGH force it to 9.'
          : isCMOS
            ? 'Tie unused CMOS inputs to VCC or GND.'
            : 'TTL inputs float HIGH — but do not rely on it; tie it.',
        why: isCMOS
          ? 'TI SCBA004E: an input parked in the threshold region turns both output transistors on — excess current, oscillation, reduced reliability.'
          : 'LS inputs source 0.4 mA when LOW (IIL) and float HIGH; unused inputs should still be tied for noise immunity.',
        refs: [{ partId: part.id, pin: pin.num }],
      });
    }
  }

  /* --- rule: contention — two opposing strong drivers on one net --- */
  for (const net of nets) {
    const ds = (ctx.drivers.get(net.id) ?? []).filter((d) => d.kind === 'out' || d.kind === 'rail');
    const highs = ds.filter((d) => d.value === 1);
    const lows = ds.filter((d) => d.value === 0);
    if (highs.length && lows.length) {
      issues.push({
        id: nid(), rule: 'contention', severity: 'error',
        title: `Output contention on a net (${net.holes.length} holes)`,
        detail: `${highs.map((d) => partsById.get(d.partId)?.defId ?? partsById.get(d.partId)?.type).join(', ')} drives HIGH while ${lows.map((d) => partsById.get(d.partId)?.defId ?? partsById.get(d.partId)?.type).join(', ')} drives LOW.`,
        why: 'Two push-pull outputs fighting = a short from VCC to GND through the chips. On the bench this heats the ICs and can destroy them.',
        refs: ds.map((d) => ({ partId: d.partId })),
      });
      break;
    }
  }

  /* --- rule: latent contention — multiple push-pull outputs on one net.
     The check above only fires while they actually disagree; two tied
     outputs that happen to agree right now pass clean and fight on the
     first clock edge. Counts DRIVERS, not parts: two outputs of the same
     chip tied together contend just as hard. Wired-AND needs
     open-collector parts. --- */
  for (const net of nets) {
    const outs = (ctx.drivers.get(net.id) ?? []).filter(
      (d) => d.kind === 'out' && d.strength === 'strong' && (d.value === 0 || d.value === 1),
    );
    if (outs.length >= 2) {
      const driverIds = [...new Set(outs.map((d) => d.partId))];
      issues.push({
        id: nid(), rule: 'wired-outputs', severity: 'error',
        title: `${outs.length} push-pull outputs share one net`,
        detail: `${driverIds.map((id) => partsById.get(id)?.defId ?? partsById.get(id)?.type).join(' + ')} drive this net from ${outs.length} output pins. They agree at the moment — the instant their levels differ they short each other.`,
        why: 'Parallel push-pull outputs are only legal if exactly one drives at a time (tri-state) or the outputs are open-collector (7447-style). Combine signals with a gate instead.',
        refs: driverIds.map((id) => ({ partId: id })),
      });
      break;
    }
  }

  /* --- rule: output tied directly to a rail of the opposite level --- */
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly) continue;
    if (part.props.reversed) continue; // root cause already reported by chip-reversed
    for (const pin of def.pins) {
      if (pin.dir !== 'out') continue;
      const net = netlist.pinNet(part.id, pin.num);
      if (net === undefined) continue;
      const netObj = nets[net];
      if (netObj.isVccRail || netObj.isGndRail) {
        issues.push({
          id: nid(), rule: 'output-to-rail', severity: 'error',
          title: `${label(part)} output pin ${pin.num} (${pin.name}) is tied straight to a power rail`,
          detail: 'Outputs must never be wired directly to VCC or GND.',
          why: 'If the gate drives the opposite level, that is a solid VCC↔GND short through the output transistor.',
          refs: [{ partId: part.id, pin: pin.num }],
        });
      }
    }
  }

  /* --- rule: LED / segment resistors --- */
  for (const [partId, st] of ctx.ledStates) {
    if (st.reversed) {
      issues.push({
        id: nid(), rule: 'led-reversed', severity: 'warning',
        title: 'LED is in backwards',
        detail: 'Pin 1 is the anode (+, long leg), pin 2 the cathode (−, flat side). This LED is dark because current cannot flow — flip it around (or swap its two holes).',
        why: 'An LED conducts only from anode to cathode; reversed it blocks (and beyond ~5 V reverse breakdown kills it).',
        refs: [{ partId }],
      });
      continue;
    }
    if (st.noResistor && st.brightness > 0) {
      issues.push({
        id: nid(), rule: 'led-no-resistor', severity: 'error',
        title: 'LED without a current-limiting resistor',
        detail: 'Put a resistor (220–470 Ω for 5 V) in series with the LED.',
        why: 'Without a resistor the LED current is limited only by the driver; a standard LED and a 74LS output both exceed safe current instantly.',
        refs: [{ partId }],
      });
    } else if (st.overcurrent) {
      issues.push({
        id: nid(), rule: 'led-overcurrent', severity: 'warning',
        title: `LED overcurrent (~${st.currentMA?.toFixed(0)} mA)`,
        detail: 'Use a larger series resistor. Target 5–15 mA for a standard LED.',
        refs: [{ partId }],
      });
    }
  }
  for (const [partId, segs] of ctx.segStates) {
    for (const [seg, st] of Object.entries(segs)) {
      if (st.noResistor && st.lit) {
        issues.push({
          id: nid(), rule: 'segment-no-resistor', severity: 'error',
          title: `Segment ${seg.toUpperCase()} has no series resistor`,
          detail: 'Use ONE resistor per segment (270–330 Ω from a 7447; 220–330 Ω from a 4511). Never a single resistor on the common pin — brightness would vary with the number of lit segments.',
          why: '7447 sinks up to 24 mA/segment (onsemi); 4511 is rated 10 mA/output with a 50 mA package ICC limit (Nexperia Rev. 4).',
          refs: [{ partId }],
        });
        break;
      }
    }
  }

  /* --- rule: pull resistor outside the TTL input budget ---
     LS inputs sink 0.4 mA when LOW (IIL): a pull-down must hold the pin below
     VIL 0.8 V, so R ≤ 2.2 kΩ. Pull-UPS on TTL are unconstrained in practice
     (IIH is only 20 µA), and CMOS leakage is µA — only the TTL pull-down is
     tight enough to get wrong. --- */
  {
    const fmtOhms = (v: number) => (v >= 1000 ? `${Number.isInteger(v / 1000) ? v / 1000 : (v / 1000).toFixed(1)} kΩ` : `${v} Ω`);
    for (const part of project.parts) {
      if (part.type !== 'chip' || !part.defId) continue;
      const def = getChipDef(part.defId);
      if (!def || def.refOnly || !powered.get(part.id)) continue;
      if (part.props.reversed) continue;
      const family = part.family ?? def.families[0];
      if (family !== 'LS') continue;
      for (const pin of def.pins) {
        if (pin.dir !== 'in') continue;
        const net = netlist.pinNet(part.id, pin.num);
        if (net === undefined) continue;
        for (const r of nets[net].resistors) {
          const other = nets[r.net];
          if (!other || other.isVccRail) continue;
          if (!other.isGndRail || r.ohms <= 2200) continue;
          issues.push({
            id: nid(), rule: 'weak-pull', severity: 'warning',
            title: `${fmtOhms(r.ohms)} pull-down on ${label(part)} pin ${pin.num} (${pin.name}) is too weak for LS`,
            detail: 'A 74LS input sinks 0.4 mA when LOW (IIL). The pull-down must keep the pin below VIL 0.8 V, so R ≤ 2.2 kΩ (0.4 mA × 2 kΩ = 0.8 V). Use 1 kΩ — the demos do.',
            why: 'A too-large pull-down lets the input sit in the indeterminate region between VIL and VIH: gates switch randomly with temperature and noise.',
            refs: [{ partId: part.id, pin: pin.num }],
          });
        }
      }
    }
  }

  /* --- rule: decoder/display polarity mismatch --- */
  const seg7s = project.parts.filter((p) => p.type === 'seg7');
  const decoders = project.parts.filter((p) => p.type === 'chip' && (p.defId === '7447' || p.defId === '7448' || p.defId === '4511'));
  const segPinMap: Record<string, number> = { a: 7, b: 6, c: 4, d: 2, e: 1, f: 9, g: 10 };
  const decSegPinMap: Record<string, number> = { a: 13, b: 12, c: 11, d: 10, e: 9, f: 15, g: 14 };
  for (const display of seg7s) {
    for (const dec of decoders) {
      const def = getChipDef(dec.defId);
      if (!def) continue;
      const decNets = Object.values(decSegPinMap).map((pin) => netlist.pinNet(dec.id, pin));
      const hits = Object.entries(segPinMap)
        .map(([seg, pin]) => ({ seg, net: netlist.pinNet(display.id, pin) }))
        .filter((x) => x.net !== undefined && decNets.includes(x.net));
      if (hits.length >= 3) {
        const wants: Record<string, 'CA' | 'CC'> = { '7447': 'CA', '7448': 'CC', '4511': 'CC' };
        const want = wants[dec.defId!];
        const has = display.props.polarity ?? 'CC';
        if (want !== has) {
          issues.push({
            id: nid(), rule: 'polarity-mismatch', severity: 'error',
            title: `${dec.defId} is wired to a ${has} display — it needs ${want === 'CA' ? 'COMMON-ANODE' : 'COMMON-CATHODE'}`,
            detail: `The ${dec.defId} segment outputs connect to this display's segment pins. ${dec.defId === '7447' ? 'The 7447 sinks current (open-collector, active-LOW) — it pairs with a common-ANODE display (5161BS).' : 'This decoder sources current (active-HIGH) — it pairs with a common-CATHODE display (5161AS).'}`,
            why: 'With the wrong polarity the segments can never complete a circuit: the display stays blank (or only lights through protection paths that do not exist).',
            refs: [{ partId: dec.id }, { partId: display.id }],
          });
        }
      }
    }
  }

  /* --- rule: LS → HC interface level mismatch (static, wiring-based) --- */
  {
    const chipById = new Map(
      project.parts.filter((p) => p.type === 'chip' && p.defId).map((p) => [p.id, p]),
    );
    outer: for (const net of nets) {
      let lsDriver: PartInstance | undefined;
      const cmosReaders: { partId: string; pin: number }[] = [];
      for (const np of net.pins) {
        const p = chipById.get(np.partId);
        if (!p || !powered.get(p.id)) continue;
        const def = getChipDef(p.defId!);
        if (!def || def.refOnly) continue;
        const pinDef = def.pins[np.pin - 1];
        if (!pinDef) continue;
        const fam = p.family ?? def.families[0];
        if (pinDef.dir === 'out' && fam === 'LS') lsDriver = p;
        // HCT inputs are TTL-threshold (VIH min 2.0 V @ VCC 4.5 V) — an LS VOH
        // min of 2.7 V meets them with 0.7 V margin, so HCT is the FIX, not a
        // violation. Only HC (VIH 3.15 V) / CD4000 (VIH 3.5 V) are marginal.
        if (pinDef.dir === 'in' && (fam === 'HC' || fam === 'CD4000')) {
          cmosReaders.push({ partId: p.id, pin: np.pin });
        }
      }
      if (lsDriver && cmosReaders.length) {
        issues.push({
          id: nid(), rule: 'ls-to-hc', severity: 'warning',
          title: 'LS output driving a CMOS (HC/CD4000) input — level not guaranteed',
          detail: '74LS VOH min = 2.7 V but 74HC VIH min = 3.15 V (at VCC = 4.5 V). Use HCT for the interface (its VIH 2.0 V accepts an LS output), or add a pull-up resistor.',
          why: 'This is exactly why HCT was invented — TTL output levels do not reliably meet CMOS input thresholds.',
          refs: [{ partId: lsDriver.id }, ...cmosReaders.slice(0, 2)],
        });
        break outer;
      }
    }
  }

  /* --- rule: package current budget (4511 50 mA ICC) --- */
  for (const [partId, total] of ctx.segCurrents) {
    const part = partsById.get(partId);
    const def = part?.defId ? getChipDef(part.defId) : undefined;
    const iccMax = def?.limits?.iccMaxmA;
    if (iccMax && total > iccMax) {
      issues.push({
        id: nid(), rule: 'package-current', severity: 'error',
        title: `${part?.defId} package current budget exceeded (~${total.toFixed(0)} mA > ${iccMax} mA)`,
        detail: '7 segments × 10 mA = 70 mA would exceed the 4511 ICC abs max of 50 mA. Keep segment current ≈5–8 mA (use 330–470 Ω).',
        why: 'Nexperia 74HC4511 Rev. 4: ICC abs max 50 mA. The ERC checks the PACKAGE budget, not just per-pin.',
        refs: [{ partId }],
      });
    }
  }

  /* --- rule: missing decoupling cap per powered IC (info) --- */
  const caps = project.parts.filter((p) => p.type === 'cap');
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly || !powered.get(part.id)) continue;
    const pv = netlist.pinNet(part.id, def.power.vcc);
    const pg = netlist.pinNet(part.id, def.power.gnd);
    const ok = caps.some((c) => {
      if (c.pins.length < 2) return false;
      const n1 = netlist.holeNet.get(holeKey(c.pins[0]));
      const n2 = netlist.holeNet.get(holeKey(c.pins[1]));
      return (n1 === pv && n2 === pg) || (n2 === pv && n1 === pg);
    });
    if (!ok) {
      issues.push({
        id: nid(), rule: 'no-decoupling', severity: 'info',
        title: `No 0.1 µF decoupling cap on ${label(part)}`,
        detail: 'Place a 0.1 µF cap from VCC (pin ' + def.power.vcc + ') to GND (pin ' + def.power.gnd + '), physically close to the chip.',
        why: 'Standard good practice for TTL/CMOS breadboards — kills supply glitches when several gates switch at once.',
        refs: [{ partId: part.id }],
      });
    }
  }

  /* --- rule: rail section with loads but no supply contact (full-plus groups) --- */
  {
    const boardsById = new Map(project.boards.map((b) => [b.id, b]));
    for (const net of nets) {
      if (net.isVccRail && net.isGndRail) continue; // rail-shorted reports this
      const railHoles = net.holes.filter((k) => isRailRow(parseHoleKey(k).row));
      if (railHoles.length === 0) continue;
      if (net.pins.some((np) => np.type === 'supply')) continue;
      // only pull-up/pull-down legs hanging off the section — no real load
      if (!net.pins.some((np) => np.type !== 'resistor')) continue;
      const sample = parseHoleKey(railHoles[0]);
      const board = boardsById.get(sample.board);
      const name = board?.label ?? sample.board;
      issues.push({
        id: nid(), rule: 'rail-group-unpowered', severity: 'warning',
        title: `Rail section near column ${sample.col} (${name}) has connections but no power`,
        detail: board?.railLayout === 'groups5'
          ? 'This board\'s power rails are broken into 5-hole groups. This group is isolated from the group your supply feeds — bridge the groups with a jumper or plug the connection into a powered group.'
          : 'These rail holes reach no supply contact. Bridge them to the powered rail section or move the connection.',
        why: 'Rail sections that are not bridged are the classic full-plus breadboard trap: the circuit looks wired but that whole rail group is dead.',
        refs: [],
      });
    }
  }

  /* --- rule: + rail and − rail shorted together --- */
  {
    const shorted = nets.find((net) => net.isVccRail && net.isGndRail);
    if (shorted) {
      issues.push({
        id: nid(), rule: 'rail-shorted', severity: 'error',
        title: '+ rail and − rail are SHORTED together',
        detail: `One net spans both a + rail line and a − rail line (${shorted.holes.length} holes). A wire or part lead is bridging plus to minus — on the bench this is a dead short across the supply.`,
        why: 'Direct VCC↔GND short: the supply current is limited only by its own protection, wires heat up and the regulator may shut down or burn.',
        refs: [],
      });
    }
  }

  /* --- rule: 555 clock module power --- */
  for (const part of project.parts) {
    if (part.type !== 'clock555') continue;
    const pv = netlist.pinNet(part.id, 1);
    const pg = netlist.pinNet(part.id, 2);
    const okP = pv !== undefined && pg !== undefined && ctx.suppliedHigh.has(pv) && ctx.suppliedLow.has(pg);
    if (!okP) {
      issues.push({
        id: nid(), rule: 'clock-unpowered', severity: 'error',
        title: '555 clock module is not powered',
        detail: 'Wire the module V+ to a net fed by a supply\'s + terminal and GND to a supply\'s − terminal. TI NE555 (SLFS022): VCC 4.5–16 V.',
        refs: [{ partId: part.id }],
      });
    }
  }

  /* --- rule: wires landing on nothing / duplicate placement --- */
  const seen = new Map<string, string>();
  for (const part of project.parts) {
    for (const h of part.pins) {
      const k = holeKey(h);
      if (seen.has(k)) {
        issues.push({
          id: nid(), rule: 'pin-collision', severity: 'error',
          title: 'Two part pins share one hole',
          detail: `A hole at column ${parseHoleKey(k).col} row ${parseHoleKey(k).row} is occupied by both ${label(partsById.get(seen.get(k)!))} and ${label(part)}. Only one leg per hole.`,
          refs: [{ partId: seen.get(k)! }, { partId: part.id }],
        });
      } else {
        seen.set(k, part.id);
      }
    }
  }

  /* --- rule: legacy stacked leads (info) — new edits enforce one lead per hole --- */
  {
    const leads = new Map<string, number>(); // holeKey -> lead count
    for (const part of project.parts) {
      for (const h of part.pins) {
        const k = holeKey(h);
        leads.set(k, (leads.get(k) ?? 0) + 1);
      }
    }
    const wireStacks: string[] = [];
    for (const w of project.wires) {
      for (const h of [w.from, w.to]) {
        const k = holeKey(h);
        const before = leads.get(k) ?? 0;
        if (before > 0) wireStacks.push(`${parseHoleKey(k).col}·${parseHoleKey(k).row}`);
        leads.set(k, before + 1);
      }
    }
    if (wireStacks.length > 0) {
      issues.push({
        id: nid(), rule: 'stacked-holes', severity: 'info',
        title: `${wireStacks.length} wire end${wireStacks.length === 1 ? '' : 's'} share a hole with another lead`,
        detail: `Real tie-points hold ONE lead. Stacked at: ${[...new Set(wireStacks)].slice(0, 4).join(', ')}${wireStacks.length > 4 ? '…' : ''}. Rewire so each wire lands on its own hole — the editor no longer allows stacking.`,
        why: 'Stacked leads work loose, make circuits impossible to debug, and can bridge to the neighboring strip.',
        refs: [],
      });
    }
  }

  /* --- rule: leads landing where no tie-point exists (stale / hand-edited JSON).
     The editor blocks these at drop time; the netlist now ignores them too —
     without this rule a wire on a groups5 rail gap would silently do nothing. --- */
  {
    const boardOf = new Map(project.boards.map((b) => [b.id, b]));
    const checkHole = (h: HoleRef, ref: SimIssue['refs'][number]) => {
      const b = boardOf.get(h.board);
      if (b && holeExists(b.kind, b.railLayout, h.row, h.col)) return;
      issues.push({
        id: nid(), rule: 'phantom-hole', severity: 'error',
        title: `Lead lands where there is no hole (${h.board} col ${h.col} row ${h.row})`,
        detail: b
          ? 'This rail line has a gap here (full-plus boards break the power rails into 5-hole groups). The saved lead sits on bare plastic and connects to nothing — move it to a real tie-point.'
          : 'This lead references a board that no longer exists in the project — it connects to nothing.',
        why: 'Connectivity is built from physical tie-points. A lead on bare plastic is an open circuit no matter what the drawing shows.',
        refs: [ref],
      });
    };
    for (const part of project.parts) {
      part.pins.forEach((h, idx) => checkHole(h, { partId: part.id, pin: idx + 1, hole: holeKey(h) }));
    }
    for (const w of project.wires) {
      checkHole(w.from, { hole: holeKey(w.from) });
      checkHole(w.to, { hole: holeKey(w.to) });
    }
  }

  return issues;
}
