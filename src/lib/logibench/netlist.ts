import { UnionFind } from './unionFind';
import { holeKey, isRailRow, parseHoleKey, BOARD_SPECS, railGroups, RAIL_ROWS, holeExists } from './geometry';
import type { HoleRef, Net, NetPin, PartInstance, Project, Wire } from './types';

/**
 * Netlist extraction (plan §5.2):
 * 1. Pre-union strip groups (column a–e, column f–j, each rail segment).
 * 2. Union both ends of every wire.
 * 3. Closed switches/buttons union their two pins (logic mode).
 * Resistors/LEDs/caps are two-terminal ELEMENTS, not unions.
 */

export interface HoleIndex {
  /** holeKey -> node id */
  node: Map<string, number>;
  /** node id -> holeKey[] */
  holes: string[];
}

export function enumerateHoles(project: Project): HoleIndex {
  const holes: string[] = [];
  const node = new Map<string, number>();
  for (const board of project.boards) {
    const cols = BOARD_SPECS[board.kind].cols;
    for (let col = 1; col <= cols; col++) {
      for (const row of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '+T', '-T', '+B', '-B'] as const) {
        // groups5 rail gaps are bare plastic — no tie-point, no node. A stale or
        // hand-edited project can still reference them; ERC flags those leads
        // as `phantom-hole` (they must never join a net).
        if (!holeExists(board.kind, board.railLayout, row, col)) continue;
        const k = holeKey({ board: board.id, col, row });
        node.set(k, holes.length);
        holes.push(k);
      }
    }
  }
  return { node, holes };
}

export interface NetlistResult {
  nets: Net[];
  /** holeKey -> net id */
  holeNet: Map<string, number>;
  /** partId -> net id of pin number (1-based) */
  pinNet: (partId: string, pin: number) => number | undefined;
}

