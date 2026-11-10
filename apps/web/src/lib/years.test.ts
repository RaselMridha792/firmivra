import { describe, expect, it } from 'vitest';
import { customYear, yearChoices } from './years';

// Advisory B34: rolling year choices that never drop a stored year.

describe('yearChoices', () => {
  const now = new Date(2026, 10, 10);

  it('offers this year, six back and three ahead, newest first', () => {
    expect(yearChoices([], now)).toEqual([
      '2029',
      '2028',
      '2027',
      '2026',
      '2025',
      '2024',
      '2023',
      '2022',
      '2021',
      '2020',
    ]);
  });

  it('rolls forward with the calendar', () => {
    const next = yearChoices([], new Date(2027, 0, 1));
    expect([next[0], next.at(-1)]).toEqual(['2030', '2021']);
  });

  it('keeps every stored year, inside or outside the range, once', () => {
    const years = yearChoices([2012, '2026', 2026, null, undefined, '', 2035], now);
    expect(years[0]).toBe('2035');
    expect(years.at(-1)).toBe('2012');
    expect(years.filter((y) => y === '2026')).toHaveLength(1);
    expect(years).toHaveLength(12);
  });
});

describe('customYear', () => {
  it('takes four digits within range only', () => {
    expect(customYear(' 2015 ')).toBe('2015');
    expect(customYear('1899')).toBeNull();
    expect(customYear('2101')).toBeNull();
    expect(customYear('15')).toBeNull();
    expect(customYear('20a5')).toBeNull();
  });
});
