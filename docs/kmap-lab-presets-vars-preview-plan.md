# K-map Lab — Presets, editable variable names, 7-segment preview

**Status:** plan only — not implemented yet.
**Scope:** three enhancements to the decoder design lab (`KMapTab`): a **preset
menu** that fills the maps with known functions, **editable variable names**
(rename W X Y Z / E everywhere), and a **live 7-segment preview** that shows
what the current decoder lights for a chosen input code.
**Target area:** `src/store/kmapStore.ts`, `src/components/logibench/KMapTab.tsx`
plus four new small components, one engine signature extension in
`src/lib/logibench/kmap.ts`, one persist-version bump. No API routes, no
schema/database changes, no new dependencies.

---

## 1. Summary

| # | Feature | One-liner | Store impact |
|---|---------|-----------|--------------|
| A | **Presets** | A "Presets" popover fills the active segment (or all seven) with a known function — classic, blank, single-digit decoders, parity, threshold, random | new `applyPreset` action; nothing new persisted |
| B | **Editable variables** | Rename W X Y Z (and E) to anything (`D C B A`, `Q3…Q0`, pin names); the rename flows into SOP, term chips, map headers, truth-table columns, aria-labels | new `varNames` state; persist **v1 → v2** |
| C | **7-segment preview** | A slim card with an SVG seven-segment display: pick a minterm (or just hover any map cell / truth-table row) and see which segments light | no new persisted state |

All three stay client-side and keep the existing architecture invariant:
**`useKmapStore` is the single source of truth** — presets are plain store
writes, the preview is a pure view over `cells`, renaming is relabeling on top
of unchanged minterm indices. Everything downstream (SOP recompute, term
chips, gate lists, inventory check, truth table, persistence) follows for free.

## 2. Motivation

- **Presets** — today the only starting point is the classic BCD table
  ("Reset to classic"/"Reset all"). Exercises like "design a decoder that
  shows just the digit 7" or "minimize an odd-parity checkerboard" require
  hand-filling 16+ cells per segment. A preset menu turns the lab into a
  self-serve exercise generator; Random gives unlimited minimization drills.
- **Editable variables** — bench users think in their own names: 7447 pin
  order (`D C B A`), register outputs (`Q3 Q2 Q1 Q0`), or a professor's
  notation. Hardcoded `W X Y Z` (kmap.ts:11) forces mental translation in
  every expression.
