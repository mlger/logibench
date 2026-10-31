# Fix plan — jumper wires render *under* the breadboard holes

Status: **plan only, not implemented** (per user request).
Scope: rendering layering in `BreadboardCanvas` — no data-model, netlist, or sim changes.

---

## 1. Symptom (browser-verified)

Loaded Lab 1 in the running app and zoomed in (`agent-browser`, screenshots `/tmp/lab1-before.png`, `/tmp/lab1-zoom.png`):

1. **Wires are chopped into dashes.** Any wire whose arc hugs the board — e.g. the orange BCD jumpers running along rows B/C in Lab 1 — is visually sliced at every tie-point it passes over: the white hole squares paint over the 3.2 px wire stroke.
2. **Wire endpoints are invisible.** Wires plunge straight into holes with no visible connection point. The wire-colored "plug dot" at each end is completely swallowed by the hole graphic, so you cannot tell which hole a wire actually uses or what color it is by looking at the endpoint.

Reproduces on every preset (all three demos share the same renderer).

## 2. Root cause (code)

SVG paint order inside the transformed root group, `src/components/logibench/BreadboardCanvas.tsx` (bottom → top):

| # | Layer | Lines (approx. HEAD) |
|---|-------|----------------------|
| 1 | Board art (`renderBoardArt`) | 585 |
| 2 | **Jumper wires** — arc path, plug dots (`r=2.6`, lines 615–616), 11 px transparent click path | 588–661 |
| 3 | Rubber-band drag preview (`WireDragLayer`) | 664–666 |
| 4 | Board headers | 669 |
| 5 | **Holes (`renderBoardHoles`)** — one group per board | 672 |
| 6 | Parts (`PartGraphic`) | 675+ |
| 7 | ERC focus pulse, wire-end handles, ghost/drop overlays | 709+ |

`renderBoardHoles` (lines 518–565) draws, **per hole**:

- an opaque **6.8 × 6.8 rounded square** — fill `HOLE_FILL #fbfaf5` (near-white) or, while simulating, the logic-level color (`LEVEL_COLORS`, lines 45–47) — lines 538–543;
- the amber hover-net halo `r=7` (line 537);
- a transparent **14 × 14 hit rect** with all pointer handlers (lines 544–557);
- the wire-start pulse ring (line 558).

Because layer 5 sits above layer 2:

