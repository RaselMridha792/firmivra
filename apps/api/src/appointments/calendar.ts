// Pure calendar logic for appointments (R12 step 2): the firm's time zone, free slots on a
// 15-minute grid, the portal's choice of staff member and the client's change window. No
// database here, so the unit tests cover it directly (test/unit/appointments.test.ts).

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Slots start on this grid (System Wiring section 2). */
export const GRID_MINUTES = 15;
/**
 * The client's change window, in hours before the start. Per type once R0 adds
 * appointment_types.cancel_cutoff_hours; until then every type (and no type) uses this.
 */
export const DEFAULT_CUTOFF_HOURS = 24;
/** The firm's time zone when it has no settings row yet (the column's default). */
export const DEFAULT_TIME_ZONE = 'America/New_York';

/** A half-open span of time [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

/** One range of a member's regular week; times of day in the firm's time zone. */
export interface WorkingRange {
  weekday: number;
  startsAt: string;
  endsAt: string;
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** A time zone Intl knows, else the default (settings only store canonical IANA names). */
export function usableTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms (New York in July: -4 h). */
export function offsetAt(timeZone: string, instant: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant when the wall clock in `timeZone` shows `date` (YYYY-MM-DD) at `minutes` past
 * midnight. A time skipped by a daylight-saving change maps next to the gap; a repeated one to
 * its first occurrence.
 */
export function zonedInstant(timeZone: string, date: string, minutes: number): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE;
  const first = wall - offsetAt(timeZone, wall);
  return wall - offsetAt(timeZone, first);
}

/** The calendar date (YYYY-MM-DD) of `instant` in `timeZone`. */
export function zonedDate(timeZone: string, instant: number): string {
  return new Date(instant + offsetAt(timeZone, instant)).toISOString().slice(0, 10);
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** 0 = Sunday ... 6 = Saturday, as working_hours.weekday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "09:30" to 570. */
export function minutesOf(timeOfDay: string): number {
  const [h, m] = timeOfDay.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A TIME column (Prisma reads it as a date on 1970-01-01, UTC) to "HH:MM", and back. */
export const timeOfDayFromDb = (value: Date) => value.toISOString().slice(11, 16);
export const timeOfDayToDb = (timeOfDay: string) => new Date(`1970-01-01T${timeOfDay}:00.000Z`);

/** One weekday's ranges in minutes, sorted, with touching ranges joined (09-12 and 12-13). */
export function dayRanges(hours: readonly WorkingRange[], weekday: number): [number, number][] {
  const ranges = hours
    .filter((h) => h.weekday === weekday)
    .map((h): [number, number] => [minutesOf(h.startsAt), minutesOf(h.endsAt)])
    .sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = joined.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined;
}

export interface SlotQuery {
  timeZone: string;
  /** First and last calendar date, both included (firm time zone). */
  from: string;
  to: string;
  /** The appointment's length. */
  minutes: number;
  /** Not before this instant (now): a start at or before it is not offered. */
  notBefore: number;
}

/**
 * Starts on the 15-minute grid of one member's working hours where `minutes` fit inside the
 * range, after `notBefore`, ignoring what is busy. Ranges count from their start, so a range
 * that starts at 09:00 offers 09:00, 09:15, ...
 */
export function gridStarts(query: SlotQuery, hours: readonly WorkingRange[]): Interval[] {
  const out: Interval[] = [];
  const length = query.minutes * MINUTE;
  for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
    for (const [startMin, endMin] of dayRanges(hours, weekdayOf(date))) {
      const rangeEnd = zonedInstant(query.timeZone, date, endMin);
      for (
        let start = zonedInstant(query.timeZone, date, startMin);
        start + length <= rangeEnd;
        start += GRID_MINUTES * MINUTE
      ) {
        if (start > query.notBefore) out.push({ start, end: start + length });
      }
    }
  }
  return out;
}

/** The grid starts that overlap nothing in `busy` (appointments, blocked time). */
export function freeStarts(
  query: SlotQuery,
  hours: readonly WorkingRange[],
  busy: readonly Interval[],
): Interval[] {
  return gridStarts(query, hours).filter((slot) => !busy.some((b) => overlaps(b, slot)));
}

export interface Candidate {
  userId: string;
  name: string;
  /** Live appointments that firm-local day. */
  load: number;
}

/**
 * The portal's staff member (R12 Decisions): the client's assigned member when free, otherwise
 * the free member with the fewest appointments that day (then by name, for a stable answer).
 */
export function pickStaff(
  free: readonly Candidate[],
  assignedUserId: string | null,
): Candidate | undefined {
  const assigned = free.find((c) => c.userId === assignedUserId);
  if (assigned) return assigned;
  return [...free].sort(
    (a, b) =>
      a.load - b.load ||
      a.name.localeCompare(b.name) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )[0];
}

/**
 * The last moment a client may reschedule or cancel: `cutoffHours` before the start (0 = until
 * the start), or null when that is past or the appointment is final.
 */
export function changeableUntil(
  appointment: { status: string; startsAt: Date },
  cutoffHours: number,
  now: number,
): Date | null {
  if (appointment.status !== 'SCHEDULED') return null;
  const last = appointment.startsAt.getTime() - cutoffHours * HOUR;
  return last > now ? new Date(last) : null;
}
