/**
 * Audit Log Review 2, R03c: an entry's details as readable lines. A change shows as
 * "old → new"; null is "(none)" and empty text "(empty)", so null, "", false and 0 never look
 * alike. Two shapes of change are recorded: a `changes` map of `{ from, to }` per field, and the
 * catalog's `fields` with parallel `from` and `to` objects.
 */
export interface DetailLine {
  key: string;
  value: string;
}

type Change = { from: unknown; to: unknown };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isChange = (v: unknown): v is Change =>
  isObject(v) && Object.keys(v).length === 2 && 'from' in v && 'to' in v;

/** One value as text: "(none)" for null, "(empty)" for "", false and 0 as written. */
export function plainValue(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (value === '') return '(empty)';
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

const changeText = (c: Change) => `${plainValue(c.from)} → ${plainValue(c.to)}`;

export function detailLines(metadata: Record<string, unknown>): DetailLine[] {
  const lines: DetailLine[] = [];
  // The catalog's diff: { fields, from: {...}, to: {...} }.
  const paired = isObject(metadata['from']) && isObject(metadata['to']);
  for (const [key, value] of Object.entries(metadata)) {
    if (paired && (key === 'from' || key === 'to' || key === 'fields')) continue;
    // A free-text change is recorded as "changed", never its text (R03).
    const entryOf = (v: unknown) =>
      typeof v === 'string' ? v : isChange(v) ? changeText(v) : null;
    if (
      key === 'changes' &&
      isObject(value) &&
      Object.values(value).every((v) => entryOf(v) !== null)
    ) {
      for (const [field, change] of Object.entries(value)) {
        lines.push({ key: field, value: entryOf(change)! });
      }
      continue;
    }
    lines.push({ key, value: isChange(value) ? changeText(value) : plainValue(value) });
  }
  if (paired) {
    const from = metadata['from'] as Record<string, unknown>;
    const to = metadata['to'] as Record<string, unknown>;
    for (const field of [...new Set([...Object.keys(from), ...Object.keys(to)])]) {
      lines.push({ key: field, value: changeText({ from: from[field], to: to[field] }) });
    }
  }
  return lines;
}

/**
 * Audit Log Review 2, M02b: what an entry's action says about its outcome. A refused request
 * (`access.denied`) is Denied, an action that records a failure (`payment.failed`) is Failed, and
 * every other entry is a change that happened (no label: a failed change writes no row).
 */
export function outcomeOf(action: string): 'Denied' | 'Failed' | null {
  if (action === 'access.denied') return 'Denied';
  return /(^|[._])(failed|failure)$/.test(action) ? 'Failed' : null;
}
