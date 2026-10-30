# K-map lab — improvement suggestions

**Status:** S1 (loop overlay) and S2 (structured `MinTerm`) are implemented;
the rest are suggestions only.
**Baseline:** commit `b46fff1` (truth table panel shipped; minimizer pruning,
gate estimator, 5-var mode and store persistence already fixed in `923610d`).
**Grounding:** `src/lib/logibench/kmap.ts` (272 L), `KMapTab.tsx` (776 L),
`TruthTablePanel.tsx` (327 L), `src/store/kmapStore.ts` (168 L),
`src/data/chips.ts` (gate chips: 7400/7402/7404/7408/7432/7486/7410/7411/7420/7430;
7421 is **not** defined in the library).

Priorities: **P1** = high value, do first · **P2** = strong, schedule · **P3** = nice-to-have.
Effort: **S** ≤ 1 h · **M** a few hours · **L** multi-session.

---

## A. Teaching & visualization

### S1 · P1 · M — Implicant group overlay ("loops") on the map ✅
Draw every chosen implicant as a translucent amber rounded rectangle over the
cells it covers (the classic pencil loops). Hover/focus a term chip highlights
its loop on the map and vice versa; color-cycle overlapping groups.
**Why:** this is *the* K-map teaching visual; today the cover appears only as
SOP text, so learners can't see *why* `X′·Z′` groups four cells.
**Enabler:** S2 (needs per-term covered codes — `toMinTerm` currently discards
`term`, and the UI only ever touches `t.sop`).
**Files:** `kmap.ts` (`MinTerm`, `minimize`, `toMinTerm`), `KMapTab.tsx`
(overlay layer inside `PlaneGrid`, term-chip hover wiring).

### S2 · P1 · S — Structured `MinTerm` (enabler for S1/S5/S7/S9) ✅
Extend `MinTerm { mask, sop }` → `{ term, mask, covers: number[], literals }`
(`sop` stays as the display string). The gate estimator currently parses
`t.sop.split('·')` strings; structured literals make it robust and unlock the
overlay, hazard analysis, exact-cover mode and chip-packing metrics.
**Files:** `kmap.ts` only (+ call sites read the same `sop`).

### S3 · P2 · S — 5-variable cross-plane adjacency hint
In 5-var mode, hovering a cell also outlines the *same* (WX, YZ) cell in the
other plane — those two minterms differ only in E, so they are adjacent and a
legal group of 2. One-line data mapping + the existing outline technique from
the truth-table highlight.
**Why:** the #1 confusion with stacked-plane 5-var maps.
**Files:** `KMapTab.tsx` (`PlaneGrid` hover handler + `highlightCode` plumbing).

### S4 · P2 · S — Gray-wrap neighbor hint
Hovering a map cell outlines its four Gray-adjacent neighbours including the
wrap-around edges (`00`↔`10` columns/rows). Optionally only when both cells
are `1` (candidate pair). Cheap, reinforces adjacency before S1 lands.
**Files:** `KMapTab.tsx`.

