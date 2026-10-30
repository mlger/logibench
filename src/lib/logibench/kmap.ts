import type { KMapCell, MinTerm } from './types';

/**
 * K-map / Quine–McCluskey minimization for the decoder design lab (plan §3.3).
 * 4 variables: W X Y Z (W = MSB = D, … Z = LSB = A in BCD pin terms).
 * 5 variables: E W X Y Z — E is the new MSB and selects the map plane
 * (minterm index = E<<4 | W X Y Z), the classic two-stacked-4×4-planes layout.
 */

/** Variable names, MSB first, per variable count. */
export const VARS_BY_COUNT: { 4: readonly string[]; 5: readonly string[] } = {
  4: ['W', 'X', 'Y', 'Z'],
  5: ['E', 'W', 'X', 'Y', 'Z'],
};

/**
 * Effective variable names for a mode from the persisted 5-slot array
 * (slot 0 is the 5-var MSB, invisible in 4-var mode).
 */
export function effectiveNames(varNames: readonly string[], n: 4 | 5): readonly string[] {
  return n === 4 ? varNames.slice(1) : varNames;
}

/** Infer the variable count from a cells array (16 → 4 vars, 32 → 5 vars). */
export function varCountOf(cells: readonly KMapCell[]): 4 | 5 {
  return cells.length >= 32 ? 5 : 4;
}

/**
 * MSB-first input bits of a minterm, matching the store's encoding
 * (4 vars: W X Y Z; 5 vars: E W X Y Z; bit = n - 1 - i convention).
 * Used by truth-table views that label each row with its binary input code.
 */
export function mintermInputs(code: number, n: 4 | 5): (0 | 1)[] {
  const out: (0 | 1)[] = [];
  for (let i = 0; i < n; i++) {
    const bit = n - 1 - i; // MSB first (W is bit 3 in 4-var; E is bit 4 in 5-var)
    out.push(((code >> bit) & 1) as 0 | 1);
  }
  return out;
}

/** Gray-code order for 4-variable K-map rows/cols: W X on rows, Y Z on cols. */
export const KMAP_ROWS = [0b00, 0b01, 0b11, 0b10]; // W X
export const KMAP_COLS = [0b00, 0b01, 0b11, 0b10]; // Y Z

function coveredTerm(term: number, mask: number, code: number): boolean {
  return (code & ~mask) === (term & ~mask);
}

/** All implicants covering only allowed cells (n = 4 or 5 variables). */
function allImplicants(allowed: ReadonlySet<number>, n: 4 | 5): { term: number; mask: number }[] {
  const out: { term: number; mask: number }[] = [];
  const size = 1 << n;
  // implicant = (base, mask): covers every code whose masked projection == base.
  // (base & mask) === 0 keeps the pair well-formed; every such pair covers at
  // least `base` itself, and pairs are unique by construction — no dedupe needed.
  for (let base = 0; base < size; base++) {
    for (let mask = 0; mask < size; mask++) {
      if ((base & mask) !== 0) continue;
      let ok = true;
      for (let bit = 0; bit < size; bit++) {
        if ((bit & ~mask) === base && !allowed.has(bit)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ term: base, mask });
    }
  }
  return out;
}

function popcount(n: number): number {
  let c = 0;
  while (n) { c += n & 1; n >>= 1; }
  return c;
}

/**
 * Greedy cover (largest implicants first) + sequential redundancy pruning.
 *
 * The pruning pass drops a chosen implicant only if the REMAINING set still
 * covers every 1-cell. (An earlier "keep only essential primes" batch filter
 * removed all individually-redundant implicants at once — two of them can be
 * jointly required, which left 1-cells uncovered and produced an SOP that did
 * not match the map.)
 *
 * `names` labels the variables in the resulting literal strings; the default
 * keeps the classic W X Y Z / E W X Y Z naming (callers may pass user-renamed
 * labels — renaming is pure relabeling, it never changes the cover).
 */
