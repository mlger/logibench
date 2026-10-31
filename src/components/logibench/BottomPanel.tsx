'use client';

import { useMemo, useState } from 'react';
import { useEditor } from '@/store/projectStore';
import { computeBom } from '@/lib/logibench/bom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertOctagon, AlertTriangle, Info, ListChecks, Package } from 'lucide-react';

const SEV_STYLE: Record<string, { icon: typeof Info; cls: string }> = {
  error: { icon: AlertOctagon, cls: 'text-red-600 bg-red-50 border-red-200' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  info: { icon: Info, cls: 'text-stone-500 bg-stone-50 border-stone-200' },
};

type BottomTab = 'erc' | 'bom' | 'wiring';

export default function BottomPanel() {
  const [tab, setTab] = useState<BottomTab>('erc');
  const simResult = useEditor((s) => s.simResult);
  const project = useEditor((s) => s.project);
  const select = useEditor((s) => s.select);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const issues = simResult?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;

  const bom = useMemo(() => computeBom(project), [project]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex items-center gap-1 border-b border-stone-200 px-2 pt-1.5">
        <button
          type="button"
          onClick={() => setTab('erc')}
          className={`flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium ${tab === 'erc' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <ListChecks className="h-3.5 w-3.5" /> Electrical check
          {errors > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{errors}</span>}
          {warnings > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{warnings}</span>}
          {errors + warnings === 0 && infos > 0 && <span className="rounded-full bg-stone-300 px-1.5 text-[10px] font-bold text-stone-700">{infos}</span>}
          {errors + warnings + infos === 0 && simResult && <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">✓</span>}
        </button>
        <button
          type="button"
          onClick={() => setTab('bom')}
          className={`flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium ${tab === 'bom' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <Package className="h-3.5 w-3.5" /> BOM ({bom.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('wiring')}
          className={`flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium ${tab === 'wiring' ? 'bg-stone-100 text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
        >
          Wiring list ({project.wires.length})
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'erc' && (
          <div className="space-y-2 p-3">
            {!simResult && <p className="text-xs text-stone-500">Open the Bench and place parts — the ERC runs live as you edit.</p>}
            {simResult && issues.length === 0 && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
                No electrical problems found. Clean board!
              </p>
            )}
            {issues.map((iss) => {
              const style = SEV_STYLE[iss.severity];
              const Icon = style.icon;
              return (
                <button
                  key={iss.id}
                  type="button"
                  onClick={() => {
                    const ref = iss.refs.find((r) => r.partId);
                    if (ref) select({ kind: 'part', id: ref.partId! });
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition hover:shadow-sm ${style.cls}`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold">{iss.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug opacity-90">{iss.detail}</span>
                    {iss.why && (
                      <span className="mt-1 block border-l-2 border-current/30 pl-2 text-[10px] italic leading-snug opacity-75">
                        Why: {iss.why}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'bom' && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-[10px] uppercase">Part</TableHead>
                <TableHead className="h-8 text-[10px] uppercase">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bom.length === 0 && (
                <TableRow><TableCell colSpan={2} className="text-xs text-stone-500">Nothing placed yet.</TableCell></TableRow>
              )}
              {bom.map((line) => (
                <TableRow key={line.key}>
                  <TableCell className="py-1.5 text-xs">{line.label}</TableCell>
                  <TableCell className="py-1.5 font-mono text-xs">×{line.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === 'wiring' && (
          <div className="space-y-1 p-3">
            {project.wires.length === 0 && <p className="text-xs text-stone-400">No wires yet. Tick these off at the bench.</p>}
            {project.wires.map((w, i) => {
              const key = w.id;
              return (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={!!checked[key]}
                    onChange={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                    className="h-3.5 w-3.5 accent-amber-600"
                  />
                  <span className="h-3 w-3 shrink-0 rounded-full border border-stone-300" style={{ backgroundColor: w.color }} />
                  <span className="font-mono text-[11px] text-stone-700">
                    Wire {i + 1}: ({w.from.col},{w.from.row}) → ({w.to.col},{w.to.row})
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
