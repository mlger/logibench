import type { Net, NetLevel, PartInstance, Project, SimIssue } from './types';
import { getChipDef, FAMILIES } from '@/data/chips';
import { holeKey, parseHoleKey } from './geometry';
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
  ledStates: Map<string, { brightness: number; currentMA?: number; noResistor?: boolean; overcurrent?: boolean }>;
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
  const supply = project.parts.find((p) => p.type === 'supply');
  if (!supply) {
    issues.push({
      id: nid(), rule: 'no-supply', severity: 'error',
      title: 'No power supply in the project',
      detail: 'Place the 5 V supply part and wire its + and − terminals (red/black is the convention).',
      why: 'Every IC needs VCC and GND; the simulator powers chips only through them.',
      refs: [],
    });
  } else if (vccNet === undefined || gndNet === undefined) {
    issues.push({
      id: nid(), rule: 'supply-unwired', severity: 'error',
      title: 'Supply terminals are not wired',
      detail: 'Wire the supply + and − terminals to the + and − rails (or anywhere in the circuit).',
      refs: [{ partId: supply.id }],
    });
  }

  /* --- rule: chip power pins (7490 special case) --- */
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly) continue;
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

  /* --- rule: output tied directly to a rail of the opposite level --- */
  for (const part of project.parts) {
    if (part.type !== 'chip' || !part.defId) continue;
    const def = getChipDef(part.defId);
    if (!def || def.refOnly) continue;
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

  /* --- rule: split rails sanity (hidden classic bug) --- */
  for (const board of project.boards) {
    if (board.railsSplit) {
      issues.push({
        id: nid(), rule: 'rails-split-note', severity: 'info',
        title: `${board.kind === 'full830' ? 'Full-size' : 'Half-size'} board has SPLIT rails`,
        detail: 'This board breaks the power rails in the middle. Make sure each half is powered — a classic hidden bug on full-size boards.',
        refs: [],
      });
      break;
    }
  }

  /* --- rule: 555 clock module power --- */
  for (const part of project.parts) {
    if (part.type !== 'clock555') continue;
    const pv = netlist.pinNet(part.id, 1);
    const pg = netlist.pinNet(part.id, 2);
    if (vccNet === undefined || pv !== vccNet || pg !== gndNet) {
      issues.push({
        id: nid(), rule: 'clock-unpowered', severity: 'error',
        title: '555 clock module is not powered',
        detail: 'Wire the module V+ to the + rail and GND to the − rail. TI NE555 (SLFS022): VCC 4.5–16 V.',
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

  return issues;
}
