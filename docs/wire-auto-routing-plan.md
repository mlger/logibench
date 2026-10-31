# Wire auto-routing & auto-bending — code analysis + proposal

Status: **plan only, not implemented** (per user request).
Scope: `Wire { from, to, color, lift?, bends? }` rendering/routing UX. **Zero changes to the
netlist, simulator, or ERC** — `bends` is visual-only (verified: `netlist.ts:84-86` unions only
`w.from`/`w.to`). Line refs are HEAD `6cb128f`.

---

## 1. What exists today (routing/bending inventory)

| Capability | Where | Behavior |
|---|---|---|
| Auto arc | `geometry.ts:462-487` `wireArc` | quadratic `M a Q c b`; auto height `h = min(46, max(8, 6 + 0.35·dist))`, +14 for cross-board (cap 64); `lift` override clamps to ±60; `sign` flips bow side |
| Auto lift-side | `geometry.ts:373-391` `liftSideFor` | samples the **straight chord** at 17 pts vs chip/seg7 body rects (`chipBodyRects`, pad 2 px); if the default apex (0.7·h along the left normal, pad 4 px) hits a body and the mirrored apex is clear → return `-1`. **1-bit answer**: flip side or nothing. Never adapts height. Canvas applies it only when `lift` is unset and there are no bends (`BreadboardCanvas.tsx:632-634`) |
| Manhattan bends | `types.ts:166-177`, `BreadboardCanvas.tsx:637-641` | `Wire.bends` = waypoints in **chord space** (`{x: 0..1 along a→b, y: px along left normal}`, `toChordSpace`/`fromChordSpace` `geometry.ts:398-419`) so routes follow the endpoints when boards move. Renders as polyline when set; `lift` ignored |
| Bend dragging | `BreadboardCanvas.tsx:118-146` | per-bend handles (r 6) when selected **and** bends already exist; clamps x∈[0,1], y∈[−200,200] on commit |
| Cross-board via-gap | `geometry.ts:426-452` `gapRouteBends` | two chord-space bends dropping through the vertical gap between boards; `null` when boards touch. Only way to get bends today (Inspector "Via gap", `Inspector.tsx:204-229`) |
| Auto power wiring | `autowire.ts` | endpoint picker only (free hole in the pin's strip → nearest free rail hole, auto rail bridge) — no path/bend generation |
| Demo tiering | `demo.ts:157-163` | Lab 2 teal bundle hand-tuned `lift` 30 / 16 / 4 / −18 so the crossing-by-pinout jumpers stay readable |
| Wire rubber band | `BreadboardCanvas.tsx:876-908` `WireDragLayer` | always previews an **arc**, dashed — never bends, never the route that will actually be committed |
| Re-termination | `BreadboardCanvas.tsx:186-208` | drag a wire-end handle to a free hole; stored bends are left untouched |

## 2. Gap analysis (what "auto" is missing, with evidence)

- **G1 — bends are unreachable by hand.** Bend handles render only when `hasBends`
  (`BreadboardCanvas.tsx:679-692`); the only bends creator is the cross-board "Via gap"
  button. A same-board wire can never gain a bend: no add gesture, no Inspector control.
- **G2 — preview ≠ product.** The rubber band always shows an arc; if drop-time auto-routing
  or `Via gap` later turns the wire into a polyline, the user saw something different from
  what they got.
- **G3 — no bundle de-collide.** Auto height varies only with span length: two same-length
  parallel wires get **identical apexes** and stack into one illegible strap. The Lab 2 tiering
  is hand-tuned demo data, not a behavior; user-built bundles get no help.
- **G4 — lift-side chooser is minimal.** `liftSideFor` samples the chord (not the actual
  quadratic), answers only "flip or not", never scales height to clear a taller body, and is
  skipped for cross-board wires entirely.
- **G5 — gap routes drift when boards move.** `gapRouteBends` freezes workbench geometry into
  chord-space fractions at route time. `moveBoard` (`projectStore.ts:538-543`) changes the
  chord; `fromChordSpace` re-projects bends *proportionally*, so the "vertical leg through the
  gap" silently stops sitting in the gap.
- **G6 — no obstacle-aware routing.** A long same-board span that must cross the e/f chip band
  or the channel gets at best a side-flip. Real breadboarding solves this with pre-bent
  jumpers routed through free rows — the app has no equivalent (no L/Z route suggestion, no
  "auto route" action).
- **G7 — store accepts any bends.** `updateWire` (`projectStore.ts:306-311`) is
  `Object.assign` — no clamping, dedupe, collinear cleanup, or count cap (only the drag path
  clamps). `loadProject`/`migrate` equally tolerant of junk.
- **G8 — re-termination distorts stored routes.** Moving an endpoint keeps chord-space bends
  as-is: a gap route's vertical legs go oblique; a manual route can degenerate to collinear
  noise that still suppresses the arc.
- **G9 — bend handles are pointer-only.** The lift handle has `role="slider"` + arrow keys
  (`BreadboardCanvas.tsx:656-678`); bend handles have neither, so keyboard users can't route.
- **G10 — no snap.** Bends live at free px (clamped only), so hand routes look off-grid on a
  0.1" board where everything else snaps to `PITCH`.

## 3. Proposals (independent, recommended order R7 → R1 → R2 → R3 → R5 → R4 → R6 → R8)

Shared architecture: one new pure module **`src/lib/logibench/route.ts`** exporting
`suggestRoute(project, from, to): Suggestion | null` where
`Suggestion = { kind: 'arc'; lift?: number; sign?: -1 | 1 } | { kind: 'bends'; bends: {x,y}[] }`.
The store's `addWire` and the Inspector consume it; the canvas never routes. Pure + cacheable
per project revision (same pattern as `buildNetlistCached`).

**R7 — Store hygiene (groundwork, S).** `sanitizeBends(bends)`: clamp x∈[0,1] y∈[−200,200],
drop duplicates/near-collinear points, cap at 8, drop the field entirely when < 2 survive.
Call it in `updateWire` and `migrateProject`. Makes every later proposal safe to feed junk
into. No UX change.

**R1 — Bend editing basics (S).** Make bends reachable: (a) double-click a selected wire's
mid-span inserts a bend at that point (listen on the 11 px click path — holes keep priority by
construction); (b) dragging an inserted bend works with the existing `beginBendDrag`;
(c) double-click a bend handle (or drag it onto the chord, < 4 px) removes it — last removal
returns the wire to `Plain arc`; (d) snap `y` to `PITCH/2` and `x` so the bend sits on a hole
column when close (≤ 3 px). Alt: also offer "Add bend" / "Clear bends" buttons next to the
existing "Via gap" row for touch users.

**R2 — Honest preview + route-at-drop (S–M).** `WireDragLayer` calls `suggestRoute` against a
ghost project `{...project, wires: []}` while dragging and previews the *real* result (arc or
dashed polyline + bend dots). On drop, `addWire` applies the suggestion behind the existing
`autoColor`-style toggle (new `autoRoute`, default on for cross-board, opt-in same-board
until R4 lands). Invariant: suggestion must never change *endpoints* — occupied/rail-gap
rejection stays exactly as-is.

**R3 — Heuristic same-board router (M).** Decision tree inside `suggestRoute`:
1. cross-board + gap → `gapRouteBends` (existing);
2. span crosses a chip/seg7 body band or the channel → attempt an L/Z Manhattan route:
   leave the source strip vertically, run along a free row, cross the channel through a
   column not covered by any `chipBodyRects` entry, drop into the destination strip. Bend
   waypoints snapped to hole centers (real pre-bent jumper look), stored in chord space;
3. near-parallel to an existing wire with overlapping apexes → arc + tiered `lift` (R5);
4. else → `wireArc` auto (with `liftSideFor`).
Reject to plain arc whenever the Manhattan attempt needs > 2 turns or collides with a body —
never ship a worse route than today's arc.

**R4 — Obstacle-aware A\* (M–L, optional tier above R3).** Graph over the hole grid per board
(`holeExists` nodes, 4-neighbors): hard-blocked = chip/seg7 body rects (a polyline over a chip
body reads wrong); soft costs = per-turn penalty + overlap with existing wire chords (reuse
`chordHitsRect`-style sampling) + occupied-hole cost (soft: arcs already fly over holes, but
bends through them look unpluggable). Waypoints → hole centers → chord space. Exposed as an
Inspector "Auto route" button per wire and used by R3 as fallback. Trivial scale: ≤ 63·14·6
nodes; cap expansions, cache per revision. Runs never on pointer-move.

**R5 — Auto tiering of bundles (M).** Detection: wires whose endpoints share rows/strips and
whose chords are near-parallel with apex distance < 6 px. For a *new* wire joining such a
group, assign the next free rung of a lift ladder (demo's 4 / 16 / 30 / −18 ladder is the
calibration). Never rewrites existing wires implicitly; an explicit Inspector "De-collide
bundle" action may re-rung the whole group in one `commit`. User-set `lift` always wins.

**R6 — Route provenance + recompute (S).** Optional additive field `Wire.route?: 'gap' |
'auto'` (absent = manual). `moveBoard` recomputes `route === 'gap'` wires through
`gapRouteBends` (fixes G5); re-termination recomputes any non-manual route (fixes G8's
distortion) and degenerates → arc. `migrateProject` treats the field as optional — schema 2
unchanged.

**R8 — Bend a11y (S).** Give bend handles `role="slider"` + `aria-valuenow`, arrow-key nudges
in `PITCH/2` steps, Delete removes the bend — parity with the lift handle (`BreadboardCanvas.tsx:656-678`).

## 4. Rejected alternatives

- **Auto-reroute everything on every edit** — churns deliberate layouts; routing only new
  wires + explicit actions respects user intent.
- **Spline/Catmull-Rom smoothing of bends** — off-brand: real jumpers are arcs or crisp
  pre-bent 90° legs; `strokeLinejoin="round"` on the polyline already softens corners enough.
- **Bends as electrical junctions (T-connections)** — would change the netlist union-find
  model; explicitly out of scope, wires stay 2-terminal.
- **Hard-blocking occupied holes in the router** — arcs legitimately fly over holes today;
  forbidding it makes dense boards unroutable. Soft cost only; only chip bodies hard-block.
- **Absolute-px bends** — breaks route-follows-board semantics; chord space is correct.

## 5. Invariants that must keep holding

1. Netlist/sim/ERC bit-identical: routers are pure, visual-only, never touch `from`/`to`.
2. Hole click priority: add-bend gesture lives on the wire's 11 px path only; the 14×14 hole
   hit rects stay above (post `0bff697` layering untouched).
3. Endpoint validation unchanged: occupancy + rail-gap rejection messages exactly as today.
4. Undo/redo: every suggestion application is one `commit()` (single undo step).
5. Old projects (no `bends`, no `route`) load and render unchanged.
6. Perf: `suggestRoute` cached per project revision; no routing inside pointer-move handlers
   (preview uses the cached suggestion, recomputed on drag start).
7. Demos render identically unless an explicit action (R5 de-collide) is invoked.

## 6. Verification plan (when implemented)

1. `bun run lint`; `bun run audit` still clean.
2. Browser E2E (agent-browser):
   - Lab 1: double-click a wire → bend appears at hole-snapped point; drag it; delete it →
     back to arc; hole under a bend still wins clicks.
   - Lab 3: drag a board → gap-route jumpers re-route through the new gap (R6); re-terminate
     a gap wire → legs stay vertical.
   - New wire across a chip band (e.g. col 3 → col 26 on Lab 1) → L/Z preview matches the
     committed polyline (R2/R3); drop works, undo restores.
   - Parallel bundle: draw 3 same-length parallel wires → distinct apex heights (R5).
   - Keyboard: select wire, arrow-keys move a bend; Delete removes it (R8).
3. `dev.log` clean after the pass.

## 7. Effort & risk

| Item | Effort | Risk |
|---|---|---|
| R7 hygiene | S (½ h) | none |
| R1 bend editing | S–M (1–2 h) | low — gesture collision with wire select needs care |
| R2 preview/at-drop | S–M (1–2 h) | low |
| R3 heuristic router | M (2–4 h) | medium — taste; mitigate with "reject to arc" rule |
| R4 A* | M–L (3–5 h) | medium; on-demand only |
| R5 tiering | M (2 h) | low |
| R6 provenance | S (1 h) | low — additive schema field |
| R8 a11y | S (½ h) | none |

Recommended PR slicing: `R7+R6` (groundwork) → `R1+R8` (editing) → `R2+R3` (auto-route on
create) → `R5` → `R4` (only if the heuristic proves insufficient in practice).
