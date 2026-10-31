'use client';

import { create } from 'zustand';
import type {
  HoleRef, PartInstance, PartType, Project, SimResult, Wire,
} from '@/lib/logibench/types';
import {
  ALL_ROWS, BOARD_SPECS, boardDims, checkPlacement, holeExists, holeKey, pinCount, sameHole, wireColorFor,
} from '@/lib/logibench/geometry';
import { buildNetlistCached } from '@/lib/logibench/netlist';
import { autoPowerWires } from '@/lib/logibench/autowire';
import { Simulator } from '@/lib/logibench/sim';
import { migrateProject } from '@/lib/logibench/migrate';
import { emptyProject, demo7447, demo4511, demoTwoBoard } from '@/lib/logibench/demo';
import type { RailLayout } from '@/lib/logibench/types';

export type Selection = { kind: 'part' | 'wire' | 'board'; id: string } | null;
export type Mode = 'select' | 'wire' | 'simulate';

export const MAX_BOARDS = 6;

export interface PlacementState {
  type: PartType;
  defId?: string;
  /** two-pin parts: first hole chosen */
  anchor?: HoleRef;
  /** default props for the placed part (e.g. seg7 polarity) */
  preset?: PartInstance['props'];
}

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  selection: Selection;
  mode: Mode;
  placement: PlacementState | null;
  wireStart: HoleRef | null;
  running: boolean;
  simResult: SimResult | null;
  hoverHole: string | null;
  /** holeKey the ERC panel wants the canvas to pulse (issue deep-link) */
  ercFocus: string | null;
  projectId: string | null; // saved project id (backend)
  wireColor: string;
  /** bench-convention assist: leads touching a + rail go red, a − rail black */
  autoColor: boolean;
  /** transient user-facing message (e.g. rejected wire drop) */
  flash: string | null;
  /** live (non-persisted) switch/button states while simulating */
  liveSwitches: Record<string, boolean>;

  setFlash: (msg: string | null) => void;
  setWireColor: (c: string) => void;
  setAutoColor: (v: boolean) => void;
  setErcFocus: (key: string | null) => void;

  setName: (name: string) => void;
  commit: (mutate: (p: Project) => void) => void;
  undo: () => void;
  redo: () => void;

  setMode: (m: Mode) => void;
  startPlacement: (type: PartType, defId?: string, preset?: PartInstance['props']) => void;
  cancelPlacement: () => void;
  placeAt: (hole: HoleRef) => void;
  startWireAt: (hole: HoleRef) => void;
  addWire: (from: HoleRef, to: HoleRef, color?: string) => void;
  select: (sel: Selection) => void;
  deleteSelection: () => void;
  updatePart: (id: string, props: Partial<PartInstance['props']>) => void;
  /** wire tweaks from the Inspector/canvas (lift, color, re-termination) */
  updateWire: (id: string, props: Partial<Pick<Wire, 'lift' | 'color' | 'from' | 'to' | 'bends'>>) => void;
  /** one-click power wiring for the selected chip / 555 module */
  wireChipPower: (partId: string) => void;
  /** drag-and-drop: move an existing part so its first pin lands on `anchor` */
  movePart: (id: string, anchor: HoleRef) => void;
  /** drag-to-trash: remove a placed part entirely */
  removePart: (id: string) => void;
  rotateTwoPin?: undefined;

  toggleSwitch: (id: string) => void;
  pressButton: (id: string, closed: boolean) => void;

  setHoverHole: (key: string | null) => void;
  setRunning: (r: boolean) => void;
  runSim: () => void;
  stepSim: (dtMs: number) => void;
  resetCounters: () => void;

  loadDemo: (which: 1 | 2 | 3) => void;
  clearAll: () => void;
  loadProject: (p: unknown) => void;
  setSavedId: (id: string | null) => void;
  addBoard: (kind: 'half400' | 'full830') => void;
  removeBoard: (id: string) => void;
  duplicateBoard: (id: string) => void;
  renameBoard: (id: string, label: string) => void;
  moveBoard: (id: string, x: number, y: number) => void;
  setBoardKind: (id: string, kind: 'half400' | 'full830') => void;
  setRailLayout: (id: string, layout: RailLayout) => void;
}

