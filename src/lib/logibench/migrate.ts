import type {
  Breadboard, BoardKind, HoleRef, PartInstance, PartType, Project, RailLayout, RowName, Wire,
} from './types';
import { ALL_ROWS, BOARD_SPECS, boardDims, holeExists } from './geometry';

/**
 * Project sanitizer / migration (plan §8).
 *
 * Accepts a parsed project JSON of schema 1 or 2 and returns a clean schema-2
 * project, or null when the payload is not a project at all. Defensively
 * sanitizes every field (same philosophy as the kmap persist merge): unknown
 * boards/kinds fall back, hole keys outside a real board are dropped, parts
 * that lose structural pins are dropped entirely (their renders assume a full
 * footprint), and v1 `railsSplit` becomes v2 `railLayout`.
 *
 * Never throws. Returns counts so callers can surface what was dropped.
 */

export interface MigrationResult {
  project: Project;
  droppedParts: number;
  droppedWires: number;
}

const KINDS: readonly BoardKind[] = ['half400', 'full830'];
const LAYOUTS: readonly RailLayout[] = ['continuous', 'center-split', 'groups5'];
const PART_TYPES: readonly PartType[] = [
  'chip', 'resistor', 'led', 'seg7', 'switch', 'button', 'cap', 'supply', 'clock555',
];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/i;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Expected pin count per part type (mirrors geometry.pinCount). */
function expectedPins(type: PartType, defId: string | undefined): number {
  switch (type) {
    case 'chip': {
      const known: Record<string, number> = {
        '7400': 14, '7402': 14, '7404': 14, '7408': 14, '7432': 14,
        '7486': 14, '7410': 14, '7411': 14, '7420': 14, '7430': 14, '7414': 14,
        '7447': 16, '7448': 16, '4511': 16, '74138': 16,
        '7490': 14, '74192': 16, '74193': 16, '74390': 16,
        '74595': 16, '555': 8,
      };
      return defId ? (known[defId] ?? 14) : 14;
    }
    case 'seg7': return 10;
    case 'clock555': return 3;
    default: return 2;
  }
}

export function autoLayoutX(boards: Breadboard[], index: number): number {
  let x = 0;
  for (let i = 0; i < index; i++) {
    x += boardDims(boards[i]?.kind ?? 'half400').width + 80;
  }
  return x;
}

