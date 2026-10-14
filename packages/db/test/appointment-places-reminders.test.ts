// R37, Appointments: reminders (kept by the database), offices and rooms. Runs as the app role.
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
let nextSlot = 5000;
const slot = () => {
  const startsAt = new Date(Date.UTC(2032, 0, 1) + nextSlot++ * 3_600_000 * 2);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};
const book = (data: Record<string, unknown> = {}) =>
  A().appointment.create({
    data: {
      businessId: ids.firmA,
      staffUserId: ids.staff1,
      clientId: ids.client1,
      locationKind: 'IN_PERSON',
      ...slot(),
      ...data,
    },
  });
const office = (data: Record<string, unknown> = {}) =>
  A().firmOffice.create({
    data: { businessId: ids.firmA, name: `Office ${randomUUID().slice(0, 6)}`, ...data },
  });
const room = (officeId: string, name = `Room ${randomUUID().slice(0, 6)}`) =>
  A().firmRoom.create({ data: { businessId: ids.firmA, officeId, name } });
const reminder = (appointmentId: string, data: Record<string, unknown> = {}) =>
  A().appointmentReminder.create({
    data: {
      businessId: ids.firmA,
      appointmentId,
      channel: 'EMAIL',
      offsetMinutes: 1440,
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staff1, ids.staff2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@ar.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ara-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `arb-${run}`, name: 'B' } })).id;
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
  it("never shows or changes another firm's reminders, offices or rooms, and refuses to point at them", async () => {
    const o = await office();
    const r = await room(o.id);
    const appointment = await book({ officeId: o.id, roomId: r.id });
    const rem = await reminder(appointment.id);
    expect(await B().firmOffice.findUnique({ where: { id: o.id } })).toBeNull();
    expect(await B().firmRoom.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await B().appointmentReminder.findUnique({ where: { id: rem.id } })).toBeNull();
    expect((await B().appointmentReminder.deleteMany({ where: { id: rem.id } })).count).toBe(0);
    expect(
      (await B().firmOffice.updateMany({ where: { id: o.id }, data: { name: 'x' } })).count,
    ).toBe(0);
    await expect(
      B().firmRoom.create({ data: { businessId: ids.firmB, officeId: o.id, name: 'x' } }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().appointmentReminder.create({
        data: {
          businessId: ids.firmB,
          appointmentId: appointment.id,
          channel: 'SMS',
          offsetMinutes: 60,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().appointment.create({
        data: {
          businessId: ids.firmB,
          staffUserId: ids.staffB,
          clientId: ids.clientB,
          locationKind: 'IN_PERSON',
          officeId: o.id,
          ...slot(),
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('reminders', () => {
  it('are due the offset before the start, one per channel and offset', async () => {
    const appointment = await book();
    const rem = await reminder(appointment.id, { channel: 'SMS', offsetMinutes: 4320 });
    expect(rem.dueAt.getTime()).toBe(appointment.startsAt.getTime() - 4320 * 60_000);
    expect(rem.sentAt).toBeNull();
    await expect(reminder(appointment.id, { channel: 'SMS', offsetMinutes: 4320 })).rejects.toThrow(
      /Unique/i,
    );
    await expect(
      reminder(appointment.id, { channel: 'EMAIL', offsetMinutes: 4320 }),
    ).resolves.toBeTruthy();
    for (const offsetMinutes of [-1, 43_201]) {
      await expect(reminder(appointment.id, { offsetMinutes })).rejects.toThrow(
        /appointment_reminders_offset/,
      );
    }
    await expect(
      A().appointmentReminder.update({ where: { id: rem.id }, data: { offsetMinutes: 60 } }),
    ).rejects.toThrow(/replace a reminder/);
    // Sending is recorded on the row; a replaced schedule is deleted.
    await expect(
      A().appointmentReminder.update({ where: { id: rem.id }, data: { sentAt: new Date() } }),
    ).resolves.toBeTruthy();
    await expect(A().appointmentReminder.delete({ where: { id: rem.id } })).resolves.toBeTruthy();
  });

  it('move with a reschedule and go out again', async () => {
    const appointment = await book();
    const rem = await reminder(appointment.id, { offsetMinutes: 60 });
    await A().appointmentReminder.update({ where: { id: rem.id }, data: { sentAt: new Date() } });
    const later = slot();
    await A().appointment.update({ where: { id: appointment.id }, data: later });
    const moved = await A().appointmentReminder.findUniqueOrThrow({ where: { id: rem.id } });
    expect(moved.dueAt.getTime()).toBe(later.startsAt.getTime() - 60 * 60_000);
    expect(moved.sentAt).toBeNull();
  });

  it('types keep default reminders as a short list', async () => {
    const make = (reminderDefaults: unknown) =>
      A().appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `Type ${randomUUID().slice(0, 6)}`,
          durationMinutes: 30,
          reminderDefaults: reminderDefaults as never,
        },
      });
    await expect(make({ channel: 'EMAIL' })).rejects.toThrow(/appointment_types_reminder_defaults/);
    await expect(
      make(Array.from({ length: 11 }, () => ({ channel: 'EMAIL', offsetMinutes: 60 }))),
    ).rejects.toThrow(/appointment_types_reminder_defaults/);
    await expect(make([{ channel: 'EMAIL', offsetMinutes: 1440 }])).resolves.toBeTruthy();
  });
});

describe('offices and rooms', () => {
  it('names are one line and unique among live offices; one live main office', async () => {
    const name = `HQ ${run}`;
    await office({ name, isMain: true });
    await expect(office({ name: ` ${name.toLowerCase()} ` })).rejects.toThrow(/Unique/i);
    await expect(office({ isMain: true })).rejects.toThrow(/Unique/i);
    for (const bad of [' ', 'x'.repeat(101), 'a\nb']) {
      await expect(office({ name: bad })).rejects.toThrow(/firm_offices_text/);
    }
    await expect(office({ isMain: true, archivedAt: new Date() })).rejects.toThrow(
      /firm_offices_main_live/,
    );
  });

  it('a room is of its office, named once per office; archived for good', async () => {
    const o = await office();
    const name = `Conference ${run}`;
    await room(o.id, name);
    await expect(room(o.id, name)).rejects.toThrow(/Unique/i);
    await expect(room((await office()).id, name)).resolves.toBeTruthy();
    const r = await room(o.id);
    await A().firmRoom.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
    await expect(
      A().firmRoom.update({ where: { id: r.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
    await expect(A().firmOffice.delete({ where: { id: o.id } })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('an appointment names an office and a room of it, in person only', async () => {
    const o = await office();
    const other = await office();
    const r = await room(o.id);
    await expect(book({ roomId: r.id })).rejects.toThrow(/appointments_room_of_office/);
    await expect(book({ officeId: other.id, roomId: r.id })).rejects.toThrow(/foreign key/i);
    await expect(book({ officeId: o.id, locationKind: 'VIDEO' })).rejects.toThrow(
      /appointments_place/,
    );
    await expect(book({ officeId: o.id, roomId: r.id })).resolves.toBeTruthy();
  });

  it('a room is not double booked, a cancelled appointment frees it', async () => {
    const o = await office();
    const r = await room(o.id);
    const t = slot();
    const first = await book({ officeId: o.id, roomId: r.id, ...t });
    await expect(
      book({ officeId: o.id, roomId: r.id, staffUserId: ids.staff2, clientId: ids.client2, ...t }),
    ).rejects.toThrow(/no_double_booking_room/);
    // The same time in another room, or with no room, is fine.
    await expect(
      book({
        officeId: o.id,
        roomId: (await room(o.id)).id,
        staffUserId: ids.staff2,
        clientId: ids.client2,
        ...t,
      }),
    ).resolves.toBeTruthy();
    await A().appointment.update({
      where: { id: first.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await expect(book({ officeId: o.id, roomId: r.id, ...t })).resolves.toBeTruthy();
  });
});
