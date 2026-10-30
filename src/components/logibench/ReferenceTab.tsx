'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  ExternalLink,
  Lightbulb,
  Search,
} from 'lucide-react';

import { CHIP_DEFS, FAMILIES, SEG7_GUIDE, SEG7_PINOUT } from '@/data/chips';
import type { ChipDef, Family, PinDef } from '@/lib/logibench/types';
import { formatOhms, nearestESeries, resistorBands } from '@/lib/logibench/eseries';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/* ---------------- Design constants ---------------- */

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const DIR_COLOR: Record<PinDef['dir'], string> = {
  in: '#059669', // emerald-600
  out: '#d97706', // amber-600
  io: '#7c3aed', // violet-600
  pwr: '#dc2626', // red-600
  gnd: '#1c1917', // stone-900
  nc: '#d6d3d1', // stone-300
};

const DIR_LABEL: Record<PinDef['dir'], string> = {
  in: 'input',
  out: 'output',
  io: 'input/output',
  pwr: 'power (VCC)',
  gnd: 'ground',
  nc: 'no connect',
};

const OUTPUT_LABEL: Record<NonNullable<PinDef['output']>, string> = {
  'push-pull': 'push-pull',
  'open-collector': 'open-collector',
  'pullup-oc': 'pull-up open-collector',
  'weak-pullup': 'weak pull-up',
};

const ROLE_LABEL: Record<NonNullable<PinDef['role']>, string> = {
  lt: 'lamp test',
  bi: 'blanking',
  rbi: 'ripple-blanking',
  le: 'latch enable',
  reset: 'reset',
  set9: 'set-to-9',
  clock: 'clock',
  enable: 'enable',
};

const FLOAT_LABEL: Record<0 | 1 | 'X', string> = {
  0: 'LOW',
  1: 'HIGH (TTL)',
  X: 'X — undefined',
};

const FAM_ROWS: Family[] = ['LS', 'HC', 'HCT', 'CD4000'];

const STD_POWER: Record<ChipDef['package'], [number, number]> = {
  DIP8: [8, 1],
  DIP14: [14, 7],
  DIP16: [16, 8],
};

const BAND_CSS: Record<string, string> = {
  black: '#1c1917',
  brown: '#7b3f00',
  red: '#dc2626',
  orange: '#ea580c',
  yellow: '#eab308',
  green: '#16a34a',
  blue: '#2563eb',
  violet: '#7c3aed',
  grey: '#a8a29e',
  white: '#ffffff',
  gold: '#c9a227',
};

const BAND_DIGIT: Record<string, number> = {
  black: 0,
  brown: 1,
  red: 2,
  orange: 3,
  yellow: 4,
  green: 5,
  blue: 6,
  violet: 7,
  grey: 8,
  white: 9,
};

/* ---------------- Helpers ---------------- */

function fmtNum(n: number): string {
  return String(n).replace('-', '−');
}

function describePin(p: PinDef): string {
  const parts: string[] = [DIR_LABEL[p.dir]];
  if (p.activeLow) parts.push('active-LOW');
  if (p.output) parts.push(OUTPUT_LABEL[p.output]);
  if (p.role) parts.push(ROLE_LABEL[p.role]);
  return parts.join(', ');
}

function bandTitle(band: string, idx: number): string {
  if (band === 'gold') return 'gold — ±5% tolerance';
  const d = BAND_DIGIT[band] ?? 0;
  return idx === 2 ? `${band} — ×${10 ** d}` : `${band} — ${d}`;
}

/* ---------------- 7-segment digit geometry ---------------- */

function hseg(cx: number, cy: number, l: number, t: number): string {
  const h = t / 2;
  return [
    `${cx - l / 2},${cy}`,
    `${cx - l / 2 + h},${cy - h}`,
    `${cx + l / 2 - h},${cy - h}`,
    `${cx + l / 2},${cy}`,
    `${cx + l / 2 - h},${cy + h}`,
    `${cx - l / 2 + h},${cy + h}`,
  ].join(' ');
}

function vseg(cx: number, cy: number, l: number, t: number): string {
  const h = t / 2;
  return [
    `${cx},${cy - l / 2}`,
    `${cx + h},${cy - l / 2 + h}`,
    `${cx + h},${cy + l / 2 - h}`,
    `${cx},${cy + l / 2}`,
    `${cx - h},${cy + l / 2 - h}`,
    `${cx - h},${cy - l / 2 + h}`,
  ].join(' ');
}

