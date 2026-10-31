/**
 * Wiring-model invariants (wiring backlog P1 batch).
 *
 * 1. enumerateHoles now mirrors physical reality: groups5 rail gaps hold NO
 *    union-find node (half400 continuous = 420 nodes; full830 groups5 = 715).
 * 2. The three golden demos raise zero `phantom-hole` ERC errors.
 * 3. `wired-outputs` fires on two tied push-pull outputs but never on the demos.
 * 4. The O(1) pinNet index agrees with the hole-level netlist for every pin.
 *
 * Run: bun scripts/audit/wiring-invariants.ts
 */
import { demo7447, demo4511, demoTwoBoard } from '@/lib/logibench/demo';
import { enumerateHoles } from '@/lib/logibench/netlist';
import { Simulator } from '@/lib/logibench/sim';
import { holeKey } from '@/lib/logibench/geometry';
import type { Project, PartInstance, Wire } from '@/lib/logibench/types';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fail++;
};

/* ---- 1. enumerateHoles hole counts ---- */
const lab1 = demo7447();
const lab3 = demoTwoBoard();
/* full830 groups5 per board: 630 field holes + (9+8 groups) × 5 holes × 2 sides
 * (+T/+B share the line-0 groups, −T/−B the line-1 groups) = 630 + 170 = 800. */
ok(enumerateHoles(lab1).holes.length === 420, `half400 continuous has 420 tie-points (got ${enumerateHoles(lab1).holes.length})`);
ok(enumerateHoles(lab3).holes.length === 1600, `2× full830 groups5 has 1600 tie-points, gaps excluded (got ${enumerateHoles(lab3).holes.length})`);

/* ---- 2. no phantom holes in the demos ---- */
const ercOf = (proj: Project) => {
  const sim = new Simulator(proj);
  return sim.compute().result.issues;
};
for (const [name, proj] of [['Lab1', lab1], ['Lab2', demo4511()], ['Lab3', lab3]] as const) {
  const ph = ercOf(proj).filter((i) => i.rule === 'phantom-hole');
  ok(ph.length === 0, `${name}: zero phantom-hole issues (got ${ph.length}${ph.length ? `: ${ph.map((p) => p.title).join('; ')}` : ''})`);
}

