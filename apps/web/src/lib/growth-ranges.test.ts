// SA-DSH-F06: each Platform Growth choice's days. Today is Thursday, Nov 19, 2026 (Eastern).
import { describe, expect, it } from 'vitest';
import { easternToday, GROWTH_RANGES, growthBuckets, rangeDates } from './growth-ranges';

const TODAY = '2026-11-19';

describe('SA-DSH-F06: Platform Growth ranges', () => {
  it('offers the nine ranges and Custom in her order, This Week first', () => {
    expect(GROWTH_RANGES.map(([, label]) => label)).toEqual([
      'This Week',
      'Last 7 Days',
      'Last 30 Days',
      'Last 90 Days',
      'Last 6 Months',
      'Last 12 Months',
      'This Year',
      'Last Year',
      'Custom Date Range',
    ]);
  });

  it('gives each choice its own days', () => {
    expect(rangeDates('THIS_WEEK', TODAY)).toEqual({ from: '2026-11-16', to: TODAY });
    expect(rangeDates('LAST_7', TODAY)).toEqual({ from: '2026-11-13', to: TODAY });
    expect(rangeDates('LAST_30', TODAY)).toEqual({ from: '2026-10-21', to: TODAY });
    expect(rangeDates('LAST_90', TODAY)).toEqual({ from: '2026-08-22', to: TODAY });
    expect(rangeDates('LAST_6_MONTHS', TODAY)).toEqual({ from: '2026-05-20', to: TODAY });
    // Rolling, not the calendar year.
    expect(rangeDates('LAST_12_MONTHS', TODAY)).toEqual({ from: '2025-11-20', to: TODAY });
    expect(rangeDates('THIS_YEAR', TODAY)).toEqual({ from: '2026-01-01', to: TODAY });
    expect(rangeDates('LAST_YEAR', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('starts This Week on Monday, also on a Sunday or a Monday', () => {
    expect(rangeDates('THIS_WEEK', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(rangeDates('THIS_WEEK', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-16' });
  });

  it('keeps a month end inside a shorter month', () => {
    expect(rangeDates('LAST_6_MONTHS', '2026-08-31')).toEqual({
      from: '2026-03-01',
      to: '2026-08-31',
    });
  });

  it('reads today in US Eastern time', () => {
    expect(easternToday(new Date('2026-11-20T03:30:00Z'))).toBe('2026-11-19');
  });

  it('draws the weeks of Last 90 Days from Monday to Sunday', () => {
    const { from, to } = rangeDates('LAST_90', TODAY);
    const weeks = growthBuckets(from, to);
    expect(weeks[0]).toEqual({ start: '2026-08-22', end: '2026-08-23' });
    expect(weeks[1]).toEqual({ start: '2026-08-24', end: '2026-08-30' });
    expect(weeks.at(-1)).toEqual({ start: '2026-11-16', end: TODAY });
  });
});
