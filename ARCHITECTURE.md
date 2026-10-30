# Architecture

How LogicBench PH fits together. Section references (`plan §x.y`) point into
[PLAN.md](PLAN.md); the implementation note there explains where the shipped
stack (Next.js 16) intentionally deviates from the plan's default (Vite).

## The one invariant

**The engine (`src/lib/logibench/`) is pure TypeScript with zero DOM and zero
React dependencies.** It can run headlessly (unit tests, future Web Worker) and
the UI is a thin view over it. This mirrors the model/view split recommended in
plan §5.4.

## Data flow (per user edit)

```
projectStore (Zustand, undo/redo)
      │  project = { boards, parts, wires }
      ▼
buildNetlist()            geometry.ts + unionFind.ts
  hole enumeration → strip/rail pre-unions → wire unions → nets
      │  Net[] { holes, pins, isVccRail, isGndRail, resistors }
      ▼
Simulator (sim.ts)        4-state fixed-point iteration  (plan §5.3)
  drivers (outputs, switches, rails, pull-ups) vs receivers (inputs)
  edge-triggered models: 7490 counter, 4511 latch, 555 clock
      │  SimResult { netLevels, holeLevels, ledStates, segStates,
      │              poweredChips, counterValues, issues }
      ▼
erc.ts                    rule layer on top of (netlist, sim, chipDefs)
      │  SimIssue[] { rule, severity, title, detail, why, refs }
      ▼
React view (components/logibench/)
  net-colored canvas, LED/segment rendering, Inspector, ERC/BOM panel
```

The store re-runs this pipeline after every mutation; it is cheap because
everything is a pure function over a small project graph (a breadboard project
is hundreds of holes, not millions of SPICE nodes).

## Module map

| File | Responsibility | Plan ref |
|---|---|---|
| `lib/logibench/types.ts` | All shared models: `ChipDef`, `Project`, `Net`, `SimResult`, `SimIssue`, inventory & K-map types | §5.1 |
| `lib/logibench/geometry.ts` | **Single source of truth** for breadboard geometry: hole enumeration, `chipFootprint()`/`chipPackage()` (defId → DIP8/14/16), placement validation, `pinCount()` | §5.4 |
| `lib/logibench/unionFind.ts` | Disjoint-set over integer nodes; the substrate for strip/rail/wire unions | §5.2 |
| `lib/logibench/netlist.ts` | Hole enumeration → strip groups → wire unions → `Net[]`; marks VCC/GND rails and resistor adjacency | §5.2 |
| `lib/logibench/sim.ts` | 4-state (0/1/Z/X) fixed-point simulator with drive strengths (`strong`/`weak`/`open`); family behavior via `floatReads` (LS floats HIGH, HC floats X); edge-triggered 7490/4511/555 models | §5.3 |
| `lib/logibench/erc.ts` | Pure function `(netlist, sim state, chip defs) → SimIssue[]`, every rule carrying a datasheet-cited `why` | §3.2 |
| `lib/logibench/kmap.ts` | Per-segment K-map + Quine–McCluskey minimization + SOP → gate-list synthesis (AND-OR and NAND-only) | §3.3, §4.6 |
| `lib/logibench/bom.ts` | BOM extraction + "can I build this?" inventory check with substitution rules (HCT→LS ok, HC→LS warn, 7447 ≠ 7448) | §3.4 |
| `lib/logibench/partNumber.ts` | `SN74LS47N` → `{ base: "7447", family: "LS" }`, `CD4511BE` → `4511`/CD4000, `NE555P` → `555` | §3.4 |
| `lib/logibench/eseries.ts` | E12/E24 preferred values, nearest-value lookup, resistor color bands | §3.3 |
| `lib/logibench/demo.ts` | The two golden acceptance circuits (7447 lab, 555→7490→4511 lab) | §6 |
| `data/chips.ts` | Datasheet-driven chip library — see [docs/chip-library.md](docs/chip-library.md) | §4 |
| `store/projectStore.ts` | Zustand store: project state, selection, undo/redo, placement checks, sim loop, live switch toggles | §5.4 |
| `components/logibench/` | `AppShell`, `BreadboardCanvas` (SVG, click-to-place/wire), `Palette`, `Inspector`, `BottomPanel` (ERC/BOM/wiring checklist), `ReferenceTab`, `KMapTab`, `InventoryTab` | §3.1–§3.4 |
| `app/api/projects`, `app/api/inventory` | REST over Prisma/SQLite (`SavedProject`, `InventoryItem` tables) | §5.5 |

## ERC rule catalog

Every issue the checker can raise, with its severity logic (plan §3.2).
Severity for floating inputs is family-dependent by design — LS TTL inputs
float HIGH harmlessly, HC CMOS inputs floating is a real fault.

| Rule | Severity | Fires when |
|---|---|---|
| `no-supply` | error | No 5 V supply part on the board |
| `supply-unwired` | error | Supply present but its terminals aren't on the rails |
| `unpowered-chip` | error | Chip VCC/GND pins not on powered rails (knows the 7490's pins 5/10 trap) |
| `floating-input` | warning (LS) / error (HC/HCT) | Gate/decoder input on a net with no driver |
| `counter-reset-floating` | error | 7490 MR/MS pair floating (would randomly reset) |
| `contention` | error | Two opposing strong drivers on one net |
| `output-to-rail` | error | Output tied straight to the opposite-level rail |
| `led-no-resistor` | error | LED with no series resistor |
| `led-overcurrent` | warning | Series resistor allows > ~20 mA |
| `segment-no-resistor` | error | 7-seg segment driven without a resistor |
| `polarity-mismatch` | error | Common-anode display ↔ 4511 (or common-cathode ↔ 7447) |
| `ls-to-hc` | warning | LS output driving a plain-HC input (VOH 2.7 V < VIH 3.15 V); HCT is exempt |
| `package-current` | error | Sum of segment currents exceeds the chip's `iccMaxmA` budget (4511 50 mA) |
| `no-decoupling` | info | Powered IC with no 0.1 µF cap on its rail strip |
| `rails-split-note` | info | Split-rail board where a rail half is unused/unpowered |
| `clock-unpowered` | error | 555 module VCC/GND not on rails |
| `pin-collision` | error | Two part pins land on the same hole |

## Deliberate simplifications

- **Electricity by rules, not SPICE** (plan §3.2): static-level analysis with
  drive strengths covers the teaching failure modes (floating inputs,
  contention, missing resistors, polarity, current budgets) without solving
  the circuit.
- **NAND evaluation is width-agnostic**: `evalGate` treats a unit's `inputs`
  uniformly, so the 7430's 8-input unit needed no simulator change.
- **Counters/555 are event models**, not transistor models: they advance on
  clock edges with datasheet-derived timing constants.
- **Resistors are net-adjacency edges**, not solved nodes — enough for LED/
  segment current estimates from the datasheet VOH/VOL figures.
