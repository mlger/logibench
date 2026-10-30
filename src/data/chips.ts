import type { ChipDef, Family, FamilyElectrical } from '@/lib/logibench/types';

/**
 * Datasheet-driven chip library.
 * Every value below traces to the sources cited in `docs/datasheet-sources.md`
 * and each chip carries its datasheet refs + gotchas. Rows flagged with
 * `glyphVerify` are "unique symbol" behaviors that should be bench-verified
 * against the scanned TI datasheets before being trusted for grading.
 */

/* ---------------- Family electrical parameters (plan §4.1) ---------------- */

export const FAMILIES: Record<Family, FamilyElectrical & { label: string; note: string }> = {
  LS: {
    label: '74LS (TTL)',
    vih: 2.0, vil: 0.8, voh: 2.7, vol: 0.4,
    ioh: -0.4, iol: 8, iih: 20, iil: -0.4,
    floatReads: 1, fanout: 20,
    note: 'VCC 4.75–5.25 V. Inputs float HIGH (IIL −0.4 mA) — but tie them anyway. LS VOH min 2.7 V does NOT meet HC VIH min 3.15 V.',
  },
  HC: {
    label: '74HC (CMOS)',
    vih: 3.15, vil: 1.35, voh: 4.4, vol: 0.33,
    ioh: -4, iol: 4, iih: 1, iil: -1,
    floatReads: 'X', fanout: 10,
    note: 'VCC 2.0–6.0 V. VIH 3.15 V at VCC=4.5 V — LS outputs are marginal here. Floating inputs cause excess current/oscillation (TI SCBA004E): tie unused inputs.',
  },
  HCT: {
    label: '74HCT (TTL-level CMOS)',
    vih: 2.0, vil: 0.8, voh: 4.4, vol: 0.33,
    ioh: -4, iol: 4, iih: 1, iil: -1,
    floatReads: 'X', fanout: 10,
    note: 'VCC 4.5–5.5 V. TTL-compatible thresholds — the universal glue family when driving CMOS from TTL.',
  },
  CD4000: {
    label: 'CD4000 (CMOS)',
    vih: 3.5, vil: 1.5, voh: 4.6, vol: 0.4,
    ioh: -4, iol: 10, iih: 1, iil: -1,
    floatReads: 'X', fanout: 10,
    note: 'VCC 3–15 V (4511 rated 2.0–6.0 V per Nexperia). Floating inputs must be tied.',
  },
  NE555: {
    label: 'NE555 timer',
    vih: 3.33, vil: 1.67, voh: 3.3, vol: 0.5,
    ioh: -200, iol: 200, iih: 1, iil: -1,
    floatReads: 'X', fanout: 10,
    note: 'VCC 4.5–16 V (TI SLFS022). RESET pin 4 must be tied HIGH when unused. Output can sink or source up to 200 mA.',
  },
  generic: {
    label: 'Generic',
    vih: 2.0, vil: 0.8, voh: 2.7, vol: 0.4,
    ioh: -1, iol: 8, iih: 20, iil: -0.4,
    floatReads: 1, fanout: 10,
    note: 'Generic/unknown family — check the actual datasheet.',
  },
};

const TI_LS = (doc: string) => ({
  vendor: 'Texas Instruments', doc, rev: '1988 (scanned)', url: `https://www.ti.com/lit/ds/symlink/${doc.toLowerCase()}.pdf`,
});
const TI_SCBA = { vendor: 'Texas Instruments', doc: 'SCBA004E "Implications of Slow or Floating CMOS Inputs"', rev: 'July 2021', url: 'https://www.ti.com/lit/an/scba004e/scba004e.pdf' };

/* ---------------- Helpers ---------------- */

function gatePin(i: number, name: string, dir: 'in' | 'out', activeLow = false) {
  return { num: i, name, dir, activeLow: activeLow || undefined };
}