export function minimize(
  cells: KMapCell[],
  names: readonly string[] = VARS_BY_COUNT[varCountOf(cells)],
): MinTerm[] {
  const n = varCountOf(cells);
  const ones: number[] = [];
  const allowed = new Set<number>();
  cells.forEach((v, i) => {
    if (v === 1) {
      ones.push(i);
      allowed.add(i);
    } else if (v === 'X') {
      allowed.add(i);
    }
  });
  if (!ones.length) return [];
  // Prefer LARGER groups first: more eliminated variables (popcount of mask)
  // = fewer literals per term. (Single-cell implicants have mask 0 → last.)
  const imps = allImplicants(allowed, n).sort(
    (a, b) => popcount(b.mask) - popcount(a.mask) || a.term - b.term || a.mask - b.mask,
  );

  const uncovered = new Set(ones);
  const chosen: { term: number; mask: number }[] = [];
  for (const im of imps) {
    if (uncovered.size === 0) break;
    let covers = false;
    for (const m of uncovered) {
      if (coveredTerm(im.term, im.mask, m)) {
        covers = true;
        break;
      }
    }
    if (!covers) continue;
    chosen.push(im);
    for (const m of uncovered) {
      if (coveredTerm(im.term, im.mask, m)) uncovered.delete(m);
    }
  }
  // Sequential redundancy pruning: remove an implicant only while the rest of
  // the cover still reaches every 1-cell (guarantees a valid cover).
  const kept = [...chosen];
  for (const im of chosen) {
    const idx = kept.indexOf(im);
    if (idx < 0) continue;
    const others = kept.filter((_, j) => j !== idx);
    const redundant = ones.every((m) => others.some((o) => coveredTerm(o.term, o.mask, m)));
    if (redundant) kept.splice(idx, 1);
  }
  return kept.map((im) => toMinTerm(im, n, names));
}

export function toMinTerm(
  im: { term: number; mask: number },
  n: 4 | 5 = 4,
  names: readonly string[] = VARS_BY_COUNT[n],
): MinTerm {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const bit = n - 1 - i; // MSB first (W is bit 3 in 4-var; E is bit 4 in 5-var)
    if ((im.mask >> bit) & 1) continue;
    const v = (im.term >> bit) & 1;
    const name = names[i] ?? VARS_BY_COUNT[n][i];
    parts.push(v ? name : `${name}′`);
  }
  // Every code whose masked projection matches the base — the map cells this
  // term groups (its 1-cells plus the don't-cares it adopted). The loop
  // overlay renders these per plane; hazard/exact-cover modes build on them.
  const covers: number[] = [];
  for (let code = 0; code < 1 << n; code++) {
    if (coveredTerm(im.term, im.mask, code)) covers.push(code);
  }
  return {
    term: im.term,
    mask: im.mask,
    covers,
    literals: parts,
    sop: parts.length ? parts.join('·') : '1',
  };
}

/** Number of gates needed for an SOP: AND per multi-literal term (2-input
 *  gates cascaded for wider terms) + one OR rank + inverters for complemented
 *  literals. Single-literal terms are plain wires into the OR. */
export interface GateListEntry {
  chip: string;
  qty: number;
  purpose: string;
}