- **7-segment preview** — the lab's pay-off ("what does the display show?") is
  currently only reachable by reading seven K-maps or the truth table's digit
  column (which shows the *classic* glyph, not the user's edits). A live
  display closes the loop, and hovering a truth-table row → instant preview
  makes the input↔output relationship visceral.

## 3. Current architecture (grounding)

| Concern | Where today |
|---|---|
| Cell storage | `src/store/kmapStore.ts` — `cells: Record<SegKey, KMapCell[32]>` (lower 16 = E=0 plane, upper 16 = E=1), `cycleCell`, `e1Dirty`, `resetSegment` (4-var resets lower plane only, keeps E=1 edits), persist `logibench-kmap-v1` **version 1**, `skipHydration` + post-mount `rehydrate()` (KMapTab.tsx:478–480), custom `merge` with per-field sanitizers |
| Classic defaults | `src/data/chips.ts:502` `DIGIT_GLYPHS` (0–9 → `'abcdefg'` pattern, tails on 6/9); `:508` `CLASSIC_SEGMENT_EQUATIONS` (16 values per segment, X on 10–15) |
| Minimizer | `src/lib/logibench/kmap.ts` — `minimize()` (:81) → `toMinTerm()` (:130) **bakes literal names** from `VARS_BY_COUNT` (:11) into `MinTerm.literals`/`sop`; gate estimators read literals (only `includes('′')`) |
| Lab header | `KMapTab.tsx:577–669` — segment chips a–g, 4/5-var toggle, "Reset to classic", "Reset all" (AlertDialog); `anyEdits` computed at :566–570 by comparing all 32 cells against `CLASSIC_SEGMENT_EQUATIONS[seg][i % 16]` |
| Map card | `PlaneGrid` (:308–425) — corner label "WX \ YZ" (:353–357), row/col headers are Gray binary, cell aria-labels say "WX=…, YZ=…" (:391); 5-var plane headings "E = 0"/"E = 1" (:750/:765) |
| Truth table | `TruthTablePanel.tsx` — input column headers from `VARS_BY_COUNT[n]` (:132–140); E=1 mirror hint mentions "E = 0" (:303–309); `hoverCode` flows from `KMapTab` useState |
| UI kit | `popover`, `dropdown-menu`, `alert-dialog`, `input`, `badge`, `button` all present in `src/components/ui` — no shadcn install needed |

## 4. Feature A — Presets

### 4.1 Catalog

New data module `src/data/kmapPresets.ts`. Two groups, uniform shape:

```ts
export interface KmapPreset {
  id: string;              // 'classic', 'blank', 'digit-7', 'parity-odd', …
  label: string;           // 'Digit 7 only'
  scope: 'decoder' | 'segment';  // decoder = writes all 7 segments
  description: string;     // one-liner shown in the menu
  /** 16 minterms (codes 0–15) per segment; pure — no store access. */
  build: () => Record<SegKey, KMapCell[]>;
}
export const KMAP_PRESETS: KmapPreset[];
```

**Whole-decoder group**

| Preset | Fill rule (per segment, codes 0–15) | Why |
|---|---|---|
| Classic BCD decoder | `CLASSIC_SEGMENT_EQUATIONS[seg]` (identical to "Reset all", kept in the menu for discoverability) | canonical baseline |
| Blank decoder | all 0 (incl. 10–15) | start from a truly empty design |
| Digit *d* only (d = 0…9) | 1 at m_d · 0 at the other valid codes (m0–m9) · **X at 10–15** | "design a decoder that shows just 5" — compare its gate cost against the classic's |

**Active-segment group** (segment letter shown in the group label, e.g. "Active segment — d")

| Preset | Fill rule | Why |
|---|---|---|
| Classic *seg* | `CLASSIC_SEGMENT_EQUATIONS[seg]` | identical to "Reset to classic" |
| All 0 / All 1 / All X | constant fill | quick baselines; All-X exercises the "any" SOP path |
| Odd parity (W⊕X⊕Y⊕Z) | 1 at {1, 2, 4, 7, 8, 11, 13, 14} · 0 elsewhere (no X) | the classic checkerboard — worst case for K-maps |
| Threshold ≥ 5 | 1 at {5…9} · 0 at {0…4} · X at 10–15 | textbook magnitude-comparator bit |
| Random | fresh on every apply: ~40% 1 · 40% 0 · 20% X per cell | unlimited minimization practice |

### 4.2 Apply semantics (plane rules — same contract as `resetSegment`)

- Presets build **16-minterm patterns** (codes 0–15) only. The store decides
  planes: **4-var mode** writes the lower 16 and leaves the stored E=1 plane
  and `e1Dirty` untouched (4→5→4 round trip never loses E=1 edits — same as
  `resetSegment`, kmapStore.ts:123–133). **5-var mode** writes the pattern to
  both planes and clears `e1Dirty` for touched segments (explicit fill = the
  mirror legitimately ends).
- Store action sketch:

  ```ts
  applyPreset: (preset: KmapPreset) => void
  // touched segs = all seven (scope 'decoder') or [s.segment] (scope 'segment')
  ```

- No new persisted keys; `Random` re-rolls on each apply (its `build()` runs
  at apply time). Downstream recomputation (minimize → gates → inventory →
  truth table → preview) rides the existing subscriptions.

### 4.3 UI

- A **"Presets"** button (lucide `Sparkles`) in the header group
  (KMapTab.tsx:624–668), left of "Reset to classic". Opens a **Popover**
  (`src/components/ui/popover.tsx`), `align="end"`, content constrained with
  `max-h-[70vh] overflow-y-auto` + the project's thin-scrollbar recipe —
  long-list rule.
- Content: two group labels (small caps, matching `HDR`), decoder items first.
  The digit presets render as a compact 10-chip row (0…9); each chip shows the
  digit number and, at `sm:` and wider, a mini `SevenSegDisplay` (Feature C
  component, `size="sm"`) of that digit — instant visual preview before
  applying. Other items are simple menu rows (label + muted description).
- **Irreversibility guard:** the app has no undo. If any touched segment
  currently differs from classic (reuse the comparison pattern at
  KMapTab.tsx:566–570, narrowed to the touched segments' both planes), the
  chosen item first opens the existing-style **AlertDialog**: *"Apply preset
  'Digit 7 only'? This overwrites your edits to segments a, b, … and cannot be
  recovered."* Buttons: "Keep edits" / "Apply preset". Over an untouched
  (all-classic) target, the preset applies immediately.
  - Radix nesting note: control the Popover's `open` state; on a guarded item,
    close the popover, then open the dialog at component root — avoids
    popover-inside-dialog focus traps.
- New component `src/components/logibench/PresetMenu.tsx` (~140 LOC) so
  KMapTab only mounts it.

## 5. Feature B — Editable variable names

### 5.1 Interpretation

"Editable variable" = **rename** the labels. The variable *count* stays the
existing 4/5 toggle (2/3/6-variable maps are engine + Gray-geometry changes —
§16 Out of scope). Renaming is **pure relabeling**: W is always bit 3 no
matter what it is called; minterm numbering, covers, loops, hover sync and
stored cells never move.

### 5.2 Storage

```ts
// kmapStore.ts
varNames: [string, string, string, string, string]
//          ↑ index 0 = 5-var MSB (default 'E'); 1..4 = defaults W X Y Z
setVarName: (index: 0|1|2|3|4, name: string) => void
```

- Effective names = `vars === 4 ? varNames.slice(1) : varNames` — a custom E
  slot survives 4↔5 toggling, mirroring how the E=1 plane is retained.
- **Persist bump: `logibench-kmap-v1` version 1 → 2.** Add `migrate(persisted,
  1)` that injects `['E','W','X','Y','Z']` into old payloads (everything else
  passes through), and extend `merge` to sanitize `varNames`: array of 5
  strings, each matching `^[A-Za-z][A-Za-z0-9]{0,2}$` after trim, else the
  slot's default; duplicates resolved to defaults. Corrupt names must never
  cost the user their cells.

### 5.3 Validation

| Rule | Value | Reason |
|---|---|---|
| Charset | `^[A-Za-z][A-Za-z0-9]{0,2}$` (after trim) | names are joined into SOP strings with `·` and `+`; `sopToGates` reads the `′` suffix from literal strings — keep literals unambiguous |
| Empty input | revert to that slot's default | doubles as the per-slot reset |
| Duplicates | rejected case-insensitively (red ring + hint, previous value kept) | `X` vs `x` in one expression is unreadable |
| Case | kept as typed; rendered `font-mono` | `q3` vs `Q3` may be meaningful to the user |

### 5.4 UI — `VarNameEditor.tsx` (~90 LOC)

- A row of 4 (4-var) or 5 (5-var) small mono chips in the header group, right
  of the 4/5 toggle. Chip = `<button>` showing the current name; click turns
  it into an inline `<input>` (auto-focused, pre-selected, ~3.5rem wide).
  Enter/blur commits, Escape cancels. `aria-label="Rename variable 2 of 4
  (currently X)"`; ≥44px hit area via padding; focus-visible ring.
- A tiny "reset names" text button at the row's end restores all five
  defaults (open question Q3).
- In 4-var mode the E chip is hidden but its customized value is remembered.

### 5.5 Every surface that must consume the names (exhaustive)

1. **Engine** — `toMinTerm(im, n, names = VARS_BY_COUNT[n])`: optional third
   param; default preserves every existing caller and the audit scripts.
   `minimize(cells, names?)` passes it through. SOP text, term chips and their
   aria-labels are all derived from these strings — no further edits needed
   there.
2. **`PlaneGrid` corner label** (:353) "WX \ YZ" → `${n0}${n1} \ ${n2}${n3}`;
   cell aria-labels (:391) "WX=01, YZ=10" → dynamic names; group aria-label
   (:345); 5-var plane headings (:750/:765) "E = 0/1" → `${n0} = 0/1`.
3. **Explainer paragraph** (:670–681) — mentions W X Y Z / E; make dynamic.
4. **`TruthTablePanel`** — input column headers (:132–140) via a new
   `names: readonly string[]` prop (panel stays a pure view); plane headings
   and the "mirrors E = 0" hint (:303–309) → `${n0}`.
5. **Sanity card** — `CLASSIC_SOP` (KMapTab.tsx:76–84) **stays canonical
   W X Y Z** (it quotes the textbook hand minimizations); add one footnote:
   "shown in the canonical W X Y Z naming".
6. **Gate lists** — purposes contain no variable names today; unchanged.

## 6. Feature C — 7-segment preview

### 6.1 `SevenSegDisplay.tsx` (~130 LOC, pure SVG, no deps)

- Props: `states: Record<SegKey, KMapCell>`, `size?: 'sm' | 'md'`,
  `showLabels?: boolean` (default true) — tiny a–g letters beside each bar,
  teaching the letter↔bar mapping used by the map/table.
- Geometry starting point (tune with screenshots): viewBox `0 0 220 380`,
  bar thickness 26, horizontal length 148, vertical length 128, bevel 12.
  Two hexagon helpers `hSeg(x, y, w, t)` / `vSeg(x, y, h, t)`; positions:

  | seg | kind | x | y | | seg | kind | x | y |
  |---|---|---|---|---|---|---|---|---|
  | a | horiz | 36 | 22 | | f | vert | 24 | 38 |
  | g | horiz | 36 | 177 | | e | vert | 24 | 194 |
  | d | horiz | 36 | 332 | | b | vert | 170 | 38 |
  | | | | | | c | vert | 170 | 194 |

  Corner overlaps between bars are intentional (classic display look); keep
  small gaps by trimming vertical bars' reach. `stroke-linejoin="round"`
  softens the hexagons.
- Value styling (matches the lab legend): **1** → `amber-500` fill + soft
  glow (feGaussianBlur or a duplicated blurred copy); **0** → `stone-200`;
  **X** → `amber-300` at ~35% opacity + dashed stroke overlay — visibly
  "might be lit", distinct from off. A one-line legend repeats the wording.
- `role="img"` + dynamic `aria-label="Seven-segment display: segments a, b,
  d, f, g lit; c, e off; none don't-care."` — **no live region**: hover
  changes would spam screen-reader users.
- Note: `DIGIT_GLYPHS` 6/9 "tails" are a table convention; the display simply
  renders the stored segment values.

### 6.2 Decoder preview card

```
┌ Decoder preview — what each input lights ─────────────────────┐
│  ┌───────┐   code  m0 m1 m2 m3 m4 m5 m6 m7                    │
│  │  ▁▁▁  │         m8 m9 …        (5-var: two labeled rows,   │
│  │ │   │ │                        E = 0 and E = 1, m0…m31)     │
│  │  ▔▔▔  │                                                    │
│  └───────┘   hover any map cell or truth-table row — the      │
│              display previews that input instantly            │
└───────────────────────────────────────────────────────────────┘
```

- New slim **Card "Decoder preview — what each input lights"** inserted
  between the 2-column grid (KMapTab.tsx:847) and the truth table (:850).
  Left: `SevenSegDisplay size="md"`. Right: chip grid of minterm codes
  (chips ~2rem, wrap; digit glyph shown under codes ≤ 9); selected chip =
  amber-600. In 5-var mode the chips split into two labeled rows E = 0 / E = 1
  (32 chips in one flat row would be unreadable).
- **Hover precedence:** the display shows `hoverCode ?? selectedCode`.
  `hoverCode` already flows through KMapTab from the map *and* the truth
  table — so pointing at any cell/row anywhere in the lab instantly previews
  that input, and leaving returns to the chip selection. This is the headline
  interaction; it needs zero new plumbing.
- `selectedCode`: ephemeral `useState(0)` in KMapTab — not persisted (D9).
- The display renders the **stored** cells, so in 5-var mode an unedited E=1
  plane shows the mirror — consistent with map and table.
- New component `src/components/logibench/DecoderPreviewCard.tsx` (~110 LOC).

### 6.3 Reuse

Feature A's digit-preset chips embed `SevenSegDisplay size="sm"` (desktop
widths; see Q4). This is why the checklist builds C before A.

## 7. Design decisions

| # | Decision | Options considered | Chosen |
|---|---|---|---|
| D1 | Preset overwrite guard | (a) apply immediately; (b) AlertDialog whenever the target has edits; (c) full undo stack | **(b)** — no-undo app makes silent overwrite dangerous; (c) is a feature of its own (§16). Reuses the familiar Reset-all dialog pattern |
| D2 | Digit presets & codes 10–15 | (a) X (don't-care); (b) 0 | **(a)** — consistent with the classic BCD framing and makes the exercise's gate cost interesting; Q1 |
| D3 | Preset data model | (a) per-scope builders (16-array segment presets + separate 32-array decoder presets); (b) uniform 16-array `build()` + store decides planes | **(b)** — one shape, plane rules live in exactly one place (store), same contract as `resetSegment` |
| D4 | Random weights | uniform thirds; 40/40/20; seeded PRNG | **40/40/20 unseeded** — enough 1s to minimize, some X spice; re-roll is one click; seeds would need persistence to be useful |
| D5 | `varNames` shape | (a) `{ 4: string[4], 5: string[5] }`; (b) one 5-array, E first | **(b)** — a renamed E survives 4↔5 toggles for free (same spirit as retaining the E=1 plane) |
| D6 | Rename mechanism | (a) display-time substitution of W/X/Y/Z tokens in SOP strings (fragile: user may name a var `W`); (b) re-derive literals via `names` param | **(b)** — minimize already recomputes per edit; a default param keeps existing callers/tests byte-identical |
| D7 | Preview X rendering | (a) dim amber; (b) hatched pattern; (c) blink | **(a) + dashed stroke** — static, print-friendly, no motion |
| D8 | Preview placement | (a) inside truth-table CardAction; (b) own slim card between grid and table | **(b)** — CardAction is cramped on mobile; the card can host 16–32 code chips comfortably |
| D9 | Selected code persistence | persist in kmapStore; ephemeral | **ephemeral** — defaults to m0; hover makes it mostly redundant |
| D10 | Segment letter labels on display | always on; toggle; never | **on by default, toggleable** (ephemeral) — teaches a–g placement without permanently spending space |

## 8. Store & persistence changes

```
state:      varNames: string[5]                       (Feature B)
actions:    applyPreset(preset)                       (Feature A)
            setVarName(i, name)                       (Feature B)
persist:    name 'logibench-kmap-v1', version 1 → 2
            migrate(persisted, 1) → injects default varNames
            merge: + sanitizeVarNames (regex, length, dedupe → defaults)
untouched:  cells, segment, vars, e1Dirty (shape & semantics)
```

Feature C adds no state beyond KMapTab-local `selectedCode` +
`showLabels` (ephemeral). First client render still matches SSR via the
existing `skipHydration` + post-mount rehydrate flow; new persisted fields ride
the same rehydrate.

## 9. Data flow

```
PresetMenu ──applyPreset(preset)──────────▶ useKmapStore.cells ──▶ KMapTab useMemos
VarNameEditor ──setVarName(i, name)──────▶ useKmapStore.varNames   (terms → gates
                                                    │                → inventory)
DecoderPreviewCard ◀── cells (all 7 segs) ──────────┘
       ▲        ▲
       │        └── hoverCode (KMapTab useState, shared with map + table)
       └── selectedCode (local useState)
SevenSegDisplay(states @ shown code)  ← pure; reused by PresetMenu digit chips
minimize(cells, names) → toMinTerm bakes varNames into literals/sop → SOP card
```

## 10. Files touched (when implemented)

1. **`src/components/logibench/SevenSegDisplay.tsx`** *(new, ~130 LOC)* —
   pure SVG display, `size`/`showLabels` variants (§6.1).
2. **`src/components/logibench/DecoderPreviewCard.tsx`** *(new, ~110 LOC)* —
   card + code chips + hover precedence (§6.2).
3. **`src/data/kmapPresets.ts`** *(new, ~120 LOC)* — `KmapPreset`,
   `KMAP_PRESETS` (§4.1).
4. **`src/components/logibench/PresetMenu.tsx`** *(new, ~140 LOC)* — popover,
   digit chips with mini displays, guarded apply via root-level AlertDialog
   (§4.3).
5. **`src/components/logibench/VarNameEditor.tsx`** *(new, ~90 LOC)* — rename
   chips + inline inputs (§5.4).
6. **`src/store/kmapStore.ts`** — `varNames` + `setVarName`, `applyPreset`,
   version 2 + `migrate` + sanitizer extension (~+80 LOC).
7. **`src/lib/logibench/kmap.ts`** — optional `names` param on
   `minimize`/`toMinTerm` (~+8 LOC, default-preserving).
8. **`src/components/logibench/KMapTab.tsx`** — mount the three new pieces,
   thread `names` into `PlaneGrid`/`minimize`, dynamic explainer/plane
   headings, `selectedCode`/`showLabels` state (~+40 / ~30 edited lines).
9. **`src/components/logibench/TruthTablePanel.tsx`** — `names` prop for
   column headers + dynamic mirror hint (~+10).
10. **`CHANGELOG.md`** — three Added entries under `[Unreleased]`.

Estimated total: ~700–800 LOC. No new dependencies.

## 11. Accessibility

- **Presets:** Popover trigger/roles via Radix; every item is a real button
  with `aria-label` including its effect ("Apply preset Digit 7 only —
  overwrites all seven segments"); AlertDialog announced as dialog (existing
  pattern); confirm copy names the affected segments.
- **Variables:** each rename chip is a labeled button; the inline input
  announces "Rename variable i of n"; duplicate rejection gets
  `aria-live="polite"` hint text; Escape always restores the previous value.
- **Preview:** SVG `role="img"` with a value-complete aria-label; code chips
  are buttons with labels ("Preview input m9 (binary 1001)"); sr-only caption
  explains the hover behavior; **no live region** (hover storms would be
  spam — the existing SOP live region already announces edit results).
- Focus-visible rings everywhere; all touch targets ≥ 44px; keyboard: chips
  are plain tab stops (arrow-key roving optional, matching the map/table
  pattern only if it feels natural at implementation time).

## 12. Responsive behavior

- Header already `flex-wrap`s; Presets/VarName chips join the same flow — no
  fixed widths.
- Preset popover: `align="end"`, `max-h-[70vh] overflow-y-auto`, thin
  scrollbar recipe; digit chip row wraps to 2×5 on narrow widths (mini
  displays hidden below `sm:`, Q4).
- Preview card: `grid md:grid-cols-[auto_1fr]` → stacks on mobile; 16 code
  chips wrap to ~3 rows at 390px (32 chips: two rows-of-16 per plane group);
  display centers at ~140px wide.
- Rename inputs `w-14 min-w-fit`; no horizontal page overflow at 390px.

## 13. Edge cases

- **Preset in 4-var mode never touches stored E=1 edits** (round-trip
  contract preserved); 5-var presets clear `e1Dirty` on touched segments
  (explicit fill).
- **All-X preset** → SOP text "any — every cell is a don't-care" and the
  empty gate lists already handle it (KMapTab.tsx:530–554).
- **Blank decoder** → `terms.length === 0` → "0 (segment always off)" path.
- **Random with zero 1s** → SOP 0 path; applying again re-rolls.
- **Rename while E=1 dirty planes exist** — cells untouched; SOP strings
  re-derive from the same implicants (structure identical, names differ).
- **Duplicate/invalid rename** — previous value kept, hint shown; empty
  commits the slot default.
- **Old v1 localStorage payload** — migrate injects default names; corrupt
  `varNames` sanitizes to defaults without touching cells.
- **Preview before any E=1 edit (5-var)** — shows the mirrored plane, exactly
  like map and table.
- **Hover leave** — preview falls back to the selected chip, never blanks.
- **Hydration** — first render uses defaults/classic; rehydrate lands after
  mount (existing flow).

## 14. Implementation checklist

Order rationale: **C before A** so digit-preset chips can embed the mini
display; **B last** as the only persist-bumping piece.

- [ ] 1. `SevenSegDisplay.tsx` (§6.1) — render a one-off classic-states
      instance in KMapTab as a smoke test, then wire properly in step 2.
- [ ] 2. `DecoderPreviewCard.tsx` + `selectedCode`/`showLabels` state +
      hover precedence (Feature C complete).
- [ ] 3. `kmapPresets.ts` + `applyPreset` store action (plane rules §4.2).
- [ ] 4. `PresetMenu.tsx` popover + guarded-apply AlertDialog (Feature A
      complete).
- [ ] 5. `varNames` slice + `setVarName` + persist v2 `migrate`/sanitizers.
- [ ] 6. `minimize`/`toMinTerm` names param; thread names through KMapTab,
      `PlaneGrid`, `TruthTablePanel`; `VarNameEditor.tsx` (Feature B
      complete).
- [ ] 7. `bun run lint` + dev-server smoke test.
- [ ] 8. Browser verification (§15) + `CHANGELOG.md` entries.
- [ ] 9. Commit (mlger identity) and push.

## 15. Verification plan (agent-browser + regression, at implementation time)

1. **Preview defaults** — open the lab: display shows digit-0 segments lit;
   click chip m7 → matches `DIGIT_GLYPHS[7]`; hover map cell m6 → display
   flips live; mouse leave → back to m7.
2. **Preview reflects edits** — set segment e m4 → 0: at m4 the e bar drops
   to off; set e m4 → X: bar dims.
3. **Presets** — apply "Digit 5 only": every segment map shows a single 1 at
   m5 + X block on 10–15; SOP shrinks. Apply Random twice → different maps.
   Apply All-X → "any — every cell is a don't-care". 4-var preset then 4→5
   toggle → E=1 still shows the mirror hint.
4. **Guard dialog** — edit one cell, apply a decoder preset → dialog names
   the affected segments; "Keep edits" preserves; "Apply preset" overwrites.
5. **Variables** — rename W→D: SOP/literals show D, corner label "DX \ YZ",
   truth-table headers D X Y Z, sanity card still W X Y Z + footnote.
   Duplicate "x" rejected with hint. Reload → names persist (v2 payload);
   cells intact.
6. **Migration** — with a pre-release v1 payload in localStorage, load →
   default names, stored cells preserved.
7. **Minimizer regression** — re-run the audit scripts
   (`/home/z/.cache/audit/kmap-audit.ts`, `kmap-min-repro.ts`,
   `kmap-fix-check.ts`) after the names-param change: 100k fuzz, zero
   failures; classic literal counts 6/5/3/10/4/7/7 unchanged.
8. **Mobile 390px** — header wraps; popover scrolls; preview stacks; chips
   wrap; no page overflow.
9. **Reload persistence** — cells + names round-trip; Reset all / Reset to
   classic behave as today (names untouched).

## 16. Out of scope (future work)

- **Variable-count editing** (2/3/6-variable maps) — engine, Gray geometry
  and the BCD framing are all 4/5-specific today.
- POS/maxterm view; multi-output shared-logic minimization; CSV/URL
  import-export of truth tables (leftovers from docs/kmap-truth-table-plan.md
  §13).
- Undo/redo history (would subsume D1's confirm dialog).
- **User-defined presets** — save the current map as a named, persisted
  preset; share via URL.
- Animated preview transitions (segment fade) — motion budget spent on the
  loop overlay already.

## 17. Open questions (answer before implementing)

1. D2 — confirm digit presets put X on codes 10–15 (chosen) vs hard 0.
   Default: X.
2. D4 — Random weights 40/40/20 acceptable? Default: yes.
3. §5.4 — include the "reset names" mini-action in v1 of the feature?
   Default: yes, tiny text button at the row end.
4. §4.3 — mini 7-seg previews inside digit chips: render at all widths or
   numbers-only on mobile? Default: mini displays at `sm:`+, plain numbers
   below.
5. D1 — arm the confirm dialog on "touched segments differ from classic"
   (chosen); overwriting another preset's output that happens to equal
   classic skips the dialog. Acceptable? Default: yes.