/** Quad gate on the classic 7400 pinout (1A,1B,1Y / 2A,2B,2Y / GND7 / 3Y,3A,3B / 4Y,4A,4B / VCC14). */
function quadGate(id: string, name: string, fn: 'NAND' | 'NOR' | 'AND' | 'OR' | 'XOR' | 'NOT', families: Family[], extra: Partial<ChipDef> = {}): ChipDef {
  return {
    id, name, families, package: 'DIP14', power: { vcc: 14, gnd: 7 }, model: 'gates',
    pins: [
      gatePin(1, '1A', 'in'), gatePin(2, '1B', 'in'), gatePin(3, '1Y', 'out'),
      gatePin(4, '2A', 'in'), gatePin(5, '2B', 'in'), gatePin(6, '2Y', 'out'),
      { num: 7, name: 'GND', dir: 'gnd' },
      gatePin(8, '3Y', 'out'), gatePin(9, '3A', 'in'), gatePin(10, '3B', 'in'),
      gatePin(11, '4Y', 'out'), gatePin(12, '4A', 'in'), gatePin(13, '4B', 'in'),
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn, inputs: [1, 2], output: 3 },
      { fn, inputs: [4, 5], output: 6 },
      { fn, inputs: [9, 10], output: 8 },
      { fn, inputs: [12, 13], output: 11 },
    ],
    electrical: FAMILIES[families[0]],
    gotchas: [],
    datasheets: [],
    ...extra,
  };
}

/* ---------------- Gate chips ---------------- */

const GATE_DS = [
  TI_LS('SN74LS00'),
  { vendor: 'Nexperia', doc: '74HC00', rev: 'Rev. 11 — 29 Apr 2025', url: 'https://www.nexperia.com/datasheet/74HC00.pdf' },
];