- every hole square **paints over** any wire stroke that crosses it → dashed-looking wires;
- every plug dot (`r = 2.6` < the square's 3.4 px half-width) is **fully covered** by the opaque square → invisible endpoints.

Default arcs make this worse near their ends: `wireArc` (`geometry.ts:473`) uses `h = min(46, max(8, 6 + 0.35·dist))`, and a quadratic's height above the chord is `0` at both endpoints — so wires always hug (and get chopped at) the holes near their terminations, and low-arc/short wires get chopped along their whole run.

**Why it was built this way.** The comments admit the intent: wires render *"under the hole hit areas"* (line 587) and holes are *"above wires"* (line 671). That ordering is an **interaction** requirement — the 14 × 14 hole hit rects must win pointer events over the wire's 11 px click path so you can always click/hover/start-a-wire on a hole, even where a wire crosses it. The bug is that the hole *visuals* rode along in the same layer as the hole *hit areas*.

## 3. Fix — split the hole layer into visuals vs. hit areas (recommended)

Single-file change in `BreadboardCanvas.tsx`. Split `renderBoardHoles` into two functions and move the visual half **below** the wire layer; keep the interactive half exactly where it is.

### New paint order (bottom → top)

| # | Layer | Change |
|---|-------|--------|
| 1 | Board art | unchanged |
| 2 | **Hole visuals** — squares, sim level colors, hover-net halos; `pointerEvents="none"` on the group | **moved here (was 5)** |
| 3 | Jumper wires + plug dots | unchanged — now paints *over* hole graphics |
| 4 | Rubber-band preview | unchanged (now above hole visuals automatically) |
| 5 | Board headers | unchanged |
| 6 | **Hole hit areas** — 14 × 14 rects + wire-start pulse ring | stays here (interaction order untouched) |
| 7 | Parts, ERC pulse, wire-end handles, overlays | unchanged |

### Concrete steps

1. **Extract `renderHoleVisuals(b)`** from `renderBoardHoles`: the hover-net halo (line 537) + the square (lines 538–543) only. Wrap the returned `<g>` with `pointerEvents="none"` so the squares can never intercept events.
2. **Slim `renderBoardHoles` down to `renderHoleHitAreas(b)`**: keep the transparent 14 × 14 hit rect with its handlers (lines 544–557) and the wire-start pulse ring (line 558). Hit rects alone are invisible, so nothing is painted over wires.
3. **Move the visual call** right after board art (line ~585): `{boards.map((b) => renderHoleVisuals(b))}`; render hit areas at the current position (line ~672) with the comment updated to *"hole hit areas — above wires so hole clicks win over wire clicks; visuals live below the wire layer"*.
4. **Optional polish (recommended, 3 lines):** while simulating, draw the level-colored square at **8.4 × 8.4** instead of 6.8 (or add a 1.2 px stroke ring in the level color) so the HIGH/LOW color still peeks out around a 3.2 px wire stroke instead of hiding underneath it. Non-level holes keep 6.8.
5. Update the stale comment on the wire layer (line 587) to say wires render *above hole visuals, under hole hit areas*.

### Effects after the fix

- Plug dots (`r=2.6`, wire color) become visible inside each hole square → every connection point is readable at a glance.
- Wire strokes run continuously over hole squares → no more dashed wires.
- Hover-net halos sit under wires (wires no longer get tinted by the translucent amber circle — slightly cleaner than today).
- Everything interaction-related is bit-for-bit identical (see §5).

## 4. Alternatives considered / rejected

- **B — make hole squares semi-transparent** (e.g. `opacity 0.5`): one-line change, but wires still read as "under a milky film", sim level colors wash out, and hover halos double-blend. Rejected.
- **C — move the whole wire layer above the holes layer as-is**: fixes the visuals but puts the wire's 11 px click path above the hole hit rects → clicking a hole where a wire crosses would select the wire (or steal drag-to-wire gestures). Only viable combined with the same hit-layer split — i.e. it degenerates into §3. Rejected as a shortcut.
- **D — per-wire `bends`/routing to avoid crossing holes**: addresses a different (P3) concern; massive overkill for a paint-order bug.

## 5. Invariants that must keep holding (regression checklist)

1. **Hole priority**: where a wire crosses a hole, click/hover still targets the hole (hit layer above wire click path).
2. **Wire selection**: clicking a wire along its length still selects it (11 px path intact, still under hole hit rects).
3. **Drag-to-wire**: press-drag from any hole still opens the rubber band; the dashed preview now also renders above hole visuals (no chopped preview).
4. **DnD**: drop-target ring, chip ghost rect, two-pin placement line, trash target — all unaffected (top layers).
5. **Selected-wire affordances**: lift handle, bend handles, and re-terminate end handles stay on top (unchanged layers 7+).
6. **ERC deep-link pulse** and wire-start pulse ring remain visible above wires.
7. **Sim level colors** remain legible at wire-occupied holes (§3 step 4 mitigates).
8. **Parts** still cover their pin holes (chip body above everything on the board surface) — unchanged relative order.

## 6. Verification plan

1. `bun run lint` — clean.
2. Browser E2E (agent-browser), Labs 1–3:
   - load demo → zoom in → screenshot: plug dots visible at every wire endpoint in the wire's color; no chopped strokes along row-run wires;
   - hover a hole → net halo appears and is not hidden by wires;
   - click a hole directly under a crossing wire → wire-start ring / net highlight reacts (hole wins);
   - click a wire mid-span → wire selects, lift/bend/end handles appear;
   - drag-to-wire between two holes → rubber band renders unbroken;
   - press **Simulate** → level-colored squares visible around wire-terminated holes; legend unchanged;
   - ERC: click an issue with a hole ref → red pulse ring still renders.
3. Check `dev.log` for runtime errors after the run.

## 7. Effort & risk

- **Diff**: one file (`BreadboardCanvas.tsx`), ~50–80 lines net (mostly moving code between two functions).
- **Risk**: low — no store/geometry/netlist changes; interaction layers untouched.
- **Time**: ~30–60 min including the E2E pass.

## 8. Roadmap slot

Independent of, and zero-conflict with, the approved wiring backlog (`docs/wiring-analysis-and-improvements.md` P1–P4, which touches `netlist.ts` / `erc.ts` / `projectStore.ts` / `demo.ts`). Recommended as its own quick PR — e.g. `fix(canvas): draw jumper wires above hole graphics` — executed **before the P1 batch**, or bundled with it if preferred. Note for later: P2-e (per-net labels) will also want to render in a top layer like the ERC pulse, above wires — same recipe as this split.
