import { describe, expect, it } from 'vitest';
import { dayBounds, when } from './audit-time';

// Audit Log Review 2, R01a and R01b: times and date filters in the firm's zone, whatever the
// viewer's computer is set to (her browser was Eastern, the firm Central).
describe('audit log times in the firm zone', () => {
  it('shows 20:50Z as 2:50 PM CST for a Chicago firm, with the zone', () => {
    expect(when('2026-11-15T20:50:22.000Z', 'America/Chicago')).toBe('Nov 15, 2026, 2:50 PM CST');
    expect(when('2026-11-15T20:50:22.000Z', 'America/New_York')).toBe('Nov 15, 2026, 3:50 PM EST');
  });

  it('bounds a Chicago day from 06:00Z to 05:59:59.999Z the next day', () => {
    expect(dayBounds('2026-11-15', 'America/Chicago')).toEqual({
      from: '2026-11-15T06:00:00.000Z',
      to: '2026-11-16T05:59:59.999Z',
    });
  });

  it('keeps a daylight-saving day whole: 23 hours in March, 25 in November', () => {
    expect(dayBounds('2026-03-08', 'America/Chicago')).toEqual({
      from: '2026-03-08T06:00:00.000Z',
      to: '2026-03-09T04:59:59.999Z',
    });
    expect(dayBounds('2026-11-01', 'America/Chicago')).toEqual({
      from: '2026-11-01T05:00:00.000Z',
      to: '2026-11-02T05:59:59.999Z',
    });
  });

  it('crosses the year at the firm’s midnight', () => {
    expect(dayBounds('2026-12-31', 'America/Los_Angeles')).toEqual({
      from: '2026-12-31T08:00:00.000Z',
      to: '2027-01-01T07:59:59.999Z',
    });
  });
});
