// Unit tests for R12 step 2's pure pieces: the firm's time zone, free slots on the 15-minute
// grid, the portal's choice of staff member, the client's change window, and the database errors
// that mean "this time is taken". The history read back from audit rows comes with the booking
// routes in the next PR.
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  addDays,
  changeableUntil,
  dayRanges,
  freeStarts,
  gridStarts,
  HOUR,
  offsetAt,
  pickStaff,
  timeOfDayFromDb,
  timeOfDayToDb,
  usableTimeZone,
  weekdayOf,
  zonedDate,
  zonedInstant,
} from '../../src/appointments/calendar.js';
import {
  BlocksQuery,
  BookBody,
  BookMineBody,
  CalendarQuery,
  CancelBody,
  CancelMineBody,
  CreateBlockBody,
  CreateTypeBody,
  FirmSlotsQuery,
  inCalendarYears,
  MineSlotsQuery,
  RescheduleBody,
  RescheduleMineBody,
  UpdateTypeBody,
} from '../../src/appointments/appointments.input.js';
import { LockBusy, retryWhenBusy } from '../../src/appointments/calendar-locks.js';
import {
  errors,
  isPoolBusy,
  isRetryable,
  isSlotConflict,
  isStaffConflict,
  isUniqueViolation,
} from '../../src/appointments/errors.js';

const at = (iso: string) => Date.parse(iso);
const NY = 'America/New_York';