export function buildNetlist(project: Project, opts?: { switchStates?: Map<string, boolean> }): NetlistResult {
  const { node, holes } = enumerateHoles(project);
  const pinNets = new Map<string, number>();
  const uf = new UnionFind(holes.length);

  const boardById = new Map(project.boards.map((b) => [b.id, b]));
  const colsOf = (b: string) => BOARD_SPECS[boardById.get(b)?.kind ?? 'half400'].cols;

  // 1. strip unions
  for (const board of project.boards) {
    const cols = colsOf(board.id);
    const topRows = ['a', 'b', 'c', 'd', 'e'] as const;
    const botRows = ['f', 'g', 'h', 'i', 'j'] as const;
    for (let col = 1; col <= cols; col++) {
      // rows a-e form one net; f-j another
      for (let i = 0; i < 4; i++) {
        uf.union(node.get(holeKey({ board: board.id, col, row: topRows[i] }))!, node.get(holeKey({ board: board.id, col, row: topRows[i + 1] }))!);
        uf.union(node.get(holeKey({ board: board.id, col, row: botRows[i] }))!, node.get(holeKey({ board: board.id, col, row: botRows[i + 1] }))!);
      }
    }
    // rails: unions follow the board's rail layout — independent groups
    // (continuous = one span, center-split = two halves, groups5 = 5-hole
    // groups staggered per line; gap columns hold no holes)
    for (const row of RAIL_ROWS) {
      const line = row === '+T' || row === '+B' ? 0 : 1;
      for (const g of railGroups(board.kind, board.railLayout, line)) {
        for (let col = g.start; col < g.end; col++) {
          const a = node.get(holeKey({ board: board.id, col, row }));
          const b = node.get(holeKey({ board: board.id, col: col + 1, row }));
          if (a !== undefined && b !== undefined) uf.union(a, b);
        }
      }
    }
  }

  // 2. wire unions
  for (const w of project.wires) {
    const a = node.get(holeKey(w.from));
    const b = node.get(holeKey(w.to));
    if (a !== undefined && b !== undefined) uf.union(a, b);
  }

  // 3. closed switches (plan: closed switch is a union in logic mode)
  const sw = opts?.switchStates;
  for (const part of project.parts) {
    if (part.type === 'switch' || part.type === 'button') {
      const closed = sw ? sw.get(part.id) ?? !!part.props.closed : !!part.props.closed;
      if (closed && part.pins.length >= 2) {
        const a = node.get(holeKey(part.pins[0]));
        const b = node.get(holeKey(part.pins[1]));
        if (a !== undefined && b !== undefined) uf.union(a, b);
      }
    }
  }

  // group into nets
  const netOfNode = new Map<number, number>();
  const nets: Net[] = [];
  const netHoles = new Map<number, string[]>();
  for (let i = 0; i < holes.length; i++) {
    const root = uf.find(node.get(holes[i])!);
    let id = netOfNode.get(root);
    if (id === undefined) {
      id = nets.length;
      netOfNode.set(root, id);
      netHoles.set(id, []);
      nets.push({ id, holes: [], pins: [], isVccRail: false, isGndRail: false, resistors: [] });
    }
    netHoles.get(id)!.push(holes[i]);
    nets[id].holes.push(holes[i]);
  }

  const holeNet = new Map<string, number>();
  for (const h of holes) {
    holeNet.set(h, netOfNode.get(uf.find(node.get(h)!))!);
  }

  // attach part pins (and the O(1) pin→net index).
  // A chip inserted backwards (props.reversed) swaps its pin mapping: the hole
  // holding "pin 1" physically contacts pin N, so pin numbers flip around the
  // package — everything downstream (power checks, gate models, ERC) then
  // reacts to the backwards chip exactly as the real bench would.
  for (const part of project.parts) {
    const flip = part.type === 'chip' && part.props.reversed === true;
    const pinTotal = part.pins.length;
    part.pins.forEach((h, idx) => {
      const pin = flip ? pinTotal - idx : idx + 1;
      const netId = holeNet.get(holeKey(h));
      if (netId === undefined) return;
      const np: NetPin = { partId: part.id, type: part.type, pin, hole: h };
      nets[netId].pins.push(np);
      pinNets.set(`${part.id}:${pin}`, netId);
    });
  }

  // classify rails: a net is a "rail" net if it contains any rail-row hole
  for (const net of nets) {
    for (const k of net.holes) {
      const { row } = parseHoleKey(k);
      if (isRailRow(row)) {
        if (row === '+T' || row === '+B') net.isVccRail = true;
        else net.isGndRail = true;
      }
    }
  }

  // resistor adjacency (two-terminal elements create element lists, not unions)
  for (const part of project.parts) {
    if (part.type === 'resistor' && part.pins.length >= 2) {
      const a = holeNet.get(holeKey(part.pins[0]));
      const b = holeNet.get(holeKey(part.pins[1]));
      if (a !== undefined && b !== undefined && a !== b) {
        nets[a].resistors.push({ net: b, ohms: part.props.ohms ?? 330 });
        nets[b].resistors.push({ net: a, ohms: part.props.ohms ?? 330 });
      }
    }
  }

  const pinNet = (partId: string, pin: number): number | undefined => pinNets.get(`${partId}:${pin}`);

  return { nets, holeNet, pinNet };
}

export function holeRefsOfNet(nets: Net[], netId: number): HoleRef[] {
  return (nets[netId]?.holes ?? []).map(parseHoleKey);
}

/**
 * Netlist cache for hover-path callers: keyed by the project object identity
 * (commits produce new objects) plus the live switch states, so repeated
 * hovers between edits never rebuild the union-find.
 */
const netlistCache = new WeakMap<Project, { swKey: string; res: NetlistResult }>();

export function buildNetlistCached(project: Project, switchStates?: Map<string, boolean>): NetlistResult {
  const swKey = switchStates
    ? [...switchStates.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v ? 1 : 0}`).join(';')
    : '';
  const hit = netlistCache.get(project);
  if (hit && hit.swKey === swKey) return hit.res;
  const res = buildNetlist(project, { switchStates });
  netlistCache.set(project, { swKey, res });
  return res;
}

/** All holes in the same net as `key` (for hover highlight). */
export function netHolesFor(
  project: Project,
  key: string,
  switchStates?: Map<string, boolean>,
): string[] {
  const { nets, holeNet } = buildNetlistCached(project, switchStates);
  const id = holeNet.get(key);
  if (id === undefined) return [key];
  return nets[id].holes;
}

export type { Wire };