export const CHIP_DEFS: ChipDef[] = [
  quadGate('7400', 'Quad 2-input NAND', 'NAND', ['LS', 'HC', 'HCT'], {
    datasheets: GATE_DS,
    gotchas: [
      'The workhorse gate. Y = NOT(A·B). NAND-only realizations of any SOP expression map directly to 7400/7410/7420 stock.',
      'LS→HC level mismatch applies (see Reference → Families).',
    ],
  }),
  {
    ...quadGate('7402', 'Quad 2-input NOR', 'NOR', ['LS', 'HC', 'HCT']),
    pins: [
      { num: 1, name: '1Y', dir: 'out' }, { num: 2, name: '1A', dir: 'in' }, { num: 3, name: '1B', dir: 'in' },
      { num: 4, name: '2Y', dir: 'out' }, { num: 5, name: '2A', dir: 'in' }, { num: 6, name: '2B', dir: 'in' },
      { num: 7, name: 'GND', dir: 'gnd' },
      { num: 8, name: '3A', dir: 'in' }, { num: 9, name: '3B', dir: 'in' }, { num: 10, name: '3Y', dir: 'out' },
      { num: 11, name: '4A', dir: 'in' }, { num: 12, name: '4B', dir: 'in' }, { num: 13, name: '4Y', dir: 'out' },
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn: 'NOR', inputs: [2, 3], output: 1 },
      { fn: 'NOR', inputs: [5, 6], output: 4 },
      { fn: 'NOR', inputs: [8, 9], output: 10 },
      { fn: 'NOR', inputs: [11, 12], output: 13 },
    ],
    datasheets: [TI_LS('SN74LS02'), { vendor: 'Nexperia', doc: '74HC02', rev: 'Rev. 8', url: 'https://www.nexperia.com/datasheet/74HC02.pdf' }],
    gotchas: [
      'CLASSIC GOTCHA: outputs are on pins 1/4/10/13, inputs follow them — not the 7400 layout. Swapping them shorts an output to an input.',
    ],
  },
  {
    ...quadGate('7404', 'Hex inverter (NOT)', 'NOT', ['LS', 'HC', 'HCT']),
    pins: [
      { num: 1, name: '1A', dir: 'in' }, { num: 2, name: '1Y', dir: 'out' },
      { num: 3, name: '2A', dir: 'in' }, { num: 4, name: '2Y', dir: 'out' },
      { num: 5, name: '3A', dir: 'in' }, { num: 6, name: '3Y', dir: 'out' },
      { num: 7, name: 'GND', dir: 'gnd' },
      { num: 8, name: '4Y', dir: 'out' }, { num: 9, name: '4A', dir: 'in' },
      { num: 10, name: '5Y', dir: 'out' }, { num: 11, name: '5A', dir: 'in' },
      { num: 12, name: '6Y', dir: 'out' }, { num: 13, name: '6A', dir: 'in' },
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn: 'NOT', inputs: [1], output: 2 },
      { fn: 'NOT', inputs: [3], output: 4 },
      { fn: 'NOT', inputs: [5], output: 6 },
      { fn: 'NOT', inputs: [9], output: 8 },
      { fn: 'NOT', inputs: [11], output: 10 },
      { fn: 'NOT', inputs: [13], output: 12 },
    ],
    datasheets: [TI_LS('SN74LS04'), { vendor: 'Nexperia', doc: '74HC04', rev: 'Rev. 7', url: 'https://www.nexperia.com/datasheet/74HC04.pdf' }],
    gotchas: ['Six inverters — handy for inverting SOP outputs for common-anode displays.'],
  },
  quadGate('7408', 'Quad 2-input AND', 'AND', ['LS', 'HC', 'HCT'], {
    datasheets: [TI_LS('SN74LS08'), { vendor: 'Nexperia', doc: '74HC08', rev: 'Rev. 7', url: 'https://www.nexperia.com/datasheet/74HC08.pdf' }],
    gotchas: ['Y = A·B. Same pinout as 7400.'],
  }),
  quadGate('7432', 'Quad 2-input OR', 'OR', ['LS', 'HC', 'HCT'], {
    datasheets: [TI_LS('SN74LS32'), { vendor: 'Nexperia', doc: '74HC32', rev: 'Rev. 6', url: 'https://www.nexperia.com/datasheet/74HC32.pdf' }],
    gotchas: ['Y = A+B. Same pinout as 7400.'],
  }),
  quadGate('7486', 'Quad 2-input XOR', 'XOR', ['LS', 'HC', 'HCT'], {
    datasheets: [TI_LS('SN74LS86'), { vendor: 'Nexperia', doc: '74HC86', rev: 'Rev. 6', url: 'https://www.nexperia.com/datasheet/74HC86.pdf' }],
    gotchas: ['Y = A⊕B. Adders and parity — also a programmable inverter (B=1 → Y=A̅).'],
  }),
  {
    ...quadGate('7410', 'Triple 3-input NAND', 'NAND', ['LS', 'HC', 'HCT']),
    pins: [
      { num: 1, name: '1A', dir: 'in' }, { num: 2, name: '1B', dir: 'in' },
      { num: 3, name: '2A', dir: 'in' }, { num: 4, name: '2B', dir: 'in' }, { num: 5, name: '2C', dir: 'in' }, { num: 6, name: '2Y', dir: 'out' },
      { num: 7, name: 'GND', dir: 'gnd' },
      { num: 8, name: '3Y', dir: 'out' }, { num: 9, name: '3A', dir: 'in' }, { num: 10, name: '3B', dir: 'in' }, { num: 11, name: '3C', dir: 'in' },
      { num: 12, name: '1Y', dir: 'out' }, { num: 13, name: '1C', dir: 'in' },
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn: 'NAND', inputs: [1, 2, 13], output: 12 },
      { fn: 'NAND', inputs: [3, 4, 5], output: 6 },
      { fn: 'NAND', inputs: [9, 10, 11], output: 8 },
    ],
    datasheets: [TI_LS('SN74LS10')],
    gotchas: ['Gate 1 output is on pin 12 with its third input on pin 13.'],
  },
  {
    ...quadGate('7411', 'Triple 3-input AND', 'AND', ['LS', 'HC', 'HCT']),
    pins: [
      { num: 1, name: '1A', dir: 'in' }, { num: 2, name: '1B', dir: 'in' },
      { num: 3, name: '2A', dir: 'in' }, { num: 4, name: '2B', dir: 'in' }, { num: 5, name: '2C', dir: 'in' }, { num: 6, name: '2Y', dir: 'out' },
      { num: 7, name: 'GND', dir: 'gnd' },
      { num: 8, name: '3Y', dir: 'out' }, { num: 9, name: '3A', dir: 'in' }, { num: 10, name: '3B', dir: 'in' }, { num: 11, name: '3C', dir: 'in' },
      { num: 12, name: '1Y', dir: 'out' }, { num: 13, name: '1C', dir: 'in' },
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn: 'AND', inputs: [1, 2, 13], output: 12 },
      { fn: 'AND', inputs: [3, 4, 5], output: 6 },
      { fn: 'AND', inputs: [9, 10, 11], output: 8 },
    ],
    datasheets: [TI_LS('SN74LS11')],
    gotchas: ['Gate 1 output is on pin 12 with its third input on pin 13.'],
  },
  {
    ...quadGate('7420', 'Dual 4-input NAND', 'NAND', ['LS', 'HC', 'HCT']),
    pins: [
      { num: 1, name: '1A', dir: 'in' }, { num: 2, name: '1B', dir: 'in' }, { num: 3, name: 'NC', dir: 'nc' },
      { num: 4, name: '1C', dir: 'in' }, { num: 5, name: '1D', dir: 'in' }, { num: 6, name: '1Y', dir: 'out' },
      { num: 7, name: 'GND', dir: 'gnd' },
      { num: 8, name: '2Y', dir: 'out' }, { num: 9, name: '2A', dir: 'in' }, { num: 10, name: '2B', dir: 'in' }, { num: 11, name: 'NC', dir: 'nc' },
      { num: 12, name: '2C', dir: 'in' }, { num: 13, name: '2D', dir: 'in' },
      { num: 14, name: 'VCC', dir: 'pwr' },
    ],
    units: [
      { fn: 'NAND', inputs: [1, 2, 4, 5], output: 6 },
      { fn: 'NAND', inputs: [9, 10, 12, 13], output: 8 },
    ],
    datasheets: [TI_LS('SN74LS20')],
    gotchas: ['Pins 3 and 11 are NC.'],
  },
  {
    ...quadGate('7414', 'Hex Schmitt-trigger inverter', 'NOT', ['LS', 'HC', 'HCT']),
    id: '7414',
    name: 'Hex Schmitt-trigger inverter',
    datasheets: [TI_LS('SN74LS14'), { vendor: 'Nexperia', doc: '74HC14', rev: 'Rev. 8', url: 'https://www.nexperia.com/datasheet/74HC14.pdf' }],
    gotchas: [
      'Use this between a switch/RC and any clock input: HC inputs need fast edges (74HC00 Δt/ΔV max 139 ns/V at VCC=4.5 V — Nexperia Rev. 11).',
      'Also the standard fix for bouncy switch inputs in counter labs.',
    ],
  },

  /* ---------------- 7-segment decoders ---------------- */

  {
    id: '7447',
    name: 'BCD to 7-segment decoder/driver — common ANODE, open-collector',
    families: ['LS'], package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'decoder',
    pins: [
      { num: 1, name: 'B', dir: 'in' }, { num: 2, name: 'C', dir: 'in' }, { num: 3, name: 'LT̅', dir: 'in', activeLow: true, role: 'lt' },
      { num: 4, name: 'BI/RBO', dir: 'io', activeLow: true, role: 'bi' }, { num: 5, name: 'RBI̅', dir: 'in', activeLow: true, role: 'rbi' },
      { num: 6, name: 'D', dir: 'in' }, { num: 7, name: 'A', dir: 'in' },
      { num: 8, name: 'GND', dir: 'gnd' },
      { num: 9, name: 'e', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 10, name: 'd', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 11, name: 'c', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 12, name: 'b', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 13, name: 'a', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 14, name: 'g', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 15, name: 'f', dir: 'out', activeLow: true, output: 'open-collector' },
      { num: 16, name: 'VCC', dir: 'pwr' },
    ],
    glyphs: {
      0: '1111110', 1: '0110000', 2: '1101101', 3: '1111001', 4: '0110011',
      5: '1011011', 6: '1011111', 7: '1110000', 8: '1111111', 9: '1111011',
      // Codes 10–14 produce "unique symbols" per TI (not blanks); 15 blanks.
      // Exact segment maps below are approximations — VERIFY against the
      // scanned TI/onsemi datasheet (see gotcha).
      10: '1101111', 11: '1111011', 12: '1011011', 13: '1111011', 14: '1011011', 15: '0000000',
    },
    glyphVerify: { 10: true, 11: true, 12: true, 13: true, 14: true },
    limits: { ioMaxmA: 24 },
    electrical: FAMILIES.LS,
    datasheets: [
      TI_LS('SN74LS47'),
      { vendor: 'onsemi (Motorola copy)', doc: 'SN74LS47/D — segment sink 24 mA, 15 V withstand', rev: 'Rev. 6', url: 'https://www.onsemi.com/pdf/datasheet/sn74ls47-d.pdf' },
      TI_SCBA,
    ],
    gotchas: [
      'PAIRS WITH COMMON-ANODE displays only. Outputs are open-collector, active-LOW: they SINK current — segment resistor goes between decoder pin and the CC side of the CA display.',
      'BI/RBO (pin 4) must be open or HIGH for normal digits; LOW blanks the display. LT (pin 3) LOW lights all 7 segments (lamp test).',
      'RBI (pin 5) LOW blanks a leading zero (only when code = 0) — leave HIGH or open for a single digit.',
      'One resistor PER SEGMENT. Never a single resistor on the common anode — brightness varies with digit.',
      'Inputs 10–15 show unique non-digit symbols per TI (not blanks) — the exact glyphs are flagged for bench verification in this library.',
      'Inputs float HIGH (LS) but tie them anyway.',
    ],
  },
  {
    id: '7448',
    name: 'BCD to 7-segment decoder — common CATHODE, active-HIGH, internal pull-ups',
    families: ['LS'], package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'decoder',
    pins: [
      { num: 1, name: 'B', dir: 'in' }, { num: 2, name: 'C', dir: 'in' }, { num: 3, name: 'LT̅', dir: 'in', activeLow: true, role: 'lt' },
      { num: 4, name: 'BI/RBO', dir: 'io', activeLow: true, role: 'bi' }, { num: 5, name: 'RBI̅', dir: 'in', activeLow: true, role: 'rbi' },
      { num: 6, name: 'D', dir: 'in' }, { num: 7, name: 'A', dir: 'in' },
      { num: 8, name: 'GND', dir: 'gnd' },
      { num: 9, name: 'e', dir: 'out', output: 'weak-pullup' },
      { num: 10, name: 'd', dir: 'out', output: 'weak-pullup' },
      { num: 11, name: 'c', dir: 'out', output: 'weak-pullup' },
      { num: 12, name: 'b', dir: 'out', output: 'weak-pullup' },
      { num: 13, name: 'a', dir: 'out', output: 'weak-pullup' },
      { num: 14, name: 'g', dir: 'out', output: 'weak-pullup' },
      { num: 15, name: 'f', dir: 'out', output: 'weak-pullup' },
      { num: 16, name: 'VCC', dir: 'pwr' },
    ],
    glyphs: {
      0: '1111110', 1: '0110000', 2: '1101101', 3: '1111001', 4: '0110011',
      5: '1011011', 6: '1011111', 7: '1110000', 8: '1111111', 9: '1111011',
      10: '1101111', 11: '1111011', 12: '1011011', 13: '1111011', 14: '1011011', 15: '0000000',
    },
    glyphVerify: { 10: true, 11: true, 12: true, 13: true, 14: true },
    limits: { ioMaxmA: 6.4 },
    electrical: FAMILIES.LS,
    datasheets: [
      TI_LS('SN74LS48'),
      { vendor: 'onsemi (Motorola copy)', doc: 'SN74LS48/D — IOH −100 µA, ≈−2 mA at VO=0.85 V, IOL 6 mA', rev: 'Rev. 7', url: 'https://www.onsemi.com/pdf/datasheet/sn74ls48-d.pdf' },
    ],
    gotchas: [
      'For COMMON-CATHODE displays, active-HIGH outputs with internal pull-ups ("eliminate need for external resistors").',
      'Drive is WEAK: about −2 mA at VO=0.85 V per the onsemi data — segments light but DIM. The often-quoted "2 kΩ pull-up" is unverified in primary sources.',
      'For bright common-cathode digits use the 74HC4511 instead.',
      'Same control pins as the 7447 (LT̅, BI/RBO, RBI̅).',
    ],
  },
  {
    id: '4511',
    name: 'BCD to 7-segment latch/decoder/driver — common CATHODE, 10 mA outputs',
    families: ['HC', 'HCT', 'CD4000'], package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'decoder',
    pins: [
      { num: 1, name: 'B', dir: 'in' }, { num: 2, name: 'C', dir: 'in' }, { num: 3, name: 'LT̅', dir: 'in', activeLow: true, role: 'lt' },
      { num: 4, name: 'BI̅', dir: 'in', activeLow: true, role: 'bi' }, { num: 5, name: 'LE', dir: 'in', role: 'le' },
      { num: 6, name: 'D', dir: 'in' }, { num: 7, name: 'A', dir: 'in' },
      { num: 8, name: 'GND', dir: 'gnd' },
      { num: 9, name: 'e', dir: 'out' }, { num: 10, name: 'd', dir: 'out' },
      { num: 11, name: 'c', dir: 'out' }, { num: 12, name: 'b', dir: 'out' },
      { num: 13, name: 'a', dir: 'out' }, { num: 14, name: 'g', dir: 'out' },
      { num: 15, name: 'f', dir: 'out' },
      { num: 16, name: 'VCC', dir: 'pwr' },
    ],
    glyphs: {
      0: '1111110', 1: '0110000', 2: '1101101', 3: '1111001', 4: '0110011',
      5: '1011011', 6: '0011111', 7: '1110000', 8: '1111111', 9: '1110011',
      10: '0000000', 11: '0000000', 12: '0000000', 13: '0000000', 14: '0000000', 15: '0000000',
    },
    limits: { iccMaxmA: 50, ioMaxmA: 25 },
    electrical: FAMILIES.HC,
    datasheets: [
      { vendor: 'Nexperia', doc: '74HC4511 — "Guaranteed 10 mA drive capability per output"; ICC abs max 50 mA', rev: 'Rev. 4 — 28 Mar 2024', url: 'https://www.nexperia.com/datasheet/74HC4511.pdf' },
      TI_SCBA,
    ],
    gotchas: [
      'For COMMON-CATHODE displays, active-HIGH push-pull outputs rated 10 mA — the bright, modern choice.',
      'LE (pin 5) LOW = transparent, HIGH = latched. BI̅ (pin 4) LOW = blank. LT̅ (pin 3) LOW = all segments on.',
      'Inputs 10–15 BLANK the display (unlike the 7447).',
      'Its 6 has no top segment and its 9 has no bottom segment (a=L for 6, d=L for 9 in the function table).',
      'Package current budget: 7 segments × 10 mA = 70 mA would exceed the 50 mA ICC abs max — the ERC computes the total; keep segment current ≈5–8 mA.',
      'Unused inputs (LE/LT̅/BI̅) must be tied — floating CMOS inputs cause excess current and oscillation.',
    ],
  },

  /* ---------------- Counters / decoder / shift register ---------------- */

  {
    id: '7490',
    name: 'Decade counter (÷2 + ÷5) — power on pins 5 & 10!',
    families: ['LS'], package: 'DIP14', power: { vcc: 5, gnd: 10 }, model: 'counter',
    pins: [
      { num: 1, name: 'CP1', dir: 'in', role: 'clock' }, { num: 2, name: 'MR1', dir: 'in', activeLow: false, role: 'reset' },
      { num: 3, name: 'MR2', dir: 'in', role: 'reset' }, { num: 4, name: 'NC', dir: 'nc' },
      { num: 5, name: 'VCC', dir: 'pwr' }, { num: 6, name: 'MS1', dir: 'in', role: 'set9' },
      { num: 7, name: 'MS2', dir: 'in', role: 'set9' },
      { num: 8, name: 'Q2', dir: 'out' }, { num: 9, name: 'Q1', dir: 'out' },
      { num: 10, name: 'GND', dir: 'gnd' }, { num: 11, name: 'Q3', dir: 'out' },
      { num: 12, name: 'Q0', dir: 'out' }, { num: 13, name: 'NC', dir: 'nc' },
      { num: 14, name: 'CP0', dir: 'in', role: 'clock' },
    ],
    electrical: FAMILIES.LS,
    datasheets: [
      { vendor: 'onsemi', doc: 'SN74LS90/D — "VCC = PIN 5 / GND = PIN 10"', rev: 'Rev. 6 — July 2006', url: 'https://www.onsemi.com/pdf/datasheet/sn74ls90-d.pdf' },
    ],
    gotchas: [
      'THE classic lab killer: power is VCC = PIN 5, GND = PIN 10 — NOT 14/7. The ERC special-cases this chip.',
      'BCD mode requires CP1 (pin 1) jumpered to Q0 (pin 12) externally.',
      'Both MR1+MR2 HIGH → reset to 0 (they are not internally grounded!). Ground at least one — in practice ground both.',
      'Both MS1+MS2 HIGH → set to 9 (overrides reset). Ground both when unused.',
      'Counts on the FALLING edge of CP0 (÷2 → Q0) and CP1 (÷5 → Q1..Q3).',
    ],
  },
  {
    id: '74138',
    name: '3-to-8 line decoder, active-LOW outputs, 3 enables',
    families: ['LS', 'HC', 'HCT'], package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'gates',
    pins: [
      { num: 1, name: 'A', dir: 'in' }, { num: 2, name: 'B', dir: 'in' }, { num: 3, name: 'C', dir: 'in' },
      { num: 4, name: 'G2A̅', dir: 'in', activeLow: true, role: 'enable' }, { num: 5, name: 'G2B̅', dir: 'in', activeLow: true, role: 'enable' },
      { num: 6, name: 'G1', dir: 'in', role: 'enable' },
      { num: 7, name: 'Y7̅', dir: 'out', activeLow: true },
      { num: 8, name: 'GND', dir: 'gnd' },
      { num: 9, name: 'Y6̅', dir: 'out', activeLow: true }, { num: 10, name: 'Y5̅', dir: 'out', activeLow: true },
      { num: 11, name: 'Y4̅', dir: 'out', activeLow: true }, { num: 12, name: 'Y3̅', dir: 'out', activeLow: true },
      { num: 13, name: 'Y2̅', dir: 'out', activeLow: true }, { num: 14, name: 'Y1̅', dir: 'out', activeLow: true },
      { num: 15, name: 'Y0̅', dir: 'out', activeLow: true },
      { num: 16, name: 'VCC', dir: 'pwr' },
    ],
    units: [],
    electrical: FAMILIES.LS,
    datasheets: [TI_LS('SN74LS138'), { vendor: 'Nexperia', doc: '74HC138', rev: 'Rev. 7', url: 'https://www.nexperia.com/datasheet/74HC138.pdf' }],
    gotchas: [
      'All three enables must be asserted (G1 HIGH, G2A̅ + G2B̅ LOW) or every output parks HIGH.',
      'Sim model treats it as a single 3→8 decode unit; pinout here is the standard one — cross-check the TI scanned datasheet before grading a build.',
    ],
  },

  /* ---------------- Reference-only chips (no sim model yet) ---------------- */

  {
    id: '74192', name: 'Synchronous Up/Down BCD counter (ref. only)', families: ['LS'],
    package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'none', refOnly: true,
    pins: Array.from({ length: 16 }, (_, i) => ({ num: i + 1, name: `pin${i + 1}`, dir: 'nc' as const })),
    electrical: FAMILIES.LS,
    datasheets: [TI_LS('SN74LS192')],
    gotchas: ['Pin details not yet verified in this build — check the TI datasheet before wiring. Simulation planned.'],
  },
  {
    id: '74193', name: 'Synchronous Up/Down 4-bit binary counter (ref. only)', families: ['LS'],
    package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'none', refOnly: true,
    pins: Array.from({ length: 16 }, (_, i) => ({ num: i + 1, name: `pin${i + 1}`, dir: 'nc' as const })),
    electrical: FAMILIES.LS,
    datasheets: [TI_LS('SN74LS193')],
    gotchas: ['Pin details not yet verified in this build — check the TI datasheet before wiring. Simulation planned.'],
  },
  {
    id: '74390', name: 'Dual decade counter (ref. only)', families: ['LS', 'HC'],
    package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'none', refOnly: true,
    pins: Array.from({ length: 16 }, (_, i) => ({ num: i + 1, name: `pin${i + 1}`, dir: 'nc' as const })),
    electrical: FAMILIES.LS,
    datasheets: [TI_LS('SN74LS390')],
    gotchas: ['Pin details not yet verified in this build — check the datasheet before wiring. Simulation planned.'],
  },
  {
    id: '74595', name: '8-bit shift register with output latches (ref. only)', families: ['HC', 'HCT'],
    package: 'DIP16', power: { vcc: 16, gnd: 8 }, model: 'none', refOnly: true,
    pins: Array.from({ length: 16 }, (_, i) => ({ num: i + 1, name: `pin${i + 1}`, dir: 'nc' as const })),
    limits: { iccMaxmA: 70, ioMaxmA: 35 },
    electrical: FAMILIES.HC,
    datasheets: [
      { vendor: 'Nexperia', doc: '74HC595 — Qn abs max ±35 mA but ICC/IGND abs max 70 mA package total; rated −6 mA at VCC=4.5 V', rev: 'Rev. 12 — 20 Mar 2024', url: 'https://www.nexperia.com/datasheet/74HC595.pdf' },
    ],
    gotchas: [
      'MR (pin 10) and OE̅ (pin 13) are active LOW; VCC = 16, GND = 8.',
      'Package budget: 8 LEDs × 20 mA = 160 mA violates the 70 mA ICC abs max — the ERC concept applies even though simulation is planned, not built.',
    ],
  },
  {
    id: '555', name: 'NE555 precision timer (ref. card — use the 555 clock module part in the simulator)',
    families: ['NE555'], package: 'DIP8', power: { vcc: 8, gnd: 1 }, model: 'none', refOnly: true,
    pins: [
      { num: 1, name: 'GND', dir: 'gnd' }, { num: 2, name: 'TRIG', dir: 'in' }, { num: 3, name: 'OUT', dir: 'out' },
      { num: 4, name: 'RESET̅', dir: 'in', activeLow: true, role: 'enable' }, { num: 5, name: 'CTRL', dir: 'in' },
      { num: 6, name: 'THRES', dir: 'in' }, { num: 7, name: 'DISCH', dir: 'out' }, { num: 8, name: 'VCC', dir: 'pwr' },
    ],
    electrical: FAMILIES.NE555,
    datasheets: [
      { vendor: 'Texas Instruments', doc: 'NE555 — VCC 4.5–16 V; astable f ≅ 1.44/((RA+2RB)·C); "connect RESET to VCC when not used"; output sinks/sources up to 200 mA', rev: 'SLFS022 (latest rev)', url: 'https://www.ti.com/lit/ds/symlink/ne555.pdf' },
    ],
    gotchas: [
      'Astable: f ≅ 1.44/((RA + 2RB)·C), tH ≅ 0.693(RA+RB)·C, tL ≅ 0.693·RB·C.',
      'RESET (pin 4) floats = chaos. Tie it to VCC.',
      'For the simulator, place the "555 clock module" part (3 terminals: V+, GND, OUT) — the bench module you would actually use in a lab.',
    ],
  },
];