let simulator: Simulator | null = null;

function getSim(project: Project): Simulator {
  if (!simulator) simulator = new Simulator(project);
  else simulator.updateProject(project);
  return simulator;
}

function clone(p: Project): Project {
  return JSON.parse(JSON.stringify(p));
}

let partSeq = 1;
const nextId = (t: string) => `${t}-${Date.now().toString(36)}-${partSeq++}`;

export const useEditor = create<EditorState>((set, get) => ({
  project: emptyProject(),
  past: [],
  future: [],
  selection: null,
  mode: 'select',
  placement: null,
  wireStart: null,
  running: false,
  simResult: null,
  hoverHole: null,
  projectId: null,
  wireColor: '#ea580c',
  autoColor: true,
  ercFocus: null,
  flash: null,
  liveSwitches: {},

  setFlash: (msg) => set({ flash: msg }),

  setWireColor: (c) => set({ wireColor: c }),
  setAutoColor: (v) => set({ autoColor: v }),
  setErcFocus: (key) => set({ ercFocus: key }),

  setName: (name) => get().commit((p) => { p.name = name; }),

  commit: (mutate) => {
    const { project, past } = get();
    const next = clone(project);
    mutate(next);
    set({ project: next, past: [...past.slice(-49), project], future: [] });
    // recompute sim immediately if not running
    if (!get().running) {
      setTimeout(() => get().runSim(), 0);
    }
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future.slice(0, 49)] });
    setTimeout(() => get().runSim(), 0);
  },

  redo: () => {
    const { future, project, past } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, future: future.slice(1), past: [...past, project] });
    setTimeout(() => get().runSim(), 0);
  },

  setMode: (m) => set({ mode: m, placement: null, wireStart: null }),

  startPlacement: (type, defId, preset) => set({ placement: { type, defId, preset }, mode: 'select', selection: null }),

  cancelPlacement: () => set({ placement: null, wireStart: null }),

  placeAt: (hole) => {
    const st = get();
    if (!st.placement) return;
    const { type, defId, anchor } = st.placement;
    const project = st.project;
    const board = project.boards.find((b) => b.id === hole.board) ?? project.boards[0];

    // multi-pin: validate column anchor
    if (type === 'chip' || type === 'seg7') {
      const check = checkPlacement(board.kind, project.parts, type, defId, hole.col, board.id);
      if (!check.ok || !check.holes) {
        set({ placement: null });
        return;
      }
      const part: PartInstance = {
        id: nextId(type), type, defId,
        pins: type === 'chip' ? check.holes : check.holes,
        props: type === 'seg7' ? { polarity: 'CA', color: 'red', ...st.placement.preset } : {},
      };
      get().commit((p) => { p.parts.push(part); });
      set({ placement: null, selection: { kind: 'part', id: part.id } });
      return;
    }

    // two-pin (or 3-pin) parts: pick holes one by one
    if (!anchor) {
      if (!holeExists(board.kind, board.railLayout, hole.row, hole.col)) return;
      set({ placement: { type, defId, anchor: hole } });
      return;
    }
    const count = pinCount({ type, defId, props: {} });
    const pins: HoleRef[] = [anchor, hole];
    if (type === 'clock555' && count === 3) {
      // third pin on the next column
      pins.push({ board: hole.board, col: hole.col + 1, row: hole.row });
    }
    // occupancy check (a tie-point holds exactly one lead) + rail-gap guard
    const occ = new Set(project.parts.flatMap((p) => p.pins.map((h) => `${h.board}:${h.col}:${h.row}`)));
    if (
      pins.some((h) => occ.has(`${h.board}:${h.col}:${h.row}`)) ||
      pins.some((h) => !holeExists(board.kind, board.railLayout, h.row, h.col)) ||
      sameHole(pins[0], pins[1])
    ) {
      set({ placement: null });
      return;
    }
    const defaults: Record<string, PartInstance['props']> = {
      resistor: { ohms: 330 },
      led: { color: 'red' },
      cap: { farads: 1e-7 },
      switch: { closed: false },
      button: { closed: false },
      supply: { volts: 5 },
      clock555: { freqHz: 1 },
    };
    const part: PartInstance = { id: nextId(type), type, defId, pins, props: { ...defaults[type], ...st.placement.preset } };
    get().commit((p) => { p.parts.push(part); });
    set({ placement: null, selection: { kind: 'part', id: part.id } });
  },

  startWireAt: (hole) => {
    const st = get();
    if (!st.wireStart) {
      set({ wireStart: hole, mode: 'wire' });
      return;
    }
    if (sameHole(st.wireStart, hole)) {
      set({ wireStart: null });
      return;
    }
    get().addWire(st.wireStart, hole);
    set({ wireStart: null });
  },

  addWire: (from, to, color) => {
    const project = get().project;
    const boardOf = (h: HoleRef) => project.boards.find((b) => b.id === h.board) ?? project.boards[0];
    const bf = boardOf(from);
    const bt = boardOf(to);
    // a tie-point holds one lead, and groups5 rail gaps are bare plastic
    const occ = new Set([
      ...project.parts.flatMap((p) => p.pins.map((h) => holeKey(h))),
      ...project.wires.flatMap((w) => [holeKey(w.from), holeKey(w.to)]),
    ]);
    if (
      occ.has(holeKey(from)) || occ.has(holeKey(to))
    ) {
      set({ flash: 'That hole is taken — one lead per tie-point.' });
      return;
    }
    if (
      !holeExists(bf.kind, bf.railLayout, from.row, from.col) ||
      !holeExists(bt.kind, bt.railLayout, to.row, to.col)
    ) {
      set({ flash: 'That\u2019s a gap in the rail — bare plastic, nothing to plug into. Use a hole inside a group.' });
      return;
    }
    const w: Wire = {
      id: nextId('w'), from, to,
      color: color ?? (get().autoColor ? wireColorFor(from, to) : undefined) ?? get().wireColor,
    };
    get().commit((p) => { p.wires.push(w); });
    set({ selection: { kind: 'wire', id: w.id } });
  },

  select: (sel) => set({ selection: sel }),

  deleteSelection: () => {
    const { selection } = get();
    if (!selection) return;
    if (selection.kind === 'board') {
      get().removeBoard(selection.id);
      return;
    }
    get().commit((p) => {
      if (selection.kind === 'part') p.parts = p.parts.filter((x) => x.id !== selection.id);
      else p.wires = p.wires.filter((x) => x.id !== selection.id);
    });
    set({ selection: null });
  },

  updatePart: (id, props) => {
    get().commit((p) => {
      const part = p.parts.find((x) => x.id === id);
      if (part) part.props = { ...part.props, ...props };
    });
  },

  updateWire: (id, props) => {
    get().commit((p) => {
      const w = p.wires.find((x) => x.id === id);
      if (w) Object.assign(w, props);
    });
  },

  wireChipPower: (partId) => {
    const project = get().project;
    const res = autoPowerWires(project, partId);
    if (res.wires.length === 0) {
      set({ flash: res.problems[0] ?? 'Power already reaches the rails.' });
      return;
    }
    get().commit((p) => {
      for (const s of res.wires) {
        p.wires.push({ id: nextId('w'), from: s.from, to: s.to, color: s.color });
      }
    });
    set({
      flash: res.problems.length
        ? `Wired ${res.wires.map((w) => w.pinName).join(' + ')}. ${res.problems.join(' ')}`
        : `Wired ${res.wires.map((w) => w.pinName).join(' + ')} to the rails.`,
      selection: { kind: 'part', id: partId },
    });
  },

  movePart: (id, anchor) => {
    const st = get();
    const project = st.project;
    const part = project.parts.find((x) => x.id === id);
    if (!part) return;
    const board = project.boards.find((b) => b.id === anchor.board) ?? project.boards[0];

    // chips / displays: re-anchor to the dropped column (straddles the channel)
    if (part.type === 'chip' || part.type === 'seg7') {
      const others = project.parts.filter((x) => x.id !== id);
      const check = checkPlacement(board.kind, others, part.type, part.defId, anchor.col, board.id);
      if (!check.ok || !check.holes) return;
      // target holes must also be free of wire ends
      const wireOcc = new Set(project.wires.flatMap((w) => [holeKey(w.from), holeKey(w.to)]));
      if (check.holes.some((h) => wireOcc.has(holeKey(h)))) return;
      get().commit((p) => {
        const i = p.parts.findIndex((x) => x.id === id);
        if (i >= 0) p.parts[i].pins = check.holes!;
      });
      set({ selection: { kind: 'part', id } });
      return;
    }

    // two/3-pin parts: translate the whole pin vector by the anchor delta
    const dc = anchor.col - part.pins[0].col;
    const dr = ALL_ROWS.indexOf(anchor.row) - ALL_ROWS.indexOf(part.pins[0].row);
    if (dc === 0 && dr === 0) return;
    const cols = BOARD_SPECS[board.kind].cols;
    const occ = new Set([
      ...project.parts.filter((x) => x.id !== id).flatMap((x) => x.pins.map((h) => holeKey(h))),
      ...project.wires.flatMap((w) => [holeKey(w.from), holeKey(w.to)]),
    ]);
    const newPins: HoleRef[] = [];
    for (const h of part.pins) {
      const col = h.col + dc;
      const ri = ALL_ROWS.indexOf(h.row) + dr;
      if (col < 1 || col > cols || ri < 0 || ri >= ALL_ROWS.length) return;
      const row = ALL_ROWS[ri];
      if (occ.has(holeKey({ board: h.board, col, row }))) return;
      newPins.push({ board: h.board, col, row });
    }
    get().commit((p) => {
      const i = p.parts.findIndex((x) => x.id === id);
      if (i >= 0) p.parts[i].pins = newPins;
    });
    set({ selection: { kind: 'part', id } });
  },

  removePart: (id) => {
    const part = get().project.parts.find((x) => x.id === id);
    if (!part) return;
    get().commit((p) => { p.parts = p.parts.filter((x) => x.id !== id); });
    set({ selection: null });
  },

  toggleSwitch: (id) => {
    const sim = getSim(get().project);
    const next = !sim.getSwitch(id);
    sim.setSwitch(id, next);
    set({ simResult: sim.compute().result, liveSwitches: { ...get().liveSwitches, [id]: next } });
  },

  pressButton: (id, closed) => {
    const sim = getSim(get().project);
    sim.setSwitch(id, closed);
    set({ simResult: sim.compute().result, liveSwitches: { ...get().liveSwitches, [id]: closed } });
  },

  setHoverHole: (key) => set({ hoverHole: key }),

  setRunning: (r) => {
    set({ running: r });
    if (r) get().runSim();
  },

  runSim: () => {
    const { project } = get();
    const sim = getSim(project);
    set({ simResult: sim.compute().result });
  },

  stepSim: (dtMs) => {
    const { project } = get();
    const sim = getSim(project);
    const out = sim.step(dtMs);
    set({ simResult: out.result });
  },

  resetCounters: () => {
    const sim = getSim(get().project);
    sim.resetCounters();
    set({ simResult: sim.compute().result });
  },

  loadDemo: (which) => {
    const p = which === 1 ? demo7447() : which === 2 ? demo4511() : demoTwoBoard();
    simulator = null;
    set({
      project: p, past: [], future: [], selection: null, placement: null,
      wireStart: null, projectId: null, ercFocus: null,
    });
    setTimeout(() => get().runSim(), 0);
  },

  clearAll: () => {
    simulator = null;
    set({
      project: emptyProject(), past: [], future: [], selection: null,
      placement: null, wireStart: null, projectId: null, ercFocus: null, simResult: null,
    });
  },

  loadProject: (p) => {
    const m = migrateProject(p);
    if (!m) return;
    simulator = null;
    set({
      project: m.project, past: [], future: [], selection: null, placement: null,
      wireStart: null, projectId: null, ercFocus: null,
    });
    setTimeout(() => get().runSim(), 0);
  },

  setSavedId: (id) => set({ projectId: id }),

  addBoard: (kind) => {
    const st = get();
    if (st.project.boards.length >= MAX_BOARDS) {
      st.setFlash(`Board limit reached (${MAX_BOARDS}).`);
      return;
    }
    get().commit((p) => {
      const n = p.boards.length;
      let id = `b${n + 1}`;
      while (p.boards.some((b) => b.id === id)) id = `b${n + 1}-${Math.random().toString(36).slice(2, 5)}`;
      const last = p.boards[n - 1];
      const dims = boardDims(last?.kind ?? 'half400');
      p.boards.push({
        id,
        kind,
        railLayout: kind === 'full830' ? 'groups5' : 'continuous',
        label: `Board ${n + 1}`,
        x: (last?.x ?? 0) + dims.width + 80,
        y: last?.y ?? 0,
      });
    });
    set({ selection: null });
  },

  removeBoard: (id) => {
    const st = get();
    if (st.project.boards.length <= 1) {
      st.setFlash('The project needs at least one board.');
      return;
    }
    get().commit((p) => {
      p.boards = p.boards.filter((b) => b.id !== id);
      p.parts = p.parts.filter((pt) => pt.pins.every((h) => h.board !== id));
      p.wires = p.wires.filter((w) => w.from.board !== id && w.to.board !== id);
    });
    set({ selection: null });
  },

  duplicateBoard: (id) => {
    const st = get();
    if (st.project.boards.length >= MAX_BOARDS) {
      st.setFlash(`Board limit reached (${MAX_BOARDS}).`);
      return;
    }
    get().commit((p) => {
      const src = p.boards.find((b) => b.id === id);
      if (!src) return;
      let nid = `${src.id}-copy`;
      while (p.boards.some((b) => b.id === nid)) nid = `${src.id}-${Math.random().toString(36).slice(2, 5)}`;
      const dims = boardDims(src.kind);
      p.boards.push({
        ...src,
        id: nid,
        label: `${src.label ?? src.id} copy`,
        x: (src.x ?? 0) + dims.width + 80,
      });
      for (const part of p.parts) {
        if (part.pins.every((h) => h.board === id)) {
          p.parts.push({
            ...JSON.parse(JSON.stringify(part)),
            id: nextId(part.type),
            pins: part.pins.map((h) => ({ ...h, board: nid })),
          });
        }
      }
      for (const w of p.wires) {
        if (w.from.board === id && w.to.board === id) {
          p.wires.push({ ...w, id: nextId('w'), from: { ...w.from, board: nid }, to: { ...w.to, board: nid } });
        }
      }
    });
  },

  renameBoard: (id, label) => {
    get().commit((p) => {
      const b = p.boards.find((x) => x.id === id);
      if (b) b.label = label.trim().slice(0, 24) || undefined;
    });
  },

  moveBoard: (id, x, y) => {
    get().commit((p) => {
      const b = p.boards.find((x2) => x2.id === id);
      if (b) { b.x = x; b.y = y; }
    });
  },

  setBoardKind: (id, kind) => {
    get().commit((p) => {
      const b = p.boards.find((x) => x.id === id);
      if (b) b.kind = kind;
    });
  },

  setRailLayout: (id, layout) => {
    get().commit((p) => {
      const b = p.boards.find((x) => x.id === id);
      if (b) b.railLayout = layout;
    });
  },
}));

/** Net holes for hover highlight (cached netlist per project revision). */
export function netHolesOf(key: string, project: Project): string[] {
  const switchStates = new Map<string, boolean>();
  const sim = simulator;
  if (sim) {
    for (const p of project.parts) {
      if (p.type === 'switch' || p.type === 'button') switchStates.set(p.id, sim.getSwitch(p.id));
    }
  }
  const { nets, holeNet } = buildNetlistCached(project, switchStates);
  const netId = holeNet.get(key);
  if (netId === undefined) return [key];
  return nets[netId].holes;
}

// debug/e2e handle (browser only)
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__lb = useEditor;
}
