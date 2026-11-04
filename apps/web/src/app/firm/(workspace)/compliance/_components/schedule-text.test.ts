import { describe, expect, it } from 'vitest';
import { frequencyText } from './schedule-text';

describe('a recurring schedule in words (CD-F11, Octavia Oct 28)', () => {
  const custom = (interval: number | null) =>
    frequencyText({ frequency: 'CUSTOM', interval, repeatRule: { dayOfMonth: 15 } });

  it('claims no frequency until the interval is a whole number of months', () => {
    expect(custom(null)).toBe('Not set yet: choose how many months apart');
    expect(custom(0)).toBe('Not set yet: choose how many months apart');
    expect(custom(1.5)).toBe('Not set yet: choose how many months apart');
  });

  it('says one month and several months as people say them', () => {
    expect(custom(1)).toBe('Every month on the 15th');
    expect(custom(2)).toBe('Every 2 months on the 15th');
  });
});
