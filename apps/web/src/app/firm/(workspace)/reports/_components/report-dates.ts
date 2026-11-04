// RP-F01, F04, F16 (Octavia's Reports review, Oct 28): one clock and one date state for Reports.
// The firm's day is the firm's own (its time zone, not the browser's) and turns at its midnight;
// the range and comparison chosen on the overview travel in the address to the report it opens and
// back, as `range` (a preset or "custom"), `start` and `end` (a custom range) and `compare`.

/** The calendar day in `timezone` at `now`, as YYYY-MM-DD. */
export const dayIn = (timezone: string, now: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRESETS = new Set([
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
]);
const COMPARES = new Set(['NONE', 'PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR']);

export type DateState =
  | { rule: 'ROLLING'; preset: string; compare?: string }
  | { rule: 'FIXED'; from: string; to: string; compare?: string };

/** The date state an address carries, when it carries a valid one. */
export function datesFrom(params: { get(name: string): string | null }): DateState | undefined {
  const compare = params.get('compare') ?? undefined;
  const c = compare && COMPARES.has(compare) ? { compare } : {};
  const range = params.get('range');
  if (range === 'custom') {
    const from = params.get('start') ?? '';
    const to = params.get('end') ?? '';
    return DAY.test(from) && DAY.test(to) && from <= to
      ? { rule: 'FIXED', from, to, ...c }
      : undefined;
  }
  if (range && PRESETS.has(range)) return { rule: 'ROLLING', preset: range, ...c };
  return compare && COMPARES.has(compare)
    ? { rule: 'ROLLING', preset: 'this_year', ...c }
    : undefined;
}

/** The address parameters of a date state (merged into a link's query). */
export function dateQuery(s: DateState): Record<string, string> {
  return {
    ...(s.rule === 'FIXED' ? { range: 'custom', start: s.from, end: s.to } : { range: s.preset }),
    ...(s.compare ? { compare: s.compare } : {}),
  };
}

/** `href` with the date state's parameters added. */
export function withDates(href: string, s: DateState): string {
  const [path = '', query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  for (const [k, v] of Object.entries(dateQuery(s))) params.set(k, v);
  return `${path}?${params.toString()}`;
}

/** What is wrong with a custom range, in the words shown under it; null when it can be used. */
export function rangeProblem(from: string, to: string): string | null {
  if (!DAY.test(from) || !DAY.test(to)) return 'Choose both dates.';
  return from > to ? 'The start date must be on or before the end date.' : null;
}
