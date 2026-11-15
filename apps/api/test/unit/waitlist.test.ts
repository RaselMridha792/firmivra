// R55, Appointments A3: where an earlier opening is for a waitlist entry (waitlist-openings.ts).
// Pure over the conflict check's data. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../../src/appointments/calendar.js';
import type { ConflictData } from '../../src/appointments/scheduling-conflicts.js';
import {
  earliestOpening,
  type Hold,
  OFFER_HOLD_MS,
  offerExpiry,
  withHolds,
} from '../../src/appointments/waitlist-openings.js';

/** No daylight saving, so firm-local times are exact. */
const TZ = 'Asia/Kolkata';
const MIN = 60_000;
const HOUR = 60 * MIN;
const staffId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const otherClient = '33333333-3333-4333-8333-333333333333';
const appointmentId = '44444444-4444-4444-8444-444444444444';
const at = (date: string, hhmm: string) =>
  zonedInstant(TZ, date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));

/** The member works 09:00 to 12:00 every day. */
const data = (over: Partial<ConflictData> = {}): ConflictData => ({
  timeZone: TZ,
  staff: new Map([
    [
      staffId,
      {
        member: { userId: staffId, name: 'Fake Staff' },
        weekly: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startsAt: '09:00',
          endsAt: '12:00',
        })),
        overrides: new Map(),
      },
    ],
  ]),
  appointments: [],
  blocks: [],
  ...over,
});
/** The waiting appointment: 30 minutes on Oct 25 at 10:00. */
const current = { start: at('2026-10-25', '10:00'), end: at('2026-10-25', '10:30') };
const candidate = {
  staffUserIds: [staffId],
  occurrences: [current],
  allDay: false,
  clientId,
  roomId: null,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  exceptId: appointmentId,
};
const booked = (date: string, from: string, to: string, extra: object = {}) => ({
  id: `55555555-5555-4555-8555-${String(Math.random()).slice(2, 14).padEnd(12, '0')}`,
  staffUserId: staffId,
  clientId: otherClient,
  roomId: null,
  start: at(date, from),
  end: at(date, to),
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  ...extra,
});
const iso = (slot: { start: number } | null) => (slot ? new Date(slot.start).toISOString() : null);

describe('earliest opening', () => {
  const notBefore = at('2026-10-20', '08:00');

  it('is the first free start of the member’s hours, from the earliest time an offer may be', () => {
    const fullDay = [booked('2026-10-20', '09:00', '12:00')];
    const slot = earliestOpening(
      data({ appointments: [...fullDay, booked('2026-10-21', '09:00', '10:15')] }),
      candidate,
      current,
      notBefore,
    );
    // Oct 20 is full; Oct 21 is free from 10:15, on the 15-minute grid, for 30 minutes.
    expect(iso(slot)).toBe(new Date(at('2026-10-21', '10:15')).toISOString());
    expect(slot && slot.end - slot.start).toBe(30 * MIN);
  });

  it('is never later than an hour before the appointment’s own time, nor before the earliest', () => {
    const busyUntil25 = ['20', '21', '22', '23', '24'].map((d) =>
      booked(`2026-10-${d}`, '09:00', '12:00'),
    );
    // Only Oct 25 09:00 is free, which is an hour before 10:00: still an opening.
    expect(
      iso(earliestOpening(data({ appointments: busyUntil25 }), candidate, current, notBefore)),
    ).toBe(new Date(at('2026-10-25', '09:00')).toISOString());
    // From 09:15 that day nothing is early enough.
    expect(
      earliestOpening(
        data({ appointments: busyUntil25 }),
        candidate,
        current,
        at('2026-10-25', '09:15'),
      ),
    ).toBeNull();
  });

  it('holds another entry’s live offer as if booked: one time is never offered twice', () => {
    const hold: Hold = {
      entryId: '66666666-6666-4666-8666-666666666666',
      staffUserId: staffId,
      clientId: otherClient,
      attendeeClientIds: [],
      roomId: null,
      start: at('2026-10-20', '09:00'),
      end: at('2026-10-20', '09:30'),
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    };
    const open = earliestOpening(data(), candidate, current, notBefore);
    expect(iso(open)).toBe(new Date(at('2026-10-20', '09:00')).toISOString());
    const next = earliestOpening(withHolds(data(), [hold]), candidate, current, notBefore);
    expect(iso(next)).toBe(new Date(at('2026-10-20', '09:30')).toISOString());
  });

  it('skips a time an attendee or the client already has, and blocked time', () => {
    const attendee = '77777777-7777-4777-8777-777777777777';
    const slot = earliestOpening(
      data({
        appointments: [
          // The attendee has their own appointment with someone else at 09:00.
          booked('2026-10-20', '09:00', '09:30', {
            staffUserId: '88888888-8888-4888-8888-888888888888',
            clientId: attendee,
          }),
        ],
        blocks: [
          {
            userId: staffId,
            start: at('2026-10-20', '09:30'),
            end: at('2026-10-20', '10:00'),
            kind: 'BLOCKED',
          },
        ],
      }),
      { ...candidate, attendeeClientIds: [attendee] },
      current,
      notBefore,
    );
    expect(iso(slot)).toBe(new Date(at('2026-10-20', '10:00')).toISOString());
  });

  it('an offer is held for 12 hours, and always ends an hour before the time', () => {
    const now = at('2026-10-20', '08:00');
    expect(offerExpiry(now, { start: now + 3 * HOUR, end: now + 4 * HOUR })).toBe(now + 2 * HOUR);
    expect(offerExpiry(now, { start: now + 48 * HOUR, end: now + 49 * HOUR })).toBe(
      now + OFFER_HOLD_MS,
    );
  });
});
