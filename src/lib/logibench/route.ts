import type { Breadboard, HoleRef, Project, RowName, Wire } from './types';
import type { BodyRect, Pt } from './geometry';
import {
  BOARD_SPECS, PITCH, ALL_ROWS, boardDims, chipBodyRects, colX, fromChordSpace,
  gapRouteBends, holeKey, liftSideFor, occupiedHoles, rowY, toChordSpace,
} from './geometry';

/**
 * Wire routing (docs/wire-auto-routing-plan.md).
 *
 * Pure functions only — the store and Inspector consume these; the canvas
 * never routes. Bend points live in CHORD SPACE (see geometry.toChordSpace):
 * x = fraction along from→to (0..1), y = px along the left normal, so routes
 * follow their endpoints when boards move.
 */

export type BendPt = { x: number; y: number };

/** What the router suggests for a from→to span. Arc suggestions carry an
 *  optional concrete lift (signed px; absent = leave the canvas fully auto). */
export type RouteSuggestion =
  | { kind: 'arc'; lift?: number }
  | { kind: 'bends'; bends: BendPt[]; route: 'gap' | 'auto' };

/** Workbench-space position of a hole (board offset + board-local 0.1" grid). */
export function holeWorkbenchPos(boards: Breadboard[], h: HoleRef): { x: number; y: number } {
  const b = boards.find((x) => x.id === h.board);
  const kind = b?.kind ?? 'half400';
  return { x: (b?.x ?? 0) + colX(kind, h.col), y: (b?.y ?? 0) + rowY(kind, h.row) };
}

/* ---------------- R7 — bend hygiene ---------------- */

/**
 * Clamp to the drag envelope (x∈[0,1], y∈[−200,200]), merge duplicates,
 * remove points that continue the previous direction (degenerate zig-zags)
 * and cap the route at 8 bends. Returns undefined when nothing survives —
 * callers treat that as "no route" (plain arc).
 *
 * `opts.dist` (chord length in px) sharpens the collinearity test by putting
 * the x fraction and the y offset into the same units; without it the test
 * only catches exact grid-aligned degeneracies.
 */
export function sanitizeBends(bends: BendPt[] | undefined, opts?: { dist?: number }): BendPt[] | undefined {
  if (!bends || bends.length === 0) return undefined;
  const clean: BendPt[] = [];
  for (const raw of bends) {
    if (typeof raw?.x !== 'number' || typeof raw?.y !== 'number' ||
        !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
    const p = { x: Math.min(1, Math.max(0, raw.x)), y: Math.max(-200, Math.min(200, raw.y)) };
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.004 && Math.abs(prev.y - p.y) < 0.5) continue;
    clean.push(p);
    if (clean.length >= 8) break;
  }
  const dx = opts?.dist !== undefined && opts.dist > 1 ? opts.dist : 1;
  for (let i = clean.length - 2; i >= 1; i--) {
    const ax = (clean[i].x - clean[i - 1].x) * dx;
    const ay = clean[i].y - clean[i - 1].y;
    const bx = (clean[i + 1].x - clean[i].x) * dx;
    const by = clean[i + 1].y - clean[i].y;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    if (Math.abs(cross) < 1 && dot > 0) clean.splice(i, 1);
  }
  return clean.length ? clean : undefined;
}

/* ---------------- R6 — route provenance ---------------- */

/**
 * Patch that keeps a wire's *computed* route consistent after its geometry
 * changed (board drag or re-termination). Manual wires ({}) keep their
 * chord-space bends as-is. 'gap' routes re-run gapRouteBends; 'auto' routes
 * re-run suggestRoute. When nothing sensible exists any more the wire
 * degrades to a plain arc.
 */
