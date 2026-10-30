# Changelog

All notable changes to LogicBench PH are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 5-variable K-map mode in the decoder design lab: a 4 vars / 5 vars toggle
  adds the classic two stacked 4×4 planes (E = 0 | E = 1, minterm index
  E<<4 | W X Y Z). The E = 1 plane mirrors E = 0 until you edit it, and E = 1
  edits survive switching back to 4 variables. The Quine–McCluskey minimizer,
  SOP display, term chips, AND-OR / NAND gate lists and inventory check all
  handle the 5th variable (E′ inverter shows up as 7404 stock).
- K-map lab state persistence: the active segment, variable count and all
  seven segment maps live in a Zustand store mirrored to localStorage, so
  edits survive tab switches and page reloads. Includes a "Reset all"
  confirmation dialog, arrow-key navigation between map cells, and a
  screen-reader live region summarizing the minimized result.
- Drag-to-draw wires: press any exposed hole and drag to another hole — a live
  dashed rubber-band in the current wire color follows the pointer, the target
  hole gets a drop ring, and releasing on a hole commits the wire. Releasing
  off-board cancels; the previous editor mode is restored afterwards. The
  click-hole → click-hole flow still works, and plain clicks on holes are
  unaffected (6 px drag threshold).
- Drag-to-trash: while moving a placed part a trash target appears in the
  canvas corner — dropping the part on it removes the part (undoable). The
  dragged part dims to 35 % so the original position stays readable, and the
  drop ring turns red over occupied holes for two-pin parts.
- Drag-and-drop for parts: drag any palette item (chips, displays, discrete
  parts) onto the board to place it — chips/displays drop in one motion,
  two-pin parts drop their first pin then take a click for the second.
  Dragging a placed part moves it (validated, undoable). Pointer-based, so it
  works with mouse and touch; click-to-place remains as a fallback. Live
  drop-target ghost shows green/red validity, floating label follows the
  pointer, drop is cancelled when released off-board.
- 7430 single 8-input NAND gate to the chip library (DIP14; inputs A–F = 1–6,
  G/H = 11/12, Y = 8, NC = 9/10/13; TI SDLS099 verified, Logisim TTL library
  cross-checked).
- Documentation set: [PLAN.md](PLAN.md) (implementation plan),
  [ARCHITECTURE.md](ARCHITECTURE.md) (engine map + ERC catalog),
  [CONTRIBUTING.md](CONTRIBUTING.md) (chip-provenance standard),
  [docs/chip-library.md](docs/chip-library.md) (ChipDef schema guide),
  [CHANGELOG.md](CHANGELOG.md).

### Fixed

- **K-map minimizer could return an SOP that did not match the map.** The
  post-cover "keep only essential primes" filter removed all
  individually-redundant implicants at once — two of them can be jointly
  required, leaving 1-cells uncovered (fuzzing: ~16 % of random 4-var maps,
  ~41 % of 5-var maps, and 2 of the 112 single-cell edits away from the
  classic defaults, e.g. segment g with m1 set to 1). Replaced with
  sequential redundancy pruning: an implicant is dropped only while the
  remaining cover still reaches every 1-cell. 0 failures across 130k fuzz
  trials; all seven classic segment minimizations unchanged (same terms and
  literal counts as plan §4.6).
- K-map gate estimators undercounted hardware: product terms wider than 2
  literals were costed as one 2-input gate (segment d's 3-literal term
  reported one 7408 chip instead of two), and the NAND-only build omitted
  inverters entirely — complemented literals and single-literal terms now
  count as tied-input 7400 gates, with 7410/7420/7411 called out in the
  purpose text. Dead duplicated branches removed.
- K-map edits were wiped by switching tabs (KMapTab unmounted and dropped
  all state) and by reloading the page; state now persists (see Added).
- 5→4 variable toggle silently discarded E = 1 plane edits; the plane is
  now retained in the store and restored when toggling back to 5 variables.
- Inventory "usable stock" counted chips in `suspect` condition; only
  new/used stock counts now (suspect/dead excluded, noted in the card).
- 5161AS (common-cathode) placed from the palette came out as a common-anode
  part: `placeAt` ignored the placement preset for 7-segment displays; it is
  now applied.
- ERC `ls-to-hc` false positive: HCT inputs have TTL-level thresholds, so an
  LS output driving HCT no longer warns; Lab 2's 4511 is placed as HCT.

## [0.1.0] — initial release

- Datasheet-driven chip library (74LS/74HC/HCT + 4511 + 555 + 5161AS/BS
  displays) with per-chip datasheet citations.
- Visual breadboard planner: half 400-pt / full 830-pt boards, split rails,
  drag-to-place DIP chips, color-banded resistors, LEDs, switches,
  pushbuttons, decoupling caps, 5 V supply, 555 clock module, color-coded
  jumper wires.
- Netlist extraction (union-find over strips/rails/wires) and 4-state
  (0/1/Z/X) fixed-point logic simulator with edge-triggered 7490/4511/555
  models, live net coloring, hover net highlight.
- Electrical Rule Check: unpowered chips (7490 pins-5/10 trap), floating
  inputs (LS warn / HC error), contention, output-to-rail shorts, LED/segment
  resistor checks, decoder↔display polarity mismatch, LS→HC level warnings,
  package current budget, missing decoupling caps.
- Two golden demo labs: switches → 7447 → common-anode 5161BS, and
  555 → 7490 → 4511 → common-cathode 5161AS counting at ~1 Hz.
- Chip reference pocket datasheet: pinouts with active-low overlines, truth
  tables, gotchas, LS/HC/HCT family table, 7-seg wiring guide, E24 resistor
  calculator.
- K-map decoder lab: per-segment maps with don't-cares, Quine–McCluskey
  minimization, SOP → gate list (AND-OR and NAND-only), inventory check.
- Parts bin inventory with part-number normalization and buildability (BOM)
  checks with substitution rules.
- Project save/load (SQLite via REST), JSON import/export, SVG export,
  wiring checklist.
