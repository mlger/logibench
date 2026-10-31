/**
 * Lab 3 (demoTwoBoard) audit — the interrupted-session check.
 *
 * Verifies the two-board golden circuit is loadable and functional:
 *   A. schema v2 shape: 2 boards, ids main/b2, full830, groups5, distinct x
 *   B. JSON round-trip through migrateProject() preserves everything
 *   C. cross-board nets: Q0..Q3 (main) union with A..D (b2); +/− rails bridge
 *   D. ERC: zero errors (warnings listed)
 *   E. sim: 555 ticks → 7490 counts → 4511 decodes → 5161AS segments match
 *      the BCD glyph for the counter value (4511 datasheet font)
 *
 * Run: bun scripts/audit/lab3-two-board.ts
 */
import { demoTwoBoard } from '@/lib/logibench/demo';
import { migrateProject } from '@/lib/logibench/migrate';
import { buildNetlist } from '@/lib/logibench/netlist';
import { holeKey } from '@/lib/logibench/geometry';
import { Simulator } from '@/lib/logibench/sim';
import { getChipDef } from '@/data/chips';
import type { Project } from '@/lib/logibench/types';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

console.log('== A. schema shape ==');
const demo = demoTwoBoard();
ok(demo.schema === 2, 'schema is 2');
ok(demo.boards.length === 2, `2 boards (got ${demo.boards.length})`);
ok(demo.boards[0].id === 'main' && demo.boards[1].id === 'b2', 'ids main + b2');
ok(demo.boards.every((b) => b.kind === 'full830' && b.railLayout === 'groups5'), 'both full830 groups5');
ok(demo.boards[0].x !== demo.boards[1].x, 'boards at distinct x');
ok(demo.parts.every((p) => p.pins.every((h) => demo.boards.some((b) => b.id === h.board))), 'every part pin references an existing board');

console.log('== B. JSON round-trip via migrateProject ==');
const rt = migrateProject(JSON.parse(JSON.stringify(demo)));
ok(rt !== null, 'migrateProject returns a result');
const proj: Project = rt ? rt.project : demo;
ok(JSON.stringify(proj.boards) === JSON.stringify(demo.boards), 'boards survive round-trip');
ok(proj.parts.length === demo.parts.length && proj.wires.length === demo.wires.length,
  `parts (${proj.parts.length}) + wires (${proj.wires.length}) survive`);

console.log('== C. cross-board nets ==');
const nl = buildNetlist(proj);
const netOf = (board: string, col: number, row: string) => nl.holeNet.get(holeKey({ board, col, row: row as never }));
const pairs: [string, [number, string], [number, string]][] = [
  ['Q0→A', [15, 'h'], [11, 'd']],
  ['Q1→B', [18, 'g'], [5, 'd']],
  ['Q2→C', [19, 'g'], [6, 'd']],
  ['Q3→D', [16, 'g'], [10, 'd']],
  ['+ rail bridge', [4, '+T'], [3, '+T']],
  ['− rail bridge', [16, '-T'], [6, '-T']],
];
for (const [label, a, b] of pairs) {
  const na = netOf('main', a[0], a[1]);
  const nb = netOf('b2', b[0], b[1]);
  ok(na !== undefined && na === nb, `${label}: main(${a}) ≡ b2(${b})`, `nets ${na} vs ${nb}`);
}
// 7490 GND must share a net with b2 GND through the − bridge (common ground)
ok(netOf('main', 17, 'g') === netOf('b2', 12, 'd'), '7490 GND ≡ 4511 GND (common ground across boards)');
ok(netOf('main', 2, '+T') === netOf('b2', 4, '+T'), 'supply +T ≡ b2 +T anchor');

console.log('== D. ERC ==');
const sim = new Simulator(proj);
const first = sim.compute();
const errors = first.result.issues.filter((i) => i.severity === 'error');
const warnings = first.result.issues.filter((i) => i.severity === 'warning');
ok(errors.length === 0, `zero ERC errors (got ${errors.length})`, errors.map((e) => e.title).join('; '));
for (const w of warnings) console.log(`    ⚠ warning: ${w.title}`);
ok(first.result.poweredChips.size >= 2, `chips powered: ${first.result.poweredChips.size}`);

console.log('== E. sim counting + decode ==');
const SEV = proj.parts.find((p) => p.type === 'seg7')!;
const C90 = proj.parts.find((p) => p.type === 'chip' && p.defId === '7490')!;
// The 4511 uses its own datasheet font (6 without the top bar, 9 without the
// bottom tail) — NOT the K-map lab's classic font. Oracle = chip glyph table.
const GLYPHS = getChipDef('4511')!.glyphs!;
const glyph = (d: number): Record<string, boolean> => {
  const g = GLYPHS[d] ?? '0000000';
  return Object.fromEntries([...('abcdefg' as const)].map((s, i) => [s, g[i] === '1']));
};
const matches = (states: Record<string, { lit: boolean }>, d: number) => {
  const want = glyph(d);
  return (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).every(
    (s) => !!want[s] === !!states[s]?.lit,
  );
};

const seen = new Set<number>();
let decodeOk = true, decodeLog = '';
for (let i = 0; i < 24; i++) {
  const out = sim.step(250); // 555 @1 Hz toggles every 500 ms → count advances each 2 steps
  const count = out.result.counterValues.get(C90.id) ?? 0;
  seen.add(count);
  const segs = out.result.segStates.get(SEV.id);
  if (!segs || !matches(segs, count)) {
    decodeOk = false;
    decodeLog += ` [t=${i} count=${count} segs=${segs ? Object.entries(segs).filter(([, v]) => v.lit).map(([k]) => k).join('') : 'none'}]`;
  }
}
ok(seen.size >= 6, `counter visits ≥6 distinct values (saw ${[...seen].sort((a, b) => a - b).join(',')})`);
ok(decodeOk, `display always decodes the counter value (4511 datasheet font)${decodeLog}`);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
