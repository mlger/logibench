/**
 * Regression sweep over all three golden demos (the 7490 cascaded-edge lesson:
 * a counter that only ever shows 0↔1 must fail here, loudly).
 *
 * For each demo: ERC must be error-free, the 7490 must sweep a full decade
 * 0..9, and the 7-segment display must match the 4511 glyph table at every
 * sampled step. Lab 1 is a static circuit — ERC-clean is the bar.
 *
 * Run: bun scripts/audit/labs-regression.ts
 */
import { demo4511, demo7447, demoTwoBoard } from '@/lib/logibench/demo';
import { Simulator } from '@/lib/logibench/sim';
import { getChipDef } from '@/data/chips';

let fail = 0;
for (const [name, proj] of [['Lab1', demo7447()], ['Lab2', demo4511()], ['Lab3', demoTwoBoard()]] as const) {
  const sim = new Simulator(proj);
  const first = sim.compute();
  const errs = first.result.issues.filter((i) => i.severity === 'error');
  const c90 = proj.parts.find((p) => p.type === 'chip' && p.defId === '7490');
  const sev = proj.parts.find((p) => p.type === 'seg7');
  if (name === 'Lab1') {
    console.log(`Lab1: errors=${errs.length}`);
    if (errs.length !== 0) { fail++; console.log('  ✗ Lab1 has ERC errors'); }
    continue;
  }
  const GL = getChipDef('4511')!.glyphs!;
  const seen = new Set<number>();
  let decodeBad = 0;
  for (let i = 0; i < 48; i++) {
    const out = sim.step(250);
    if (!c90 || !sev) break;
    const count = out.result.counterValues.get(c90.id) ?? 0;
    seen.add(count);
    const segs = out.result.segStates.get(sev.id);
    if (!segs) { decodeBad++; continue; }
    const g = GL[count] ?? '0000000';
    const okD = (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).every((s, k) => !!segs[s]?.lit === (g[k] === '1'));
    if (!okD) decodeBad++;
  }
  const counts = [...seen].sort((a, b) => a - b).join(',');
  console.log(`${name}: errors=${errs.length} distinctCounts=${seen.size} [${counts}] decodeBad=${decodeBad}`);
  if (errs.length !== 0) { fail++; console.log(`  ✗ ${name} ERC errors: ${errs.map((e) => e.title).join('; ')}`); }
  if (seen.size < 10) { fail++; console.log(`  ✗ ${name} counter never completes a decade`); }
  if (decodeBad !== 0) { fail++; console.log(`  ✗ ${name} display mismatched the counter on ${decodeBad} steps`); }
}
console.log(fail === 0 ? 'ALL OK' : `${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
