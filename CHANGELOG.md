# Changelog

All notable changes to LogicBench PH are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 5-variable K-map mode in the decoder design lab: a 4 vars / 5 vars toggle
  adds the classic two stacked 4×4 planes (E = 0 | E = 1, minterm index
  E<<4 | W X Y Z). Both planes start as copies of the current 4-var map so E
  drops out of the minimized SOP until the E = 1 plane is edited; switching
  back to 4 variables keeps the E = 0 plane. The Quine–McCluskey minimizer,
  SOP display, term chips, AND-OR / NAND gate lists and inventory check all
  handle the 5th variable (E′ inverter shows up as 7404 stock).
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
