'use client';

import { useEditor } from '@/store/projectStore';
import { getChipDef, SEG7_PINOUT } from '@/data/chips';
import { partLabel } from '@/lib/logibench/geometry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Info } from 'lucide-react';
import { nearestESeries, formatOhms } from '@/lib/logibench/eseries';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

const RES_VALUES = [100, 150, 220, 270, 330, 470, 680, 1000, 2200, 4700, 10000];

export default function Inspector() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const updatePart = useEditor((s) => s.updatePart);
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const mode = useEditor((s) => s.mode);

  const part = selection?.kind === 'part' ? project.parts.find((p) => p.id === selection.id) : undefined;
  const wire = selection?.kind === 'wire' ? project.wires.find((w) => w.id === selection.id) : undefined;

  if (!part && !wire) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Info className="h-6 w-6 text-stone-300" />
        <p className="text-xs leading-relaxed text-stone-400">
          Select a part or wire to inspect it.<br />
          Hover a hole to highlight its net.<br />
          {mode === 'simulate' ? 'Interact mode: click switches and hold buttons.' : 'Use Interact mode to drive the live circuit.'}
        </p>
      </div>
    );
  }

  if (wire) {
    return (
      <div className="space-y-4 p-4">
        <h3 className={SECTION}>Jumper wire</h3>
        <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-3">
          <span className="h-5 w-5 rounded-full border border-stone-300" style={{ backgroundColor: wire.color }} />
          <span className="font-mono text-xs text-stone-700">
            ({wire.from.col},{wire.from.row}) → ({wire.to.col},{wire.to.row})
          </span>
        </div>
        <div>
          <Label className="text-[11px] text-stone-500">Color</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries({
              red: '#dc2626', black: '#27272a', orange: '#ea580c', green: '#16a34a',
              violet: '#7c3aed', teal: '#0d9488', amber: '#d97706', brown: '#78350f', gray: '#52525b',
            }).map(([name, hex]) => (
              <button
                key={name} type="button" title={name} aria-label={`color ${name}`}
                onClick={() => useEditor.getState().commit((p) => {
                  const w = p.wires.find((x) => x.id === wire.id);
                  if (w) w.color = hex;
                })}
                className={`h-5 w-5 rounded-full border-2 ${wire.color === hex ? 'border-stone-900' : 'border-transparent'}`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={deleteSelection} className="w-full">
          <Trash2 className="h-3.5 w-3.5" /> Delete wire
        </Button>
      </div>
    );
  }

  const def = part?.type === 'chip' ? getChipDef(part.defId ?? '') : undefined;

  return (
    <div className="space-y-4 overflow-y-auto p-4" key={part?.id}>
      <div>
        <h3 className={SECTION}>Selected part</h3>
        <div className="mt-1.5 rounded-lg border border-stone-200 bg-white p-3">
          <div className="font-mono text-sm font-bold text-stone-800">{part ? partLabel(part) : ''}</div>
          {def && <div className="mt-0.5 text-[11px] leading-snug text-stone-500">{def.name}</div>}
          {part?.id && <div className="mt-1 font-mono text-[9px] text-stone-300">{part.id}</div>}
        </div>
      </div>

      {part?.type === 'resistor' && (
        <div>
          <Label className="text-[11px] text-stone-500">Resistance</Label>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {RES_VALUES.map((v) => (
              <button
                key={v} type="button"
                onClick={() => updatePart(part.id, { ohms: v })}
                className={`rounded-md border px-1 py-1 font-mono text-[10px] ${part.props.ohms === v ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
              >{formatOhms(v)}</button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number" className="h-7 w-24 text-xs" value={part.props.ohms ?? 330}
              onChange={(e) => updatePart(part.id, { ohms: Math.max(1, Number(e.target.value) || 330) })}
            />
            <span className="text-[10px] text-stone-400">nearest E24: {formatOhms(nearestESeries(part.props.ohms ?? 330))}</span>
          </div>
        </div>
      )}

      {part?.type === 'led' && (
        <div>
          <Label className="text-[11px] text-stone-500">Color</Label>
          <div className="mt-1.5 flex gap-1.5">
            {(['red', 'green', 'yellow', 'blue'] as const).map((c) => (
              <button
                key={c} type="button"
                onClick={() => updatePart(part.id, { color: c })}
                className={`rounded-md border px-2 py-1 text-[10px] capitalize ${part.props.color === c ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white'}`}
              >{c}</button>
            ))}
          </div>
        </div>
      )}

      {part?.type === 'seg7' && (
        <div>
          <Label className="text-[11px] text-stone-500">Polarity (verify with multimeter!)</Label>
          <div className="mt-1.5 flex gap-1.5">
            {(['CA', 'CC'] as const).map((c) => (
              <button
                key={c} type="button"
                onClick={() => updatePart(part.id, { polarity: c })}
                className={`rounded-md border px-2 py-1 font-mono text-[10px] ${part.props.polarity === c ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white'}`}
              >{c === 'CA' ? '5161BS · CA' : '5161AS · CC'}</button>
            ))}
          </div>
          <div className="mt-3 rounded-md bg-stone-50 p-2 text-[10px] leading-relaxed text-stone-500">
            {Object.entries(SEG7_PINOUT).map(([pin, seg]) => (
              <span key={pin} className="mr-2 inline-block font-mono">
                {pin}=<span className={seg === 'com' ? 'font-bold text-red-600' : ''}>{seg}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {part?.type === 'switch' && (
        <div className="text-[11px] text-stone-500">
          SPST switch. In <b>Interact</b> mode, click it on the board to open/close. Closed = shorts its two holes (logic mode).
        </div>
      )}

      {part?.type === 'clock555' && (
        <div>
          <Label className="text-[11px] text-stone-500">Frequency: {(part.props.freqHz ?? 1).toFixed(1)} Hz</Label>
          <input
            type="range" min={0.5} max={10} step={0.5} value={part.props.freqHz ?? 1}
            onChange={(e) => updatePart(part.id, { freqHz: Number(e.target.value) })}
            className="mt-1 w-full accent-amber-600"
          />
          <p className="mt-1 text-[10px] text-stone-400">Real NE555 astable: f ≅ 1.44/((RA+2RB)·C). 1k/68k/10µF ≈ 1 Hz.</p>
        </div>
      )}

      {part?.type === 'cap' && (
        <p className="text-[11px] text-stone-500">0.1 µF decoupling cap — place across VCC–GND of each IC (ERC checks this).</p>
      )}

      {part?.type === 'supply' && (
        <p className="text-[11px] text-stone-500">Fixed 5 V supply. + terminal (red) → + rail, − (dark) → − rail.</p>
      )}

      {def && !def.refOnly && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className={SECTION}>Power</div>
          <p className="mt-1 font-mono text-[11px] text-stone-600">
            VCC = pin {def.power.vcc} · GND = pin {def.power.gnd}
          </p>
          {def.power.vcc !== def.pins.length && def.power.vcc !== 14 && (
            <p className="mt-1 text-[10px] font-medium text-red-600">Non-standard power pins — see the Reference tab!</p>
          )}
        </div>
      )}

      <Button variant="destructive" size="sm" onClick={deleteSelection} className="w-full">
        <Trash2 className="h-3.5 w-3.5" /> Delete part
      </Button>
    </div>
  );
}
