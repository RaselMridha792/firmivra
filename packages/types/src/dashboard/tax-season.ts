import { z } from 'zod';

/**
 * Dashboard Review 2, "Tax season context": the firm's tax season is `MM-DD` to `MM-DD`, every year
 * in the firm's time zone, from its settings (never hard-coded). A day every year has, so never
 * Feb 29 (the same rule as the database's check).
 */
export const MONTH_DAY =
  /^((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))$/;

export const MonthDay = z
  .string()
  .trim()
  .regex(MONTH_DAY, 'Choose a day of the year (Feb 29 is not a choice)');

export interface TaxSeasonDates {
  /** YYYY-MM-DD, the first day of the season. */
  start: string;
  /** YYYY-MM-DD, the last day of the season. */
  end: string;
  /** Today is in this season; otherwise it is the next one (Off-Season). */
  inSeason: boolean;
}

/**
 * The season `today` (YYYY-MM-DD, the firm's today) is in, or else the next one; null when the
 * firm has none. A season whose start comes after its end runs across Jan 1 (Dec 1 to Apr 30).
 */
export function seasonOf(
  start: string | null | undefined,
  end: string | null | undefined,
  today: string,
): TaxSeasonDates | null {
  if (!start || !end) return null;
  const year = Number(today.slice(0, 4));
  const day = today.slice(5);
  const at = (y: number, md: string) => `${y}-${md}`;
  if (start <= end) {
    if (day >= start && day <= end)
      return { start: at(year, start), end: at(year, end), inSeason: true };
    const y = day < start ? year : year + 1;
    return { start: at(y, start), end: at(y, end), inSeason: false };
  }
  // Across Jan 1: in season from the start to the year's end, and from Jan 1 to the end.
  if (day >= start) return { start: at(year, start), end: at(year + 1, end), inSeason: true };
  if (day <= end) return { start: at(year - 1, start), end: at(year, end), inSeason: true };
  return { start: at(year, start), end: at(year + 1, end), inSeason: false };
}
