import type { HolidayRule, RecurrenceEnd, RecurrenceUnit } from '@firmivra/types';

// The dates of a recurring task (the Set Up Recurring Task screen, docs/mockups/firm-workspace/task).
// Pure: no clock and no database, so a preview and the generator agree and a retry gives the same
// dates. All dates are calendar days, `YYYY-MM-DD`, in the firm's time zone.

export interface RecurrenceRule {
  interval: number;
  unit: RecurrenceUnit;
  pattern: {
    weekdays?: number[];
    monthly?: 'DAY_OF_MONTH' | 'NTH_WEEKDAY';
    nth?: number;
    weekday?: number;
  };
  startOn: string;
  endMode: RecurrenceEnd;
  endAfterCount: number | null;
  endOn: string | null;
  holidayRule: HolidayRule;
}

export interface Occurrence {
  /** The date the rule gives. It is the occurrence's key. */
  scheduledOn: string;
  /** The date the task is due: `scheduledOn` moved by the holiday rule. */
  dueOn: string;
}

/** A guard on a rule that ends far away: the most dates one call walks through. */
const WALK_LIMIT = 6_000;
const DAY_MS = 86_400_000;

const parse = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y!, m: m! - 1, d: d! };
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number) => iso(ms(date) + days * DAY_MS);
/** 0 Sunday to 6 Saturday. */
export const weekdayOf = (date: string) => new Date(ms(date)).getUTCDay();
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const make = (y: number, m: number, d: number) => iso(Date.UTC(y, m, d));

/** The nth weekday of a month (nth 5: the last). A 5th the month lacks falls back to its last. */
function nthWeekday(y: number, m: number, nth: number, weekday: number): string {
  if (nth === 5) {
    const last = daysIn(y, m);
    const back = (new Date(Date.UTC(y, m, last)).getUTCDay() - weekday + 7) % 7;
    return make(y, m, last - back);
  }
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  // A 5th week the month lacks falls back to its last such weekday.
  return day > daysIn(y, m) ? make(y, m, day - 7) : make(y, m, day);
}

/** The dates the rule gives before the end rule, in order. */
function* raw(rule: RecurrenceRule): Generator<string> {
  const start = rule.startOn;
  const s = parse(start);
  if (rule.unit === 'DAY') {
    for (let k = 0; ; k++) yield addDays(start, k * rule.interval);
  } else if (rule.unit === 'WEEK') {
    const days = [...new Set(rule.pattern.weekdays ?? [weekdayOf(start)])].sort((a, b) => a - b);
    const sunday = addDays(start, -weekdayOf(start));
    for (let w = 0; ; w++) {
      for (const day of days) {
        const date = addDays(sunday, w * rule.interval * 7 + day);
        if (date >= start) yield date;
      }
    }
  } else if (rule.unit === 'MONTH' || rule.unit === 'QUARTER') {
    const step = rule.interval * (rule.unit === 'QUARTER' ? 3 : 1);
    for (let k = 0; ; k++) {
      const month = s.m + k * step;
      const y = s.y + Math.floor(month / 12);
      const m = ((month % 12) + 12) % 12;
      const date =
        rule.pattern.monthly === 'NTH_WEEKDAY'
          ? nthWeekday(y, m, rule.pattern.nth ?? 1, rule.pattern.weekday ?? weekdayOf(start))
          : make(y, m, Math.min(s.d, daysIn(y, m)));
      if (date >= start) yield date;
    }
  } else {
    for (let k = 0; ; k++) {
      const y = s.y + k * rule.interval;
      yield make(y, s.m, Math.min(s.d, daysIn(y, s.m)));
    }
  }
}

/** A date that falls on a weekend moves to the next or previous weekday, as the rule says. */
export function adjust(date: string, rule: HolidayRule): string {
  if (rule === 'NONE') return date;
  const step = rule === 'NEXT_BUSINESS_DAY' ? 1 : -1;
  let d = date;
  for (let i = 0; i < 3 && [0, 6].includes(weekdayOf(d)); i++) d = addDays(d, step);
  return d;
}

