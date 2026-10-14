// R37, Appointments: the related service, notes, colour, confirmation, time zone, all-day
// entries and the booking key. Runs as the app role.
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
  clientB: '',
  client2: '',
  service: '',
  serviceB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
let nextHour = 3000;
/** A fresh one-hour slot, so tests never overlap each other. */
const slot = (hours = 1) => {
  const startsAt = new Date(Date.UTC(2031, 0, 1) + nextHour++ * 3_600_000 * 2);
  return { startsAt, endsAt: new Date(startsAt.getTime() + hours * 3_600_000) };
};

const book = (data: Record<string, unknown> = {}) =>
  A().appointment.create({
    data: {
      businessId: ids.firmA,
      staffUserId: ids.staff1,
      clientId: ids.client1,
      locationKind: 'VIDEO',
      ...slot(),
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staff1, ids.staff2, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@ac.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `aca-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `acb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, users: string[]) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      for (const userId of users) {
        await tx.membership.create({
          data: { businessId, userId, role: 'STAFF', status: 'ACTIVE' },
        });
      }
      const service = await tx.service.create({
        data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      });
      const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
      const second = await tx.client.create({ data: { businessId, displayName: 'Second' } });
      return { service: service.id, client: client.id, second: second.id };
    });
  const a = await setup(ids.firmA, [ids.staff1, ids.staff2]);
  Object.assign(ids, { service: a.service, client1: a.client, client2: a.second });
  const b = await setup(ids.firmB, [ids.staffB]);
  Object.assign(ids, { serviceB: b.service, clientB: b.client });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it('refuses a service of another firm, on an appointment and on a type', async () => {
    await expect(book({ serviceId: ids.serviceB })).rejects.toThrow(/foreign key/i);
    await expect(
      A().appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `T ${run}`,
          durationMinutes: 30,
          serviceId: ids.serviceB,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    const mine = await book({ serviceId: ids.service });
    expect(await B().appointment.findUnique({ where: { id: mine.id } })).toBeNull();
  });
});

describe('details', () => {
  it('keeps notes short, the time zone real, and a day-long entry within 25 hours', async () => {
    for (const data of [
      { internalNotes: 'x'.repeat(5001) },
      { internalNotes: ' ' },
      { clientInstructions: 'x'.repeat(2001) },
      { timeZone: 'Mars/Olympus' },
      { timeZone: 'EST' },
      { timeZone: "'; drop" },
    ]) {
      await expect(book(data)).rejects.toThrow(/appointments_(notes|time_zone)/);
    }
    await expect(
      book({
        timeZone: 'America/New_York',
        internalNotes: 'Bring the K-1',
        clientInstructions: 'Use the side door',
      }),
    ).resolves.toMatchObject({ timeZone: 'America/New_York' });
    await expect(book(slot(13))).rejects.toThrow(/appointments_range/);
    await expect(book({ ...slot(24), allDay: false })).rejects.toThrow(/appointments_range/);
    await expect(
      book({
        ...slot(24),
        allDay: true,
        clientId: ids.client2,
        staffUserId: ids.staff2,
      }),
    ).resolves.toBeTruthy();
    await expect(
      book({
        ...slot(26),
        allDay: true,
        clientId: ids.client2,
        staffUserId: ids.staff2,
      }),
    ).rejects.toThrow(/appointments_range/);
  });

  it('pending until confirmed; colour, related service and the booking key', async () => {
    const pending = await book({ serviceId: ids.service, color: 'AMBER' });
    expect(pending).toMatchObject({ confirmedAt: null, color: 'AMBER', serviceId: ids.service });
    const confirmed = await A().appointment.update({
      where: { id: pending.id },
      data: { confirmedAt: new Date() },
    });
    expect(confirmed.confirmedAt).not.toBeNull();
    const key = randomUUID();
    await book({ idempotencyKey: key });
    await expect(book({ idempotencyKey: key })).rejects.toThrow(/Unique/i);
    // The same key at another firm is another booking.
    await expect(
      B().appointment.create({
        data: {
          businessId: ids.firmB,
          staffUserId: ids.staffB,
          clientId: ids.clientB,
          locationKind: 'PHONE',
          idempotencyKey: key,
          ...slot(),
        },
      }),
    ).resolves.toBeTruthy();
  });

  it('appointment types get a short description, a service and a colour', async () => {
    await expect(
      A().appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `T1 ${run}`,
          durationMinutes: 30,
          description: 'x'.repeat(501),
        },
      }),
    ).rejects.toThrow(/appointment_types_description/);
    await expect(
      A().appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `T2 ${run}`,
          durationMinutes: 30,
          description: 'A first look at your books',
          serviceId: ids.service,
          color: 'GREEN',
        },
      }),
    ).resolves.toMatchObject({ color: 'GREEN' });
  });
});
