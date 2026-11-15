// End-to-end: Appointments Review 2 (A2, R56), resource management and booking. Settings >
// Appointment Settings' rooms and equipment (Owner and Admin; Staff 403), and the equipment of
// Schedule Appointment: an item another live appointment holds then is 409 SCHEDULING_CONFLICT
// naming the item and never the other appointment's client. Every response is parsed with the
// contract and must equal the body; another firm's room, item or office is 404 and changes
// nothing; audit rows hold ids and field names only. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  AppointmentDraft,
  AppointmentRecord,
  AppointmentResources,
  ConflictResult,
  FirmEquipment,
  FirmRoom,
  SchedulingOptions,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const TZ = 'America/Chicago';
const person = (key: string) => ({ id: randomUUID(), email: `r56a2-${key}-${run}@r56.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  c1: '',
  c2: '',
  type: '',
  office: '',
  office2: '',
  inactiveOffice: '',
  archivedOffice: '',
  room: '',
  officeB: '',
  roomB: '',
  itemB: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.56.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Who = { email: string; id: string };
async function call(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);

/** Parses with the contract and refuses anything it does not name (a leaked field fails). */
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

const conflictsOf = (res: Response) =>
  (res.body as { error: { details: ConflictResult } }).error.details;

const today = zonedDate(TZ, Date.now());
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, addDays(today, n), minutesOf(time))).toISOString();
/** A day of its own for each test that books, so no two overlap. */
let nextDay = 30;
const freshDay = () => (nextDay += 1);

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const auditOf = (action: string, entityId?: string) =>
  asOwner(ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { businessId: ids.firmA, action, ...(entityId ? { entityId } : {}) },
      select: { entityType: true, entityId: true, metadata: true },
    }),
  );

const resources = (path: string) => `/appointment-resources${path}`;
const addItem = async (body: object, who: Who = people.ownerA) =>
  exact(FirmEquipment, await call('post', resources('/equipment'), who, body), 201);

const schedule = (n: number, extra: object = {}) => ({
  idempotencyKey: randomUUID(),
  contact: { kind: 'CLIENT', id: ids.c1 },
  typeId: ids.type,
  startsAt: at(n, '10:00'),
  endsAt: at(n, '11:00'),
  method: 'IN_PERSON',
  officeId: ids.office,
  details: '1 Sample Street',
  staffUserIds: [people.staffA.id],
  ...extra,
});
/** The other client with the other staff member, so only the equipment can clash. */
const other = () => ({
  contact: { kind: 'CLIENT', id: ids.c2 },
  staffUserIds: [people.staffA2.id],
});
const book = async (n: number, extra: object = {}) =>
  exact(
    AppointmentRecord,
    await call('post', '/appointments/schedule', people.ownerA, schedule(n, extra)),
  );

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r56a2-${key.toLowerCase()}-${run}`;
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: TZ } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.adminA.id, 'ADMIN'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    for (const userId of [people.staffA.id, people.staffA2.id]) {
      for (let weekday = 0; weekday < 7; weekday++) {
        await tx.workingHours.create({
          data: {
            ...A,
            userId,
            weekday,
            startsAt: new Date('1970-01-01T08:00:00Z'),
            endsAt: new Date('1970-01-01T18:00:00Z'),
          },
        });
      }
    }
    const client = async (displayName: string, assignedUserId: string) =>
      (await tx.client.create({ data: { ...A, displayName, assignedUserId } })).id;
    ids.c1 = await client('Jamie Sample (fake)', people.staffA.id);
    ids.c2 = await client('Riley Example (fake)', people.staffA2.id);
    ids.type = (
      await tx.appointmentType.create({
        data: {
          ...A,
          name: `Consult ${run}`,
          durationMinutes: 60,
          meetingMethods: ['IN_PERSON', 'VIDEO', 'PHONE'],
        },
      })
    ).id;
    const office = async (name: string, extra: object = {}) =>
      (await tx.firmOffice.create({ data: { ...A, name: `${name} ${run}`, ...extra } })).id;
    ids.office = await office('Main', { sortOrder: 0 });
    ids.office2 = await office('Riverside', { sortOrder: 1 });
    ids.inactiveOffice = await office('Closed', { sortOrder: 2, status: 'INACTIVE' });
    ids.archivedOffice = await office('Gone', { sortOrder: 3, archivedAt: new Date() });
    ids.room = (
      await tx.firmRoom.create({ data: { ...A, officeId: ids.office, name: 'Room 1' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.officeB = (await tx.firmOffice.create({ data: { ...B, name: 'B office' } })).id;
    ids.roomB = (
      await tx.firmRoom.create({ data: { ...B, officeId: ids.officeB, name: 'B room' } })
    ).id;
    ids.itemB = (await tx.firmEquipment.create({ data: { ...B, name: 'B projector' } })).id;
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Settings > Appointment Settings: who manages', () => {
  it('Owner and Admin list and change rooms and equipment; Staff get 403 and change nothing', async () => {
    for (const who of [people.ownerA, people.adminA]) {
      const list = exact(AppointmentResources, await call('get', resources(''), who));
      // Offices that are not archived (an inactive one keeps its own), in order.
      expect(list.offices.map((o) => o.id)).toEqual([ids.office, ids.office2, ids.inactiveOffice]);
      expect(list.rooms.find((r) => r.id === ids.room)).toEqual({
        id: ids.room,
        name: 'Room 1',
        office: { id: ids.office, name: `Main ${run}` },
        archivedAt: null,
        upcoming: expect.any(Number) as number,
        updatedAt: expect.any(String) as string,
      });
      // Never another firm's.
      expect(JSON.stringify(list)).not.toContain(ids.roomB);
      expect(JSON.stringify(list)).not.toContain(ids.itemB);
    }
    const before = await asOwner(ids.firmA, (tx) =>
      tx.firmEquipment.count({ where: { businessId: ids.firmA } }),
    );
    for (const [method, path, body] of [
      ['get', resources(''), undefined],
      ['post', resources('/rooms'), { officeId: ids.office, name: 'Staff room' }],
      ['patch', resources(`/rooms/${ids.room}`), { name: 'Renamed by staff' }],
      ['post', resources(`/rooms/${ids.room}/archive`), undefined],
      ['post', resources('/equipment'), { name: 'Staff item' }],
    ] as const) {
      expectError(await call(method, path, people.staffA, body), 403, 'FORBIDDEN');
    }
    const after = await asOwner(ids.firmA, (tx) =>
      tx.firmEquipment.count({ where: { businessId: ids.firmA } }),
    );
    expect(after).toBe(before);
    expect(
      (await asOwner(ids.firmA, (tx) => tx.firmRoom.findUnique({ where: { id: ids.room } })))?.name,
    ).toBe('Room 1');
  });

  it('refuses bad input with 400 VALIDATION_FAILED', async () => {
    for (const body of [
      { officeId: ids.office, name: '' },
      { officeId: ids.office, name: 'x'.repeat(101) },
      { officeId: ids.office, name: 'Room‮2' },
      { officeId: ids.office, name: 'Room 9', extra: true },
      { officeId: 'not-an-id', name: 'Room 9' },
      { name: 'Room 9' },
    ]) {
      expectError(
        await call('post', resources('/rooms'), people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    for (const body of [
      { name: '' },
      { name: 'Item', description: 'd'.repeat(501) },
      { name: 'Item', officeId: 'nope' },
    ]) {
      expectError(
        await call('post', resources('/equipment'), people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    expectError(
      await call('patch', resources(`/equipment/${randomUUID()}`), people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('rooms', () => {
  it('adds, renames and archives a room for good; a name is unique within its office, ignoring case', async () => {
    const added = exact(
      FirmRoom,
      await call('post', resources('/rooms'), people.adminA, {
        officeId: ids.office,
        name: '  Room 2 ',
      }),
      201,
    );
    expect(added).toMatchObject({
      name: 'Room 2',
      office: { id: ids.office },
      archivedAt: null,
      upcoming: 0,
    });
    expectError(
      await call('post', resources('/rooms'), people.ownerA, {
        officeId: ids.office,
        name: 'room 2',
      }),
      409,
      'DUPLICATE_NAME',
    );
    // Another office may have its own Room 2.
    exact(
      FirmRoom,
      await call('post', resources('/rooms'), people.ownerA, {
        officeId: ids.office2,
        name: 'Room 2',
      }),
      201,
    );
    expectError(
      await call('patch', resources(`/rooms/${added.id}`), people.ownerA, { name: 'ROOM 1' }),
      409,
      'DUPLICATE_NAME',
    );
    const renamed = exact(
      FirmRoom,
      await call('patch', resources(`/rooms/${added.id}`), people.ownerA, { name: 'Board Room' }),
    );
    expect(renamed.name).toBe('Board Room');
    // The same name again changes nothing and writes no audit row.
    await call('patch', resources(`/rooms/${added.id}`), people.ownerA, { name: 'Board Room' });

    const archived = exact(
      FirmRoom,
      await call('post', resources(`/rooms/${added.id}/archive`), people.ownerA),
    );
    expect(archived.archivedAt).not.toBeNull();
    exact(FirmRoom, await call('post', resources(`/rooms/${added.id}/archive`), people.ownerA));
    // An archived room keeps its name: a new one can't take it.
    expectError(
      await call('post', resources('/rooms'), people.ownerA, {
        officeId: ids.office,
        name: 'Board Room',
      }),
      409,
      'DUPLICATE_NAME',
    );
    // It is no longer offered for booking.
    const options = exact(
      SchedulingOptions,
      await call('get', '/appointments/options', people.staffA),
    );
    expect(options.rooms?.map((r) => r.id)).not.toContain(added.id);
    // A room's archive is final (the database's rule): there is no Restore.
    expectError(
      await call('post', resources(`/rooms/${added.id}/restore`), people.ownerA),
      404,
      'NOT_FOUND',
    );

    expect(await auditOf('appointment_room.created', added.id)).toEqual([
      { entityType: 'firm_room', entityId: added.id, metadata: { officeId: ids.office } },
    ]);
    expect(await auditOf('appointment_room.updated', added.id)).toEqual([
      { entityType: 'firm_room', entityId: added.id, metadata: { fields: ['name'] } },
    ]);
    expect(await auditOf('appointment_room.archived', added.id)).toEqual([
      { entityType: 'firm_room', entityId: added.id, metadata: { upcoming: 0 } },
    ]);
    const rows = JSON.stringify(
      await asOwner(ids.firmA, (tx) =>
        tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: added.id } }),
      ),
    );
    expect(rows).not.toContain('Board Room');
    expect(rows).not.toContain('Room 2');
  });

  it("another firm's office or room, and an archived office, are 404 and change nothing", async () => {
    for (const officeId of [ids.officeB, ids.archivedOffice, randomUUID()]) {
      expectError(
        await call('post', resources('/rooms'), people.ownerA, { officeId, name: 'Room X' }),
        404,
        'NOT_FOUND',
      );
    }
    for (const [method, path, body] of [
      ['patch', resources(`/rooms/${ids.roomB}`), { name: 'Taken over' }],
      ['post', resources(`/rooms/${ids.roomB}/archive`), undefined],
      ['post', resources(`/rooms/${ids.roomB}/restore`), undefined],
    ] as const) {
      expectError(await call(method, path, people.ownerA, body), 404, 'NOT_FOUND');
    }
    const roomB = await asOwner(ids.firmB, (tx) =>
      tx.firmRoom.findUnique({ where: { id: ids.roomB } }),
    );
    expect(roomB).toMatchObject({ name: 'B room', archivedAt: null });
  });
});

describe('equipment', () => {
  it('adds, edits, archives and restores an item; a name is unique among live items, ignoring case', async () => {
    const projector = await addItem({
      name: `Projector ${run}`,
      description: 'HDMI and USB-C',
      officeId: ids.office,
    });
    expect(projector).toMatchObject({
      name: `Projector ${run}`,
      description: 'HDMI and USB-C',
      office: { id: ids.office, name: `Main ${run}` },
      archivedAt: null,
      upcoming: 0,
    });
    expectError(
      await call('post', resources('/equipment'), people.ownerA, {
        name: `PROJECTOR ${run}`,
      }),
      409,
      'DUPLICATE_NAME',
    );
    // Any office, and the description cleared.
    const edited = exact(
      FirmEquipment,
      await call('patch', resources(`/equipment/${projector.id}`), people.adminA, {
        officeId: null,
        description: '',
      }),
    );
    expect(edited).toMatchObject({ office: null, description: null });
    expect(await auditOf('appointment_equipment.updated', projector.id)).toEqual([
      {
        entityType: 'firm_equipment',
        entityId: projector.id,
        metadata: { fields: ['description', 'office'] },
      },
    ]);
    // Archived, its name is free; restored while a live item has it: 409.
    exact(
      FirmEquipment,
      await call('post', resources(`/equipment/${projector.id}/archive`), people.ownerA),
    );
    const second = await addItem({ name: `projector ${run}` });
    expectError(
      await call('post', resources(`/equipment/${projector.id}/restore`), people.ownerA),
      409,
      'DUPLICATE_NAME',
    );
    exact(
      FirmEquipment,
      await call('patch', resources(`/equipment/${second.id}`), people.ownerA, {
        name: `Projector 2 ${run}`,
      }),
    );
    const restored = exact(
      FirmEquipment,
      await call('post', resources(`/equipment/${projector.id}/restore`), people.ownerA),
    );
    expect(restored.archivedAt).toBeNull();
    // An office that is not archived; another firm's or an archived one is 404.
    for (const officeId of [ids.officeB, ids.archivedOffice]) {
      expectError(
        await call('patch', resources(`/equipment/${projector.id}`), people.ownerA, { officeId }),
        404,
        'NOT_FOUND',
      );
    }
    const rows = JSON.stringify(
      await asOwner(ids.firmA, (tx) =>
        tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: projector.id } }),
      ),
    );
    expect(rows).not.toContain('Projector');
    expect(rows).not.toContain('HDMI');
  });

  it("another firm's item is 404 and changes nothing", async () => {
    for (const [method, path, body] of [
      ['patch', resources(`/equipment/${ids.itemB}`), { name: 'Taken over' }],
      ['post', resources(`/equipment/${ids.itemB}/archive`), undefined],
      ['post', resources(`/equipment/${ids.itemB}/restore`), undefined],
    ] as const) {
      expectError(await call(method, path, people.ownerA, body), 404, 'NOT_FOUND');
    }
    const itemB = await asOwner(ids.firmB, (tx) =>
      tx.firmEquipment.findUnique({ where: { id: ids.itemB } }),
    );
    expect(itemB).toMatchObject({ name: 'B projector', archivedAt: null });
  });
});

describe('booking equipment (Schedule Appointment)', () => {
  let pad: FirmEquipment;
  let screen: FirmEquipment;
  let closedItem: FirmEquipment;
  beforeAll(async () => {
    pad = await addItem({ name: `Signature pad ${run}` });
    screen = await addItem({ name: `Screen ${run}`, officeId: ids.office });
    closedItem = await addItem({ name: `Scanner ${run}`, officeId: ids.inactiveOffice });
  });

  it("the form's options list live items: any office's and an active office's own", async () => {
    const archived = await addItem({ name: `Old camera ${run}` });
    exact(
      FirmEquipment,
      await call('post', resources(`/equipment/${archived.id}/archive`), people.ownerA),
    );
    const o = exact(SchedulingOptions, await call('get', '/appointments/options', people.staffA));
    const mine = o.equipment.filter((e) => e.name.endsWith(run));
    expect(mine).toContainEqual({ id: pad.id, name: pad.name, officeId: null });
    expect(mine).toContainEqual({ id: screen.id, name: screen.name, officeId: ids.office });
    expect(mine.map((e) => e.id)).not.toContain(archived.id);
    expect(mine.map((e) => e.id)).not.toContain(closedItem.id);
    expect(JSON.stringify(o)).not.toContain(ids.itemB);
  });

  it('books items with an appointment, and another live appointment cannot hold one at once (409 naming the item)', async () => {
    const n = freshDay();
    const first = await book(n, { roomId: ids.room, equipmentIds: [screen.id, pad.id] });
    expect(first.equipment).toEqual(
      [pad, screen]
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    );
    const read = exact(
      AppointmentRecord,
      await call('get', `/appointments/${first.id}/record`, people.staffA),
    );
    expect(read.equipment).toEqual(first.equipment);

    // Another client and staff member, half an hour into the first: only the pad clashes.
    const clash = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule(n, {
        ...other(),
        startsAt: at(n, '10:30'),
        endsAt: at(n, '11:30'),
        method: 'VIDEO',
        officeId: null,
        details: null,
        videoUrl: 'https://meet.example.test/fake',
        equipmentIds: [pad.id],
        overrideConflicts: { reason: 'Need it' },
      }),
    );
    expectError(clash, 409, 'SCHEDULING_CONFLICT');
    const result = conflictsOf(clash);
    expect(result.canOverride).toBe(false);
    expect(result.conflicts).toEqual([
      {
        kind: 'EQUIPMENT',
        staff: null,
        startsAt: at(n, '10:00'),
        endsAt: at(n, '11:00'),
        message: `${pad.name} is already booked at this time`,
      },
    ]);
    // Never the other appointment's client.
    expect(JSON.stringify(clash.body)).not.toContain('Jamie');
    expect(JSON.stringify(clash.body)).not.toContain(ids.c1);
    const held = await asOwner(ids.firmA, (tx) =>
      tx.appointmentEquipment.count({ where: { businessId: ids.firmA, equipmentId: pad.id } }),
    );
    expect(held).toBe(1);

    // Back to back is fine; so is the pad once the first appointment is cancelled.
    const after = await book(n, {
      ...other(),
      startsAt: at(n, '11:00'),
      endsAt: at(n, '12:00'),
      equipmentIds: [pad.id],
    });
    expect(after.equipment.map((e) => e.id)).toEqual([pad.id]);
    expect((await call('post', `/appointments/${first.id}/cancel`, people.ownerA, {})).status).toBe(
      200,
    );
    const instead = await book(n, {
      ...other(),
      startsAt: at(n, '09:00'),
      endsAt: at(n, '10:30'),
      equipmentIds: [pad.id],
    });
    expect(instead.equipment.map((e) => e.id)).toEqual([pad.id]);
  });

  it("an office's item only for an in-person appointment there; another firm's or an archived item is 404", async () => {
    const n = freshDay();
    const refused = async (extra: object, status: number, code: string) => {
      const before = await asOwner(ids.firmA, (tx) =>
        tx.appointment.count({ where: { businessId: ids.firmA } }),
      );
      const res = await call('post', '/appointments/schedule', people.ownerA, schedule(n, extra));
      expectError(res, status, code);
      const after = await asOwner(ids.firmA, (tx) =>
        tx.appointment.count({ where: { businessId: ids.firmA } }),
      );
      expect(after).toBe(before);
      return res;
    };
    const video = {
      method: 'VIDEO',
      officeId: null,
      details: null,
      videoUrl: 'https://meet.example.test/fake',
    };
    const res = await refused({ ...video, equipmentIds: [screen.id] }, 400, 'VALIDATION_FAILED');
    expect(res.body).toMatchObject({
      error: { details: [{ path: 'equipmentIds' }] },
    });
    await refused({ officeId: ids.office2, equipmentIds: [screen.id] }, 400, 'VALIDATION_FAILED');
    await refused({ equipmentIds: [ids.itemB] }, 404, 'NOT_FOUND');
    await refused({ equipmentIds: [randomUUID()] }, 404, 'NOT_FOUND');
    const gone = await addItem({ name: `Gone item ${run}` });
    exact(
      FirmEquipment,
      await call('post', resources(`/equipment/${gone.id}/archive`), people.ownerA),
    );
    await refused({ equipmentIds: [gone.id] }, 404, 'NOT_FOUND');
    // At most five, each once.
    await refused(
      { equipmentIds: Array.from({ length: 6 }, () => randomUUID()) },
      400,
      'VALIDATION_FAILED',
    );
    await refused({ equipmentIds: [pad.id, pad.id.toUpperCase()] }, 400, 'VALIDATION_FAILED');
    // An any-office item goes with a video meeting.
    const ok = await book(n, { ...video, equipmentIds: [pad.id] });
    expect(ok.equipment.map((e) => e.id)).toEqual([pad.id]);
  });

  it('Edit Existing adds, keeps and releases items, checks a new time against them, and keeps an archived one', async () => {
    const n = freshDay();
    const a = await book(n, { equipmentIds: [pad.id] });
    const b = await book(n, { ...other(), startsAt: at(n, '13:00'), endsAt: at(n, '14:00') });
    const patch = async (id: string, version: string, body: object) =>
      call('patch', `/appointments/${id}/details`, people.ownerA, { version, ...body });

    // B takes the pad at its own time, then can't move onto A's.
    const withPad = exact(
      AppointmentRecord,
      await patch(b.id, b.version, { equipmentIds: [pad.id] }),
    );
    expect(withPad.equipment.map((e) => e.id)).toEqual([pad.id]);
    const moved = await patch(b.id, withPad.version, {
      startsAt: at(n, '10:30'),
      endsAt: at(n, '11:30'),
    });
    expectError(moved, 409, 'SCHEDULING_CONFLICT');
    expect(conflictsOf(moved).conflicts.map((c) => c.kind)).toEqual(['EQUIPMENT']);
    const still = exact(
      AppointmentRecord,
      await call('get', `/appointments/${b.id}/record`, people.ownerA),
    );
    expect(still.startsAt).toBe(at(n, '13:00'));
    // Letting the pad go in the same change frees the time.
    const released = exact(
      AppointmentRecord,
      await patch(b.id, still.version, {
        startsAt: at(n, '10:30'),
        endsAt: at(n, '11:30'),
        equipmentIds: [],
      }),
    );
    expect(released.equipment).toEqual([]);
    const audit = await auditOf('appointment.details_updated', b.id);
    expect(audit.map((r) => (r.metadata as { fields: string[] }).fields)).toEqual([
      ['equipment'],
      ['equipment', 'time'],
    ]);

    // Archived since: A keeps it through an edit; nothing new can take it.
    const item = await addItem({ name: `Laptop ${run}` });
    const withBoth = exact(
      AppointmentRecord,
      await patch(a.id, a.version, { equipmentIds: [pad.id, item.id] }),
    );
    exact(
      FirmEquipment,
      await call('post', resources(`/equipment/${item.id}/archive`), people.ownerA),
    );
    const kept = exact(
      AppointmentRecord,
      await patch(a.id, withBoth.version, {
        internalNotes: 'Bring the laptop charger',
        equipmentIds: [pad.id, item.id],
      }),
    );
    expect(kept.equipment.map((e) => e.id).sort()).toEqual([pad.id, item.id].sort());
    expectError(await patch(b.id, released.version, { equipmentIds: [item.id] }), 404, 'NOT_FOUND');
    // A move to another office drops nothing on its own: its office's item must go first.
    const screenHeld = exact(
      AppointmentRecord,
      await patch(a.id, kept.version, { equipmentIds: [pad.id, item.id, screen.id] }),
    );
    const res = await patch(a.id, screenHeld.version, { officeId: ids.office2 });
    expectError(res, 400, 'VALIDATION_FAILED');
  });

  it("the conflict check before saving reports a held item; another firm's item is 404", async () => {
    const n = freshDay();
    const a = await book(n, { equipmentIds: [pad.id] });
    const check = (body: object) =>
      call('post', '/appointments/conflicts', people.ownerA, {
        staffUserIds: [people.staffA2.id],
        startsAt: at(n, '10:15'),
        endsAt: at(n, '10:45'),
        ...body,
      });
    const held = exact(ConflictResult, await check({ equipmentIds: [pad.id] }));
    expect(held.ok).toBe(false);
    expect(held.conflicts).toEqual([
      expect.objectContaining({
        kind: 'EQUIPMENT',
        message: `${pad.name} is already booked at this time`,
      }),
    ]);
    // Its own appointment, being edited, never clashes with itself.
    const own = exact(
      ConflictResult,
      await check({ equipmentIds: [pad.id], excludeAppointmentId: a.id }),
    );
    expect(own.ok).toBe(true);
    expectError(await check({ equipmentIds: [ids.itemB] }), 404, 'NOT_FOUND');
  });

  it("a draft names only this firm's items, and Duplicate carries the live ones", async () => {
    const draft = exact(
      AppointmentDraft,
      await call('post', '/appointment-drafts', people.staffA, {
        contact: { kind: 'CLIENT', id: ids.c1 },
        equipmentIds: [pad.id],
      }),
      201,
    );
    expect(draft.data).toMatchObject({ equipmentIds: [pad.id] });
    expectError(
      await call('post', '/appointment-drafts', people.staffA, { equipmentIds: [ids.itemB] }),
      404,
      'NOT_FOUND',
    );
    const n = freshDay();
    const a = await book(n, { equipmentIds: [pad.id, screen.id] });
    const copy = exact(
      AppointmentDraft,
      await call('post', `/appointments/${a.id}/duplicate`, people.ownerA, {}),
    );
    expect((copy.data as { equipmentIds: string[] }).equipmentIds.sort()).toEqual(
      [pad.id, screen.id].sort(),
    );
  });
});