/**
 * The rule's dates in order, up to `limit`. `from` leaves out earlier due dates (the end rule is
 * still counted from the start, so "end after 4" is the first four dates of the rule, not four
 * from `from`). `skip` leaves out that many of the rule's first dates (those already made).
 */
export function schedule(
  rule: RecurrenceRule,
  { limit, from, skip = 0 }: { limit: number; from?: string; skip?: number },
): Occurrence[] {
  const out: Occurrence[] = [];
  let counted = 0;
  let walked = 0;
  for (const scheduledOn of raw(rule)) {
    if (++walked > WALK_LIMIT) break;
    if (rule.endMode === 'ON_DATE' && rule.endOn !== null && scheduledOn > rule.endOn) break;
    if (rule.endMode === 'AFTER_COUNT' && counted >= (rule.endAfterCount ?? 0)) break;
    counted++;
    if (counted <= skip) continue;
    const dueOn = adjust(scheduledOn, rule.holidayRule);
    if (from !== undefined && dueOn < from) continue;
    out.push({ scheduledOn, dueOn });
    if (out.length >= limit) break;
  }
  return out;
}

/** How many dates the rule gives in all, or null when it never ends (or is too long to count). */
export function totalDates(rule: RecurrenceRule): number | null {
  if (rule.endMode === 'NEVER') return null;
  if (rule.endMode === 'AFTER_COUNT') return rule.endAfterCount;
  return schedule(rule, { limit: WALK_LIMIT }).length;
}

/**
 * The latest due date whose task is made by `today`: a task is made once its due date is within
 * the lead time, or (period start) once its due date's period has begun, that is, on or before the
 * end of today's period. The generator asks for exactly the occurrences due on or before it.
 */
export function generationCutoff(
  rule: Pick<RecurrenceRule, 'unit'>,
  today: string,
  { atPeriodStart, leadDays }: { atPeriodStart: boolean; leadDays: number | null },
): string {
  if (!atPeriodStart) return addDays(today, leadDays ?? defaultLead(rule.unit));
  const { y, m } = parse(today);
  switch (rule.unit) {
    case 'DAY':
      return today;
    case 'WEEK':
      return addDays(today, 6 - ((weekdayOf(today) + 6) % 7));
    case 'MONTH':
      return make(y, m, daysIn(y, m));
    case 'QUARTER':
      return make(y, m - (m % 3) + 2, daysIn(y, m - (m % 3) + 2));
    case 'YEAR':
      return make(y, 11, 31);
  }
}

/** With no lead time set, a daily or weekly task is made on its day and others a week ahead. */
export const defaultLead = (unit: RecurrenceUnit) => (unit === 'DAY' || unit === 'WEEK' ? 0 : 7);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', 'last'];
const UNIT: Record<RecurrenceUnit, string> = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
};

/** "Every 2 weeks on Mon, Wed", "Every month on the 2nd Tue", for the series list. */
export function describe(rule: RecurrenceRule): string {
  const every =
    rule.interval === 1 ? `Every ${UNIT[rule.unit]}` : `Every ${rule.interval} ${UNIT[rule.unit]}s`;
  let where = '';
  if (rule.unit === 'WEEK' && rule.pattern.weekdays?.length) {
    where = ` on ${[...rule.pattern.weekdays]
      .sort((a, b) => a - b)
      .map((d) => DAYS[d])
      .join(', ')}`;
  } else if (
    (rule.unit === 'MONTH' || rule.unit === 'QUARTER') &&
    rule.pattern.monthly === 'NTH_WEEKDAY'
  ) {
    where = ` on the ${ORDINAL[rule.pattern.nth ?? 1]} ${DAYS[rule.pattern.weekday ?? 0]}`;
  } else if (rule.unit === 'MONTH' || rule.unit === 'QUARTER') {
    where = ` on day ${parse(rule.startOn).d}`;
  }
  const end =
    rule.endMode === 'AFTER_COUNT'
      ? `, ${rule.endAfterCount} times`
      : rule.endMode === 'ON_DATE'
        ? `, until ${rule.endOn}`
        : '';
  return `${every}${where}${end}`;
}
