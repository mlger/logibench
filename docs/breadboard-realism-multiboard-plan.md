# Breadboard Bench — realistic wiring & components, multiple breadboards

**Status:** implemented (all five milestones shipped — M1 `0cd9782`, M2 `440006b`,
M3 `aea1f23`, M4 `a6a84eb`, M5 `78685a5`; regression audit
`bench-board-audit.ts` 110/110).
**Scope:** four upgrades to the Bench tab, driven by the reference photo
(`upload/Breadboard_full_plus.svg.webp`, a BB830-style "full-plus" 830-point
board): **(A)** a realistic rail model (5-hole groups with breaks, matching the
photo) with matching board chrome, **(B)** realistic wiring (one lead per hole,
arced jumper wires with lift handles, plug dots, length classes), **(C)**
realistic component visuals and electrical roles (chip notch/pin-1, LED/ cap
polarity, axial resistor bands, multi-supply support), and **(D) multiple
breadboards** on one pannable/zoomable workbench with cross-board jumpers.
**Target area:** `src/lib/logibench/{types,geometry,netlist,sim,erc}.ts`,
`src/store/projectStore.ts`, `src/components/logibench/{BreadboardCanvas,Palette,Inspector}.tsx`,
`src/lib/logibench/demo.ts`, one Prisma-free **project schema v1 → v2**
migration (JSON blob — no DB schema change), two new demo-grade audit scripts.
No new dependencies; no API-route changes; the 4-state logic simulator stays
logic-level (no SPICE).

---

## 1. Summary

| # | Feature | One-liner | Model impact |
|---|---------|-----------|--------------|
| A | **Realistic rails ("full-plus")** | Rails become independent 5-hole groups with breaks (staggered like the photo); board art gets red/blue rail lines, group gaps, column numbers 1–60, row labels | `railsSplit: boolean` → `railLayout: 'continuous' \| 'center-split' \| 'groups5'`; netlist unions per group; **schema v2** |
| B | **Realistic wiring** | One lead per hole (edit-time enforcement), jumper wires render as arcs over the board with a draggable lift handle, endpoint plug dots, span-based length classes | `Wire.bends` stays reserved; occupancy now includes wire endpoints; new ERC rules |
| C | **Realistic components** | DIP notch + pin-1 dot + silkscreen, LED flat-side/anode-cathode roles (direction evaluated), axial resistor with true color bands, electrolytic vs ceramic cap, N supplies instead of one global | two-pin parts get pin roles; sim drops the single-supply assumption; ERC `supply-conflict`, `led-reversed` |
| D | **Multiple breadboards** | Add up to 6 boards (any mix of half/full/full-plus) on one workbench canvas; drag boards by their header; wires cross between boards; per-board rail layout & label | `Project.boards[]` finally used as an array; board-scoped footprints/store actions; **schema v2**; demo 3 |

Everything runs through the existing pipeline unchanged: `buildNetlist` unions →
`Simulator.evaluate()` fixed-point → ERC → `SimResult` → canvas overlay. Both
new features are *model + rendering + ERC* work, not new simulation engines.

## 2. Motivation

- **The rails lie today.** A real full-plus board's power lines are broken into
  tied 5-hole groups (four groups per line in the photo, staggered between the
  red and blue line). Our model (netlist.ts:64–73) unions the whole rail with at
  most one mid-board break — so a circuit that *would not work on the real
  bench* (chip VCC plugged into an unbridged rail group) simulates fine here.
  That is exactly the class of bench mistake LogicBench exists to catch.
- **Wires look and behave like robot paths.** Every wire is a hard orthogonal
  3-segment route through the midpoint (BreadboardCanvas.tsx:310); real jumpers
  arc over the board. Two wires can share one hole (addWire has no occupancy
  check — projectStore.ts:217–221), which is impossible on a real board, and
  stacked leads are a classic source of "why doesn't it work" on the bench.
- **Components are floating labels.** Chips are colored rectangles; there is no
  notch, pin-1 dot, or silkscreen to orient against; LEDs have no anode/cathode
  marking and their direction is not evaluated; resistors show value text but no
  band rendering (the band data already exists — eseries.ts).