const SEG_ORDER = 'abcdefg';
const SEG_POLY: Record<string, string> = {
  a: hseg(18, 4, 20, 5),
  b: vseg(31, 13.5, 15, 5),
  c: vseg(31, 48.5, 15, 5),
  d: hseg(18, 58, 20, 5),
  e: vseg(5, 48.5, 15, 5),
  f: vseg(5, 13.5, 15, 5),
  g: hseg(18, 31, 20, 5),
};

function Seg7Digit({ glyph }: { glyph: string }) {
  return (
    <svg viewBox="0 0 36 62" className="h-10 w-auto shrink-0" aria-hidden="true" focusable="false">
      {SEG_ORDER.split('').map((s, i) => (
        <polygon key={s} points={SEG_POLY[s]} fill={glyph[i] === '1' ? '#f59e0b' : '#e7e5e4'} />
      ))}
    </svg>
  );
}

/* ---------------- DIP pinout diagram ---------------- */

function DipPinout({ def }: { def: ChipDef }) {
  const [sel, setSel] = useState<number | null>(null);
  const side = def.pins.length / 2;
  const rowH = 26;
  const bodyTop = 16;
  const bodyH = side * rowH + 40;
  const vbH = bodyTop + bodyH + 16;
  const pinY = (i: number) => bodyTop + 33 + i * rowH;

  const left = def.pins.slice(0, side);
  const right = def.pins.slice(side); // index 0 = lowest pin number on the right (bottom row)
  const selPin = sel != null ? def.pins.find((p) => p.num === sel) : undefined;
  const nonStdPower =
    def.power.vcc !== STD_POWER[def.package][0] || def.power.gnd !== STD_POWER[def.package][1];

  const renderPin = (p: PinDef, i: number, which: 'left' | 'right') => {
    const y = which === 'left' ? pinY(i) : pinY(side - 1 - i);
    const bare = p.name.replace(/\u0305/g, '');
    const overline = p.activeLow === true || bare !== p.name;
    const nameW = bare.length * 6.6;
    const textX = which === 'left' ? 94 : 206;
    const numX = which === 'left' ? 78 : 222;
    const leadX = which === 'left' ? 40 : 230;
    const bandX = which === 'left' ? 34 : 154;
    const lineX1 = which === 'left' ? textX : textX - nameW;
    const lineX2 = which === 'left' ? textX + nameW : textX;
    const anchor = which === 'left' ? 'start' : 'end';
    const selected = sel === p.num;
    return (
      <g
        key={p.num}
        role="button"
        tabIndex={0}
        aria-label={`Pin ${p.num}: ${p.name} — ${describePin(p)}`}
        aria-pressed={selected}
        className="cursor-pointer outline-none focus-visible:opacity-70"
        onClick={() => setSel(p.num)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSel(p.num);
          }
        }}
      >
        {selected && (
          <rect
            x={bandX}
            y={y - 11}
            width={112}
            height={22}
            rx={4}
            fill="#fbbf24"
            opacity={0.3}
            stroke="#f59e0b"
            strokeOpacity={0.5}
            pointerEvents="none"
          />
        )}
        <rect x={leadX} y={y - 3} width={30} height={6} rx={2} fill="#d6d3d1" />
        {overline && (
          <line
            x1={lineX1}
            y1={y - 6.5}
            x2={lineX2}
            y2={y - 6.5}
            stroke={DIR_COLOR[p.dir]}
            strokeWidth={1.2}
          />
        )}
        <text
          x={numX}
          y={y + 3.5}
          textAnchor={anchor}
          fontSize={10}
          fontFamily={MONO}
          fontWeight={700}
          fill="#78716c"
        >
          {p.num}
        </text>
        <text
          x={textX}
          y={y + 4}
          textAnchor={anchor}
          fontSize={11}
          fontFamily={MONO}
          fontWeight={600}
          fill={DIR_COLOR[p.dir]}
        >
          {bare}
        </text>
        <rect x={bandX} y={y - 12} width={112} height={24} fill="transparent" />
      </g>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 300 ${vbH}`}
        className="mx-auto w-full max-w-[300px]"
        role="group"
        aria-label={`DIP pinout diagram for ${def.id}`}
      >
        <rect
          x={70}
          y={bodyTop}
          width={160}
          height={bodyH}
          rx={6}
          fill="#f5f5f4"
          stroke="#a8a29e"
          strokeWidth={1.5}
        />
        <path
          d={`M 140 ${bodyTop} A 10 10 0 0 0 160 ${bodyTop}`}
          fill="#ffffff"
          stroke="#a8a29e"
          strokeWidth={1.2}
        />
        <circle cx={78} cy={bodyTop + 11} r={2.5} fill="#a8a29e" />
        <text
          x={150}
          y={bodyTop + bodyH / 2 + 4}
          textAnchor="middle"
          fontSize={12}
          fontFamily={MONO}
          fontWeight={700}
          fill="#d6d3d1"
        >
          {def.id}
        </text>
        {left.map((p, i) => renderPin(p, i, 'left'))}
        {right.map((p, i) => renderPin(p, i, 'right'))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-stone-500">
        {(['in', 'out', 'io', 'pwr', 'gnd', 'nc'] as PinDef['dir'][]).map((d) => (
          <span key={d} className="inline-flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: DIR_COLOR[d] }}
            />
            {DIR_LABEL[d]}
          </span>
        ))}
      </div>

      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
        {selPin ? (
          <span className="font-mono text-stone-700">
            Pin {selPin.num} — {selPin.name} — {describePin(selPin)}
          </span>
        ) : (
          <span className="text-stone-400">Click a pin to inspect it.</span>
        )}
      </div>

      {nonStdPower && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Non-standard power: VCC = pin {def.power.vcc}, GND = pin {def.power.gnd} — double-check
          before applying power.
        </p>
      )}
    </div>
  );
}

/* ---------------- Decoder truth table ---------------- */

function DecoderTruthTable({ def }: { def: ChipDef }) {
  const glyphs = def.glyphs;
  if (!glyphs) return null;
  const hasVerify = def.glyphVerify != null && Object.keys(def.glyphVerify).length > 0;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
        Truth table — codes 0–15
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 16 }, (_, code) => {
          const glyph = glyphs[code] ?? '0000000';
          const verify = def.glyphVerify?.[code] === true;
          return (
            <div
              key={code}
              className="flex items-center justify-between gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1"
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="font-mono text-[10px] font-semibold leading-none text-stone-500">
                  {code}
                </span>
                {verify && (
                  <span
                    title="unique symbol — verify against the scanned TI datasheet"
                    className="rounded bg-amber-100 px-1 text-[8px] font-semibold leading-none text-amber-700"
                  >
                    verify
                  </span>
                )}
              </div>
              <Seg7Digit glyph={glyph} />
            </div>
          );
        })}
      </div>
      {hasVerify && (
        <p className="text-[11px] text-stone-500">
          Amber “verify” rows are unique symbols — bench-check them against the scanned TI
          datasheet before trusting them.
        </p>
      )}
    </div>
  );
}

/* ---------------- Chip card ---------------- */

function ChipCard({ def }: { def: ChipDef }) {
  return (
    <Card className="gap-4">
      <CardHeader className="gap-2">
        <div>
          <CardTitle className="font-mono text-base">{def.id}</CardTitle>
          <CardDescription className="mt-1">{def.name}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant="outline"
            className="border-stone-300 font-mono text-[10px] text-stone-600"
          >
            {def.package}
          </Badge>
          {def.families.map((f) => (
            <Badge key={f} variant="secondary" className="bg-stone-100 text-[10px] text-stone-700">
              {f}
            </Badge>
          ))}
          {def.refOnly && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-800"
            >
              reference only
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DipPinout def={def} />

        {def.glyphs && <DecoderTruthTable def={def} />}

        {def.gotchas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Common mistakes
            </h3>
            <ul className="flex flex-col gap-1.5">
              {def.gotchas.map((g) => (
                <li key={g} className="flex items-start gap-1.5 text-sm text-stone-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {def.datasheets.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-stone-500">
              <BookOpen className="size-3.5" />
              Datasheets
            </h3>
            <div className="flex flex-col gap-1">
              {def.datasheets.map((ds) => (
                <a
                  key={ds.url}
                  href={ds.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1.5 text-xs leading-snug text-amber-700 underline decoration-amber-300 underline-offset-2 transition-colors hover:text-amber-800 hover:decoration-amber-500"
                >
                  <ExternalLink className="mt-0.5 size-3 shrink-0" />
                  <span>
                    <span className="font-semibold">{ds.vendor}</span> — {ds.doc}{' '}
                    <span className="text-stone-400">· {ds.rev}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Section a: logic families ---------------- */

function FamiliesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="size-4 text-amber-600" />
          Logic families
        </CardTitle>
        <CardDescription>
          Input/output levels near VCC = 5 V — why LS does not reliably drive HC.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Family</TableHead>
                <TableHead className="text-right">VIH min (V)</TableHead>
                <TableHead className="text-right">VIL max (V)</TableHead>
                <TableHead className="text-right">VOH min (V)</TableHead>
                <TableHead className="text-right">IOL max (mA)</TableHead>
                <TableHead className="text-right">IOH max (mA)</TableHead>
                <TableHead className="text-right">Fanout (LS loads)</TableHead>
                <TableHead>Floats as</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FAM_ROWS.map((f) => {
                const e = FAMILIES[f];
                return (
                  <TableRow key={f}>
                    <TableCell className="font-mono font-semibold">{e.label}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(e.vih)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(e.vil)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(e.voh)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(e.iol)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(e.ioh)}</TableCell>
                    <TableCell className="text-right font-mono">{e.fanout}</TableCell>
                    <TableCell className="font-mono">{FLOAT_LABEL[e.floatReads]}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-1.5">
          {FAM_ROWS.map((f) => (
            <p key={f} className="text-xs leading-snug text-stone-500">
              <span className="font-semibold text-stone-600">{FAMILIES[f].label}:</span>{' '}
              {FAMILIES[f].note}
            </p>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p>
            <span className="font-semibold">
              LS VOH min {FAMILIES.LS.voh} V &lt; HC VIH min {FAMILIES.HC.vih} V — LS→HC is NOT
              guaranteed.
            </span>{' '}
            HCT is the glue family.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Section b: 7-segment displays ---------------- */

const SEG7_TOP: number[] = [1, 2, 3, 4, 5];
const SEG7_BOTTOM: number[] = [10, 9, 8, 7, 6];

function seg7PinColor(name: string): string {
  if (name === 'com') return '#dc2626'; // red-600
  if (name === 'dp') return '#d97706'; // amber-600
  return '#059669'; // emerald-600
}

function Seg7Card() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-amber-600" />
          7-segment displays
        </CardTitle>
        <CardDescription>5161AS / 5161BS 10-pin layout — wiring and resistor practice.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <svg
          viewBox="0 0 320 124"
          className="mx-auto w-full max-w-[320px]"
          role="img"
          aria-label="10-pin seven-segment display pinout: top row pins 1 to 5, bottom row pins 10 to 6"
        >
          <rect
            x={30}
            y={30}
            width={260}
            height={60}
            rx={4}
            fill="#f5f5f4"
            stroke="#a8a29e"
            strokeWidth={1.5}
          />
          <path d="M 30 52 A 8 8 0 0 1 30 68" fill="#ffffff" stroke="#a8a29e" strokeWidth={1.2} />
          <circle cx={44} cy={40} r={2.5} fill="#a8a29e" />
          {SEG7_TOP.map((num, i) => {
            const x = 60 + i * 50;
            const name = SEG7_PINOUT[num];
            return (
              <g key={num}>
                <text x={x} y={9} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="#78716c">
                  {num}
                </text>
                <text
                  x={x}
                  y={20}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily={MONO}
                  fontWeight={700}
                  fill={seg7PinColor(name)}
                >
                  {name}
                </text>
                <rect x={x - 3} y={23} width={6} height={9} fill="#d6d3d1" />
              </g>
            );
          })}
          {SEG7_BOTTOM.map((num, i) => {
            const x = 60 + i * 50;
            const name = SEG7_PINOUT[num];
            return (
              <g key={num}>
                <rect x={x - 3} y={88} width={6} height={9} fill="#d6d3d1" />
                <text
                  x={x}
                  y={110}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily={MONO}
                  fontWeight={700}
                  fill={seg7PinColor(name)}
                >
                  {name}
                </text>
                <text
                  x={x}
                  y={120}
                  textAnchor="middle"
                  fontSize={8}
                  fontFamily={MONO}
                  fill="#78716c"
                >
                  {num}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Part marking
            </h4>
            <p className="text-sm leading-snug text-stone-700">{SEG7_GUIDE.note}</p>
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Forward voltage
            </h4>
            <p className="text-sm leading-snug text-stone-700">{SEG7_GUIDE.vf}</p>
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Series resistors
            </h4>
            <p className="text-sm leading-snug text-stone-700">{SEG7_GUIDE.resistors}</p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p>
            Multimeter tip: in diode mode, probe each segment pin against both commons in both
            orientations — the segments that light identify the common pins and the polarity (CA vs
            CC) in under a minute.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Section c: resistor calculator ---------------- */

function ResistorCard() {
  const [volts, setVolts] = useState('5');
  const [vfStr, setVfStr] = useState('2.0');
  const [maStr, setMaStr] = useState('10');
  const [dropStr, setDropStr] = useState('0.4');

  const v = Number.parseFloat(volts) || 0;
  const vf = Number.parseFloat(vfStr) || 0;
  const ma = Number.parseFloat(maStr) || 0;
  const drop = Number.parseFloat(dropStr) || 0;
  const iA = ma / 1000;
  const budget = v - vf - drop;
  const valid = budget > 0 && iA > 0;
  const rExact = valid ? budget / iA : 0;
  const rE24 = valid ? nearestESeries(rExact) : 0;
  const { bands } = resistorBands(valid ? rE24 : 1);
  const pMW = valid ? iA * iA * rE24 * 1000 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="size-4 text-amber-600" />
          Resistor calculator
        </CardTitle>
        <CardDescription>Series resistor for one LED or one display segment.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref-supply-v">Supply (V)</Label>
            <Input
              id="ref-supply-v"
              type="number"
              min={0}
              step={0.5}
              value={volts}
              onChange={(e) => setVolts(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>LED Vf (V)</Label>
            <Select value={vfStr} onValueChange={setVfStr}>
              <SelectTrigger className="w-full" aria-label="LED forward voltage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.8">1.8 — red</SelectItem>
                <SelectItem value="2.0">2.0 — red / yellow</SelectItem>
                <SelectItem value="2.2">2.2 — green / yellow</SelectItem>
                <SelectItem value="2.5">2.5 — blue / white</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref-current-ma">Current (mA)</Label>
            <Input
              id="ref-current-ma"
              type="number"
              min={0}
              step={1}
              value={maStr}
              onChange={(e) => setMaStr(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Driver drop (V)</Label>
            <Select value={dropStr} onValueChange={setDropStr}>
              <SelectTrigger className="w-full" aria-label="Driver voltage drop">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0 — direct / ideal</SelectItem>
                <SelectItem value="0.33">0.33 — 74HC sinking</SelectItem>
                <SelectItem value="0.4">0.4 — 74LS sinking</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!valid ? (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            No headroom: supply − Vf − driver drop must be positive, and current must be above 0.
            Adjust the inputs.
          </p>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
            <p className="font-mono text-xs text-stone-500">
              R = (V − Vf − Vdrop) / I = ({fmtNum(v)} − {fmtNum(vf)} − {fmtNum(drop)}) /{' '}
              {iA.toFixed(3)} A
            </p>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-2xl font-bold text-stone-900">
                {formatOhms(rE24)}
              </span>
              <span className="font-mono text-xs text-stone-500">
                nearest E24 of {rExact.toFixed(1)} Ω
              </span>
              <span className="font-mono text-xs text-stone-500">
                P = I²R ≈ {pMW.toFixed(0)} mW
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-stone-500">4-band (±5%):</span>
              <span className="flex items-center gap-1">
                {bands.map((b, idx) => (
                  <span
                    key={`${b}-${idx}`}
                    className="inline-block size-5 rounded-full border border-stone-300 shadow-sm"
                    style={{ backgroundColor: BAND_CSS[b] }}
                    title={bandTitle(b, idx)}
                  />
                ))}
              </span>
              <span className="font-mono text-xs text-stone-500">{bands.join(' · ')}</span>
            </div>
            {pMW > 250 && (
              <p className="text-xs text-amber-700">
                Above ¼ W — use a ½ W resistor or split the drop across two resistors.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Main tab ---------------- */

export default function ReferenceTab() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q === ''
        ? CHIP_DEFS
        : CHIP_DEFS.filter(
            (c) => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
          ),
    [q],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chips — id or name (e.g. 7447, NAND, counter)"
            aria-label="Search chip reference"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-stone-500">
          {filtered.length} of {CHIP_DEFS.length} chips
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
          No chips match “{query}”. Try a part number (7447) or a function (NAND, counter, timer).
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((def) => (
            <ChipCard key={def.id} def={def} />
          ))}
        </div>
      )}

      <FamiliesCard />
      <Seg7Card />
      <ResistorCard />
    </div>
  );
}
