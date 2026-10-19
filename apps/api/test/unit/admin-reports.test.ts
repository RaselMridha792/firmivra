// Super Admin Reports & Analytics (R55): the ranges and their previous period, the month buckets,
// a recurring bill's monthly equivalent, and the builder's date presets.
import { describe, expect, it } from 'vitest';
import { datesOf } from '../../src/admin-reports/admin-report-builder.service.js';
import { monthlyCents, monthsTo, rangeOf, series } from '../../src/admin-reports/reports.common.js';

const today = new Date('2026-10-19T15:00:00Z');

describe('rangeOf', () => {
  it('defaults to the last 30 days and the 30 before them', () => {
    expect(rangeOf({}, today)).toEqual({
      from: '2026-09-20',
      to: '2026-10-19',
      previousFrom: '2026-08-21',
      previousTo: '2026-09-19',
    });
  });

  it('takes an asked range and gives the previous one of equal length', () => {
    expect(rangeOf({ from: '2026-10-01', to: '2026-10-07' }, today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
      previousFrom: '2026-09-24',
      previousTo: '2026-09-30',
    });
  });
});

describe('months', () => {
  it('lists the six months ending with the range, across a year', () => {
    expect(monthsTo('2026-02-10')).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('sums by month, zero where nothing happened, ignoring rows outside', () => {
    const rows = [
      { at: new Date('2026-09-03T00:00:00Z'), n: 2 },
      { at: new Date('2026-09-30T23:00:00Z'), n: 3 },
      { at: new Date('2026-01-01T00:00:00Z'), n: 9 },
    ];
    expect(
      series(
        ['2026-08', '2026-09'],
        rows,
        (r) => r.at,
        (r) => r.n,
      ),
    ).toEqual([
      { month: '2026-08', value: 0 },
      { month: '2026-09', value: 5 },
    ]);
    expect(series(['2026-09'], rows, (r) => r.at)).toEqual([{ month: '2026-09', value: 2 }]);
  });
});

describe('monthlyCents', () => {
  const at = (frequency: string, amountCents: number, intervalDays: number | null = null) =>
    monthlyCents({ frequency, amountCents, intervalDays });

  it('gives each frequency its monthly equivalent', () => {
    expect(at('MONTHLY', 9_900)).toBe(9_900);
    expect(at('WEEKLY', 1_200)).toBe(5_200);
    expect(at('QUARTERLY', 30_000)).toBe(10_000);
    expect(at('SEMIANNUAL', 60_000)).toBe(10_000);
    expect(at('ANNUAL', 120_000)).toBe(10_000);
  });

  it('uses the interval for a custom bill and nothing without one', () => {
    expect(at('CUSTOM', 6_000, 60)).toBe(3_000);
    expect(at('CUSTOM', 6_000, null)).toBe(0);
  });
});

describe('datesOf', () => {
  it('turns each preset into dates, UTC', () => {
    expect(datesOf({ preset: 'LAST_7_DAYS' }, today)).toEqual({
      from: '2026-10-13',
      to: '2026-10-19',
    });
    expect(datesOf({ preset: 'LAST_30_DAYS' }, today)).toEqual({
      from: '2026-09-20',
      to: '2026-10-19',
    });
    expect(datesOf({ preset: 'THIS_MONTH' }, today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-19',
    });
    expect(datesOf({ preset: 'LAST_MONTH' }, today)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(datesOf({ preset: 'THIS_QUARTER' }, today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-19',
    });
    expect(datesOf({ preset: 'THIS_YEAR' }, today)).toEqual({
      from: '2026-01-01',
      to: '2026-10-19',
    });
  });

  it('keeps a custom range', () => {
    expect(datesOf({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });
});
