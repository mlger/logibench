'use client';

/**
 * LogicBench PH — Decoder Design Lab (plan §3.3).
 *
 * BCD truth table → interactive per-segment K-map → minimized SOP → gate
 * list (AND–OR and NAND-only) → parts-inventory check. K-map cells cycle
 * 0 → 1 → X on click (arrow keys move between cells); the classic
 * per-segment truth values (don't-cares on codes 10–15) come from
 * CLASSIC_SEGMENT_EQUATIONS (plan §4.6).
 *
 * State lives in useKmapStore (Zustand + localStorage, rehydrated after
 * mount) so edits survive tab switches and page reloads.
 *
 * Supports 4 variables (W X Y Z) and 5 variables (E W X Y Z): the 5-var map
 * is the classic two stacked 4×4 planes, where E selects the plane and
 * minterm index = E<<4 | W X Y Z. The E = 1 plane mirrors E = 0 until edited
 * and survives 5 → 4 → 5 toggles.
 *
 * A datasheet-style truth table (TruthTablePanel, docs/kmap-truth-table-plan.md)
 * edits the very same store cells from a per-code row view: hovering or
 * focusing a map cell highlights the matching table row and vice versa —
 * hoverCode is ephemeral KMapTab state, shared by both views.
 *
 * Every minimized term is also drawn as a colored loop over the cells it
 * groups (the classic pencil loops): term chips and map loops share colors,
 * and hovering/focusing either side traces the group on the other.
 *
 * A preset menu, a live seven-segment decoder preview and editable variable
 * names complete the lab (docs/kmap-lab-presets-vars-preview-plan.md):
 * presets write the same store cells, the preview renders the stored cells
 * for a chosen or hovered input, and variable names re-label every surface
 * without moving any bits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Lightbulb, Minus, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  KMAP_COLS,
  KMAP_ROWS,
  effectiveNames,
  minimize,
  sopToGates,
  sopToNandGates,
  type GateListEntry,
} from '@/lib/logibench/kmap';
import { CLASSIC_SEGMENT_EQUATIONS } from '@/data/chips';
import type { Family, InventoryItem, KMapCell, MinTerm } from '@/lib/logibench/types';
import { DEFAULT_VAR_NAMES, KMAP_SEGS, useKmapStore, type SegKey } from '@/store/kmapStore';
import DecoderPreviewCard from '@/components/logibench/DecoderPreviewCard';
import PresetMenu from '@/components/logibench/PresetMenu';
import VarNameEditor from '@/components/logibench/VarNameEditor';
import TruthTablePanel from '@/components/logibench/TruthTablePanel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const SEGS: SegKey[] = KMAP_SEGS;

/** Section-header token: small, uppercase, tracked out. */
const HDR = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

/** Families whose on-hand stock counts toward TTL/CMOS gate builds. */
const USABLE_FAMILIES: Family[] = ['LS', 'HC', 'HCT', 'CD4000'];

/** Classic hand minimizations (plan §4.6) for the sanity-check note. */
const CLASSIC_SOP: { seg: SegKey; expr: string }[] = [
  { seg: 'a', expr: 'W + Y + XZ + X′Z′' },
  { seg: 'b', expr: 'X′ + Y′Z′ + YZ' },
  { seg: 'c', expr: 'X + Y′ + Z' },
  { seg: 'd', expr: 'W + X′Z′ + X′Y + YZ′ + XY′Z' },
  { seg: 'e', expr: 'X′Z′ + YZ′' },
  { seg: 'f', expr: 'W + Y′Z′ + XY′ + XZ′' },
  { seg: 'g', expr: 'W + XY′ + X′Y + YZ′' },
];

/** Usable stock for one chip: matching base, buildable family, healthy. */
function stockFor(items: InventoryItem[], chip: string): number {
  return items
    .filter(
      (it) =>
        it.base === chip &&
        USABLE_FAMILIES.includes(it.family) &&
        (it.condition === 'new' || it.condition === 'used'),
    )
    .reduce((sum, it) => sum + it.qty, 0);
}

/**
 * Loop colors cycled per term index so overlapping groups stay distinguishable.
 * Term chips reuse the same family, so a chip and its map loop visibly match.
 */