- **One board caps project size.** An 8-digit counter or a CPU-with-display
  build physically outgrows one 830-point board; every real bench grows by
  bolting boards side by side and running long jumpers between rails. The data
  model already anticipates this — `HoleRef.board` (types.ts:99),
  `Project.boards[]` (types.ts:162), and `enumerateHoles()` all accept many
  boards (netlist.ts:20–34) — but the store, footprints, and canvas hardcode
  `boards[0]` / `'main'`.

## 3. Current architecture (grounding)

| Concern | Where today | Multi-board ready? |
|---|---|---|
| Hole addressing | `HoleRef { board, col, row }` — types.ts:98–101; keys `board:col:row` (geometry.ts:97–99) | ✅ already board-scoped |
| Board list | `Project.boards: Breadboard[]` — types.ts:162; kinds `half400` (30 cols) / `full830` (63 cols) — geometry.ts:10–16 | ⚠️ array exists, everything reads `boards[0]` |
| Footprints | `chipFootprint`/`seg7Footprint` `pinAt()` returns `board: 'main'` literals — geometry.ts:123–128, 134–136; `nearestHole(kind,x,y, board='main')` — geometry.ts:78 | ❌ hardcoded `'main'` |
| Placement | `placeAt`/`movePart` read `project.boards[0]` — projectStore.ts:153, 247; `setBoardKind`/`toggleRailsSplit` replace `boards[0]` — :361–371 | ❌ |
| Netlist | `enumerateHoles` loops **all** boards (netlist.ts:20–34); strip unions per board column; rail unions per row with a single mid break when `railsSplit` (netlist.ts:64–73); wire unions follow `HoleRef.board` (netlist.ts:77–81) — a wire between two boards already unions across | ✅ engine-ready; rail groups missing |
| Supply | sim picks the **first** `supply` part (sim.ts:139) and drives `vccNet`/`gndNet`; chips are powered iff VCC/GND pin nets match (sim.ts:148–155) | ❌ single-supply assumption |
| ERC | 15 rules incl. `contention`, `output-to-rail`, `rails-split-note` (erc.ts:309), `pin-collision` | ✅ board-agnostic; needs new rules |
| Wires | straight hole→hole, rendered as orthogonal mid-route path (BreadboardCanvas.tsx:306–323); `bends?` reserved unused (types.ts:155); **no endpoint occupancy check** (projectStore.ts:217–221) | ❌ |
| Occupancy | `buildOccupancy` covers part pins only (geometry.ts:189–198); two-pin placement checks it (projectStore.ts:184); chip placement via `checkPlacement` | ❌ wires not counted |
| Canvas | renders `project.boards[0]` only (BreadboardCanvas.tsx:47, 59); pan + wheel-zoom exist (:190–191); zoom buttons (:441+); drag/drop hit-test assumes one board | ❌ |
| Persistence | Prisma `SavedProject.data` is an opaque JSON string; import gate `p.schema === 1` (AppShell.tsx:128); JSON export/import; SVG export clones the single `<svg>` (AppShell.tsx:140–151) | ✅ blob storage — no DB change; gate needs v1+v2 |
| Demos | `demo7447`/`demo4511` build on `board:'main'` via `H()` (demo.ts:14); `WIRE_COLORS` kit palette (demo.ts:36–39) | ✅ unaffected |

## 4. Feature A — realistic rails ("full-plus" rail groups)

### 4.1 Model

```ts
// types.ts (schema 2)
export type RailLayout = 'continuous' | 'center-split' | 'groups5';
export interface Breadboard {
  id: string;
  kind: BoardKind;
  label?: string;          // "Main", "Display board"
  railLayout: RailLayout;  // replaces railsSplit
  x?: number; y?: number;  // workbench position (feature D)
}
```

- **Group geometry** is a pure function per board kind, not stored data:
  `railGroups(kind, layout, line) → { start, end }[]`. For `groups5` on
  `full830`: groups of 5 tied holes with 2-hole gaps; the second line of each
  rail side is staggered by ~4 columns, mirroring the reference photo. (Exact
  offsets live in one constant table in geometry.ts, tuned against the photo.)
- **v1 migration:** `railsSplit: false → 'continuous'`, `true → 'center-split'`.
  No project content changes. New boards default to `groups5` on `full830`
  (realistic), `continuous` on `half400` (matches common half boards).
