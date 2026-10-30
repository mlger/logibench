import type { PartInstance, Project, Wire } from './types';

/**
 * Golden demo circuits (plan §6 milestone tests):
 * 1. switches → 7447 → common-anode 5161BS  (MVP acceptance circuit #1)
 * 2. 555 module → 7490 → 4511 → common-cathode 5161AS counting 0–9 at ~1 Hz
 *
 * All hole coordinates verified against chipFootprint()/seg7Footprint():
 *  - DIP16 @ col0: pins 1..8 → row e cols col0..col0+7; pins 9..16 → row f cols col0+7..col0
 *  - DIP14 @ col0: pins 1..7 → row e cols col0..col0+6; pins 8..14 → row f cols col0+6..col0
 *  - seg7  @ col0: pins 1..5 → row e; pins 6..10 → row f (mirrored)
 */

let uid = 0;
const id = (p: string) => `${p}-${++uid}`;
const H = (col: number, row: string) => ({ board: 'main', col, row: row as never });

function wire(from: [number, string], to: [number, string], color: string): Wire {
  return { id: id('w'), from: H(from[0], from[1]), to: H(to[0], to[1]), color };
}

function part(t: PartInstance['type'], pins: [number, string][], props: PartInstance['props'], defId?: string, family?: PartInstance['family']): PartInstance {
  const p: PartInstance = { id: id(t), type: t, defId, pins: pins.map(([c, r]) => H(c, r)), props };
  if (family) p.family = family;
  return p;
}

export const WIRE_COLORS = {
  red: '#dc2626', black: '#27272a', orange: '#ea580c', green: '#16a34a',
  violet: '#7c3aed', teal: '#0d9488', rose: '#e11d48', amber: '#d97706',
  brown: '#78350f', gray: '#52525b',
};

export function emptyProject(name = 'Untitled circuit'): Project {
  return {
    schema: 1, name,
    boards: [{ id: 'main', kind: 'half400', railsSplit: false }],
    parts: [], wires: [], notes: '',
  };
}

