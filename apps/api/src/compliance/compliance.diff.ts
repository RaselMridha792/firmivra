import type { ComplianceDiffChange } from '@firmivra/types';

/** One calendar entry as compared: dates as `YYYY-MM-DD`, the formula as plain JSON. */
export interface DiffEntryData {
  id?: string;
  name: string;
  form: string | null;
  type: string;
  description: string | null;
  ruleKind: string;
  dueOn: string | null;
  rule: unknown;
}

export interface DiffRow {
  change: ComplianceDiffChange;
  before: DiffEntryData | null;
  after: DiffEntryData | null;
}

const same = (a: DiffEntryData, b: DiffEntryData) =>
  a.type === b.type &&
  a.description === b.description &&
  a.ruleKind === b.ruleKind &&
  a.dueOn === b.dueOn &&
  JSON.stringify(a.rule ?? null) === JSON.stringify(b.rule ?? null);

const byDate = (a: DiffEntryData, b: DiffEntryData) =>
  (a.dueOn ?? '9999-99-99').localeCompare(b.dueOn ?? '9999-99-99');

/**
 * Compares two versions of a calendar, by entry name and form. An entry that keeps its date and
 * rule is UNCHANGED; the same name with another date, type or rule is CHANGED (the same name can
 * repeat for several dates, like quarterly payments: equal dates pair first, the rest in date
 * order); the others are ADDED or REMOVED. Rows come in name order.
 */
export function diffEntries(
  before: readonly DiffEntryData[],
  after: readonly DiffEntryData[],
): DiffRow[] {
  const key = (e: DiffEntryData) => `${e.name}\u0000${e.form ?? ''}`;
  const groups = new Map<string, { before: DiffEntryData[]; after: DiffEntryData[] }>();
  const slot = (e: DiffEntryData) => {
    const g = groups.get(key(e)) ?? { before: [], after: [] };
    groups.set(key(e), g);
    return g;
  };
  for (const e of before) slot(e).before.push(e);
  for (const e of after) slot(e).after.push(e);
  const rows: DiffRow[] = [];
  for (const g of groups.values()) {
    const left = [...g.before].sort(byDate);
    const right = [...g.after].sort(byDate);
    // Equal dates and rules pair first.
    for (const l of [...left]) {
      const i = right.findIndex((r) => r.dueOn === l.dueOn && r.ruleKind === l.ruleKind);
      if (i === -1) continue;
      const r = right.splice(i, 1)[0] as DiffEntryData;
      left.splice(left.indexOf(l), 1);
      rows.push({ change: same(l, r) ? 'UNCHANGED' : 'CHANGED', before: l, after: r });
    }
    while (left.length > 0 && right.length > 0) {
      rows.push({
        change: 'CHANGED',
        before: left.shift() as DiffEntryData,
        after: right.shift() as DiffEntryData,
      });
    }
    for (const l of left) rows.push({ change: 'REMOVED', before: l, after: null });
    for (const r of right) rows.push({ change: 'ADDED', before: null, after: r });
  }
  return rows.sort((a, b) => {
    const x = (a.after ?? a.before) as DiffEntryData;
    const y = (b.after ?? b.before) as DiffEntryData;
    return x.name.localeCompare(y.name) || byDate(x, y);
  });
}
