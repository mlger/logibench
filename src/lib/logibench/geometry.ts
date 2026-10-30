import type { Breadboard, HoleRef, PartInstance, RailLayout, RowName } from './types';

/**
 * Breadboard geometry — single source of truth for both the SVG canvas and
 * placement validation. 0.1" grid rendered at PITCH px.
 */

export const PITCH = 16;

export const BOARD_SPECS: Record<
  Breadboard['kind'],
  { cols: number; label: string; tiePoints: number }
> = {
  half400: { cols: 30, label: 'Half-size (400 pt)', tiePoints: 400 },
  full830: { cols: 63, label: 'Full-size (830 pt)', tiePoints: 830 },
};

const ROWS_TOP: RowName[] = ['a', 'b', 'c', 'd', 'e'];
const ROWS_BOT: RowName[] = ['f', 'g', 'h', 'i', 'j'];
export const RAIL_ROWS: RowName[] = ['+T', '-T', '+B', '-B'];
export const ALL_ROWS: RowName[] = [...RAIL_ROWS, ...ROWS_TOP, ...ROWS_BOT];

/** Y offset of the channel between rows e and f, in px. */
export const CHANNEL_GAP = 12;

export function boardDims(kind: Breadboard['kind']) {
  const cols = BOARD_SPECS[kind].cols;
  const padX = 30;
  const padTop = 16;
  const padBottom = 16;
  // rails: +T, -T ; gap 14 ; a..e ; channel ; f..j ; gap 14 ; +B, -B
  const yPlusT = padTop;
  const yMinusT = padTop + PITCH;
  const yA = padTop + PITCH * 2 + 14;
  const yF = yA + PITCH * 5 + CHANNEL_GAP;
  const yPlusB = yF + PITCH * 5 + 14;
  const yMinusB = yPlusB + PITCH;
  const width = padX + cols * PITCH + 18;
  const height = yMinusB + PITCH - 6 + padBottom;
  return { cols, padX, padTop, width, height, yPlusT, yMinusT, yA, yF, yPlusB, yMinusB };
}

export function rowY(kind: Breadboard['kind'], row: RowName): number {
  const d = boardDims(kind);
  switch (row) {
    case '+T': return d.yPlusT;
    case '-T': return d.yMinusT;
    case '+B': return d.yPlusB;
    case '-B': return d.yMinusB;
    default: {
      const topRows: RowName[] = ['a', 'b', 'c', 'd', 'e'];
      const ti = topRows.indexOf(row);
      if (ti >= 0) return d.yA + ti * PITCH;
      const botRows: RowName[] = ['f', 'g', 'h', 'i', 'j'];
      return d.yF + (botRows.indexOf(row)) * PITCH;
    }
  }
}

export function colX(kind: Breadboard['kind'], col: number): number {
  return boardDims(kind).padX + (col - 1) * PITCH;
}

export function isRailRow(row: RowName): boolean {
  return (RAIL_ROWS as string[]).includes(row);
}

/* ---------------- Rail groups ("full-plus" realism) ---------------- */

export interface ColSpan {
  start: number; // 1-based, inclusive
  end: number; // inclusive
}

/**
 * Contiguous tied column ranges of ONE rail line.
 * line 0 = the '+' row of a side (+T/+B), line 1 = the '−' row (−T/−B).
 *
 * groups5: 5 tied holes, 2-hole gap, period 7 — matching the full-plus
 * reference photo; the two lines of a side are staggered by 3 columns so the
 * gaps of one line align with the holes of the other. Gap columns have NO
 * holes at all (see holeExists).
 */
export function railGroups(kind: Breadboard['kind'], layout: RailLayout, line: 0 | 1): ColSpan[] {
  const cols = BOARD_SPECS[kind].cols;
  if (layout === 'continuous') return [{ start: 1, end: cols }];
  if (layout === 'center-split') {
    const mid = Math.ceil(cols / 2);
    return [
      { start: 1, end: mid },
      { start: mid + 1, end: cols },
    ];
  }
  const first = line === 0 ? 2 : 5;
  const groups: ColSpan[] = [];
  for (let s = first; s + 4 <= cols; s += 7) groups.push({ start: s, end: s + 4 });
  return groups;
}

function railLineOf(row: RowName): 0 | 1 {
  return row === '+T' || row === '+B' ? 0 : 1;
}

/**
 * Does a tie-point hole physically exist at (row, col)?
 * With groups5 rails, the 2-hole gaps are bare plastic — nothing can be
 * plugged there.
 */
export function holeExists(kind: Breadboard['kind'], layout: RailLayout, row: RowName, col: number): boolean {
  if (!isRailRow(row)) return true;
  if (layout !== 'groups5') return true;
  return railGroups(kind, layout, railLineOf(row)).some((g) => col >= g.start && col <= g.end);
}