export function migrateProject(raw: unknown): MigrationResult | null {
  if (!isObj(raw)) return null;
  if (raw.schema !== 1 && raw.schema !== 2) return null;

  const name = str(raw.name, 120) ?? 'Untitled circuit';
  const notes = str(raw.notes, 2000) ?? '';

  /* ---- boards ---- */
  const boards: Breadboard[] = [];
  const boardIds = new Set<string>();
  const rawBoards = Array.isArray(raw.boards) ? raw.boards : [];
  for (const rb of rawBoards) {
    if (!isObj(rb) || boards.length >= 6) continue;
    let id = str(rb.id, 24) ?? '';
    if (!ID_RE.test(id) || boardIds.has(id)) id = `b${boards.length + 1}-${Date.now().toString(36).slice(-3)}`;
    const kind: BoardKind = KINDS.includes(rb.kind as BoardKind) ? (rb.kind as BoardKind) : 'half400';
    let railLayout: RailLayout;
    if (raw.schema === 1) {
      railLayout = rb.railsSplit === true ? 'center-split' : 'continuous';
    } else {
      railLayout = LAYOUTS.includes(rb.railLayout as RailLayout) ? (rb.railLayout as RailLayout) : 'continuous';
    }
    const label = str(rb.label, 24);
    const x = num(rb.x);
    const y = num(rb.y);
    boardIds.add(id);
    boards.push({
      id, kind, railLayout,
      ...(label ? { label } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
    });
  }
  if (boards.length === 0) {
    boards.push({ id: 'main', kind: 'half400', railLayout: 'continuous' });
    boardIds.add('main');
  }
  // default workbench positions for boards without one
  boards.forEach((b, i) => {
    if (b.x === undefined) b.x = autoLayoutX(boards, i);
    if (b.y === undefined) b.y = 0;
  });

  const colsOf = (boardId: string): number =>
    BOARD_SPECS[boards.find((b) => b.id === boardId)?.kind ?? 'half400'].cols;

  /** hole is structurally valid: known board, row on the board, col in range,
   *  and the tie-point physically exists (groups5 rail gaps are bare plastic) */
  const validHole = (h: unknown): h is HoleRef => {
    if (!isObj(h)) return false;
    const board = str(h.board, 24);
    const col = num(h.col);
    const row = h.row as RowName;
    if (
      board === undefined || !boardIds.has(board) ||
      col === undefined || !Number.isInteger(col) || col < 1 || col > colsOf(board) ||
      !(ALL_ROWS as readonly string[]).includes(row)
    ) return false;
    const b = boards.find((x) => x.id === board)!;
    return holeExists(b.kind, b.railLayout, row, col);
  };

  /* ---- parts ---- */
  const parts: PartInstance[] = [];
  const partIds = new Set<string>();
  let droppedParts = 0;
  const rawParts = Array.isArray(raw.parts) ? raw.parts : [];
  for (const rp of rawParts) {
    if (!isObj(rp)) { droppedParts++; continue; }
    const type = PART_TYPES.includes(rp.type as PartType) ? (rp.type as PartType) : null;
    if (!type) { droppedParts++; continue; }
    const defId = type === 'chip' ? (str(rp.defId, 16) ?? undefined) : undefined;
    const rawPins = Array.isArray(rp.pins) ? rp.pins : [];
    const pins = rawPins.filter(validHole);
    if (pins.length !== expectedPins(type, defId)) { droppedParts++; continue; }
    let id = str(rp.id, 32) ?? '';
    if (!ID_RE.test(id) || partIds.has(id)) id = `p${parts.length + 1}-${Date.now().toString(36).slice(-3)}`;
    partIds.add(id);

    const rp2 = rp.props;
    const props: PartInstance['props'] = {};
    if (isObj(rp2)) {
      const lbl = str(rp2.label, 40); if (lbl) props.label = lbl;
      const ohms = num(rp2.ohms); if (ohms !== undefined && ohms > 0) props.ohms = ohms;
      if (rp2.color === 'red' || rp2.color === 'green' || rp2.color === 'yellow' || rp2.color === 'blue') props.color = rp2.color;
      if (rp2.polarity === 'CA' || rp2.polarity === 'CC') props.polarity = rp2.polarity;
      if (typeof rp2.closed === 'boolean') props.closed = rp2.closed;
      const farads = num(rp2.farads); if (farads !== undefined && farads > 0) props.farads = farads;
      const volts = num(rp2.volts); if (volts !== undefined && volts > 0 && volts <= 24) props.volts = volts;
      const freqHz = num(rp2.freqHz); if (freqHz !== undefined && freqHz > 0) props.freqHz = freqHz;
      const duty = num(rp2.duty); if (duty !== undefined && duty >= 0 && duty <= 1) props.duty = duty;
      if (type === 'chip' && rp2.reversed === true) props.reversed = true;
    }
    const family = str(rp.family, 8);
    parts.push({
      id, type,
      ...(defId ? { defId } : {}),
      ...(family ? { family: family as PartInstance['family'] } : {}),
      pins, props,
    });
  }

  /* ---- wires ---- */
  const wires: Wire[] = [];
  let droppedWires = 0;
  const rawWires = Array.isArray(raw.wires) ? raw.wires : [];
  for (const rw of rawWires) {
    if (!isObj(rw)) { droppedWires++; continue; }
    if (!validHole(rw.from) || !validHole(rw.to)) { droppedWires++; continue; }
    let id = str(rw.id, 32) ?? '';
    if (!ID_RE.test(id) || partIds.has(id) || wires.some((w) => w.id === id)) {
      id = `w${wires.length + 1}-${Date.now().toString(36).slice(-3)}`;
    }
    const color = typeof rw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(rw.color) ? rw.color : '#27272a';
    // arc-height override (±60 px, signed) and normalized bend points
    const lift = num(rw.lift);
    const bends = Array.isArray(rw.bends)
      ? rw.bends
          .filter((bp: unknown) => isObj(bp) && num((bp as Record<string, unknown>).x) !== undefined && num((bp as Record<string, unknown>).y) !== undefined)
          .slice(0, 8)
          .map((bp: Record<string, unknown>) => ({
            x: Math.min(1, Math.max(0, num(bp.x)!)),
            y: Math.max(-200, Math.min(200, num(bp.y)!)),
          }))
      : undefined;
    wires.push({
      id, from: rw.from, to: rw.to, color,
      ...(lift !== undefined ? { lift } : {}),
      ...(bends && bends.length ? { bends } : {}),
    });
  }

  return {
    project: { schema: 2, name, boards, parts, wires, notes },
    droppedParts,
    droppedWires,
  };
}
