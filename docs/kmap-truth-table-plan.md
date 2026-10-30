# Truth Table Panel — decoder design lab

**Status:** plan only — not implemented yet.
**Scope:** add a datasheet-style, fully editable BCD → 7-segment truth table to the
K-map lab (`KMapTab`), live-wired to the same store that drives the K-map.
**Target area:** `src/components/logibench/KMapTab.tsx` and small helpers; no API,
schema or persist-format changes.

---

## 1. Summary

The lab currently stores its truth values *only* as K-map cells
(`useKmapStore.cells`, 32 per segment) and shows the classic function table
nowhere. The user must mentally translate "m6 is 1 for segment d" into
"code 6 lights d". This plan adds a **Truth table card** — the same table found
in 7447/4511 datasheets — that is both a readable reference (inputs, digit
glyph, all seven segment outputs) and a second editing surface for the very
same cells, with hover/focus highlighting synced in both directions between
table and map.

Key property: **the store stays the single source of truth.** The table is a
pure view over `useKmapStore`; edits go through the existing `cycleCell`
action, so K-map ↔ table sync, SOP recomputation, gate lists, inventory check
and localStorage persistence all work with zero new sync logic.

## 2. Motivation

- Plan §3.3 describes the lab flow as "truth table → K-map → SOP → gates";
  today the first step is invisible, so the lab starts mid-pipeline.
- Datasheet cross-check: every 7447/4511 datasheet presents exactly this
  table; a bench user comparing the app against the printed table currently
  has no side-by-side view.
- Pedagogy: seeing *inputs* next to the K-map cells teaches where minterm
  numbers come from (the binary code columns are literally the minterm index).
- Editing convenience: "code 9 should light d" is a one-click edit on a table
  row; on the K-map it requires knowing where m9 sits in Gray order.

## 3. Current architecture (grounding)

| Concern | Where today |
|---|---|
| Cell storage | `src/store/kmapStore.ts` — `cells: Record<SegKey, KMapCell[32]>` (lower 16 = E=0 plane, upper 16 = E=1), `cycleCell(seg, code)`, `e1Dirty`, persist `logibench-kmap-v1` with `skipHydration` |
| Classic values | `src/data/chips.ts:502` `CLASSIC_SEGMENT_EQUATIONS` built inside an IIFE from a local `digitGlyphs` map (codes 0–9; 10–15 → X) — `digitGlyphs` is **not exported** |
| K-map UI | `KMapTab.tsx` — `PlaneGrid` (one 4×4 plane, `id=kmap-cell-{e}-{r}-{c}`, data attrs), `onMapKeyDown` arrow-nav, layout: header → 2-col grid (K-map card, SOP card) → Inventory card → Sanity card |
| Variable encoding | `src/lib/logibench/kmap.ts` — `VARS_BY_COUNT` (MSB first), minterm index = `E<<4 \| WXYZ`, bit convention `bit = n - 1 - i` |
| Minimization | `kmap.ts` `minimize()` → `MinTerm[] { mask, sop }` (unchanged by this feature) |

## 4. Feature spec

### 4.1 Table layout

One `<table>` per plane; in 5-var mode two stacked tables headed `E = 0` /
`E = 1`, mirroring the plane layout of the K-map card.

```
 code │  W X Y Z │ digit │  a  b  c  d  e  f  g
──────┼──────────┼───────┼───────────────────────
  m0  │  0 0 0 0 │   0   │  1  1  1  1  1  1  ·
  m1  │  0 0 0 1 │   1   │  ·  1  1  ·  ·  ·  ·
  ⋮   │          │       │
  m9  │  1 0 0 1 │   9   │  1  1  1  1  ·  1  1
  m10 │  1 0 1 0 │   —   │  X  X  X  X  X  X  X
  ⋮   │          │       │
  m15 │  1 1 1 1 │   —   │  X  X  X  X  X  X  X
```

