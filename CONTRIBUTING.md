# Contributing

## Dev setup

```bash
bun install
bun run db:push     # create SQLite schema (DATABASE_URL=file:./db/custom.db in .env)
bun run dev         # http://localhost:3000 — must stay on port 3000
bun run lint        # ESLint — must pass before committing
```

No test runner is wired up; the two golden demo circuits
(`Demos` in the top bar) are the acceptance tests: if both labs render, count,
and pass ERC without errors, the engine is healthy.

## Adding a chip to the library

The chip library is the heart of the app, so new chips must meet the
**datasheet-provenance standard**. This is the process used for the 7430 and
it exists because a wrong pinout or a made-up electrical value is worse than a
missing chip.

### 1. Get a primary source

Find the vendor datasheet (TI, onsemi, Nexperia — scanned TI sheets are fine,
read the package TOP VIEW drawing). Record **vendor + document + revision +
URL** in `docs/datasheet-sources.md` under the right section. If you must take
a figure from a secondary source (e.g. the TI original is a scan and another
vendor's copy is text), say so inline in that table.

### 2. Read the pinout off the drawing, pin by pin

Don't trust memory or "standard pinout" claims — the 7430 is a 14-pin NAND
with inputs on 1–6, 11, 12 and NC on 9/10/13, and the 7402 is output-first.
Note every `activeLow` pin (overline in the datasheet symbol) and output kind
(`open-collector`, `pullup-oc` for BI/RBO-style pins).

### 3. Write the `ChipDef`

In `src/data/chips.ts`, in numeric order (7420 → 7430 → 7414). Use the helpers
when they fit:

- `quadGate(id, name, fn, families)` — standard quad gates;
- `TI_LS(id, ...)` electrical presets — then override what the datasheet says.

Key fields (full guide: [docs/chip-library.md](docs/chip-library.md)):

- `pins[]` — every pin, including `nc` ones;
- `power: { vcc, gnd }` — usually 14/7, **but the 7490 is 5/10**;
- `units[]` — gate units `{ fn, inputs, output }` if it has a sim model;
- `gotchas[]` — the classic mistakes someone will make with this chip;
- `refOnly: true` — if there's pin data but no sim model yet.

### 4. Register the package

Add the id → package mapping in `chipPackage()`'s `known` table in
`src/lib/logibench/geometry.ts`. It defaults to `DIP14`, so DIP16 parts
(74192/74193/74390) **must** be registered explicitly.

### 5. Cross-check against an independent source

Compare your pin table against a second, unrelated catalog (the MIT-licensed
`cocot-gf/Logisim-BIG-TTL-CMOS-Library` 74-series catalog is the usual pick).
Log the cross-check in `docs/datasheet-sources.md` → *Cross-checks*. If the two
sources disagree, stop and resolve it against the datasheet drawing.

### 6. Flag what you couldn't verify

Never silently guess. Use `glyphVerify` (the 7447/7448 symbols for codes
10–14), `refOnly`, or a `gotcha` line. In-app honesty beats a confident wrong
value — see *Known verification gaps* in `docs/datasheet-sources.md`.

### 7. Verify in the app

1. `bun run lint` passes;
2. Place the chip on the bench — footprint straddles the center channel
   correctly, pins land on the right holes;
3. Chip reference tab renders the pinout (active-low overlines included) and
   truth table;
4. ERC correctly reports `unpowered-chip` before power wiring and stops after
   wiring VCC/GND;
5. If it has a sim model: toggle its inputs and watch the output net change.

### 8. Commit

Imperative-mood summary naming the chip, e.g. `Add 7430 single 8-input NAND
gate to chip library`. Update `docs/datasheet-sources.md` in the same commit.

## Docs discipline

- `README.md` — what the app does, cross-references plan sections;
- `PLAN.md` — the implementation plan (source of the `plan §x.y` refs);
- `ARCHITECTURE.md` — update when adding an engine module or an ERC rule;
- `docs/datasheet-sources.md` — update with every chip or electrical value;
- `docs/chip-library.md` — update when the `ChipDef` schema changes;
- `CHANGELOG.md` — one bullet per user-visible change under *Unreleased*.
