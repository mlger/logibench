# Datasheet sources

Every electrical value and pinout in `src/data/chips.ts` traces to one of the
sources below. The plan's caveat discipline applies: figures taken from
secondary or vendor-copy sources (because the TI originals are scanned images)
are called out inline, and unverified rows are flagged in the app.

## Logic families

| Parameter set | Source |
|---|---|
| 74LS (VIH 2.0/VIL 0.8, VOH min 2.7 @ −0.4 mA, IOL 8 mA, IIL −0.4 mA, fanout 20 LS) | TI SN74LS00 datasheet (scanned, 1988 rev); cross-checked vs onsemi copies |
| 74HC (VIH 3.15/VIL 1.35 @ VCC 4.5 V, ±4 mA rated, ≤1 µA leakage, Δt/ΔV max 139 ns/V @ 4.5 V) | Nexperia 74HC00 Rev. 11 — 29 Apr 2025 — https://www.nexperia.com/datasheet/74HC00.pdf |
| 74HCT (TTL-level thresholds, VCC 4.5–5.5 V) | Nexperia 74HCT00 / Fairchild MM74HCT14 ("fanout of 10 LS-TTL loads") |
| Floating CMOS inputs (threshold-region conduction, excess current, oscillation, reliability) | TI application report SCBA004E, "Implications of Slow or Floating CMOS Inputs", rev. July 2021 — https://www.ti.com/lit/an/scba004e/scba004e.pdf |
| LS pull-down sizing (≤2.2 kΩ because IIL −0.4 mA) | Derived from datasheet IIL (calculation, secondary source) |

## 7-segment decoders

| Chip | Source |
|---|---|
| 74LS47 (common anode, open collector, 24 mA/15 V segment sink, BI/RBO "open or HIGH", LT lamp test, unique symbols 10–15) | TI SN74LS47 (scanned); onsemi/Motorola SN74LS47/D Rev. 6 for 24 mA & 15 V figures — https://www.onsemi.com/pdf/datasheet/sn74ls47-d.pdf |
| 74LS48 (common cathode, active-HIGH, internal pull-ups; IOH −100 µA, ≈−2 mA @ VO 0.85 V, IOL 6 mA) | TI SN74LS48; onsemi SN74LS48/D Rev. 7. The oft-quoted "2 kΩ pull-up" is NOT verified in a primary datasheet and is not hard-coded. |
| 74HC4511 (10 mA drive guarantee, LE latch, 10–15 blank, 6/9 without tails, ICC abs max 50 mA, IO abs max ±25 mA) | Nexperia 74HC4511 Rev. 4 — 28 Mar 2024 — https://www.nexperia.com/datasheet/74HC4511.pdf |

## Counters / decoder / timer

| Chip | Source |
|---|---|
| 74LS90 (VCC = PIN 5 / GND = PIN 10; BCD needs CP1↔Q0 jumper; MR/MS pairs not internally grounded; falling-edge clocks) | onsemi SN74LS90/D Rev. 6 — July 2006 — https://www.onsemi.com/pdf/datasheet/sn74ls90-d.pdf |
| 74LS138 (3 enables, active-LOW outputs; standard pinout — cross-check flagged) | TI SN74LS138 (scanned); Nexperia 74HC138 |
| NE555 (VCC 4.5–16 V; f ≅ 1.44/((RA+2RB)·C); tH ≅ 0.693(RA+RB)·C; tL ≅ 0.693·RB·C; "connect RESET to VCC when not used"; 200 mA sink/source) | TI SLFS022 (NE555) — https://www.ti.com/lit/ds/symlink/ne555.pdf |
| 74HC595 (Qn ±35 mA but ICC/IGND package abs max 70 mA; rated −6 mA @ 4.5 V; MR/OE active LOW) | Nexperia 74HC595 Rev. 12 — 20 Mar 2024 — https://www.nexperia.com/datasheet/74HC595.pdf |

## Displays & passives

| Item | Source |
|---|---|
| 5161AS = common cathode, 5161BS = common anode (convention; marketplace listings sometimes claim the opposite — verify with multimeter diode mode) | XLITX / Keming (Mantech) manufacturer sheets |
| 5161 pinout (e=1, d=2, com=3&8, c=4, dp=5, b=6, a=7, f=9, g=10), Vf 1.8–2.1 V typ red | vendor sheets; clone displays vary — app prompts to verify |
| Segment resistor sizing: 7447 sink (5 − 2.0 − 0.4)/0.010 ≈ 260 Ω → 270–330 Ω; 4511 source (4.2 − 2.0)/0.010 ≈ 220 Ω → 220–330 Ω | Derived from the above datasheet figures |

## Cross-checks

- Pinout/function cross-checking referenced against the MIT-licensed
  `cocot-gf/Logisim-BIG-TTL-CMOS-Library` (74-series catalog 00–899) and the
  0BSD `ivop/7400-logisim` library. No code or graphics were copied.
- Gate pinouts (7400/02/04/08/32/86, 7410, 7411, 7420) are the standard
  quad/hex layouts; the 7402's mirrored output-first pinout is encoded and
  called out as a gotcha.

## Known verification gaps (flagged in-app)

1. 7447/7448 glyph patterns for input codes 10–14: TI documents "unique
   symbols"; the exact segment maps in this library are approximations carrying
   a `verify` badge. Code 15 = blank (well documented).
2. 74192/74193/74390/74595 pin tables are reference-only (no sim model) with an
   explicit "verify against the TI datasheet before wiring" gotcha.
3. 5161 clone displays vary; the app treats display polarity as a part
   property and prompts multimeter verification.
