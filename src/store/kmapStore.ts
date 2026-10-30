'use client';

/**
 * K-map lab state (decoder design lab).
 *
 * Kept in a module-level Zustand store so edits survive tab switches
 * (KMapTab unmounts when the user visits the bench/reference tabs) and page
 * reloads (localStorage via the persist middleware, rehydrated after mount to
 * avoid SSR hydration mismatches).
 *
 * Cell storage: every segment always holds 32 values — the lower 16 are the
 * E = 0 plane, the upper 16 the E = 1 plane (minterm index = E<<4 | W X Y Z).
 * 4-variable mode reads/writes only the lower 16; the E = 1 plane is retained
 * so toggling 5 → 4 → 5 never loses user edits. Until the user edits an E = 1
 * plane it is a mirror of E = 0 (`e1Dirty` flag), matching the classic
 * "E drops out of the SOP" mental model.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CLASSIC_SEGMENT_EQUATIONS } from '@/data/chips';
import type { KMapCell, SegmentId } from '@/lib/logibench/types';

export type SegKey = SegmentId;

export const KMAP_SEGS: SegKey[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** Per-segment storage: always 32 cells (E=0 plane + E=1 plane). */
type Cells = Record<SegKey, KMapCell[]>;

/** Classic 32-cell map: classic values mirrored onto both planes. */
function classicCells(seg: SegKey): KMapCell[] {
  return [...CLASSIC_SEGMENT_EQUATIONS[seg], ...CLASSIC_SEGMENT_EQUATIONS[seg]] as KMapCell[];
}

function classicAll(): Cells {
  const out = {} as Cells;
  for (const seg of KMAP_SEGS) out[seg] = classicCells(seg);
  return out;
}

const noEdits = (): Record<SegKey, boolean> => ({
  a: false, b: false, c: false, d: false, e: false, f: false, g: false,
});

/** Click cycle: 0 → 1 → X → 0. */
const cycle = (v: KMapCell): KMapCell => (v === 0 ? 1 : v === 1 ? 'X' : 0);

export interface KmapState {
  /** active segment tab — persisted so returning to the lab restores context */
  segment: SegKey;
  /** active variable count — the UI shows 16 minterms (4-var) or 32 (5-var) */
  vars: 4 | 5;
  /** per-segment 32-cell maps (E = 0 plane + E = 1 plane) */
  cells: Cells;
  /** true once the user edits a segment's E = 1 plane; until then 4 → 5 re-mirrors E = 0 */
  e1Dirty: Record<SegKey, boolean>;

  setSegment: (seg: SegKey) => void;
  cycleCell: (seg: SegKey, code: number) => void;
  toggleVars: (next: 4 | 5) => void;
  resetSegment: (seg: SegKey) => void;
  resetAll: () => void;
}

function isKMapCell(v: unknown): v is KMapCell {
  return v === 0 || v === 1 || v === 'X';
}

/** Validate persisted shape; fall back to defaults on anything unexpected. */
function sanitizeCells(input: unknown): Cells | null {
  if (!input || typeof input !== 'object') return null;
  const src = input as Record<string, unknown>;
  const out = {} as Cells;
  for (const seg of KMAP_SEGS) {
    const arr = src[seg];
    if (!Array.isArray(arr) || arr.length !== 32 || !arr.every(isKMapCell)) return null;
    out[seg] = arr as KMapCell[];
  }
  return out;
}

function sanitizeSegment(v: unknown): SegKey | null {
  return KMAP_SEGS.includes(v as SegKey) ? (v as SegKey) : null;
}

export const useKmapStore = create<KmapState>()(
  persist(
    (set) => ({
      segment: 'a',
      vars: 4,
      cells: classicAll(),
      e1Dirty: noEdits(),

      setSegment: (seg) => set({ segment: seg }),

      cycleCell: (seg, code) =>
        set((s) => {
          const next = [...s.cells[seg]];
          next[code] = cycle(next[code]);
          return {
            cells: { ...s.cells, [seg]: next },
            e1Dirty: code >= 16 ? { ...s.e1Dirty, [seg]: true } : s.e1Dirty,
          };
        }),

      toggleVars: (next) =>
        set((s) => {
          if (next === s.vars) return s;
          if (next === 4) return { vars: 4 }; // E = 1 plane stays stored for later
          // 4 → 5: mirror E = 0 onto E = 1 unless the user already edited it
          const cells = { ...s.cells };
          const e1Dirty = { ...s.e1Dirty };
          for (const seg of KMAP_SEGS) {
            if (!e1Dirty[seg]) {
              const lower = s.cells[seg].slice(0, 16);
              cells[seg] = [...lower, ...lower];
            }
          }
          return { vars: 5, cells, e1Dirty };
        }),

      resetSegment: (seg) =>
        set((s) => {
          const classic = CLASSIC_SEGMENT_EQUATIONS[seg] as KMapCell[];
          // 4-var mode resets what is visible (the E = 0 plane) and keeps any
          // stored E = 1 edits; 5-var mode resets both planes.
          const upper = s.vars === 4 ? s.cells[seg].slice(16) : classic;
          return {
            cells: { ...s.cells, [seg]: [...classic, ...upper] },
            e1Dirty: s.vars === 5 ? { ...s.e1Dirty, [seg]: false } : s.e1Dirty,
          };
        }),

      resetAll: () => set({ cells: classicAll(), e1Dirty: noEdits() }),
    }),
    {
      name: 'logibench-kmap-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrate manually after mount (see KMapTab) so the first client render
      // matches the server render — no hydration mismatch.
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const cells = sanitizeCells(p.cells);
        const segment = sanitizeSegment(p.segment) ?? current.segment;
        const vars = p.vars === 5 ? 5 : p.vars === 4 ? 4 : current.vars;
        const e1DirtySrc = (p.e1Dirty ?? {}) as Record<string, unknown>;
        const e1Dirty = { ...noEdits() };
        for (const seg of KMAP_SEGS) e1Dirty[seg] = e1DirtySrc[seg] === true;
        return {
          ...current,
          segment,
          vars,
          cells: cells ?? current.cells,
          e1Dirty,
          // actions always come from `current`
          setSegment: current.setSegment,
          cycleCell: current.cycleCell,
          toggleVars: current.toggleVars,
          resetSegment: current.resetSegment,
          resetAll: current.resetAll,
        };
      },
    },
  ),
);