export function demo7447(): Project {
  const p = emptyProject('Lab 1 — Switches → 7447 → common-anode display');
  uid = 0;
  const parts: PartInstance[] = [];
  const wires: Wire[] = [];

  // supply directly on the rails
  parts.push(part('supply', [[1, '+T'], [1, '-T']], { volts: 5 }));

  // 7447 (DIP16) at cols 3..10
  // pins e-row: 1=B(3) 2=C(4) 3=LT(5) 4=BI(6) 5=RBI(7) 6=D(8) 7=A(9) 8=GND(10)
  // pins f-row: 9=e(10) 10=d(9) 11=c(8) 12=b(7) 13=a(6) 14=g(5) 15=f(4) 16=VCC(3)
  parts.push(part('chip', [[3, 'e'], [4, 'e'], [5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'], [10, 'e'],
    [10, 'f'], [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f'], [4, 'f'], [3, 'f']], {}, '7447'));
  wires.push(wire([3, 'f'], [3, '+T'], WIRE_COLORS.red));     // VCC pin 16
  wires.push(wire([10, 'e'], [10, '-T'], WIRE_COLORS.black)); // GND pin 8
  wires.push(wire([5, 'e'], [5, '+T'], WIRE_COLORS.red));     // LT̅ high
  wires.push(wire([6, 'e'], [6, '+T'], WIRE_COLORS.red));     // BI/RBO open-or-high
  wires.push(wire([7, 'e'], [7, '+T'], WIRE_COLORS.red));     // RBI̅ high

  // 5161BS (CA) at cols 13..17
  // e-row: 1=e(13) 2=d(14) 3=com(15) 4=c(16) 5=dp(17); f-row: 6=b(17) 7=a(16) 8=com(15) 9=f(14) 10=g(13)
  parts.push(part('seg7', [[13, 'e'], [14, 'e'], [15, 'e'], [16, 'e'], [17, 'e'],
    [17, 'f'], [16, 'f'], [15, 'f'], [14, 'f'], [13, 'f']], { polarity: 'CA', color: 'red' }));
  wires.push(wire([15, 'e'], [15, '+T'], WIRE_COLORS.red)); // common anode 3
  wires.push(wire([15, 'f'], [15, '+T'], WIRE_COLORS.red)); // common anode 8

  // one 330 Ω per segment: leg1 in the 7447 output strip (row j), leg2 in the
  // display segment strip (row j if the display pin is on row f, row a if on row e)
  const segs: { outCol: number; dspCol: number; dspRow: 'a' | 'j' }[] = [
    { outCol: 6, dspCol: 16, dspRow: 'j' },  // a: (6,f)→(16,f)
    { outCol: 7, dspCol: 17, dspRow: 'j' },  // b: (7,f)→(17,f)
    { outCol: 8, dspCol: 16, dspRow: 'a' },  // c: (8,f)→(16,e)
    { outCol: 9, dspCol: 14, dspRow: 'a' },  // d: (9,f)→(14,e)
    { outCol: 10, dspCol: 13, dspRow: 'a' }, // e: (10,f)→(13,e)
    { outCol: 4, dspCol: 14, dspRow: 'j' },  // f: (4,f)→(14,f)
    { outCol: 5, dspCol: 13, dspRow: 'j' },  // g: (5,f)→(13,f)
  ];
  for (const s of segs) {
    parts.push(part('resistor', [[s.outCol, 'j'], [s.dspCol, s.dspRow]], { ohms: 330 }));
  }

  // 4 input switches with 1 kΩ pull-downs (plan §4.1: LS needs ≤2.2 kΩ)
  const inputs: { inPinCol: number; swCol: number }[] = [
    { inPinCol: 9, swCol: 20 },  // A
    { inPinCol: 3, swCol: 22 },  // B
    { inPinCol: 4, swCol: 24 },  // C
    { inPinCol: 8, swCol: 26 },  // D
  ];
  inputs.forEach((cfg) => {
    parts.push(part('switch', [[cfg.swCol, 'b'], [cfg.swCol + 1, 'b']], { closed: false }));
    parts.push(part('resistor', [[cfg.swCol, 'a'], [cfg.swCol, '-T']], { ohms: 1000 }));
    wires.push(wire([cfg.inPinCol, 'e'], [cfg.swCol, 'b'], WIRE_COLORS.amber));
    wires.push(wire([cfg.swCol + 1, 'b'], [cfg.swCol + 1, '+T'], WIRE_COLORS.red));
  });

  // 0.1 µF decoupling across the 7447 power nets
  parts.push(part('cap', [[3, 'g'], [10, 'b']], { farads: 1e-7 }));

  p.parts = parts;
  p.wires = wires;
  p.notes = 'MVP golden circuit #1. A closed switch feeds 1 (via the + rail); an open switch reads 0 through the 1 kΩ pull-down (LS IIL −0.4 mA → ≈0.4 V < VIL 0.8 V). Set the switches to spell BCD digits 0–9.';
  return p;
}

export function demo4511(): Project {
  const p = emptyProject('Lab 2 — 555 → 7490 → 4511 → common-cathode counter');
  uid = 1000;
  const parts: PartInstance[] = [];
  const wires: Wire[] = [];

  parts.push(part('supply', [[1, '+T'], [1, '-T']], { volts: 5 }));

  // 555 clock module: 1=V+(1,e) 2=GND(2,e) 3=OUT(3,e)
  parts.push(part('clock555', [[1, 'e'], [2, 'e'], [3, 'e']], { freqHz: 1 }));
  wires.push(wire([1, 'e'], [1, '+T'], WIRE_COLORS.red));
  wires.push(wire([2, 'e'], [1, '-T'], WIRE_COLORS.black));
  wires.push(wire([3, 'e'], [5, 'f'], WIRE_COLORS.amber)); // OUT → CP0

  // 7490 (DIP14) at cols 5..11 — POWER IS PINS 5 & 10
  // e-row: 1=CP1(5) 2=MR1(6) 3=MR2(7) 4=NC(8) 5=VCC(9) 6=MS1(10) 7=MS2(11)
  // f-row: 8=Q2(11) 9=Q1(10) 10=GND(9) 11=Q3(8) 12=Q0(7) 13=NC(6) 14=CP0(5)
  parts.push(part('chip', [[5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'], [10, 'e'], [11, 'e'],
    [11, 'f'], [10, 'f'], [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f']], {}, '7490'));
  wires.push(wire([9, 'e'], [9, '+T'], WIRE_COLORS.red));     // VCC = pin 5 !!
  wires.push(wire([9, 'f'], [9, '-T'], WIRE_COLORS.black));   // GND = pin 10 !!
  wires.push(wire([6, 'e'], [6, '-T'], WIRE_COLORS.black));   // MR1 low
  wires.push(wire([7, 'e'], [7, '-T'], WIRE_COLORS.black));   // MR2 low
  wires.push(wire([10, 'e'], [10, '-T'], WIRE_COLORS.black)); // MS1 low
  wires.push(wire([11, 'e'], [11, '-T'], WIRE_COLORS.black)); // MS2 low
  wires.push(wire([7, 'f'], [5, 'e'], WIRE_COLORS.green));    // Q0 → CP1 (BCD jumper)

  // 4511 (DIP16) at cols 14..21 — HCT variant: the 74LS90's VOH min 2.7 V meets
  // HCT VIH 2.0 V with margin; plain HC (VIH 3.15 V) would be marginal (ERC warns)
  // e-row: 1=B(14) 2=C(15) 3=LT(16) 4=BI(17) 5=LE(18) 6=D(19) 7=A(20) 8=GND(21)
  // f-row: 9=e(21) 10=d(20) 11=c(19) 12=b(18) 13=a(17) 14=g(16) 15=f(15) 16=VCC(14)
  parts.push(part('chip', [[14, 'e'], [15, 'e'], [16, 'e'], [17, 'e'], [18, 'e'], [19, 'e'], [20, 'e'], [21, 'e'],
    [21, 'f'], [20, 'f'], [19, 'f'], [18, 'f'], [17, 'f'], [16, 'f'], [15, 'f'], [14, 'f']], {}, '4511', 'HCT'));
  wires.push(wire([14, 'f'], [14, '+T'], WIRE_COLORS.red));   // VCC pin 16
  wires.push(wire([21, 'e'], [21, '-T'], WIRE_COLORS.black)); // GND pin 8
  wires.push(wire([16, 'e'], [16, '+T'], WIRE_COLORS.red));   // LT̅ high
  wires.push(wire([17, 'e'], [17, '+T'], WIRE_COLORS.red));   // BI̅ high
  wires.push(wire([18, 'e'], [18, '-T'], WIRE_COLORS.black)); // LE low = transparent

  // Q → BCD inputs
  wires.push(wire([7, 'f'], [20, 'e'], WIRE_COLORS.teal));  // Q0 → A
  wires.push(wire([10, 'f'], [14, 'e'], WIRE_COLORS.teal)); // Q1 → B
  wires.push(wire([11, 'f'], [15, 'e'], WIRE_COLORS.teal)); // Q2 → C
  wires.push(wire([8, 'f'], [19, 'e'], WIRE_COLORS.teal));  // Q3 → D

  // 5161AS (CC) at cols 24..28
  // e-row: 1=e(24) 2=d(25) 3=com(26) 4=c(27) 5=dp(28); f-row: 6=b(28) 7=a(27) 8=com(26) 9=f(25) 10=g(24)
  parts.push(part('seg7', [[24, 'e'], [25, 'e'], [26, 'e'], [27, 'e'], [28, 'e'],
    [28, 'f'], [27, 'f'], [26, 'f'], [25, 'f'], [24, 'f']], { polarity: 'CC', color: 'red' }));
  wires.push(wire([26, 'e'], [26, '-T'], WIRE_COLORS.black)); // common cathode 3
  wires.push(wire([26, 'f'], [26, '-T'], WIRE_COLORS.black)); // common cathode 8

  // one 330 Ω per segment
  const segs2: { outCol: number; dspCol: number; dspRow: 'a' | 'j' }[] = [
    { outCol: 17, dspCol: 27, dspRow: 'j' }, // a: (17,f)→(27,f)
    { outCol: 18, dspCol: 28, dspRow: 'j' }, // b: (18,f)→(28,f)
    { outCol: 19, dspCol: 27, dspRow: 'a' }, // c: (19,f)→(27,e)
    { outCol: 20, dspCol: 25, dspRow: 'a' }, // d: (20,f)→(25,e)
    { outCol: 21, dspCol: 24, dspRow: 'a' }, // e: (21,f)→(24,e)
    { outCol: 15, dspCol: 25, dspRow: 'j' }, // f: (15,f)→(25,f)
    { outCol: 16, dspCol: 24, dspRow: 'j' }, // g: (16,f)→(24,f)
  ];
  for (const s of segs2) {
    parts.push(part('resistor', [[s.outCol, 'j'], [s.dspCol, s.dspRow]], { ohms: 330 }));
  }

  // 0.1 µF decoupling
  parts.push(part('cap', [[14, 'g'], [21, 'b']], { farads: 1e-7 })); // 4511
  parts.push(part('cap', [[9, 'b'], [9, 'g']], { farads: 1e-7 }));   // 7490

  p.parts = parts;
  p.wires = wires;
  p.notes = 'MVP golden circuit #2. The 555 module ticks at 1 Hz, the 7490 counts on falling edges (Q0→CP1 jumper makes it decade), the 4511 drives the common-cathode 5161AS. Note the 7490 power pins: 5 and 10! The 4511 is the HCT variant — TTL-threshold inputs (VIH 2.0 V) accept the 74LS90\'s VOH 2.7 V; plain HC (VIH 3.15 V) would be marginal.';
  return p;
}