export function sopToGates(terms: MinTerm[], invertersAvailable = true): GateListEntry[] {
  const gates: GateListEntry[] = [];
  const needInvert = new Set<string>();
  let productTerms = 0; // terms feeding the OR
  let andGates = 0; // 2-input AND gates needed (k-literal term → k-1 gates)
  let wideTerms = 0; // terms with more than 2 literals
  for (const t of terms) {
    if (t.literals.length === 0) continue; // constant 1 — wire to VCC
    const literals = t.literals;
    literals.forEach((l) => {
      if (l.includes('′')) needInvert.add(l);
    });
    productTerms++;
    if (literals.length > 1) {
      andGates += literals.length - 1;
      if (literals.length > 2) wideTerms++;
    }
    // single-literal term needs no AND gate (just a wire)
  }
  if (andGates) {
    gates.push({
      chip: '7408',
      qty: Math.ceil(andGates / 4),
      purpose: wideTerms
        ? `${andGates} × 2-input AND — ${wideTerms} term${wideTerms > 1 ? 's' : ''} wider than 2 inputs: cascade 2-input gates (a 7411/7421 covers it in one gate)`
        : `${andGates} × 2-input AND (one per multi-literal term)`,
    });
  }
  if (productTerms > 1) {
    gates.push({
      chip: '7432',
      qty: Math.ceil((productTerms - 1) / 4),
      purpose: `${productTerms - 1} × 2-input OR`,
    });
  }
  if (invertersAvailable && needInvert.size) {
    gates.push({
      chip: '7404',
      qty: Math.ceil(needInvert.size / 6),
      purpose: `${needInvert.size} × NOT (hex) — complemented literals`,
    });
  }
  return gates;
}

/**
 * NAND-only realization count (AND–OR becomes NAND–NAND):
 * 1st rank = one k-input NAND per product term (k = literals; wider than 2
 * inputs cascades 2-in NANDs: 2k−3 gates). 2nd rank = one NAND combining all
 * T product terms (7430 handles ≤ 8 inputs). Inverters are 7400 gates with
 * both inputs tied, so they share the 7400 chip count.
 */
export function sopToNandGates(terms: MinTerm[]): GateListEntry[] {
  const gates: GateListEntry[] = [];
  const productTerms: string[][] = [];
  for (const t of terms) {
    if (t.literals.length === 0) continue; // wire to VCC — NAND-NAND degenerates
    productTerms.push(t.literals);
  }
  if (!productTerms.length) return gates;
  const rank2 = productTerms.length;

  const invertVars = new Set<string>(); // signals needed in complemented form
  let firstRank = 0; // 2-input NAND gates for rank 1
  let wideTerms = 0;
  for (const literals of productTerms) {
    if (literals.length === 1) {
      const l = literals[0];
      if (rank2 > 1) {
        // 2nd rank needs the complement of this term: X′ → X is a wire,
        // W → W′ needs an inverter.
        if (!l.includes('′')) invertVars.add(l);
      } else if (l.includes('′')) {
        // single complemented literal IS the whole expression → one inverter
        invertVars.add(l);
      }
      continue;
    }
    literals.forEach((l) => {
      if (l.includes('′')) invertVars.add(l);
    });
    firstRank += 2 * literals.length - 3; // k=2 → 1 gate, k=3 → 3, k=4 → 5
    if (literals.length > 2) wideTerms++;
  }

  const totalNand = firstRank + invertVars.size;
  if (totalNand) {
    const parts: string[] = [];
    if (firstRank) parts.push(`${firstRank} rank-1 (one per product term)`);
    if (invertVars.size) parts.push(`${invertVars.size} tied-input inverter${invertVars.size > 1 ? 's' : ''}`);
    gates.push({
      chip: '7400',
      qty: Math.ceil(totalNand / 4),
      purpose: `2-input NAND: ${parts.join(' + ')}${
        wideTerms
          ? ` — ${wideTerms} term${wideTerms > 1 ? 's' : ''} wider than 2 inputs: cascade (or 7410/7420 wide NANDs)`
          : firstRank
            ? ' (one per product term)'
            : ''
      }`,
    });
  }
  if (rank2 > 1) {
    if (rank2 <= 8) {
      gates.push({
        chip: '7430',
        qty: 1,
        purpose: `${rank2}-input NAND, 2nd rank (combines the product terms)`,
      });
    } else {
      gates.push({
        chip: '7430',
        qty: Math.ceil(rank2 / 8),
        purpose: `${rank2} product terms — beyond one 7430: NAND groups of ≤8 inputs, invert, combine with a final NAND`,
      });
    }
  }
  return gates;
}
