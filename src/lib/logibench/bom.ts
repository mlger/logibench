import type { InventoryItem, PartInstance, Project } from './types';
import { getChipDef } from '@/data/chips';
import { canSubstitute } from './partNumber';
import { partLabel } from './geometry';

/** BOM line: chips by defId+family, passives by value, etc. */
export interface BomLine {
  key: string;
  label: string;
  base?: string; // chip base id, e.g. "7447"
  family?: string;
  qty: number;
  onHand: number; // from inventory (with substitutions)
  status: 'ok' | 'short' | 'sub' | 'no-inventory';
  note?: string;
}

export function computeBom(project: Project): { key: string; label: string; base?: string; family?: string; qty: number }[] {
  const counts = new Map<string, { label: string; base?: string; family?: string; qty: number }>();
  for (const part of project.parts) {
    let key: string; let label: string; let base: string | undefined; let family: string | undefined;
    if (part.type === 'chip' && part.defId) {
      const def = getChipDef(part.defId);
      base = part.defId;
      family = part.family ?? def?.families[0] ?? 'generic';
      key = `chip:${part.defId}:${family}`;
      label = `${part.defId} (${family})`;
    } else if (part.type === 'resistor') {
      key = `res:${part.props.ohms}`;
      label = `Resistor ${partLabel(part)}`;
    } else if (part.type === 'led') {
      key = `led:${part.props.color}`;
      label = `LED ${part.props.color ?? 'red'}`;
    } else if (part.type === 'seg7') {
      key = `seg7:${part.props.polarity}`;
      label = `7-seg 5161${part.props.polarity === 'CA' ? 'BS' : 'AS'} (${part.props.polarity})`;
    } else if (part.type === 'cap') {
      key = 'cap:100n';
      label = 'Capacitor 0.1 µF';
    } else if (part.type === 'switch') { key = 'switch'; label = 'SPST switch'; }
    else if (part.type === 'button') { key = 'button'; label = 'Pushbutton'; }
    else if (part.type === 'supply') { key = 'supply'; label = '5 V supply'; }
    else if (part.type === 'clock555') { key = 'clock555'; label = '555 clock module'; }
    else { key = part.type; label = part.type; }
    const cur = counts.get(key);
    if (cur) cur.qty++;
    else counts.set(key, { label, base, family, qty: 1 });
  }
  return [...counts.entries()].map(([key, v]) => ({ key, ...v }));
}

/** Compare BOM against inventory with substitution rules (plan §3.4). */
export function checkBuildability(
  bom: ReturnType<typeof computeBom>,
  inventory: InventoryItem[],
): BomLine[] {
  return bom.map((line) => {
    if (!line.base) {
      return { ...line, onHand: 0, status: 'no-inventory' as const, note: 'Not tracked in inventory' };
    }
    // exact-family stock
    const exact = inventory.filter((i) => i.base === line.base && i.family === line.family && i.condition !== 'dead');
    const exactQty = exact.reduce((s, i) => s + i.qty, 0);
    if (exactQty >= line.qty) {
      return { ...line, onHand: exactQty, status: 'ok' as const };
    }
    // substitutions: HCT replaces LS; HC replaces LS with warning; etc.
    let subQty = 0;
    let subNote = '';
    for (const item of inventory) {
      if (item.base !== line.base || item.family === line.family || item.condition === 'dead') continue;
      const want = (line.family ?? 'generic') as never;
      const res = canSubstitute(want, item.family as never);
      if (res.ok) {
        subQty += item.qty;
        if (res.level === 'warn') {
          subNote = `${item.family} can substitute but check drive levels (see Families)`;
        } else if (!subNote) {
          subNote = `${item.family} substitutes for ${line.family}`;
        }
      }
    }
    if (exactQty + subQty >= line.qty) {
      return { ...line, onHand: exactQty + subQty, status: 'sub' as const, note: subNote };
    }
    const total = exactQty + subQty;
    return {
      ...line, onHand: total, status: 'short' as const,
      note: total === 0 ? 'None on hand' : `Short by ${line.qty - total}`,
    };
  });
}
