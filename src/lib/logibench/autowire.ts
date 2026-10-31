import type { HoleRef, PartInstance, Project } from './types';
import { BOARD_SPECS, WIRE_COLOR_MINUS, WIRE_COLOR_PLUS, holeExists, holeKey } from './geometry';
import { buildNetlist } from './netlist';
import { getChipDef } from '@/data/chips';

/**
 * One-click power wiring (wiring backlog P3-d): for every power pin (VCC/GND)
 * that does not already reach a matching rail, pick a free hole in the pin's
 * own strip and jump it to the nearest free hole on the matching rail of the
 * same board half (+T/−T above the channel, +B/−B below). Pure function — the
 * store action commits the returned wire specs.
 */

export interface AutoWireSpec {
  from: HoleRef;
  to: HoleRef;
  color: string;
  pinName: string;
}

export interface AutoWireResult {
  wires: AutoWireSpec[];
  problems: string[];
}

const TOP_ROWS = ['d', 'c', 'b', 'a'] as const;
const BOTTOM_ROWS = ['g', 'h', 'i', 'j'] as const;
const isTopRow = (r: string) => ['a', 'b', 'c', 'd', 'e'].includes(r);

export function autoPowerWires(project: Project, partId: string): AutoWireResult {
  const part = project.parts.find((p) => p.id === partId);
  if (!part) return { wires: [], problems: ['Part not found.'] };

  const powerPins: { pin: number; name: string; plus: boolean }[] = [];
  if (part.type === 'chip' && part.defId) {
    const def = getChipDef(part.defId);
    if (!def) return { wires: [], problems: ['Unknown chip.'] };
    if (def.refOnly) return { wires: [], problems: [`${def.id} is reference-only — no power model.`] };
    if (part.props.reversed) {
      return { wires: [], problems: ['Fix the chip orientation first — it is inserted backwards.'] };
    }
    powerPins.push({ pin: def.power.vcc, name: 'VCC', plus: true });
    powerPins.push({ pin: def.power.gnd, name: 'GND', plus: false });
  } else if (part.type === 'clock555') {
    powerPins.push({ pin: 1, name: 'V+', plus: true });
    powerPins.push({ pin: 2, name: 'GND', plus: false });
  } else {
    return { wires: [], problems: ['Only chips and the 555 module have power pins.'] };
  }

  const board = project.boards.find((b) => b.id === part.pins[0]?.board) ?? project.boards[0];
  const nl = buildNetlist(project);
  const occ = new Set<string>();
  for (const p of project.parts) for (const h of p.pins) occ.add(holeKey(h));
  for (const w of project.wires) {
    occ.add(holeKey(w.from));
    occ.add(holeKey(w.to));
  }

  const wires: AutoWireSpec[] = [];
  const problems: string[] = [];
  const cols = BOARD_SPECS[board.kind].cols;

  /** does this net actually touch a supply terminal of the matching polarity? */
  const netSupplied = (netId: number | undefined, plus: boolean) => {
    if (netId === undefined) return false;
    const net = nl.nets[netId];
    return (plus ? net.isVccRail : net.isGndRail) && net.pins.some((np) => np.type === 'supply');
  };
  const freeRailHole = (row: string, nearCol: number) => {
    for (let off = 0; off < cols; off++) {
      for (const c of off === 0 ? [nearCol] : [nearCol - off, nearCol + off]) {
        if (c < 1 || c > cols) continue;
        if (!holeExists(board.kind, board.railLayout, row as never, c)) continue;
        const h: HoleRef = { board: board.id, col: c, row: row as never };
        if (!occ.has(holeKey(h))) return h;
      }
    }
    return null;
  };

  for (const { pin, name, plus } of powerPins) {
    const netId = nl.pinNet(part.id, pin);
    if (netId !== undefined) {
      const net = nl.nets[netId];
      if (plus ? net.isVccRail : net.isGndRail) continue; // already reaches the right rail
    }
    const pinHole = part.pins[pin - 1];
    if (!pinHole) {
      problems.push(`${name}: no hole for pin ${pin}.`);
      continue;
    }
    const top = isTopRow(pinHole.row);
    // free hole in the pin's own strip, closest to the pin
    let src: HoleRef | null = null;
    for (const r of top ? TOP_ROWS : BOTTOM_ROWS) {
      const h: HoleRef = { board: pinHole.board, col: pinHole.col, row: r };
      if (!occ.has(holeKey(h))) {
        src = h;
        break;
      }
    }
    if (!src) {
      problems.push(`${name}: every free hole in column ${pinHole.col}'s strip is taken.`);
      continue;
    }
    // nearest free rail hole on the matching polarity, same half of the board
    const railRow = plus ? (top ? '+T' : '+B') : (top ? '-T' : '-B');
    let dst: HoleRef | null = freeRailHole(railRow, pinHole.col);
    if (!dst) {
      problems.push(`${name}: no free hole on the ${railRow} rail — bridge the rail groups first.`);
      continue;
    }
    wires.push({ from: src, to: dst, color: plus ? WIRE_COLOR_PLUS : WIRE_COLOR_MINUS, pinName: name });
    // the near rail may be a dead line (top/bottom halves are separate rails).
    // A real builder bridges the halves once — do that automatically when the
    // target half has no supply contact but the other half does.
    if (!netSupplied(nl.holeNet.get(holeKey(dst)), plus)) {
      const otherRow = plus ? (top ? '+B' : '+T') : (top ? '-B' : '-T');
      const bridgeHole = freeRailHole(otherRow, dst.col);
      const bridgeSupplied =
        bridgeHole !== null && netSupplied(nl.holeNet.get(holeKey(bridgeHole)), plus);
      if (bridgeHole && bridgeSupplied) {
        wires.push({
          from: dst,
          to: bridgeHole,
          color: plus ? WIRE_COLOR_PLUS : WIRE_COLOR_MINUS,
          pinName: `${name} rail bridge`,
        });
      } else {
        problems.push(`${name}: the ${railRow} rail has no supply contact — wire the supply to a rail (or bridge the halves) first.`);
      }
    }
  }

  return { wires, problems };
}
