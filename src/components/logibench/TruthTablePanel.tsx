'use client';

/**
 * LogicBench PH — Truth table panel for the decoder design lab (plan §3.3,
 * design doc docs/kmap-truth-table-plan.md).
 *
 * A datasheet-style, fully editable BCD → 7-segment truth table rendered from
 * the same useKmapStore cells the K-map uses — the panel is a pure view plus
 * a second editing surface. Clicking an output cell cycles 0 → 1 → X via the
 * store's cycleCell, so map, table, SOP and gate lists always agree. Rows
 * show the binary input code (MSB first, the raw minterm index) and the digit
 * glyph the classic values light; hovering or focusing a row highlights the
 * matching K-map cell and vice versa (hoverCode lives in KMapTab — ephemeral,
 * never persisted). Clicking a segment letter switches the active segment.
 *
 * 4-variable mode renders one table (m0…m15); 5-variable mode stacks two
 * (E = 0, E = 1) mirroring the map's two planes, with the "mirrors E = 0"
 * hint until the plane is first edited.
 */

import type { KeyboardEvent } from 'react';
import { CLASSIC_SEGMENT_EQUATIONS, DIGIT_GLYPHS } from '@/data/chips';
import { mintermInputs, VARS_BY_COUNT } from '@/lib/logibench/kmap';
import type { KMapCell } from '@/lib/logibench/types';
import { KMAP_SEGS, type SegKey } from '@/store/kmapStore';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const SEGS: SegKey[] = KMAP_SEGS;

/** Section-header token: small, uppercase, tracked out (matches KMapTab). */
const HDR = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

/** Thin scrollbar styling (same recipe as InventoryTab). */
const SCROLL =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent';

/** Value-driven cell styling — mirrors the K-map legend (1 amber, X dashed, 0 plain). */
function outCellClasses(v: KMapCell): string {
  return v === 1
    ? 'border-amber-600 bg-amber-100 text-amber-900 hover:border-amber-700'
    : v === 'X'
      ? 'border-dashed border-stone-400 bg-stone-100 text-stone-500 hover:border-stone-500'
      : 'border-stone-200 bg-white text-stone-400 hover:border-stone-400';
}

interface PlaneTableProps {
  /** plane index: 0 in 4-var mode, 0 | 1 in 5-var mode */
  e: 0 | 1;
  /** all seven segments' 32-cell store arrays (E = 0 plane, then E = 1) */
  cells: Record<SegKey, KMapCell[]>;
  segment: SegKey;
  /** variable count — drives the input columns (W X Y Z, or E W X Y Z) */
  n: 4 | 5;
  hoverCode: number | null;
  onHover: (code: number | null) => void;
  onEdit: (seg: SegKey, code: number) => void;
  onSwitchSegment: (seg: SegKey) => void;
}

/**
 * One truth table over a plane's 16 minterms. The header row and the code
 * column stay visible while scrolling (sticky + border-separate, because
 * border-collapse cannot keep borders under sticky cells).
 */
