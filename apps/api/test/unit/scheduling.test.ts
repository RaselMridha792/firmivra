// Unit tests for R58's pure pieces: the status and colour mappings, reminder offsets, agenda
// cursors, recurrence, the conflict check and the request schemas of the scheduling contract.
import { describe, expect, it } from 'vitest';
import {
  type ConflictData,
  findAlternatives,
  findConflicts,
  hoursOn,
  toResult,
} from '../../src/appointments/scheduling-conflicts.js';
import {
  colorFromHex,
  colorHex,
  decodeCursor,
  displayStatus,
  encodeCursor,
  locationKindOf,
  monthSpan,
  reminderFromOffset,
  reminderOffset,
} from '../../src/appointments/scheduling-map.js';
import { subtract } from '../../src/appointments/scheduling-availability.service.js';
import { expandRecurrence } from '../../src/appointments/scheduling-recurrence.js';
import { AgendaQ, DetailsBody, ScheduleBody } from '../../src/appointments/scheduling.input.js';
import { zonedInstant } from '../../src/appointments/calendar.js';

const TZ = 'Asia/Kolkata';
const NY = 'America/New_York';
const staffId = '11111111-1111-4111-8111-111111111111';
const clientId = '22222222-2222-4222-8222-222222222222';
const member = { userId: staffId, name: 'Fake Staff' };
const at = (date: string, hhmm: string, tz = TZ) =>
  zonedInstant(tz, date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));

describe('display status', () => {
  const base = { rescheduleCount: 0, confirmedAt: null };
  it('maps the four database statuses and Pending / Confirmed / Rescheduled', () => {
    expect(displayStatus({ ...base, status: 'CANCELLED' })).toBe('CANCELED');
    expect(displayStatus({ ...base, status: 'COMPLETED' })).toBe('COMPLETED');
    expect(displayStatus({ ...base, status: 'NO_SHOW' })).toBe('NO_SHOW');
    expect(displayStatus({ ...base, status: 'SCHEDULED' })).toBe('PENDING');
    expect(displayStatus({ ...base, status: 'SCHEDULED', confirmedAt: new Date() })).toBe(
      'CONFIRMED',
    );
    expect(displayStatus({ ...base, status: 'SCHEDULED', rescheduleCount: 1 })).toBe('RESCHEDULED');
  });
});

describe('colours and methods', () => {
  it('round-trips the palette in either letter case and refuses other colours', () => {
    expect(colorHex('BLUE')).toBe('#2563eb');
    expect(colorHex(null)).toBeNull();
    expect(colorFromHex('#2563EB')).toBe('BLUE');
    expect(colorFromHex('#123456')).toBeUndefined();
  });
  it('has no database kind for Other', () => {
    expect(locationKindOf('VIDEO')).toBe('VIDEO');
    expect(locationKindOf('OTHER')).toBeNull();
  });
});

describe('reminder offsets', () => {
  it('turns an amount and unit into minutes and back', () => {
    expect(reminderOffset({ amount: 1, unit: 'DAYS' })).toBe(1440);
    expect(reminderOffset({ amount: 2, unit: 'WEEKS' })).toBe(20_160);
    expect(reminderFromOffset('EMAIL', 1440)).toEqual({
      channel: 'EMAIL',
      amount: 1,
      unit: 'DAYS',
    });
    expect(reminderFromOffset('SMS', 120)).toEqual({ channel: 'SMS', amount: 2, unit: 'HOURS' });
    expect(reminderFromOffset('PORTAL', 45)).toEqual({
      channel: 'PORTAL',
      amount: 45,
      unit: 'MINUTES',
    });
    expect(reminderFromOffset('EMAIL', 10_080)).toEqual({
      channel: 'EMAIL',
      amount: 1,
      unit: 'WEEKS',
    });
  });
  it('refuses more than 30 days', () => {
    expect(reminderOffset({ amount: 5, unit: 'WEEKS' })).toBeNull();
    expect(reminderOffset({ amount: 30, unit: 'DAYS' })).toBe(43_200);
  });
});

