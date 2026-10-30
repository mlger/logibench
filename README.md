# LogicBench PH

**Plan your 74LS/74HC breadboard pin-for-pin before you touch hardware** — a datasheet-driven
chip library, visual breadboard planner, 4-state logic simulator, rule-based electrical
checker (ERC), 7-segment decoder labs, K-map tool, and a personal chip inventory — built for
the chips you actually find in Philippine school labs and electronics shops
(7400/02/04/08/32/86, 7447/48, 4511, 7490, 555, 5161AS/BS displays).

Built with Next.js 16 + TypeScript + Tailwind + shadcn/ui + Prisma (SQLite).
The logic engine, netlist extractor, simulator and ERC run **entirely in the browser**.

## What it does

| Feature | Where |
|---|---|
| Visual breadboard (half 400-pt / full 830-pt, split-rail option), drag-to-place DIP chips, resistors (color-banded), LEDs, switches, pushbuttons, 0.1 µF caps, 5 V supply, 555 clock module, jumper wires with color picker | **Bench** tab |
| Live netlist extraction (union-find over strips/rails/wires) + 4-state (0/1/Z/X) fixed-point simulator with net color coding, hover-any-hole net highlight | **Bench** tab |
| Electrical Rule Check: unpowered chips (incl. the 7490 pins-5/10 trap), floating inputs (LS warn / HC error), output contention, output-to-rail shorts, LED/segment resistor checks, decoder↔display polarity mismatch, LS→HC level warnings, package current budget, missing decoupling caps | Bench → bottom panel |
| Two golden demo labs: switches → 7447 → common-anode 5161BS, and 555 → 7490 → 4511 → common-cathode 5161AS counting at 1 Hz | Top bar → Demos |
| Pocket datasheet: clickable pinouts with active-low overlines, truth tables with rendered glyphs, common-mistakes lists, datasheet links (TI/onsemi/Nexperia, cited with revisions), LS/HC/HCT family table, 7-seg wiring guide, resistor calculator (E24 + color bands) | **Chip reference** tab |
| Decoder design lab: per-segment interactive K-map (don't-cares for 10–15), Quine–McCluskey minimization (reproduces the classic §4.6 equations), SOP → gate list (AND-OR and NAND-only) → inventory check | **K-map lab** tab |
| Parts bin CRUD with part-number normalization (`SN74LS47N` → base `7447`, LS) and "Can I build this circuit?" BOM check with substitution rules (HCT→LS ok, HC→LS warn, 7447 ≠ 7448) | **Inventory** tab |
| Project save/load (SQLite via API), JSON import/export, SVG export, bench wiring checklist with tick boxes | Top bar + bottom panel |

## Run it

```bash
bun install
bun run db:push     # create SQLite schema
bun run dev         # http://localhost:3000
```

The dev server must run on port 3000. Environment: `DATABASE_URL=file:./db/custom.db` (see `.env`).

## Architecture

```
src/
  lib/logibench/        pure TypeScript engine (no DOM, no React)
    types.ts            ChipDef / Project / Net / SimResult models (plan §5.1)
    unionFind.ts        disjoint-set for strip/rail/wire unions
    netlist.ts          hole enumeration → nets (plan §5.2)
    sim.ts              4-state fixed-point sim + edge-triggered 7490/4511/555 models
    erc.ts              rule-based electrical checks with datasheet "why"s (plan §3.2)
    kmap.ts             Quine–McCluskey + gate-list synthesis (verified vs plan §4.6)
    geometry.ts         breadboard/footprint geometry (single source of truth)
    bom.ts              BOM + buildability with substitution rules (plan §3.4)
    partNumber.ts       SN74LS47N → {7447, LS}
    eseries.ts          E12/E24 + color bands
    demo.ts             golden demo circuits
  data/chips.ts         datasheet-driven chip library (plan §4)
  store/projectStore.ts Zustand project store (undo/redo, sim loop, live switches)
  components/logibench/ Bench (SVG canvas, palette, inspector, ERC/BOM/wiring panel),
                        Chip reference, K-map lab, Inventory
  app/api/              inventory + projects REST routes (Prisma/SQLite)
```

Key principle (borrowed from DigitalJS's MVC split): **the engine is pure TypeScript with
zero DOM dependencies**, so it can be unit-tested headlessly and later moved into a Web Worker.

## Datasheet data & honesty

Every chip definition cites vendor + document + revision in `src/data/chips.ts` and
`docs/datasheet-sources.md`. Values that could not be verified against a primary source are
flagged in-app (the 7447/7448 "unique symbols" for codes 10–14 carry a *verify* badge).
The classic K-map segment equations are derived live from the digit glyphs and reproduce the
published equations for digits 0–9.

## Documentation

- [PLAN.md](PLAN.md) — the full implementation plan (goals, prior art, feature specs, chip data, architecture, roadmap, testing)
- [ARCHITECTURE.md](ARCHITECTURE.md) — engine data flow, module map, complete ERC rule catalog
- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup and the datasheet-provenance standard for adding chips
- [docs/chip-library.md](docs/chip-library.md) — `ChipDef` schema authoring guide
- [docs/datasheet-sources.md](docs/datasheet-sources.md) — every electrical value traced to its source
- [CHANGELOG.md](CHANGELOG.md) — release history

## Roadmap

- Phase 2: 74192/74193/74390/74138 simulation models (74138 already simulated), 74HC595, timing view
- Phase 3: schematic view, URL sharing, guided labs, Web Serial hardware-in-the-loop (desktop Chromium + Firefox 151+)

## License

MIT — see [LICENSE](LICENSE). No Fritzing graphics or GPL simulator code was used.