function PlaneTable({
  e,
  cells,
  segment,
  n,
  hoverCode,
  onHover,
  onEdit,
  onSwitchSegment,
}: PlaneTableProps) {
  const vars = VARS_BY_COUNT[n];
  const base = e * 16;
  const rows = Array.from({ length: 16 }, (_, i) => base + i);

  /** Arrow keys walk the output-cell grid: Up/Down rows, Left/Right segments. */
  function onTableKeyDown(ev: KeyboardEvent<HTMLTableElement>) {
    const btn = (ev.target as HTMLElement).closest('button[data-tt-r]');
    if (!btn) return;
    const r = Number(btn.getAttribute('data-tt-r'));
    const c = Number(btn.getAttribute('data-tt-c'));
    let nr = r;
    let nc = c;
    if (ev.key === 'ArrowUp') nr = r - 1;
    else if (ev.key === 'ArrowDown') nr = r + 1;
    else if (ev.key === 'ArrowLeft') nc = c - 1;
    else if (ev.key === 'ArrowRight') nc = c + 1;
    else return;
    if (nr < 0 || nr > 15 || nc < 0 || nc > SEGS.length - 1) return;
    ev.preventDefault();
    document.getElementById(`tt-cell-${e}-${nr}-${nc}`)?.focus();
  }

  return (
    <div className={`${SCROLL} max-h-96 overflow-auto rounded-lg border border-stone-200`}>
      <table
        className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm"
        onKeyDown={onTableKeyDown}
        onFocus={(ev) => {
          const btn = (ev.target as HTMLElement).closest('button[data-tt-r]');
          if (!btn) return;
          const plane = Number(btn.getAttribute('data-tt-e') ?? '0');
          const r = Number(btn.getAttribute('data-tt-r'));
          onHover(plane * 16 + r);
        }}
        onBlur={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) onHover(null);
        }}
      >
        <caption className="sr-only">
          Truth table, plane {e}: minterm codes {base} to {base + 15}, binary inputs, the digit
          glyph each code lights, and the seven segment outputs. Click an output cell to cycle 0,
          1, X; click a segment letter to make it the active segment.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 w-14 border-b border-stone-200 bg-white px-3 py-2 text-left"
            >
              <span className={`${HDR} font-mono`}>code</span>
            </th>
            {vars.map((v) => (
              <th
                key={v}
                scope="col"
                className="sticky top-0 z-20 w-8 border-b border-stone-200 bg-white px-1 py-2 text-center"
              >
                <span className={`${HDR} font-mono`}>{v}</span>
              </th>
            ))}
            <th
              scope="col"
              className="sticky top-0 z-20 w-12 border-b border-l border-stone-200 bg-white px-2 py-2 text-center"
            >
              <span className={HDR}>digit</span>
            </th>
            {SEGS.map((seg) => {
              const active = seg === segment;
              return (
                <th
                  key={seg}
                  scope="col"
                  className="sticky top-0 z-20 w-12 border-b border-stone-200 bg-white p-1"
                >
                  <button
                    type="button"
                    onClick={() => onSwitchSegment(seg)}
                    aria-pressed={active}
                    aria-label={`Make segment ${seg} the active segment`}
                    className={`h-11 w-full cursor-pointer rounded font-mono text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                      active
                        ? 'bg-amber-600 text-white hover:bg-amber-700'
                        : 'text-stone-600 hover:bg-amber-50 hover:text-amber-700'
                    }`}
                  >
                    {seg}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((code, r) => {
            const hovered = hoverCode === code;
            const bits = mintermInputs(code, n);
            const glyph = e === 0 && code <= 9 ? DIGIT_GLYPHS[code] : null;
            return (
              <tr
                key={code}
                onMouseEnter={() => onHover(code)}
                onMouseLeave={() => onHover(null)}
                className={hovered ? 'bg-amber-50/70' : undefined}
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-10 border-b border-stone-100 px-3 py-1 text-left font-mono text-xs font-medium text-stone-500 transition-colors ${
                    hovered ? 'bg-amber-50' : 'bg-white'
                  }`}
                >
                  m{code}
                </th>
                {bits.map((b, i) => (
                  <td
                    key={`in-${i}`}
                    className="border-b border-stone-100 px-1 py-1 text-center font-mono text-stone-600"
                  >
                    {b}
                  </td>
                ))}
                <td className="border-b border-l border-stone-100 px-2 py-1 text-center font-mono text-sm font-semibold text-stone-700">
                  {glyph ?? '—'}
                </td>
                {SEGS.map((seg, c) => {
                  const v = cells[seg][code];
                  const isEdited = v !== CLASSIC_SEGMENT_EQUATIONS[seg][code % 16];
                  return (
                    <td key={seg} className="border-b border-stone-100 p-1">
                      <button
                        id={`tt-cell-${e}-${r}-${c}`}
                        type="button"
                        data-tt-r={r}
                        data-tt-c={c}
                        data-tt-e={e}
                        onClick={() => onEdit(seg, code)}
                        aria-label={`Segment ${seg}, minterm m${code}, value ${v}. Click to cycle 0, 1, X.`}
                        className={`relative flex h-11 w-full cursor-pointer items-center justify-center rounded border font-mono text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${outCellClasses(v)}${
                          isEdited ? ' ring-2 ring-amber-400/60' : ''
                        }`}
                      >
                        <span aria-hidden="true">{v}</span>
                        {isEdited && (
                          <span
                            aria-hidden="true"
                            className="absolute right-0.5 top-0.5 size-1 rounded-full bg-amber-500"
                          />
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface TruthTablePanelProps {
  /** all seven segments' 32-cell store arrays (E = 0 plane, then E = 1) */
  cells: Record<SegKey, KMapCell[]>;
  segment: SegKey;
  vars: 4 | 5;
  /** true once the active segment's E = 1 plane has been edited (5-var hint) */
  e1Dirty: boolean;
  /** minterm currently hovered/focused on the map or in this table (sync highlight) */
  hoverCode: number | null;
  onHover: (code: number | null) => void;
  onEdit: (seg: SegKey, code: number) => void;
  onSwitchSegment: (seg: SegKey) => void;
}

export default function TruthTablePanel({
  cells,
  segment,
  vars,
  e1Dirty,
  hoverCode,
  onHover,
  onEdit,
  onSwitchSegment,
}: TruthTablePanelProps) {
  return (
    <Card className="border-stone-200 bg-white">
      <CardHeader>
        <CardTitle className={HDR}>Truth table — inputs → segments</CardTitle>
        <CardDescription>
          Same cells as the map: click an output to cycle{' '}
          <span className="font-mono font-medium text-stone-700">0 → 1 → X</span>, hover a row to
          find it on the map. Click a segment letter to make it active.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {vars === 4 ? (
          <PlaneTable
            e={0}
            cells={cells}
            segment={segment}
            n={4}
            hoverCode={hoverCode}
            onHover={onHover}
            onEdit={onEdit}
            onSwitchSegment={onSwitchSegment}
          />
        ) : (
          <>
            <div>
              <p className="mb-1.5 font-mono text-xs font-semibold text-stone-600">E = 0</p>
              <PlaneTable
                e={0}
                cells={cells}
                segment={segment}
                n={5}
                hoverCode={hoverCode}
                onHover={onHover}
                onEdit={onEdit}
                onSwitchSegment={onSwitchSegment}
              />
            </div>
            <div>
              <p className="mb-1.5 font-mono text-xs font-semibold text-stone-600">
                E = 1
                {!e1Dirty && (
                  <span className="ml-2 font-sans font-normal text-stone-400">
                    mirrors E = 0 until you edit it
                  </span>
                )}
              </p>
              <PlaneTable
                e={1}
                cells={cells}
                segment={segment}
                n={5}
                hoverCode={hoverCode}
                onHover={onHover}
                onEdit={onEdit}
                onSwitchSegment={onSwitchSegment}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