- **Netlist:** replace the single mid-break condition with a lookup — union
  columns `start..end` inside each group only (netlist.ts:64–73). Rail net
  classification (`isVccRail`/`isGndRail`) unchanged.

### 4.2 ERC — the point of the whole feature

| New rule | Severity | Fires when |
|---|---|---|
| `rail-group-unpowered` | warning | a strip hole's net touches a rail group that contains no supply contact **and** no bridge wire to a group that has one — "this rail section is floating; bridge the groups or move the connection" |
| `rail-shorted` | error | one net contains holes from both a + line and a − line (VCC↔GND short via wire or part), including across boards |
| `stacked-holes` | info | legacy projects where >1 lead occupies one hole (grandfathered, see §5.2) |

`rails-split-note` is retired in favor of `rail-group-unpowered`.

### 4.3 Board chrome (canvas)

Render `full830` to match the reference photo: red/blue rail lines that visually
break at group gaps, staggered rail hole groups, column numbers `1 5 10 … 60`
printed above/below both strip halves, row letters A–J on both edges, dark
ravine strip. `half400` keeps its current simpler art with layout-appropriate
groups. Pure `geometry.ts`/canvas work — no netlist impact.

### 4.4 Inspector

The rails toggle becomes a 3-way segmented control (Continuous / Center split /
5-hole groups) + editable board label. Live preview: changing layout re-runs sim
immediately via the existing `commit → runSim` path.

## 5. Feature B — realistic wiring

### 5.1 One lead per hole (edit-time only)

- Unified occupancy = part pin holes **∪ wire endpoint holes**
  (`buildOccupancy` gains a wires pass, or a shared `occupiedHoles(project)`
  helper used by `checkPlacement`, `placeAt`, `movePart`, `addWire`).
- `addWire(from, to)` rejects endpoints on occupied holes with an inline toast
  ("Hole 12·c already has a lead"), same pattern as part placement rejection.
- Existing stacked wires in old projects are **not** rewritten — ERC
  `stacked-holes` (info) lists them; the user fixes by dragging.
- Demos Lab 1/Lab 2 are audited so every hole holds ≤1 lead (they appear clean;
  verified at implementation time).

### 5.2 Arc rendering & handles

- Replace the orthogonal mid-route (BreadboardCanvas.tsx:310) with a quadratic
  Bézier arc whose lift height scales with span: `h = clamp(6 + 0.35·dist, 8, 46)`
  px in board space; cross-board (feature D) wires arc higher and render above
  both boards. `Wire.bends` remains reserved — this is auto-routing, not manual
  path editing.
- **Selected wire** shows a draggable lift handle (tweak arc height) and dashed
  highlight (existing selection style reused). Endpoint **plug dots** (small
  filled circles in wire color) mark where leads enter holes.
- Length classes for the palette cursor/ghost: short ≤ 4 cols, medium ≤ 12,
  long > 12 — affects default arc height only; any two holes remain connectable.
- Wire color stays user-chosen from the existing kit palette
  (`WIRE_COLORS`, demo.ts:36–39). Optional ERC info "VCC wire is not red"
  is explicitly **out of scope** (noise).

### 5.3 Wire-tool polish

Live rubber-band preview already exists (WireDragLayer). Add: Escape cancels
(exists), clicking the start hole toggles off (exists), and the preview arc
matches the final arc math so what you see is what you place.

## 6. Feature C — realistic components

| Part | Visual | Electrical |
|---|---|---|
| chip (DIP) | dark epoxy body, orientation notch, pin-1 dot, silkscreen `defId` + family suffix (e.g. `7447`, `74HC00`), pin numbers on hover | unchanged |
| LED | 5 mm dome, flat side marks cathode; lead roles pin 1 = anode, pin 2 = cathode shown in Inspector + tooltips | evaluate **direction**: reversed LED → ERC `led-reversed` (warning), no light |
| resistor | axial body drawn between its two holes with color bands from `resistorBands()` (eseries.ts — already computed for the Inspector) | unchanged |
| cap | electrolytic (can + polarity stripe) when ≥ 1 µF, ceramic disc below | unchanged |
| seg7 | existing custom render + decimal point pin visible | unchanged |
| supply | bench PSU/battery block with + and − terminals | **multi-supply**: every supply drives its own two nets (sim.ts:139 drops the `find(first)`); two supplies with different `volts` on the same net → ERC `supply-conflict` (error); same volts in parallel is legal |

