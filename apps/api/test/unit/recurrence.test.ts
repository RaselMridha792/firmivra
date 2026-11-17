// R55: the dates of a recurring task. Pure functions: a preview and the generator must agree, and a
// retry must give the same dates (the occurrence key is the scheduled date).
import { describe, expect, it } from 'vitest';
import { zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import {
  adjust,
  federalHolidays,
  generationCutoff,
  describe as describeRule,
  type RecurrenceRule,
  schedule,
  totalDates,
} from '../../src/tasks/recurrence.js';

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  interval: 1,
  unit: 'MONTH',
  pattern: {},
  startOn: '2026-01-31',
  endMode: 'NEVER',
  endAfterCount: null,
  endOn: null,
  holidayRule: 'NONE',
  ...over,
});
const dates = (r: RecurrenceRule, limit = 6, extra: { from?: string; skip?: number } = {}) =>
  schedule(r, { limit, ...extra }).map((o) => o.scheduledOn);

describe('schedule', () => {
  it('repeats every N days', () => {
    expect(dates(rule({ unit: 'DAY', interval: 3, startOn: '2026-02-26' }), 4)).toEqual([
      '2026-02-26',
      '2026-03-01',
      '2026-03-04',
      '2026-03-07',
    ]);
  });

  it('repeats weekly on the chosen weekdays, every N weeks', () => {
    // 2026-11-02 is a Monday.
    const weekly = rule({ unit: 'WEEK', startOn: '2026-11-02', pattern: { weekdays: [1, 3] } });
    expect(dates(weekly, 5)).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-09',
      '2026-11-11',
      '2026-11-16',
    ]);
    expect(dates({ ...weekly, interval: 2 }, 4)).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-16',
      '2026-11-18',
    ]);
    // With no weekday chosen, the start date's weekday.
    expect(dates(rule({ unit: 'WEEK', startOn: '2026-11-04' }), 3)).toEqual([
      '2026-11-04',
      '2026-11-11',
      '2026-11-18',
    ]);
    // A start after the first chosen weekday of its week begins with the next one.
    expect(
      dates(rule({ unit: 'WEEK', startOn: '2026-11-03', pattern: { weekdays: [1, 3] } }), 2),
    ).toEqual(['2026-11-04', '2026-11-09']);
  });

  it('puts a 31st in a short month on its last day, and returns to the 31st', () => {
    expect(dates(rule({ startOn: '2026-01-31' }), 5)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    // A leap year keeps the 29th.
    expect(dates(rule({ startOn: '2027-12-31' }), 3)).toEqual([
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
    ]);
  });

  it('repeats every quarter, and every N months across a year end', () => {
    expect(dates(rule({ unit: 'QUARTER', startOn: '2026-11-15' }), 3)).toEqual([
      '2026-11-15',
      '2027-02-15',
      '2027-05-15',
    ]);
    expect(dates(rule({ interval: 5, startOn: '2026-10-10' }), 3)).toEqual([
      '2026-10-10',
      '2027-03-10',
      '2027-08-10',
    ]);
  });

  it('repeats on the nth weekday of the month, the last one for 5', () => {
    // 2nd Tuesday.
    const second = rule({
      startOn: '2026-11-01',
      pattern: { monthly: 'NTH_WEEKDAY', nth: 2, weekday: 2 },
    });
    expect(dates(second, 3)).toEqual(['2026-11-10', '2026-12-08', '2027-01-12']);
    // The last Friday.
    const last = rule({
      startOn: '2026-11-01',
      pattern: { monthly: 'NTH_WEEKDAY', nth: 5, weekday: 5 },
    });
    expect(dates(last, 3)).toEqual(['2026-11-27', '2026-12-25', '2027-01-29']);
  });

  it('repeats every year, a 29 February on the 28th in other years', () => {
    expect(dates(rule({ unit: 'YEAR', startOn: '2028-02-29' }), 3)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ]);
    expect(dates(rule({ unit: 'YEAR', interval: 2, startOn: '2026-04-15' }), 3)).toEqual([
      '2026-04-15',
      '2028-04-15',
      '2030-04-15',
    ]);
  });

  it('ends after exactly N dates, or on a date', () => {
    const count = rule({
      unit: 'DAY',
      startOn: '2026-11-01',
      endMode: 'AFTER_COUNT',
      endAfterCount: 3,
    });
    expect(dates(count, 10)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(totalDates(count)).toBe(3);
    const until = rule({
      unit: 'DAY',
      startOn: '2026-11-01',
      endMode: 'ON_DATE',
      endOn: '2026-11-03',
    });
    expect(dates(until, 10)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(totalDates(until)).toBe(3);
    expect(totalDates(rule({ unit: 'DAY' }))).toBeNull();
  });

  it('counts the end from the start even when it only looks ahead', () => {
    const count = rule({
      unit: 'DAY',
      startOn: '2026-11-01',
      endMode: 'AFTER_COUNT',
      endAfterCount: 5,
    });
    // The first five are Nov 1 to 5: looking from the 4th leaves two, not five.
    expect(dates(count, 10, { from: '2026-11-04' })).toEqual(['2026-11-04', '2026-11-05']);
    // Three of the five are already made.
    expect(dates(count, 10, { skip: 3 })).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('is the same on every call', () => {
    const r = rule({ unit: 'WEEK', startOn: '2026-11-02', pattern: { weekdays: [1, 5] } });
    expect(schedule(r, { limit: 20 })).toEqual(schedule(r, { limit: 20 }));
  });
});

describe('holidays', () => {
  it('moves a weekend date to the next or previous weekday and leaves the key alone', () => {
    // 2026-11-07 is a Saturday, 2026-11-08 a Sunday.
    expect(adjust('2026-11-07', 'NEXT_BUSINESS_DAY')).toBe('2026-11-09');
    expect(adjust('2026-11-08', 'NEXT_BUSINESS_DAY')).toBe('2026-11-09');
    expect(adjust('2026-11-07', 'PREVIOUS_BUSINESS_DAY')).toBe('2026-11-06');
    expect(adjust('2026-11-08', 'PREVIOUS_BUSINESS_DAY')).toBe('2026-11-06');
    expect(adjust('2026-11-07', 'NONE')).toBe('2026-11-07');
    expect(adjust('2026-11-06', 'NEXT_BUSINESS_DAY')).toBe('2026-11-06');
    const r = rule({ unit: 'DAY', startOn: '2026-11-06', holidayRule: 'NEXT_BUSINESS_DAY' });
    expect(schedule(r, { limit: 3 })).toEqual([
      { scheduledOn: '2026-11-06', dueOn: '2026-11-06' },
      { scheduledOn: '2026-11-07', dueOn: '2026-11-09' },
      { scheduledOn: '2026-11-08', dueOn: '2026-11-09' },
    ]);
  });
});

describe('the recurrence rules (Tasks Review Two T-D14, DECISIONS)', () => {
  it('holidays: US federal, as observed; NEXT_BUSINESS_DAY moves past them and weekends', () => {
    expect([...federalHolidays(2027)].filter((d) => d.startsWith('2027')).sort()).toEqual([
      '2027-01-01', // New Year's Day (Friday)
      '2027-01-18', // Martin Luther King Jr. Day
      '2027-02-15', // Washington's Birthday
      '2027-05-31', // Memorial Day
      '2027-06-18', // Juneteenth, a Saturday, kept on Friday
      '2027-07-05', // Independence Day, a Sunday, kept on Monday
      '2027-09-06', // Labor Day
      '2027-10-11', // Columbus Day
      '2027-11-11', // Veterans Day
      '2027-11-25', // Thanksgiving
      '2027-12-24', // Christmas, a Saturday, kept on Friday
      '2027-12-31', // New Year's Day 2028, a Saturday, kept on Friday
    ]);
    expect(adjust('2026-11-26', 'NEXT_BUSINESS_DAY')).toBe('2026-11-27'); // Thanksgiving
    expect(adjust('2027-07-04', 'NEXT_BUSINESS_DAY')).toBe('2027-07-06'); // Sunday, then kept Monday
    expect(adjust('2027-12-24', 'NEXT_BUSINESS_DAY')).toBe('2027-12-27'); // over the weekend
    // Across the year: 31 Dec 2027 is New Year's Day kept, then a weekend.
    expect(adjust('2027-12-31', 'NEXT_BUSINESS_DAY')).toBe('2028-01-03');
    expect(adjust('2027-01-01', 'PREVIOUS_BUSINESS_DAY')).toBe('2026-12-31');
    expect(adjust('2027-07-05', 'NONE')).toBe('2027-07-05');
    // The key stays the scheduled date; only the due date moves.
    const r = rule({ unit: 'YEAR', startOn: '2026-11-26', holidayRule: 'NEXT_BUSINESS_DAY' });
    expect(schedule(r, { limit: 1 })).toEqual([{ scheduledOn: '2026-11-26', dueOn: '2026-11-27' }]);
  });

  it("time zone: the firm's day follows its zone, DST included; dates never shift with DST", () => {
    // 14 March 2027: New York moves to daylight time at 2:00.
    const ny = 'America/New_York';
    expect(zonedDate(ny, Date.parse('2027-03-15T03:30:00Z'))).toBe('2027-03-14'); // 23:30 EDT
    expect(zonedDate(ny, Date.parse('2027-03-15T04:30:00Z'))).toBe('2027-03-15');
    expect(zonedDate(ny, Date.parse('2027-11-08T04:30:00Z'))).toBe('2027-11-07'); // 23:30 EST
    expect(new Date(zonedInstant(ny, '2027-03-15', 0)).toISOString()).toBe(
      '2027-03-15T04:00:00.000Z',
    );
    expect(new Date(zonedInstant(ny, '2027-03-13', 0)).toISOString()).toBe(
      '2027-03-13T05:00:00.000Z',
    );
    // A weekly series keeps its weekday across the change.
    const weekly = rule({ unit: 'WEEK', startOn: '2027-03-08', pattern: { weekdays: [1] } });
    expect(dates(weekly, 3)).toEqual(['2027-03-08', '2027-03-15', '2027-03-22']);
  });

  it('lead time and start of period: as configured, else the default by unit', () => {
    expect(
      generationCutoff({ unit: 'MONTH' }, '2027-03-10', { atPeriodStart: false, leadDays: 5 }),
    ).toBe('2027-03-15');
    expect(
      generationCutoff({ unit: 'MONTH' }, '2027-03-10', { atPeriodStart: true, leadDays: 5 }),
    ).toBe('2027-03-31');
  });

  it('month end: a day the month lacks falls on its last day, and comes back in long months', () => {
    expect(dates(rule({ startOn: '2027-01-30' }), 4)).toEqual([
      '2027-01-30',
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
    ]);
  });

  it('leap years: 29 Feb is 28 Feb in other years; a month from 31 Jan is 29 Feb in a leap year', () => {
    expect(dates(rule({ unit: 'YEAR', startOn: '2028-02-29' }), 3)).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ]);
    expect(dates(rule({ startOn: '2028-01-31' }), 2)).toEqual(['2028-01-31', '2028-02-29']);
  });
});

