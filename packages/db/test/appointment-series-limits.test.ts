// R37, Appointments: repeating appointments, buffers, booking limits, one-day availability
// changes, time off and the firm's appointment settings. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staff1: randomUUID(),
  staff2: randomUUID(),
  staffB: randomUUID(),
  client1: '',
  client2: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
let nextDay = 0;
/** A fresh day, so tests never overlap each other; times in minutes from 09:00 UTC. */
const at = (day: number, minute: number, length = 60) => {
  const startsAt = new Date(Date.UTC(2033, 0, 1 + day, 9, 0) + minute * 60_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + length * 60_000) };
};
const book = (data: Record<string, unknown> = {}) =>
  A().appointment.create({
    data: {
      businessId: ids.firmA,
      staffUserId: ids.staff1,
      clientId: ids.client1,
      locationKind: 'VIDEO',
      ...at(nextDay++, 0),
      ...data,
    },
  });
const series = (data: Record<string, unknown> = {}) =>
  A().appointmentSeries.create({
    data: {
      businessId: ids.firmA,
      frequency: 'WEEKLY',
      byWeekdays: [2],
      occurrenceCount: 10,
      timeZone: 'America/New_York',
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staff1, ids.staff2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@as.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `asa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `asb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, users: string[]) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      for (const userId of users) {
        await tx.membership.create({
          data: { businessId, userId, role: 'STAFF', status: 'ACTIVE' },
        });
      }
      const one = await tx.client.create({ data: { businessId, displayName: 'One' } });
      const two = await tx.client.create({ data: { businessId, displayName: 'Two' } });
      return [one.id, two.id] as const;
    });
  [ids.client1, ids.client2] = await setup(ids.firmA, [ids.staff1, ids.staff2]);
  [ids.clientB] = await setup(ids.firmB, [ids.staffB]);
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's series, overrides or settings, and refuses to point at them", async () => {
    const s = await series();
    const override = await A().availabilityOverride.create({
      data: { businessId: ids.firmA, userId: ids.staff1, date: new Date('2033-02-01') },
    });
    await A().appointmentSettings.create({ data: { businessId: ids.firmA } });
    expect(await B().appointmentSeries.findUnique({ where: { id: s.id } })).toBeNull();
    expect(await B().availabilityOverride.findUnique({ where: { id: override.id } })).toBeNull();
    expect(
      await B().appointmentSettings.findUnique({ where: { businessId: ids.firmA } }),
    ).toBeNull();
    expect((await B().availabilityOverride.deleteMany({ where: { id: override.id } })).count).toBe(
      0,
    );
    await expect(
      B().appointmentSeries.create({
        data: {
          businessId: ids.firmA,
          frequency: 'DAILY',
          occurrenceCount: 3,
          timeZone: 'America/New_York',
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      B().appointment.create({
        data: {
          businessId: ids.firmB,
          staffUserId: ids.staffB,
          clientId: ids.clientB,
          locationKind: 'VIDEO',
          seriesId: s.id,
          ...at(0, 0),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().availabilityOverride.create({
        data: { businessId: ids.firmB, userId: ids.staff1, date: new Date('2033-02-01') },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('series', () => {
  it('ends on a date or after a count, repeats every 1 to 12, on weekdays that are real and different', async () => {
    for (const data of [
      { occurrenceCount: null },
      { untilDate: new Date('2033-12-31') },
      { occurrenceCount: 53 },
      { occurrenceCount: 0 },
      { intervalCount: 13 },
      { byWeekdays: [7] },
      { byWeekdays: [1, 1] },
      { frequency: 'DAILY', byWeekdays: [1] },
      { timeZone: 'Nowhere/City' },
    ]) {
      await expect(series(data)).rejects.toThrow(/appointment_series_rule/);
    }
    await expect(
      series({ occurrenceCount: null, untilDate: new Date('2033-12-31') }),
    ).resolves.toBeTruthy();
    await expect(
      series({ frequency: 'MONTHLY', byWeekdays: [], intervalCount: 2 }),
    ).resolves.toBeTruthy();
  });

  it('its occurrences are ordinary appointments that point at it; a series is never changed or deleted', async () => {
    const s = await series();
    const first = await book({ seriesId: s.id });
    const second = await book({ seriesId: s.id });
    expect(await A().appointment.count({ where: { seriesId: s.id } })).toBe(2);
    expect(first.seriesId).toBe(second.seriesId);
    await expect(
      A().appointmentSeries.update({ where: { id: s.id }, data: { occurrenceCount: 4 } }),
    ).rejects.toThrow(/permission denied/);
    await expect(A().appointmentSeries.delete({ where: { id: s.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('buffers', () => {
  it('count in the staff rule: the buffer must be free too; the client rule is unchanged', async () => {
    const day = nextDay++;
    await book({ ...at(day, 0), bufferAfterMinutes: 30 });
    // 10:00 to 11:00 plus 30 minutes: a 10:15 start is inside the buffer, 10:30 is fine.
    await expect(book({ ...at(day, 75), clientId: ids.client2 })).rejects.toThrow(
      /no_double_booking_staff/,
    );
    await expect(book({ ...at(day, 90), clientId: ids.client2 })).resolves.toBeTruthy();
    // The next one's own buffer before also counts.
    await expect(
      book({ ...at(day, 150), clientId: ids.client1, bufferBeforeMinutes: 60 }),
    ).rejects.toThrow(/no_double_booking_staff/);
    // Another staff member has no buffer to respect.
    await expect(
      book({ ...at(day, 75), staffUserId: ids.staff2, clientId: ids.client1 }),
    ).resolves.toBeTruthy();
  });

  it('are minutes between 0 and 240', async () => {
    await expect(book({ bufferBeforeMinutes: -1 })).rejects.toThrow(/appointments_buffers/);
    await expect(book({ bufferAfterMinutes: 241 })).rejects.toThrow(/appointments_buffers/);
    await expect(book({ bufferAfterMinutes: 240 })).resolves.toBeTruthy();
  });
});

describe('types and settings', () => {
  const type = (data: Record<string, unknown>) =>
    A().appointmentType.create({
      data: {
        businessId: ids.firmA,
        name: `Type ${randomUUID().slice(0, 6)}`,
        durationMinutes: 30,
        ...data,
      },
    });
  it('types keep buffers and booking limits in range', async () => {
    for (const data of [
      { bufferBeforeMinutes: 241 },
      { bufferAfterMinutes: -5 },
      { minNoticeMinutes: 43_201 },
      { maxAdvanceDays: 0 },
      { maxAdvanceDays: 731 },
    ]) {
      await expect(type(data)).rejects.toThrow(/appointment_types_booking_rules/);
    }
    await expect(
      type({
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        minNoticeMinutes: 1440,
        maxAdvanceDays: 90,
      }),
    ).resolves.toBeTruthy();
  });

  it('the firm settings keep ranges, one lower-case copy address, and copied reminders need an address', async () => {
    const settings = (data: Record<string, unknown>) =>
      A().appointmentSettings.update({ where: { businessId: ids.firmA }, data });
    for (const data of [
      { defaultBufferMinutes: 241 },
      { bookingMinNoticeMinutes: -1 },
      { bookingMaxAdvanceDays: 1000 },
      { copyEmail: 'Master@Firm.test' },
      { copyEmail: 'not an email' },
      { copyReminders: true },
    ]) {
      await expect(settings(data)).rejects.toThrow(/appointment_settings_rules/);
    }
    await expect(
      settings({ copyEmail: 'master@firm.test', copyReminders: true, defaultBufferMinutes: 10 }),
    ).resolves.toBeTruthy();
  });
});

describe('one-day availability changes and time off', () => {
  const override = (data: Record<string, unknown>) =>
    A().availabilityOverride.create({
      data: { businessId: ids.firmA, userId: ids.staff1, date: new Date('2033-03-01'), ...data },
    });
  const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
  it('a day off has no hours; other days have both, in order', async () => {
    await expect(override({})).resolves.toMatchObject({ startsAt: null, endsAt: null });
    await expect(override({ startsAt: time('09:00') })).rejects.toThrow(
      /availability_overrides_hours/,
    );
    await expect(override({ startsAt: time('17:00'), endsAt: time('09:00') })).rejects.toThrow(
      /availability_overrides_hours/,
    );
    await expect(
      override({ startsAt: time('10:00'), endsAt: time('14:00') }),
    ).resolves.toBeTruthy();
  });

  it('blocked time can be marked time off', async () => {
    const block = await A().blockedTime.create({
      data: {
        businessId: ids.firmA,
        userId: ids.staff1,
        startsAt: new Date('2033-06-01T00:00:00Z'),
        endsAt: new Date('2033-06-05T00:00:00Z'),
        kind: 'TIME_OFF',
      },
    });
    expect(block.kind).toBe('TIME_OFF');
    const plain = await A().blockedTime.create({
      data: {
        businessId: ids.firmA,
        userId: ids.staff1,
        startsAt: new Date('2033-07-01T00:00:00Z'),
        endsAt: new Date('2033-07-02T00:00:00Z'),
      },
    });
    expect(plain.kind).toBe('BLOCKED');
  });
});
