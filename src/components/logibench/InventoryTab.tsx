'use client';

/**
 * LogicBench PH — Inventory tab (plan §3.4).
 * My parts bin (CRUD table), quick-add form with live part-number parsing,
 * and a "Can I build the current circuit?" BOM checker with substitutions.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { Package, Plus, Trash2, Wrench } from 'lucide-react';
import { checkBuildability, computeBom, type BomLine } from '@/lib/logibench/bom';
import { parsePartNumber } from '@/lib/logibench/partNumber';
import type { Condition, Family, InventoryItem } from '@/lib/logibench/types';
import { useEditor } from '@/store/projectStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/* ---------------- safe parsing helpers (data-version guard) ---------------- */

function safeInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function safeStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const FAMILIES: readonly Family[] = ['LS', 'HC', 'HCT', 'CD4000', 'NE555', 'generic'];

function isFamily(value: unknown): value is Family {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value);
}

function isCondition(value: unknown): value is Condition {
  return value === 'new' || value === 'used' || value === 'suspect' || value === 'dead';
}

/** Never trust API rows: coerce to a well-formed InventoryItem or drop the row. */
function sanitizeItem(raw: unknown): InventoryItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = safeStr(row.id);
  const partNumber = safeStr(row.partNumber);
  if (!id || !partNumber) return null;
  const parsed = parsePartNumber(partNumber);
  return {
    id,
    partNumber,
    base: safeStr(row.base) || parsed.base,
    family: isFamily(row.family) ? row.family : parsed.family,
    package: safeStr(row.package),
    qty: safeInt(row.qty),
    condition: isCondition(row.condition) ? row.condition : 'new',
    location: safeStr(row.location) || undefined,
    notes: safeStr(row.notes) || undefined,
  };
}

/* ---------------- display tokens ---------------- */

const FAMILY_BADGE_CLASSES: Record<Family, string> = {
  LS: 'bg-amber-100 text-amber-800',
  HC: 'bg-emerald-100 text-emerald-800',
  HCT: 'bg-teal-100 text-teal-800',
  CD4000: 'bg-violet-100 text-violet-800',
  NE555: 'bg-stone-100 text-stone-700',
  generic: 'bg-stone-100 text-stone-700',
};

const CONDITION_DOT_CLASSES: Record<Condition, string> = {
  new: 'bg-emerald-500',
  used: 'bg-amber-500',
  suspect: 'bg-orange-500',
  dead: 'bg-red-500',
};

const TABLE_HEAD_CLASSES = 'text-xs font-semibold uppercase tracking-wider text-stone-500';

const SCROLL_CLASSES =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent';

const SUBSTITUTION_NOTE =
  'Substitution rules: HCT replaces LS directly; HC replaces LS only if input levels are guaranteed (see Reference → Families); 7447 ≠ 7448 (different display polarity!).';