describe('generationCutoff', () => {
  // A task for a due date is made when that date is on or before the cutoff.
  const cut = (unit: RecurrenceRule['unit'], leadDays: number | null, atPeriodStart = false) =>
    generationCutoff({ unit }, '2026-11-18', { atPeriodStart, leadDays });

  it('is today plus the lead time, a default by unit when none is set', () => {
    expect(cut('MONTH', 10)).toBe('2026-11-28');
    expect(cut('MONTH', 0)).toBe('2026-11-18');
    expect(cut('MONTH', null)).toBe('2026-11-25');
    expect(cut('QUARTER', null)).toBe('2026-11-25');
    expect(cut('WEEK', null)).toBe('2026-11-18');
    expect(cut('DAY', null)).toBe('2026-11-18');
  });

  it('is the end of today’s period when tasks are made at the start of their period', () => {
    // 2026-11-18 is a Wednesday: a week runs Monday to Sunday.
    expect(cut('DAY', 3, true)).toBe('2026-11-18');
    expect(cut('WEEK', 3, true)).toBe('2026-11-22');
    expect(cut('MONTH', 3, true)).toBe('2026-11-30');
    expect(cut('QUARTER', 3, true)).toBe('2026-12-31');
    expect(cut('YEAR', 3, true)).toBe('2026-12-31');
    const feb = generationCutoff({ unit: 'MONTH' }, '2028-02-10', {
      atPeriodStart: true,
      leadDays: null,
    });
    expect(feb).toBe('2028-02-29');
    const q1 = generationCutoff({ unit: 'QUARTER' }, '2026-02-10', {
      atPeriodStart: true,
      leadDays: null,
    });
    expect(q1).toBe('2026-03-31');
  });
});

describe('describe', () => {
  it('words a rule for the list', () => {
    expect(describeRule(rule({ unit: 'WEEK', interval: 2, pattern: { weekdays: [3, 1] } }))).toBe(
      'Every 2 weeks on Mon, Wed',
    );
    expect(describeRule(rule({ startOn: '2026-11-05' }))).toBe('Every month on day 5');
    expect(describeRule(rule({ pattern: { monthly: 'NTH_WEEKDAY', nth: 5, weekday: 5 } }))).toBe(
      'Every month on the last Fri',
    );
    expect(describeRule(rule({ unit: 'YEAR', endMode: 'AFTER_COUNT', endAfterCount: 3 }))).toBe(
      'Every year, 3 times',
    );
    expect(describeRule(rule({ unit: 'DAY', endMode: 'ON_DATE', endOn: '2027-01-01' }))).toBe(
      'Every day, until 2027-01-01',
    );
  });
});
