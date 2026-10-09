// Calendar dates are firm-local 'YYYY-MM-DD' strings; instants are ISO strings (the API sends UTC).
// The firm's time zone comes from the API (Availability.timezone); working hours are in it.

const DAY_MS = 86_400_000;

/** The wall-clock fields of an instant in a time zone. */
function wallClock(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

const asUtc = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);

/**
 * A whole 'YYYY-MM-DD' date in the API's range (2000 to 2100). A date input reports half-typed
 * years such as 0202-10-12 while someone types: check before using one.
 */
export const isCalendarDate = (value: string) => {
  const year = Number(value.slice(0, 4));
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    year >= 2000 &&
    year <= 2100 &&
    !Number.isNaN(asUtc(value, '00:00'))
  );
};

/** How far the zone's clock is ahead of UTC at an instant, in ms. */
const offsetAt = (ms: number, timeZone: string) => {
  const wall = wallClock(ms, timeZone);
  return asUtc(wall.date, wall.time) - (ms - (ms % 60_000));
};

/** The firm-local date and time ('HH:MM') of an instant. */
export const localParts = (iso: string, timeZone: string) => wallClock(Date.parse(iso), timeZone);

/** The instant of a firm-local date and time, as an ISO string. */
export function toInstant(date: string, time: string, timeZone: string): string {
  const wall = asUtc(date, time);
  const guess = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(guess, timeZone)).toISOString();
}

export const addDays = (date: string, days: number) =>
  new Date(asUtc(date, '00:00') + days * DAY_MS).toISOString().slice(0, 10);

/** 0 is Sunday, as in the API's Weekday. */
export const weekdayOf = (date: string) => new Date(asUtc(date, '00:00')).getUTCDay();

/** The Monday of the date's week. */
export const weekStart = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

export const todayIn = (timeZone: string) => wallClock(Date.now(), timeZone).date;

export const dayLabel = (date: string) =>
  new Date(asUtc(date, '12:00')).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

export const timeLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