export function recomputeRoutePatch(w: Wire, project: Project): Partial<Wire> {
  if (w.route === 'gap') {
    if (w.from.board === w.to.board) return { bends: undefined, route: undefined };
    const sug = suggestRoute(project, w.from, w.to);
    return sug && sug.kind === 'bends' ? { bends: sug.bends, route: 'gap' } : { bends: undefined, route: undefined };
  }
  if (w.route === 'auto') {
    const sug = suggestRoute(project, w.from, w.to);
    if (!sug) return {};
    if (sug.kind === 'bends') return { bends: sug.bends, route: sug.route };
    return {
      bends: undefined,
      route: sug.lift !== undefined ? 'auto' : undefined,
      lift: sug.lift,
    };
  }
  return {};
}

/* ---------------- R1 — grid snap for manual bends ---------------- */

/**
 * Snap a manual bend to the board grid: the bend's workbench point locks onto
 * a hole column (±3 px) and a hole row center (±3 px), so hand-routes look
 * like real pre-bent jumpers on the 0.1" grid. Returns the input unchanged
 * when the point is not near a grid line or lies between boards.
 */
export function snapChordBend(c: BendPt, a: { x: number; y: number }, b: { x: number; y: number }, boards: Breadboard[]): BendPt {
  const p = fromChordSpace(a, b, c);
  const bd = boards.find((x) => p.x >= (x.x ?? 0) && p.x <= (x.x ?? 0) + boardDims(x.kind).width);
  if (!bd) return { ...c };
  const ox = bd.x ?? 0;
  const oy = bd.y ?? 0;
  const dims = boardDims(bd.kind);
  const lx = p.x - ox;
  const ly = p.y - oy;
  let sx = lx;
  let sy = ly;
  const col = Math.round((lx - dims.padX) / PITCH) + 1;
  if (col >= 1 && col <= BOARD_SPECS[bd.kind].cols && Math.abs(colX(bd.kind, col) - lx) <= 3) {
    sx = colX(bd.kind, col);
  }
  let bestRow: RowName | null = null;
  let bestDist = 3.001;
  for (const row of ALL_ROWS) {
    const d = Math.abs(rowY(bd.kind, row) - ly);
    if (d < bestDist) { bestDist = d; bestRow = row; }
  }
  if (bestRow) sy = rowY(bd.kind, bestRow);
  if (sx === lx && sy === ly) return { ...c };
  return toChordSpace(a, b, { x: ox + sx, y: oy + sy });
}

/* ---------------- R3 + R5 — the auto-router ---------------- */

const TOP_SIDE_ROWS: readonly string[] = ['+T', '-T', 'a', 'b', 'c', 'd', 'e'];
const PARALLEL_SIN = 0.14; // chords within ~8° count as parallel
const APEX_CLEAR = 9; // apexes closer than this crowd each other visually

const autoHeight = (dist: number, crossBoard: boolean): number => {
  let h = Math.min(46, Math.max(8, 6 + 0.35 * dist));
  if (crossBoard) h = Math.min(64, h + 14);
  return h;
};

/** Does the straight chord graze a body rect (pad px)? (mirrors geometry's private sampler) */
function chordHitsRect(a: Pt, b: Pt, r: BodyRect, pad: number): boolean {
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x >= r.x1 - pad && x <= r.x2 + pad && y >= r.y1 - pad && y <= r.y2 + pad) return true;
  }
  return false;
}

/** Does the actual quadratic arc (control offset h along the left normal) stay clear of the bodies? */
function quadClear(a: Pt, b: Pt, h: number, bodies: BodyRect[], pad = 2): boolean {
  if (bodies.length === 0) return true;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (b.y - a.y) / dist;
  const ny = -(b.x - a.x) / dist;
  const cx = (a.x + b.x) / 2 + nx * h;
  const cy = (a.y + b.y) / 2 + ny * h;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
    for (const r of bodies) {
      if (x >= r.x1 - pad && x <= r.x2 + pad && y >= r.y1 - pad && y <= r.y2 + pad) return false;
    }
  }
  return true;
}

/**
 * R3 — orthogonal L/Z route for a same-board span whose arcs cannot stay
 * clear of the chip band: run along the source row (or rail), cross the e/f
 * channel through a chip-free column, drop onto the destination row. Bend
 * waypoints land on hole centers; returns null whenever no clean route
 * exists (the caller falls back to today's arc — never ship something worse).
 */