Pin-role plumbing: two-pin parts get optional `props.role1/role2` labels at
render time from a per-type table (LED: A/K; electrolytic: +/−; resistor: —) —
no schema change needed (derivable from type), so **no migration cost**.

## 7. Feature D — multiple breadboards

### 7.1 Engine de-hardcoding (prerequisite, invisible to users)

1. `chipFootprint(pkg, boardId)` / `seg7Footprint(boardId)` — `pinAt` emits the
   caller's board id; `checkPlacement`/`placeAt`/`movePart` pass it through.
2. `nearestHole` callers pass the real board id (default `'main'` removed).
3. Store: `addBoard(kind)`, `removeBoard(id)` (AlertDialog with affected part/
   wire counts), `renameBoard(id, label)`, `setBoardKind(id, kind)`,
   `setRailLayout(id, layout)`, `moveBoard(id, x, y)`, `duplicateBoard(id)`.
   `setBoardKind`/`toggleRailsSplit` become board-scoped instead of replacing
   `boards[0]` (projectStore.ts:361–371).
4. Board id guard: existing `'main'` id is kept for migrated projects so old
   hole keys stay valid; new boards get `b2`, `b3`, …

### 7.2 Workbench canvas

- **One SVG, N boards.** Each board renders inside a `<g transform=translate(x,y)>`
  at its workbench position; shared pan/zoom (existing view state) gains
  **Zoom-to-fit-all** and **focus board** buttons. Default layout: boards in a
  row with a fixed 80 px gap; auto-arrange button resets positions.
- **Board chrome**: header bar per board (grip icon, editable label, kind badge,
  ⋯ menu: change kind, rail layout, duplicate, remove). Boards drag **only** by
  the header (body clicks stay hole/part interactions — no dnd ambiguity).
  Drag snaps to a 40 px grid; overlap is allowed but a soft outline warns.
- **Palette drops and part moves** hit-test every board (clientToHole iterates
  boards, picks the nearest valid hole overall) — placement then flows through
  the unchanged `placeAt`/`movePart` with the resolved board id.
- **Cross-board wires**: nothing special at the model level (a wire is two
  HoleRefs; netlist unions across boards today). Rendering: higher arc, drawn
  in a top layer above both boards.
- **Cap**: max 6 boards (guard in `addBoard` with a toast). Keeps netlist
  rebuild-per-hover (netHolesOf, projectStore.ts:375) comfortably fast; if hover
  jank appears, memoize the netlist per project reference (small, listed as
  contingency).
- **Responsive**: ≥ lg keeps the 3-column shell (Palette / workbench /
  Inspector) but the canvas area grows to fill available height; on mobile the
  workbench pans and zooms with touch, boards never reflow under the user.

### 7.3 Demos & docs

- **Demo 3 — "Two-board counter"**: 555 + 7490 on board 1, 4511 + 5161AS on
  board 2, long red/black jumpers bridging the rail groups across boards. Serves
  as the acceptance fixture for cross-board nets and rail-group bridging.
- `chip-library.md` note + footer unchanged; Reference tab untouched.

## 8. Schema v1 → v2 migration

Stored inside `SavedProject.data` (opaque string — **no Prisma change**) and in
exported JSON files.

```
v1: { schema: 1, boards: [{ id, kind, railsSplit }], parts, wires }
v2: { schema: 2, boards: [{ id, kind, label?, railLayout, x?, y? }], parts, wires }
```

`migrateProject(v1): v2` — pure, defensive (same sanitizer philosophy as the
kmap v2 audit): unknown kinds → `half400`, missing boards → one `main`
`half400`, `railLayout` from `railsSplit`, invalid part/wire hole keys dropped
with a count reported, `x/y` defaulted via auto-layout. Import gate
(AppShell.tsx:128) accepts `schema === 1 || 2` and migrates on load; save always
writes v2. Parts/wires carry no schema change — hole keys already include board.

## 9. Implementation phases