/* ---------------- 7-segment display reference (plan §4.5) ---------------- */

export const SEG7_PINOUT: Record<number, string> = {
  1: 'e', 2: 'd', 3: 'com', 4: 'c', 5: 'dp', 6: 'b', 7: 'a', 8: 'com', 9: 'f', 10: 'g',
};

export const SEG7_GUIDE = {
  note: '5161AS = common cathode, 5161BS = common anode (by manufacturer convention; marketplace listings sometimes claim the opposite — verify with a multimeter in diode mode).',
  vf: 'Vf ≈ 1.8–2.1 V typical red (2.5–2.8 V max at 20 mA); continuous segment current max 20–30 mA.',
  resistors: 'One resistor per segment. 7447 (sinking): R = (5 − 2.0 − 0.4)/0.010 ≈ 260 Ω → 270–330 Ω. 4511 (sourcing): R = (4.2 − 2.0)/0.010 ≈ 220 Ω → 220–330 Ω.',
};

export const CHIP_INDEX: Map<string, ChipDef> = new Map(CHIP_DEFS.map((c) => [c.id, c]));

export function getChipDef(id: string | undefined): ChipDef | undefined {
  return id ? CHIP_INDEX.get(id) : undefined;
}

/** Segments a..g of the classic BCD K-map lab (plan §4.6), active-HIGH with tails on 6/9. */
export const CLASSIC_SEGMENT_EQUATIONS: Record<'a'|'b'|'c'|'d'|'e'|'f'|'g', (0|1|'X')[]> = (() => {
  const digitGlyphs: Record<number, string> = {
    0: '1111110', 1: '0110000', 2: '1101101', 3: '1111001', 4: '0110011',
    5: '1011011', 6: '1011111', 7: '1110000', 8: '1111111', 9: '1111011',
  };
  const segs: ('a'|'b'|'c'|'d'|'e'|'f'|'g')[] = ['a','b','c','d','e','f','g'];
  const out = {} as Record<'a'|'b'|'c'|'d'|'e'|'f'|'g', (0|1|'X')[]>;
  for (const [i, seg] of segs.entries()) {
    const cells: (0|1|'X')[] = [];
    for (let code = 0; code <= 15; code++) {
      if (code <= 9) cells.push(digitGlyphs[code][i] === '1' ? 1 : 0);
      else cells.push('X'); // don't-cares for 10–15
    }
    out[seg] = cells;
  }
  return out;
})();
