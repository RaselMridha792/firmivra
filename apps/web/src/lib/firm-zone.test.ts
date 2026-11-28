import { describe, expect, it } from 'vitest';
import { zonedDateParts, zonedDay, zonedTime, zonedWhen } from './firm-zone';

describe('firm-zone formatters', () => {
  const instant = '2026-11-15T20:50:22.000Z';

  it('formats timestamps in the firm zone and names the zone', () => {
    expect(zonedWhen(instant, 'America/Chicago')).toBe('Nov 15, 2026, 2:50 PM CST');
    expect(zonedTime(instant, 'America/New_York')).toBe('3:50 PM EST');
  });

  it('uses the firm calendar day for dates and date parts', () => {
    expect(zonedDay('2026-11-16T02:30:00.000Z', 'America/Chicago')).toBe('Nov 15, 2026');
    expect(zonedDateParts('2026-11-16T02:30:00.000Z', 'America/Chicago')).toEqual({
      year: 2026,
      month: 11,
      day: 15,
    });
  });
});