describe('agenda cursor and months', () => {
  it('round-trips a cursor and rejects anything else', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const cursor = encodeCursor({ startsAt: '2026-10-19T10:00:00.000Z', id });
    expect(decodeCursor(cursor)).toEqual({ startsAt: '2026-10-19T10:00:00.000Z', id });
    expect(decodeCursor('garbage')).toBeNull();
    expect(
      decodeCursor(Buffer.from('2026-10-19T10:00:00Z|not-an-id').toString('base64url')),
    ).toBeNull();
    expect(decodeCursor(Buffer.from('a|b|c').toString('base64url'))).toBeNull();
  });
  it('finds the month before and after, over a year end', () => {
    expect(monthSpan('2026-01')).toEqual({
      first: '2026-01-01',
      next: '2026-02-01',
      previous: '2025-12-01',
    });
    expect(monthSpan('2026-12')).toEqual({
      first: '2026-12-01',
      next: '2027-01-01',
      previous: '2026-11-01',
    });
  });
});

describe('recurrence', () => {
  const first = { start: at('2026-10-20', '10:00'), end: at('2026-10-20', '11:00') }; // a Tuesday
  const dates = (r: ReturnType<typeof expandRecurrence>, tz = TZ) =>
    r.ok
      ? r.occurrences.map((o) =>
          new Date(o.start + (tz === TZ ? 19_800_000 : 0)).toISOString().slice(0, 10),
        )
      : [];

  it('is one appointment without a repeat', () => {
    expect(expandRecurrence(TZ, first, undefined)).toEqual({ ok: true, occurrences: [first] });
    expect(expandRecurrence(TZ, first, { frequency: 'NONE', interval: 1 })).toEqual({
      ok: true,
      occurrences: [first],
    });
  });
  it('repeats daily for a count and keeps the length', () => {
    const r = expandRecurrence(TZ, first, { frequency: 'DAILY', interval: 2, count: 3 });
    expect(dates(r)).toEqual(['2026-10-20', '2026-10-22', '2026-10-24']);
    if (r.ok) expect(r.occurrences.every((o) => o.end - o.start === 3_600_000)).toBe(true);
  });
  it('repeats weekly on the chosen weekdays until a date', () => {
    const r = expandRecurrence(TZ, first, {
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [2, 4],
      until: '2026-11-03',
    });
    expect(dates(r)).toEqual([
      '2026-10-20',
      '2026-10-22',
      '2026-10-27',
      '2026-10-29',
      '2026-11-03',
    ]);
  });
  it('repeats every second week from the booked day when no weekdays are given', () => {
    const r = expandRecurrence(TZ, first, { frequency: 'WEEKLY', interval: 2, count: 3 });
    expect(dates(r)).toEqual(['2026-10-20', '2026-11-03', '2026-11-17']);
  });
  it('repeats monthly and clamps to the end of a short month', () => {
    const jan31 = { start: at('2026-01-31', '09:00'), end: at('2026-01-31', '10:00') };
    const r = expandRecurrence(TZ, jan31, { frequency: 'MONTHLY', interval: 1, count: 3 });
    expect(dates(r)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });
  it('keeps the wall-clock time across a daylight saving change', () => {
    const ny = { start: at('2026-10-28', '10:00', NY), end: at('2026-10-28', '11:00', NY) };
    const r = expandRecurrence(NY, ny, { frequency: 'WEEKLY', interval: 1, count: 2 });
    expect(r.ok && r.occurrences[1]?.start).toBe(at('2026-11-04', '10:00', NY));
    // 10:00 is 14:00Z before the change on 2026-11-01 and 15:00Z after it.
    expect(new Date(ny.start).toISOString()).toBe('2026-10-28T14:00:00.000Z');
    expect(r.ok && new Date(r.occurrences[1]?.start ?? 0).toISOString()).toBe(
      '2026-11-04T15:00:00.000Z',
    );
  });
  it('needs exactly one end, refuses custom repeats and more than 52', () => {
    expect(expandRecurrence(TZ, first, { frequency: 'DAILY', interval: 1 }).ok).toBe(false);
    expect(
      expandRecurrence(TZ, first, {
        frequency: 'DAILY',
        interval: 1,
        count: 2,
        until: '2026-12-01',
      }).ok,
    ).toBe(false);
    expect(expandRecurrence(TZ, first, { frequency: 'CUSTOM', interval: 1, count: 2 }).ok).toBe(
      false,
    );
    expect(
      expandRecurrence(TZ, first, { frequency: 'DAILY', interval: 1, until: '2027-12-31' }).ok,
    ).toBe(false);
    const fifty2 = expandRecurrence(TZ, first, { frequency: 'DAILY', interval: 1, count: 52 });
    expect(fifty2.ok && fifty2.occurrences).toHaveLength(52);
  });
});

describe('conflict check', () => {
  const weekly = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startsAt: '09:00',
    endsAt: '17:00',
  }));
  const data = (over: Partial<ConflictData> = {}): ConflictData => ({
    timeZone: TZ,
    staff: new Map([[staffId, { member, weekly, overrides: new Map() }]]),
    appointments: [],
    blocks: [],
    ...over,
  });
  const candidate = (start: string, end: string, extra: object = {}) => ({
    staffUserIds: [staffId],
    occurrences: [{ start: at('2026-10-20', start), end: at('2026-10-20', end) }],
    allDay: false,
    clientId,
    roomId: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    ...extra,
  });
  const live = (start: string, end: string, extra: object = {}) => ({
    id: '44444444-4444-4444-8444-444444444444',
    staffUserId: staffId,
    clientId: '55555555-5555-4555-8555-555555555555',
    roomId: null,
    start: at('2026-10-20', start),
    end: at('2026-10-20', end),
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    ...extra,
  });

  it('finds nothing inside working hours with nothing else booked', () => {
    expect(findConflicts(data(), candidate('10:00', '11:00'))).toEqual([]);
  });
  it('finds a staff member who is already booked (hard)', () => {
    const [c, ...rest] = findConflicts(
      data({ appointments: [live('10:30', '11:30')] }),
      candidate('10:00', '11:00'),
    );
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: 'STAFF_BOOKED', hard: true, staff: member });
  });
  it('does not name the other appointment: only the staff member', () => {
    const [c] = findConflicts(
      data({ appointments: [live('10:30', '11:30')] }),
      candidate('10:00', '11:00'),
    );
    expect(JSON.stringify(c)).not.toContain('5555');
  });
  it('finds the client booked elsewhere and a room already taken (hard)', () => {
    const other = '66666666-6666-4666-8666-666666666666';
    const room = '77777777-7777-4777-8777-777777777777';
    const found = findConflicts(
      data({
        appointments: [live('10:00', '11:00', { staffUserId: other, clientId, roomId: room })],
      }),
      candidate('10:00', '11:00', { roomId: room }),
    );
    expect(found.map((f) => f.kind).sort()).toEqual(['CLIENT_DOUBLE_BOOKED', 'ROOM']);
    expect(found.every((f) => f.hard)).toBe(true);
  });
  it('ignores the appointment being edited and cancelled ones (not loaded)', () => {
    const mine = live('10:00', '11:00');
    expect(
      findConflicts(
        data({ appointments: [mine] }),
        candidate('10:00', '11:00', { exceptId: mine.id }),
      ),
    ).toEqual([]);
  });
  it('finds blocked time, time off and a whole-firm block (hard)', () => {
    const block = (kind: 'BLOCKED' | 'TIME_OFF', userId: string | null) => ({
      userId,
      kind,
      start: at('2026-10-20', '10:30'),
      end: at('2026-10-20', '11:30'),
    });
    expect(
      findConflicts(data({ blocks: [block('BLOCKED', staffId)] }), candidate('10:00', '11:00'))[0],
    ).toMatchObject({
      kind: 'BLOCKED_TIME',
      hard: true,
    });
    expect(
      findConflicts(data({ blocks: [block('TIME_OFF', staffId)] }), candidate('10:00', '11:00'))[0]
        ?.kind,
    ).toBe('TIME_OFF');
    const firm = findConflicts(
      data({ blocks: [block('BLOCKED', null)] }),
      candidate('10:00', '11:00'),
    )[0];
    expect(firm).toMatchObject({ kind: 'BLOCKED_TIME', staff: null });
  });
  it('flags time outside working hours and on days off as soft', () => {
    expect(findConflicts(data(), candidate('07:00', '08:00'))[0]).toMatchObject({
      kind: 'OUTSIDE_HOURS',
      hard: false,
    });
    // A range that runs past the end of the day's hours is outside too.
    expect(findConflicts(data(), candidate('16:30', '17:30'))[0]?.kind).toBe('OUTSIDE_HOURS');
    const sunday = {
      staffUserIds: [staffId],
      occurrences: [{ start: at('2026-10-18', '10:00'), end: at('2026-10-18', '11:00') }],
      allDay: false,
      clientId,
      roomId: null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    };
    expect(findConflicts(data(), sunday)[0]?.kind).toBe('OUTSIDE_HOURS');
    expect(findConflicts(data(), { ...sunday, allDay: true })).toEqual([]);
  });
  it('uses a date override instead of the weekly hours', () => {
    const staff = new Map([
      [
        staffId,
        {
          member,
          weekly,
          overrides: new Map([
            ['2026-10-20', { ranges: [[19 * 60, 20 * 60] as [number, number]] }],
          ]),
        },
      ],
    ]);
    expect(findConflicts(data({ staff }), candidate('10:00', '11:00'))[0]?.kind).toBe(
      'OUTSIDE_HOURS',
    );
    expect(findConflicts(data({ staff }), candidate('19:00', '20:00'))).toEqual([]);
    const off = new Map([
      [staffId, { member, weekly, overrides: new Map([['2026-10-20', { ranges: [] }]]) }],
    ]);
    expect(findConflicts(data({ staff: off }), candidate('10:00', '11:00'))[0]?.kind).toBe(
      'OUTSIDE_HOURS',
    );
    expect(hoursOn(off.get(staffId)!, '2026-10-20')).toEqual([]);
  });
  it('flags appointments too close for the buffers as hard (the database counts them)', () => {
    const found = findConflicts(
      data({ appointments: [live('11:00', '12:00')] }),
      candidate('10:00', '11:00', { bufferAfterMinutes: 15 }),
    );
    expect(found[0]).toMatchObject({ kind: 'BUFFER', hard: true });
  });
  it('reports a later occurrence of a series as RECURRING_OCCURRENCE', () => {
    const c = candidate('10:00', '11:00');
    const week = 7 * 86_400_000;
    const series = {
      ...c,
      occurrences: [
        c.occurrences[0]!,
        { start: c.occurrences[0]!.start + week, end: c.occurrences[0]!.end + week },
      ],
    };
    const blocked = {
      userId: staffId,
      kind: 'BLOCKED' as const,
      start: series.occurrences[1]!.start,
      end: series.occurrences[1]!.end,
    };
    const [f] = findConflicts(data({ blocks: [blocked] }), series);
    expect(f?.kind).toBe('RECURRING_OCCURRENCE');
    expect(f?.message).toContain('Repeat on 2026-10-27');
  });
  it('lets only an Owner or Admin override, and only working hours', () => {
    const soft = candidate('07:00', '08:00');
    expect(toResult(data(), soft, { userId: staffId, role: 'ADMIN' }).result.canOverride).toBe(
      true,
    );
    expect(toResult(data(), soft, { userId: staffId, role: 'STAFF' }).result.canOverride).toBe(
      false,
    );
    const hard = toResult(
      data({ appointments: [live('10:30', '11:30')] }),
      candidate('10:00', '11:00'),
      {
        userId: staffId,
        role: 'OWNER',
      },
    );
    expect(hard.result).toMatchObject({ ok: false, canOverride: false });
    expect(
      toResult(data(), candidate('10:00', '11:00'), { userId: staffId, role: 'OWNER' }).result,
    ).toMatchObject({
      ok: true,
      conflicts: [],
      alternatives: [],
    });
  });
  it('offers free starts of the same length near the asked time', () => {
    const d = data({ appointments: [live('10:00', '11:00')] });
    const alternatives = findAlternatives(
      d,
      candidate('10:00', '11:00'),
      at('2026-10-19', '00:00'),
    );
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.length).toBeLessThanOrEqual(5);
    for (const a of alternatives) {
      expect(Date.parse(a.endsAt) - Date.parse(a.startsAt)).toBe(3_600_000);
      expect(
        findConflicts(d, {
          ...candidate('10:00', '11:00'),
          occurrences: [{ start: Date.parse(a.startsAt), end: Date.parse(a.endsAt) }],
        }),
      ).toEqual([]);
    }
  });
});

