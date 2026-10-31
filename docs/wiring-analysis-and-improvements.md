# Breadboard Wiring — Analysis & Improvement Backlog

**Status:** analysis only — nothing here is implemented yet.
**Date:** 2026-10-30
**Method:** read `netlist.ts`, `geometry.ts`, `erc.ts`, `sim.ts`, `projectStore.ts`, `BreadboardCanvas.tsx`, `demo.ts`; ran a throwaway wiring-stats script over the three golden demos (wire counts, spans, color histogram, chip-body crossings, bare-plastic landings, tie-point utilization).

---

## 1. How wiring works today (inventory)

| Layer | File | Behavior |
|---|---|---|
| Data model | `types.ts` | `Wire { from, to, color, lift?, bends? }` — point-to-point arc between board-qualified `HoleRef`s. `bends` reserved, unimplemented. |
| Connectivity | `netlist.ts` | Union-find: column strips (a–e, f–j), rail groups per `railLayout` (continuous / center-split / groups5 staggered), wire unions, closed switch/button unions. Resistors/caps/LEDs are *elements*, not unions; resistor adjacency feeds weak pulls. |
| Geometry | `geometry.ts` | Single source of truth. `holeExists()` = groups5 gaps are bare plastic; footprints force chips to straddle e/f; `wireArc()` quadratic with distance-scaled lift; `occupiedHoles()` = one lead per tie-point. |
| Editor guards | `projectStore.addWire` | Rejects occupied holes **and** nonexistent (rail-gap) holes. |
| ERC | `erc.ts` | 20 rules incl. pin-collision, stacked-holes, rail-shorted, rail-group-unpowered, output-to-rail, contention, polarity-mismatch, LS→HC, no-decoupling. |
| Canvas UX | `BreadboardCanvas.tsx` | Click-click + drag-to-wire, rubber-band preview, net hover highlight (`netHolesFor`), per-wire lift handle (±60 px), 10-color palette. |

## 2. What's already solid (verified, not just assumed)

- **Zero demo landings on bare plastic** across all three labs — editor validation works and demo hygiene holds.
- One-lead-per-tie-point enforced at edit time; `stacked-holes` ERC catches legacy projects.
- Rail-group realism (groups5) is exercised end-to-end: demos bridge groups, ERC catches dead sections.
- Board delete/duplicate correctly carries/filters wires (`projectStore.ts:441–488`).
- Hover net-highlight and ERC-issue→part selection both exist.

**Demo wiring stats (measured):**

| Lab | parts | wires | avg span | max span | utilization | landings on gaps | wires arcing over a chip body |
|---|---|---|---|---|---|---|---|
| 1 (7447) | 19 | 15 | 8.1 | 21 | 21.4 % | 0 | 2 |
| 2 (4511) | 14 | 21 | 6.3 | 17 | 25.0 % | 0 | 7 |
| 3 (two boards) | 13 | 27 (6 cross) | 7.5 | 12 | 6.5 % | 0 | 5 |

---

## 3. Suggested improvements

### P1 — Correctness / cheap wins

**P1-a. Phantom-hole nets.** `enumerateHoles()` creates union-find nodes for **all** columns including groups5 rail gaps (`netlist.ts:20–34`, no `holeExists` check). The editor can't place anything there, but a hand-edited/older project JSON can carry a wire ending on `main:7:+T` (bare plastic) — it silently unions a tie-point that doesn't exist.
→ Skip nonexistent holes in `enumerateHoles`, and add ERC rule `phantom-hole` (error) for any part pin or wire end on a nonexistent hole. Closes the model gap; ~20 lines.

**P1-b. Wrong rejection message.** `addWire` uses one flash — *"That hole is taken — one lead per tie-point"* — for both an occupied hole and a rail-gap landing (`projectStore.ts:249–256`). The second case should say *"That's a gap in the rail — nothing to plug into."* Tiny fix, high clarity for exactly the moment a learner is confused.

**P1-c. Latent output contention.** ERC flags contention only when two drivers *currently* disagree. Two push-pull outputs tied to one net that happen to agree right now (e.g. before a clock edge) pass clean.
→ Static info/warning rule `wired-outputs`: ≥2 strong `out` drivers on one net, regardless of current levels.

**P1-d. `pinNet` is O(P) per call.** It does `project.parts.find()` on every query (`netlist.ts:154–159`) and is called constantly by sim + ERC.
→ Precompute a `pin → net` Map in `NetlistResult`. Trivial, removes O(P²) behavior as circuits grow.

### P2 — Realism & pedagogy

**P2-a. Bottom rails are dead weight in Labs 1–2.** The supply sits on the top rails only, so low-side connections reach *up* across the whole board: Lab 2's 7490 GND jumper `(9,h)→(9,−T)` runs the full board height, arcing over the chip (biggest single clutter source — 7 of Lab 2's chip-over arcs). Real builders bridge top↔bottom rails once at the left edge.
→ Add two rail bridges (`+T→+B`, `−T→−B`) at col 1, rewire low-side GND/common pins to `−B`. Turns Lab 2's longest vertical into a 2-row hop; makes the 4-rail model earn its keep. Optional in Lab 3 (cross-board already dominates).

