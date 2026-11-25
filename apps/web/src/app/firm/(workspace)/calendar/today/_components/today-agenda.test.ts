import { describe, expect, it } from 'vitest';
import { toInstant } from '../../_components/time';
import { todayAgendaItems, todayAgendaRange } from './today-agenda';

describe('Appointments Today destination', () => {
  it('uses the full Chicago day for a late appointment', () => {
    const date = '2026-11-24';
    const timeZone = 'America/Chicago';
    const range = todayAgendaRange(date, timeZone);
    const lateAppointment = Date.parse(toInstant(date, '23:30', timeZone));

    expect(lateAppointment).toBeGreaterThanOrEqual(Date.parse(range.from));
    expect(lateAppointment).toBeLessThan(Date.parse(range.to));
    expect(range.to).toBe(toInstant('2026-11-25', '00:00', timeZone));
  });

  it('matches the Dashboard count to scheduled entries only', () => {
    const entries = [
      { status: 'PENDING' },
      { status: 'CONFIRMED' },
      { status: 'RESCHEDULED' },
      { status: 'COMPLETED' },
      { status: 'NO_SHOW' },
      { status: 'CANCELED' },
    ] as const;

    expect(todayAgendaItems(entries, true)).toEqual(entries.slice(0, 3));
    expect(todayAgendaItems(entries, false)).toEqual(entries);
  });
});
