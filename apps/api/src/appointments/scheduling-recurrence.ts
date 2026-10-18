import type { AppointmentRecurrence } from '@firmivra/types';
import { addDays, type Interval, MINUTE, weekdayOf, zonedDate, zonedInstant } from './calendar.js';

// Recurrence (Schedule Appointment > Recurrence): the series' occurrences as instants. Worked
// out in the firm's calendar (or the form's zone), so "every Tuesday at 10:00" stays 10:00 across
// a daylight saving change. The API makes one normal appointment per occurrence (the database
// comment on appointment_series). No database here (test/unit/scheduling.test.ts).

/** appointment_series: at most 52 occurrences. */
export const MAX_OCCURRENCES = 52;

export type Expansion = { ok: true; occurrences: Interval[] } | { ok: false; message: string };

const fail = (message: string): Expansion => ({ ok: false, message });

/** The first day of the month `months` after `date`'s, with `day` clamped to its length. */
function addMonths(date: string, months: number, day: number): string {
  const [y = 1970, m = 1] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    Math.min(day, last),
  ).padStart(2, '0')}`;
}

/** The booked time and, for a repeating one, the occurrences after it (the booked one first). */
export function expandRecurrence(
  timeZone: string,
  first: Interval,
  recurrence: AppointmentRecurrence | undefined,
): Expansion {
  if (!recurrence || recurrence.frequency === 'NONE') return { ok: true, occurrences: [first] };
  if (recurrence.frequency === 'CUSTOM') {
    return fail('Custom repeats are not available yet. Choose daily, weekly or monthly.');
  }
  const { until, count } = recurrence;
  if ((until === undefined) === (count === undefined)) {
    return fail('Choose when the series ends: on a date or after a number of times');
  }
  const interval = recurrence.interval ?? 1;
  const startDate = zonedDate(timeZone, first.start);
  const minuteOfDay = Math.round((first.start - zonedInstant(timeZone, startDate, 0)) / MINUTE);
  const length = first.end - first.start;
  const at = (date: string): Interval => {
    const start = zonedInstant(timeZone, date, minuteOfDay);
    return { start, end: start + length };
  };

  const dates: string[] = [startDate];
  const done = () => (count !== undefined ? dates.length >= count : false);
  const within = (date: string) => until === undefined || date <= until;
  const limit = MAX_OCCURRENCES + 1;

  if (recurrence.frequency === 'DAILY') {
    for (let n = 1; !done() && dates.length < limit; n++) {
      const date = addDays(startDate, n * interval);
      if (!within(date)) break;
      dates.push(date);
    }
  } else if (recurrence.frequency === 'WEEKLY') {
    const weekdays = [...new Set(recurrence.weekdays ?? [weekdayOf(startDate)])].sort();
    // Weeks start on Sunday, as weekday 0 does.
    const weekStart = addDays(startDate, -weekdayOf(startDate));
    for (let week = 0; !done() && dates.length < limit; week += interval) {
      for (const weekday of weekdays) {
        const date = addDays(weekStart, week * 7 + weekday);
        if (date <= startDate) continue;
        if (!within(date) || done() || dates.length >= limit) break;
        dates.push(date);
      }
      // Past the end date: no later week can fit.
      if (until !== undefined && addDays(weekStart, week * 7) > until) break;
    }
  } else {
    const day = Number(startDate.slice(8, 10));
    for (let n = 1; !done() && dates.length < limit; n++) {
      const date = addMonths(startDate, n * interval, day);
      if (!within(date)) break;
      dates.push(date);
    }
  }

  if (dates.length > MAX_OCCURRENCES) {
    return fail(`A series has at most ${MAX_OCCURRENCES} appointments. Shorten it.`);
  }
  const occurrences = dates.map((date, i) => (i === 0 ? first : at(date)));
  return { ok: true, occurrences };
}
