'use client';

/**
 * LogicBench PH — preset menu for the decoder design lab
 * (docs/kmap-lab-presets-vars-preview-plan.md §4.3).
 *
 * A popover that fills the maps with known functions: whole-decoder presets
 * (classic, blank, and ten "digit d only" single-digit decoders rendered with
 * mini seven-segment previews) and active-segment presets (classic,
 * constants, odd parity, ≥5 threshold, random). The app has no undo, so
 * applying over segments that currently differ from the classic table first
 * opens a confirm dialog (same pattern as "Reset all"); the popover closes
 * before the dialog opens to avoid nested-popup focus traps.
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  DECODER_PRESETS,
  DIGIT_PRESETS,
  SEGMENT_PRESETS,
  digitGlyphStates,
  type KmapPreset,
} from '@/data/kmapPresets';
import type { SegKey } from '@/store/kmapStore';
import SevenSegDisplay from '@/components/logibench/SevenSegDisplay';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const HDR = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

/** Thin scrollbar styling (same recipe as TruthTablePanel). */
const SCROLL =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent';

export interface PresetMenuProps {
  segment: SegKey;
  /** segments whose cells currently differ from the classic table (guard arming) */
  editedSegs: readonly SegKey[];
  onApply: (preset: KmapPreset) => void;
}

export default function PresetMenu({ segment, editedSegs, onApply }: PresetMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<KmapPreset | null>(null);

  const affected = (p: KmapPreset): SegKey[] =>
    p.scope === 'decoder' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'] : [segment];
  const wouldOverwrite = (p: KmapPreset): boolean =>
    affected(p).some((s) => editedSegs.includes(s));

  const choose = (p: KmapPreset) => {
    setOpen(false);
    if (wouldOverwrite(p)) setPending(p);
    else onApply(p);
  };

  const dirtyAffected = pending
    ? affected(pending).filter((s) => editedSegs.includes(s))
    : [];
  const segList = dirtyAffected.join(', ');

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="cursor-pointer">
            <Sparkles aria-hidden="true" />
            Presets
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={`max-h-[70vh] w-80 overflow-y-auto ${SCROLL}`}>
          <div className="flex flex-col gap-4">
            <section aria-label="Whole-decoder presets" className="flex flex-col gap-1.5">
              <p className={HDR}>Whole decoder</p>
              {DECODER_PRESETS.map((p) => (
                <MenuRow key={p.id} preset={p} onChoose={choose} />
              ))}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {DIGIT_PRESETS.map((p, d) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => choose(p)}
                    aria-label={`Apply preset Digit ${d} only — overwrites all seven segments`}
                    className="flex w-12 cursor-pointer flex-col items-center gap-0.5 rounded-md border border-stone-200 bg-white px-1 py-1.5 transition-colors hover:border-amber-500 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                  >
                    <span className="font-mono text-sm font-semibold text-stone-700">{d}</span>
                    <SevenSegDisplay states={digitGlyphStates(d)} size="sm" showLabels={false} />
                  </button>
                ))}
              </div>
            </section>
            <section
              aria-label={`Active-segment presets for segment ${segment}`}
              className="flex flex-col gap-1.5 border-t border-stone-100 pt-3"
            >
              <p className={HDR}>Active segment — {segment}</p>
              {SEGMENT_PRESETS.map((p) => (
                <MenuRow key={p.id} preset={p} onChoose={choose} />
              ))}
            </section>
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply preset “{pending?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites your edits to segment{dirtyAffected.length > 1 ? 's' : ''}{' '}
              <span className="font-mono font-semibold">{segList}</span> — they cannot be recovered
              afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Keep edits</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={() => {
                if (pending) onApply(pending);
                setPending(null);
              }}
            >
              Apply preset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MenuRow({
  preset,
  onChoose,
}: {
  preset: KmapPreset;
  onChoose: (p: KmapPreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(preset)}
      aria-label={`Apply preset ${preset.label} — ${
        preset.scope === 'decoder' ? 'all seven segments' : 'the active segment'
      }`}
      className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
    >
      <span className="text-sm font-medium text-stone-800">{preset.label}</span>
      <span className="text-xs text-stone-500">{preset.description}</span>
    </button>
  );
}
