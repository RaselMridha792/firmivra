import { describe, expect, it } from 'vitest';
import { offsetIn, schedulePreview } from './schedule-preview';

// RP-F19: the Schedule dialog's Next Run, in the firm's zone, across daylight saving.
const NY = 'America/New_York';
const rule = {
  frequency: 'WEEKLY' as const,
  weekday: 1,
  dayOfMonth: null,
  monthOfYear: null,
  runTime: '08:00',
};

describe('schedulePreview', () => {
  it('names the next run in the firm zone with its offset', () => {
    // Friday Nov 6, 2026, noon UTC: the next Monday is Nov 9, in standard time.
    expect(schedulePreview(rule, NY, new Date('2026-11-06T12:00:00Z'))).toEqual({
      text: 'Mon, Nov 9, 2026, 8:00 AM EST (America/New_York, UTC−05:00)',
    });
  });

  it('follows daylight saving: a run after the March change is in daylight time', () => {
    const at = new Date('2027-03-10T12:00:00Z');
    expect(schedulePreview(rule, NY, at)).toEqual({
      text: 'Mon, Mar 15, 2027, 8:00 AM EDT (America/New_York, UTC−04:00)',
    });
  });

  it('runs later today when the time has not passed, and a month day past the end is the last day', () => {
    const daily = { ...rule, frequency: 'DAILY' as const, runTime: '18:30' };
    expect(schedulePreview(daily, NY, new Date('2026-11-06T12:00:00Z'))).toEqual({
      text: 'Fri, Nov 6, 2026, 6:30 PM EST (America/New_York, UTC−05:00)',
    });
    const monthly = { ...rule, frequency: 'MONTHLY' as const, dayOfMonth: 31 };
    expect(schedulePreview(monthly, NY, new Date('2026-11-06T12:00:00Z'))).toEqual({
      text: 'Mon, Nov 30, 2026, 8:00 AM EST (America/New_York, UTC−05:00)',
    });
  });

  it('says what to fix rather than guess', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(schedulePreview({ ...rule, runTime: '' }, NY, now)).toEqual({
      problem: 'Choose a time.',
    });
    expect(schedulePreview({ ...rule, frequency: 'MONTHLY', dayOfMonth: 32 }, NY, now)).toEqual({
      problem: 'Choose a day of the month from 1 to 31.',
    });
    expect(
      schedulePreview({ ...rule, frequency: 'ANNUAL', dayOfMonth: 1, monthOfYear: 13 }, NY, now),
    ).toEqual({ problem: 'Choose a month from 1 to 12.' });
  });

  it('writes the offset with a real minus sign, and UTC itself as +00:00', () => {
    expect(offsetIn('UTC', new Date('2026-11-06T12:00:00Z'))).toBe('UTC+00:00');
    expect(offsetIn('Asia/Kolkata', new Date('2026-11-06T12:00:00Z'))).toBe('UTC+05:30');
  });
});
