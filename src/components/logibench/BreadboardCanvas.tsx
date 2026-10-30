'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HoleRef, PartInstance, Project, SimResult } from '@/lib/logibench/types';
import {
  BOARD_SPECS, PITCH, boardDims, colX, chipPackage, checkPlacement, holeExists, holeKey,
  nearestHole, occupiedHoles, parseHoleKey, partLabel, railGroups, rowY, sameHole, wireArc,
} from '@/lib/logibench/geometry';
import { netHolesOf, useEditor } from '@/store/projectStore';
import { useDnd } from '@/store/dnd';
import { beginDragTracking } from './drag';
import { getChipDef } from '@/data/chips';
import { resistorBands } from '@/lib/logibench/eseries';
import { Trash2 } from 'lucide-react';
import type { Mode, PlacementState, Selection } from '@/store/projectStore';

export interface CanvasCallbacks {
  onHoleClick: (hole: HoleRef) => void;
  onHoleHover: (hole: HoleRef | null) => void;
  onPartClick: (id: string) => void;
  onWireClick: (id: string) => void;
  onBackground: () => void;
  onSwitchToggle: (id: string) => void;
  onButtonPress: (id: string, closed: boolean) => void;
}

interface Props extends CanvasCallbacks {
  project: Project;
  simResult: SimResult | null;
  selection: Selection;
  placement: PlacementState | null;
  wireStart: HoleRef | null;
  running: boolean;
  liveSwitches: Record<string, boolean>;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

const BOARD_BG = '#f2efe4';
const HOLE_FILL = '#fbfaf5';
const HOLE_STROKE = '#a8a29e';

const LEVEL_COLORS: Record<string, string> = {
  '1': '#ef4444', '0': '#292524', 'X': '#78716c', 'Z': 'transparent', 'conflict': '#f59e0b',
};

export default function BreadboardCanvas(props: Props) {
  const kind = props.project.boards[0].kind;
  return (
    <CanvasInner
      key={kind}
      {...props}
      initialScale={kind === 'full830' ? 0.72 : 1}
    />
  );
}

function CanvasInner(props: Props & { initialScale: number }) {
  const { project, simResult, selection, placement, wireStart, running, liveSwitches } = props;
  const board = project.boards[0];
  const dims = boardDims(board.kind);
  const [view, setView] = useState({ x: 0, y: 0, scale: props.initialScale });
  const svgRefInt = useRef<SVGSVGElement | null>(null);
  const svgRef = props.svgRef ?? svgRefInt;
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  /* ---------- drag & drop (palette → board, part → move/trash, hole → wire) ---------- */
  // payload is identity-stable per drag session — no re-render on pointer-move
  const dndPayload = useDnd((s) => s.payload);
  const [dndHoverKey, setDndHoverKey] = useState<string | null>(null);
  const wireDrag = useDnd((s) => (s.payload?.kind === 'wire' ? s.payload : null));
  const wireColor = useEditor((s) => s.wireColor);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const [trashHot, setTrashHot] = useState(false);
  const wireDragPrevMode = useRef<Mode | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  /** live lift value while an arc handle is being dragged (commit on release) */
  const [liftDrag, setLiftDrag] = useState<{ id: string; lift: number } | null>(null);
  const beginLiftDrag = useCallback((id: string, a: { x: number; y: number }, b: { x: number; y: number }, e: React.PointerEvent) => {
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const onMove = (ev: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      const px = (ev.clientX - rect.left - v.x) / v.scale;
      const py = (ev.clientY - rect.top - v.y) / v.scale;
      // signed distance from the chord along the left normal
      const h = ((px - mx) * (dy / dist)) + ((py - my) * (-dx / dist));
      setLiftDrag({ id, lift: Math.max(-60, Math.min(60, Math.round(h))) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiftDrag((ld) => {
        if (ld) useEditor.getState().updateWire(ld.id, { lift: ld.lift });
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [svgRef]);

  useEffect(() => {
    if (!dndPayload) return;
    const clientToHole = (cx: number, cy: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      return nearestHole(board.kind, board.railLayout, (cx - rect.left - v.x) / v.scale, (cy - rect.top - v.y) / v.scale, board.id);
    };
    const trashHit = (cx: number, cy: number) => {
      const el = trashRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return cx >= r.left - 14 && cx <= r.right + 14 && cy >= r.top - 14 && cy <= r.bottom + 14;
    };
    const onMove = (ev: PointerEvent) => {
      const h = clientToHole(ev.clientX, ev.clientY);
      const k = h ? holeKey(h) : null;
      setDndHoverKey((prev) => (prev === k ? prev : k));
      const d = useDnd.getState().payload;
      const hot = !!d && d.kind === 'part' && d.source === 'board' && trashHit(ev.clientX, ev.clientY);
      setTrashHot((prev) => (prev === hot ? prev : hot));
    };
    const onUp = (ev: PointerEvent) => {
      const d = useDnd.getState().payload;
      useDnd.getState().cancel();
      setDndHoverKey(null);
      setTrashHot(false);
      if (!d) return;
      const st = useEditor.getState();
      if (d.kind === 'wire') {
        // drop on a hole completes the wire; anywhere else cancels the pending wire
        const hole = clientToHole(ev.clientX, ev.clientY);
        if (hole && d.hole && !sameHole(hole, d.hole)) st.addWire(d.hole, hole);
        useEditor.setState({ wireStart: null, mode: wireDragPrevMode.current ?? 'select' });
        wireDragPrevMode.current = null;
        return;
      }
      if (d.source === 'board' && d.partId && trashHit(ev.clientX, ev.clientY)) {
        st.removePart(d.partId);
        return;
      }
      const hole = clientToHole(ev.clientX, ev.clientY);
      if (!hole) return;
      if (d.source === 'palette') {
        if (!d.type) return;
        st.startPlacement(d.type, d.defId, d.preset);
        st.placeAt(hole);
      } else if (d.partId) {
        st.movePart(d.partId, hole);
      }
    };
    const onCancel = () => {
      const d = useDnd.getState().payload;
      useDnd.getState().cancel();
      setDndHoverKey(null);
      setTrashHot(false);
      if (d?.kind === 'wire') {
        useEditor.setState({ wireStart: null, mode: wireDragPrevMode.current ?? 'select' });
        wireDragPrevMode.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dndPayload !== null, board.kind, board.id]);

  // a wire drag re-targets wireStart to its origin hole; remember the mode to restore on drop
  useEffect(() => {
    if (dndPayload?.kind === 'wire' && dndPayload.hole) {
      wireDragPrevMode.current = useEditor.getState().mode;
      useEditor.setState({ wireStart: dndPayload.hole, mode: 'wire' });
    }
  }, [dndPayload]);

  const cols = BOARD_SPECS[board.kind].cols;

  const holePositions = useMemo(() => {
    const rows = ['+T', '-T', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '+B', '-B'] as const;
    const map = new Map<string, { x: number; y: number }>();
    for (let col = 1; col <= cols; col++) {
      for (const row of rows) {
        map.set(holeKey({ board: board.id, col, row }), { x: colX(board.kind, col), y: rowY(board.kind, row) });
      }
    }
    return map;
  }, [board.id, board.kind, cols]);

  const pos = useCallback(
    (h: HoleRef) => holePositions.get(holeKey(h)) ?? { x: 0, y: 0 },
    [holePositions],
  );

  // net highlight for hovered hole
  const netHoles = useMemo(() => {
    if (!hoverKey) return null;
    return new Set(netHolesOf(hoverKey, project));
  }, [hoverKey, project]);

  const holeLevel = useCallback(
    (key: string) => (running && simResult ? simResult.holeLevels.get(key) : undefined),
    [running, simResult],
  );

  /* ---------- pan & zoom ---------- */
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const scale = Math.min(3, Math.max(0.35, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: mx - k * (mx - v.x), y: my - k * (my - v.y) };
    });
  };

  const onPointerDownBg = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [view.x, view.y]);

  const onPointerMoveBg = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    }
  }, []);

  const onPointerUpBg = useCallback(() => { dragRef.current = null; }, []);

  /* ---------- hole interactions ---------- */
  const handleHoleClick = useCallback((h: HoleRef, e: React.MouseEvent) => {
    e.stopPropagation();
    props.onHoleClick(h);
  }, [props]);

  const handleHoleEnter = useCallback((h: HoleRef) => {
    const key = holeKey(h);
    setHoverKey(key);
    props.onHoleHover(h);
  }, [props]);

  const handleHoleLeave = useCallback(() => {
    setHoverKey(null);
    props.onHoleHover(null);
  }, [props]);

  /* ---------- ghost placement validity (click flow + drag & drop) ---------- */
  const ghost = useMemo(() => {
    const isDnd = dndPayload !== null;
    const type = isDnd ? dndPayload.type : placement?.type;
    const defId = isDnd ? dndPayload.defId : placement?.defId;
    const hk = isDnd ? dndHoverKey : hoverKey;
    if (!type || !hk) return null;
    const col = Number(hk.split(':')[1]);
    if (Number.isNaN(col)) return null;
    if (type === 'chip' || type === 'seg7') {
      const partsForCheck = isDnd && dndPayload.source === 'board' && dndPayload.partId
        ? project.parts.filter((p) => p.id !== dndPayload.partId)
        : project.parts;
      const check = checkPlacement(board.kind, partsForCheck, type, defId, col, board.id);
      const pkg = type === 'chip' ? chipPackage(defId ?? '7400') : null;
      return { kind: 'multi' as const, col, ok: check.ok, spans: type === 'seg7' ? 5 : pkg === 'DIP16' ? 8 : pkg === 'DIP14' ? 7 : 4 };
    }
    return { kind: 'two' as const, col, ok: true, spans: 1 };
  }, [placement, hoverKey, dndPayload, dndHoverKey, board.kind, board.id, project.parts]);

  const rows = ['+T', '-T', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '+B', '-B'] as const;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
      <svg
        ref={svgRef}
        data-testid="breadboard-svg"
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDownBg}
        onPointerMove={onPointerMoveBg}
        onPointerUp={onPointerUpBg}
        onPointerLeave={onPointerUpBg}
        onClick={() => props.onBackground()}
        role="img"
        aria-label="Breadboard canvas"
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
          {/* board base */}
          <rect x={6} y={4} width={dims.width - 4} height={dims.height - 8} rx={10} fill={BOARD_BG} stroke="#d6d3d1" strokeWidth={2} />
          {/* rail art — per-group tint + silk lines (red = +, blue = −), like the full-plus reference photo */}
          {(['+T', '-T', '+B', '-B'] as const).map((row) => {
            const line = row === '+T' || row === '+B' ? 0 : 1;
            const groups = railGroups(board.kind, board.railLayout, line);
            const y = rowY(board.kind, row);
            const isPlus = row === '+T' || row === '+B';
            const silkColor = isPlus ? '#dc2626' : '#2563eb';
            const silkY = (row === '+T' || row === '+B') ? y - 8 : y + 8;
            return (
              <g key={row}>
                {groups.map((g, gi) => (
                  <rect
                    key={gi} x={colX(board.kind, g.start) - 7} y={y - 7}
                    width={(g.end - g.start) * PITCH + 6} height={PITCH - 2} rx={4}
                    fill={isPlus ? '#fee2e2' : '#dbeafe'} opacity={0.5}
                  />
                ))}
                {groups.map((g, gi) => (
                  <line
                    key={`s${gi}`} x1={colX(board.kind, g.start) - 9} y1={silkY}
                    x2={colX(board.kind, g.end) + 9} y2={silkY}
                    stroke={silkColor} strokeWidth={1.6} strokeLinecap="round" opacity={0.85}
                  />
                ))}
              </g>
            );
          })}
          {/* channel shadow */}
          <rect
            x={dims.padX - 10}
            y={rowY(board.kind, 'e') + PITCH / 2 + 2}
            width={cols * PITCH + 12}
            height={rowY(board.kind, 'f') - rowY(board.kind, 'e') - PITCH - 2}
            fill="#0c0a09"
            opacity={0.07}
          />

          {/* jumper wires — arced over the board, under the hole hit areas */}
          {project.wires.map((w) => {
            const a = pos(w.from);
            const b = pos(w.to);
            const cross = w.from.board !== w.to.board;
            const dragging = liftDrag?.id === w.id ? liftDrag.lift : undefined;
            const { d, apex } = wireArc(a, b, { lift: dragging ?? w.lift, crossBoard: cross });
            const selected = selection?.kind === 'wire' && selection.id === w.id;
            const liftNow = dragging ?? w.lift ?? 0;
            return (
              <g key={w.id}>
                <path d={d} fill="none" stroke={w.color} strokeWidth={selected ? 5 : 3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} />
                {selected && <path d={d} fill="none" stroke="#fff" strokeWidth={1.4} strokeDasharray="4 4" />}
                {/* plug dots where the leads enter the holes */}
                <circle cx={a.x} cy={a.y} r={2.6} fill={w.color} />
                <circle cx={b.x} cy={b.y} r={2.6} fill={w.color} />
                <path
                  d={d} fill="none" stroke="transparent" strokeWidth={11} strokeLinecap="round"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => { e.stopPropagation(); props.onWireClick(w.id); }}
                />
                {selected && (
                  <g
                    data-testid={`wire-lift-${w.id}`}
                    role="slider"
                    aria-label="Wire arc height"
                    aria-valuenow={Math.round(liftNow)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      const step = e.key === 'ArrowUp' ? 4 : e.key === 'ArrowDown' ? -4 : 0;
                      if (step) {
                        e.preventDefault();
                        useEditor.getState().updateWire(w.id, { lift: Math.max(-60, Math.min(60, liftNow + step)) });
                      }
                    }}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => beginLiftDrag(w.id, a, b, e)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <circle cx={apex.x} cy={apex.y} r={10} fill="#d97706" opacity={0.15} />
                    <circle cx={apex.x} cy={apex.y} r={4.5} fill="#fff" stroke="#d97706" strokeWidth={2} />
                    <title>Drag to lift / flip the arc — arrow keys nudge</title>
                  </g>
                )}
              </g>
            );
          })}