describe('time zones', () => {
  it('knows the offset on both sides of a daylight-saving change', () => {
    expect(offsetAt(NY, at('2026-07-01T12:00:00Z'))).toBe(-4 * HOUR);
    expect(offsetAt(NY, at('2026-12-01T12:00:00Z'))).toBe(-5 * HOUR);
    expect(offsetAt('Asia/Kolkata', at('2026-07-01T12:00:00Z'))).toBe(5.5 * HOUR);
    expect(offsetAt('UTC', at('2026-07-01T12:00:00Z'))).toBe(0);
  });

  it('turns a firm-local date and time into the instant', () => {
    expect(new Date(zonedInstant(NY, '2026-10-12', 9 * 60)).toISOString()).toBe(
      '2026-10-12T13:00:00.000Z',
    );
    // US daylight saving ends on Nov 1, 2026: 09:00 is then UTC-5.
    expect(new Date(zonedInstant(NY, '2026-11-02', 9 * 60)).toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
    expect(new Date(zonedInstant('Asia/Kolkata', '2026-10-12', 9 * 60)).toISOString()).toBe(
      '2026-10-12T03:30:00.000Z',
    );
    // A repeated hour (01:30 on Nov 1) takes its first occurrence, still in daylight time.
    expect(new Date(zonedInstant(NY, '2026-11-01', 90)).toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('finds the firm-local date of an instant, and walks dates and weekdays', () => {
    expect(zonedDate(NY, at('2026-10-13T02:00:00Z'))).toBe('2026-10-12');
    expect(zonedDate('Asia/Kolkata', at('2026-10-12T20:00:00Z'))).toBe('2026-10-13');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-10-11')).toBe(0);
    expect(weekdayOf('2026-10-17')).toBe(6);
  });

  it('falls back to the default for an unknown time zone; TIME columns round-trip', () => {
    expect(usableTimeZone('Not/AZone')).toBe(NY);
    expect(usableTimeZone(null)).toBe(NY);
    expect(usableTimeZone('Europe/London')).toBe('Europe/London');
    expect(timeOfDayFromDb(timeOfDayToDb('09:45'))).toBe('09:45');
  });
});

describe('free slots', () => {
  const monday = '2026-10-12';
  const query = { timeZone: 'UTC', from: monday, to: monday, minutes: 30, notBefore: 0 };

  it('joins touching ranges, keeps a lunch break', () => {
    expect(
      dayRanges(
        [
          { weekday: 1, startsAt: '12:00', endsAt: '13:00' },
          { weekday: 1, startsAt: '09:00', endsAt: '12:00' },
          { weekday: 1, startsAt: '14:00', endsAt: '15:00' },
          { weekday: 2, startsAt: '09:00', endsAt: '10:00' },
        ],
        1,
      ),
    ).toEqual([
      [540, 780],
      [840, 900],
    ]);
  });

  it('offers 15-minute starts that fit inside the hours, in the firm time zone', () => {
    const hours = [{ weekday: 1, startsAt: '09:00', endsAt: '10:00' }];
    const starts = gridStarts(query, hours).map((s) => new Date(s.start).toISOString());
    expect(starts).toEqual([
      '2026-10-12T09:00:00.000Z',
      '2026-10-12T09:15:00.000Z',
      '2026-10-12T09:30:00.000Z',
    ]);
    const kolkata = gridStarts({ ...query, timeZone: 'Asia/Kolkata' }, hours);
    expect(new Date(kolkata[0]!.start).toISOString()).toBe('2026-10-12T03:30:00.000Z');
    expect(gridStarts({ ...query, from: '2026-10-13', to: '2026-10-13' }, hours)).toEqual([]);
  });

  it('leaves out busy times, past starts, and joins ranges across a touching boundary', () => {
    const hours = [
      { weekday: 1, startsAt: '09:00', endsAt: '09:30' },
      { weekday: 1, startsAt: '09:30', endsAt: '10:30' },
    ];
    const busy = [{ start: at('2026-10-12T09:45:00Z'), end: at('2026-10-12T10:00:00Z') }];
    const free = freeStarts({ ...query, notBefore: at('2026-10-12T09:00:00Z') }, hours, busy).map(
      (s) => new Date(s.start).toISOString().slice(11, 16),
    );
    // 09:00 is not after notBefore; 09:30 and 09:45 overlap 09:45-10:00; back to back is fine,
    // and 09:15-09:45 runs across the join of the two ranges.
    expect(free).toEqual(['09:15', '10:00']);
  });
});

describe('the portal picks a staff member', () => {
  const a = { userId: 'a', name: 'Avery', load: 2 };
  const b = { userId: 'b', name: 'Blake', load: 0 };
  const c = { userId: 'c', name: 'Casey', load: 0 };

  it("takes the client's assigned member when free", () => {
    expect(pickStaff([a, b, c], 'a')).toBe(a);
  });

  it('otherwise the fewest appointments that day, then by name', () => {
    expect(pickStaff([a, c, b], 'z')).toBe(b);
    expect(pickStaff([a, c, b], null)).toBe(b);
    expect(pickStaff([], 'a')).toBeUndefined();
  });
});

describe("the client's change window", () => {
  const startsAt = new Date('2026-10-20T15:00:00Z');

  it('closes the cutoff before the start; 0 means until the start', () => {
    const now = at('2026-10-19T14:00:00Z');
    expect(changeableUntil({ status: 'SCHEDULED', startsAt }, 24, now)?.toISOString()).toBe(
      '2026-10-19T15:00:00.000Z',
    );
    expect(changeableUntil({ status: 'SCHEDULED', startsAt }, 24, now + 2 * HOUR)).toBeNull();
    expect(changeableUntil({ status: 'SCHEDULED', startsAt }, 0, now + 2 * HOUR)).toEqual(startsAt);
  });

  it('is null for a final status', () => {
    for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW']) {
      expect(changeableUntil({ status, startsAt }, 24, 0)).toBeNull();
    }
  });
});

describe('database errors', () => {
  const dbError = (originalCode: string, originalMessage: string) => ({
    code: 'P2039',
    meta: { driverAdapterError: { cause: { originalCode, originalMessage } } },
  });

  it('a double booking or blocked time is a taken slot; other checks are not', () => {
    expect(
      isSlotConflict(
        dbError('23P01', 'conflicting key value violates exclusion constraint "x_staff"'),
      ),
    ).toBe(true);
    expect(
      isSlotConflict(
        dbError(
          '23514',
          'appointments: the time overlaps blocked time for this staff member or the firm',
        ),
      ),
    ).toBe(true);
    expect(isSlotConflict(dbError('23514', 'violates check constraint "appointments_range"'))).toBe(
      false,
    );
    expect(isSlotConflict(new Error('boom'))).toBe(false);
  });

  it('knows a unique violation', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation(dbError('23505', 'duplicate key'))).toBe(true);
    expect(isUniqueViolation(dbError('23514', 'check'))).toBe(false);
  });

  it("tells the staff member's double booking from the client's", () => {
    const exclusion = (name: string) =>
      dbError('23P01', `conflicting key value violates exclusion constraint "${name}"`);
    expect(isStaffConflict(exclusion('appointments_no_double_booking_staff'))).toBe(true);
    expect(isStaffConflict(exclusion('appointments_no_double_booking_client'))).toBe(false);
    expect(isStaffConflict(dbError('23514', 'overlaps blocked time'))).toBe(false);
  });

  it('a pool or transaction-start timeout is a busy database', () => {
    expect(isPoolBusy({ code: 'P2024' })).toBe(true);
    expect(isPoolBusy({ code: 'P2028' })).toBe(true);
    expect(isPoolBusy({ code: 'P2002' })).toBe(false);
    expect(isPoolBusy(null)).toBe(false);
  });

  it('a deadlock or a serialization failure may run again; nothing else may', () => {
    expect(isRetryable({ code: 'P2034' })).toBe(true);
    expect(isRetryable(dbError('40P01', 'deadlock detected'))).toBe(true);
    expect(isRetryable(dbError('40001', 'could not serialize access'))).toBe(true);
    expect(isRetryable(dbError('23P01', 'conflicting key value'))).toBe(false);
    expect(isRetryable({ code: 'P2002' })).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe('errors', () => {
  it('answers a cutoff other than 24 hours with 409 CUTOFF_NOT_SUPPORTED, and busy like the rate limit (429)', () => {
    const cutoff = errors.cutoffNotSupported();
    expect([cutoff.getStatus(), (cutoff.getResponse() as { code: string }).code]).toEqual([
      409,
      'CUTOFF_NOT_SUPPORTED',
    ]);
    const busy = errors.busy();
    expect([busy.getStatus(), (busy.getResponse() as { code: string }).code]).toEqual([
      429,
      'RATE_LIMITED',
    ]);
  });
});

describe('the API input schemas', () => {
  const uuid = '01999999-0000-7000-8000-000000000001';
  const at = '2026-10-20T10:00:00.000Z';
  const cases = [
    [CreateTypeBody, { durationMinutes: 30 }, 'name'],
    [UpdateTypeBody, {}, 'name'],
    [CreateBlockBody, { userId: null, startsAt: at, endsAt: '2026-10-20T11:00:00.000Z' }, 'reason'],
    [
      BookBody,
      { clientId: uuid, staffUserId: uuid, typeId: uuid, startsAt: at },
      'locationDetails',
    ],
    [CancelBody, {}, 'reason'],
    [CancelMineBody, {}, 'reason'],
  ] as const;

  it('refuse half a surrogate pair in any free text, and keep whole pairs (emoji)', () => {
    for (const [schema, base, field] of cases) {
      expect(schema.safeParse({ ...base, [field]: 'Tax review 😀 (fake)' }).success, field).toBe(
        true,
      );
      for (const half of ['\ud800', '\udfff', 'x \ud83d y', '\ude00 start']) {
        const res = schema.safeParse({ ...base, [field]: half });
        expect(res.success, `${field} ${JSON.stringify(half)}`).toBe(false);
        expect(res.error?.issues.map((i) => i.path.join('.'))).toContain(field);
      }
    }
  });

  it('refuse a NUL and other control characters (the contract text rules)', () => {
    for (const [schema, base, field] of cases) {
      for (const bad of ['a\u0000b', '\u0000', 'a\u0007b']) {
        expect(schema.safeParse({ ...base, [field]: bad }).success, field).toBe(false);
      }
    }
  });

  it('still apply the contract (unknown keys, steps, cutoff range)', () => {
    expect(CreateTypeBody.safeParse({ name: 'Ok', durationMinutes: 20 }).success).toBe(false);
    expect(CreateTypeBody.safeParse({ name: 'Ok', durationMinutes: 30, x: 1 }).success).toBe(false);
    expect(UpdateTypeBody.safeParse({}).success).toBe(false);
    expect(CancelBody.safeParse({ reason: '' }).data).toEqual({ reason: null });
  });

  it('take times and dates from 2000 to 2100 only, where the firm-time arithmetic is exact', () => {
    expect(inCalendarYears('2000-01-01T00:00:00Z')).toBe(true);
    expect(inCalendarYears('2100-12-31T23:59:59Z')).toBe(true);
    expect(inCalendarYears('2100-12-31')).toBe(true);
    expect(inCalendarYears('1999-12-31T23:59:59Z')).toBe(false);
    expect(inCalendarYears('2101-01-01')).toBe(false);
    // An offset moves the instant: 2100-12-31 23:00 in New York is 2101 in UTC.
    expect(inCalendarYears('2100-12-31T23:00:00-05:00')).toBe(false);
    const day = (d: string) => ({ typeId: uuid, from: d, to: d });
    const span = (from: string, to: string) => ({ from, to });
    const ok: [z.ZodType, object][] = [
      [CalendarQuery, span('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')],
      [BlocksQuery, span('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z')],
      [FirmSlotsQuery, day('2026-10-12')],
      [MineSlotsQuery, day('2026-10-12')],
      [BookBody, { clientId: uuid, staffUserId: uuid, typeId: uuid, startsAt: at }],
      [RescheduleBody, { startsAt: at }],
      [BookMineBody, { typeId: uuid, startsAt: at }],
      [RescheduleMineBody, { startsAt: at }],
      [CreateBlockBody, { userId: null, startsAt: at, endsAt: '2026-10-20T11:00:00Z' }],
    ];
    for (const [schema, body] of ok) expect(schema.safeParse(body).success).toBe(true);
    const bad: [z.ZodType, object][] = [
      [CalendarQuery, span('0000-01-01T00:00:00+14:00', '0000-01-02T00:00:00Z')],
      [BlocksQuery, span('9999-12-01T00:00:00Z', '9999-12-31T00:00:00Z')],
      [FirmSlotsQuery, day('9999-12-31')],
      [MineSlotsQuery, day('0000-01-01')],
      [
        BookBody,
        { clientId: uuid, staffUserId: uuid, typeId: uuid, startsAt: '9999-12-31T23:00:00Z' },
      ],
      [RescheduleBody, { startsAt: '1970-01-01T00:00:00Z' }],
      [BookMineBody, { typeId: uuid, startsAt: '2101-01-01T00:00:00Z' }],
      [RescheduleMineBody, { startsAt: '0001-01-01T00:00:00Z' }],
      [CreateBlockBody, { userId: null, startsAt: at, endsAt: '9999-01-01T00:00:00Z' }],
    ];
    for (const [schema, body] of bad) {
      const res = schema.safeParse(body);
      expect(res.success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('a busy calendar lock', () => {
  it('starts the work again until the lock is free', async () => {
    let calls = 0;
    const result = await retryWhenBusy(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(new LockBusy()) : Promise.resolve('booked');
    });
    expect([result, calls]).toEqual(['booked', 3]);
  });

  const statusOf = async (work: Promise<unknown>) =>
    work.then(
      () => 'resolved',
      (e: unknown) => (e instanceof HttpException ? e.getStatus() : 'other error'),
    );

  it('answers 429 RATE_LIMITED when it stays busy, or at once when the pool is busy', async () => {
    const started = Date.now();
    expect(await statusOf(retryWhenBusy(() => Promise.reject(new LockBusy()), 150))).toBe(429);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    let calls = 0;
    const pool = retryWhenBusy(() => {
      calls += 1;
      return Promise.reject(Object.assign(new Error('pool'), { code: 'P2028' }));
    });
    expect([await statusOf(pool), calls]).toEqual([429, 1]);
  });

  it('runs a transaction the database aborted as a deadlock again', async () => {
    let calls = 0;
    const deadlock = {
      code: 'P2034',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    };
    const result = await retryWhenBusy(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(deadlock) : Promise.resolve('booked');
    });
    expect([result, calls]).toEqual(['booked', 2]);
  });

  it('passes every other error through untouched, without trying again', async () => {
    let calls = 0;
    const boom = new Error('boom');
    await expect(
      retryWhenBusy(() => {
        calls += 1;
        return Promise.reject(boom);
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });
});
