'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HoleRef } from '@/lib/logibench/types';
import { useEditor } from '@/store/projectStore';
import { useDnd } from '@/store/dnd';
import BreadboardCanvas from './BreadboardCanvas';
import Palette from './Palette';
import Inspector from './Inspector';
import BottomPanel from './BottomPanel';
import ReferenceTab from './ReferenceTab';
import KMapTab from './KMapTab';
import InventoryTab from './InventoryTab';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Play, Pause, Undo2, Redo2, Save, FolderOpen, Download, Upload, Trash2, FlaskConical, Cpu } from 'lucide-react';

type Tab = 'bench' | 'reference' | 'kmap' | 'inventory';

/** Floating label that follows the pointer while a part is being dragged. */
function DragGhost() {
  const payload = useDnd((s) => s.payload);
  const x = useDnd((s) => s.x);
  const y = useDnd((s) => s.y);
  return (
    <>
      <span className="sr-only" aria-live="polite">{payload ? `Dragging ${payload.label}` : ''}</span>
      {payload && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md border border-stone-700 bg-stone-900/95 px-2 py-1 font-mono text-[10px] font-bold text-amber-300 shadow-lg"
          style={{ left: x + 14, top: y }}
        >
          {payload.label}
        </div>
      )}
    </>
  );
}

