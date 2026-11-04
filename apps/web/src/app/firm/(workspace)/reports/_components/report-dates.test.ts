import { describe, expect, it } from 'vitest';
import { dateQuery, datesFrom, dayIn, rangeProblem, withDates } from './report-dates';

const params = (q: string) => new URLSearchParams(q);

describe('the Reports clock and date state (RP-F01, F04, F16, Octavia Oct 28)', () => {
  it('is the firm’s day: 00:08 in New York on Oct 28 is Oct 28 there, whatever the browser', () => {
    expect(dayIn('America/New_York', new Date('2026-10-28T04:08:00Z'))).toBe('2026-10-28');
    expect(dayIn('America/New_York', new Date('2026-10-28T03:59:00Z'))).toBe('2026-10-27');
    expect(dayIn('America/Los_Angeles', new Date('2026-10-28T04:08:00Z'))).toBe('2026-10-27');
    // The night the clocks go back (Nov 1, 2026), and a leap day.
    expect(dayIn('America/New_York', new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(dayIn('America/New_York', new Date('2028-02-29T05:00:00Z'))).toBe('2028-02-29');
  });

  it('carries the overview’s range and comparison to a report and back', () => {
    const lastMonth = { rule: 'ROLLING' as const, preset: 'last_month', compare: 'NONE' };
    expect(withDates('/reports/revenue-summary', lastMonth)).toBe(
      '/reports/revenue-summary?range=last_month&compare=NONE',
    );
    expect(datesFrom(params('range=last_month&compare=NONE'))).toEqual(lastMonth);
    const fixed = { rule: 'FIXED' as const, from: '2026-10-24', to: '2026-10-26' };
    expect(dateQuery(fixed)).toEqual({ range: 'custom', start: '2026-10-24', end: '2026-10-26' });
    expect(datesFrom(params('range=custom&start=2026-10-24&end=2026-10-26'))).toEqual(fixed);
  });

  it('ignores an address it cannot use, and names a range that does not fit', () => {
    expect(datesFrom(params(''))).toBeUndefined();
    expect(datesFrom(params('range=next_year'))).toBeUndefined();
    expect(datesFrom(params('range=custom&start=2026-10-26&end=2026-10-24'))).toBeUndefined();
    expect(datesFrom(params('range=this_month&compare=SOMETIME'))).toEqual({
      rule: 'ROLLING',
      preset: 'this_month',
    });
    expect(rangeProblem('', '2026-10-24')).toBe('Choose both dates.');
    expect(rangeProblem('2026-10-26', '2026-10-24')).toBe(
      'The start date must be on or before the end date.',
    );
    expect(rangeProblem('2026-10-24', '2026-10-24')).toBeNull();
  });
});
