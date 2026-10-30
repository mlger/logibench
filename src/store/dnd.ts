'use client';

import { create } from 'zustand';
import type { PartInstance, PartType } from '@/lib/logibench/types';

/**
 * Transient drag-and-drop state for the bench.
 *
 * `payload` is identity-stable for the whole drag session (subscribing
 * components re-render only at drag start/end), while `x`/`y` are separate
 * primitives updated per pointer-move (only the floating label subscribes to
 * them). Selectors must never derive fresh objects here — React's
 * useSyncExternalStore would treat each snapshot as changed and loop forever.
 */
export interface DragPayload {
  source: 'palette' | 'board';
  type: PartType;
  defId?: string;
  preset?: PartInstance['props'];
  /** set when source === 'board' (moving an existing part) */
  partId?: string;
  /** short label shown in the floating drag ghost, e.g. "7430", "330 Ω" */
  label: string;
}

export type DragInit = DragPayload;

interface DndState {
  payload: DragPayload | null;
  x: number;
  y: number;
  start: (p: DragInit, x: number, y: number) => void;
  moveTo: (x: number, y: number) => void;
  cancel: () => void;
}

export const useDnd = create<DndState>((set) => ({
  payload: null,
  x: 0,
  y: 0,
  start: (p, x, y) => set({ payload: { ...p }, x, y }),
  moveTo: (x, y) => set({ x, y }),
  cancel: () => set({ payload: null }),
}));

// debug/e2e handle (browser only)
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__lbd = useDnd;
}