**P2-b. Reversed-chip gotcha is unmodelable.** Backwards DIP insertion (pin 1 at the wrong end → power reversed) is *the* classic bench accident. Data model has no orientation flag.
→ `PartInstance.reversed?: boolean` + ERC `chip-reversed` (power pins land swapped → treat as unpowered/shorted) + Inspector toggle. High pedagogy value, moderate cost.

**P2-c. Pull-resistor value is ignored.** Sim models resistor pulls as weak drives of *any* ohms (`sim.ts:250–254`) — a 100 kΩ pull-down on an LS input reads exactly like the demos' 1 kΩ (which is correctly sized: 0.4 mA × 1 kΩ = 0.4 V < V_IL 0.8 V).
→ ERC rule `weak-pull`: warn when a pull on a TTL input exceeds the family budget (LS pull-down ≤ 2 kΩ; HC/CD4000 have their own limits). Also lets Lab 1's "why 1 kΩ" note become a live check.

**P2-d. Smart wire color assist (opt-in).** Demos follow a strict convention (red/black power, orange rail bridges, green clock, teal data, amber control); the editor defaults everything to orange.
→ When a wire endpoint's net is classified VCC → suggest red; GND → black; else keep the picked color. A toggle in the Palette; keeps user override.

**P2-e. Net / wire labels.** Lab notes explain "teal = BCD", but the canvas doesn't.
→ Optional per-net label rendered at the wire apex ("Q0→A"). Data model + Inspector + canvas text; also improves netlist export readability.

### P3 — Routing & ergonomics

**P3-a. Auto lift-side choice.** `wireArc` bows left of from→to; interior-column verticals therefore arch over chip bodies (17 flagged across the demos). Bowing toward the nearest board edge for rail-verticals would clear most of them; per-wire `lift` stays as the manual override (drag handle already exists).

**P3-b. Tiered arc heights for bundles.** The 7 segment resistors and the 4 teal BCD jumpers share parallel paths; identical apex heights overlap. Offset heights per parallel wire (short hops low, long jumpers high — `wireArc` already scales by distance, just de-collide ties).

**P3-c. Manhattan bends for cross-board jumpers.** `Wire.bends` is reserved but unimplemented. Lab 3's four teal Q-jumpers run long diagonals across both boards; routing them through the gap channel (polyline) would read far better. Implement `bends` or drop the field.

**P3-d. Auto power-wire helper.** 5–7 of each demo's wires are hand-placed VCC/GND pins-to-rails. A one-click "wire this chip's power to the nearest free rail holes" removes the most repetitive step (there's even a stray doc comment about auto-wiring hints in `geometry.ts:143` — finish the idea).

**P3-e. ERC → canvas deep-link.** Issue clicks select the part (`BottomPanel.tsx:77–79`); extend to pulse the exact offending hole (`refs[].hole` already exists in the schema) and select the wire when the rule is wire-related.

**P3-f. Re-terminate a wire by dragging its end.** Today you can only delete + redraw; dragging an existing wire's endpoint to a new hole (keeping color/id) is a natural gesture that's missing.

### P4 — Bigger features

**P4-a. Real NE555 DIP8 with RC network.** The 555 is currently a 3-pin module with a `freqHz` prop. Modeling the real part (GND/TRIG/OUT/RESET/CTRL/THRES/DISCH/VCC) and letting `f = 1.44/((RA+2RB)C)` emerge from actual resistor/cap parts is the single biggest realism upgrade left, and it exercises the element model already built for LEDs. Keep the module as an easy-mode.

**P4-b. Netlist hover cache.** `netHolesFor` rebuilds the entire netlist on every hover. Fine at demo scale; cache per project revision if circuits grow.

### Demo wiring micro-fixes (when implementing)

1. **Lab 1 decoupling cap:** `(3,g)→(10,b)` is a 12-span diagonal over the whole 7447. The GND *net* includes the −T rail, so `(3,g)→(4,−T)` is electrically identical and physically local. (Verified `(4,−T)` is free and on the GND net.)
2. **Lab 2 7490 GND:** re-terminate to `−B` per P2-a (2-row hop instead of full-height arc).
3. **Lab 2 teal bundle:** Q3→D must cross Q0/Q1/Q2 by pinout — de-collide with tiered lifts (P3-b) rather than re-ordering (pinout forces the crossing).

---

## 4. Suggested execution order (when approved)

1. P1-a, P1-b, P1-c, P1-d — one small PR, all testable via `bun run audit`-style scripts.
2. P2-a + demo micro-fixes — one "wiring polish" PR; re-run browser E2E on all three labs.
3. P2-b, P2-c, P2-d — ERC + editor increments, each with an audit check.
4. P3 batch (a→f) — UX pass.
5. P4-a — dedicated milestone (real 555), P4-b rides along if needed.