describe('request schemas', () => {
  const schedule = {
    idempotencyKey: '88888888-8888-4888-8888-888888888888',
    contact: { kind: 'CLIENT', id: clientId.toUpperCase() },
    typeId: '99999999-9999-4999-8999-999999999999',
    startsAt: '2026-10-20T10:00:00Z',
    endsAt: '2026-10-20T11:00:00Z',
    method: 'VIDEO',
    staffUserIds: [staffId.toUpperCase()],
  };
  it('fills the defaults and lower-cases every uuid', () => {
    const body = ScheduleBody.parse(schedule);
    expect(body).toMatchObject({
      allDay: false,
      generateVideoLink: false,
      status: 'CONFIRMED',
      reminders: [],
      sendConfirmation: true,
      staffUserIds: [staffId],
      contact: { kind: 'CLIENT', id: clientId },
    });
  });
  it('refuses a time outside the calendar and an end before the start', () => {
    expect(
      ScheduleBody.safeParse({
        ...schedule,
        startsAt: '1999-01-01T10:00:00Z',
        endsAt: '1999-01-01T11:00:00Z',
      }).success,
    ).toBe(false);
    expect(ScheduleBody.safeParse({ ...schedule, endsAt: '2026-10-20T09:00:00Z' }).success).toBe(
      false,
    );
  });
  it('refuses unknown fields', () => {
    expect(ScheduleBody.safeParse({ ...schedule, businessId: randomBusiness }).success).toBe(false);
    expect(DetailsBody.safeParse({ version: 'x', businessId: randomBusiness }).success).toBe(false);
  });
  it('needs a version to edit and keeps the rest optional', () => {
    expect(DetailsBody.safeParse({}).success).toBe(false);
    expect(DetailsBody.parse({ version: '2026-10-20T10:00:00.000Z', internalNotes: '' })).toEqual({
      version: '2026-10-20T10:00:00.000Z',
      internalNotes: null,
    });
  });
  it('checks the agenda query', () => {
    const q = AgendaQ.parse({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z' });
    expect(q.limit).toBe(200);
    expect(
      AgendaQ.safeParse({ from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', limit: 501 })
        .success,
    ).toBe(false);
    expect(AgendaQ.safeParse({ from: 'nope', to: '2026-10-31T00:00:00Z' }).success).toBe(false);
  });
});

const randomBusiness = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('free time of a day', () => {
  it('takes busy spans out of a range, in order, joining overlaps', () => {
    const r = { start: 100, end: 500 };
    expect(subtract(r, [])).toEqual([r]);
    expect(
      subtract(r, [
        { start: 200, end: 250 },
        { start: 240, end: 300 },
        { start: 450, end: 600 },
        { start: 0, end: 50 },
      ]),
    ).toEqual([
      { start: 100, end: 200 },
      { start: 300, end: 450 },
    ]);
    expect(subtract(r, [{ start: 0, end: 900 }])).toEqual([]);
  });
});
