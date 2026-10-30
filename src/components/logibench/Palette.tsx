'use client';

import { useEditor } from '@/store/projectStore';
import { type DragInit } from '@/store/dnd';
import { beginDragTracking } from './drag';
import { CHIP_DEFS, getChipDef } from '@/data/chips';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { WIRE_COLORS } from '@/lib/logibench/demo';
import { Cpu, Grid3x3, Lightbulb, ToggleLeft, Circle, Power, Timer, MousePointerClick, Spline, GripHorizontal } from 'lucide-react';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

/** pointerdown handler that turns a palette press into a drag onto the board */
const paletteDrag =
  (payload: Omit<DragInit, 'kind'>) =>
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      beginDragTracking({ ...payload, kind: 'part' }, e);
    };

const GRAB = 'cursor-grab active:cursor-grabbing';
const NO_TOUCH_SCROLL = { touchAction: 'none' } as const;

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
            <div className="text-[10px] font-medium text-stone-500">Wire color — drag hole→hole, or click two holes</div>
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
        <h3 className={SECTION}>Chips — drag onto the board</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {simChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => startPlacement('chip', c.id)}
              onPointerDown={paletteDrag({ source: 'palette', type: 'chip', defId: c.id, label: c.id })}
              aria-label={`Place ${c.id} — drag onto the board or click then click a column`}
              className={`flex flex-col items-start rounded-lg border px-2 py-1.5 text-left transition ${active(c.id) ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white hover:bg-stone-50'} ${GRAB}`}
              style={NO_TOUCH_SCROLL}
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
              onPointerDown={paletteDrag({ source: 'palette', type: 'chip', defId: c.id, label: c.id })}
              title={`${c.name} — reference only (no simulation yet)`}
              className={`flex items-center gap-1 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-2 py-1 font-mono text-[10px] text-stone-500 hover:bg-stone-100 ${GRAB}`}
              style={NO_TOUCH_SCROLL}
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
            onPointerDown={paletteDrag({ source: 'palette', type: 'seg7', preset: { polarity: 'CA', color: 'red' }, label: '5161BS' })}
            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] ${active('seg7') ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white hover:bg-stone-50'} ${GRAB}`}
            style={NO_TOUCH_SCROLL}
          >
            <span className="font-mono font-semibold">5161BS</span>
            <span className="block text-[9px] text-stone-500">Common ANODE</span>
          </button>
          <button
            type="button"
            onClick={() => startPlacement('seg7', undefined, { polarity: 'CC', color: 'red' })}
            onPointerDown={paletteDrag({ source: 'palette', type: 'seg7', preset: { polarity: 'CC', color: 'red' }, label: '5161AS' })}
            className={`rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] hover:bg-stone-50 ${GRAB}`}
            style={NO_TOUCH_SCROLL}
          >
            <span className="font-mono font-semibold">5161AS</span>
            <span className="block text-[9px] text-stone-500">Common CATHODE</span>
          </button>
        </div>
      </section>

      {/* passives & io */}
      <section>
        <h3 className={SECTION}>Discrete parts — drop, then click 2nd hole</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 330 })} onPointerDown={paletteDrag({ source: 'palette', type: 'resistor', preset: { ohms: 330 }, label: '330 Ω' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <span className="block h-2.5 w-6 rounded-full bg-[#d6bfa2]" />330Ω
          </button>
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 1000 })} onPointerDown={paletteDrag({ source: 'palette', type: 'resistor', preset: { ohms: 1000 }, label: '1 kΩ' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <span className="block h-2.5 w-6 rounded-full bg-[#c9a97f]" />1kΩ
          </button>
          <button type="button" onClick={() => startPlacement('resistor', undefined, { ohms: 10000 })} onPointerDown={paletteDrag({ source: 'palette', type: 'resistor', preset: { ohms: 10000 }, label: '10 kΩ' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <span className="block h-2.5 w-6 rounded-full bg-[#b98d5f]" />10kΩ
          </button>
          <button type="button" onClick={() => startPlacement('led')} onPointerDown={paletteDrag({ source: 'palette', type: 'led', label: 'LED' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <Lightbulb className="h-4 w-4 text-red-500" />LED
          </button>
          <button type="button" onClick={() => startPlacement('cap')} onPointerDown={paletteDrag({ source: 'palette', type: 'cap', label: '0.1 µF' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <Circle className="h-4 w-4 text-amber-700" />0.1µF
          </button>
          <button type="button" onClick={() => startPlacement('switch')} onPointerDown={paletteDrag({ source: 'palette', type: 'switch', label: 'Switch' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <ToggleLeft className="h-4 w-4 text-stone-500" />Switch
          </button>
          <button type="button" onClick={() => startPlacement('button')} onPointerDown={paletteDrag({ source: 'palette', type: 'button', label: 'Button' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <Grid3x3 className="h-4 w-4 text-stone-500" />Button
          </button>
          <button type="button" onClick={() => startPlacement('supply')} onPointerDown={paletteDrag({ source: 'palette', type: 'supply', label: '+5 V' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <Power className="h-4 w-4 text-red-600" />5V supply
          </button>
          <button type="button" onClick={() => startPlacement('clock555')} onPointerDown={paletteDrag({ source: 'palette', type: 'clock555', label: '555 clock' })} className={`flex flex-col items-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-50 ${GRAB}`} style={NO_TOUCH_SCROLL}>
            <Timer className="h-4 w-4 text-amber-600" />555 clock
          </button>
        </div>
      </section>

      {/* board options */}
      <section className="pb-4">
        <h3 className={SECTION}>Boards — {project.boards.length}/6</h3>
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => useEditor.getState().addBoard('half400')}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] text-stone-700 hover:bg-stone-50"
            >
              + Half-size <span className="text-stone-400">(400 pt)</span>
            </button>
            <button
              type="button"
              onClick={() => useEditor.getState().addBoard('full830')}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-left text-[11px] text-stone-700 hover:bg-stone-50"
            >
              + Full-plus <span className="text-stone-400">(830 pt)</span>
            </button>
          </div>
          <p className="flex items-start gap-1 text-[10px] leading-snug text-stone-400">
            <GripHorizontal className="mt-0.5 h-3 w-3 shrink-0" />
            New boards land to the right — drag them by the header bar. Click a header to rename / re-configure in the Inspector. Wires can jump between boards. Drag parts from here onto any board (or click, then click holes). Drag from any hole to draw a wire. ESC cancels · Delete removes selection.
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