export default function AppShell() {
  const project = useEditor((s) => s.project);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const running = useEditor((s) => s.running);
  const setRunning = useEditor((s) => s.setRunning);
  const simResult = useEditor((s) => s.simResult);
  const selection = useEditor((s) => s.selection);
  const placement = useEditor((s) => s.placement);
  const wireStart = useEditor((s) => s.wireStart);
  const liveSwitches = useEditor((s) => s.liveSwitches);

  const [tab, setTab] = useState<Tab>('bench');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [saveMsg, setSaveMsg] = useState('');
  const flash = useEditor((s) => s.flash);

  /* ---- transient flash message (rejected drops etc.) ---- */
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => useEditor.getState().setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  /* ---- simulation loop ---- */
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => useEditor.getState().stepSim(90), 90);
    return () => clearInterval(iv);
  }, [running]);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') useEditor.getState().cancelPlacement();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (useEditor.getState().selection) {
          e.preventDefault();
          useEditor.getState().deleteSelection();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); useEditor.getState().undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'Z' && e.shiftKey))) { e.preventDefault(); useEditor.getState().redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- hole interaction controller ---- */
  const onHoleClick = useCallback((hole: HoleRef) => {
    const st = useEditor.getState();
    if (st.placement) { st.placeAt(hole); return; }
    if (st.wireStart || st.mode === 'wire') { st.startWireAt(hole); return; }
    // select whatever occupies the hole
    const occ = st.project.parts.find((p) => p.pins.some((h) => h.board === hole.board && h.col === hole.col && h.row === hole.row));
    if (occ) st.select({ kind: 'part', id: occ.id });
    else st.select(null);
  }, []);

  const onSave = async () => {
    setSaveMsg('Saving…');
    try {
      const st = useEditor.getState();
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: st.projectId, name: project.name, data: project }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();
      st.setSavedId(saved.id);
      setSaveMsg(`Saved ✓ ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setSaveMsg(`Save failed: ${String(e).slice(0, 80)}`);
    }
    setTimeout(() => setSaveMsg(''), 4000);
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'logibench'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(String(reader.result));
        if (p && (p.schema === 1 || p.schema === 2) && Array.isArray(p.parts)) {
          // loadProject runs migrateProject(): v1 → v2 + full sanitization
          useEditor.getState().loadProject(p);
        } else {
          alert('Not a valid LogicBench project file.');
        }
      } catch {
        alert('Could not parse that file.');
      }
    };
    reader.readAsText(file);
  };

  const onExportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'breadboard.svg';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const errCount = simResult?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnCount = simResult?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-stone-100">
      <DragGhost />
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-900">
              <Cpu className="h-4 w-4 text-amber-400" />
            </span>
            <span className="text-sm font-black tracking-tight text-stone-900">LogicBench<span className="text-amber-600">PH</span></span>
          </div>
          <Input
            value={project.name}
            onChange={(e) => useEditor.getState().setName(e.target.value)}
            className="h-8 w-48 text-xs sm:w-64"
            aria-label="Project name"
          />
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={() => useEditor.getState().undo()} aria-label="Undo">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={() => useEditor.getState().redo()} aria-label="Redo">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden text-[10px] font-medium uppercase tracking-wider text-stone-400 sm:inline">Demos:</span>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={() => useEditor.getState().loadDemo(1)} title="Switches → 7447 → common-anode display">
              <FlaskConical className="h-3.5 w-3.5 text-amber-600" /> Lab 1
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={() => useEditor.getState().loadDemo(2)} title="555 → 7490 → 4511 → common-cathode counter">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-600" /> Lab 2
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={() => useEditor.getState().clearAll()} aria-label="Clear board">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {saveMsg && <span className="mr-1 text-[10px] text-stone-500">{saveMsg}</span>}
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={onSave}><Save className="h-3.5 w-3.5" /> Save</Button>
            <label className="cursor-pointer">
              <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" asChild>
                <span><FolderOpen className="h-3.5 w-3.5" /> Import</span>
              </Button>
              <input
                ref={fileRef} type="file" accept="application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }}
              />
            </label>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={onExport}><Download className="h-3.5 w-3.5" /> JSON</Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={onExportSvg} disabled={tab !== 'bench'}>SVG</Button>
            <Button
              size="sm"
              className={`h-8 gap-1 px-3 text-[11px] font-semibold ${running ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-600 hover:bg-amber-700'}`}
              onClick={() => setRunning(!running)}
            >
              {running ? <><Pause className="h-3.5 w-3.5" /> Running</> : <><Play className="h-3.5 w-3.5" /> Simulate</>}
            </Button>
          </div>
        </div>
        {/* tabs */}
        <nav className="mx-auto flex max-w-[1600px] gap-1 px-3" aria-label="Sections">
          {([
            ['bench', 'Bench'],
            ['reference', 'Chip reference'],
            ['kmap', 'K-map lab'],
            ['inventory', 'Inventory'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`border-b-2 px-3 py-1.5 text-xs font-medium transition ${tab === id ? 'border-amber-600 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
            >
              {label}
            </button>
          ))}
          {(errCount > 0 || warnCount > 0) && tab !== 'bench' && (
            <span className={`ml-2 self-center rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${errCount ? 'bg-red-600' : 'bg-amber-500'}`}>
              {errCount} err · {warnCount} warn
            </span>
          )}
        </nav>
      </header>

      {/* main */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-3">
        {tab === 'bench' && (
          <div className="grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)_260px]">
            <aside className="rounded-xl border border-stone-200 bg-white lg:h-[560px] lg:overflow-hidden" aria-label="Parts palette">
              <Palette />
            </aside>
            <section className="flex min-w-0 flex-col gap-3" aria-label="Breadboard">
              <div className="relative h-[420px] lg:h-[440px]">
                <BreadboardCanvas
                  project={project}
                  simResult={simResult}
                  selection={selection}
                  placement={placement}
                  wireStart={wireStart}
                  running={running}
                  liveSwitches={liveSwitches}
                  svgRef={svgRef}
                  onHoleClick={onHoleClick}
                  onHoleHover={() => {}}
                  onPartClick={(id) => useEditor.getState().select({ kind: 'part', id })}
                  onWireClick={(id) => useEditor.getState().select({ kind: 'wire', id })}
                  onBackground={() => useEditor.getState().select(null)}
                  onSwitchToggle={(id) => useEditor.getState().toggleSwitch(id)}
                  onButtonPress={(id, closed) => useEditor.getState().pressButton(id, closed)}
                />
                {flash && (
                  <div role="status" className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-stone-900/90 px-3 py-1.5 text-[11px] font-medium text-amber-200 shadow-lg">
                    {flash}
                  </div>
                )}
              </div>
              <div className="h-[240px]">
                <BottomPanel />
              </div>
              {project.notes && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
                  {project.notes}
                </p>
              )}
            </section>
            <aside className="rounded-xl border border-stone-200 bg-white lg:h-[560px] lg:overflow-hidden" aria-label="Inspector">
              <Inspector />
            </aside>
          </div>
        )}
        {tab === 'reference' && <ReferenceTab />}
        {tab === 'kmap' && <KMapTab />}
        {tab === 'inventory' && <InventoryTab />}
      </main>

      {/* sticky footer */}
      <footer className="mt-auto border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-3 py-2 text-[11px] text-stone-500">
          <span>
            LogicBench PH — plan your 74LS/74HC breadboard before you power it. Engine + ERC run entirely in your browser.
          </span>
          <span className="flex items-center gap-3">
            <span>Mode: <b className="text-stone-700">{mode}{placement ? ' · placing' : wireStart ? ' · wiring' : ''}</b></span>
            <a href="https://github.com/mlger/logibench" target="_blank" rel="noreferrer" className="font-medium text-amber-700 hover:underline">GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