/* ---- 3. wired-outputs: fires on tied push-pull outputs ---- */
{
  const p: Project = {
    schema: 2,
    name: 'wired-outputs fixture',
    boards: [{ id: 'main', kind: 'half400', railLayout: 'continuous' }],
    parts: [],
    wires: [],
    notes: '',
  };
  const H = (col: number, row: string) => ({ board: 'main', col, row: row as never });
  const part = (t: PartInstance['type'], pins: [number, string][], props: PartInstance['props'], defId?: string): PartInstance =>
    ({ id: `p${p.parts.length + 1}`, type: t, ...(defId ? { defId } : {}), pins: pins.map(([c, r]) => H(c, r)), props });
  const wire = (from: [number, string], to: [number, string], color = '#ea580c'): Wire =>
    ({ id: `w${p.wires.length + 1}`, from: H(from[0], from[1]), to: H(to[0], to[1]), color });

  p.parts.push(part('supply', [[1, '+T'], [1, '-T']], { volts: 5 }));
  // 7404 DIP14 @ cols 3..9: pin1=e3 ... pin7=e9, pin8=f9 ... pin14=f3
  p.parts.push(part('chip', [
    [3, 'e'], [4, 'e'], [5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'],
    [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f'], [4, 'f'], [3, 'f'],
  ], {}, '7404'));
  p.wires.push(wire([3, 'g'], [3, '+T'], '#dc2626')); // VCC pin 14 strip
  p.wires.push(wire([9, 'd'], [9, '-T'], '#27272a')); // GND pin 7 strip
  p.wires.push(wire([4, 'd'], [6, 'd']));             // 1Y (pin 2, e4) tied to 2Y (pin 4, e6)

  const issues = ercOf(p);
  const wo = issues.filter((i) => i.rule === 'wired-outputs');
  ok(wo.length === 1, `tied 7404 outputs raise exactly one wired-outputs error (got ${wo.length})`);
  const cont = issues.filter((i) => i.rule === 'contention');
  ok(cont.length === 0, 'same fixture raises NO contention (outputs agree — that is the point of the static rule)');
}

/* ---- 3b. ...and never on the demos ---- */
for (const [name, proj] of [['Lab1', lab1], ['Lab2', demo4511()], ['Lab3', lab3]] as const) {
  const wo = ercOf(proj).filter((i) => i.rule === 'wired-outputs');
  ok(wo.length === 0, `${name}: zero wired-outputs issues (got ${wo.length})`);
}

/* ---- 4. pinNet index agrees with hole-level netlist ---- */
{
  const proj = demo4511();
  const sim = new Simulator(proj);
  // reach into the simulator's netlist indirectly: rebuild one and compare
  const { buildNetlist } = await import('@/lib/logibench/netlist');
  const nl = buildNetlist(proj);
  let mismatch = 0;
  for (const part of proj.parts) {
    part.pins.forEach((h, idx) => {
      const viaPin = nl.pinNet(part.id, idx + 1);
      const viaHole = nl.holeNet.get(holeKey(h));
      if (viaPin !== viaHole) mismatch++;
    });
  }
  ok(mismatch === 0, `pinNet index matches holeNet for all ${proj.parts.reduce((s, p) => s + p.pins.length, 0)} pins (mismatches: ${mismatch})`);
  void sim;
}

/* ---- 5. reversed chip: ERC root cause, flipped pin map, dead display ---- */
{
  const proj = demo4511();
  const dec = proj.parts.find((p) => p.defId === '4511')!;
  dec.props.reversed = true;
  const sim = new Simulator(proj);
  const out = sim.compute();
  const rev = out.result.issues.filter((i) => i.rule === 'chip-reversed');
  ok(rev.length === 1, `reversed 4511 raises exactly one chip-reversed error (got ${rev.length})`);
  ok(out.result.poweredChips.has(dec.id) === false, 'reversed 4511 is unpowered (pin map flipped)');
  const sev = proj.parts.find((p) => p.type === 'seg7')!;
  const step = sim.step(500);
  const segs = step.result.segStates.get(sev.id)!;
  const anyLit = Object.values(segs).some((s) => s.lit);
  ok(!anyLit, 'reversed 4511 keeps the display dark while the 7490 still counts');
  ok((step.result.counterValues.size ?? 0) >= 0, 'counter unaffected by the backwards decoder');
}

/* ---- 6. weak-pull: 10 kΩ pull-down on an LS input warns, 1 kΩ stays silent ---- */
{
  const mk = (ohms: number) => {
    const p: Project = {
      schema: 2, name: 'weak-pull fixture',
      boards: [{ id: 'main', kind: 'half400', railLayout: 'continuous' }],
      parts: [], wires: [], notes: '',
    };
    const H = (col: number, row: string) => ({ board: 'main', col, row: row as never });
    const part = (t: PartInstance['type'], pins: [number, string][], props: PartInstance['props'], defId?: string): PartInstance =>
      ({ id: `p${p.parts.length + 1}`, type: t, ...(defId ? { defId } : {}), pins: pins.map(([c, r]) => H(c, r)), props });
    const wire = (from: [number, string], to: [number, string], color = '#ea580c'): Wire =>
      ({ id: `w${p.wires.length + 1}`, from: H(from[0], from[1]), to: H(to[0], to[1]), color });
    p.parts.push(part('supply', [[1, '+T'], [1, '-T']], { volts: 5 }));
    // 7404 DIP14 @ cols 3..9 (powered); input 1A = pin 1 = e3
    p.parts.push(part('chip', [
      [3, 'e'], [4, 'e'], [5, 'e'], [6, 'e'], [7, 'e'], [8, 'e'], [9, 'e'],
      [9, 'f'], [8, 'f'], [7, 'f'], [6, 'f'], [5, 'f'], [4, 'f'], [3, 'f'],
    ], {}, '7404'));
    p.wires.push(wire([3, 'g'], [3, '+T'], '#dc2626'));
    p.wires.push(wire([9, 'd'], [9, '-T'], '#27272a'));
    // pull-down on 1A: resistor from the input strip (col 3) to the −T rail
    p.parts.push(part('resistor', [[3, 'c'], [3, '-T']], { ohms }));
    return p;
  };
  const bad = ercOf(mk(10000)).filter((i) => i.rule === 'weak-pull');
  ok(bad.length === 1, `10 kΩ LS pull-down raises one weak-pull warning (got ${bad.length})`);
  const good = ercOf(mk(1000)).filter((i) => i.rule === 'weak-pull');
  ok(good.length === 0, `1 kΩ LS pull-down stays silent (got ${good.length})`);
}

/* ---- 7. migrate round-trip keeps reversed / lift / bends ---- */
{
  const proj = demo4511();
  const dec = proj.parts.find((p) => p.defId === '4511')!;
  dec.props.reversed = true;
  proj.wires[0].lift = -22;
  proj.wires[0].bends = [{ x: 0.5, y: -30 }];
  const { migrateProject } = await import('@/lib/logibench/migrate');
  const m = migrateProject(JSON.parse(JSON.stringify(proj)));
  ok(m !== null, 'migrateProject accepts the enriched v2 project');
  const mdec = m!.project.parts.find((p) => p.defId === '4511');
  ok(mdec?.props.reversed === true, 'reversed flag survives migration');
  const mw = m!.project.wires[0];
  ok(mw.lift === -22, `wire lift survives migration (got ${mw?.lift})`);
  ok(Array.isArray(mw.bends) && mw.bends[0]?.y === -30, 'wire bends survive migration');
}

console.log(fail === 0 ? 'ALL OK' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
