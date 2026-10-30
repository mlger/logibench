/** E12 / E24 preferred resistor series + nearest-value lookup. */

export const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [
  1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1,
  5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

export function seriesValues(series: number[]): number[] {
  const out: number[] = [];
  for (let dec = 0; dec <= 6; dec++) {
    for (const v of series) out.push(Math.round(v * 10 ** dec));
  }
  return out;
}

export function nearestESeries(ohms: number, series: 'E12' | 'E24' = 'E24'): number {
  const vals = seriesValues(series === 'E12' ? E12 : E24);
  let best = vals[0];
  let bestErr = Infinity;
  for (const v of vals) {
    const err = Math.abs(v - ohms);
    if (err < bestErr) {
      bestErr = err;
      best = v;
    }
  }
  return best;
}

/** 4-band resistor color code (significant, significant, multiplier, gold). */
const BANDS = [
  'black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey',
  'white',
] as const;

export function resistorBands(ohms: number): {
  bands: [string, string, string, string];
} {
  if (ohms <= 0) ohms = 1;
  let mantissa = ohms;
  let mult = 0;
  while (mantissa >= 10) {
    mantissa /= 10;
    mult++;
  }
  while (mantissa < 1) {
    mantissa *= 10;
    mult--;
  }
  const d1 = Math.floor(mantissa);
  const d2 = Math.round((mantissa - d1) * 10) % 10;
  const name = (d: number) => BANDS[Math.max(0, Math.min(9, d))];
  return { bands: [name(d1), name(d2), BANDS[Math.max(0, Math.min(9, mult))], 'gold'] };
}

export function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${strip(ohms / 1e6)} MΩ`;
  if (ohms >= 1000) return `${strip(ohms / 1000)} kΩ`;
  return `${strip(ohms)} Ω`;
}

function strip(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
