'use client';

import { useMemo } from 'react';
import { useEditor } from '@/store/projectStore';
import { getChipDef, SEG7_PINOUT } from '@/data/chips';
import { partLabel } from '@/lib/logibench/geometry';
import { buildNetlistCached } from '@/lib/logibench/netlist';
import { ne555Astable } from '@/lib/logibench/ne555';
import type { PartInstance } from '@/lib/logibench/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2, Info, Copy, Route, Zap } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { nearestESeries, formatOhms } from '@/lib/logibench/eseries';
import { gapRouteBends } from '@/lib/logibench/geometry';

const SECTION = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

const RES_VALUES = [100, 150, 220, 270, 330, 470, 680, 1000, 2200, 4700, 10000];

function formatFreq(hz: number): string {
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(hz / 1e6 >= 10 ? 1 : 2)} MHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz / 1000 >= 10 ? 1 : 2)} kHz`;
  if (hz >= 10) return `${hz.toFixed(1)} Hz`;
  return `${hz.toFixed(2)} Hz`;
}

function formatFarads(f: number): string {
  if (f >= 1e-6) return `${+(f * 1e6).toPrecision(3)} µF`;
  if (f >= 1e-9) return `${+(f * 1e9).toPrecision(3)} nF`;
  return `${+(f * 1e12).toPrecision(3)} pF`;
}

function formatTime(sec: number): string {
  if (sec >= 1) return `${sec.toFixed(2)} s`;
  if (sec >= 1e-3) return `${+(sec * 1e3).toPrecision(3)} ms`;
  return `${+(sec * 1e6).toPrecision(3)} µs`;
}

/** Real NE555: the RC network the user actually wired → the frequency it makes. */
function Ne555Card({ part }: { part: PartInstance }) {
  const project = useEditor((s) => s.project);
  const ast = useMemo(() => ne555Astable(project, buildNetlistCached(project), part), [project, part]);
  if (!ast) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-3 text-[11px] leading-relaxed text-stone-500">
        <b className="text-stone-700">Astable wiring:</b> RA from VCC(8) to DISCH(7), RB from DISCH(7)
        to THRES(6), C from THRES(6) to GND(1), TRIG(2) tied to THRES(6), RESET̅(4) to VCC.
        The moment all three parts are wired, this card shows the frequency they make:
        f ≅ 1.44/((RA+2RB)·C).
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Astable — from your RC parts</div>
      <div className="mt-1 font-mono text-sm font-bold text-stone-800">f ≈ {formatFreq(ast.freqHz)}</div>
      <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-stone-500">
        duty ≈ {Math.round(ast.dutyHigh * 100)}% HIGH<br />
        RA {formatOhms(ast.ra)} · RB {formatOhms(ast.rb)} · C {formatFarads(ast.c)}<br />
        t<sub>H</sub> ≈ {formatTime(0.693 * (ast.ra + ast.rb) * ast.c)} · t<sub>L</sub> ≈ {formatTime(0.693 * ast.rb * ast.c)}
      </div>
      {!ast.trigTied && (
        <div className="mt-1.5 text-[11px] font-medium text-amber-700">
          TRIG(2) is not tied to THRES(6) — the ERC flags it; the real circuit latches after one cycle.
        </div>
      )}
    </div>
  );
}

export default function Inspector() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const updatePart = useEditor((s) => s.updatePart);
  const deleteSelection = useEditor((s) => s.deleteSelection);
  const mode = useEditor((s) => s.mode);

  const part = selection?.kind === 'part' ? project.parts.find((p) => p.id === selection.id) : undefined;
  const wire = selection?.kind === 'wire' ? project.wires.find((w) => w.id === selection.id) : undefined;
  const board = selection?.kind === 'board' ? project.boards.find((b) => b.id === selection.id) : undefined;

  if (!part && !wire && !board) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Info className="h-6 w-6 text-stone-300" />
        <p className="text-xs leading-relaxed text-stone-500">
          Select a part or wire to inspect it.<br />
          Hover a hole to highlight its net.<br />
          {mode === 'simulate' ? 'Interact mode: click switches and hold buttons.' : 'Use Interact mode to drive the live circuit.'}
        </p>
      </div>
    );
  }

  if (board) {
    const affected = project.parts.filter((pt) => pt.pins.some((h) => h.board === board.id)).length
      + project.wires.filter((w) => w.from.board === board.id || w.to.board === board.id).length;
    return (
      <div className="space-y-4 p-4">
        <h3 className={SECTION}>Breadboard</h3>
        <div>
          <Label className="text-[11px] text-stone-500" htmlFor="board-label">Label</Label>
          <Input
            id="board-label"
            className="mt-1.5 h-8 text-xs"
            value={board.label ?? board.id}
            maxLength={24}
            onChange={(e) => useEditor.getState().renameBoard(board.id, e.target.value)}
          />
        </div>
        <div>
          <Label className="text-[11px] text-stone-500">Size</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {([
              ['half400', 'Half · 400 pt'],
              ['full830', 'Full-plus · 830 pt'],
            ] as const).map(([kind, label]) => (
              <button
                key={kind} type="button"
                onClick={() => useEditor.getState().setBoardKind(board.id, kind)}
                aria-pressed={board.kind === kind}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-medium ${board.kind === kind ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="text-[11px] text-stone-500">Rail layout</Label>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            {([
              ['continuous', 'Solid'],
              ['center-split', 'Split'],
              ['groups5', 'Groups'],
            ] as const).map(([layout, label]) => (
              <button
                key={layout} type="button"
                onClick={() => useEditor.getState().setRailLayout(board.id, layout)}
                aria-pressed={board.railLayout === layout}
                title={layout === 'groups5' ? 'Full-plus style: independent 5-hole groups (classic trap!)' : layout === 'center-split' ? 'Rails broken once in the middle' : 'Each rail line is one net'}
                className={`rounded-md border px-1 py-1.5 text-[11px] font-medium ${board.railLayout === layout ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {board.railLayout === 'groups5' && (
            <p className="mt-1.5 text-[11px] leading-snug text-stone-500">Rails are broken into 5-hole groups — bridge them with jumpers or power each group.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => useEditor.getState().duplicateBoard(board.id)} disabled={project.boards.length >= 6}>
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={project.boards.length <= 1}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove “{board.label ?? board.id}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the board together with {affected} part{affected === 1 ? '' : 's'} / wire{affected === 1 ? '' : 's'} placed on it. You can undo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep board</AlertDialogCancel>
                <AlertDialogAction onClick={() => useEditor.getState().removeBoard(board.id)}>
                  Remove board
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {project.boards.length >= 6 && (
          <p className="text-[11px] text-stone-500">Board limit (6) reached — remove one to add another.</p>
        )}
      </div>
    );
  }

  if (wire) {
    const crossBoard = wire.from.board !== wire.to.board;
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
          <Label className="text-[11px] text-stone-500">Route</Label>
          <div className={`mt-1.5 grid grid-cols-2 gap-1.5`}>
            <Button
              variant="outline" size="sm"
              title="Insert a bend at the middle of the wire — or double-click the wire on the canvas; drag bends to route around parts"
              onClick={() => useEditor.getState().addWireBend(wire.id, { x: 0.5, y: 24 })}
            >
              <Route className="h-3.5 w-3.5" /> Add bend
            </Button>
            <Button
              variant="outline" size="sm"
              title="Re-run the auto-router: via the board gap, L/Z around chips, or a tiered arc"
              onClick={() => useEditor.getState().autoRouteWire(wire.id)}
            >
              <Route className="h-3.5 w-3.5" /> Auto route
            </Button>
            {crossBoard ? (
              <Button
                variant="outline" size="sm"
                title="Bend the jumper through the gap between the boards (drag the bend points on the canvas)"
                onClick={() => {
                  const bends = gapRouteBends(useEditor.getState().project.boards, wire.from, wire.to);
                  if (!bends) {
                    useEditor.getState().setFlash('The boards touch — there is no gap to route through.');
                    return;
                  }
                  useEditor.getState().updateWire(wire.id, { bends, route: 'gap' });
                }}
              >
                <Route className="h-3.5 w-3.5" /> Via gap
              </Button>
            ) : (
              <Button
                variant="outline" size="sm"
                title="Stagger the arc heights of this wire and its parallel neighbours so they stop overlapping"
                onClick={() => useEditor.getState().decollideBundle(wire.id)}
              >
                <Route className="h-3.5 w-3.5" /> De-collide
              </Button>
            )}
            <Button
              variant="outline" size="sm" disabled={!wire.bends?.length}
              title="Back to the plain arc"
              onClick={() => useEditor.getState().updateWire(wire.id, { bends: undefined, route: undefined })}
            >
              Plain arc
            </Button>
          </div>
          {wire.bends?.length ? (
            <p className="mt-1 text-[11px] text-stone-500">Manhattan route — drag the bend points on the canvas. Double-click the wire to add a bend, double-click a bend (or press Delete on it) to remove it.</p>
          ) : null}
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

      {def?.id === '555' && part && <Ne555Card part={part} />}

      {part?.type === 'resistor' && (
        <div>
          <Label className="text-[11px] text-stone-500">Resistance</Label>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {RES_VALUES.map((v) => (
              <button
                key={v} type="button"
                onClick={() => updatePart(part.id, { ohms: v })}
                className={`rounded-md border px-1 py-1 font-mono text-[11px] ${part.props.ohms === v ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}
              >{formatOhms(v)}</button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number" className="h-7 w-24 text-xs" value={part.props.ohms ?? 330}
              onChange={(e) => updatePart(part.id, { ohms: Math.max(1, Number(e.target.value) || 330) })}
            />
            <span className="text-[11px] text-stone-500">nearest E24: {formatOhms(nearestESeries(part.props.ohms ?? 330))}</span>
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
                className={`rounded-md border px-2 py-1 text-[11px] capitalize ${part.props.color === c ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white'}`}
              >{c}</button>
            ))}
          </div>
          <p className="mt-2 rounded-md bg-stone-50 p-2 text-[11px] leading-relaxed text-stone-500">
            Direction matters: <b>pin 1 = anode</b> (+, long leg), <b>pin 2 = cathode</b> (−, flat side).
            Backwards = dark — the ERC flags it. Series resistor required (ERC checks ≥ 220 Ω).
          </p>
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
                className={`rounded-md border px-2 py-1 font-mono text-[11px] ${part.props.polarity === c ? 'border-amber-500 bg-amber-50' : 'border-stone-200 bg-white'}`}
              >{c === 'CA' ? '5161BS · CA' : '5161AS · CC'}</button>
            ))}
          </div>
          <div className="mt-3 rounded-md bg-stone-50 p-2 text-[11px] leading-relaxed text-stone-500">
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
          <p className="mt-1 text-[11px] text-stone-500">Real NE555 astable: f ≅ 1.44/((RA+2RB)·C). 1k/68k/10µF ≈ 1 Hz.</p>
          <Button
            variant="outline" size="sm" className="mt-2 w-full"
            onClick={() => useEditor.getState().wireChipPower(part.id)}
          >
            <Zap className="h-3.5 w-3.5" /> Wire power to the rails
          </Button>
        </div>
      )}

      {part?.type === 'cap' && (
        <div>
          <Label className="text-[11px] text-stone-500">Value</Label>
          <div className="mt-1.5 flex gap-1.5">
            {([
              [1e-7, '100 nF ceramic'],
              [1e-6, '1 µF electrolytic'],
              [1e-5, '10 µF electrolytic'],
            ] as const).map(([f, label]) => (
              <button
                key={f} type="button"
                onClick={() => updatePart(part.id, { farads: f })}
                className={`rounded-md border px-2 py-1 text-[11px] ${part.props.farads === f ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600'}`}
              >{label}</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
            100 nF ceramic decouples each IC (ERC checks this). Electrolytics (≥ 1 µF) are polarized: pin 1 = +, pin 2 = −.
          </p>
        </div>
      )}

      {part?.type === 'supply' && (
        <div>
          <Label className="text-[11px] text-stone-500">Voltage</Label>
          <div className="mt-1.5 flex gap-1.5">
            {([3.3, 5, 9, 12] as const).map((v) => (
              <button
                key={v} type="button"
                onClick={() => updatePart(part.id, { volts: v })}
                className={`rounded-md border px-2 py-1 font-mono text-[11px] ${part.props.volts === v ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-stone-200 bg-white text-stone-600'}`}
              >{v} V</button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
            + terminal (red) → + net, − terminal (dark) → − net. Multiple supplies are fine on separate nets —
            paralleling different voltages on one net is a short (ERC errors).
          </p>
        </div>
      )}

      {part?.type === 'chip' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3">
          <div>
            <Label className="text-[11px] text-stone-500">Inserted backwards</Label>
            <p className="mt-1 text-[11px] leading-snug text-stone-500">
              DIP seated 180° — pin 1 sits where pin {def?.pins.length ?? '?'} belongs.
              The ERC flags it and the sim flips the pin map, exactly like the bench.
            </p>
          </div>
          <Switch
            checked={part.props.reversed === true}
            onCheckedChange={(v) => updatePart(part.id, { reversed: v })}
            aria-label="Chip inserted backwards"
          />
        </div>
      )}

      {def && !def.refOnly && part && (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <div className={SECTION}>Power</div>
          <p className="mt-1 font-mono text-[11px] text-stone-600">
            VCC = pin {def.power.vcc} · GND = pin {def.power.gnd}
          </p>
          {def.power.vcc !== def.pins.length && def.power.vcc !== 14 && (
            <p className="mt-1 text-[11px] font-medium text-red-600">Non-standard power pins — see the Reference tab!</p>
          )}
          <Button
            variant="outline" size="sm" className="mt-2 w-full"
            title="Jump each unwired power pin to the nearest free hole on the matching rail"
            onClick={() => useEditor.getState().wireChipPower(part.id)}
          >
            <Zap className="h-3.5 w-3.5" /> Wire power to the rails
          </Button>
        </div>
      )}

      <Button variant="destructive" size="sm" onClick={deleteSelection} className="w-full">
        <Trash2 className="h-3.5 w-3.5" /> Delete part
      </Button>
    </div>
  );
}
