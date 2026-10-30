/**
 * Preset cell patterns for the decoder design lab
 * (docs/kmap-lab-presets-vars-preview-plan.md §4).
 *
 * Pure data: every preset's build() returns the 16 minterms (codes 0–15) per
 * segment and touches no state — the store's applyPreset decides how the
 * pattern lands on the E = 0 / E = 1 planes (§4.2: 4-var presets write the
 * lower plane only and never touch stored E = 1 edits; 5-var presets fill
 * both planes and end the mirror). Segments are listed a…g so digit presets
 * can index DIGIT_GLYPHS by position.
 */

import { CLASSIC_SEGMENT_EQUATIONS, DIGIT_GLYPHS } from '@/data/chips';
import type { KMapCell } from '@/lib/logibench/types';
import type { SegKey } from '@/store/kmapStore';

const SEGS: SegKey[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export interface KmapPreset {
  id: string;
  label: string;
  /** 'decoder' presets write all seven segments; 'segment' presets the active one */
  scope: 'decoder' | 'segment';
  description: string;
  /** 16 minterms (codes 0–15) per segment; pure — no store access. */
  build: () => Record<SegKey, KMapCell[]>;
}

const fill16 = (f: (code: number) => KMapCell): KMapCell[] =>
  Array.from({ length: 16 }, (_, code) => f(code));

const forAllSegs = (
  f: (seg: SegKey, code: number) => KMapCell,
): Record<SegKey, KMapCell[]> => {
  const out = {} as Record<SegKey, KMapCell[]>;
  for (const seg of SEGS) out[seg] = fill16((code) => f(seg, code));
  return out;
};

/** Odd-parity checkerboard of the four inputs — the classic worst case for K-maps. */
const PARITY_ODD = new Set([1, 2, 4, 7, 8, 11, 13, 14]);

function randomCell(): KMapCell {
  const r = Math.random();
  return r < 0.4 ? 1 : r < 0.8 ? 0 : 'X';
}

/** "Digit d only" decoder: 1 at m_d, 0 at the other valid codes, X on 10–15 (plan D2). */
function digitPreset(d: number): KmapPreset {
  return {
    id: `digit-${d}`,
    label: `Digit ${d} only`,
    scope: 'decoder',
    description: `Decoder shows ${d} for code ${d}, blank for the other digits; 10–15 stay don't-care.`,
    build: () =>
      forAllSegs((seg, code) => {
        if (code >= 10) return 'X';
        const segIndex = SEGS.indexOf(seg);
        return code === d && DIGIT_GLYPHS[d][segIndex] === '1' ? 1 : 0;
      }),
  };
}

/** Segment states of a classic digit glyph — mini previews in the preset menu. */
export function digitGlyphStates(d: number): Record<SegKey, KMapCell> {
  const out = {} as Record<SegKey, KMapCell>;
  for (const [i, seg] of SEGS.entries()) out[seg] = DIGIT_GLYPHS[d][i] === '1' ? 1 : 0;
  return out;
}

/** Whole-decoder presets (the digit presets render as their own chip row). */
export const DECODER_PRESETS: KmapPreset[] = [
  {
    id: 'classic',
    label: 'Classic BCD decoder',
    scope: 'decoder',
    description: 'The classic 0–9 truth table — same as "Reset all".',
    build: () => forAllSegs((seg, code) => CLASSIC_SEGMENT_EQUATIONS[seg][code]),
  },
  {
    id: 'blank',
    label: 'Blank decoder',
    scope: 'decoder',
    description: 'Every segment off for every code — start from an empty design.',
    build: () => forAllSegs(() => 0),
  },
];

export const DIGIT_PRESETS: KmapPreset[] = Array.from({ length: 10 }, (_, d) => digitPreset(d));

/** Active-segment presets. */
export const SEGMENT_PRESETS: KmapPreset[] = [
  {
    id: 'seg-classic',
    label: 'Classic values',
    scope: 'segment',
    description: 'The classic BCD values for this segment — same as "Reset to classic".',
    build: () => forAllSegs((seg, code) => CLASSIC_SEGMENT_EQUATIONS[seg][code]),
  },
  {
    id: 'seg-zero',
    label: 'All 0',
    scope: 'segment',
    description: 'Segment permanently off.',
    build: () => forAllSegs(() => 0),
  },
  {
    id: 'seg-one',
    label: 'All 1',
    scope: 'segment',
    description: 'Segment permanently on — wire it to VCC.',
    build: () => forAllSegs(() => 1),
  },
  {
    id: 'seg-x',
    label: 'All X',
    scope: 'segment',
    description: "Every cell a don't-care — the minimizer may do anything it likes.",
    build: () => forAllSegs(() => 'X'),
  },
  {
    id: 'parity-odd',
    label: 'Odd parity',
    scope: 'segment',
    description: '1 for inputs with an odd number of 1s — the checkerboard worst case.',
    build: () => forAllSegs((_, code) => (PARITY_ODD.has(code) ? 1 : 0)),
  },
  {
    id: 'threshold-ge5',
    label: 'Threshold ≥ 5',
    scope: 'segment',
    description: '1 for codes 5–9, 0 for 0–4, X on 10–15 — a magnitude-comparator bit.',
    build: () => forAllSegs((_, code) => (code >= 5 && code <= 9 ? 1 : code >= 10 ? 'X' : 0)),
  },
  {
    id: 'random',
    label: 'Random practice map',
    scope: 'segment',
    description: 'A fresh random mix of 0/1/X on every apply (≈40/40/20) — minimize it!',
    build: () => forAllSegs(() => randomCell()),
  },
];
