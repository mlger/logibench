import type { Family } from './types';

/**
 * Part number normalization: "SN74LS47N" -> base "7447", family "LS".
 * "CD4511BE" -> "4511" / CD4000. "NE555P" -> "555" / NE555.
 * "MM74HCT138N" -> "138"? No: base keeps full "74138"/"4511" style.
 */
export interface ParsedPart {
  base: string; // e.g. "7447", "4511", "555"
  family: Family;
  clean: string; // upper-cased alnum only
}

const FAMILY_PATTERNS: [RegExp, Family][] = [
  [/HCT/, 'HCT'],
  [/HC(T)?/, 'HC'],
  [/^CD4/, 'CD4000'],
  [/LS/, 'LS'],
  [/^NE5/, 'NE555'],
  [/^SA5|^SE5|^LM5|^TLC5/, 'generic'],
];

export function parsePartNumber(raw: string): ParsedPart {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let family: Family = 'generic';
  for (const [re, fam] of FAMILY_PATTERNS) {
    if (re.test(clean)) {
      family = fam;
      break;
    }
  }
  let base = '';
  // CD4511 / NE555 style
  if (/^CD?4511|^4511/.test(clean)) base = '4511';
  else if (/NE555|^(SA|SE|LM)?555/.test(clean)) base = '555';
  else {
    // 74-series: optional vendor prefix, "74", optional family letters, device digits
    const m = clean.match(/^.*?74[A-Z]{0,4}(\d{1,4})/);
    if (m) {
      const digits = m[1];
      // 74HC4511-style 4-digit CMOS numbers keep their own base
      base = /^\d{4}$/.test(digits) && digits[0] === '4' ? digits : `74${digits}`;
    } else {
      const nums = clean.match(/\d{2,4}/g) ?? [];
      base = nums[nums.length - 1] ?? clean;
    }
  }
  return { base: base || clean, family, clean };
}

/** Whether candidate can fill a slot that calls for `wanted` (same base). */
export function canSubstitute(
  wanted: Family,
  have: Family,
): { ok: boolean; level: 'exact' | 'ok' | 'warn' | 'no' } {
  if (wanted === have) return { ok: true, level: 'exact' };
  if (wanted === 'LS' && have === 'HCT') return { ok: true, level: 'ok' };
  if (wanted === 'LS' && have === 'HC')
    return { ok: true, level: 'warn' }; // VOH/VIH margin issue
  if (wanted === 'HC' && have === 'HCT') return { ok: true, level: 'ok' };
  if (wanted === 'HCT' && have === 'HC') return { ok: true, level: 'ok' };
  if ((wanted === 'HC' || wanted === 'HCT') && have === 'CD4000')
    return { ok: true, level: 'warn' };
  if (wanted === 'CD4000' && (have === 'HC' || have === 'HCT'))
    return { ok: true, level: 'warn' };
  return { ok: false, level: 'no' };
}
