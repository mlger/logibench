import type { Breadboard, HoleRef, Wire } from './types';
import { colX, gapRouteBends, rowY } from './geometry';

/**
 * Wire routing helpers (docs/wire-auto-routing-plan.md).
 *
 * Pure functions only — the store and Inspector consume these; the canvas
 * never routes. Bend points live in CHORD SPACE (see geometry.toChordSpace):
 * x = fraction along from→to (0..1), y = px along the left normal, so routes
 * follow their endpoints when boards move.
 */

export type BendPt = { x: number; y: number };

/** Workbench-space position of a hole (board offset + board-local 0.1" grid). */
export function holeWorkbenchPos(boards: Breadboard[], h: HoleRef): { x: number; y: number } {
  const b = boards.find((x) => x.id === h.board);
  const kind = b?.kind ?? 'half400';
  return { x: (b?.x ?? 0) + colX(kind, h.col), y: (b?.y ?? 0) + rowY(kind, h.row) };
}

/**
 * R7 — bend hygiene. Clamps to the drag envelope (x∈[0,1], y∈[−200,200]),
 * merges duplicates, removes points that continue the previous direction
 * (degenerate zig-zags) and caps the route at 8 bends. Returns undefined when
 * nothing survives — callers treat that as "no route" (plain arc).
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

/**
 * R6 — patch that keeps a wire's *computed* route consistent after its
 * geometry changed (board drag or re-termination). Manual wires ({}) keep
 * their chord-space bends as-is. 'gap' routes re-run gapRouteBends against
 * the current board positions; when the gap is gone (boards moved together)
 * or the wire became same-board, the wire degrades to a plain arc.
 */
export function recomputeRoutePatch(w: Wire, boards: Breadboard[]): Partial<Wire> {
  if (w.route !== 'gap') return {};
  if (w.from.board === w.to.board) return { bends: undefined, route: undefined };
  const bends = gapRouteBends(boards, w.from, w.to);
  return bends ? { bends } : { bends: undefined, route: undefined };
}