          {/* live rubber-band while dragging a wire from a hole */}
          {wireDrag?.hole && (
            <WireDragLayer svgRef={svgRef} view={view} origin={wireDrag.hole} pos={pos} color={wireColor} />
          )}

          {/* holes */}
          {rows.map((row) =>
            Array.from({ length: cols }, (_, ci) => {
              const col = ci + 1;
              // groups5 rail gaps are bare plastic — no hole there
              if (!holeExists(board.kind, board.railLayout, row, col)) return null;
              const key = `${board.id}:${col}:${row}`;
              const p = { x: colX(board.kind, col), y: rowY(board.kind, row) };
              const level = holeLevel(key);
              const inNet = netHoles?.has(key);
              const levelColor = level !== undefined ? LEVEL_COLORS[level] : undefined;
              const isWireStart = wireStart && holeKey(wireStart) === key;
              return (
                <g key={key}>
                  {inNet && <circle cx={p.x} cy={p.y} r={7} fill="#fbbf24" opacity={0.5} />}
                  <rect
                    x={p.x - 3.4} y={p.y - 3.4} width={6.8} height={6.8} rx={1.4}
                    fill={levelColor && levelColor !== 'transparent' ? levelColor : HOLE_FILL}
                    stroke={level === 'conflict' ? '#b45309' : HOLE_STROKE}
                    strokeWidth={level === 'conflict' ? 1.6 : 0.7}
                  />
                  <rect
                    x={p.x - 7} y={p.y - 7} width={14} height={14} fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      // pressing an exposed hole can become a drag-to-wire gesture
                      if (running) return;
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      e.stopPropagation(); // don't pan the board
                      beginDragTracking({ kind: 'wire', hole: { board: board.id, col, row }, label: 'wire' }, e);
                    }}
                    onClick={(e) => handleHoleClick({ board: board.id, col, row }, e)}
                    onMouseEnter={() => handleHoleEnter({ board: board.id, col, row })}
                    onMouseLeave={handleHoleLeave}
                  />
                  {isWireStart && <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#d97706" strokeWidth={2} className="animate-pulse" />}
                </g>
              );
            }),
          )}

          {/* column numbers — above the top rail and in the channel, like the reference */}
          {Array.from({ length: cols }, (_, ci) => {
            const col = ci + 1;
            if (col % 5 !== 0) return null;
            const yChannel = (rowY(board.kind, 'e') + rowY(board.kind, 'f')) / 2 + 3;
            return (
              <g key={col}>
                <text x={colX(board.kind, col)} y={dims.yPlusT - 11} textAnchor="middle" fontSize={8} fill="#78716c" fontFamily="ui-monospace, monospace">{col}</text>
                <text x={colX(board.kind, col)} y={yChannel} textAnchor="middle" fontSize={8} fill="#a8a29e" fontFamily="ui-monospace, monospace">{col}</text>
              </g>
            );
          })}

          {/* row letters on both edges (strip rows) */}
          {(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const).map((row) => {
            const y = rowY(board.kind, row) + 3;
            return (
              <g key={row}>
                <text x={dims.padX - 14} y={y} textAnchor="middle" fontSize={8} fill="#78716c" fontFamily="ui-monospace, monospace">{row.toUpperCase()}</text>
                <text x={dims.padX + cols * PITCH + 8} y={y} textAnchor="middle" fontSize={8} fill="#78716c" fontFamily="ui-monospace, monospace">{row.toUpperCase()}</text>
              </g>
            );
          })}

          {/* parts — the wrapper g turns a press on a placed part into a move-drag */}
          {project.parts.map((part) => (
            <g
              key={part.id}
              onPointerDown={(e) => {
                if (running) return; // simulate mode: switches/buttons handle their own presses
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.stopPropagation(); // don't pan the board
                beginDragTracking(
                  { kind: 'part', source: 'board', type: part.type, defId: part.defId, partId: part.id, label: partLabel(part) },
                  e,
                );
              }}
              style={{ touchAction: 'none', opacity: dndPayload?.partId === part.id ? 0.35 : 1 }}
            >
              <PartGraphic
                key={part.id}
                part={part}
                pos={pos}
                boardKind={board.kind}
                selected={selection?.kind === 'part' && selection.id === part.id}
                sim={running ? simResult : null}
                liveClosed={liveSwitches[part.id] ?? (part.type === 'switch' || part.type === 'button' ? part.props.closed ?? false : false)}
                onSelect={() => props.onPartClick(part.id)}
                onSwitchToggle={props.onSwitchToggle}
                onButtonPress={props.onButtonPress}
                interactive={running}
              />
            </g>
          ))}

          {/* ghost preview */}
          {ghost?.kind === 'multi' && (
            <rect
              x={colX(board.kind, ghost.col) - 8}
              y={rowY(board.kind, 'e') - 10}
              width={ghost.spans * PITCH + 8}
              height={rowY(board.kind, 'f') - rowY(board.kind, 'e') + 12}
              rx={5}
              fill={ghost.ok ? '#d97706' : '#dc2626'}
              opacity={0.25}
              stroke={ghost.ok ? '#d97706' : '#dc2626'}
              strokeDasharray="5 3"
            />
          )}
          {placement && placement.anchor && hoverKey && placement.type !== 'chip' && placement.type !== 'seg7' && (
            <line
              x1={pos(placement.anchor).x} y1={pos(placement.anchor).y}
              x2={Number(hoverKey.split(':')[1]) !== undefined ? colX(board.kind, Number(hoverKey.split(':')[1])) : 0}
              y2={rowY(board.kind, hoverKey.split(':')[2] as never)}
              stroke="#d97706" strokeWidth={2.5} strokeDasharray="6 4" opacity={0.8}
            />
          )}
          {/* drop target ring while dragging a wire or two-pin part over a hole (red = occupied) */}
          {dndPayload && dndHoverKey && (dndPayload.kind === 'wire' || (dndPayload.type !== 'chip' && dndPayload.type !== 'seg7')) && (() => {
            const p = pos(parseHoleKey(dndHoverKey));
            const occupied = occupiedHoles(project.parts, project.wires, dndPayload.partId).has(dndHoverKey);
            return <circle cx={p.x} cy={p.y} r={8} fill="none" stroke={occupied ? '#dc2626' : '#d97706'} strokeWidth={2} strokeDasharray="3 2" pointerEvents="none" />;
          })()}
        </g>
      </svg>

      {/* zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          type="button" aria-label="Zoom in"
          className="h-8 w-8 rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50"
          onClick={() => setView((v) => ({ ...v, scale: Math.min(3, v.scale * 1.2) }))}
        >+</button>
        <button
          type="button" aria-label="Zoom out"
          className="h-8 w-8 rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm hover:bg-stone-50"
          onClick={() => setView((v) => ({ ...v, scale: Math.max(0.35, v.scale / 1.2) }))}
        >−</button>
        <button
          type="button" aria-label="Reset view"
          className="h-8 w-8 rounded-md border border-stone-300 bg-white text-xs text-stone-700 shadow-sm hover:bg-stone-50"
          onClick={() => setView({ x: 0, y: 0, scale: 1 })}
        >⟲</button>
      </div>
      {/* legend */}
      {running && (
        <div className="pointer-events-none absolute left-3 top-3 flex gap-2 rounded-md bg-white/85 px-2 py-1 text-[10px] font-medium text-stone-600 shadow-sm">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" /> HIGH</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-stone-700" /> LOW</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-stone-400" /> floating/X</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-500 bg-amber-400" /> conflict</span>
        </div>
      )}

      {/* drag-to-trash target (appears while moving a placed part) */}
      {dndPayload?.kind === 'part' && dndPayload.source === 'board' && (
        <div
          ref={trashRef}
          data-testid="drag-trash"
          aria-hidden
          className={`pointer-events-none absolute right-3 top-3 flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-md transition-all duration-100 ${trashHot ? 'scale-125 border-red-500 bg-red-500/95 text-white' : 'border-stone-300 bg-white/90 text-stone-400'}`}
        >
          <Trash2 className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}

/**
 * Live rubber-band preview for hole→hole wire drags. Runs its own
 * pointermove listener (state updates come from the event handler, never
 * the effect body) and only mounts while a wire drag is active, so the
 * rest of the canvas never re-renders per pointer-move.
 */
function WireDragLayer({ svgRef, view, origin, pos, color }: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  view: { x: number; y: number; scale: number };
  origin: HoleRef;
  pos: (h: HoleRef) => { x: number; y: number };
  color: string;
}) {
  const payload = useDnd((s) => s.payload);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const active = payload?.kind === 'wire';

  useEffect(() => {
    if (!active) return;
    const onMove = (ev: PointerEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setPt({ x: (ev.clientX - rect.left - view.x) / view.scale, y: (ev.clientY - rect.top - view.y) / view.scale });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [active, view, svgRef]);

  if (!active || !pt) return null;
  const a = pos(origin);
  const { d } = wireArc(a, pt);
  return (
    <g pointerEvents="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={3} strokeDasharray="7 5" strokeLinecap="round" opacity={0.9} />
      <circle cx={pt.x} cy={pt.y} r={3.5} fill={color} opacity={0.9} />
    </g>
  );
}

/* ------------------------------------------------------------------ */

interface PartGraphicProps {
  part: PartInstance;
  pos: (h: HoleRef) => { x: number; y: number };
  boardKind: 'half400' | 'full830';
  selected: boolean;
  sim: SimResult | null;
  liveClosed: boolean;
  onSelect: () => void;
  onSwitchToggle: (id: string) => void;
  onButtonPress: (id: string, closed: boolean) => void;
  interactive: boolean;
}

const PartGraphic = memo(function PartGraphic({
  part, pos, boardKind, selected, sim, liveClosed, onSelect, onSwitchToggle, onButtonPress, interactive,
}: PartGraphicProps) {
  const pts = part.pins.map(pos);
  const stroke = selected ? '#d97706' : undefined;
  const selectedW = selected ? 2 : 0;

  const chipDef = part.type === 'chip' ? getChipDef(part.defId ?? '') : undefined;
  const powered = sim ? sim.poweredChips.has(part.id) : true;

  if (part.type === 'chip' && chipDef) {
    const pkg = chipPackage(part.defId!);
    const spans = pkg === 'DIP8' ? 4 : pkg === 'DIP14' ? 7 : 8;
    const x1 = pts[0].x - 8;
    const x2 = pts[spans - 1].x + 8;
    const y1 = rowY(boardKind, 'e') - 9;
    const y2 = rowY(boardKind, 'f') + 9;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`${part.defId} chip${sim && !powered ? ' — unpowered' : ''}`}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSelect(); } }}
        style={{ cursor: 'pointer' }}
      >
        {/* pin stubs */}
        {pts.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y > cy ? y2 - 2 : y1 + 2} x2={p.x} y2={p.y} stroke="#57534e" strokeWidth={2.4} />
        ))}
        <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={4} fill="#1c1917" stroke={stroke ?? '#000'} strokeWidth={selectedW} opacity={0.97} />
        {/* notch */}
        <path d={`M ${x1} ${cy} a 7 7 0 0 1 14 0 z`} fill={BOARD_BG} opacity={0.9} />
        {/* pin 1 dot */}
        <circle cx={x1 + 10} cy={pts[0].y > cy ? y1 + 12 : y2 - 12} r={2.2} fill="#a8a29e" />
        <text x={cx + 8} y={cy - 2} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fafaf9" fontFamily="ui-monospace, monospace">{part.defId}</text>
        <text x={cx + 8} y={cy + 10} textAnchor="middle" fontSize={7.5} fill="#d6d3d1">{(part.family ?? chipDef.families[0] ?? '').toUpperCase()}</text>
        {sim && !powered && (
          <g>
            <circle cx={x2 - 10} cy={y1 + 10} r={7} fill="#dc2626" />
            <text x={x2 - 10} y={y1 + 13.4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">!</text>
          </g>
        )}
        {sim && powered && chipDef.model === 'counter' && (
          <text x={x2 - 8} y={y2 - 6} textAnchor="end" fontSize={9} fill="#fbbf24" fontFamily="ui-monospace, monospace">
            {sim.counterValues.get(part.id) ?? 0}
          </text>
        )}
      </g>
    );
  }

  if (part.type === 'seg7') {
    const x1 = pts[0].x - 9;
    const x2 = pts[4].x + 9;
    const y1 = rowY(boardKind, 'e') - 11;
    const y2 = rowY(boardKind, 'f') + 11;
    const states = sim?.segStates.get(part.id);
    const segGeo: Record<string, { x: number; y: number; w: number; h: number }> = (() => {
      const w = x2 - x1;
      const h = y2 - y1;
      const m = 8; // margin
      const t = 4.5; // segment thickness
      const cy = (y1 + y2) / 2;
      return {
        a: { x: x1 + m + 4, y: y1 + m, w: w - 2 * m - 8, h: t },
        g: { x: x1 + m + 4, y: cy - t / 2, w: w - 2 * m - 8, h: t },
        d: { x: x1 + m + 4, y: y2 - m - t, w: w - 2 * m - 8, h: t },
        f: { x: x1 + m, y: y1 + m + 3, w: t, h: (h - 2 * m) / 2 - 6 },
        b: { x: x2 - m - t, y: y1 + m + 3, w: t, h: (h - 2 * m) / 2 - 6 },
        e: { x: x1 + m, y: cy + 3, w: t, h: (h - 2 * m) / 2 - 6 },
        c: { x: x2 - m - t, y: cy + 3, w: t, h: (h - 2 * m) / 2 - 6 },
      };
    })();
    const color = part.props.color ?? 'red';
    const litColor = color === 'red' ? '#ef4444' : color === 'green' ? '#22c55e' : color === 'yellow' ? '#eab308' : '#38bdf8';
    const segOn = (s: string) => {
      if (!states) return false;
      return states[s]?.lit ?? false;
    };
    const bright = (s: string) => (states ? states[s]?.brightness ?? 0 : 0);
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        {pts.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y > (y1 + y2) / 2 ? y2 - 2 : y1 + 2} x2={p.x} y2={p.y} stroke="#57534e" strokeWidth={2.2} />
        ))}
        <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={4} fill="#0c0a09" stroke={stroke ?? '#000'} strokeWidth={selectedW} />
        {(['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).map((s) => {
          const g = segGeo[s];
          const on = segOn(s);
          return (
            <rect
              key={s} x={g.x} y={g.y} width={g.w} height={g.h} rx={1.5}
              fill={on ? litColor : '#292524'}
              opacity={on ? 0.35 + 0.65 * bright(s) : 1}
            />
          );
        })}
        {/* dp */}
        <circle cx={x2 - 8} cy={y2 - 9} r={2.4} fill={segOn('dp') ? litColor : '#292524'} />
        <text x={x1 + 5} y={y1 + 9} fontSize={7} fill="#a8a29e" fontFamily="ui-monospace, monospace">
          {part.props.polarity === 'CA' ? '5161BS · CA' : '5161AS · CC'}
        </text>
        {sim && states && Object.values(states).some((s) => s.noResistor && s.lit) && (
          <circle cx={x1 - 6} cy={y1 + 4} r={6} fill="#dc2626" />
        )}
      </g>
    );
  }

  if (part.type === 'resistor') {
    const a = pts[0];
    const b = pts[1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const bands = resistorBands(part.props.ohms ?? 330);
    const bandHex: Record<string, string> = {
      black: '#1c1917', brown: '#78350f', red: '#dc2626', orange: '#ea580c',
      yellow: '#eab308', green: '#16a34a', blue: '#2563eb', violet: '#7c3aed',
      grey: '#a8a29e', white: '#fafaf9', gold: '#d4a017',
    };
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#44403c" strokeWidth={1.6} />
        <g transform={`rotate(${(angle * 180) / Math.PI} ${mx} ${my})`}>
          <rect x={mx - 16} y={my - 5} width={32} height={10} rx={5} fill="#d6bfa2" stroke={stroke ?? '#a8a29e'} strokeWidth={selectedW || 0.8} />
          {bands.bands.slice(0, 3).map((band, i) => (
            <rect key={i} x={mx - 11 + i * 6} y={my - 5} width={2.8} height={10} fill={bandHex[band] ?? '#000'} />
          ))}
        </g>
      </g>
    );
  }

  if (part.type === 'led') {
    const a = pts[0];
    const b = pts[1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const st = sim?.ledStates.get(part.id);
    const color = part.props.color ?? 'red';
    const litColor = color === 'red' ? '#ef4444' : color === 'green' ? '#22c55e' : color === 'yellow' ? '#eab308' : '#38bdf8';
    const on = (st?.brightness ?? 0) > 0.02;
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#44403c" strokeWidth={1.4} />
        {on && <circle cx={mx} cy={my} r={11} fill={litColor} opacity={0.25 + 0.3 * (st?.brightness ?? 0)} />}
        <circle cx={mx} cy={my} r={6.5} fill={on ? litColor : '#57534e'} stroke={stroke ?? '#292524'} strokeWidth={selectedW || 1} opacity={on ? 0.45 + 0.55 * (st?.brightness ?? 0) : 1} />
        {st?.noResistor && <circle cx={mx + 9} cy={my - 9} r={5} fill="#dc2626" />}
      </g>
    );
  }

  if (part.type === 'switch') {
    const a = pts[0];
    const b = pts[1];
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`SPST switch ${liveClosed ? 'closed' : 'open'}${interactive ? ' — press Enter to toggle' : ''}`}
        data-testid={`switch-${part.id}`}
        onClick={(e) => { e.stopPropagation(); if (interactive) onSwitchToggle(part.id); else onSelect(); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && interactive) { e.stopPropagation(); onSwitchToggle(part.id); } }}
        style={{ cursor: 'pointer' }}
      >
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a8a29e" strokeWidth={1.2} strokeDasharray="2 2" />
        <rect x={Math.min(a.x, b.x) - 4} y={Math.min(a.y, b.y) - 13} width={Math.abs(b.x - a.x) + 8} height={10} rx={5} fill={selected ? '#d97706' : '#78716c'} stroke={stroke ?? 'none'} strokeWidth={selectedW} />
        <SwitchLever a={a} b={b} closed={liveClosed} />
        <title>SPST switch — click to toggle{interactive ? ' (simulate mode)' : ''}</title>
      </g>
    );
  }

  if (part.type === 'button') {
    const a = pts[0];
    const b = pts[1];
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - 8;
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={`Pushbutton${interactive ? ' — hold Enter/space to press' : ''}`}
        onPointerDown={(e) => { if (interactive) { e.stopPropagation(); onButtonPress(part.id, true); } }}
        onPointerUp={() => onButtonPress(part.id, false)}
        onPointerLeave={() => onButtonPress(part.id, false)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && interactive) { e.stopPropagation(); onButtonPress(part.id, true); } }}
        onKeyUp={() => onButtonPress(part.id, false)}
        onClick={(e) => { e.stopPropagation(); if (!interactive) onSelect(); }}
        style={{ cursor: 'pointer' }}
      >
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a8a29e" strokeWidth={1.2} strokeDasharray="2 2" />
        <rect x={mx - 11} y={my - 5} width={22} height={10} rx={5} fill={selected ? '#d97706' : '#57534e'} />
        <circle cx={mx} cy={my} r={3.4} fill="#d6d3d1" />
        <title>Pushbutton — hold to close</title>
      </g>
    );
  }

  if (part.type === 'cap') {
    const a = pts[0];
    const b = pts[1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#44403c" strokeWidth={1.2} />
        <ellipse cx={mx} cy={my} rx={7.5} ry={5.5} fill="#d6b68a" stroke={stroke ?? '#78350f'} strokeWidth={selectedW || 0.8} />
        <title>0.1 µF decoupling capacitor</title>
      </g>
    );
  }

  if (part.type === 'supply') {
    const a = pts[0];
    const b = pts[1];
    const x1 = Math.min(a.x, b.x) - 12;
    const y1 = Math.min(a.y, b.y) - 10;
    const w = Math.abs(b.x - a.x) + 24;
    const h = Math.abs(b.y - a.y) + 20;
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        <rect x={x1} y={y1} width={w} height={h} rx={6} fill="#0c0a09" stroke={stroke ?? '#000'} strokeWidth={selectedW} />
        <circle cx={a.x} cy={a.y} r={3.5} fill="#ef4444" />
        <circle cx={b.x} cy={b.y} r={3.5} fill={stroke ?? '#d6d3d1'} />
        <text x={x1 + w / 2} y={y1 + h / 2 + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fafaf9" fontFamily="ui-monospace, monospace">+5V</text>
        <title>5 V supply — + and −</title>
      </g>
    );
  }

  if (part.type === 'clock555') {
    const a = pts[0];
    const w = 58;
    const h = 26;
    const x1 = a.x - 10;
    const y1 = a.y - 16;
    const outLv = sim?.holeLevels.get(holeKey(part.pins[2]));
    return (
      <g onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ cursor: 'pointer' }}>
        <rect x={x1} y={y1} width={w} height={h} rx={5} fill="#292524" stroke={stroke ?? '#000'} strokeWidth={selectedW} />
        <text x={x1 + 10} y={y1 + 12} fontSize={9} fontWeight={700} fill="#fbbf24" fontFamily="ui-monospace, monospace">555</text>
        <text x={x1 + 10} y={y1 + 21} fontSize={7} fill="#d6d3d1" fontFamily="ui-monospace, monospace">
          {(part.props.freqHz ?? 1).toFixed(part.props.freqHz && part.props.freqHz < 10 ? 1 : 0)} Hz
        </text>
        <circle cx={x1 + w - 8} cy={y1 + h / 2} r={3.4} fill={outLv === 1 ? '#ef4444' : outLv === 0 ? '#292524' : '#78716c'} stroke="#a8a29e" />
        <title>555 astable clock module</title>
      </g>
    );
  }

  return null;
});

function SwitchLever({ a, b, closed }: { a: { x: number; y: number }; b: { x: number; y: number }; closed: boolean }) {
  const mx = (a.x + b.x) / 2;
  const y = Math.min(a.y, b.y) - 8;
  return closed ? (
    <line x1={mx - 8} y1={y} x2={mx + 8} y2={y} stroke="#fbbf24" strokeWidth={3} strokeLinecap="round" />
  ) : (
    <line x1={mx - 8} y1={y} x2={mx + 2} y2={y - 7} stroke="#e7e5e4" strokeWidth={3} strokeLinecap="round" />
  );
}
