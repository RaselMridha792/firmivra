import { zonedInstant } from '@firmivra/types';

/**
 * Audit Log Review 2, R01: the log's times in the firm's time zone, whatever the viewer's
 * computer is set to. Stored times stay UTC; only the display and the date filter use the zone.
 */

/** An entry's time with the zone shown: "Nov 15, 2026, 2:50 PM CST". */
export const when = (iso: string, timeZone: string | undefined) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));

/** The calendar day after `day` (YYYY-MM-DD). */
const nextDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * A day in the firm's zone, from its first to its last moment, as the API's instants: Nov 15 in
 * America/Chicago is 06:00:00.000Z to Nov 16 05:59:59.999Z. A daylight-saving day is 23 or 25
 * hours long; its end is the next day's first moment less a millisecond.
 */
export function dayBounds(day: string, timeZone: string): { from: string; to: string } {
  const end = zonedInstant(nextDay(day), '00:00', timeZone).getTime() - 1;
  return {
    from: zonedInstant(day, '00:00', timeZone).toISOString(),
    to: new Date(end).toISOString(),
  };
}
