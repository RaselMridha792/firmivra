import { nextRun, type ScheduleRule } from '@firmivra/types';

/** "UTC\u221205:00" for the zone at that moment (it changes with daylight saving). */
export function offsetIn(timezone: string, at: Date): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT-05:00" becomes "UTC-05:00" with a real minus sign; "GMT" (no offset) is "UTC+00:00".
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '');
  return `UTC${offset.replace('-', '\u2212')}`;
}

/**
 * RP-F19 (Octavia's Reports review, Oct 28): the Schedule dialog's Next Run, computed with the
 * schedules' own rules in the firm's time zone, named with its offset. A rule the form cannot
 * run yet says what to fix instead.
 */
export function schedulePreview(
  rule: ScheduleRule,
  timezone: string,
  now: Date,
): { text: string } | { problem: string } {
  if (!/^\d{2}:\d{2}$/.test(rule.runTime.slice(0, 5))) return { problem: 'Choose a time.' };
  const day = rule.dayOfMonth;
  if (
    ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(rule.frequency) &&
    (day === null || !Number.isInteger(day) || day < 1 || day > 31)
  ) {
    return { problem: 'Choose a day of the month from 1 to 31.' };
  }
  const month = rule.monthOfYear;
  if (
    rule.frequency === 'ANNUAL' &&
    (month === null || !Number.isInteger(month) || month < 1 || month > 12)
  ) {
    return { problem: 'Choose a month from 1 to 12.' };
  }
  const at = nextRun(rule, timezone, now);
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
    .format(at)
    // Newer ICU puts a narrow no-break space before AM and PM.
    .replace(/\u202f/g, ' ');
  return { text: `${when} (${timezone}, ${offsetIn(timezone, at)})` };
}