const LOOP_COLORS = [
  {
    border: 'border-amber-500',
    bg: 'bg-amber-500/15',
    bgHot: 'bg-amber-500/30',
    chip: 'border-amber-300 bg-amber-50 text-amber-700',
    ring: 'ring-amber-500',
  },
  {
    border: 'border-emerald-500',
    bg: 'bg-emerald-500/15',
    bgHot: 'bg-emerald-500/30',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    ring: 'ring-emerald-500',
  },
  {
    border: 'border-violet-500',
    bg: 'bg-violet-500/15',
    bgHot: 'bg-violet-500/30',
    chip: 'border-violet-300 bg-violet-50 text-violet-700',
    ring: 'ring-violet-500',
  },
  {
    border: 'border-rose-500',
    bg: 'bg-rose-500/15',
    bgHot: 'bg-rose-500/30',
    chip: 'border-rose-300 bg-rose-50 text-rose-700',
    ring: 'ring-rose-500',
  },
  {
    border: 'border-teal-500',
    bg: 'bg-teal-500/15',
    bgHot: 'bg-teal-500/30',
    chip: 'border-teal-300 bg-teal-50 text-teal-700',
    ring: 'ring-teal-500',
  },
];

/** One drawn loop: top-left cell (r, c), spanning h rows × w columns. */
interface LoopRect {
  r: number;
  c: number;
  h: number;
  w: number;
}

/**
 * Textbook loop rectangles for one implicant's covered cells (plane-local
 * codes 0–15). Minterm codes are binary (W X / Y Z), but the map lays cells
 * out in Gray order, so each code's row/column value is mapped through
 * KMAP_ROWS/KMAP_COLS first. An implicant is then a product of a row set × a
 * column set; each set splits into consecutive runs, so a Z′ group (columns
 * 00 & 10 — the Gray wrap pair) becomes two half-loops on the map edges and
 * X′Z′ becomes four corner loops. Runs never merge across the wrap, keeping
 * every rectangle inside the grid.
 */
function loopRects(covers: number[]): LoopRect[] {
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (const code of covers) {
    rows.add(KMAP_ROWS.indexOf(code >> 2));
    cols.add(KMAP_COLS.indexOf(code & 3));
  }
  const runs = (set: Set<number>): [number, number][] => {
    const out: [number, number][] = [];
    for (const i of [...set].sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last && last[1] === i - 1) last[1] = i;
      else out.push([i, i]);
    }
    return out;
  };
  const rects: LoopRect[] = [];
  for (const [r0, r1] of runs(rows))
    for (const [c0, c1] of runs(cols))
      rects.push({ r: r0, c: c0, h: r1 - r0 + 1, w: c1 - c0 + 1 });
  return rects;
}

function cellClasses(v: KMapCell, isEdited: boolean, compact = false): string {
  const base = `relative flex ${compact ? 'size-14' : 'size-16'} cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600`;
  const byVal =
    v === 1
      ? 'border-amber-600 bg-amber-100 text-amber-900 hover:border-amber-700'
      : v === 'X'
        ? 'border-dashed border-stone-400 bg-stone-100 text-stone-500 hover:border-stone-500'
        : 'border-stone-200 bg-white text-stone-400 hover:border-stone-400';
  return `${base} ${byVal}${isEdited ? ' ring-2 ring-amber-400/60' : ''}`;
}

