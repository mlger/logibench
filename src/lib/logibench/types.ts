/**
 * LogicBench PH — core type definitions.
 * Adapted from the implementation plan §5.1 (datasheet-driven chip library,
 * breadboard project model, 4-state logic, inventory).
 * Engine-side types carry ZERO DOM dependencies.
 */

export type Family = 'LS' | 'HC' | 'HCT' | 'CD4000' | 'NE555' | 'generic';

/** 4-valued signal plus drive strength. */
export type Logic = 0 | 1 | 'Z' | 'X';
export type Strength = 'strong' | 'weak' | 'open';

export interface Drive {
  value: Logic;
  strength: Strength;
}

export interface FamilyElectrical {
  vih: number; // min input HIGH (V)
  vil: number; // max input LOW (V)
  voh: number; // min output HIGH (V)
  vol: number; // max output LOW (V)
  ioh: number; // max source current, negative (mA)
  iol: number; // max sink current (mA)
  iih: number; // input HIGH leakage (µA)
  iil: number; // input LOW current, negative (mA)
  /** HC inputs read X when floating; TTL (LS) floats HIGH. */
  floatReads: 0 | 1 | 'X';
  fanout: number; // LS loads it can drive
}

export type GateFn = 'NAND' | 'NOR' | 'NOT' | 'AND' | 'OR' | 'XOR' | 'BUF';

export interface GateUnit {
  fn: GateFn;
  inputs: number[]; // pin numbers
  output: number; // pin number
}

export type PinDir = 'in' | 'out' | 'io' | 'pwr' | 'gnd' | 'nc';
export type OutputKind = 'push-pull' | 'open-collector' | 'pullup-oc' | 'weak-pullup';

export interface PinDef {
  num: number;
  name: string;
  dir: PinDir;
  activeLow?: boolean;
  output?: OutputKind;
  /** For decoder control pins: role in the function table. */
  role?: 'lt' | 'bi' | 'rbi' | 'le' | 'reset' | 'set9' | 'clock' | 'enable';
}

export interface DatasheetRef {
  vendor: string;
  doc: string;
  rev: string;
  url: string;
}

export type ChipModelKind = 'gates' | 'decoder' | 'counter' | 'none';

export interface ChipDef {
  id: string; // "7447"
  name: string; // "BCD to 7-segment decoder/driver (CA, OC)"
  families: Family[];
  package: 'DIP8' | 'DIP14' | 'DIP16';
  pins: PinDef[]; // index = pin number - 1
  power: { vcc: number; gnd: number }; // 7490: 5 / 10
  model: ChipModelKind;
  units?: GateUnit[]; // gates model
  truthTable?: TruthRow[]; // documented function rows (docs + reference UI)
  glyphs?: Record<number, string>; // decoder: code -> "abcdefg" lit pattern ('1'=lit)
  /** true where glyph row is a "unique symbol" that must be bench-verified */
  glyphVerify?: Record<number, boolean>;
  electrical: FamilyElectrical;
  limits?: { iccMaxmA?: number; ioMaxmA?: number };
  datasheets: DatasheetRef[];
  gotchas: string[];
  /** reference-only chip: no simulation model yet */
  refOnly?: boolean;
}

export interface TruthRow {
  code: number; // 0..15 for decoders
  inputs?: Record<string, 0 | 1 | 'X'>;
  outputs: Record<string, 0 | 1 | 'X'>;
  note?: string;
}

/* ---------------- Breadboard project model ---------------- */

export type BoardKind = 'half400' | 'full830';
export type RowName =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j'
  | '+T' | '-T' | '+B' | '-B';

export interface HoleRef {
  board: string; // board id, "main"
  col: number; // 1-based
  row: RowName;
}

export interface Breadboard {
  id: string;
  kind: BoardKind;
  railsSplit: boolean; // rails broken in the middle
}

export type PartType =
  | 'chip'
  | 'resistor'
  | 'led'
  | 'seg7'
  | 'switch'
  | 'button'
  | 'cap'
  | 'supply'
  | 'clock555';

export interface PartInstance {
  id: string;
  type: PartType;
  /** chip def id, e.g. "7447" */
  defId?: string;
  family?: Family;
  /** ordered pin -> hole. For chips: pin number order. For 2-pin: [1st, 2nd]. */
  pins: HoleRef[];
  props: PartProps;
}

export interface PartProps {
  label?: string;
  // resistor
  ohms?: number;
  // led / seg7
  color?: 'red' | 'green' | 'yellow' | 'blue';
  polarity?: 'CA' | 'CC'; // seg7
  // switch / button
  closed?: boolean;
  // cap
  farads?: number;
  // supply
  volts?: number;
  // 555 module
  freqHz?: number;
  duty?: number;
}

export interface Wire {
  id: string;
  from: HoleRef;
  to: HoleRef;
  color: string; // hex
  bends?: { x: number; y: number }[]; // normalized bend points (future)
}

export interface Project {
  schema: 1;
  name: string;
  boards: Breadboard[];
  parts: PartInstance[];
  wires: Wire[];
  notes?: string;
}

/* ---------------- Inventory ---------------- */

export type Condition = 'new' | 'used' | 'suspect' | 'dead';

export interface InventoryItem {
  id: string;
  partNumber: string;
  base: string; // normalized, e.g. "7447"
  family: Family;
  package: string;
  qty: number;
  condition: Condition;
  location?: string;
  notes?: string;
}

/* ---------------- Netlist & simulation ---------------- */

export interface NetPin {
  partId: string;
  type: PartType;
  pin: number; // pin number (or 1/2 for two-terminal)
  pinName?: string;
  hole: HoleRef;
}

export interface Net {
  id: number;
  holes: string[]; // hole keys
  pins: NetPin[];
  isVccRail: boolean;
  isGndRail: boolean;
  /** resistors hanging between this net and others (netId -> ohms) */
  resistors: { net: number; ohms: number }[];
}

export type NetLevel = 0 | 1 | 'Z' | 'X' | 'conflict';

export interface SimIssue {
  id: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  why?: string; // datasheet-based explanation
  refs: { partId?: string; pin?: number; hole?: string }[];
}

export interface LedState {
  brightness: number; // 0..1
  currentMA?: number;
  noResistor?: boolean;
  overcurrent?: boolean;
}

export interface SegmentState {
  lit: boolean;
  brightness: number;
  noResistor?: boolean;
  overcurrent?: boolean;
}

export interface SimResult {
  netLevels: Map<number, NetLevel>;
  holeLevels: Map<string, NetLevel>;
  ledStates: Map<string, LedState>; // partId -> state
  segStates: Map<string, Record<string, SegmentState>>; // partId -> segment 'a'..'g','dp'
  poweredChips: Set<string>; // partId
  issues: SimIssue[];
  counterValues: Map<string, number>; // partId -> count (7490 etc.)
  clockHigh?: Map<string, boolean>;
}

/* ---------------- K-map lab ---------------- */

export interface KMapSpec {
  segment: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
  /** value for codes 0..15: 0, 1, or 'X' (don't care) */
  cells: (0 | 1 | 'X')[];
}

export interface MinTerm {
  /** implicant covering these minterm codes */
  cover: number[];
  mask: number; // bit set = variable eliminated
  sop: string; // e.g. "W·X̄·Z"
}
