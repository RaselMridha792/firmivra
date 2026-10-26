import { describe, expect, it } from 'vitest';
import { dueRange } from './list-view';

describe('dueRange (BK-D03)', () => {
  it('a custom period takes both ends, included, start first', () => {
    expect(dueRange('CUSTOM', '2026-11-01', '2026-11-30')).toEqual({
      reportDueFrom: '2026-11-01',
      reportDueTo: '2026-11-30',
    });
    expect(dueRange('CUSTOM', '2026-11-01', '')).toEqual({ reportDueFrom: '2026-11-01' });
    expect(dueRange('CUSTOM', '2026-12-01', '2026-11-01')).toBeNull();
  });

  it('keeps the set windows', () => {
    expect(dueRange('')).toEqual({});
    expect(dueRange('OVERDUE')).toHaveProperty('reportDueTo');
    expect(dueRange('WEEK')).toHaveProperty('reportDueFrom');
  });
});