function GateTable({ entries, empty }: { entries: GateListEntry[]; empty: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-stone-400">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[18rem] text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200">
            <th scope="col" className={`${HDR} py-1.5 pr-4`}>
              Chip
            </th>
            <th scope="col" className={`${HDR} py-1.5 pr-4`}>
              Qty
            </th>
            <th scope="col" className={`${HDR} py-1.5`}>
              Purpose
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((g, i) => (
            <tr
              key={`${g.chip}-${g.purpose}-${i}`}
              className="border-b border-stone-100 last:border-b-0"
            >
              <td className="py-1.5 pr-4 font-mono font-semibold text-stone-800">{g.chip}</td>
              <td className="py-1.5 pr-4 font-mono text-stone-700">×{g.qty}</td>
              <td className="py-1.5 text-stone-600">{g.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Per-build inventory check: needed chips vs on-hand usable stock. */
function StockList({
  title,
  entries,
  inv,
  empty,
}: {
  title: string;
  entries: GateListEntry[];
  inv: InventoryItem[] | null;
  empty: string;
}) {
  return (
    <section aria-label={`${title} inventory check`} className="flex flex-col gap-1.5">
      <h3 className={HDR}>{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-stone-400">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((g) => {
            const have = inv ? stockFor(inv, g.chip) : 0;
            const status =
              have === 0
                ? {
                    label: 'not in inventory',
                    cls: 'border-stone-200 bg-stone-100 text-stone-500',
                    Icon: Minus,
                  }
                : have >= g.qty
                  ? {
                      label: 'OK',
                      cls: 'border-emerald-200 bg-emerald-50 text-emerald-600',
                      Icon: Check,
                    }
                  : {
                      label: `short by ${g.qty - have}`,
                      cls: 'border-red-200 bg-red-50 text-red-600',
                      Icon: X,
                    };
            return (
              <div
                key={g.chip}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-stone-800">{g.chip}</span>
                  <span className="text-xs text-stone-500">
                    need {g.qty} · have {have}
                  </span>
                </div>
                <Badge variant="outline" className={`${status.cls} gap-1`}>
                  <status.Icon className="size-3" aria-hidden="true" />
                  {status.label}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** 0..3 → "00".."11" for K-map row/column labels. */
const bits2 = (v: number): string => v.toString(2).padStart(2, '0');

/**
 * One 4×4 K-map plane. In 5-var mode (`five`) minterm codes are offset by
 * 16·E and labels mention the plane; `compact` shrinks cells so two stacked
 * planes fit on screen together. Cells expose ids/data attrs so arrow keys
 * can move focus between visual neighbours. `highlightCode` draws an amber
 * outline on the cell matching the truth-table row under the pointer.
 *
 * Each minimized `term` is drawn as a translucent loop over the cells it
 * groups, as extra grid items spanning their cells (CSS computes the span
 * geometry; wrap-around groups arrive pre-split into edge half-loops).
 * `activeTerm` (chip hover/focus) emphasizes one loop; the cell under
 * `highlightCode` emphasizes every loop that covers it.
 */
function PlaneGrid({
  segment,
  names,
  cells,
  edited,
  onCellClick,
  e,
  five,
  compact,
  highlightCode,
  terms,
  activeTerm,
}: {
  segment: SegKey;
  /** effective variable names (length 4 or 5) — corner label + aria labels */
  names: readonly string[];
  cells: KMapCell[];
  edited: boolean[];
  onCellClick: (code: number) => void;
  e: 0 | 1;
  five: boolean;
  compact: boolean;
  highlightCode?: number | null;
  terms: MinTerm[];
  activeTerm: number | null;
}) {
  /* terms emphasized right now: the chip under the pointer/focus plus every
     term grouping the highlighted cell (map hover or truth-table row hover) */
  const emphasized = new Set<number>();
  if (activeTerm != null) emphasized.add(activeTerm);
  if (highlightCode != null) {
    terms.forEach((t, i) => {
      if (t.covers.includes(highlightCode)) emphasized.add(i);
    });
  }
  const anyEmphasis = emphasized.size > 0;

  return (
    <div
      role="group"
      aria-label={`Karnaugh map for segment ${segment}${five ? `, plane ${names[0]} = ${e}` : ''}, 16 minterms`}
      className={`grid gap-1.5 ${
        compact
          ? 'min-w-[19rem] grid-cols-[2.25rem_repeat(4,3.5rem)]'
          : 'min-w-[21rem] grid-cols-[2.5rem_repeat(4,4rem)]'
      }`}
    >
      {/* corner label */}
      <div className="flex items-center justify-center rounded-md bg-stone-50 font-mono text-[10px] leading-tight text-stone-400">
        <span>{names[0]}{names[1]}</span>
        <span className="mx-0.5 text-stone-300">\</span>
        <span>{names[2]}{names[3]}</span>
      </div>
      {/* column headers (Y Z) */}
      {KMAP_COLS.map((yz) => (
        <div
          key={`col-${yz}`}
          className="flex items-center justify-center rounded-md bg-stone-50 font-mono text-xs font-medium text-stone-500"
        >
          {bits2(yz)}
        </div>
      ))}
      {/* rows (W X) with cells — explicit grid areas so the loop overlays
          below (also explicitly placed) may legally share their tracks;
          auto-placed items would refuse to overlap and shift the map down */}
      {KMAP_ROWS.map((wx, r) => (
        <div
          key={`row-${wx}`}
          className="col-span-5 grid grid-cols-subgrid"
          style={{ gridArea: `${r + 2} / 1 / span 1 / span 5` }}
        >
          <div className="flex items-center justify-center rounded-md bg-stone-50 font-mono text-xs font-medium text-stone-500">
            {bits2(wx)}
          </div>
          {KMAP_COLS.map((yz, c) => {
            const code = e * 16 + wx * 4 + yz;
            const v = cells[code];
            return (
              <button
                key={`cell-${code}`}
                id={`kmap-cell-${e}-${r}-${c}`}
                type="button"
                data-r={r}
                data-c={c}
                data-e={e}
                onClick={() => onCellClick(code)}
                aria-label={`minterm m${code}${five ? `, ${names[0]} = ${e}` : ''}, ${names[0]}${names[1]}=${bits2(wx)}, ${names[2]}${names[3]}=${bits2(yz)}, value ${v}. Click to cycle 0, 1, X.`}
                className={`${cellClasses(v, edited[code], compact)}${
                  highlightCode === code ? ' outline-2 outline-amber-500' : ''
                }`}
              >
                <span className="pointer-events-none absolute left-1 top-0.5 font-mono text-[10px] text-stone-400">
                  m{code}
                </span>
                <span className="font-mono text-lg font-bold">{v}</span>
              </button>
            );
          })}
        </div>
      ))}
      {/* implicant loops — translucent overlays spanning their cells; they sit
          above the buttons but ignore pointer events, so edits still work */}
      {terms.flatMap((t, i) => {
        const local = t.covers.filter((code) => (code >> 4) === e).map((code) => code & 15);
        if (local.length === 0) return [];
        const col = LOOP_COLORS[i % LOOP_COLORS.length];
        const hot = emphasized.has(i);
        return loopRects(local).map((rc, j) => (
          <div
            key={`loop-${i}-${j}`}
            aria-hidden="true"
            className={`pointer-events-none rounded-lg ${col.border} ${
              hot ? `z-20 border-[3px] ${col.bgHot}` : `z-10 border-2 ${col.bg}`
            }${anyEmphasis && !hot ? ' opacity-35' : ''}`}
            style={{ gridArea: `${rc.r + 2} / ${rc.c + 2} / span ${rc.h} / span ${rc.w}` }}
          />
        ));
      })}
    </div>
  );
}

/** Arrow keys move focus between visually adjacent cells inside one plane. */
function onMapKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
  const btn = (ev.target as HTMLElement).closest('button[data-r]');
  if (!btn) return;
  const r = Number(btn.getAttribute('data-r'));
  const c = Number(btn.getAttribute('data-c'));
  const plane = btn.getAttribute('data-e') ?? '0';
  let nr = r;
  let nc = c;
  if (ev.key === 'ArrowUp') nr = r - 1;
  else if (ev.key === 'ArrowDown') nr = r + 1;
  else if (ev.key === 'ArrowLeft') nc = c - 1;
  else if (ev.key === 'ArrowRight') nc = c + 1;
  else return;
  if (nr < 0 || nr > 3 || nc < 0 || nc > 3) return;
  ev.preventDefault();
  document.getElementById(`kmap-cell-${plane}-${nr}-${nc}`)?.focus();
}

export default function KMapTab() {
  /* ---------- persisted lab state (survives tab switches & reloads) ---------- */
  const segment = useKmapStore((s) => s.segment);
  const vars = useKmapStore((s) => s.vars);
  const cells32 = useKmapStore((s) => s.cells[segment]);
  const allCells = useKmapStore((s) => s.cells);
  const e1DirtyMap = useKmapStore((s) => s.e1Dirty);
  const setSegmentStore = useKmapStore((s) => s.setSegment);
  const cycleCell = useKmapStore((s) => s.cycleCell);
  const toggleVarsStore = useKmapStore((s) => s.toggleVars);
  const resetSegmentStore = useKmapStore((s) => s.resetSegment);
  const resetAllStore = useKmapStore((s) => s.resetAll);
  const varNames = useKmapStore((s) => s.varNames);
  const setVarNameStore = useKmapStore((s) => s.setVarName);
  const resetVarNamesStore = useKmapStore((s) => s.resetVarNames);
  const applyPresetStore = useKmapStore((s) => s.applyPreset);

  /* cross-highlight between the K-map and the truth table (ephemeral) */
  const [hoverCode, setHoverCode] = useState<number | null>(null);
  /* term chip hover/focus → emphasize its loop on the map (ephemeral) */
  const [activeTerm, setActiveTerm] = useState<number | null>(null);
  /* decoder preview: selected input code + segment-letter labels (ephemeral) */
  const [selectedCode, setSelectedCode] = useState(0);
  const [showLabels, setShowLabels] = useState(true);

  /* map-cell hover/focus → truth-table row highlight (event delegation on the map wrapper).
     data-r/data-c are GRID positions, so they map through the Gray-code row/col
     tables to the minterm code — r*4+c alone would be wrong wherever the Gray
     value differs from the index (positions 2 and 3). */
  const mapCellFrom = (target: EventTarget | null): number | null => {
    const btn = (target as HTMLElement).closest('button[data-r]');
    if (!btn) return null;
    const r = Number(btn.getAttribute('data-r'));
    const c = Number(btn.getAttribute('data-c'));
    const e = Number(btn.getAttribute('data-e') ?? '0');
    return e * 16 + KMAP_ROWS[r] * 4 + KMAP_COLS[c];
  };

  /* rehydrate after mount — first render matches SSR, then stored edits land */
  useEffect(() => {
    void useKmapStore.persist.rehydrate();
  }, []);

  /* the preview's selected code must stay inside the visible plane count */
  useEffect(() => {
    if (vars === 4) setSelectedCode((c) => Math.min(c, 15));
  }, [vars]);

  /* ---------- inventory fetch ---------- */

  const [inv, setInv] = useState<InventoryItem[] | null>(null);
  const [invError, setInvError] = useState<string | null>(null);
  const [invLoading, setInvLoading] = useState(true);

  const loadInventory = useCallback(async () => {
    setInvLoading(true);
    setInvError(null);
    try {
      const res = await fetch('/api/inventory');
      if (!res.ok) throw new Error(`Inventory request failed (HTTP ${res.status}).`);
      setInv((await res.json()) as InventoryItem[]);
    } catch (e) {
      setInv(null);
      setInvError(e instanceof Error ? e.message : 'Could not load the parts inventory.');
    } finally {
      setInvLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  /* ---------- derived state (recomputed on every edit) ---------- */

  const cells = useMemo(
    () => (vars === 4 ? cells32.slice(0, 16) : cells32),
    [cells32, vars],
  );
  /* effective variable names — slot 0 is the 5-var MSB, invisible in 4-var mode */
  const names = useMemo(() => effectiveNames(varNames, vars), [varNames, vars]);
  const namesCustomized = useMemo(
    () => varNames.some((v, i) => v !== DEFAULT_VAR_NAMES[i]),
    [varNames],
  );
  const terms = useMemo(() => minimize(cells, names), [cells, names]);
  const gates = useMemo(() => sopToGates(terms), [terms]);
  const nandGates = useMemo(() => sopToNandGates(terms), [terms]);
  /* terms grouping the hovered/focused map or truth-table cell (ephemeral) */
  const hoverCoverTerms = useMemo(
    () =>
      hoverCode == null
        ? []
        : terms.flatMap((t, i) => (t.covers.includes(hoverCode) ? [i] : [])),
    [terms, hoverCode],
  );
  const edited = useMemo(
    () => cells.map((v, i) => v !== CLASSIC_SEGMENT_EQUATIONS[segment][i % 16]),
    [cells, segment],
  );
  const isClassic = edited.every((e) => !e);
  /* segments differing from the classic table anywhere in their 32 cells —
     arms the preset menu's overwrite guard (docs plan §4.3) */
  const editedSegs = useMemo(
    () =>
      KMAP_SEGS.filter((seg) =>
        allCells[seg].some((v, i) => v !== CLASSIC_SEGMENT_EQUATIONS[seg][i % 16]),
      ),
    [allCells],
  );

  const allDontCare = cells.length > 0 && cells.every((v) => v === 'X');
  const isAlwaysOn = terms.some((t) => t.literals.length === 0);
  const sopText =
    terms.length === 0
      ? allDontCare
        ? 'any — every cell is a don′t-care'
        : '0 (segment always off)'
      : isAlwaysOn
        ? '1 (wire to VCC)'
        : terms.map((t) => t.sop).join(' + ');

  const andOrEmpty = allDontCare
    ? 'Nothing to build — every cell is a don\'t-care; tie the segment LOW or HIGH as you like.'
    : terms.length === 0
      ? 'No gates — tie the segment output LOW.'
      : isAlwaysOn
        ? 'No gates — wire the segment output to VCC.'
        : 'No gates needed.';
  const nandEmpty = allDontCare
    ? 'Nothing to build — every cell is a don\'t-care.'
    : terms.length === 0
      ? 'Nothing to build — the segment is always off.'
      : isAlwaysOn
        ? 'Nothing to build — wire to VCC.'
        : 'No NAND gates needed.';

  const gateSummary =
    gates.length === 0 ? 'no gates needed' : gates.map((g) => `${g.qty} × ${g.chip}`).join(', ');

  /* ---------- handlers ---------- */

  const handleCellClick = (code: number) => cycleCell(segment, code);
  const toggleVars = (next: 4 | 5) => toggleVarsStore(next);
  const resetSegment = () => resetSegmentStore(segment);

  /* "Reset all" is armed only when something differs from the classic map */
  const anyEdits = useKmapStore((s) =>
    KMAP_SEGS.some((seg) =>
      s.cells[seg].some((v, i) => v !== CLASSIC_SEGMENT_EQUATIONS[seg][i % 16]),
    ),
  );

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-4">
      {/* Header row: segment selector + variable count + resets + explainer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Segment selector" className="flex flex-wrap gap-1.5">
            {SEGS.map((s) => {
              const active = s === segment;
              return (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-pressed={active}
                  aria-label={`Segment ${s}`}
                  onClick={() => setSegmentStore(s)}
                  className={`size-11 cursor-pointer font-mono text-base font-semibold ${
                    active
                      ? 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700 hover:text-white'
                      : 'text-stone-600 hover:border-amber-500 hover:text-amber-700'
                  }`}
                >
                  {s}
                </Button>
              );
            })}
          </div>
          <div
            role="group"
            aria-label="Input variables"
            className="flex overflow-hidden rounded-md border border-stone-300"
          >
            {([4, 5] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={vars === n}
                onClick={() => toggleVars(n)}
                className={`cursor-pointer px-3 py-1.5 text-sm font-medium transition-colors ${
                  vars === n
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-stone-600 hover:bg-stone-50 hover:text-amber-700'
                }`}
              >
                {n} vars
              </button>
            ))}
          </div>
          {/* key remounts the editor on 4↔5 switches so no stale
              input/error outlives the slot set it was opened for */}
          <VarNameEditor
            key={vars}
            varNames={varNames}
            vars={vars}
            onRename={setVarNameStore}
            onReset={resetVarNamesStore}
          />
        </div>
        <div className="flex items-center gap-2">
          <PresetMenu segment={segment} editedSegs={editedSegs} onApply={applyPresetStore} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetSegment}
            disabled={isClassic}
            className="cursor-pointer"
          >
            <RotateCcw aria-hidden="true" />
            Reset to classic
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!anyEdits}
                className="cursor-pointer"
              >
                <RotateCcw aria-hidden="true" />
                Reset all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all segments to classic?</AlertDialogTitle>
                <AlertDialogDescription>
                  Restores all seven segments — both planes in 5-variable mode — to the classic BCD
                  truth table. Your edits cannot be recovered afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="cursor-pointer">Keep edits</AlertDialogCancel>
                <AlertDialogAction
                  className="cursor-pointer"
                  onClick={() => resetAllStore()}
                >
                  Reset all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <p className="text-sm text-stone-500">
        Active-HIGH (common-cathode) segment outputs. Click any K-map cell to cycle{' '}
        <span className="font-mono font-medium text-stone-700">0 → 1 → X</span> (don&apos;t-care) —
        or focus a cell and use the arrow keys. Codes 10–15 default to X.
        {vars === 5 && (
          <>
            {' '}Five-variable mode: planes stack for {names[0]} = 0 and {names[0]} = 1. The{' '}
            {names[0]} = 1 plane mirrors {names[0]} = 0 until you edit it, and {names[0]} = 1
            edits survive switching back to 4 variables.
          </>
        )}{' '}
        The truth table below edits the same cells row by row.
      </p>

      {/* K-map + minimized result side by side on desktop */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="border-stone-200 bg-white">
          <CardHeader>
            <CardTitle className={HDR}>Karnaugh map — segment {segment}</CardTitle>
            <CardDescription>
              Rows = {names[0]} {names[1]} · Columns = {names[2]} {names[3]}
              {vars === 5 ? ` · Planes = ${names[0]} (0 | 1)` : ''} · Gray order
            </CardDescription>
            <CardAction>
              {!isClassic && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                  edited
                </Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm border border-amber-600 bg-amber-100" aria-hidden="true" />
                1 · lit
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm border border-dashed border-stone-400 bg-stone-100"
                  aria-hidden="true"
                />
                X · don&apos;t-care
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm border border-stone-200 bg-white" aria-hidden="true" />
                0 · off
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-[4px] border-2 border-amber-500 bg-amber-500/15"
                  aria-hidden="true"
                />
                SOP group
              </span>
            </div>
            <div
              className="overflow-x-auto pb-1"
              onKeyDown={onMapKeyDown}
              onMouseOver={(ev) => setHoverCode(mapCellFrom(ev.target))}
              onMouseLeave={() => setHoverCode(null)}
              onFocus={(ev) => setHoverCode(mapCellFrom(ev.target))}
              onBlur={(ev) => {
                if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setHoverCode(null);
              }}
            >
              {vars === 4 ? (
                <PlaneGrid
                  segment={segment}
                  names={names}
                  cells={cells}
                  edited={edited}
                  onCellClick={handleCellClick}
                  e={0}
                  five={false}
                  compact={false}
                  highlightCode={hoverCode}
                  terms={terms}
                  activeTerm={activeTerm}
                />
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="mb-1.5 font-mono text-xs font-semibold text-stone-600">{names[0]} = 0</p>
                    <PlaneGrid
                      segment={segment}
                      names={names}
                      cells={cells}
                      edited={edited}
                      onCellClick={handleCellClick}
                      e={0}
                      five
                      compact
                      highlightCode={hoverCode}
                      terms={terms}
                      activeTerm={activeTerm}
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 font-mono text-xs font-semibold text-stone-600">{names[0]} = 1</p>
                    <PlaneGrid
                      segment={segment}
                      names={names}
                      cells={cells}
                      edited={edited}
                      onCellClick={handleCellClick}
                      e={1}
                      five
                      compact
                      highlightCode={hoverCode}
                      terms={terms}
                      activeTerm={activeTerm}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 bg-white">
          {/* single polite live region summarizing the whole result */}
          <span aria-live="polite" aria-atomic="true" className="sr-only">
            Segment {segment}, {vars} variables. Expression: {sopText}. Gates: {gateSummary}.
          </span>
          <CardHeader>
            <CardTitle className={HDR}>Minimized SOP — live</CardTitle>
            <CardDescription>Quine–McCluskey cover, recomputed on every edit</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="break-words font-mono text-lg leading-relaxed text-stone-900">
                {sopText}
              </p>
            </div>

            <section aria-label="Implicant terms" className="flex flex-col gap-1.5">
              <h3 className={HDR}>Term chips</h3>
              {terms.length === 0 ? (
                <span className="text-sm text-stone-400">— no implicants</span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {terms.map((t, i) => {
                      const col = LOOP_COLORS[i % LOOP_COLORS.length];
                      const hot = i === activeTerm || hoverCoverTerms.includes(i);
                      return (
                        <Badge
                          key={`term-${i}`}
                          tabIndex={0}
                          onMouseEnter={() => setActiveTerm(i)}
                          onMouseLeave={() => setActiveTerm((cur) => (cur === i ? null : cur))}
                          onFocus={() => setActiveTerm(i)}
                          onBlur={() => setActiveTerm((cur) => (cur === i ? null : cur))}
                          aria-label={`Term ${i + 1} of ${terms.length}: ${t.sop}, groups ${t.covers.length} map cells`}
                          className={`cursor-default font-mono ${col.chip}${
                            hot ? ` ring-2 ${col.ring}` : ''
                          }`}
                        >
                          {t.sop}
                        </Badge>
                      );
                    })}
                  </div>
                  <p className="text-xs text-stone-400">
                    Hover or focus a chip to trace its loop on the map — colors match.
                  </p>
                </div>
              )}
            </section>

            <section aria-label="AND-OR gate list" className="flex flex-col gap-1.5">
              <h3 className={HDR}>Gate list — SOP → AND-OR</h3>
              <GateTable entries={gates} empty={andOrEmpty} />
            </section>

            <section aria-label="NAND-only gate list" className="flex flex-col gap-1.5">
              <h3 className={HDR}>Alternative — NAND-only (7400 stock)</h3>
              <GateTable entries={nandGates} empty={nandEmpty} />
            </section>
          </CardContent>
        </Card>
      </div>

      {/* Decoder preview — live 7-segment view over the same store cells */}
      <DecoderPreviewCard
        cells={allCells}
        vars={vars}
        names={names}
        hoverCode={hoverCode}
        selectedCode={selectedCode}
        onSelect={setSelectedCode}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels((v) => !v)}
      />

      {/* Truth table — datasheet view over the same store cells as the map */}
      <TruthTablePanel
        cells={allCells}
        segment={segment}
        vars={vars}
        names={names}
        e1Dirty={e1DirtyMap[segment]}
        hoverCode={hoverCode}
        onHover={setHoverCode}
        onEdit={cycleCell}
        onSwitchSegment={setSegmentStore}
      />

      {/* Inventory check */}
      <Card className="border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className={HDR}>Inventory check</CardTitle>
          <CardDescription>
            Usable stock = base match in LS · HC · HCT · CD4000, condition new or used
            (suspect/dead excluded)
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadInventory()}
              disabled={invLoading}
              className="cursor-pointer"
            >
              <RefreshCw className={invLoading ? 'animate-spin' : undefined} aria-hidden="true" />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {invError ? (
            <p role="alert" className="text-sm text-red-600">
              {invError}
            </p>
          ) : inv === null ? (
            <p className="flex items-center gap-2 text-sm text-stone-400">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              Loading inventory…
            </p>
          ) : (
            <>
              <StockList
                title="AND-OR build"
                entries={gates}
                inv={inv}
                empty={andOrEmpty}
              />
              <StockList
                title="NAND-only build"
                entries={nandGates}
                inv={inv}
                empty={nandEmpty}
              />
            </>
          )}
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-stone-600">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              Nice alternative: a{' '}
              <span className="font-mono font-semibold text-amber-800">4511</span> BCD-to-7-segment
              latch/decoder drives all seven segments from one chip — handy as a bench cross-check
              for your discrete gate network.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Sanity check */}
      <Card className="border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className={HDR}>Sanity check — classic minimizations</CardTitle>
          <CardDescription>Plan §4.6, verified against digits 0–9</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-stone-600">
          <ul className="grid gap-1 font-mono text-[13px] text-stone-800 sm:grid-cols-2">
            {CLASSIC_SOP.map(({ seg, expr }) => (
              <li
                key={seg}
                className={
                  seg === segment
                    ? 'rounded bg-amber-50 px-2 py-1 text-amber-900 ring-1 ring-amber-200'
                    : 'px-2 py-1'
                }
              >
                {seg} = {expr}
              </li>
            ))}
          </ul>
          <p className="text-stone-500">
            The minimizer may group don&apos;t-cares differently and produce an equivalent-cost
            expression — compare literal counts, not exact groupings.
          </p>
          {namesCustomized && (
            <p className="text-xs text-stone-400">Classics are shown in the canonical W X Y Z naming.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
