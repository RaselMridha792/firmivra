// When a scheduled report next runs, in the firm's time zone. A run time is a wall-clock time in the
// zone (08:00 in New York is 12:00 or 13:00 UTC by the season), a monthly day past the month's end
// is the last day, and a quarterly schedule runs in the first month of each quarter.

type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

export interface ScheduleRule {
  frequency: Frequency;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  /** HH:mm (or HH:mm:ss) in the firm's zone. */
  runTime: string;
}

/** The instant a wall-clock day and time in `timezone` is (the offset by the zone's rules that day). */
export function zonedInstant(day: string, time: string, timezone: string): Date {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const guess = Date.parse(
    `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
  );
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
  };
  // Two passes settle the offset around a daylight-saving change.
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms);
  return new Date(ms);
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The first run strictly after `after` (default now). */
export function nextRun(rule: ScheduleRule, timezone: string, after = new Date()): Date {
  const time = rule.runTime.slice(0, 5);
  const localToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(after);
  const [y0, m0, d0] = localToday.split('-').map(Number) as [number, number, number];
  const candidates: string[] = [];
  if (rule.frequency === 'DAILY') {
    for (let i = 0; i < 3; i++)
      candidates.push(new Date(Date.UTC(y0, m0 - 1, d0 + i)).toISOString().slice(0, 10));
  } else if (rule.frequency === 'WEEKLY') {
    for (let i = 0; i < 9; i++) {
      const d = new Date(Date.UTC(y0, m0 - 1, d0 + i));
      if (d.getUTCDay() === rule.weekday) candidates.push(d.toISOString().slice(0, 10));
    }
  } else {
    // Monthly: every month; quarterly: Jan, Apr, Jul, Oct; annual: one month a year.
    for (let i = 0; i < 40; i++) {
      const month0 = m0 - 1 + i;
      const y = y0 + Math.floor(month0 / 12);
      const m = (month0 % 12) + 1;
      if (rule.frequency === 'QUARTERLY' && (m - 1) % 3 !== 0) continue;
      if (rule.frequency === 'ANNUAL' && m !== rule.monthOfYear) continue;
      candidates.push(ymd(y, m, Math.min(rule.dayOfMonth ?? 1, lastDay(y, m))));
    }
  }
  for (const day of candidates) {
    const at = zonedInstant(day, time, timezone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('no next run found');
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Every Monday at 8:00 AM", "Monthly on the 1st at 6:30 PM". */
export function describeSchedule(rule: ScheduleRule): string {
  const [h, m] = rule.runTime.split(':').map(Number) as [number, number];
  const at = `${h % 12 === 0 ? 12 : h % 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  switch (rule.frequency) {
    case 'DAILY':
      return `Every day at ${at}`;
    case 'WEEKLY':
      return `Every ${WEEKDAYS[rule.weekday ?? 0]} at ${at}`;
    case 'MONTHLY':
      return `Monthly on the ${ordinal(rule.dayOfMonth ?? 1)} at ${at}`;
    case 'QUARTERLY':
      return `Quarterly on the ${ordinal(rule.dayOfMonth ?? 1)} at ${at}`;
    case 'ANNUAL':
      return `Every year on ${MONTHS[(rule.monthOfYear ?? 1) - 1]} ${rule.dayOfMonth ?? 1} at ${at}`;
  }
}
