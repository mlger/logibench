# Changelog

All notable changes to LogicBench PH are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 7430 single 8-input NAND gate to the chip library (DIP14; inputs A–F = 1–6,
  G/H = 11/12, Y = 8, NC = 9/10/13; TI SDLS099 verified, Logisim TTL library
  cross-checked).
- Documentation set: [PLAN.md](PLAN.md) (implementation plan),
  [ARCHITECTURE.md](ARCHITECTURE.md) (engine map + ERC catalog),
  [CONTRIBUTING.md](CONTRIBUTING.md) (chip-provenance standard),
  [docs/chip-library.md](docs/chip-library.md) (ChipDef schema guide),
  [CHANGELOG.md](CHANGELOG.md).

### Fixed

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
