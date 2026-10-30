'use client';

import { useEditor } from '@/store/projectStore';
import { CHIP_DEFS, getChipDef } from '@/data/chips';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { WIRE_COLORS } from '@/lib/logibench/demo';
import { Cpu, Grid3x3, Lightbulb, ToggleLeft, Circle, Power, Timer, Unplug, MousePointerClick, Spline } from 'lucide-react';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

export default function Palette() {
  const startPlacement = useEditor((s) => s.startPlacement);
  const placement = useEditor((s) => s.placement);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const wireColor = useEditor((s) => s.wireColor);
  const setWireColor = useEditor((s) => s.setWireColor);
  const project = useEditor((s) => s.project);

  const simChips = CHIP_DEFS.filter((c) => !c.refOnly);
  const refChips = CHIP_DEFS.filter((c) => c.refOnly);

  const active = (t: string) => placement?.type === t || (placement?.type === 'chip' && placement.defId === t);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* tools */}
      <section>
        <h3 className={SECTION}>Tools</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => setMode('select')}
            className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition ${mode === 'select' && !placement ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
          >
            <MousePointerClick className="h-4 w-4" /> Select
          </button>
          <button
            type="button"
            onClick={() => { setMode('wire'); }}
            className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition ${mode === 'wire' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
          >
            <Spline className="h-4 w-4" /> Wire
          </button>
          <button
            type="button"
            onClick={() => setMode('simulate')}
            className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition ${mode === 'simulate' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
          >
            <Power className="h-4 w-4" /> Interact
          </button>
        </div>
        {mode === 'wire' && (
          <div className="mt-2 rounded-lg border border-stone-200 bg-white p-2">
            <div className="text-[10px] font-medium text-stone-500">Wire color — click a hole, then another</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(WIRE_COLORS).map(([name, hex]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={`wire color ${name}`}
                  onClick={() => setWireColor(hex)}
                  className={`h-5 w-5 rounded-full border-2 ${wireColor === hex ? 'border-stone-900' : 'border-transparent'}`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* chips */}
      <section>
        <h3 className={SECTION}>Chips — click, then click a column</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {simChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => startPlacement('chip', c.id)}
              className={`flex flex-col items-start rounded-lg border px-2 py-1.5 text-left transition ${active(c.id) ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}
            >
              <span className="flex items-center gap-1 font-mono text-xs font-bold text-stone-800">
                <Cpu className="h-3 w-3 text-stone-400" />{c.id}
              </span>
              <span className="truncate text-[9px] text-stone-500" title={c.name}>{c.name.split('—')[0].split('(')[0].trim()}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {refChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => startPlacement('chip', c.id)}
              title={`${c.name} — reference only (no simulation yet)`}
              className="flex items-center gap-1 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-2 py-1 font-mono text-[10px] text-stone-500 hover:bg-stone-100"
            >
              {c.id} <span className="text-[8px] uppercase">ref</span>
            </button>
          ))}
        </div>
      </section>

      {/* displays */}
      <section>
        <h3 className={SECTION}>Displays</h3>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => startPlacement('seg7', undefined, { polarity: 'CA', color: 'red' })}
            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] ${active('seg7') ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}
          >
            <span className="font-mono font-semibold">5161BS</span>
            <span className="block text-[9px] text-stone-500">Common ANODE</span>
          </button>
          <button
            type="button"
            onClick={() => startPlacement('seg7', undefined, { polarity: 'CC', color: 'red' })}
            className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-stone-50"
          >
            <span className="font-mono font-semibold">5161AS</span>
            <span className="block text-[9px] text-stone-500">Common CATHODE</span>
          </button>
        </div>
      </section>

      {/* passives & io */}
      <section>
        <h3 className={SECTION}>Discrete parts — click two holes</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 330 })} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <span className="block h-2.5 w-6 rounded-full bg-[#d6bfa2]" />330Ω
          </button>
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 1000 })} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <span className="block h-2.5 w-6 rounded-full bg-[#c9a97f]" />1kΩ
          </button>
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 10000 })} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <span className="block h-2.5 w-6 rounded-full bg-[#b98d5f]" />10kΩ
          </button>
          <button type="button" onClick={() => startPlacement('led')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <Lightbulb className="h-4 w-4 text-red-500" />LED
          </button>
          <button type="button" onClick={() => startPlacement('cap')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <Circle className="h-4 w-4 text-amber-700" />0.1µF
          </button>
          <button type="button" onClick={() => startPlacement('switch')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <ToggleLeft className="h-4 w-4 text-stone-500" />Switch
          </button>
          <button type="button" onClick={() => startPlacement('button')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <Grid3x3 className="h-4 w-4 text-stone-500" />Button
          </button>
          <button type="button" onClick={() => startPlacement('supply')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <Power className="h-4 w-4 text-red-600" />5V supply
          </button>
          <button type="button" onClick={() => startPlacement('clock555')} className="flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50">
            <Timer className="h-4 w-4 text-amber-600" />555 clock
          </button>
        </div>
      </section>

      {/* board options */}
      <section className="pb-4">
        <h3 className={SECTION}>Board</h3>
        <div className="mt-2 space-y-1.5">
          <button
            type="button"
            onClick={() => useEditor.getState().setBoardKind(project.boards[0].kind === 'half400' ? 'full830' : 'half400')}
            className="w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] text-stone-700 hover:bg-stone-50"
          >
            Board: <span className="font-medium">{project.boards[0].kind === 'half400' ? 'Half-size (400 pt)' : 'Full-size (830 pt)'}</span> — switch
          </button>
          <button
            type="button"
            onClick={() => useEditor.getState().toggleRailsSplit()}
            className={`w-full rounded-lg border px-2 py-1.5 text-left text-[11px] ${project.boards[0].railsSplit ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-700'} hover:bg-stone-50`}
          >
            Rails split in middle: <span className="font-medium">{project.boards[0].railsSplit ? 'YES (classic trap!)' : 'no'}</span>
          </button>
          <p className="flex items-start gap-1 text-[10px] leading-snug text-stone-400">
            <Unplug className="mt-0.5 h-3 w-3 shrink-0" />
            ESC cancels placement · Delete removes selection · hover any hole to light up its whole net
          </p>
        </div>
      </section>
    </div>
  );
}

export function selectedChipInfo(defId?: string) {
  return defId ? getChipDef(defId) : undefined;
}

export { ScrollArea, ScrollBar };
