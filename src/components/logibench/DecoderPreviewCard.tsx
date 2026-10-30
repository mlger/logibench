'use client';

/**
 * LogicBench PH — decoder preview card (docs/kmap-lab-presets-vars-preview-plan.md §6.2).
 *
 * A slim card between the SOP grid and the truth table: a live seven-segment
 * display plus a chip grid of input codes. The display shows
 * `hoverCode ?? selectedCode` — pointing at any K-map cell or truth-table row
 * (hoverCode flows from KMapTab) previews that input instantly, and leaving
 * falls back to the chip selection. A pure view over the store cells: in
 * 5-variable mode an unedited E = 1 plane shows the mirror, exactly like the
 * map and the truth table.
 */

import { Type } from 'lucide-react';
import type { KMapCell } from '@/lib/logibench/types';
import { KMAP_SEGS, type SegKey } from '@/store/kmapStore';
import SevenSegDisplay from '@/components/logibench/SevenSegDisplay';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const HDR = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

export interface DecoderPreviewCardProps {
  /** all seven segments' 32-cell store arrays (E = 0 plane, then E = 1) */
  cells: Record<SegKey, KMapCell[]>;
  vars: 4 | 5;
  /** effective variable names (length = vars) — labels the 5-var chip groups */
  names: readonly string[];
  hoverCode: number | null;
  selectedCode: number;
  onSelect: (code: number) => void;
  showLabels: boolean;
  onToggleLabels: () => void;
}

export default function DecoderPreviewCard({
  cells,
  vars,
  names,
  hoverCode,
  selectedCode,
  onSelect,
  showLabels,
  onToggleLabels,
}: DecoderPreviewCardProps) {
  const raw = hoverCode ?? selectedCode;
  const shown = vars === 4 && raw > 15 ? 0 : raw; // defensive: KMapTab clamps too
  const states = {} as Record<SegKey, KMapCell>;
  for (const seg of KMAP_SEGS) states[seg] = cells[seg][shown];

  const groups: { base: number }[] = vars === 5 ? [{ base: 0 }, { base: 16 }] : [{ base: 0 }];

  return (
    <Card className="border-stone-200 bg-white">
      <CardHeader>
        <CardTitle className={HDR}>Decoder preview — what each input lights</CardTitle>
        <CardDescription>
          Live view of the stored cells: pick a code below, or just hover any K-map cell or
          truth-table row to preview that input.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={showLabels}
            onClick={onToggleLabels}
            className="cursor-pointer"
          >
            <Type aria-hidden="true" />
            a–g labels
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <SevenSegDisplay states={states} showLabels={showLabels} />
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-stone-500">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-amber-500" aria-hidden="true" /> lit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-stone-200" aria-hidden="true" /> off
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm border border-dashed border-amber-600 bg-amber-300/40"
                  aria-hidden="true"
                />{' '}
                don&apos;t-care
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <p className="sr-only">
              Input code picker. The display shows the selected code, or the code under the pointer
              or keyboard focus on the map or truth table.
            </p>
            {groups.map((g, gi) => (
              <div key={g.base}>
                {vars === 5 && (
                  <p className="mb-1.5 font-mono text-xs font-semibold text-stone-600">
                    {names[0]} = {gi}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 16 }, (_, i) => {
                    const code = g.base + i;
                    const selected = code === selectedCode;
                    const hovered = hoverCode === code;
                    const digit = code <= 9 ? String(code) : null;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => onSelect(code)}
                        aria-pressed={selected}
                        aria-label={`Preview input m${code} — binary ${code
                          .toString(2)
                          .padStart(vars, '0')}${digit ? `, digit ${code}` : ''}`}
                        className={`flex h-11 w-11 cursor-pointer flex-col items-center justify-center rounded-md border font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                          selected
                            ? 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700'
                            : 'border-stone-200 bg-white text-stone-600 hover:border-amber-500 hover:text-amber-700'
                        }${hovered && !selected ? ' outline-2 outline-amber-500' : ''}`}
                      >
                        <span className="text-[11px] leading-none opacity-70">m{code}</span>
                        {digit && <span className="text-sm font-bold leading-tight">{digit}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
