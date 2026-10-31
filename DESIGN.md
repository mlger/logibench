# LogicBench PH — Design System

*Source of truth for UI decisions. Detected by `/impeccable document` conventions;
maintained by hand. Pair with `docs/tooling-analysis-impeccable-ponytail-context7-ocr.md`.*

## Product context (PRODUCT.md essence)

LogicBench PH is a **breadboard planning lab for EE students**: plan a 74LS/74HC
circuit on virtual breadboards, run the engine + ERC entirely client-side, and
see datasheet-accurate behavior before touching real hardware. Tone: workshop
manual — precise, unsentimental, a little bench-worn.

## Palette

- **Surfaces:** stone scale on white (`stone-50`…`stone-900`), page background `stone-100`.
- **Accent:** amber (`amber-400` icon on dark, `amber-500/50` active states,
  `amber-700` for text/fills that must pass WCAG AA on white — `amber-600` text
  on white fails contrast and is **not allowed**).
- **Status:** emerald-700/800 (run/ok), red-600 (ERC errors) with white text;
  amber-500 badges carry **stone-900** text, never white.
- **Hard rule:** no indigo, no blue (except the one documented sky-blue wire color
  option in the wire palette — wires mimic physical jumper kits).
- Dark canvas: the breadboard SVG sits on `#0c0a09`-family blacks; hole grid is
  canvas art, not DOM.

## Typography

- UI: Tailwind default sans; technical readouts: `font-mono`.
- Scale: header 14–18 px, section headers 12 px semibold uppercase
  (`SECTION` in Palette.tsx, `text-balance` on wrapping headings), body
  `text-xs`/`text-sm`, buttons 11–13 px.
- **Floor: 11 px** for functional text (per the impeccable `undersized-ui-text`
  rule). Two deliberate, reviewed exceptions live in the 3-column sidebar
  palette, where buttons are ≈64 px wide:
  1. `text-[9px]` chip-description captions (primary label is the chip number,
     full name in `title` tooltip),
  2. `text-[10px]` "ref" micro-badges on reference-only chips (decorative
     qualifier; the part number next to it meets the floor).
  These are documented so `detect --github` triage knows they are known debts,
  not oversights. Revisit if the palette ever goes 2-column.

## Components & conventions

- shadcn/ui **New York style** everywhere; buttons `size="sm" h-8` in chrome.
- Stone borders (`stone-200`), `rounded-md`/`rounded-lg`, minimal shadows.
- The breadboard canvas is custom SVG (BreadboardCanvas.tsx): realism beats
  tidiness there — rail art, hole grid, chip notches follow the physical BB830.
- Footer sticks to the viewport bottom; content must push it, never overlay.
- Spacing: `p-4`/`p-6` card padding, `gap-4`/`gap-6` rhythm.

## Verified by

- `bun run lint`
- `npx impeccable detect src/` (pattern rules; exit-gates in CI)
- `npx impeccable detect http://localhost:3000` (rendered rules; the 28 known
  findings are the two exception classes above — anything NEW is a regression)
