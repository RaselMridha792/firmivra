// R0 step 8 rules: no double booking for a staff member or a client, no booking over blocked
// time, reschedules counted by the database, cancelled is final, and every link stays inside
// the firm. Runs as the app role.
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
  typeB: '',
};
let nextDay = 0;
/** A fresh day far in the future for each test, so tests never collide with each other. */
const freshDay = () => new Date(Date.UTC(2030, 0, 1 + nextDay++));
const at = (day: Date, hhmm: string) => new Date(`${day.toISOString().slice(0, 10)}T${hhmm}:00Z`);

const firmA = () => db.forBusiness(ids.firmA);
const book = (
  day: Date,
  from: string,
  to: string,
  data: { staffUserId?: string; clientId?: string; typeId?: string } = {},
) =>
  firmA().appointment.create({
    data: {
      businessId: ids.firmA,
      clientId: data.clientId ?? ids.client1,
      staffUserId: data.staffUserId ?? ids.staff1,
      typeId: data.typeId,
      startsAt: at(day, from),
      endsAt: at(day, to),
      locationKind: 'VIDEO',
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staff1, ids.staff2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@ap.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `apa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `apb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const userId of [ids.staff1, ids.staff2]) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId, role: 'STAFF', status: 'ACTIVE' },
      });
    }
    const client = (displayName: string) =>
      tx.client.create({ data: { businessId: ids.firmA, displayName } });
    ids.client1 = (await client('One')).id;
    ids.client2 = (await client('Two')).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.typeB = (
      await tx.appointmentType.create({
        data: { businessId: ids.firmB, name: 'Consultation', durationMinutes: 30 },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('no double booking', () => {
  it('a staff member cannot have two overlapping appointments', async () => {
    const day = freshDay();
    await book(day, '15:00', '15:30');
    await expect(book(day, '15:15', '15:45', { clientId: ids.client2 })).rejects.toThrow(
      /no_double_booking_staff|exclusion constraint|conflicting key/i,
    );
    // Another staff member at the same time is fine, and so is back-to-back.
    await expect(
      book(day, '15:15', '15:45', { clientId: ids.client2, staffUserId: ids.staff2 }),
    ).resolves.toBeDefined();
    await expect(book(day, '15:30', '16:00')).resolves.toBeDefined();
  });

  it('a client cannot have two overlapping appointments', async () => {
    const day = freshDay();
    await book(day, '15:00', '15:30');
    await expect(book(day, '15:00', '15:30', { staffUserId: ids.staff2 })).rejects.toThrow(
      /no_double_booking_client|exclusion constraint|conflicting key/i,
    );
  });

  it('a cancelled appointment frees the time', async () => {
    const day = freshDay();
    const a = await book(day, '15:00', '15:30');
    await firmA().appointment.update({
      where: { id: a.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await expect(book(day, '15:00', '15:30')).resolves.toBeDefined();
  });

  it('a reschedule into a taken slot is refused too', async () => {
    const day = freshDay();
    await book(day, '15:00', '15:30');
    const other = await book(day, '16:00', '16:30', { clientId: ids.client2 });
    await expect(
      firmA().appointment.update({
        where: { id: other.id },
        data: { startsAt: at(day, '15:10'), endsAt: at(day, '15:40') },
      }),
    ).rejects.toThrow(/no_double_booking_staff|exclusion constraint|conflicting key/i);
  });
});

describe('blocked time', () => {
  it("cannot book over a staff member's blocked time or a firm closure", async () => {
    const day = freshDay();
    await firmA().blockedTime.create({
      data: {
        businessId: ids.firmA,
        userId: ids.staff1,
        startsAt: at(day, '12:00'),
        endsAt: at(day, '13:00'),
      },
    });
    await expect(book(day, '12:30', '13:00')).rejects.toThrow(/blocked time/);
    await expect(book(day, '12:30', '13:00', { staffUserId: ids.staff2 })).resolves.toBeDefined();

    const closed = freshDay();
    await firmA().blockedTime.create({
      data: { businessId: ids.firmA, startsAt: at(closed, '00:00'), endsAt: at(closed, '23:59') },
    });
    await expect(book(closed, '15:00', '15:30', { staffUserId: ids.staff2 })).rejects.toThrow(
      /blocked time/,
    );
  });

  it('blocked time and working hours belong to staff of the firm', async () => {
    const day = freshDay();
    await expect(
      firmA().blockedTime.create({
        data: {
          businessId: ids.firmA,
          userId: ids.staffB,
          startsAt: at(day, '09:00'),
          endsAt: at(day, '10:00'),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmA().workingHours.create({
        data: {
          businessId: ids.firmA,
          userId: ids.staffB,
          weekday: 1,
          startsAt: new Date('1970-01-01T09:00:00Z'),
          endsAt: new Date('1970-01-01T17:00:00Z'),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmA().workingHours.create({
        data: {
          businessId: ids.firmA,
          userId: ids.staff1,
          weekday: 7,
          startsAt: new Date('1970-01-01T09:00:00Z'),
          endsAt: new Date('1970-01-01T17:00:00Z'),
        },
      }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('appointment lifecycle', () => {
  it('the database counts reschedules; the app cannot write the count', async () => {
    const day = freshDay();
    const a = await book(day, '15:00', '15:30');
    const moved = await firmA().appointment.update({
      where: { id: a.id },
      data: { startsAt: at(day, '17:00'), endsAt: at(day, '17:30') },
    });
    expect(moved.rescheduleCount).toBe(1);
    expect(moved.rescheduledAt).not.toBeNull();
    await expect(
      firmA().appointment.update({ where: { id: a.id }, data: { rescheduleCount: 0 } }),
    ).rejects.toThrow(/kept by the database/);
  });

  it('a reschedule clears reminder_sent_at so the new time gets its own reminder', async () => {
    const day = freshDay();
    const a = await book(day, '15:00', '15:30');
    const update = (data: object) => firmA().appointment.update({ where: { id: a.id }, data });
    await update({ reminderSentAt: new Date() });
    await expect(update({ locationDetails: 'New link' })).resolves.toMatchObject({
      reminderSentAt: expect.any(Date),
    });
    await expect(
      update({ startsAt: at(day, '16:00'), endsAt: at(day, '16:30') }),
    ).resolves.toMatchObject({ reminderSentAt: null, rescheduleCount: 1 });
  });

  it('cancelled is final, needs cancelled_at, and nothing is deleted', async () => {
    const day = freshDay();
    const a = await book(day, '15:00', '15:30');
    await expect(
      firmA().appointment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } }),
    ).rejects.toThrow(/check constraint/i);
    await firmA().appointment.update({
      where: { id: a.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Client asked' },
    });
    await expect(
      firmA().appointment.update({
        where: { id: a.id },
        data: { status: 'SCHEDULED', cancelledAt: null },
      }),
    ).rejects.toThrow(/final/);
    await expect(firmA().appointment.deleteMany({ where: { id: a.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('the client never changes, and staff and type come from the firm', async () => {
    const day = freshDay();
    const a = await book(day, '15:00', '15:30');
    await expect(
      firmA().appointment.update({ where: { id: a.id }, data: { clientId: ids.client2 } }),
    ).rejects.toThrow(/client of an appointment cannot change/);
    await expect(book(freshDay(), '15:00', '15:30', { staffUserId: ids.staffB })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(book(freshDay(), '15:00', '15:30', { typeId: ids.typeB })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(book(freshDay(), '15:00', '03:00')).rejects.toThrow(/check constraint/i);
  });
});
