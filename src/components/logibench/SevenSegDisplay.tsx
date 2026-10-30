'use client';

/**
 * LogicBench PH — seven-segment display (docs/kmap-lab-presets-vars-preview-plan.md §6.1).
 *
 * A pure SVG rendering of the classic a–g bar layout used by the decoder
 * preview card and the preset menu's digit chips. Bar states reuse the K-map
 * legend's visual language: 1 = lit amber with a soft glow, 0 = off stone,
 * X = don't-care as a dim amber bar with a dashed edge ("might be lit").
 *
 * Geometry: 220×380 viewBox, 26-unit bar thickness, hexagon segments with a
 * 12-unit bevel; vertical bars are trimmed 8 units short of the horizontal
 * bars so the corners stay open (classic display look). Optional a–g letters
 * sit outside each bar.
 *
 * Accessibility: role="img" with a value-complete aria-label — deliberately
 * NO live region, because hover updates would spam screen readers (the SOP
 * card's polite region already announces edit results).
 */

import type { KMapCell } from '@/lib/logibench/types';
import type { SegKey } from '@/store/kmapStore';

const SEGS: SegKey[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

const T = 26; // bar thickness
const BEVEL = 12; // hexagon tip cut

/** Horizontal hexagon segment at (x, y), w wide, t thick. */
function hSeg(x: number, y: number, w: number, t: number): string {
  const m = y + t / 2;
  return [
    `${x + BEVEL},${y}`,
    `${x + w - BEVEL},${y}`,
    `${x + w},${m}`,
    `${x + w - BEVEL},${y + t}`,
    `${x + BEVEL},${y + t}`,
    `${x},${m}`,
  ].join(' ');
}

/** Vertical hexagon segment at (x, y), h tall, t thick. */
function vSeg(x: number, y: number, h: number, t: number): string {
  const m = x + t / 2;
  return [
    `${x},${y + BEVEL}`,
    `${m},${y}`,
    `${x + t},${y + BEVEL}`,
    `${x + t},${y + h - BEVEL}`,
    `${m},${y + h}`,
    `${x},${y + h - BEVEL}`,
  ].join(' ');
}

/** Segment polygons (plan §6.1 starting geometry — tuned by eye). */
const SEG_POINTS: Record<SegKey, string> = {
  a: hSeg(30, 20, 160, T),
  g: hSeg(30, 175, 160, T),
  d: hSeg(30, 330, 160, T),
  f: vSeg(30, 54, 113, T),
  b: vSeg(164, 54, 113, T),
  e: vSeg(30, 209, 113, T),
  c: vSeg(164, 209, 113, T),
};

/** Letter label positions outside each bar. */
const LABEL_POS: Record<SegKey, { x: number; y: number; anchor: 'start' | 'middle' | 'end' }> = {
  a: { x: 110, y: 14, anchor: 'middle' },
  b: { x: 202, y: 114, anchor: 'start' },
  c: { x: 202, y: 269, anchor: 'start' },
  d: { x: 110, y: 374, anchor: 'middle' },
  e: { x: 18, y: 269, anchor: 'end' },
  f: { x: 18, y: 114, anchor: 'end' },
  g: { x: 18, y: 192, anchor: 'end' },
};

export interface SevenSegDisplayProps {
  /** per-segment value: 1 lit, 0 off, X don't-care */
  states: Record<SegKey, KMapCell>;
  /** sm fits inside preset digit chips; md is the preview-card size */
  size?: 'sm' | 'md';
  /** tiny a–g letters beside each bar (teaches the letter↔bar mapping) */
  showLabels?: boolean;
}

export default function SevenSegDisplay({
  states,
  size = 'md',
  showLabels = true,
}: SevenSegDisplayProps) {
  const lit = SEGS.filter((s) => states[s] === 1);
  const off = SEGS.filter((s) => states[s] === 0);
  const care = SEGS.filter((s) => states[s] === 'X');
  const label =
    `Seven-segment display — lit: ${lit.join(', ') || 'none'}; ` +
    `off: ${off.join(', ') || 'none'}; don't-care: ${care.join(', ') || 'none'}.`;

  return (
    <div className={size === 'sm' ? 'w-9' : 'w-32 md:w-36'}>
      <svg viewBox="0 0 220 380" role="img" aria-label={label} className="h-auto w-full">
        {SEGS.map((s) => {
          const v = states[s];
          return (
            <polygon
              key={s}
              points={SEG_POINTS[s]}
              fill={v === 1 ? '#f59e0b' : v === 'X' ? '#fcd34d' : '#e7e5e4'}
              fillOpacity={v === 'X' ? 0.35 : 1}
              stroke={v === 'X' ? '#d97706' : undefined}
              strokeWidth={v === 'X' ? 1.5 : undefined}
              strokeDasharray={v === 'X' ? '7 5' : undefined}
              strokeLinejoin="round"
              style={
                v === 1 ? { filter: 'drop-shadow(0 0 5px rgba(245, 158, 11, 0.6))' } : undefined
              }
            />
          );
        })}
        {showLabels &&
          SEGS.map((s) => (
            <text
              key={`label-${s}`}
              x={LABEL_POS[s].x}
              y={LABEL_POS[s].y}
              textAnchor={LABEL_POS[s].anchor}
              fontSize={13}
              className="fill-stone-400 font-mono"
            >
              {s}
            </text>
          ))}
      </svg>
    </div>
  );
}