function manhattanLZ(
  project: Project,
  board: Breadboard,
  from: HoleRef,
  to: HoleRef,
  a: Pt,
  b: Pt,
  bodies: BodyRect[],
): BendPt[] | null {
  const dims = boardDims(board.kind);
  const cols = BOARD_SPECS[board.kind].cols;
  const fromTop = TOP_SIDE_ROWS.includes(from.row);
  const toTop = TOP_SIDE_ROWS.includes(to.row);
  if (fromTop === toTop) return null; // same-side spans don't need a band crossing

  const blocked = new Set<number>();
  for (const r of bodies) {
    const c1 = Math.round((r.x1 - dims.padX) / PITCH) + 1;
    const c2 = Math.round((r.x2 - dims.padX) / PITCH) + 1;
    for (let c = Math.max(1, c1); c <= Math.min(cols, c2); c++) blocked.add(c);
  }

  // strip rows run on themselves; band rows escape one pitch; rails run on themselves
  const runRowFor = (row: RowName, top: boolean): RowName =>
    top ? (row === 'e' ? 'd' : row) : (row === 'f' ? 'g' : row);

  const occ = occupiedHoles(project.parts, project.wires);
  const P = (col: number, row: RowName): Pt => ({
    x: (board.x ?? 0) + colX(board.kind, col),
    y: (board.y ?? 0) + rowY(board.kind, row),
  });
  const tOf = (p: Pt): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    return d2 < 1 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
  };

  /** waypoints for one crossing column, or null when they project off-chord */
  const bendsFor = (crossCol: number): { pts: Pt[]; holes: HoleRef[] } | null => {
    const runT = runRowFor(from.row, true);
    const runB = runRowFor(to.row, false);
    const holes: HoleRef[] = [];
    const push = (col: number, row: RowName) => {
      holes.push({ board: board.id, col, row });
      return P(col, row);
    };
    const pts: Pt[] = [];
    if (runT !== from.row) pts.push(push(from.col, runT)); // escape hop from the band row
    pts.push(push(crossCol, runT)); // reach the crossing column
    pts.push(push(crossCol, runB)); // drop through the chip-free column
    if (runB !== to.row) pts.push(push(to.col, runB)); // approach the target column
    for (const p of pts) {
      const t = tOf(p);
      if (t < -0.001 || t > 1.001) return null; // chord space would clamp and corrupt
    }
    // drop waypoints that coincide with the endpoints or each other
    const out: Pt[] = [];
    for (const p of pts) {
      if (Math.hypot(p.x - a.x, p.y - a.y) < 1 || Math.hypot(p.x - b.x, p.y - b.y) < 1) continue;
      const prev = out[out.length - 1];
      if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1) continue;
      out.push(p);
    }
    return out.length ? { pts: out, holes } : null;
  };

  const bendsClean = (holes: HoleRef[]): boolean =>
    holes.every((h) => {
      const p = P(h.col, h.row);
      return !bodies.some((r) => p.x > r.x1 - 2 && p.x < r.x2 + 2 && p.y > r.y1 - 2 && p.y < r.y2 + 2);
    });

  const midCol = (from.col + to.col) / 2;
  const freeCols: number[] = [];
  for (let c = 1; c <= cols; c++) if (!blocked.has(c)) freeCols.push(c);
  // prefer bend holes nothing is plugged into, then the column nearest the chord midpoint
  freeCols.sort((c1, c2) => {
    const b1 = bendsFor(c1);
    const b2 = bendsFor(c2);
    const o1 = b1 ? Number(b1.holes.some((h) => occ.has(holeKey(h)))) : 2;
    const o2 = b2 ? Number(b2.holes.some((h) => occ.has(holeKey(h)))) : 2;
    return o1 - o2 || Math.abs(c1 - midCol) - Math.abs(c2 - midCol);
  });

  for (const c of freeCols) {
    const res = bendsFor(c);
    if (res && bendsClean(res.holes)) return res.pts.map((p) => toChordSpace(a, b, p));
  }
  return null;
}

