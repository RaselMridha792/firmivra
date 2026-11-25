// SA-DSH-F06: Platform Growth's buckets. Days for a month or less, Monday-to-Sunday weeks up to
// about six months, calendar months beyond; the first and last bucket cut to the range, every
// day in exactly one bucket; days are US Eastern (SA-DSH-Y02).
import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  easternDay,
  growthBuckets,
} from '../../src/firm-applications/dashboard-growth.js';

const days = (buckets: { start: string; end: string }[]) => {
  let n = 0;
  for (const b of buckets) {
    n += (Date.parse(`${b.end}T00:00:00Z`) - Date.parse(`${b.start}T00:00:00Z`)) / 86_400_000 + 1;
  }
  return n;
};

describe('SA-DSH-F06: Platform Growth buckets', () => {
  it('picks days, weeks or months by the range’s length', () => {
    expect(bucketOf('2026-11-19', '2026-11-19')).toBe('DAY');
    expect(bucketOf('2026-10-21', '2026-11-19')).toBe('DAY'); // Last 30 Days
    expect(bucketOf('2026-08-22', '2026-11-19')).toBe('WEEK'); // Last 90 Days
    expect(bucketOf('2026-05-20', '2026-11-19')).toBe('WEEK'); // Last 6 Months
    expect(bucketOf('2025-11-20', '2026-11-19')).toBe('MONTH'); // Last 12 Months
    expect(bucketOf('2025-01-01', '2025-12-31')).toBe('MONTH'); // Last Year
  });

  it('weeks run Monday to Sunday, the first and last cut to the range', () => {
    // Nov 19, 2026 is a Thursday.
    expect(growthBuckets('2026-11-12', '2026-11-19', 'WEEK')).toEqual([
      { start: '2026-11-12', end: '2026-11-15' },
      { start: '2026-11-16', end: '2026-11-19' },
    ]);
    // This Week: Monday to today.
    expect(growthBuckets('2026-11-16', '2026-11-19')).toEqual(
      ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d) => ({ start: d, end: d })),
    );
  });

  it('months are calendar months, leap February included', () => {
    expect(growthBuckets('2027-12-15', '2028-03-02', 'MONTH')).toEqual([
      { start: '2027-12-15', end: '2027-12-31' },
      { start: '2028-01-01', end: '2028-01-31' },
      { start: '2028-02-01', end: '2028-02-29' },
      { start: '2028-03-01', end: '2028-03-02' },
    ]);
  });

  it('covers every day of the range exactly once', () => {
    for (const [from, to] of [
      ['2026-01-01', '2026-01-31'],
      ['2026-05-20', '2026-11-19'],
      ['2024-11-19', '2026-11-19'],
    ] as const) {
      const buckets = growthBuckets(from, to);
      expect(buckets[0]?.start).toBe(from);
      expect(buckets.at(-1)?.end).toBe(to);
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      expect(days(buckets)).toBe(span + 1);
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i]!.start > buckets[i - 1]!.end).toBe(true);
      }
    }
  });

  it('counts an instant on its US Eastern day', () => {
    // 03:30 UTC on Nov 20 is still Nov 19 in New York (EST, UTC-5).
    expect(easternDay(new Date('2026-11-20T03:30:00Z'))).toBe('2026-11-19');
    expect(easternDay(new Date('2026-11-20T05:30:00Z'))).toBe('2026-11-20');
    // Summer time (EDT, UTC-4).
    expect(easternDay(new Date('2026-07-01T03:59:00Z'))).toBe('2026-06-30');
  });
});
