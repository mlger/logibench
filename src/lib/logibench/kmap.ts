import type { KMapSpec, MinTerm } from './types';

/**
 * K-map / Quine–McCluskey minimization for the decoder design lab (plan §3.3).
 * 4 variables: W X Y Z (W = MSB = D, … Z = LSB = A in BCD pin terms).
 */

const VARS = ['W', 'X', 'Y', 'Z'] as const;

/** Gray-code order for 4-variable K-map rows/cols: W X on rows, Y Z on cols. */
export const KMAP_ROWS = [0b00, 0b01, 0b11, 0b10]; // W X
export const KMAP_COLS = [0b00, 0b01, 0b11, 0b10]; // Y Z

function coveredTerm(term: number, mask: number, code: number): boolean {
  return (code & ~mask) === (term & ~mask);
}

/** All implicants covering only allowed cells. */
function allImplicants(allowed: number[]): { term: number; mask: number }[] {
  const out: { term: number; mask: number }[] = [];
  // implicant = (base, mask): covers every code whose masked projection == base
  for (let base = 0; base < 16; base++) {
    for (let mask = 0; mask < 16; mask++) {
      if ((base & mask) !== 0) continue;
      const covers: number[] = [];
      let ok = true;
      for (let bit = 0; bit < 16; bit++) {
        if ((bit & ~mask) === base) {
          covers.push(bit);
          if (!allowed.includes(bit)) { ok = false; break; }
        }
      }
      if (ok && covers.length) out.push({ term: base, mask });
    }
  }
  // dedupe
  const seen = new Set<string>();
  return out.filter((im) => {
    const k = `${im.term}/${im.mask}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Greedy exact-ish cover: prefer largest implicants (classic QM prime selection). */
export function minimize(cells: (0 | 1 | 'X')[]): MinTerm[] {
  const ones: number[] = [];
  const dcs: number[] = [];
  cells.forEach((v, i) => {
    if (v === 1) ones.push(i);
    else if (v === 'X') dcs.push(i);
  });
  if (!ones.length) return [];
  const allowed = [...ones, ...dcs];
  // Prefer LARGER groups first: more eliminated variables (popcount of mask)
  // = fewer literals per term. (Single-cell implicants have mask 0 → last.)
  const imps = allImplicants(allowed)
    .map((im) => ({ ...im, size: popcount(im.mask) }))
    .sort((a, b) => b.size - a.size);

  const uncovered = new Set(ones);
  const chosen: { term: number; mask: number }[] = [];
  // greedy set cover (optimal for 4 vars in practice)
  for (const im of imps) {
    if (uncovered.size === 0) break;
    const covers = [...uncovered].filter((m) => coveredTerm(im.term, im.mask, m));
    if (covers.length === 0) continue;
    // only keep if it covers at least one still-uncovered ONE
    const coversOne = covers.some((m) => ones.includes(m));
    if (!coversOne) continue;
    chosen.push(im);
    for (const m of covers) uncovered.delete(m);
  }
  // remove redundant implicants
  const essential = chosen.filter((im, i) => {
    const others = chosen.filter((_, j) => j !== i);
    return ones.some((m) => !others.some((o) => coveredTerm(o.term, o.mask, m)));
  });
  return (essential.length ? essential : chosen).map(toMinTerm);
}

function popcount(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

export function toMinTerm(im: { term: number; mask: number }): MinTerm {
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const bit = 3 - i; // W is bit 3
    if ((im.mask >> bit) & 1) continue;
    const v = (im.term >> bit) & 1;
    parts.push(v ? VARS[i] : `${VARS[i]}′`);
  }
  return {
    cover: [],
    mask: im.mask,
    sop: parts.length ? parts.join('·') : '1',
  };
}

/** Number of gates needed for an SOP: (AND per term) + 1 OR + inverters for complemented vars. */
export interface GateListEntry {
  chip: string;
  qty: number;
  purpose: string;
}

export function sopToGates(terms: MinTerm[], invertersAvailable = true): GateListEntry[] {
  const gates: GateListEntry[] = [];
  let inCount = 0;
  const needInvert = new Set<string>();
  for (const t of terms) {
    const literals = t.sop.split('·');
    if (t.sop === '1') continue; // wire to VCC
    literals.forEach((l) => { if (l.includes('′')) needInvert.add(l); });
    if (literals.length > 1) inCount++;
    // single-literal term needs no AND gate (just a wire)
  }
  if (inCount) {
    if (inCount <= 4) gates.push({ chip: '7408', qty: Math.ceil(inCount / 4), purpose: `${inCount} × AND (quad)` });
    else if (inCount <= 9) gates.push({ chip: '7408', qty: Math.ceil(inCount / 4), purpose: `${inCount} × AND` });
    else gates.push({ chip: '7408', qty: Math.ceil(inCount / 4), purpose: `${inCount} × AND` });
  }
  if (terms.length > 1 && terms.some((t) => t.sop !== '1')) {
    gates.push({ chip: '7432', qty: Math.ceil((terms.length - 1) / 4), purpose: `${terms.length - 1} × OR (quad)` });
  }
  if (invertersAvailable && needInvert.size) {
    gates.push({ chip: '7404', qty: Math.ceil(needInvert.size / 6), purpose: `${needInvert.size} × NOT (hex)` });
  }
  return gates;
}

/** NAND-only realization count: each AND-OR becomes NAND-NAND. */
export function sopToNandGates(terms: MinTerm[]): GateListEntry[] {
  const gates: GateListEntry[] = [];
  const andTerms = terms.filter((t) => t.sop !== '1').length;
  const inCount = andTerms;
  if (inCount) {
    if (inCount <= 4) gates.push({ chip: '7400', qty: Math.ceil(inCount / 4), purpose: `${inCount} × 2-in NAND (1st rank)` });
    else if (inCount <= 12) gates.push({ chip: '7400', qty: Math.ceil(inCount / 4), purpose: `${inCount} × 2-in NAND (1st rank)` });
  }
  if (andTerms > 1) {
    gates.push({ chip: '7430', qty: 1, purpose: `${andTerms}-input NAND (2nd rank — 7430 when ≤8 inputs, else 7400/7410/7420)` });
  }
  return gates;
}

/** Default K-map cells per segment from the classic equations (plan §4.6). */
export function defaultCellsFor(segment: 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g', classic: (0 | 1 | 'X')[]): (0 | 1 | 'X')[] {
  return [...classic];
}