/** R5 — arc apex of a wire (mid + normal·h/2), honoring lift or the auto side choice. */
function apexOf(project: Project, w: Wire): Pt | null {
  if (w.bends?.length || w.from.board !== w.to.board) return null;
  const board = project.boards.find((b) => b.id === w.from.board);
  if (!board) return null;
  const a = holeWorkbenchPos(project.boards, w.from);
  const b = holeWorkbenchPos(project.boards, w.to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1) return null;
  const bodies = chipBodyRects(project.parts, board);
  const hAuto = autoHeight(dist, false);
  const h = w.lift ?? hAuto * (liftSideFor(a, b, bodies) === -1 ? -1 : 1);
  const nx = (b.y - a.y) / dist;
  const ny = -(b.x - a.x) / dist;
  return { x: (a.x + b.x) / 2 + (nx * h) / 2, y: (a.y + b.y) / 2 + (ny * h) / 2 };
}

/** Apexes of near-parallel same-board arcs crowding `apex` (within APEX_CLEAR px). */
function crowdingApexes(project: Project, from: HoleRef, to: HoleRef, apex: Pt, excludeId?: string): Pt[] {
  const a = holeWorkbenchPos(project.boards, from);
  const b = holeWorkbenchPos(project.boards, to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1) return [];
  const d1 = { x: (b.x - a.x) / dist, y: (b.y - a.y) / dist };
  const out: Pt[] = [];
  for (const o of project.wires) {
    if (o.id === excludeId || o.bends?.length) continue;
    if (o.from.board !== from.board || o.to.board !== to.board) continue;
    if (o.from.board !== o.to.board) continue;
    const oa = holeWorkbenchPos(project.boards, o.from);
    const ob = holeWorkbenchPos(project.boards, o.to);
    const od = Math.hypot(ob.x - oa.x, ob.y - oa.y);
    if (od < 1) continue;
    const d2 = { x: (ob.x - oa.x) / od, y: (ob.y - oa.y) / od };
    if (Math.abs(d1.x * d2.y - d1.y * d2.x) > PARALLEL_SIN) continue;
    const oApex = apexOf(project, o);
    if (oApex && Math.hypot(oApex.x - apex.x, oApex.y - apex.y) < APEX_CLEAR) out.push(oApex);
  }
  return out;
}

/** R5 — lift rung for a new arc so its apex stays clear of the parallel bundle. */
function tieredLift(project: Project, from: HoleRef, to: HoleRef, h: number): number | undefined {
  const a = holeWorkbenchPos(project.boards, from);
  const b = holeWorkbenchPos(project.boards, to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1) return undefined;
  const nx = (b.y - a.y) / dist;
  const ny = -(b.x - a.x) / dist;
  const apexFor = (lift: number): Pt => ({
    x: (a.x + b.x) / 2 + (nx * lift) / 2,
    y: (a.y + b.y) / 2 + (ny * lift) / 2,
  });
  const crowd = crowdingApexes(project, from, to, apexFor(h));
  if (!crowd.length) return undefined;
  for (const d of [14, -14, 28, -28, 42, -42]) {
    const cand = Math.max(-60, Math.min(60, h + d));
    const ap = apexFor(cand);
    if (crowd.every((ca) => Math.hypot(ca.x - ap.x, ca.y - ap.y) >= APEX_CLEAR)) return cand;
  }
  return undefined;
}

/**
 * R5 — re-tier a whole parallel bundle in one deterministic stagger (explicit
 * Inspector action). Members are ranked along the seed chord and offset in
 * 14 px steps around their own auto height; bend routes and cross-board
 * jumpers never participate. Returns null when there is no bundle.
 */