- **code** — row header, `m0…m31` (row `<th scope="row">`).
- **W X Y Z (E)** — input columns, read-only, MSB first (5-var: `E` column
  precedes them and is also the table's grouping heading).
- **digit** — glyph lit by the classic values of that code (`0…9`); `—` for
  codes 10–15 and for every row of the E = 1 table (classic BCD only covers
  E = 0).
- **a…g** — output cells, value rendered as `1` (amber, lit), `0` (stone,
  off), `X` (dashed don't-care) — same visual language as the K-map legend.
  The **active segment's column is emphasized** (amber header ring) and
  synced with the segment selector above.
- Cells whose value differs from `CLASSIC_SEGMENT_EQUATIONS[seg][code % 16]`
  get the same "edited" cue as the K-map (small amber dot).

### 4.2 Interactions

1. **Edit** — click (or Enter/Space) on an output cell cycles `0 → 1 → X`,
   exactly like a K-map cell, via `cycleCell(seg, code)` where `seg` is the
   *column's* segment and `code` the *row's* minterm. Editing any E = 1 row
   (codes ≥ 16) flips `e1Dirty` for that segment — already handled by
   `cycleCell`.
2. **Cross-highlight** — hovering or keyboard-focusing a K-map cell highlights
   the table row, and hovering/focusing a row highlights the map cell. One
   piece of ephemeral state: `const [hoverCode, setHoverCode] = useState<number | null>(null)`
   in `KMapTab` (local `useState`, deliberately **not** persisted).
3. **Segment switch shortcut** — clicking an inactive segment's column header
   switches the active segment (`setSegmentStore`), so the K-map card follows
   along. The header is a real `<button>`.
4. **Keyboard** — output cells are `<button>`s in tab order; arrow Up/Down
   inside the table moves row focus (same data-attribute technique as
   `onMapKeyDown`), Left/Right moves between segment columns. Escape does
   nothing special (no popovers involved).

### 4.3 Placement & scrolling

- New full-width `Card` titled **"Truth table — inputs → segments"** inserted
  between the K-map/SOP grid (`KMapTab.tsx:511–634`) and the Inventory card
  (`:636`). A third grid column was considered and rejected: both existing
  cards already have `min-w-[19–21rem]` maps and the table needs ~10 columns.
- Body wrapped in `max-h-96 overflow-y-auto overflow-x-auto` with a
  `sticky top-0 bg-white` header row and `sticky left-0` code column — a
  16-row table is ~26 rem tall, a 32-row pair clearly needs the scroll (long
  list rule: max height + custom scrollbar styling).
- 5-var mode: both planes stacked in one scroll container (matches the
  stacked-planes mental model); when `!e1Dirty[segment]`, an inline hint under
  the `E = 1` heading reuses the existing wording "mirrors E = 0 until you
  edit it".

## 5. Design decisions

| # | Decision | Options considered | Chosen |
|---|---|---|---|
| D1 | Output columns | (a) active segment only — compact, 5 cols; (b) all seven, editable | **(b)** — matches datasheets, enables designing all segments from one view; cost is identical because every write is already a store action. Fallback if it feels busy at implementation time: (a) with the other six columns dropped |
| D2 | Inactive-segment editing | (a) read-only inactive columns; (b) fully editable; (c) editable + clicking a header switches segment | **(c)** — (b) plus the one-tap segment switch, which resolves the "I edited b but the K-map shows a" confusion at its root |
| D3 | Hover state home | (a) Zustand slice; (b) `useState` in `KMapTab` | **(b)** — ephemeral, never persisted, both views are mounted simultaneously (same tab), no persist-version bump |
| D4 | Digit glyph source | (a) export the existing local `digitGlyphs`; (b) re-derive glyph from `CLASSIC_SEGMENT_EQUATIONS` | **(a)** — the glyph string is the original, human-authored datum; deriving it back from per-segment arrays adds a failure mode for zero benefit |
| D5 | Persisted UI state (panel collapsed, column prefs) | (a) add to `kmapStore` (version bump); (b) none | **(b)** — the card is always rendered; no new persisted keys, `logibench-kmap-v1` stays version 1 |
| D6 | Input column encoding | (a) binary numbers per var; (b) reuse K-map Gray order | **(a)** — truth tables are binary-ordered by definition; the Gray order belongs to the map, and the contrast between the two orderings is itself instructive |

## 6. Data flow

```
TruthTablePanel ──cycleCell(seg, code)──▶ useKmapStore.cells ──▶ KMapTab useMemos
      ▲                                        │        (terms → gates → inventory — untouched)
      └───────────── hoverCode ◀───────────────┘ (local useState in KMapTab)
```

No new store state. No server calls. The table re-renders from the same
`cells32` subscription the K-map already uses; `minimize()` output is
unaffected, so the P0-corrected minimizer and gate estimators need no changes.

## 7. Files touched (when implemented)

1. **`src/data/chips.ts`** — lift the IIFE-local `digitGlyphs` to an exported
   `export const DIGIT_GLYPHS: Record<number, string>` (codes 0–9 → `'abcdefg'`
   pattern); `CLASSIC_SEGMENT_EQUATIONS` keeps building from it.
2. **`src/lib/logibench/kmap.ts`** — add one pure helper, unit-testable:
   ```ts
   /** MSB-first input bits of a minterm (bit = n-1-i convention). */
   export function mintermInputs(code: number, n: 4 | 5): (0 | 1)[]
   ```
   (Also handy for tests and future views; keeps engine logic out of the JSX.)
3. **`src/components/logibench/TruthTablePanel.tsx`** *(new, ~200 LOC)* —
   props: `cells32: KMapCell[]`, `segment: SegKey`, `vars: 4 | 5`,
   `hoverCode: number | null`, `onHover(code | null)`, `onEdit(seg, code)`,
   `onSwitchSegment(seg)`. Renders one or two plane tables per §4.
4. **`src/components/logibench/KMapTab.tsx`** — mount the card; own
   `hoverCode` state; add optional `highlightCode` prop to `PlaneGrid`
   (`ring-2 ring-amber-400` on the matching cell button); wire callbacks.
5. **`CHANGELOG.md`** — Added entry under `[Unreleased]`.

Estimated size: ~250–300 LOC including markup; no dependency additions
(plain `<table>` + existing `Card`/`Button`/lucide icons).

## 8. Accessibility

- Semantic table: `<caption class="sr-only">`, `<th scope="col">` for inputs
  and segments, `<th scope="row">` for the code column.
- Every output cell is a `<button>` with
  `aria-label="segment d, minterm m6, value 1. Click to cycle 0, 1, X."` —
  same pattern as K-map cells.
- `aria-hidden="true"` on decorative glyph/dot spans.
- No new live region required: the existing sr-only region
  (`KMapTab.tsx:590–592`) already announces expression + gate summary after
  any edit, wherever the edit came from.
- Focus-visible rings on all interactive cells; header buttons included.

## 9. Responsive behavior

- **≥ lg:** card sits full-width below the two-column grid (grid order is
  untouched).
- **Mobile:** table scrolls horizontally (`overflow-x-auto`); the `code`
  column is `sticky left-0 bg-white z-10` so row identity stays visible;
  touch targets are ≥ 44 px (`size-11`-equivalent cell padding).
- Scroll containers get the project's custom thin-scrollbar styling already
  used on the bench board.

## 10. Edge cases

- **All-X segment** — a column full of X renders fine; existing SOP/gate
  emptiness strings are untouched.
- **`e1Dirty` mirror** — E = 1 table shows live values even while mirroring;
  first E = 1 edit breaks the mirror exactly as the K-map does today (both
  surfaces stay consistent because they share storage).
- **Reset segment / Reset all** — no table-specific code; the view follows the
  store.
- **Hydration** — `skipHydration` + post-mount rehydrate is already in place;
  the table's first client render (classic values) matches SSR, same as the
  K-map.
- **4 ↔ 5 toggle** — table simply gains/loses the E = 1 section; 32-cell
  storage already survives the round trip.

## 11. Implementation checklist

- [ ] 1. Export `DIGIT_GLYPHS` from `chips.ts` (mechanical, no behavior change).
- [ ] 2. Add `mintermInputs()` to `kmap.ts`.
- [ ] 3. Build `TruthTablePanel.tsx` (4-var first, single plane).
- [ ] 4. Wire into `KMapTab`, add hover sync + `PlaneGrid` highlight.
- [ ] 5. Add the 5-var two-plane variant + mirror hint.
- [ ] 6. Segment-header switch, arrow-key row/col navigation.
- [ ] 7. `bun run lint` + dev-server smoke test.
- [ ] 8. Browser verification (§12) and `CHANGELOG.md` entry.
- [ ] 9. Commit (mlger identity) and push.

## 12. Verification plan (agent-browser, at implementation time)

1. Open `/` → Decoder design lab tab: table renders 16 rows, classic glyph
   column, active segment column highlighted.
2. Click table cell (segment d, m6): value cycles; K-map cell m6 updates in
   the same tick; SOP text recomputes; hover the same K-map cell → row
   highlights, and vice versa.
3. Click column header `b` → active segment becomes b, K-map card re-titles.
4. Toggle 5 vars → two tables (E = 0, E = 1), hint shown; edit an E = 1 cell →
   hint disappears; switch back to 4 vars and forward again → edit survived.
5. Reload page → all table edits persist (localStorage round trip).
6. Keyboard: Tab into the table, arrows move cell focus, Enter cycles.
7. Mobile viewport (390 px): horizontal scroll with sticky code column; no
   layout overflow.

## 13. Out of scope (future work)

- POS / maxterm view of the same table.
- Multi-output shared-logic minimization (one circuit driving all segments —
  beyond per-segment SOP).
- Import/export of custom truth tables (CSV / shareable URL).
- Editing input patterns (the input space is fixed to the decoder's BCD/E
  codes by design).

## 14. Open questions (answer before implementing)

1. D1 fallback — if the 7-column table feels crowded on mobile, ship the
   active-segment-only variant first? (Default: no, keep all seven.)
2. Should header-click segment switching (D2c) also be available from the
   K-map card (clicking a segment chip already does this — so probably yes,
   it already exists there)?
3. Show the `digit` column in 5-var E = 1 tables as "—" only, or hide the
   column there? (Default: keep it as `—` for column alignment.)