/**
 * Inverse mapping: board-space coordinates (px, after pan/zoom removal) to the
 * nearest tie-point hole. Returns null when the point is off the board or not
 * close to any hole row. Used by drag-and-drop drop targeting.
 */
export function nearestHole(
  kind: Breadboard['kind'],
  layout: RailLayout,
  x: number,
  y: number,
  board: string,
): HoleRef | null {
  const d = boardDims(kind);
  const spec = BOARD_SPECS[kind];
  const col = Math.round((x - d.padX) / PITCH) + 1;
  if (col < 1 || col > spec.cols) return null;
  // rows sorted by vertical distance; pick the nearest one that exists
  // (groups5 rail gaps are bare plastic — snap past them)
  const byDist = [...ALL_ROWS].sort(
    (a, b) => Math.abs(rowY(kind, a) - y) - Math.abs(rowY(kind, b) - y),
  );
  for (const row of byDist) {
    if (Math.abs(rowY(kind, row) - y) > PITCH * 0.75) return null;
    if (holeExists(kind, layout, row, col)) return { board, col, row };
  }
  return null;
}

/** Which rail line does a chip DIP pin column sit near? (for quick auto-wiring UI hints) */
export function holeKey(h: HoleRef): string {
  return `${h.board}:${h.col}:${h.row}`;
}

export function parseHoleKey(key: string): HoleRef {
  const [board, col, row] = key.split(':');
  return { board, col: Number(col), row: row as RowName };
}

export function sameHole(a: HoleRef, b: HoleRef): boolean {
  return a.board === b.board && a.col === b.col && a.row === b.row;
}

/* ---------------- Footprints ---------------- */

export interface Footprint {
  /** pins in order: pin number -> hole offset */
  spans: number; // columns occupied
  pinAt: (col0: number, pin: number) => HoleRef | null;
}

export function chipFootprint(pkg: 'DIP8' | 'DIP14' | 'DIP16', board: string): Footprint {
  const perSide = pkg === 'DIP8' ? 4 : pkg === 'DIP14' ? 7 : 8;
  return {
    spans: perSide,
    pinAt(col0: number, pin: number) {
      if (pin >= 1 && pin <= perSide) return { board, col: col0 + pin - 1, row: 'e' };
      if (pin > perSide && pin <= perSide * 2)
        return { board, col: col0 + perSide * 2 - pin, row: 'f' };
      return null;
    },
  };
}

export function seg7Footprint(board: string): Footprint {
  return {
    spans: 5,
    pinAt(col0: number, pin: number) {
      if (pin >= 1 && pin <= 5) return { board, col: col0 + pin - 1, row: 'e' };
      if (pin >= 6 && pin <= 10) return { board, col: col0 + 10 - pin, row: 'f' };
      return null;
    },
  };
}

export function twoPinFootprint(): Footprint {
  return { spans: 1, pinAt: () => null }; // free placement, holes chosen explicitly
}

export function partFootprint(part: PartInstance): Footprint {
  const board = part.pins[0]?.board ?? 'main';
  if (part.type === 'chip' && part.defId) {
    const pkg = chipPackage(part.defId);
    return chipFootprint(pkg, board);
  }
  if (part.type === 'seg7') return seg7Footprint(board);
  return twoPinFootprint();
}

export function chipPackage(defId: string): 'DIP8' | 'DIP14' | 'DIP16' {
  // imported lazily to avoid cycle: chips.ts has no geometry import
  // but we need package; duplicate a tiny lookup via static map.
  const known: Record<string, 'DIP8' | 'DIP14' | 'DIP16'> = {
    '7400': 'DIP14', '7402': 'DIP14', '7404': 'DIP14', '7408': 'DIP14', '7432': 'DIP14',
    '7486': 'DIP14', '7410': 'DIP14', '7411': 'DIP14', '7420': 'DIP14', '7430': 'DIP14', '7414': 'DIP14',
    '7447': 'DIP16', '7448': 'DIP16', '4511': 'DIP16', '74138': 'DIP16',
    '7490': 'DIP14', '74192': 'DIP16', '74193': 'DIP16', '74390': 'DIP16',
    '74595': 'DIP16', '555': 'DIP8',
  };
  return known[defId] ?? 'DIP14';
}

/** Pin count per part type (for placement hole-picking flow). */
export function pinCount(part: Omit<PartInstance, 'pins' | 'id'>): number {
  switch (part.type) {
    case 'chip': {
      const pkg = chipPackage(part.defId ?? '7400');
      return pkg === 'DIP8' ? 8 : pkg === 'DIP14' ? 14 : 16;
    }
    case 'seg7': return 10;
    case 'clock555': return 3;
    case 'supply': return 2;
    default: return 2;
  }
}

