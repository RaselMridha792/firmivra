import type {
  SupportPriorityColor,
  SupportSlaState,
  SupportTarget,
  SupportTicketSla,
} from '@firmivra/types';

// The support clock (R60 on R0's B2): due times, the SLA state and the stored forms of targets
// and colours. Pure functions, so the list, the summary, Ticket Detail and the rules agree.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** A business day as stored (the seeded Medium is 480 minutes = 1 business day). */
export const STORED_BUSINESS_DAY = 480;

export interface SupportHours {
  timeZone: string;
  /** One opening per weekday that opens: 0 is Sunday. */
  days: { day: number; open: boolean; start: string; end: string }[];
  /** `YYYY-MM-DD` days the clock stops. */
  holidays: readonly string[];
  clock: 'BUSINESS' | 'CALENDAR';
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
};
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day, weekday and minute of the day at `ms` in `timeZone`. */
export function zoned(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY.indexOf(get('weekday') ?? ''),
    clock: (Number(get('hour') ?? 0) % 24) * 60 + Number(get('minute') ?? 0),
    seconds: Number(get('second') ?? 0),
  };
}

/** The open minutes of the day at `ms`, as [open, close) minute-of-day, or null when closed. */
function openingOf(ms: number, hours: SupportHours) {
  const z = zoned(ms, hours.timeZone);
  const day = hours.days.find((d) => d.day === z.weekday);
  if (!day?.open || hours.holidays.includes(z.date)) return { z, open: null };
  return { z, open: [toMinutes(day.start), toMinutes(day.end)] as const };
}

/** The start of the next calendar day in the zone (from a moment `clock` minutes into today). */
const nextDay = (ms: number, z: ReturnType<typeof zoned>) =>
  ms + (24 * 60 - z.clock) * MINUTE - z.seconds * 1000;

/** `minutes` of open time after `startMs`: closed days, after hours and holidays don't count. */
export function addBusinessMinutes(startMs: number, minutes: number, hours: SupportHours): number {
  let at = startMs;
  let left = minutes;
  for (let guard = 0; guard < 800; guard++) {
    const { z, open } = openingOf(at, hours);
    if (open) {
      const from = Math.max(z.clock, open[0]);
      if (from < open[1]) {
        const begin = at + (from - z.clock) * MINUTE - (from > z.clock ? z.seconds * 1000 : 0);
        if (left <= open[1] - from) return begin + left * MINUTE;
        left -= open[1] - from;
      }
    }
    at = nextDay(at, z);
  }
  return at;
}

/** Open minutes from `fromMs` to `toMs` (negative when `toMs` is earlier). */
export function businessMinutesBetween(fromMs: number, toMs: number, hours: SupportHours): number {
  if (toMs < fromMs) return -businessMinutesBetween(toMs, fromMs, hours);
  let at = fromMs;
  let total = 0;
  for (let guard = 0; guard < 800 && at < toMs; guard++) {
    const { z, open } = openingOf(at, hours);
    const end = nextDay(at, z);
    if (open) {
      const from = Math.max(z.clock, open[0]);
      const untilToday = Math.min(open[1], z.clock + (Math.min(end, toMs) - at) / MINUTE);
      if (untilToday > from) total += untilToday - from;
    }
    at = end;
  }
  return Math.round(total);
}

/** The length of an open day (the first open day's), at least an hour; 8 hours when none. */
export function businessDayMinutes(hours: SupportHours): number {
  const day = hours.days.find((d) => d.open);
  return day ? Math.max(60, toMinutes(day.end) - toMinutes(day.start)) : 8 * 60;
}

/** A stored target (minutes) as the page shows it. */
export function targetOf(minutes: number): SupportTarget {
  return minutes % STORED_BUSINESS_DAY === 0
    ? { amount: minutes / STORED_BUSINESS_DAY, unit: 'BUSINESS_DAYS' }
    : { amount: Math.max(1, Math.round(minutes / 60)), unit: 'HOURS' };
}

/** A target as stored (minutes). */
export const storedMinutes = (target: SupportTarget): number =>
  target.unit === 'HOURS' ? target.amount * 60 : target.amount * STORED_BUSINESS_DAY;

