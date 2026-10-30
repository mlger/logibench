# Implementation Plan: "LogicBench PH"-style 74LS/74HC Breadboard Manager for 7‑Segment Logic Circuits

> **Implementation note:** this is the original planning document. The shipped
> app uses Next.js 16 (App Router) + SQLite/Prisma instead of the default Vite
> stack — plan §5.5 explicitly allows stack changes. See
> [ARCHITECTURE.md](ARCHITECTURE.md) for how the shipped code maps to the plan;
> source comments cite plan sections as `plan §x.y`.

Build it as a Vite + React + TypeScript static PWA whose core is a **datasheet-driven chip library (JSON) + breadboard netlist extractor + 4‑state event-driven logic simulator + rule-based electrical checker**, shipped in three phases (MVP ≈ 6–8 part-time weeks), because no existing tool combines pin-accurate breadboarding, LS/HC-aware error checking, a 7‑segment decoder lab workflow, and a personal chip inventory in one offline app.

## TL;DR
- **Build, don't fork:** The closest prior art (74Sim, LogicBench, Wokwi, CircuitVerse, Falstad) each cover part of the need, but none ties a breadboard planner to *your own parts bin* and a K‑map → gates → 7‑segment lab flow; reuse MIT/BSD pieces (wokwi-elements graphics, permissively licensed 7400 pin data) and avoid GPL/Fritzing graphics if you want licensing freedom.
- **Simulate logic, check electricity by rules:** A 4‑state (0/1/Z/X) event-driven simulator plus an "electrical rule check" layer encoding datasheet facts (LS VOH min 2.7 V vs HC VIH 3.15 V, 7447 open-collector/common-anode, 4511 common-cathode 10 mA outputs, 595's 70 mA package limit, floating-input rules) gives 95% of the teaching value at a fraction of SPICE's complexity.
- **Ship order:** MVP = chip reference + inventory + breadboard placement + netlist + combinational sim + 7‑seg display + core error checks; v1 = counters/555 clock, full error checks, K‑map designer, BOM/exports; later = schematic view, URL sharing, guided labs, Web Serial hardware-in-the-loop (desktop Chrome/Edge/Opera, and Firefox 151+ per Mozilla; no Safari).

## 1. Goals and Non-Goals

**Primary goals (for Mark, a web/Android/embedded developer in the Philippines):**
1. Plan a real breadboard layout pin-for-pin before touching hardware, so what's on screen matches what goes on the bench.
2. Catch the mistakes that actually kill 7‑segment labs: wrong decoder for the display polarity, missing VCC/GND, floating HC inputs, missing segment resistors, LS→HC level mismatches.
3. Serve as an offline pocket datasheet for the chips commonly found in Philippine school labs and electronics shops (7400/02/04/08/32/86, 7447/48, 4511, 7490, 74192/193, 74138, 595, 555).
4. Track what chips you own, and answer "Can I build this circuit with what's in my box?"

**Non-goals (at least for MVP):** analog SPICE accuracy, PCB layout, microcontroller emulation, user accounts/cloud sync. Keep it a static site so it costs ₱0 to host and works without internet in a lab.

## 2. Prior Art and Gap Analysis

| Tool | What it does well | License / reuse | Gap for this app |
|---|---|---|---|
| **74Sim** (74sim.com) | Closest competitor: virtual breadboard with 74 series chips, switches, LEDs; models LS, HC, HCT (and LVC) families; 555 and CMOS 4000 parts; SPICE-style solver (Gaussian elimination with partial pivoting) | Source posted at github.com/DeanKuruzovich/74SimSource; license not confirmed in this research, so check before reusing any code | No inventory, no K‑map/decoder-design workflow; VCC fixed at 5 V |
| **LogicBench** (logicbench.online) | 45+ datasheet-based 74‑series ICs, breadboards, Arduino sketches, "DLD-lab-style failure behaviour" | Proprietary web app | Closed; no parts-bin tracking |
| **Wokwi** | Excellent MCU simulation; Custom Chips API (C → WebAssembly, chip.json pin definitions); 74HC595 built in | **wokwi-elements is MIT** (Lit web components for LEDs, 7‑segment, resistors, etc.); its README states the elements "only provide the presentation and display of the represented hardware" and "do not provide the functional simulation code," and the breadboard element is missing from source (GitHub issue #172, opened Sep 26, 2024, still open) | MCU-centric; not a discrete-logic lab tool |
| **CircuitVerse** | Gate-level schematic sim, truth-table → circuit generation, timing diagrams, embeds | **MIT** | Schematic only; no breadboard or pin-level wiring |
| **Logisim‑evolution** | Mature desktop simulator with TTL library, chronograms, VHDL | **GPL‑3.0** (Java) | Desktop app; schematic only |
| **Falstad CircuitJS1** | Real analog + digital sim in browser; often used for 7‑seg decoder labs | **GPL‑2.0** | No breadboard; generic |
| **DigitalJS** | Teaching-focused JS digital simulator (Yosys netlists), MVC split between engine and view | **BSD‑2‑Clause** (npm `digitaljs`) | HDL-oriented; good reference design for the engine |
| **Fritzing** | Best-known breadboard view | Code GPL‑3; parts graphics CC BY‑SA 3.0, **but the Fritzing FAQ says "we do not allow the use of Fritzing part graphics in other software systems at the moment"** | No simulation of logic chips; graphics effectively off-limits |
| **Logisim 7400 libraries** | Pin-accurate 7400-series catalogs: cocot-gf/Logisim-BIG-TTL-CMOS-Library (**MIT**, covers "74 series from 00 to 899 as much as possible"), ivop/7400-logisim (**0BSD**) | Permissive, good for cross-checking pin/function data | Logisim format; must be converted |

**Positioning:** 74Sim already does the generic breadboard simulation, so don't try to beat it on simulation fidelity. Win instead on a **personal-lab workflow**: inventory-aware planning, a 7‑segment decoder design path (truth table → K‑map → gates → breadboard), explicit LS/HC/HCT mismatch teaching, a build checklist and BOM, and full offline operation.

## 3. Feature Specifications

### 3.1 Visual Breadboard Planner
- **Boards:** full (830-point: 63 columns × rows a–j, plus 2 rail pairs) and half (400-point: 30 columns). Model: each column's a–e holes form one net, f–j form another, and the center gap separates them. **Rails are configurable as continuous or split mid-board**, because some full-size boards break the rails in the middle; this is a classic hidden bug.
- **Parts:** DIP‑14/DIP‑16 chips (must straddle the gap, with pin 1 notch shown), jumper wires (color picker with defaults: red = VCC, black = GND, others free), resistors (value + color bands), SPST/DIP switches with pull-up/pull-down configuration, pushbuttons, LEDs, 0.1 µF decoupling caps, single-digit 7‑segment displays (5161AS/5161BS-style 10-pin), 5 V supply / USB-breakout, 555 clock module.
- **Interaction:** drag from palette; snap pins to 0.1″ (2.54 mm) grid holes; invalid placements (chip not straddling, pin off-grid, two legs in one hole) are shown in red; wires are drawn hole→hole with optional bend points; hovering a hole highlights its whole net (the most valuable debugging affordance); rotate/flip; multi-select; undo/redo.
- **Exports:** JSON (canonical project file), SVG/PNG image, BOM (CSV/Markdown: part, family, qty, on-hand, shortfall), and a **wiring checklist** ("Wire 1: red, VCC rail → U1 pin 14") to tick off at the bench.

### 3.2 Logic Simulator and Error Checker
- Toggle switches to drive inputs; signals propagate through gates/decoders/counters to LEDs and 7‑segment displays, which render lit segments live; nets are color-coded (high/low/floating/conflict).
- Clock sources: a 555 astable part (frequency from RA, RB, C) and a manual "step" button.
- **Electrical Rule Check (ERC) panel** with severity levels (Error/Warning/Info), each item linking to the offending hole/pin and a "why" explanation citing the datasheet:
  - Chip VCC/GND pin not connected (e.g., 7490's power is on pins 5/10, not 14/7).
  - Floating input: HC/HCT = **Error**; LS = **Warning** ("floats HIGH but don't rely on it").
  - Two push-pull outputs on one net (contention/short).
  - Output tied directly to VCC/GND.
  - LED or segment with no current-limiting resistor in its path.
  - Decoder/display polarity mismatch (7447 → common-cathode, 4511 → common-anode).
  - 7447 BI/RBO or LT, or 4511 LT/BI/LE, left in a state that blanks or forces the display.
  - LS output driving HC input (level not guaranteed).
  - Fan-out exceeded.
  - Package current budget exceeded (e.g., 595 total ICC).
  - Missing decoupling capacitor per IC (Info).
  - Counter reset pins left floating (7490 R0 inputs).

### 3.3 Pinout and Wiring Reference
- Searchable chip cards: DIP diagram (click a pin → highlight), function, truth table, family notes (LS/HC/HCT differences), datasheet link, "common mistakes" list.
- 7‑segment reference: segment naming, CA vs CC wiring, 5161AS/BS pin map, how to identify polarity with a multimeter.
- **Decoder design lab:** BCD truth table → interactive K‑map per segment (with don't-cares for 10–15) → minimized SOP → auto-generated gate list ("needs 3× 7408, 2× 7432, 1× 7404") → checks against inventory → optional auto-placement onto a breadboard.
- Resistor calculator: R = (VCC − VF − Vdrop,driver) / IF, with nearest E12/E24 value and power rating.

### 3.4 Chip Inventory
- Fields: part number (normalized, e.g., "SN74LS47N" → base "7447", family "LS"), family (LS/HC/HCT/CD4000/other), package, quantity, condition (new/used/suspect/dead), location (bin/box), notes, and an optional photo (stored in IndexedDB).
- **Buildability check:** the project BOM is compared to inventory with substitution rules (HCT can replace LS; HC replaces LS only if inputs are CMOS-level driven; 7447 ≠ 7448), and the result shows "OK / short by N / substitute available."
- Quick-add via typing, and optionally barcode/OCR later.

## 4. Chip and Electrical Reference Data (verified facts to encode)

### 4.1 Logic families
| Parameter | 74LS (TI SN74LS00) | 74HC (Nexperia 74HC00) | 74HCT (Nexperia 74HCT00) |
|---|---|---|---|
| VCC | 4.75–5.25 V | 2.0–6.0 V | 4.5–5.5 V (per 74HCT14/4511 tables) |
| VIH min / VIL max | 2.0 V / 0.8 V | 3.15 V / 1.35 V at VCC = 4.5 V | 2.0 V / 0.8 V (TTL level) |
| VOH min | 2.7 V at IOH = −0.4 mA | ≈ VCC − 0.5 V at ±4 mA | same as HC |
| IOL / IOH | 8 mA / −0.4 mA | ≈ ±4 mA rated (typical datasheet condition) | same as HC |
| Input current | IIL −0.4 mA, IIH 20 µA | ≤ 1 µA leakage | ≤ 1 µA |
| Fan-out | 20 LS loads (8 mA/0.4 mA) | "fanout of 10 LS‑TTL loads" (Fairchild MM74HCT14) | 10 LS loads |

**Rules to encode:**
- **LS → HC is not guaranteed:** LS VOH min (2.7 V) is below HC VIH min (3.15 V at 4.5 V). Flag it and suggest HCT or a pull-up.
- **HC → LS is fine** within fan-out. HCT is the universal "glue" family; Wikipedia's logic-level summary notes HCT was invented precisely because TTL outputs don't reliably drive CMOS inputs.
- **Floating CMOS inputs:** TI's application report SCBA004E ("Implications of Slow or Floating CMOS Inputs," rev. July 2021) explains that inputs sitting in the threshold region turn both N- and P-channel transistors on, causing excess current and oscillation; TI's E2E FAQ adds that this "can cause a reduction in reliability." Unused HC inputs must be tied to VCC or GND. TTL inputs float high, but tie them anyway.
- **HC input edge rate:** the Nexperia 74HC00 datasheet (Rev. 11, 29 April 2025) specifies a maximum input transition rise/fall rate (Δt/ΔV) of 139 ns/V at VCC = 4.5 V (625 ns/V at 2.0 V; 83 ns/V at 6.0 V). This is why slow RC or bouncy switches need a Schmitt trigger (74HC14). Use it as an ERC hint for "switch → clock input."
- **Pull-down sizing for LS:** because an LS input sources up to 0.4 mA, a 10 kΩ pull-down leaves ~1 V (above VIL 0.8 V), so use ≤ 2.2 kΩ for pull-downs; 10 kΩ pull-ups are fine. This is a secondary-source calculation, but it follows directly from the datasheet IIL.

### 4.2 7‑segment decoders
- **74LS47 (common anode, open collector):** active-LOW outputs that sink current, rated to "withstand 15 V," "up to 24 mA" per segment (onsemi/Motorola datasheet); VCC 4.75–5.25 V; VCC pin 16, GND pin 8. Pins: B=1, C=2, LT=3, BI/RBO=4, RBI=5, D=6, A=7; outputs e=9, d=10, c=11, b=12, a=13, g=14, f=15. Must be paired with a **common-anode** display plus one resistor per segment. Per TI, BI/RBO "must be open or held at a HIGH level" for normal digits, and LT low lights all segments. Inputs 10–15 produce "unique symbols," not blanks; the sim must reproduce these.
- **74LS48 (common cathode, active-HIGH with internal pull-ups):** TI describes it as "for driving lamp buffers or common-cathode LEDs," and it features "Internal Pull-Ups Eliminate Need for External Resistors." The segment outputs, however, are weak: the onsemi/Motorola data gives IOH −100 µA and about −2 mA at VO = 0.85 V, with IOL 6 mA. The commonly quoted "2 kΩ pull-up" value could not be confirmed in a primary datasheet. **App guidance:** treat 7448 → CC as "works, but dim"; recommend 74HC4511 for common cathode.
- **74HC4511 / CD4511 (common cathode, latch):** Nexperia Rev. 4 (28 March 2024): "Guaranteed 10 mA drive capability per output," "Driving common cathode LED displays," VCC 2.0–6.0 V (HCT version 4.5–5.5 V), IO abs max ±25 mA per output, ICC abs max 50 mA. Pins: B=1, C=2, LT=3, BI=4, LE=5, D=6, A=7, GND=8, e=9, d=10, c=11, b=12, a=13, g=14, f=15, VCC=16. LE LOW = transparent; LE HIGH = latched. **Inputs 10–15 blank the display** (unlike 7447). Its 6 has no top segment and its 9 has no bottom segment (a=L for 6, d=L for 9 in the function table). The sim must match each decoder's glyph set exactly. Note the 50 mA ICC limit: 7 segments × 10 mA = 70 mA would exceed it at full drive, so the ERC should compute the total.
- **74HC595 (if used for MCU-driven displays):** Nexperia Rev. 12 (20 March 2024): Qn abs max ±35 mA, but **ICC/IGND abs max 70 mA total**; rated drive is −6 mA at VCC = 4.5 V. Eight LEDs at 20 mA (160 mA) would violate the package limit, so the ERC must check the package budget, not just per-pin current. MR (pin 10) and OE (pin 13) are active LOW; VCC = 16, GND = 8.

### 4.3 Counters, decoder, clock
- **7490/74LS90:** "VCC = PIN 5 / GND = PIN 10" (onsemi SN74LS90/D, Rev. 6, July 2006). This is a top student mistake, so the ERC should special-case it. BCD mode requires CP1 to be "externally connected to the Q0 output." The reset inputs (MR1/MR2) clear when both are HIGH, so at least one, and in practice both, must be grounded to count. The set-to-9 inputs must also be grounded.
- **74LS192/193 (up/down BCD/binary), 74HC390 (dual decade), 74LS138 (3‑to‑8, active-LOW outputs, three enables):** encode as sequential/combinational models from TI/Nexperia datasheets during Phase 2. These pin details were not verified in this research pass and must be checked against the datasheets before release.
- **NE555 (TI SLFS022K, rev. March 2026):** VCC 4.5–16 V (NE555); astable f ≅ 1.44 / ((RA + 2RB)·C), tH ≅ 0.693(RA+RB)C, tL ≅ 0.693·RB·C. Datasheet advice: "when RESET is not used, connect RESET to VCC"; output "can sink or source up to 200mA." Default preset: RA = 1 kΩ, RB = 68 kΩ, C = 10 µF ≈ 1 Hz, which is visible counting on a display.

### 4.4 Gate chips (standard 14-pin quad/hex pinouts, VCC = 14, GND = 7)
7400 NAND, 7402 NOR (**note: 7402 outputs are on pins 1/4/10/13**, the classic gotcha), 7404 NOT (hex), 7408 AND, 7432 OR, 7486 XOR, 7410 triple 3‑input NAND, 7411 triple 3‑input AND, 7420 dual 4‑input NAND (pins 3 and 11 NC). Transcribe each from the TI/Nexperia datasheet and cross-check against the MIT-licensed Logisim BIG TTL library.

### 4.5 7‑segment displays (5161AS / 5161BS)
- Manufacturer datasheets (XLITX; Keming via Mantech) list **5161AS = common cathode**. By the same convention, 5161BS = common anode. Some marketplace listings claim the opposite, so the app should warn the user to verify with a multimeter's diode mode.
- Typical 5161 pinout: e=1, d=2, **common=3 and 8**, c=4, DP=5, b=6, a=7, f=9, g=10. VF ≈ 1.8–2.1 V typical (red), 2.5–2.8 V max at 20 mA; continuous IF max 20–30 mA.
- **Resistor calculation:** with 7447 sinking (VOL ≈ 0.4 V), (5 − 2.0 − 0.4)/0.010 ≈ 260 Ω → **270 Ω or 330 Ω** (~8–10 mA). With 4511 sourcing (VOH ≈ 4.2 V at light load), (4.2 − 2.0)/0.010 ≈ 220 Ω → **220–330 Ω**. Always use one resistor per segment, never a single resistor on the common pin (brightness would vary with digit).

### 4.6 Segment equations from BCD (the classic K‑map lab)
Inputs W X Y Z (W = MSB, i.e., D C B A), with don't-cares for 10–15. Active-HIGH (common-cathode) outputs, with 6 and 9 drawn with tails:
- a = W + Y + XZ + X′Z′
- b = X′ + Y′Z′ + YZ
- c = X + Y′ + Z
- d = W + X′Z′ + X′Y + YZ′ + XY′Z
- e = X′Z′ + YZ′
- f = W + Y′Z′ + XY′ + XZ′
- g = W + XY′ + X′Y + YZ′

These were checked against all digits 0–9. For common anode, invert each output (e.g., use NAND/NOR forms or a 7404 stage). The app's K‑map tool should derive these live, show groupings, and offer SOP and NAND-only realizations (NAND-only maps to 7400/7410/7420 stock).

## 5. Architecture

```
┌────────────── UI (React) ──────────────┐
│ Breadboard canvas (SVG) │ Palette │ Inspector │ ERC panel │ Chip reference │ Inventory │ K‑map lab
└──────────────┬───────────────────────────┘
               │ commands (place, wire, toggle)
        ┌──────▼──────┐   project JSON    ┌───────────────┐
        │ Store       │◄────────────────►│ Persistence   │ IndexedDB + file import/export + URL share
        │ (Zustand)   │                  └───────────────┘
        └──────┬──────┘
               │ placements
        ┌──────▼──────────┐   netlist   ┌──────────────────┐   events   ┌───────────┐
        │ Netlist builder │───────────►│ Logic sim engine │──────────►│ ERC rules │
        │ (union-find)    │            │ (Web Worker)     │           │           │
        └─────────────────┘            └──────────────────┘           └───────────┘
                     ▲ chip definitions (JSON, datasheet-sourced, versioned)
```

Key principle (borrowed from DigitalJS's MVC split): **the engine is pure TypeScript with zero DOM dependencies**, so it can be unit-tested headlessly and run in a Web Worker.

### 5.1 Data models (TypeScript)

```ts
type Family = 'LS' | 'HC' | 'HCT' | 'CD4000' | 'NE555' | 'generic';
type Logic = 0 | 1 | 'Z' | 'X';

interface ChipDef {
  id: string;                 // "7447"
  name: string;               // "BCD to 7-segment decoder/driver (CA, OC)"
  families: Family[];         // ["LS"] ; 4511: ["HC","HCT","CD4000"]
  package: 'DIP14' | 'DIP16' | 'DIP8';
  pins: PinDef[];             // index = pin number - 1
  power: { vcc: number; gnd: number };      // pin numbers (7490: 5/10)
  model: 'combinational' | 'sequential';
  units?: GateUnit[];         // for quad/hex gate chips
  truthTable?: TruthRow[];    // for docs + golden tests
  glyphs?: Record<number, string>; // decoder: code -> "abcdefg" lit pattern
  electrical: FamilyElectrical;     // per family: vih, vil, voh, vol, ioh, iol, iih, iil
  limits?: { iccMaxmA?: number; ioMaxmA?: number };
  datasheets: { vendor: string; doc: string; rev: string; url: string }[];
  gotchas: string[];
}
interface PinDef { num: number; name: string; dir: 'in'|'out'|'io'|'pwr'|'gnd'|'nc';
  activeLow?: boolean; output?: 'push-pull'|'open-collector'|'pullup-oc'; }
interface GateUnit { fn: 'NAND'|'NOR'|'NOT'|'AND'|'OR'|'XOR'; inputs: number[]; output: number; }

interface Breadboard { kind: 'full830'|'half400'; railsSplit: boolean; origin: {x:number;y:number}; }
interface HoleRef { board: string; col: number; row: 'a'|'b'|...|'j'|'+L'|'-L'|'+R'|'-R'; }
interface PartInstance { id: string; type: 'chip'|'resistor'|'led'|'seg7'|'switch'|'dipswitch'|
  'cap'|'supply'|'button'; defId?: string; family?: Family; pins: HoleRef[]; props: Record<string, unknown>; }
interface Wire { id: string; from: HoleRef; to: HoleRef; color: string; bends: {x:number;y:number}[]; }
interface Project { schema: 1; boards: Breadboard[]; parts: PartInstance[]; wires: Wire[]; notes?: string; }

interface InventoryItem { id: string; base: string; family: Family; partNumber: string; package: string;
  qty: number; condition: 'new'|'used'|'suspect'|'dead'; location?: string; notes?: string; }
```

### 5.2 Netlist extraction
1. Assign an integer node to every hole and pre-union the strip groups (column a–e, column f–j, each rail segment; respect `railsSplit`).
2. Union both ends of every wire.
3. Map each part pin to the node of the hole it sits in. Resistors, LEDs, and switches are **two-terminal elements**, not unions; a closed switch is a union in logic mode.
4. Output `Net[]` with attached pins, then classify each net: power (connected to supply +), ground, driven, or undriven.
5. Rebuild incrementally on each edit (cheap: union-find over a few thousand holes takes well under a millisecond).

### 5.3 Simulation design
- **Signal model:** 4-valued (0, 1, Z, X) plus drive strength (strong / weak pull / open). Net resolution: strong 0 vs strong 1 gives X plus a contention error; open-collector outputs drive only 0 or Z; resistors to VCC/GND act as weak drivers; a floating input resolves to 1 (LS) or X (HC/HCT) and raises an ERC entry.
- **Engine:** classic event-driven queue. When a net changes, schedule evaluation of the chip units that read it, using per-family typical propagation delay (e.g., LS: tPLH 9 ns / tPHL 10 ns typical, 15 ns max at 5 V per the TI and onsemi SN74LS00 datasheets; HC: 7 ns typical at 5 V/15 pF and 23 ns max at 4.5 V/50 pF per Nexperia's 74HC00 Rev. 11 datasheet; 4511 A–D→a–g typ 24–28 ns) so glitches and ripple-counter behavior are visible in a timing view. Include an iteration cap to detect oscillation (e.g., a gate looped onto itself), and run the engine in a Web Worker.
- **Sequential parts:** edge detection per clock pin (7490 counts on falling edge; 74192/193 on rising edge of UP/DOWN; 4511 latches on the LE rising edge). Keep internal state in the instance.
- **Power gating:** if a chip's VCC net isn't at supply+ or GND isn't at ground, its outputs become X, so the display shows nothing, which mirrors reality.
- **LED/segment evaluation (quasi-electrical):** for each LED/segment diode, find its anode-side source (VCC or an output at 1 that can source) and its cathode-side sink (GND, an output at 0, or an OC output at 0). Look for a resistor in series, then estimate I = (Vsrc − VF − Vsink)/R using family VOH/VOL. Render brightness proportional to I, and flag "no resistor" (I → limited only by the driver) and over-current.
- **ERC:** a pure function `(netlist, simState, chipDefs) → Issue[]`, where each rule is a small, separately tested module citing its datasheet source.
- **Why not SPICE?** 74Sim shows MNA is feasible in the browser, but it adds matrix stability work and modeling of every chip's analog I/O. For a learning/planning tool, logic + rule-based electrical checks is the right MVP. A small MNA solver for the LED/resistor paths only can come later.

### 5.4 Rendering and UI
- **Plain SVG + React** for the breadboard: a few hundred holes and parts is well within SVG's comfort zone, and it gives free hit-testing, CSS styling, crisp zoom, accessible elements, and trivial SVG/PNG export. Use a viewBox-based pan/zoom (e.g., `react-zoom-pan-pinch` or a hand-rolled version). Revisit Konva/Canvas only if profiling shows trouble with large multi-board projects.
- Part graphics: draw your own SVGs (DIP body, 7‑seg, resistor bands) or reuse **@wokwi/elements (MIT)** for LED/7‑segment/resistor visuals (attribution in NOTICE). **Do not reuse Fritzing graphics.**
- React Flow is not a fit: it is node-graph oriented, while breadboards are grid/hole oriented. It may suit the later schematic view.
- **Layout:** left palette (chips filtered by inventory: "show only what I own"), center board, right inspector (selected part: pinout card, family, props), bottom tabs (ERC issues, signal monitor/timing, BOM). Top bar: project name, undo/redo, simulate on/off, export. Separate routes for Reference, Inventory, and K‑map Lab. Mobile: read-only board, plus fully usable reference and inventory (useful at the shop or in class).

### 5.5 Tech stack (default; all changeable later)
| Concern | Choice | Why |
|---|---|---|
| Build | Vite + React + TypeScript | Fast, static output, matches Mark's web skills |
| State | Zustand (+ immer, zundo for undo/redo) | Small, no boilerplate, easy to persist and serialize |
| Persistence | IndexedDB via `idb`/Dexie; JSON file import/export; versioned `schema` field with migrations | Offline, handles photos and multiple projects |
| PWA | vite-plugin-pwa (Workbox, "zero-config," offline precache, update prompt) | Offline in labs with poor Wi‑Fi |
| Routing | HashRouter | No 404 rewrites needed on GitHub Pages |
| Validation | Zod schemas for ChipDef/Project | Catches bad chip JSON and bad imports |
| Tests | Vitest (unit), fast-check (property), Playwright (e2e) | Headless engine testing |
| Sharing (later) | lz-string compressed project in URL hash | No backend |

### 5.6 Suggested folder structure
```
/src
  /app            routes, layout, providers
  /features
    /breadboard   Board.tsx, Hole.tsx, parts/*.tsx, interactions/, export/
    /simulator    ui (monitor, timing), useSimulation.ts
    /reference    ChipCard, PinoutDiagram, SevenSegGuide, ResistorCalc
    /kmap         KMap.tsx, minimize.ts (Quine–McCluskey), toGates.ts
    /inventory    InventoryTable, buildability.ts
  /engine         (pure TS, no React)
    netlist.ts  unionFind.ts  sim.ts  scheduler.ts  resolve.ts
    models/ gates.ts decoders.ts counters.ts timer555.ts shift595.ts
    erc/ rules/*.ts index.ts
  /data
    chips/*.json  displays/*.json  families.json  substitutions.json
  /store          projectStore.ts inventoryStore.ts persistence.ts migrations.ts
  /lib            units.ts eSeries.ts partNumber.ts
/tests            engine/*.test.ts  data/*.test.ts  e2e/*.spec.ts
/public           icons, manifest assets
/docs             datasheet-sources.md  NOTICE (third-party licenses)
```

## 6. Roadmap (solo developer, ~10–15 h/week)

| Phase | Scope | Milestone / "done" test | Effort |
|---|---|---|---|
| **0. Foundations** (wk 1) | Repo, Vite/TS/PWA scaffold, CI → GitHub Pages, Zod ChipDef schema, first 5 chips (7400/02/04/08/32) | App installs and opens offline from Pages | 10–15 h |
| **1. MVP** (wk 2–7) | Chip reference (gates + 7447/7448/4511, 5161 displays, resistor calc); inventory CRUD + buildability; breadboard (half + full, rails, snapping, wires, colors, net highlight); netlist; combinational sim; switches/LEDs/7‑seg rendering; ERC core (power pins, floating inputs, contention, no resistor, CA/CC mismatch); JSON save/load | **Build "switches → 7447 → common-anode 5161BS" and "switches → discrete-gate decoder → 5161AS" on screen, see correct digits 0–9, and get the right errors when you remove a resistor or swap the display** | 60–90 h |
| **2. v1** (wk 8–14) | Sequential: 7490, 74192/193, 74390, 74138, 74595, 555 clock + step mode; timing view; full ERC (LS→HC levels, fan-out, package current, 7490 power pins, unused-input checks, decoupling hints); K‑map lab with gate auto-generation and inventory check; BOM/SVG/PNG export; wiring checklist | **555 → 7490 → 4511 → CC display counts 0–9 at ~1 Hz; the K‑map lab outputs a buildable gate list checked against inventory** | 70–100 h |
| **3. Later** | Schematic view auto-generated from the netlist; URL sharing; guided labs (step-by-step with auto-checking); multi-digit / ripple blanking; 74HC14 debouncing; HCT/CD4000 expansion; Web Serial hardware-in-the-loop; Filipino/Tagalog UI strings | Opportunistic | 20–60 h each |

## 7. Testing Strategy
- **Golden truth-table tests:** each chip JSON's truth table is checked exhaustively against its model (gates: all input combinations; decoders: all 16 codes including the 10–15 glyph/blank behavior; counters: count sequences and resets).
- **Data integrity tests:** every chip has power pins, pin counts match the package, no duplicate pin numbers, and every datasheet reference has vendor + revision.
- **Netlist property tests (fast-check):** e.g., placing a wire between two holes already on the same strip changes nothing; split-rail boards never merge left and right rails.
- **ERC fixture tests:** a library of small "broken circuit" JSON files, each asserting the expected issue IDs. Labs collect these naturally.
- **E2E (Playwright):** place a chip, wire it, toggle a switch, assert the segment class; then test offline reload.
- **Bench validation:** build the two MVP circuits for real and compare. This is the true acceptance test.

## 8. Deployment
- GitHub Actions: `npm ci && npm test && npm run build` → deploy `dist/` to GitHub Pages. Set Vite `base` to `/<repo>/` (or use an env var) so assets, manifest, and service worker resolve under the sub-path; a common failure is the SW 404ing at the wrong path. Use HashRouter so deep links don't 404.
- Cloudflare Pages or Vercel are drop-in alternatives (root-path hosting, preview deploys per PR). No server is needed for any MVP/v1 feature.
- Version the service worker per build, and show a "new version available — reload" prompt (vite-plugin-pwa supports this) so lab users aren't stuck on stale code.

## 9. Hardware-in-the-Loop (future)
An ESP32/Arduino reads breadboard nodes (via 74HC165 shift-ins or GPIO) and streams JSON over USB serial; the app compares real vs simulated nets and highlights disagreements ("U2 pin 3 expected HIGH, measured LOW"). Constraints: Web Serial requires a **secure context (HTTPS)** and a user gesture for `requestPort()`. GitHub Pages satisfies HTTPS. It works in **Chrome/Edge 89+ and Opera**, with **no Safari support**. Mozilla's "Announcing Web Serial Support in Firefox" (Mozilla Hacks, May 21, 2026) confirms that "Starting in Firefox 151 for Desktop, support for the Web Serial API allows web applications to communicate with compatible devices," but Firefox for Android, Safari, and iOS still lack it, so target desktop Chromium plus Firefox 151+ and feature-detect `'serial' in navigator`. Watch voltage levels: an ESP32 is 3.3 V, so use dividers or level shifters to read 5 V logic.

## 10. Risks and Open Decisions
| Risk / decision | Mitigation / recommendation |
|---|---|
| Datasheet transcription errors (a wrong pin teaches the wrong thing) | Every ChipDef cites vendor doc + revision; cross-check against MIT/0BSD Logisim libraries; a "report pinout error" link; bench-verify MVP chips |
| Scope creep toward a full SPICE simulator | Hold the line: logic + ERC. Add a tiny LED-path solver only if brightness accuracy matters |
| Vendor variation (e.g., 7448 pull-up strength, 5161AS/BS polarity labeling) | Expose "verify on bench" warnings; make display polarity a part property, not inferred from the name |
| Licensing contamination | Keep the engine original; reuse only MIT/BSD/0BSD assets; avoid Fritzing graphics and GPL code (CircuitJS1, Logisim‑evolution) unless you're willing to license the app GPL. 74SimSource's license is unverified |
| Overlap with 74Sim/LogicBench | Differentiate on inventory, the K‑map → gates → 7‑seg lab flow, build checklists, and offline/local-first |
| Breadboard UX complexity (drag, snap, wire editing) is the biggest time sink | Build interactions first on the half board; defer bend points and multi-select to v1 |
| **Open decisions** | App license (MIT recommended); SVG-only vs SVG+Canvas; whether to add Tagalog strings; whether HC VCC should be adjustable (3.3 V) in v1 |

## 11. Recommendations (what to do this week)
1. Scaffold Vite + React + TS + vite-plugin-pwa and deploy an empty shell to GitHub Pages, confirming offline install works.
2. Write the Zod `ChipDef` schema and hand-enter 7400, 7402, 7404, 7408, 7432, 7447, and 74HC4511 from the TI/Nexperia PDFs, with golden tests.
3. Build the netlist engine plus tests *before* any drag-and-drop UI; it's the heart of everything.
4. Then do the half-breadboard SVG with snapping, followed by the two MVP demo circuits.
5. Inventory CRUD is a quick, satisfying win; ship it alongside the reference pages so the app is useful from week 3 even before the simulator is done.

## 12. Caveats
- A few figures come from secondary or vendor-copy sources rather than TI's own PDFs, because TI's SN74LS47/48/90 datasheets are scanned images: the 7447 24 mA/15 V figures and 7448 output currents (onsemi/Motorola copies), 7490 pin assignments (onsemi), and LS pull-down sizing (a calculation from IIL). The 7448 "2 kΩ pull-up" figure is **unverified** and should not be hard-coded.
- 74192/193, 74390, and 74138 pin details were not verified in this research pass; check them against the datasheets before encoding.
- Rated HC output drive (±4 mA at 4.5 V for gates; 4511's 10 mA; 595's −6 mA) differs per part. Encode per-chip values, not a single family constant.
- Effort estimates assume part-time solo work by an experienced web developer and exclude the learning curve for any unfamiliar libraries; breadboard interaction polish is the most likely overrun.
- The 5161 pin numbering above is the common one, but clone displays vary. The app should always prompt users to verify the common pins and polarity with a multimeter.