export function decollideLifts(project: Project, id: string): { id: string; lift: number }[] | null {
  const seed = project.wires.find((x) => x.id === id);
  if (!seed || seed.bends?.length || seed.from.board !== seed.to.board) return null;
  const a = holeWorkbenchPos(project.boards, seed.from);
  const b = holeWorkbenchPos(project.boards, seed.to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < 1) return null;
  const d1 = { x: (b.x - a.x) / dist, y: (b.y - a.y) / dist };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const seedApex = apexOf(project, seed);
  if (!seedApex) return null;
  const members = project.wires.filter((o) => {
    if (o.bends?.length || o.from.board !== seed.from.board || o.to.board !== seed.to.board) return false;
    if (o.from.board !== o.to.board) return false;
    const oa = holeWorkbenchPos(project.boards, o.from);
    const ob = holeWorkbenchPos(project.boards, o.to);
    const od = Math.hypot(ob.x - oa.x, ob.y - oa.y);
    if (od < 1) return false;
    const d2 = { x: (ob.x - oa.x) / od, y: (ob.y - oa.y) / od };
    if (Math.abs(d1.x * d2.y - d1.y * d2.x) > PARALLEL_SIN) return false;
    const oApex = apexOf(project, o);
    return !!oApex && Math.hypot(oApex.x - seedApex.x, oApex.y - seedApex.y) < 3 * APEX_CLEAR;
  });
  if (members.length < 2) return null;
  const rankOf = (w: Wire): number => {
    const wa = holeWorkbenchPos(project.boards, w.from);
    const wb = holeWorkbenchPos(project.boards, w.to);
    return ((wa.x + wb.x) / 2 - mid.x) * d1.x + ((wa.y + wb.y) / 2 - mid.y) * d1.y;
  };
  const sorted = [...members].sort((u, v) => rankOf(u) - rankOf(v));
  const n = sorted.length;
  return sorted.map((w, rank) => {
    const wa = holeWorkbenchPos(project.boards, w.from);
    const wb = holeWorkbenchPos(project.boards, w.to);
    const wd = Math.hypot(wb.x - wa.x, wb.y - wa.y);
    const h = autoHeight(wd, false);
    const lift = Math.max(-60, Math.min(60, Math.round(h + (rank - (n - 1) / 2) * 14)));
    return { id: w.id, lift: lift === 0 ? 4 : lift };
  });
}

/**
 * R3 — the router. Cross-board spans with a gap route through it (Manhattan);
 * same-board spans that would graze a chip body get an L/Z through a chip-free
 * channel column; everything else stays an arc, tiered when it joins a
 * parallel bundle (R5). Never returns a route worse than today's auto arc.
 */
export function suggestRoute(project: Project, from: HoleRef, to: HoleRef): RouteSuggestion | null {
  const ba = project.boards.find((b) => b.id === from.board);
  const bb = project.boards.find((b) => b.id === to.board);
  if (!ba || !bb) return null;
  const a = holeWorkbenchPos(project.boards, from);
  const b = holeWorkbenchPos(project.boards, to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist < PITCH * 0.5) return null;

  if (from.board !== to.board) {
    const bends = gapRouteBends(project.boards, from, to);
    if (!bends) return { kind: 'arc' };
    const s = sanitizeBends(bends);
    // a same-row gap route collapses onto the chord — a plain arc is the better shape
    if (!s || !s.some((p) => Math.abs(p.y) >= 0.5)) return { kind: 'arc' };
    return { kind: 'bends', bends: s, route: 'gap' };
  }

  const bodies = chipBodyRects(project.parts, ba);
  const h = autoHeight(dist, false);
  const arcWithTier = (base: number): RouteSuggestion => {
    const lift = tieredLift(project, from, to, base);
    return lift !== undefined ? { kind: 'arc', lift } : { kind: 'arc' };
  };

  if (bodies.length === 0 || !bodies.some((r) => chordHitsRect(a, b, r, 2))) return arcWithTier(h);
  if (quadClear(a, b, h, bodies)) return arcWithTier(h);
  if (quadClear(a, b, -h, bodies)) return arcWithTier(-h);
  const lz = manhattanLZ(project, ba, from, to, a, b, bodies);
  if (lz && lz.length) return { kind: 'bends', bends: lz, route: 'auto' };
  return { kind: 'arc' }; // never worse than today
}
