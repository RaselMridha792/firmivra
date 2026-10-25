import type { DashboardPeriod, DashboardRange, DashboardRevenuePeriod } from './schemas.js';

// The dashboard's periods (Octavia's review of Oct 25, C1): calendar days, YYYY-MM-DD, on the
// firm's calendar. The API counts with them; the web's mock and labels use the same days.
const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  toDay(new Date(toDate(day).getTime() + n * DAY_MS));
const daysBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
const ymd = (day: string) => day.split('-').map(Number) as [number, number, number];
const make = (y: number, m: number, d: number) => toDay(new Date(Date.UTC(y, m - 1, d)));
/** The last day of a month (m 1 to 12; m out of range rolls into the next or previous year). */
const lastOf = (y: number, m: number) => toDay(new Date(Date.UTC(y, m, 0)));
/** The same day of the month in another month, the month's last day when it has fewer days. */
const sameDayIn = (y: number, m: number, d: number) => {
  const last = lastOf(y, m);
  return Number(last.slice(8)) < d ? last : make(y, m, d);
};

/**
 * A period's days and the equivalent elapsed period before it, from the firm's today. Custom takes
 * `from` and `to` as given (the caller checks them against today).
 */
export function rangeOf(
  period: DashboardPeriod,
  today: string,
  custom?: { from: string; to: string },
): DashboardRange {
  const [y, m, d] = ymd(today);
  const at = (from: string, to: string, previousFrom: string, previousTo: string) => ({
    period,
    from,
    to,
    previousFrom,
    previousTo,
  });
  switch (period) {
    case 'TODAY':
      return at(today, today, addDays(today, -1), addDays(today, -1));
    case 'THIS_WEEK': {
      // Monday to today; the week before over the same weekdays.
      const monday = addDays(today, -((toDate(today).getUTCDay() + 6) % 7));
      return at(monday, today, addDays(monday, -7), addDays(today, -7));
    }
    case 'THIS_MONTH':
      return at(make(y, m, 1), today, make(y, m - 1, 1), sameDayIn(y, m - 1, d));
    case 'LAST_MONTH':
      return at(make(y, m - 1, 1), lastOf(y, m - 1), make(y, m - 2, 1), lastOf(y, m - 2));
    case 'THIS_QUARTER': {
      const first = Math.floor((m - 1) / 3) * 3 + 1;
      const start = make(y, first, 1);
      const before = make(y, first - 3, 1);
      const elapsed = daysBetween(start, today);
      const end = addDays(before, elapsed);
      const beforeLast = addDays(start, -1);
      return at(start, today, before, end > beforeLast ? beforeLast : end);
    }
    case 'THIS_YEAR':
      return at(make(y, 1, 1), today, make(y - 1, 1, 1), sameDayIn(y - 1, m, d));
    case 'LAST_YEAR':
      return at(make(y - 1, 1, 1), make(y - 1, 12, 31), make(y - 2, 1, 1), make(y - 2, 12, 31));
    case 'CUSTOM': {
      if (!custom) throw new Error('a Custom period needs its days');
      const days = daysBetween(custom.from, custom.to) + 1;
      return at(custom.from, custom.to, addDays(custom.from, -days), addDays(custom.from, -1));
    }
  }
}

/** Revenue Overview's span: Month and Quarter run to today, Year is a whole calendar year. */
export function revenueRangeOf(
  period: DashboardRevenuePeriod,
  today: string,
  options: { year?: number; custom?: { from: string; to: string } } = {},
): DashboardRange {
  const thisYear = Number(today.slice(0, 4));
  if (period === 'MONTH') return rangeOf('THIS_MONTH', today);
  if (period === 'QUARTER') return rangeOf('THIS_QUARTER', today);
  if (period === 'CUSTOM') return rangeOf('CUSTOM', today, options.custom);
  const year = options.year ?? thisYear;
  if (year === thisYear) return rangeOf('THIS_YEAR', today);
  return {
    period: 'CUSTOM',
    from: make(year, 1, 1),
    to: make(year, 12, 31),
    previousFrom: make(year - 1, 1, 1),
    previousTo: make(year - 1, 12, 31),
  };
}

/** How the chart cuts a span: by day, by month, a calendar year's twelve months, or by its length. */
export type BucketShape = 'days' | 'months' | 'year' | 'auto';

/** Revenue Overview's bars: Month by day, Quarter by month, Year its twelve months, Custom by length. */
export const shapeOf = (period: DashboardRevenuePeriod): BucketShape =>
  period === 'MONTH'
    ? 'days'
    : period === 'QUARTER'
      ? 'months'
      : period === 'YEAR'
        ? 'year'
        : 'auto';

/**
 * The chart's bars: days, months (clipped to the span), a year's twelve months (the ones to come
 * at zero), or `auto`: days for up to 62 days, months otherwise.
 */
export function bucketsOf(
  from: string,
  to: string,
  shape: BucketShape = 'auto',
): { from: string; to: string }[] {
  if (shape === 'year') {
    const y = Number(from.slice(0, 4));
    return Array.from({ length: 12 }, (_, i) => ({
      from: make(y, i + 1, 1),
      to: lastOf(y, i + 1),
    }));
  }
  const days = daysBetween(from, to) + 1;
  if (shape === 'days' || (shape === 'auto' && days <= 62)) {
    return Array.from({ length: days }, (_, i) => ({
      from: addDays(from, i),
      to: addDays(from, i),
    }));
  }
  const out: { from: string; to: string }[] = [];
  let start = from;
  while (start <= to) {
    const [y, m] = ymd(start);
    const end = lastOf(y, m) < to ? lastOf(y, m) : to;
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}