const EMPTY_BIN_TEXT = 'Bin is empty — add your first chip below.';
const NO_PARTS_HINT =
  'Place parts on the breadboard first (Load a demo circuit on the Bench tab to try this)';

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      className={`text-xs font-medium ${feedback.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
    >
      {feedback.text}
    </p>
  );
}

interface AddForm {
  partNumber: string;
  qty: string;
  condition: Condition;
  location: string;
  notes: string;
}

const ADD_FORM_DEFAULT: AddForm = {
  partNumber: '',
  qty: '1',
  condition: 'new',
  location: '',
  notes: '',
};

function statusBadgeInfo(line: BomLine): { label: string; classes: string; note?: string } {
  const needed = safeInt(line.qty);
  const onHand = safeInt(line.onHand);
  if (line.status === 'ok') {
    return { label: 'OK', classes: 'bg-emerald-100 text-emerald-800' };
  }
  if (line.status === 'sub') {
    return {
      label: 'substitute available',
      classes: 'bg-amber-100 text-amber-800',
      note: line.note,
    };
  }
  if (line.status === 'short') {
    return {
      label: onHand === 0 ? 'none on hand' : `short by ${Math.max(1, needed - onHand)}`,
      classes: 'bg-red-100 text-red-800',
    };
  }
  return { label: 'not tracked', classes: 'bg-stone-100 text-stone-600' };
}

/* ---------------- component ---------------- */

export default function InventoryTab() {
  const project = useEditor((s) => s.project);

  // Parts bin
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [binFeedback, setBinFeedback] = useState<Feedback>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  // Quick-add form
  const [form, setForm] = useState<AddForm>(ADD_FORM_DEFAULT);
  const [formFeedback, setFormFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? data : [];
      setItems(list.map(sanitizeItem).filter((i): i is InventoryItem => i !== null));
      setBinFeedback(null);
    } catch (err) {
      setBinFeedback({
        kind: 'err',
        text: `Could not load your bin (${err instanceof Error ? err.message : 'unknown error'}).`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Auto-clear inline feedback
  useEffect(() => {
    if (!binFeedback) return;
    const t = window.setTimeout(() => setBinFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [binFeedback]);

  useEffect(() => {
    if (!formFeedback) return;
    const t = window.setTimeout(() => setFormFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [formFeedback]);

  /** PATCH qty when the inline editor changed (blur / Enter). */
  const commitQty = async (item: InventoryItem, draft: string | undefined) => {
    if (draft === undefined) return;
    setQtyDrafts((prev) => {
      if (!(item.id in prev)) return prev;
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    const nextQty = safeInt(draft);
    if (nextQty === safeInt(item.qty)) return;
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: nextQty }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = sanitizeItem(await res.json());
      if (updated) {
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      } else {
        await refetch();
      }
      setBinFeedback({ kind: 'ok', text: `${item.partNumber} quantity set to ${nextQty}.` });
    } catch (err) {
      setBinFeedback({
        kind: 'err',
        text: `Could not update ${item.partNumber} (${err instanceof Error ? err.message : 'unknown error'}).`,
      });
    }
  };

  const handleDelete = async (item: InventoryItem) => {
    if (!window.confirm(`Remove ${item.partNumber} (×${safeInt(item.qty)}) from your bin?`)) return;
    try {
      const res = await fetch(`/api/inventory/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setBinFeedback({ kind: 'ok', text: `Removed ${item.partNumber} from the bin.` });
    } catch (err) {
      setBinFeedback({
        kind: 'err',
        text: `Could not delete ${item.partNumber} (${err instanceof Error ? err.message : 'unknown error'}).`,
      });
    }
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const partNumber = form.partNumber.trim();
    if (!partNumber) {
      setFormFeedback({ kind: 'err', text: 'Enter a part number (e.g. SN74LS47N).' });
      return;
    }
    const parsedQty = Number(form.qty);
    const qty =
      form.qty.trim() === '' || !Number.isFinite(parsedQty) ? 1 : Math.max(0, Math.floor(parsedQty));
    setSubmitting(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber,
          qty,
          condition: form.condition,
          location: form.location.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm(ADD_FORM_DEFAULT);
      setFormFeedback({ kind: 'ok', text: `Added ${partNumber} ×${qty} to the bin.` });
      await refetch();
    } catch (err) {
      setFormFeedback({
        kind: 'err',
        text: `Could not add part (${err instanceof Error ? err.message : 'unknown error'}).`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- BOM / buildability ---------------- */

  const preview = useMemo(
    () => (form.partNumber.trim() ? parsePartNumber(form.partNumber) : null),
    [form.partNumber],
  );

  const bom = useMemo(() => {
    try {
      return computeBom(project);
    } catch {
      return [];
    }
  }, [project]);

  const buildLines = useMemo(() => {
    try {
      return checkBuildability(bom, items);
    } catch {
      return [];
    }
  }, [bom, items]);

  const partsCount = Array.isArray(project.parts) ? project.parts.length : 0;
  const wireCount = Array.isArray(project.wires) ? project.wires.length : 0;
  const buildableCount = buildLines.filter((l) => l.status === 'ok' || l.status === 'sub').length;

  /* ---------------- render ---------------- */

  return (
    <div className="flex flex-col gap-6">
      {/* My parts bin */}
      <Card className="rounded-xl border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-stone-900">
            <Package className="size-4 text-amber-600" aria-hidden />
            My parts bin
          </CardTitle>
          <CardDescription className={TABLE_HEAD_CLASSES}>
            {loading && items.length === 0
              ? 'Loading…'
              : `${items.length} ${items.length === 1 ? 'entry' : 'entries'} tracked`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {binFeedback && (
            <div className="mb-3">
              <FeedbackLine feedback={binFeedback} />
            </div>
          )}
          {loading && items.length === 0 ? (
            <p className="animate-pulse text-sm text-stone-400">Loading your bin…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-stone-500">{EMPTY_BIN_TEXT}</p>
          ) : (
            <div
              className={`max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-stone-200 ${SCROLL_CLASSES}`}
            >
              <Table>
                <TableCaption className="sr-only">Parts in your inventory bin</TableCaption>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={TABLE_HEAD_CLASSES}>Part number</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Base</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Family</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Qty</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Condition</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Location</TableHead>
                    <TableHead className={TABLE_HEAD_CLASSES}>Notes</TableHead>
                    <TableHead className="sr-only">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-stone-900">{item.partNumber}</TableCell>
                      <TableCell className="font-mono text-stone-600">{item.base}</TableCell>
                      <TableCell>
                        <Badge className={FAMILY_BADGE_CLASSES[item.family]}>{item.family}</Badge>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`Quantity of ${item.partNumber}`}
                          className="h-8 w-16 px-2 text-sm"
                          value={qtyDrafts[item.id] ?? String(safeInt(item.qty))}
                          onChange={(e) =>
                            setQtyDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          onBlur={() => void commitQty(item, qtyDrafts[item.id])}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-stone-700">
                          <span
                            className={`size-2 rounded-full ${CONDITION_DOT_CLASSES[item.condition]}`}
                            aria-hidden
                          />
                          <span className="capitalize">{item.condition}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-stone-600">
                        {item.location || <span className="text-stone-400">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-stone-600" title={item.notes}>
                        {item.notes || <span className="text-stone-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${item.partNumber} from bin`}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add part */}
      <Card className="rounded-xl border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-stone-900">
            <Plus className="size-4 text-amber-600" aria-hidden />
            Add part
          </CardTitle>
          <CardDescription className={TABLE_HEAD_CLASSES}>
            Quick-add a chip to your bin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => void handleAdd(e)}
          >
            <div className="sm:col-span-2">
              <label
                htmlFor="add-part-number"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Part number
              </label>
              <Input
                id="add-part-number"
                className="border-stone-200 font-mono"
                placeholder="e.g. SN74LS47N or 74HC4511"
                autoComplete="off"
                spellCheck={false}
                value={form.partNumber}
                onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))}
              />
              {preview && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500">
                  <span aria-hidden>→</span>
                  <span className="font-mono font-semibold text-stone-800">{preview.base}</span>
                  <span aria-hidden>·</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${FAMILY_BADGE_CLASSES[preview.family]}`}
                  >
                    {preview.family}
                  </span>
                </p>
              )}
            </div>
            <div>
              <label htmlFor="add-qty" className="mb-1 block text-xs font-medium text-stone-600">
                Quantity
              </label>
              <Input
                id="add-qty"
                type="number"
                min={0}
                step={1}
                className="border-stone-200"
                value={form.qty}
                onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
              />
            </div>
            <div>
              <label
                htmlFor="add-condition"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Condition
              </label>
              <Select
                value={form.condition}
                onValueChange={(v) => {
                  if (isCondition(v)) setForm((f) => ({ ...f, condition: v }));
                }}
              >
                <SelectTrigger id="add-condition" className="w-full border-stone-200">
                  <SelectValue placeholder="Condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="suspect">Suspect</SelectItem>
                  <SelectItem value="dead">Dead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                htmlFor="add-location"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Location
              </label>
              <Input
                id="add-location"
                className="border-stone-200"
                placeholder="Bin A3"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="add-notes" className="mb-1 block text-xs font-medium text-stone-600">
                Notes
              </label>
              <Input
                id="add-notes"
                className="border-stone-200"
                placeholder="Optional notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-end gap-3 sm:col-span-2">
              <FeedbackLine feedback={formFeedback} />
              <Button
                type="submit"
                disabled={submitting}
                className="ml-auto bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
              >
                <Plus className="size-4" aria-hidden />
                {submitting ? 'Adding…' : 'Add to bin'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Can I build the current circuit? */}
      <Card className="rounded-xl border-stone-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-stone-900">
            <Wrench className="size-4 text-amber-600" aria-hidden />
            Can I build the current circuit?
          </CardTitle>
          <CardDescription className={TABLE_HEAD_CLASSES}>
            BOM check against your bin, with family substitutions
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {partsCount === 0 ? (
            <p className="text-sm text-stone-500">{NO_PARTS_HINT}</p>
          ) : (
            <>
              <div
                className={`max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-stone-200 ${SCROLL_CLASSES}`}
              >
                <Table>
                  <TableCaption className="sr-only">
                    Buildability of the current breadboard BOM
                  </TableCaption>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className={TABLE_HEAD_CLASSES}>Part</TableHead>
                      <TableHead className={TABLE_HEAD_CLASSES}>Needed</TableHead>
                      <TableHead className={TABLE_HEAD_CLASSES}>On hand</TableHead>
                      <TableHead className={TABLE_HEAD_CLASSES}>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buildLines.map((line) => {
                      const info = statusBadgeInfo(line);
                      return (
                        <TableRow key={line.key}>
                          <TableCell className="text-stone-900">{line.label}</TableCell>
                          <TableCell className="text-stone-700">{safeInt(line.qty)}</TableCell>
                          <TableCell className="text-stone-700">{safeInt(line.onHand)}</TableCell>
                          <TableCell>
                            <Badge className={info.classes}>{info.label}</Badge>
                            {info.note && (
                              <p className="mt-1 text-xs text-stone-500">{info.note}</p>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-sm font-medium text-stone-700">
                {buildableCount} of {buildLines.length} BOM lines buildable · {wireCount} wire
                {wireCount === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-stone-500">{SUBSTITUTION_NOTE}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