/** The minutes a target runs on the support clock (a business day is an open day's length). */
export function clockMinutes(stored: number, hours: SupportHours): number {
  const target = targetOf(stored);
  if (target.unit === 'HOURS') return target.amount * 60;
  return target.amount * (hours.clock === 'CALENDAR' ? 24 * 60 : businessDayMinutes(hours));
}

/** When a clock started at `startMs` with a stored target runs out. */
export function dueTime(startMs: number, stored: number, hours: SupportHours): number {
  const minutes = clockMinutes(stored, hours);
  return hours.clock === 'CALENDAR'
    ? startMs + minutes * MINUTE
    : addBusinessMinutes(startMs, minutes, hours);
}

/** Minutes left on the support clock until `dueMs` (negative once past). */
export function clockMinutesLeft(nowMs: number, dueMs: number, hours: SupportHours): number {
  return hours.clock === 'CALENDAR'
    ? Math.round((dueMs - nowMs) / MINUTE)
    : businessMinutesBetween(nowMs, dueMs, hours);
}

/**
 * The due time after a priority change: the time already used counts against the new target.
 * Past due stays past due.
 */
export function rescheduledDue(
  nowMs: number,
  dueMs: number,
  oldStored: number,
  newStored: number,
  hours: SupportHours,
): number {
  const left = clockMinutesLeft(nowMs, dueMs, hours);
  const used = clockMinutes(oldStored, hours) - left;
  const remaining = clockMinutes(newStored, hours) - used;
  if (remaining <= 0) return Math.min(dueMs, nowMs);
  return hours.clock === 'CALENDAR'
    ? nowMs + remaining * MINUTE
    : addBusinessMinutes(nowMs, remaining, hours);
}

export interface SlaFacts {
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  dueAt: Date | null;
  /** A breach was recorded for this ticket. */
  breached: boolean;
  /** The priority's stored response target. */
  targetMinutes: number;
  pauseWhileWaiting: boolean;
}

/**
 * The response clock's state: done tickets are MET or BREACHED; waiting (when the settings pause
 * it) is PAUSED; otherwise BREACHED past due, WARNING under a quarter of the target left, WITHIN.
 */
export function slaOf(facts: SlaFacts, hours: SupportHours, nowMs: number): SupportTicketSla {
  if (facts.status === 'RESOLVED' || facts.status === 'CLOSED')
    return { state: facts.breached ? 'BREACHED' : 'MET', dueAt: null, minutesLeft: null };
  if (facts.status === 'WAITING_ON_CUSTOMER' && facts.pauseWhileWaiting)
    return { state: 'PAUSED', dueAt: null, minutesLeft: null };
  if (!facts.dueAt) return { state: 'WITHIN', dueAt: null, minutesLeft: null };
  const due = facts.dueAt.getTime();
  const left = clockMinutesLeft(nowMs, due, hours);
  const state: SupportSlaState =
    due <= nowMs
      ? 'BREACHED'
      : left * 4 < clockMinutes(facts.targetMinutes, hours)
        ? 'WARNING'
        : 'WITHIN';
  return {
    state,
    dueAt: facts.dueAt.toISOString(),
    minutesLeft: Math.round((due - nowMs) / MINUTE),
  };
}

// ---------- Stored colours ----------

export const COLOR_HEX: Readonly<Record<SupportPriorityColor, string>> = {
  red: '#DC2626',
  orange: '#EA580C',
  yellow: '#CA8A04',
  green: '#16A34A',
  blue: '#2563EB',
  purple: '#9333EA',
  grey: '#6B7280',
};

/** A stored hex as a named colour; an unknown one is grey. */
export function colorOf(hex: string): SupportPriorityColor {
  const found = (Object.entries(COLOR_HEX) as [SupportPriorityColor, string][]).find(
    ([, value]) => value.toLowerCase() === hex.toLowerCase(),
  );
  return found?.[0] ?? 'grey';
}

// ---------- Days ----------

/** `YYYY-MM-DD` in the zone. */
export const dayIn = (ms: number, timeZone: string) => zoned(ms, timeZone).date;

/** Whether `ms` falls on a day from `from` to `to` (inclusive) in the zone. */
export function inDays(ms: number, timeZone: string, from?: string, to?: string): boolean {
  const day = dayIn(ms, timeZone);
  return (!from || day >= from) && (!to || day <= to);
}

export const DAYS = { MINUTE, DAY };