### S5 · P2 · M — Static-1 hazard report
For every adjacent pair of 1-cells not covered by a *common* implicant, report
the pair and the consensus term that would fix it ("m5–m13: no product term
covers both — add `W·X·Y′` or accept a glitch"). Panel under the SOP; pairs
light up on the map when hovered.
**Why:** bench-relevant (real decoders glitch) and a genuine step beyond
minimization into timing behavior. Needs S2.
**Files:** `kmap.ts` (new pure function), `KMapTab.tsx` (report panel).

### S6 · P2 · M — POS / maxterm view (+ NOR-only build)
Run the minimizer on the complement (0-cells + X), present as product-of-sums
(`ΠM`), plus a NOR-only gate list (7402 is in the library; wide NORs need a
7427 note or cascades — mirror the NAND treatment).
**Why:** teaches duality; the pipeline (map → result → gates → inventory)
already renders it once `minimize` is reused on the complement.
**Files:** `kmap.ts` (`minimizePos` wrapper), `KMapTab.tsx` (third result
section or toggle).

### S7 · P2 · S — Exact minimum-literal cover mode
The greedy + pruning cover is valid and near-minimal but not guaranteed
minimum-literal. Add an "exact" toggle: essential primes + branch-and-bound
(trivial at ≤ 5 vars). When exact beats greedy, show both expressions and the
literal delta.
**Files:** `kmap.ts`, `KMapTab.tsx` (toggle + cost readout).

### S8 · P2 · M — "What your decoder displays" preview row
Render, above the truth table, the 7-segment digit each code 0–9 would light
given the *current* seven columns — and flag codes whose lit-set is not a real
glyph. Reuses `DIGIT_GLYPHS` for comparison; a tiny 7-bar SVG (or the bench's
seg7 rendering) per digit.
**Why:** turns abstract per-segment edits into the visible consequence on a
display; makes a broken edit ("your 5 now shows ᒾ") obvious.
**Files:** new small component; `TruthTablePanel.tsx` or `KMapTab.tsx` mount.

## B. Workflow & integration

### S9 · P2 · M — Chip-packing optimizer in the gate list
The estimator emits only 7408/7432/7404/7400/7430 and mentions 7411/7421 in
prose. Pack wide terms into real wide chips when it saves ICs: ≥ 2 three-input
ANDs → one 7411; any 4-input AND → 7420/7421 (needs a 7421 `ChipDef` — the
library lacks it); same for NAND rank-1 (7410/7420 already defined). Inventory
check then covers exactly what the build needs.
**Why:** the gate list is the shopping list; right-sizing it is the point.
**Files:** `kmap.ts` (both estimators), `chips.ts` (7421 def), tests via S20.

### S10 · P2 · S — Undo/redo for map & table edits
In-memory history in `kmapStore` (`{ seg, code, prev }` stack, cap ~100),
Ctrl/Cmd+Z / Shift+Ctrl+Z, small undo button next to "Reset to classic". Not
persisted (localStorage stays v1).
**Why:** the only recovery today is resetting whole segments; a mis-click on
the truth table loses work.
**Files:** `kmapStore.ts`, `KMapTab.tsx`.

### S11 · P2 · M — Lab ↔ bench cross-check
If the bench holds a built decoder driving a seg7, drive codes 0–9 (switch
block or the 7490) and diff each observed segment state against the lab's
expectation; report per-code pass/fail with the first mismatch highlighted.
**Why:** closes the loop the 4511 tip only hints at; the sim engine
(`SimResult.segStates`) already produces the data.
**Files:** new bridge component + reuse of the bench netlist extractor.

### S12 · P1 · L — "Send to bench" auto-build (bigger bet, phased)
**Phase 1 (M):** export a wiring checklist + BOM from the gate list (chips,
per-pin connections for the two-level network, switch inputs W–E, segment
resistor + LED) as printable text.
**Phase 2 (L):** auto-place the chips/switch/seg7 on the breadboard and
auto-wire the network using the existing `PartInstance`/`Wire` models
(pin assignment + hole search is the hard part; undo via S10's stack or the
bench's own undo).
**Why:** the killer feature tying design lab → physical build; nothing else in
the app generates a circuit.

### S13 · P3 · S — Σm / ΠM canonical readout
Under the SOP: `F = Σm(0,1,2,3,4,6,8,9) + d(10,11,12,13,14,15)` (and the POS
dual once S6 exists). Trivial from the cells; nice for homework cross-checks.

### S14 · P3 · S — Copy / export buttons
Copy-SOP-to-clipboard, export truth table as CSV, export/import the whole lab
state as JSON (round-trips the localStorage blob; guarded by the store's
existing `sanitizeCells`).

### S15 · P3 · S — Shareable URL state
Encode `vars` + per-segment cells + active segment into the query string
(base32 of 7×32 ternary values ≈ 70 chars), read on mount before rehydrate.
Enables "look at my map for segment g" links.

### S16 · P3 · S — Family-aware inventory check
`stockFor` currently pools LS·HC·HCT·CD4000. Add a family preference toggle
in the Inventory card (and show per-family availability per chip). Someone
building all-TTL sees honest numbers.
**Files:** `KMapTab.tsx` (`stockFor` + card UI).

## C. State, UX & accessibility

### S17 · P3 · S — Mirrored digits in the E = 1 table
While `!e1Dirty`, the E = 1 table's digit column shows "—" for every row; show
the mirror's digits instead (they genuinely apply until the plane diverges),
switching to "—" after the first edit. One conditional.

### S18 · P3 · S — Announce cell edits to screen readers
The sr-only live region covers expression + gates; append the last edit
("segment d, minterm m6 set to don't-care") so truth-table edits are
acknowledged without a full re-read.

### S19 · P3 · M — Split `KMapTab.tsx` (776 lines)
Extract header (segment/var/resets), K-map card, result card, sanity card into
`components/logibench/kmap/`. Pure refactor, no behavior change; keeps future
work (S1/S5/S6 panels) out of one file.

## D. Engineering hygiene

### S20 · P2 · S — Repo-ify the fuzz/audit scripts
Move the session's audit scripts (minimizer fuzz, minimal repro, classic
regression) into `scripts/kmap-verify.ts` + `bun run verify:kmap`. They live in
`~/.cache` today — one repo clone away from being lost, and they are the
regression net for S1/S5/S7/S9 edits. Also: `sopToGates`' `invertersAvailable`
param is never passed (always `true`) — either wire it to a future
"no 7404 in stock → NAND everywhere" mode or drop it.

## Suggested order

1. **S2** (enabler) → **S1** (overlay) → **S3/S4** (adjacency hints)
2. **S10** (undo) → **S20** (verify script) — safety net before estimator work
3. **S5** → **S7** → **S6** (analysis modes, all reuse S2)
4. **S9** → **S8** → **S13–S18** (small wins in any order)
5. **S12** phases when ready for the big one; **S11** after it

## Non-goals (deliberately)

- **6-variable mode** — UI (4 stacked planes) and implicant space both explode;
  no realistic need in the BCD-decoder curriculum.
- **Multi-output shared-logic minimization** (one circuit driving all segments
  optimally) — research-grade problem; per-segment SOP is the teaching target.
- **Timing/SPICE simulation** — the rule-based electrical checker philosophy
  covers the bench needs (S5's hazard report is the right dose of timing).
- **Performance work** — `minimize()` costs ~33k checks per edit at 5 vars;
  no user-visible latency today.
