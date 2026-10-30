import type { PartInstance, Project, Wire } from './types';
import { boardDims } from './geometry';

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
    schema: 2, name,
    boards: [{ id: 'main', kind: 'half400', railLayout: 'continuous' }],
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
  wires.push(wire([3, 'h'], [3, '+T'], WIRE_COLORS.red));     // VCC pin 16 (same strip, one hole over)
  wires.push(wire([10, 'd'], [10, '-T'], WIRE_COLORS.black)); // GND pin 8
  wires.push(wire([5, 'd'], [5, '+T'], WIRE_COLORS.red));     // LT̅ high
  wires.push(wire([6, 'd'], [6, '+T'], WIRE_COLORS.red));     // BI/RBO open-or-high
  wires.push(wire([7, 'd'], [7, '+T'], WIRE_COLORS.red));     // RBI̅ high

  // 5161BS (CA) at cols 13..17
  // e-row: 1=e(13) 2=d(14) 3=com(15) 4=c(16) 5=dp(17); f-row: 6=b(17) 7=a(16) 8=com(15) 9=f(14) 10=g(13)
  parts.push(part('seg7', [[13, 'e'], [14, 'e'], [15, 'e'], [16, 'e'], [17, 'e'],
    [17, 'f'], [16, 'f'], [15, 'f'], [14, 'f'], [13, 'f']], { polarity: 'CA', color: 'red' }));
  wires.push(wire([15, 'd'], [15, '+T'], WIRE_COLORS.red)); // common anode 3 (same strip as pin)
  wires.push(wire([15, 'g'], [14, '+T'], WIRE_COLORS.red)); // common anode 8

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
    // hop into the same column strip one row away — never stack on a pin hole
    wires.push(wire([cfg.inPinCol, 'd'], [cfg.swCol, 'c'], WIRE_COLORS.amber));
    wires.push(wire([cfg.swCol + 1, 'a'], [cfg.swCol + 1, '+T'], WIRE_COLORS.red));
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
  wires.push(wire([1, 'd'], [2, '+T'], WIRE_COLORS.red));
  wires.push(wire([2, 'd'], [2, '-T'], WIRE_COLORS.black));
  wires.push(wire([3, 'd'], [5, 'g'], WIRE_COLORS.amber)); // OUT → CP0 (same strip as each pin)

  // 7490 (DIP14) at cols 5..11 — POWER IS PINS 5 & 10
  // e-row: 1=CP1(5) 2=MR1(6) 3=MR2(7) 4=NC(8) 5=VCC(9) 6=MS1(10) 7=MS2(11)
  // f-row: 8=Q2(11) 9=Q1(10) 10=GND(9) 11=Q3(8) 12=Q0(7) 13=NC(6) 14=CP0(5)
  parts.push(part('chip', [[5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'], [10, 'e'], [11, 'e'],
    [11, 'f'], [10, 'f'], [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f']], {}, '7490'));
  wires.push(wire([9, 'd'], [9, '+T'], WIRE_COLORS.red));     // VCC = pin 5 !!
  wires.push(wire([9, 'h'], [9, '-T'], WIRE_COLORS.black));   // GND = pin 10 !!
  wires.push(wire([6, 'd'], [6, '-T'], WIRE_COLORS.black));   // MR1 low
  wires.push(wire([7, 'd'], [7, '-T'], WIRE_COLORS.black));   // MR2 low
  wires.push(wire([10, 'd'], [10, '-T'], WIRE_COLORS.black)); // MS1 low
  wires.push(wire([11, 'd'], [11, '-T'], WIRE_COLORS.black)); // MS2 low
  wires.push(wire([7, 'g'], [5, 'd'], WIRE_COLORS.green));    // Q0 → CP1 (BCD jumper)

  // 4511 (DIP16) at cols 14..21 — HCT variant: the 74LS90's VOH min 2.7 V meets
  // HCT VIH 2.0 V with margin; plain HC (VIH 3.15 V) would be marginal (ERC warns)
  // e-row: 1=B(14) 2=C(15) 3=LT(16) 4=BI(17) 5=LE(18) 6=D(19) 7=A(20) 8=GND(21)
  // f-row: 9=e(21) 10=d(20) 11=c(19) 12=b(18) 13=a(17) 14=g(16) 15=f(15) 16=VCC(14)
  parts.push(part('chip', [[14, 'e'], [15, 'e'], [16, 'e'], [17, 'e'], [18, 'e'], [19, 'e'], [20, 'e'], [21, 'e'],
    [21, 'f'], [20, 'f'], [19, 'f'], [18, 'f'], [17, 'f'], [16, 'f'], [15, 'f'], [14, 'f']], {}, '4511', 'HCT'));
  wires.push(wire([14, 'h'], [14, '+T'], WIRE_COLORS.red));   // VCC pin 16
  wires.push(wire([21, 'd'], [21, '-T'], WIRE_COLORS.black)); // GND pin 8
  wires.push(wire([16, 'd'], [16, '+T'], WIRE_COLORS.red));   // LT̅ high
  wires.push(wire([17, 'd'], [17, '+T'], WIRE_COLORS.red));   // BI̅ high
  wires.push(wire([18, 'd'], [18, '-T'], WIRE_COLORS.black)); // LE low = transparent

  // Q → BCD inputs (into the same strips as the pins, one row away)
  wires.push(wire([7, 'h'], [20, 'd'], WIRE_COLORS.teal));  // Q0 → A
  wires.push(wire([10, 'g'], [14, 'd'], WIRE_COLORS.teal)); // Q1 → B
  wires.push(wire([11, 'g'], [15, 'd'], WIRE_COLORS.teal)); // Q2 → C
  wires.push(wire([8, 'g'], [19, 'd'], WIRE_COLORS.teal));  // Q3 → D

  // 5161AS (CC) at cols 24..28
  // e-row: 1=e(24) 2=d(25) 3=com(26) 4=c(27) 5=dp(28); f-row: 6=b(28) 7=a(27) 8=com(26) 9=f(25) 10=g(24)
  parts.push(part('seg7', [[24, 'e'], [25, 'e'], [26, 'e'], [27, 'e'], [28, 'e'],
    [28, 'f'], [27, 'f'], [26, 'f'], [25, 'f'], [24, 'f']], { polarity: 'CC', color: 'red' }));
  wires.push(wire([26, 'd'], [26, '-T'], WIRE_COLORS.black)); // common cathode 3
  wires.push(wire([26, 'g'], [27, '-T'], WIRE_COLORS.black)); // common cathode 8

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

/**
 * Demo 3 — two-board counter (multi-board acceptance fixture, plan §7.3):
 * 555 + 7490 live on the "Counter" board, 4511 + 5161AS on the "Display"
 * board. Long jumpers bridge + / − rail groups across the gap and carry the
 * four Q outputs over. Both boards use full-plus grouped rails, so the rail
 * bridges are part of the circuit (and the ERC keeps you honest about them).
 *
 * 7490 @ cols 13-19: e-row pins 1-7 = CP1 MR1 MR2 NC VCC MS1 MS2 (13..19),
 * f-row pins 8-14 mirrored = Q2 Q1 GND Q3 Q0 NC CP0 (19..13).
 * 4511 @ cols 5-12: e-row pins 1-8 = B C LT BI LE D A GND (5..12),
 * f-row pins 9-16 mirrored = e d c b a g f VCC (12..5).
 */
export function demoTwoBoard(): Project {
  const p = emptyProject('Lab 3 — two boards: 555 + 7490 → jumpers → 4511 + display');
  uid = 2000;
  const HB = (board: string, col: number, row: string) => ({ board, col, row: row as never });
  const wireB = (board: string, from: [number, string], to: [number, string], color: string): Wire =>
    ({ id: id('w'), from: HB(board, from[0], from[1]), to: HB(board, to[0], to[1]), color });
  const cross = (from: [number, string], to: [number, string], color: string): Wire =>
    ({ id: id('w'), from: HB('main', from[0], from[1]), to: HB('b2', to[0], to[1]), color });
  const partB = (board: string, t: PartInstance['type'], pins: [number, string][], props: PartInstance['props'], defId?: string, family?: PartInstance['family']): PartInstance => ({
    id: id(t), type: t, defId, ...(family ? { family } : {}), pins: pins.map(([c, r]) => HB(board, c, r)), props,
  });

  p.boards = [
    { id: 'main', kind: 'full830', railLayout: 'groups5', label: 'Counter', x: 0, y: 0 },
    { id: 'b2', kind: 'full830', railLayout: 'groups5', label: 'Display', x: boardDims('full830').width + 80, y: 0 },
  ];

  const parts: PartInstance[] = [];
  const wires: Wire[] = [];

  /* ---- board 1 (main): supply + clock + decade counter ---- */
  parts.push(partB('main', 'supply', [[2, '+T'], [5, '-T']], { volts: 5 }));
  // bridge the +T and −T groups so the whole left half shares power
  wires.push(wireB('main', [6, '+T'], [9, '+T'], WIRE_COLORS.orange));
  wires.push(wireB('main', [9, '-T'], [13, '-T'], WIRE_COLORS.orange));

  parts.push(partB('main', 'clock555', [[8, 'e'], [9, 'e'], [10, 'e']], { freqHz: 1 }));
  wires.push(wireB('main', [8, 'd'], [10, '+T'], WIRE_COLORS.red));
  wires.push(wireB('main', [9, 'd'], [8, '-T'], WIRE_COLORS.black));
  wires.push(wireB('main', [10, 'd'], [13, 'g'], WIRE_COLORS.amber)); // OUT → CP0

  // 7490 (DIP14) at cols 13..19 — POWER IS PINS 5 & 10
  parts.push(partB('main', 'chip',
    [[13, 'e'], [14, 'e'], [15, 'e'], [16, 'e'], [17, 'e'], [18, 'e'], [19, 'e'],
     [19, 'f'], [18, 'f'], [17, 'f'], [16, 'f'], [15, 'f'], [14, 'f'], [13, 'f']], {}, '7490'));
  wires.push(wireB('main', [17, 'd'], [13, '+T'], WIRE_COLORS.red));   // VCC = pin 5 (e17)
  wires.push(wireB('main', [17, 'g'], [12, '-T'], WIRE_COLORS.black)); // GND = pin 10 (f17)
  wires.push(wireB('main', [14, 'd'], [6, '-T'], WIRE_COLORS.black));  // MR1 low
  wires.push(wireB('main', [15, 'd'], [7, '-T'], WIRE_COLORS.black));  // MR2 low
  wires.push(wireB('main', [18, 'd'], [15, '-T'], WIRE_COLORS.black)); // MS1 low
  wires.push(wireB('main', [19, 'd'], [14, '-T'], WIRE_COLORS.black)); // MS2 low
  wires.push(wireB('main', [15, 'g'], [13, 'd'], WIRE_COLORS.green));  // Q0 (f15) → CP1 (e13)

  /* ---- cross-board jumpers: power + BCD data ---- */
  wires.push(cross([4, '+T'], [3, '+T'], WIRE_COLORS.red));   // + rail bridge
  wires.push(cross([16, '-T'], [6, '-T'], WIRE_COLORS.black)); // − rail bridge (from the bridged group)
  wires.push(cross([15, 'h'], [11, 'd'], WIRE_COLORS.teal));  // Q0 (f15) → A (e11)
  wires.push(cross([18, 'g'], [5, 'd'], WIRE_COLORS.teal));   // Q1 (f18) → B (e5)
  wires.push(cross([19, 'g'], [6, 'd'], WIRE_COLORS.teal));   // Q2 (f19) → C (e6)
  wires.push(cross([16, 'g'], [10, 'd'], WIRE_COLORS.teal));  // Q3 (f16) → D (e10)

  /* ---- board 2 (b2): decoder + display ---- */
  // bridge b2's rail groups too — it is powered only through the jumpers
  wires.push(wireB('b2', [6, '+T'], [9, '+T'], WIRE_COLORS.orange));
  wires.push(wireB('b2', [9, '-T'], [13, '-T'], WIRE_COLORS.orange));

  // 4511 (DIP16) HCT at cols 5..12
  parts.push(partB('b2', 'chip',
    [[5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'], [10, 'e'], [11, 'e'], [12, 'e'],
     [12, 'f'], [11, 'f'], [10, 'f'], [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f']], {}, '4511', 'HCT'));
  wires.push(wireB('b2', [5, 'h'], [4, '+T'], WIRE_COLORS.red));    // VCC pin 16 (f5)
  wires.push(wireB('b2', [12, 'd'], [7, '-T'], WIRE_COLORS.black)); // GND pin 8 (e12)
  wires.push(wireB('b2', [7, 'd'], [10, '+T'], WIRE_COLORS.red));   // LT̅ high
  wires.push(wireB('b2', [8, 'd'], [11, '+T'], WIRE_COLORS.red));   // BI̅ high
  wires.push(wireB('b2', [9, 'd'], [12, '-T'], WIRE_COLORS.black)); // LE low

  // 5161AS (CC) at cols 16..20
  parts.push(partB('b2', 'seg7',
    [[16, 'e'], [17, 'e'], [18, 'e'], [19, 'e'], [20, 'e'],
     [20, 'f'], [19, 'f'], [18, 'f'], [17, 'f'], [16, 'f']], { polarity: 'CC', color: 'red' }));
  wires.push(wireB('b2', [18, 'd'], [14, '-T'], WIRE_COLORS.black)); // common cathode 3
  wires.push(wireB('b2', [18, 'g'], [16, '-T'], WIRE_COLORS.black)); // common cathode 8

  // one 330 Ω per segment (into the same strips as the pins)
  // 4511 segment pins: a=f8 b=f9 c=f10 d=f11 e=f12 f=f6 g=f7
  const segs3: [number, string, number, string][] = [
    [8, 'g', 19, 'j'],  // a → display a (f19)
    [9, 'g', 20, 'j'],  // b → display b (f20)
    [10, 'g', 19, 'a'], // c → display c (e19)
    [11, 'g', 17, 'a'], // d → display d (e17)
    [12, 'g', 16, 'a'], // e → display e (e16)
    [6, 'g', 17, 'j'],  // f → display f (f17)
    [7, 'g', 16, 'j'],  // g → display g (f16)
  ];
  for (const [c1, r1, c2, r2] of segs3) {
    parts.push(partB('b2', 'resistor', [[c1, r1], [c2, r2]], { ohms: 330 }));
  }

  // 0.1 µF decoupling on the decoder (VCC strip ↔ GND strip)
  parts.push(partB('b2', 'cap', [[5, 'g'], [12, 'b']], { farads: 1e-7 }));

  p.parts = parts;
  p.wires = wires;
  p.notes = 'MVP golden circuit #3 — TWO boards. The 555 ticks at 1 Hz and the 7490 counts on the "Counter" board; the Q outputs ride long teal jumpers to the 4511 + 5161AS on the "Display" board. Both boards use grouped (full-plus) rails: the orange jumpers BRIDGE rail groups, and the red/black jumpers carry power across the gap. Remove a bridge and watch ERC catch the dead rail section.';
  return p;
}
