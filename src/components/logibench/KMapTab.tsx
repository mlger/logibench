'use client';

/**
 * LogicBench PH — Decoder Design Lab (plan §3.3).
 *
 * BCD truth table → interactive per-segment K-map → minimized SOP → gate
 * list (AND–OR and NAND-only) → parts-inventory check. K-map cells cycle
 * 0 → 1 → X on click; the classic per-segment truth values (don't-cares on
 * codes 10–15) come from CLASSIC_SEGMENT_EQUATIONS (plan §4.6).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Lightbulb, Minus, RefreshCw, RotateCcw, X } from 'lucide-react';
import {
  KMAP_COLS,
  KMAP_ROWS,
  minimize,
  sopToGates,
  sopToNandGates,
  type GateListEntry,
} from '@/lib/logibench/kmap';
import { CLASSIC_SEGMENT_EQUATIONS } from '@/data/chips';
import type { Family, InventoryItem, KMapSpec } from '@/lib/logibench/types';
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

type SegKey = KMapSpec['segment'];
type CellVal = 0 | 1 | 'X';

const SEGS: SegKey[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

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

function classicSpecs(): Record<SegKey, KMapSpec> {
  const out = {} as Record<SegKey, KMapSpec>;
  for (const seg of SEGS) {
    out[seg] = { segment: seg, cells: [...CLASSIC_SEGMENT_EQUATIONS[seg]] };
  }
  return out;
}

/** Click cycle: 0 → 1 → X → 0. */
const cycle = (v: CellVal): CellVal => (v === 0 ? 1 : v === 1 ? 'X' : 0);

/** 0..3 → "00".."11" for K-map row/column labels. */
const bits2 = (v: number): string => v.toString(2).padStart(2, '0');

/** Usable stock for one chip: matching base, buildable family, not dead. */
function stockFor(items: InventoryItem[], chip: string): number {
  return items
    .filter(
      (it) =>
        it.base === chip && USABLE_FAMILIES.includes(it.family) && it.condition !== 'dead',
    )
    .reduce((sum, it) => sum + it.qty, 0);
}