/* ---------------- Placement validation ---------------- */

export interface Occupancy {
  /** holeKey -> partId */
  map: Map<string, string>;
}

export function buildOccupancy(parts: PartInstance[]): Occupancy {
  const map = new Map<string, string>();
  for (const p of parts) {
    for (const h of p.pins) {
      const k = holeKey(h);
      map.set(k, p.id);
    }
  }
  return { map };
}

export interface PlacementCheck {
  ok: boolean
  reason?: string;
  holes?: HoleRef[];
}

/**
 * Validate a multi-pin part placement anchored at top-left column col0.
 * Chip/display must straddle the channel (pins land in rows e and f) and all
 * holes must be free.
 */
export function checkPlacement(
  kind: Breadboard['kind'],
  parts: PartInstance[],
  type: PartInstance['type'],
  defId: string | undefined,
  col0: number,
  board: string,
): PlacementCheck {
  const spec = BOARD_SPECS[kind];
  let fp: Footprint;
  if (type === 'chip' && defId) fp = chipFootprint(chipPackage(defId), board);
  else if (type === 'seg7') fp = seg7Footprint(board);
  else return { ok: true };

  if (col0 < 1 || col0 + fp.spans - 1 > spec.cols) {
    return { ok: false, reason: `${fp.spans} columns needed — does not fit here` };
  }
  const occ = buildOccupancy(parts);
  const holes: HoleRef[] = [];
  const pinTotal = fp.spans * 2;
  for (let pin = 1; pin <= pinTotal; pin++) {
    const h = fp.pinAt(col0, pin);
    if (!h) continue;
    const k = holeKey(h);
    if (occ.map.has(k)) {
      return { ok: false, reason: 'Hole occupied by another part' };
    }
    holes.push(h);
  }
  return { ok: true, holes };
}

/** Part display name for palette/BOM. */
export function partLabel(part: PartInstance): string {
  switch (part.type) {
    case 'chip': return part.defId ?? 'chip';
    case 'resistor': return `${part.props.ohms ?? 330} Ω`;
    case 'led': return `LED (${part.props.color ?? 'red'})`;
    case 'seg7': return `5161${part.props.polarity === 'CA' ? 'BS (CA)' : 'AS (CC)'}`;
    case 'switch': return 'SPST switch';
    case 'button': return 'Pushbutton';
    case 'cap': return `${((part.props.farads ?? 1e-7) * 1e9).toFixed(0)} nF`;
    case 'supply': return `${part.props.volts ?? 5} V supply`;
    case 'clock555': return '555 clock module';
  }
}

/* ---------------- Wire routing (jumper arcs) ---------------- */

export interface ArcPath {
  d: string;
  /** apex point of the quadratic curve (handle anchor) */
  apex: { x: number; y: number };
  /** effective signed lift (px); positive bows left of from→to */
  h: number;
}

/**
 * Jumper-wire path: a quadratic arc that lifts off the board, magnitude
 * scaled by span (short hops stay flat, long jumpers arch higher).
 * `lift` overrides the auto height; its sign picks the bow side.
 * Cross-board spans (feature: multi-board) arch a bit higher.
 */
export function wireArc(
  a: { x: number; y: number },
  b: { x: number; y: number },
  opts?: { lift?: number; crossBoard?: boolean },
): ArcPath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, apex: { ...a }, h: 0 };
  }
  let h = Math.min(46, Math.max(8, 6 + 0.35 * dist));
  if (opts?.crossBoard) h = Math.min(64, h + 14);
  if (opts?.lift !== undefined) h = Math.max(-60, Math.min(60, opts.lift));
  // left normal of the from→to direction (screen space: bows up for L→R wires)
  const nx = dy / dist;
  const ny = -dx / dist;
  const cx = (a.x + b.x) / 2 + nx * h;
  const cy = (a.y + b.y) / 2 + ny * h;
  return {
    d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
    apex: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
    h,
  };
}

/**
 * Every hole that currently holds a lead (part pin or wire end).
 * A real tie-point accepts exactly one lead — placement, moves and new wire
 * endpoints must land on holes outside this set.
 */
export function occupiedHoles(parts: PartInstance[], wires: { from: HoleRef; to: HoleRef }[], excludePartId?: string): Set<string> {
  const s = new Set<string>();
  for (const p of parts) {
    if (p.id === excludePartId) continue;
    for (const h of p.pins) s.add(holeKey(h));
  }
  for (const w of wires) {
    s.add(holeKey(w.from));
    s.add(holeKey(w.to));
  }
  return s;
}
