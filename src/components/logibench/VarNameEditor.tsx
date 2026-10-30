'use client';

/**
 * LogicBench PH — editable variable-name chips for the decoder design lab
 * (docs/kmap-lab-presets-vars-preview-plan.md §5.4).
 *
 * One chip per variable (4 in 4-var mode, 5 in 5-var mode; slot 0 is the
 * 5-var MSB). Clicking a chip swaps it for an inline input: Enter or blur
 * commits, Escape cancels. Validation mirrors the persist sanitizer — 1–3
 * letters/digits starting with a letter, unique across all five slots
 * (case-insensitive) so a name customized in 4-var mode cannot collide with
 * the 5-var MSB later. Empty input restores that slot's default (the store
 * maps '' to the default) unless that default is taken by another slot; the
 * trailing button restores all defaults; the parent keys this component by
 * var-count, so switching 4 ↔ 5 remounts it and no stale input or error
 * outlives its chip. Chips and the input share a fixed
 * width so opening the editor never shifts the row — a shift would swallow
 * the click on the next chip during a blur-commit. After an Enter/Escape
 * commit, focus returns to the renamed chip instead of dropping to <body>.
 */

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_VAR_NAMES, VAR_NAME_REGEX, type VarNameIndex } from '@/store/kmapStore';
import { Input } from '@/components/ui/input';

export interface VarNameEditorProps {
  /** the persisted 5-slot name array (slot 0 = 5-var MSB) */
  varNames: readonly string[];
  vars: 4 | 5;
  onRename: (index: VarNameIndex, name: string) => void;
  onReset: () => void;
}

export default function VarNameEditor({ varNames, vars, onRename, onReset }: VarNameEditorProps) {
  const indices: VarNameIndex[] = vars === 5 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4];
  const [editing, setEditing] = useState<VarNameIndex | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef(new Map<VarNameIndex, HTMLButtonElement>());
  /* slot to refocus after the editor closes, if focus was dropped */
  const focusBack = useRef<VarNameIndex | null>(null);

  useEffect(() => {
    if (editing !== null) {
      inputRef.current?.select();
      return;
    }
    /* editor closed: if focus fell to <body> (Enter/Escape commit), return it
       to the renamed chip. A blur-commit that landed somewhere meaningful
       (another chip, a button, a popover) keeps the browser's focus choice. */
    const i = focusBack.current;
    focusBack.current = null;
    if (i !== null && document.activeElement === document.body) {
      chipRefs.current.get(i)?.focus();
    }
  }, [editing]);

  const start = (i: VarNameIndex) => {
    focusBack.current = null;
    setEditing(i);
    setDraft(varNames[i]);
    setError(null);
  };

  const cancel = () => {
    focusBack.current = editing;
    setEditing(null);
    setError(null);
  };

  const commit = () => {
    if (editing === null) return;
    const name = draft.trim();
    if (name !== '' && !VAR_NAME_REGEX.test(name)) {
      setError('Use 1–3 letters or digits, starting with a letter.');
      return;
    }
    /* '' restores the slot's default — still check uniqueness against the
       other slots (another slot may already carry that default's name) */
    const effective = name === '' ? DEFAULT_VAR_NAMES[editing] : name;
    const clash = varNames.some(
      (v, i) => i !== editing && v.toLowerCase() === effective.toLowerCase(),
    );
    if (clash) {
      setError(`“${effective}” is already used by another variable.`);
      return;
    }
    onRename(editing, name);
    cancel();
  };

  return (
    <div className="flex min-w-fit flex-col gap-1" role="group" aria-label="Variable names">
      <div className="flex items-center gap-1.5">
        {indices.map((i, pos) =>
          editing === i ? (
            <Input
              key={i}
              ref={inputRef}
              value={draft}
              maxLength={3}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') commit();
                else if (ev.key === 'Escape') cancel();
              }}
              onBlur={() => {
                if (error) cancel();
                else commit();
              }}
              aria-label={`Rename variable ${pos + 1} of ${indices.length} (currently ${varNames[i]})`}
              aria-invalid={error !== null}
              className="h-9 w-14 px-1.5 text-center font-mono text-sm"
            />
          ) : (
            <button
              key={i}
              ref={(el) => {
                if (el) chipRefs.current.set(i, el);
                else chipRefs.current.delete(i);
              }}
              type="button"
              onClick={() => start(i)}
              aria-label={`Rename variable ${pos + 1} of ${indices.length} (currently ${varNames[i]})`}
              className="h-9 w-14 cursor-pointer rounded-md border border-stone-300 bg-white text-center font-mono text-sm font-semibold text-stone-700 transition-colors hover:border-amber-500 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              {varNames[i]}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => {
            onReset();
            cancel();
          }}
          aria-label="Restore default variable names"
          title="Restore default names"
          className="flex size-9 cursor-pointer items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {error !== null && editing !== null && (
        <p role="status" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