function cellClasses(v: CellVal, isEdited: boolean): string {
  const base =
    'relative flex size-16 cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600';
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

export default function KMapTab() {
  const [segment, setSegment] = useState<SegKey>('a');
  const [specs, setSpecs] = useState<Record<SegKey, KMapSpec>>(classicSpecs);

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

  const cells = specs[segment].cells;
  const terms = useMemo(() => minimize(cells), [cells]);
  const gates = useMemo(() => sopToGates(terms), [terms]);
  const nandGates = useMemo(() => sopToNandGates(terms), [terms]);
  const edited = useMemo(
    () => cells.map((v, i) => v !== CLASSIC_SEGMENT_EQUATIONS[segment][i]),
    [cells, segment],
  );
  const isClassic = edited.every((e) => !e);

  const isAlwaysOn = terms.some((t) => t.sop === '1');
  const sopText =
    terms.length === 0
      ? '0 (segment always off)'
      : isAlwaysOn
        ? '1 (wire to VCC)'
        : terms.map((t) => t.sop).join(' + ');

  const andOrEmpty =
    terms.length === 0
      ? 'No gates — tie the segment output LOW.'
      : isAlwaysOn
        ? 'No gates — wire the segment output to VCC.'
        : 'No gates needed.';
  const nandEmpty =
    terms.length === 0
      ? 'Nothing to build — the segment is always off.'
      : isAlwaysOn
        ? 'Nothing to build — wire to VCC.'
        : 'No NAND gates needed.';

  /* needed chips = SOP gate list + NAND-only list, summed per chip id */
  const neededRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of [...gates, ...nandGates]) {
      map.set(g.chip, (map.get(g.chip) ?? 0) + g.qty);
    }
    return [...map.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([chip, qty]) => ({ chip, qty, have: inv ? stockFor(inv, chip) : 0 }));
  }, [gates, nandGates, inv]);

  /* ---------- handlers ---------- */

  const handleCellClick = (code: number) => {
    setSpecs((prev) => {
      const cur = prev[segment];
      return {
        ...prev,
        [segment]: {
          ...cur,
          cells: cur.cells.map((v, i) => (i === code ? cycle(v) : v)),
        },
      };
    });
  };

  const resetSegment = () => {
    setSpecs((prev) => ({
      ...prev,
      [segment]: { segment, cells: [...CLASSIC_SEGMENT_EQUATIONS[segment]] },
    }));
  };

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-4">
      {/* Header row: segment selector + reset + explainer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                onClick={() => setSegment(s)}
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
      </div>
      <p className="text-sm text-stone-500">
        Active-HIGH (common-cathode) segment outputs. Click any K-map cell to cycle{' '}
        <span className="font-mono font-medium text-stone-700">0 → 1 → X</span> (don&apos;t-care).
        Codes 10–15 default to X.
      </p>

      {/* K-map + minimized result side by side on desktop */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="border-stone-200 bg-white">
          <CardHeader>
            <CardTitle className={HDR}>Karnaugh map — segment {segment}</CardTitle>
            <CardDescription>Rows = W X · Columns = Y Z · Gray order</CardDescription>
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
            </div>
            <div className="overflow-x-auto pb-1">
              <div
                role="group"
                aria-label={`Karnaugh map for segment ${segment}, 16 minterms`}
                className="grid min-w-[21rem] grid-cols-[2.5rem_repeat(4,4rem)] gap-1.5"
              >
                {/* corner label */}
                <div className="flex items-center justify-center rounded-md bg-stone-50 font-mono text-[10px] leading-tight text-stone-400">
                  <span>WX</span>
                  <span className="mx-0.5 text-stone-300">\</span>
                  <span>YZ</span>
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
                {/* rows (W X) with cells */}
                {KMAP_ROWS.map((wx) => (
                  <div key={`row-${wx}`} className="col-span-5 grid grid-cols-subgrid">
                    <div className="flex items-center justify-center rounded-md bg-stone-50 font-mono text-xs font-medium text-stone-500">
                      {bits2(wx)}
                    </div>
                    {KMAP_COLS.map((yz) => {
                      const code = wx * 4 + yz;
                      const v = cells[code];
                      return (
                        <button
                          key={`cell-${code}`}
                          type="button"
                          onClick={() => handleCellClick(code)}
                          aria-label={`minterm m${code}, WX=${bits2(wx)}, YZ=${bits2(yz)}, value ${v}. Click to cycle 0, 1, X.`}
                          className={cellClasses(v, edited[code])}
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
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 bg-white">
          <CardHeader>
            <CardTitle className={HDR}>Minimized SOP — live</CardTitle>
            <CardDescription>Quine–McCluskey cover, recomputed on every edit</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              aria-live="polite"
              className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3"
            >
              <p className="break-words font-mono text-lg leading-relaxed text-stone-900">
                {sopText}
              </p>
            </div>

            <section aria-label="Implicant terms" className="flex flex-col gap-1.5">
              <h3 className={HDR}>Term chips</h3>
              {terms.length === 0 ? (
                <span className="text-sm text-stone-400">— no implicants</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {terms.map((t, i) => (
                    <Badge
                      key={`term-${i}`}
                      variant="outline"
                      className="border-amber-200 bg-amber-50 font-mono text-amber-700"
                    >
                      {t.sop}
                    </Badge>
                  ))}
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

      {/* Inventory check */}
      <Card className="border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className={HDR}>Inventory check</CardTitle>
          <CardDescription>
            Usable stock = base match in LS · HC · HCT · CD4000, condition not dead
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
        <CardContent className="flex flex-col gap-3">
          {invError ? (
            <p role="alert" className="text-sm text-red-600">
              {invError}
            </p>
          ) : inv === null ? (
            <p className="flex items-center gap-2 text-sm text-stone-400">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
              Loading inventory…
            </p>
          ) : neededRows.length === 0 ? (
            <p className="text-sm text-stone-400">
              Nothing to stock — this segment needs no gates.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {neededRows.map(({ chip, qty, have }) => {
                const status =
                  have === 0
                    ? {
                        label: 'not in inventory',
                        cls: 'border-stone-200 bg-stone-100 text-stone-500',
                        Icon: Minus,
                      }
                    : have >= qty
                      ? {
                          label: 'OK',
                          cls: 'border-emerald-200 bg-emerald-50 text-emerald-600',
                          Icon: Check,
                        }
                      : {
                          label: `short by ${qty - have}`,
                          cls: 'border-red-200 bg-red-50 text-red-600',
                          Icon: X,
                        };
                return (
                  <div
                    key={chip}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-stone-800">{chip}</span>
                      <span className="text-xs text-stone-500">
                        need {qty} · have {have}
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
            The greedy minimizer may group don&apos;t-cares differently and produce an
            equivalent-cost expression — compare literal counts, not exact groupings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