| Phase | Content | Size | Verify |
|---|---|---|---|
| **M1** | Schema v2 + migration + engine de-hardcoding (§7.1) + import gate v1‖v2 | M | `bench-board-audit.ts` (migration round-trip, cross-board netlist, hole-key sanitizers) — zero visual change, Lab 1/2 byte-identical behavior |
| **M2** | Rail groups: model, netlist, ERC `rail-group-unpowered` + `rail-shorted`, board chrome to match photo, Inspector rail control | M | audit (group unions per layout; ERC fire/no-fire matrix); agent-browser vs reference photo |
| **M3** | Wiring realism: unified occupancy, arc rendering + lift handle, plug dots, length classes, ERC `stacked-holes`, demo wire audit | M | audit (occupancy matrix); agent-browser wire flows incl. drag-to-wire, selection, SVG export |
| **M4** | Multi-board workbench: board CRUD/drag/duplicate, board-aware dnd, cross-board jumpers, zoom-to-fit, Inspector board panel, **Demo 3**, netlist memo contingency | L | agent-browser golden path: add board → place chip on it → wire across → ERC → save/reload; 390 px pass |
| **M5** | Component realism + multi-supply: visuals (§6), LED direction + `led-reversed`, multi-supply + `supply-conflict`, final audits + doc polish | M | audit (LED direction table, supply matrix); visual pass |

Each phase: `bun run lint` clean + audit script green + agent-browser
verification + one conventional commit (`feat:`/`fix:`). Audit scripts live in
`/home/z/.cache/audit/` (not committed), same as the kmap rounds.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| One-lead-per-hole breaks legacy projects with stacked wires | Enforcement is **edit-time only**; legacy stacks grandfathered via ERC info; migration never deletes wires |
| Rail group change silently alters old circuits' behavior | v1 boards migrate to their exact current layout (continuous / center-split); groups only for **new** boards or explicit user choice |
| Net ids shift between runs | Net ids are per-computation, never persisted — no stability contract to break (verified: only `Map<number,…>` in-memory) |
| Board drag vs hole/wire dnd ambiguity | Boards draggable only via header grip; body pointer events unchanged |
| Perf: netlist rebuilt per hover with 6 boards (~5.3 k holes) | Board cap 6; memoized netlist keyed by project reference as a listed contingency |
| SVG export drift | Single `<svg>` already exports whole; multi-board rendering keeps one root svg (AppShell.tsx:140–151 clone path unchanged) |
| Undo memory growth (deep clones per commit) | `past` cap is already 50; 6-board projects are ~10× a half-board — acceptable; no change |

## 11. Acceptance criteria

1. Full830 board art matches the reference photo: group gaps visible on all
   four rail lines, staggered groups, column numbers 1–60, row labels A–J.
2. Supply on rail group 1, chip VCC wired to group 3 with no bridge → ERC
   warning `rail-group-unpowered`; adding a bridge wire clears it.
3. Wire between a + line and a − line (any boards) → ERC error `rail-shorted`.
4. Clicking an occupied hole to start a wire is rejected with a toast; legacy
   stacked wires surface as ERC info instead of being mutated.
5. Wires render as arcs; selecting shows a lift handle; arcs appear in SVG
   export; Lab 1/Lab 2 render and simulate identically to today.
6. "+ Add board" (up to 6) creates a board beside the main one; a chip can be
   dropped on board 2; a jumper from board 1's + group powers board 2's strip;
   save → reload round-trips; a v1 JSON import migrates cleanly.
7. Two supplies with different volts on one net → ERC `supply-conflict`;
   LED inserted backwards → `led-reversed` and no light.
8. 390 px viewport: workbench pans/zooms, no horizontal page overflow, sticky
   footer intact (prior audit standard).
9. `bun run lint` clean; new audit scripts zero failures.

## 12. Open questions (defaults chosen — veto freely)

1. **New-board rail default**: `groups5` for new full830 (realistic default),
   existing projects keep their migrated layout. ← default
2. **Board cap**: 6. Enough for a full CPU build; protects perf. ← default
3. **Manual multi-bend wire routing** (`Wire.bends`): deferred — auto-arc + lift
   handle covers the bench look. ← default
4. **Chip flip orientation** (chip inserted rotated 180° → power reversed):
   deferred; would be an ERC teaching moment later. ← default
5. **New part types** (transistor, diode, trimmer, seg7 dp): out of scope for
   this plan; revisit after M5. ← default
