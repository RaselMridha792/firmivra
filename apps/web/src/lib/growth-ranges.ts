// SA-DSH-F06: Platform Growth's range choices, in her order, as US Eastern calendar days
// (SA-DSH-Y02: weeks start Monday in America/New_York). Rolling ranges are not calendar ones:
// Last 12 Months is the 12 months to today, This Year is from January 1. The buckets match the
// API's (apps/api/src/firm-applications/dashboard-growth.ts), so the mock draws the same points.

export const GROWTH_RANGES = [
  ['THIS_WEEK', 'This Week'],
  ['LAST_7', 'Last 7 Days'],
  ['LAST_30', 'Last 30 Days'],
  ['LAST_90', 'Last 90 Days'],
  ['LAST_6_MONTHS', 'Last 6 Months'],
  ['LAST_12_MONTHS', 'Last 12 Months'],
  ['THIS_YEAR', 'This Year'],
  ['LAST_YEAR', 'Last Year'],
  ['CUSTOM', 'Custom Date Range'],
] as const;
export type GrowthRange = (typeof GROWTH_RANGES)[number][0];

/** The longest range the API draws (GROWTH_MAX_DAYS). */
export const GROWTH_MAX_DAYS = 731;

const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  toDay(new Date(toDate(day).getTime() + n * DAY_MS));
/** The same day `n` months away, or that month's last day when it has no such day. */
const addMonths = (day: string, n: number) => {
  const d = toDate(day);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
  return toDay(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), last))),
  );
};
export const spanDays = (from: string, to: string) =>
  Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;

/** Today in US Eastern time, as YYYY-MM-DD. */
export const easternToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

/** A choice's first and last day (both included), from today's Eastern day. */
export function rangeDates(
  range: Exclude<GrowthRange, 'CUSTOM'>,
  today: string,
): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  switch (range) {
    case 'THIS_WEEK': {
      // getUTCDay: 0 is Sunday; Monday starts the week.
      const weekday = toDate(today).getUTCDay();
      return { from: addDays(today, -((weekday + 6) % 7)), to: today };
    }
    case 'LAST_7':
      return { from: addDays(today, -6), to: today };
    case 'LAST_30':
      return { from: addDays(today, -29), to: today };
    case 'LAST_90':
      return { from: addDays(today, -89), to: today };
    case 'LAST_6_MONTHS':
      return { from: addDays(addMonths(today, -6), 1), to: today };
    case 'LAST_12_MONTHS':
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case 'THIS_YEAR':
      return { from: `${year}-01-01`, to: today };
    case 'LAST_YEAR':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

export type GrowthBucket = 'DAY' | 'WEEK' | 'MONTH';

/** Days for 31 days or fewer, weeks up to 26 weeks (about six months), else months. */
export function bucketOf(from: string, to: string): GrowthBucket {
  const days = spanDays(from, to);
  if (days <= 31) return 'DAY';
  if (days <= 26 * 7 + 6) return 'WEEK';
  return 'MONTH';
}

/** The range's buckets in order, the first and last cut to it (as the API's). */
export function growthBuckets(from: string, to: string, bucket = bucketOf(from, to)) {
  const out: { start: string; end: string }[] = [];
  let start = from;
  while (start <= to) {
    let end: string;
    if (bucket === 'DAY') end = start;
    else if (bucket === 'WEEK') end = addDays(start, (7 - toDate(start).getUTCDay()) % 7);
    else {
      const d = toDate(start);
      end = toDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    }
    if (end > to) end = to;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}
