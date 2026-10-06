import { it, expect } from 'vitest';
import { availableSlots, validateHours, overlap } from '../../src/appointments/calendar.js';
const type = { durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
it('retains both real repeated-hour slots in a DST fold', () => {
  const result = availableSlots({
    from: '2026-11-01T05:00:00Z',
    to: '2026-11-01T07:00:00Z',
    timezone: 'America/New_York',
    type,
    hours: [{ weekday: 0, startMinute: 60, endMinute: 120 }],
    blocked: [],
    occupied: [],
    now: 0,
  });
  expect(result.slots.map((slot) => slot.startsAt)).toEqual([
    '2026-11-01T05:00:00.000Z',
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:00:00.000Z',
    '2026-11-01T06:30:00.000Z',
  ]);
});
it('never manufactures nonexistent DST-gap slots and validates the whole occupied window', () => {
  const result = availableSlots({
    from: '2027-03-14T06:00:00Z',
    to: '2027-03-14T08:00:00Z',
    timezone: 'America/New_York',
    type,
    hours: [{ weekday: 0, startMinute: 120, endMinute: 180 }],
    blocked: [],
    occupied: [],
    now: 0,
  });
  expect(result.slots).toEqual([]);
  const broken = availableSlots({
    from: '2027-03-15T09:00:00Z',
    to: '2027-03-15T10:00:00Z',
    timezone: 'UTC',
    type: { ...type, durationMinutes: 60 },
    hours: [
      { weekday: 1, startMinute: 540, endMinute: 555 },
      { weekday: 1, startMinute: 585, endMinute: 600 },
    ],
    blocked: [],
    occupied: [],
    now: 0,
  });
  expect(broken.slots).toEqual([]);
});
it('applies buffers and half-open conflicts and rejects overlapping working hours', () => {
  expect(overlap(0, 1, 1, 2)).toBe(false);
  expect(() =>
    validateHours([
      { weekday: 1, startMinute: 500, endMinute: 600 },
      { weekday: 1, startMinute: 550, endMinute: 650 },
    ]),
  ).toThrow();
  const result = availableSlots({
    from: '2027-03-15T09:00:00Z',
    to: '2027-03-15T10:00:00Z',
    timezone: 'UTC',
    type: { ...type, bufferAfterMinutes: 15 },
    hours: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
    blocked: [{ startsAt: '2027-03-15T09:30:00Z', endsAt: '2027-03-15T09:45:00Z' }],
    occupied: [],
    now: 0,
  });
  expect(result.slots).toEqual([]);
});
it('returns a continuation when a long range exceeds 1000 slots', () => {
  const result = availableSlots({
    from: '2027-03-15T00:00:00Z',
    to: '2027-03-20T00:00:00Z',
    timezone: 'UTC',
    type: { ...type, durationMinutes: 1 },
    hours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 1440,
    })),
    blocked: [],
    occupied: [],
    now: 0,
  });
  expect(result.slots).toHaveLength(1000);
  expect(result.nextFrom).toBe('2027-03-15T16:40:00.000Z');
});
