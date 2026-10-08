// End-to-end: R12 step 2, the firm's side of appointments (contract in
// packages/types/src/appointments): appointment types, working hours, blocked time (part A), and
// the calendar with the Staff rule (in full only their own and their assigned clients'
// appointments, Busy otherwise), free slots, booking and changes with their history (part B). The
// database refuses double booking and blocked time (409 SLOT_TAKEN). Another firm gets 404 and
// changes nothing; reads and changes are audited without names, emails or reasons. Part A's tests
// write an appointment straight to the database where they need one. The portal is part C.
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
  Appointment,
  AppointmentDetail,
  AppointmentList,
  AppointmentType,
  AppointmentTypeList,
  Availability,
  BlockedTime,
  BlockedTimeList,
  MemberAvailability,
  OkResponse,
  SlotList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { BLOCK_LIMITS } from '../../src/appointments/availability.service.js';
import { calendarLockKey } from '../../src/appointments/calendar-locks.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
/** Firm A's time zone: half-hour offset and no daylight saving, so times are exact any day. */
const TZ = 'Asia/Kolkata';
const person = (key: string) => ({ id: randomUUID(), email: `r12a-${key}-${run}@r12.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  formerA: person('former-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  /** Owner of a firm still in setup (PENDING_SETUP). */
  ownerSetup: person('owner-setup'),
};
const names = Object.fromEntries(Object.keys(people).map((k) => [k, `Fake R12a ${k}`])) as Record<
  keyof typeof people,
  string
>;
const ids = {
  firmA: '',
  firmB: '',
  firmSetup: '',
  /** Assigned to staffA, with clientA's portal login. */
  c1: '',
  /** Assigned to staffA2. */
  c2: '',
  /** Assigned to no one. */
  c3: '',
  archived: '',
  engagement1: '',
  engagementC2: '',
  clientB: '',
  typeB: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.51.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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

type Who = { email: string };
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

const today = zonedDate(TZ, Date.now());
/** The firm-local date `n` days from today. */
const day = (n: number) => addDays(today, n);
/** An instant on that day at a firm-local time ("10:30"). */
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, day(n), minutesOf(time))).toISOString();
const range = (fromDay: number, toDay: number) =>
  `from=${encodeURIComponent(at(fromDay, '00:00'))}&to=${encodeURIComponent(at(toDay, '00:00'))}`;

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const createType = async (body: object, who: Who = people.ownerA) =>
  exact(AppointmentType, await call('post', '/appointment-types', who, body), 201);
const book = async (body: object, who: Who = people.ownerA) =>
  exact(Appointment, await call('post', '/appointments', who, body), 201);
const detail = async (id: string, who: Who = people.ownerA) =>
  exact(AppointmentDetail, await call('get', `/appointments/${id}`, who));
/**
 * A scheduled appointment written straight to the database: booking through the API comes in
 * part B. The database's own rules (no double booking, no blocked time) still apply.
 */
async function seedAppointment(
  clientId: string,
  staffUserId: string,
  type: AppointmentType,
  startsAt: string,
): Promise<{ id: string }> {
  const start = new Date(startsAt);
  return asOwner(ids.firmA, (tx) =>
    tx.appointment.create({
      data: {
        businessId: ids.firmA,
        clientId,
        staffUserId,
        typeId: type.id,
        startsAt: start,
        endsAt: new Date(start.getTime() + type.durationMinutes * 60_000),
        locationKind: type.locationKind,
        bookedByUserId: people.ownerA.id,
      },
      select: { id: true },
    }),
  );
}
const cancelSeeded = (id: string) =>
  asOwner(ids.firmA, (tx) =>
    tx.appointment.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    }),
  );

let consult: AppointmentType;
let review: AppointmentType;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: names[key as keyof typeof people],
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r12a-${key.toLowerCase()}-${run}`;
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
    const setupSlug = `r12a-setup-${run}`;
    ids.firmSetup = (
      await tx.business.create({
        data: { slug: setupSlug, name: setupSlug, status: 'PENDING_SETUP' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmSetup }, (tx) =>
    tx.membership.create({
      data: {
        businessId: ids.firmSetup,
        userId: people.ownerSetup.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: TZ } });
    for (const [userId, role, status] of [
      [people.ownerA.id, 'OWNER', 'ACTIVE'],
      [people.adminA.id, 'ADMIN', 'ACTIVE'],
      [people.staffA.id, 'STAFF', 'ACTIVE'],
      [people.staffA2.id, 'STAFF', 'ACTIVE'],
      [people.formerA.id, 'STAFF', 'DEACTIVATED'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status } });
    }
    const client = (displayName: string, assignedUserId: string | null, archivedAt?: Date) =>
      tx.client.create({ data: { ...A, displayName, assignedUserId, archivedAt } });
    ids.c1 = (await client('Jamie Sample (fake)', people.staffA.id)).id;
    ids.c2 = (await client('Riley Example (fake)', people.staffA2.id)).id;
    ids.c3 = (await client('Casey Nobody (fake)', null)).id;
    ids.archived = (await client('Old Client (fake)', people.staffA.id, new Date())).id;
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.clientA.id,
        clientId: ids.c1,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({
      data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
    });
    const engagement = (clientId: string) =>
      tx.engagement.create({
        data: { ...A, clientId, serviceId: service.id, title: '2025 Personal Tax' },
      });
    ids.engagement1 = (await engagement(ids.c1)).id;
    ids.engagementC2 = (await engagement(ids.c2)).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: 'B Client' } })).id;
    ids.typeB = (
      await tx.appointmentType.create({ data: { ...B, name: 'B type', durationMinutes: 30 } })
    ).id;
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
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;

  consult = await createType({ name: `Consultation ${run}`, durationMinutes: 30 });
  review = await createType({
    name: `Review ${run}`,
    durationMinutes: 60,
    locationKind: 'IN_PERSON',
    clientBookable: true,
  });
  // staffA and staffA2 work 09:00-12:00 every day (firm time); staffA2 also 13:00-14:00.
  const week = (ranges: string[][]) => ({
    hours: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      ranges.map(([startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
    ),
  });
  const weeks: [Who & { id: string }, string[][]][] = [
    [people.staffA, [['09:00', '12:00']]],
    [
      people.staffA2,
      [
        ['09:00', '12:00'],
        ['13:00', '14:00'],
      ],
    ],
  ];
  for (const [who, ranges] of weeks) {
    const res = await call(
      'put',
      `/availability/${who.id}/working-hours`,
      people.ownerA,
      week(ranges),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
});

afterAll(async () => {
  await app.close();
});

describe('appointment types', () => {
  it('Owner and Admin create (defaults: video, not bookable, 24 h); Staff read but cannot change', async () => {
    expect(consult).toMatchObject({
      durationMinutes: 30,
      locationKind: 'VIDEO',
      clientBookable: false,
      cancelCutoffHours: 24,
      archivedAt: null,
    });
    const byAdmin = await createType(
      { name: `Admin made ${run}`, durationMinutes: 45, sortOrder: 7 },
      people.adminA,
    );
    expect(byAdmin.sortOrder).toBe(7);
    const list = exact(AppointmentTypeList, await call('get', '/appointment-types', people.staffA));
    expect(list.items.map((t) => t.id)).toEqual(
      expect.arrayContaining([consult.id, review.id, byAdmin.id]),
    );
    for (const res of [
      await call('post', '/appointment-types', people.staffA, { name: 'X', durationMinutes: 30 }),
      await call('patch', `/appointment-types/${consult.id}`, people.staffA, { name: 'Y' }),
      await call('post', `/appointment-types/${consult.id}/archive`, people.staffA, {}),
      await call('post', `/appointment-types/${consult.id}/restore`, people.staffA, {}),
    ]) {
      expectError(res, 403, 'FORBIDDEN');
    }
    expect((await call('get', '/appointment-types', people.clientA)).status).toBe(403);
  });

  it('names are unique per firm, ignoring case (409 DUPLICATE_NAME); another firm may reuse one', async () => {
    expectError(
      await call('post', '/appointment-types', people.ownerA, {
        name: consult.name.toUpperCase(),
        durationMinutes: 30,
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('patch', `/appointment-types/${review.id}`, people.ownerA, {
        name: consult.name.toLowerCase(),
      }),
      409,
      'DUPLICATE_NAME',
    );
    const other = exact(
      AppointmentType,
      await call(
        'post',
        '/appointment-types',
        people.ownerB,
        { name: consult.name, durationMinutes: 30 },
        ids.firmB,
      ),
      201,
    );
    expect(other.name).toBe(consult.name);
  });

  it('updates only what is sent; a cutoff other than 24 hours is refused for now; bad input is 400', async () => {
    const t = await createType({ name: `Editable ${run}`, durationMinutes: 30 });
    const updated = exact(
      AppointmentType,
      await call('patch', `/appointment-types/${t.id}`, people.adminA, {
        durationMinutes: 90,
        clientBookable: true,
        cancelCutoffHours: 24,
      }),
    );
    expect(updated).toMatchObject({ name: t.name, durationMinutes: 90, clientBookable: true });
    // The case of its own name may change.
    expect(
      exact(
        AppointmentType,
        await call('patch', `/appointment-types/${t.id}`, people.ownerA, {
          name: t.name.toUpperCase(),
        }),
      ).name,
    ).toBe(t.name.toUpperCase());
    // Until R0 adds appointment_types.cancel_cutoff_hours, every type has the 24-hour window.
    for (const [method, path, body] of [
      [
        'post',
        '/appointment-types',
        { name: `Cutoff ${run}`, durationMinutes: 30, cancelCutoffHours: 48 },
      ],
      ['patch', `/appointment-types/${t.id}`, { cancelCutoffHours: 0 }],
    ] as const) {
      expectError(await call(method, path, people.ownerA, body), 409, 'CUTOFF_NOT_SUPPORTED');
    }
    for (const [method, path, body] of [
      [
        'post',
        '/appointment-types',
        { name: `Cutoff ${run}`, durationMinutes: 30, cancelCutoffHours: 721 },
      ],
      ['patch', `/appointment-types/${t.id}`, {}],
      ['patch', `/appointment-types/${t.id}`, { durationMinutes: 20 }],
      ['patch', `/appointment-types/${t.id}`, { businessId: ids.firmB }],
      ['post', '/appointment-types', { name: ' ', durationMinutes: 30 }],
      ['post', '/appointment-types', { name: 'Long', durationMinutes: 495 }],
    ] as const) {
      expectError(await call(method, path, people.ownerA, body), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await call('get', '/appointment-types?status=gone', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', '/appointment-types/not-a-uuid', people.ownerA, { name: 'Z' }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('archive hides a type from the default list; restore brings it back; repeating is harmless', async () => {
    const t = await createType({ name: `Archivable ${run}`, durationMinutes: 30 });
    const archived = exact(
      AppointmentType,
      await call('post', `/appointment-types/${t.id}/archive`, people.ownerA, {}),
    );
    expect(archived.archivedAt).not.toBeNull();
    const again = exact(
      AppointmentType,
      await call('post', `/appointment-types/${t.id}/archive`, people.adminA, {}),
    );
    expect(again.archivedAt).toBe(archived.archivedAt);
    const ids_ = async (status: string) =>
      exact(
        AppointmentTypeList,
        await call('get', `/appointment-types?status=${status}`, people.staffA),
      ).items.map((x) => x.id);
    expect(await ids_('active')).not.toContain(t.id);
    expect(await ids_('archived')).toContain(t.id);
    expect(await ids_('all')).toEqual(expect.arrayContaining([t.id, consult.id]));
    const restored = exact(
      AppointmentType,
      await call('post', `/appointment-types/${t.id}/restore`, people.ownerA, {}),
    );
    expect(restored.archivedAt).toBeNull();
  });
});

describe('appointment type audit (#102 review)', () => {
  it('lists only the fields sent, and writes nothing for a change that changes nothing', async () => {
    const t = await createType({ name: `Quiet ${run}`, durationMinutes: 30 });
    exact(
      AppointmentType,
      await call('patch', `/appointment-types/${t.id}`, people.ownerA, {
        durationMinutes: 30,
        cancelCutoffHours: 24,
      }),
    );
    exact(
      AppointmentType,
      await call('patch', `/appointment-types/${t.id}`, people.ownerA, { durationMinutes: 45 }),
    );
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, entityId: t.id },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    );
    expect(rows).toEqual([
      { action: 'appointment_type.created', metadata: { fields: ['durationMinutes', 'name'] } },
      { action: 'appointment_type.updated', metadata: { fields: ['durationMinutes'] } },
    ]);
  });
});

describe('working hours', () => {
  it("everyone reads every active member's week, in the firm's time zone", async () => {
    const res = exact(Availability, await call('get', '/availability', people.staffA2));
    expect(res.timezone).toBe(TZ);
    const byId = new Map(res.members.map((m) => [m.member.userId, m]));
    expect([...byId.keys()].sort()).toEqual(
      [people.ownerA.id, people.adminA.id, people.staffA.id, people.staffA2.id].sort(),
    );
    expect(byId.get(people.staffA.id)?.member.name).toBe(names.staffA);
    expect(byId.get(people.staffA.id)?.hours).toHaveLength(7);
    expect(byId.get(people.staffA2.id)?.hours.filter((h) => h.weekday === 1)).toEqual([
      { weekday: 1, startsAt: '09:00', endsAt: '12:00' },
      { weekday: 1, startsAt: '13:00', endsAt: '14:00' },
    ]);
    expect(byId.get(people.ownerA.id)?.hours).toEqual([]);
  });

  it('Owner and Admin set anyone; Staff only themselves (403); a former or unknown member is 404', async () => {
    const mine = exact(
      MemberAvailability,
      await call('put', `/availability/${people.adminA.id}/working-hours`, people.adminA, {
        hours: [{ weekday: 2, startsAt: '10:00', endsAt: '11:30' }],
      }),
    );
    expect(mine).toEqual({
      member: { userId: people.adminA.id, name: names.adminA },
      hours: [{ weekday: 2, startsAt: '10:00', endsAt: '11:30' }],
    });
    // An empty list means no hours.
    expect(
      exact(
        MemberAvailability,
        await call('put', `/availability/${people.adminA.id}/working-hours`, people.ownerA, {
          hours: [],
        }),
      ).hours,
    ).toEqual([]);
    // An Admin sets another member's week too (the Owner's here, cleared again after).
    for (const hours of [[{ weekday: 0, startsAt: '08:00', endsAt: '08:45' }], []]) {
      expect(
        exact(
          MemberAvailability,
          await call('put', `/availability/${people.ownerA.id}/working-hours`, people.adminA, {
            hours,
          }),
        ),
      ).toEqual({ member: { userId: people.ownerA.id, name: names.ownerA }, hours });
    }
    expectError(
      await call('put', `/availability/${people.staffA2.id}/working-hours`, people.staffA, {
        hours: [],
      }),
      403,
      'FORBIDDEN',
    );
    for (const userId of [people.formerA.id, people.ownerB.id, randomUUID()]) {
      expectError(
        await call('put', `/availability/${userId}/working-hours`, people.ownerA, { hours: [] }),
        404,
        'NOT_FOUND',
      );
    }
  });

  it('refuses overlapping ranges, off-grid times, an end before the start and unknown fields (400)', async () => {
    for (const hours of [
      [
        { weekday: 1, startsAt: '09:00', endsAt: '11:00' },
        { weekday: 1, startsAt: '10:00', endsAt: '12:00' },
      ],
      [{ weekday: 1, startsAt: '09:10', endsAt: '10:00' }],
      [{ weekday: 1, startsAt: '11:00', endsAt: '10:00' }],
      [{ weekday: 7, startsAt: '09:00', endsAt: '10:00' }],
      [{ weekday: 1, startsAt: '09:00', endsAt: '10:00', userId: people.staffA2.id }],
    ]) {
      expectError(
        await call('put', `/availability/${people.staffA.id}/working-hours`, people.staffA, {
          hours,
        }),
        400,
        'VALIDATION_FAILED',
      );
    }
    // Unchanged after the refusals.
    const res = exact(Availability, await call('get', '/availability', people.staffA));
    expect(res.members.find((m) => m.member.userId === people.staffA.id)?.hours).toHaveLength(7);
  });
});

describe('blocked time', () => {
  it('Staff block themselves; whole-firm blocks and other members are for Owner and Admin (403)', async () => {
    const own = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.staffA, {
        userId: people.staffA.id,
        startsAt: at(3, '09:00'),
        endsAt: at(3, '09:30'),
        reason: 'Dentist',
      }),
      201,
    );
    expect(own).toMatchObject({
      member: { userId: people.staffA.id, name: names.staffA },
      createdBy: { userId: people.staffA.id, name: names.staffA },
      reason: 'Dentist',
    });
    for (const userId of [null, people.staffA2.id]) {
      expectError(
        await call('post', '/blocked-times', people.staffA, {
          userId,
          startsAt: at(3, '10:00'),
          endsAt: at(3, '10:30'),
        }),
        403,
        'FORBIDDEN',
      );
    }
    const firmWide = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.adminA, {
        userId: null,
        startsAt: at(3, '11:00'),
        endsAt: at(3, '11:30'),
        reason: '',
      }),
      201,
    );
    expect(firmWide).toMatchObject({ member: null, reason: null });
    expectError(
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.formerA.id,
        startsAt: at(3, '10:00'),
        endsAt: at(3, '10:30'),
      }),
      404,
      'NOT_FOUND',
    );
  });

  it("lists blocks touching the range; one member's include the firm's", async () => {
    const forA2 = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.staffA2.id,
        startsAt: at(4, '09:00'),
        endsAt: at(4, '10:00'),
      }),
      201,
    );
    const all = exact(
      BlockedTimeList,
      await call('get', `/blocked-times?${range(3, 5)}`, people.staffA),
    ).items;
    expect(all.map((b) => b.id)).toContain(forA2.id);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const onlyA = exact(
      BlockedTimeList,
      await call('get', `/blocked-times?${range(3, 5)}&userId=${people.staffA.id}`, people.staffA),
    ).items;
    expect(onlyA).toHaveLength(2);
    expect(onlyA.map((b) => b.member?.userId ?? null)).toEqual(
      expect.arrayContaining([null, people.staffA.id]),
    );
    const none = exact(
      BlockedTimeList,
      await call('get', `/blocked-times?${range(30, 31)}`, people.staffA),
    ).items;
    expect(none).toEqual([]);
    for (const q of [
      range(3, 100),
      'from=9999-12-01T00%3A00%3A00Z&to=9999-12-31T00%3A00%3A00Z',
      `${range(3, 5)}&userId=not-a-uuid`,
    ]) {
      expectError(
        await call('get', `/blocked-times?${q}`, people.staffA),
        400,
        'VALIDATION_FAILED',
      );
    }
    expectError(
      await call('post', '/blocked-times', people.ownerA, {
        userId: null,
        startsAt: '9999-12-31T00:00:00Z',
        endsAt: '9999-12-31T01:00:00Z',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('cannot cover a scheduled appointment (409 BLOCKS_APPOINTMENT); a cancelled one does not count', async () => {
    const a = await seedAppointment(ids.c3, people.staffA2.id, consult, at(5, '10:00'));
    for (const [who, userId] of [
      [people.staffA2, people.staffA2.id],
      [people.ownerA, null],
    ] as const) {
      expectError(
        await call('post', '/blocked-times', who, {
          userId,
          startsAt: at(5, '09:45'),
          endsAt: at(5, '10:15'),
        }),
        409,
        'BLOCKS_APPOINTMENT',
      );
    }
    // Another member's block at the same time is fine, and so is back to back.
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.staffA, {
        userId: people.staffA.id,
        startsAt: at(5, '10:00'),
        endsAt: at(5, '10:30'),
      }),
      201,
    );
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.staffA2, {
        userId: people.staffA2.id,
        startsAt: at(5, '10:30'),
        endsAt: at(5, '11:00'),
      }),
      201,
    );
    await cancelSeeded(a.id);
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.staffA2, {
        userId: people.staffA2.id,
        startsAt: at(5, '09:45'),
        endsAt: at(5, '10:15'),
      }),
      201,
    );
  });

  it('Staff delete only their own; Owner any; another firm gets 404 and changes nothing', async () => {
    const block = async (who: Who, userId: string | null) =>
      exact(
        BlockedTime,
        await call('post', '/blocked-times', who, {
          userId,
          startsAt: at(6, '13:00'),
          endsAt: at(6, '13:15'),
        }),
        201,
      );
    const own = await block(people.staffA, people.staffA.id);
    const others = await block(people.ownerA, people.staffA2.id);
    const firmWide = await block(people.ownerA, null);
    for (const b of [others, firmWide]) {
      expectError(await call('delete', `/blocked-times/${b.id}`, people.staffA), 403, 'FORBIDDEN');
    }
    expectError(
      await call('delete', `/blocked-times/${own.id}`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    exact(OkResponse, await call('delete', `/blocked-times/${own.id}`, people.staffA));
    expectError(await call('delete', `/blocked-times/${own.id}`, people.staffA), 404, 'NOT_FOUND');
    for (const b of [others, firmWide]) {
      exact(OkResponse, await call('delete', `/blocked-times/${b.id}`, people.ownerA));
    }
    expectError(
      await call('delete', '/blocked-times/nope', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('blocked time limits (#102 review)', () => {
  it('caps a calendar at its blocks that have not ended (409 BLOCK_LIMIT); a block lasts at most 366 days', async () => {
    const limit = BLOCK_LIMITS.perCalendar;
    BLOCK_LIMITS.perCalendar = 2;
    try {
      // A block that has ended does not count.
      await asOwner(ids.firmA, (tx) =>
        tx.blockedTime.create({
          data: {
            businessId: ids.firmA,
            userId: people.adminA.id,
            startsAt: new Date(at(-3, '09:00')),
            endsAt: new Date(at(-3, '10:00')),
            createdByUserId: people.ownerA.id,
          },
        }),
      );
      for (const [start, end] of [
        ['09:00', '09:30'],
        ['10:00', '10:30'],
      ] as const) {
        exact(
          BlockedTime,
          await call('post', '/blocked-times', people.adminA, {
            userId: people.adminA.id,
            startsAt: at(28, start),
            endsAt: at(28, end),
          }),
          201,
        );
      }
      expectError(
        await call('post', '/blocked-times', people.adminA, {
          userId: people.adminA.id,
          startsAt: at(28, '11:00'),
          endsAt: at(28, '11:30'),
        }),
        409,
        'BLOCK_LIMIT',
      );
      // Another member's calendar has its own count (the Owner's has no blocks yet).
      exact(
        BlockedTime,
        await call('post', '/blocked-times', people.ownerA, {
          userId: people.ownerA.id,
          startsAt: at(28, '13:00'),
          endsAt: at(28, '13:30'),
        }),
        201,
      );
    } finally {
      BLOCK_LIMITS.perCalendar = limit;
    }
    const start = at(29, '09:00');
    expectError(
      await call('post', '/blocked-times', people.ownerA, {
        userId: null,
        startsAt: start,
        endsAt: new Date(Date.parse(start) + 367 * 24 * 3_600_000).toISOString(),
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('booking and the database rules', () => {
  it("books with the type's length and location, for an engagement of that client", async () => {
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: review.id,
      startsAt: at(7, '09:00'),
      engagementId: ids.engagement1,
      locationDetails: 'Main office, room 2',
    });
    expect(a).toMatchObject({
      client: { id: ids.c1, displayName: 'Jamie Sample (fake)' },
      staff: { userId: people.staffA.id, name: names.staffA },
      type: { id: review.id, name: review.name },
      engagementId: ids.engagement1,
      startsAt: at(7, '09:00'),
      endsAt: at(7, '10:00'),
      status: 'SCHEDULED',
      locationKind: 'IN_PERSON',
      locationDetails: 'Main office, room 2',
      bookedByClient: false,
      rescheduleCount: 0,
      cancelledAt: null,
      cancelReason: null,
    });
    // Without a type, the duration is given; working hours are a guide for the firm.
    const evening = await book({
      clientId: ids.c3,
      staffUserId: people.ownerA.id,
      startsAt: at(7, '19:00'),
      durationMinutes: 45,
      locationKind: 'PHONE',
    });
    expect(evening).toMatchObject({ type: null, endsAt: at(7, '19:45'), locationKind: 'PHONE' });
  });

  it("an overlap with the staff member's or the client's appointments, or blocked time, is 409 SLOT_TAKEN", async () => {
    await book({
      clientId: ids.c2,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(8, '10:00'),
    });
    const tries = [
      // The same staff member, overlapping.
      { clientId: ids.c3, staffUserId: people.staffA2.id, startsAt: at(8, '10:15') },
      // The same client with someone else.
      { clientId: ids.c2, staffUserId: people.staffA.id, startsAt: at(8, '09:45') },
    ];
    for (const body of tries) {
      expectError(
        await call('post', '/appointments', people.ownerA, { ...body, typeId: consult.id }),
        409,
        'SLOT_TAKEN',
      );
    }
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.staffA.id,
        startsAt: at(8, '11:00'),
        endsAt: at(8, '12:00'),
      }),
      201,
    );
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: null,
        startsAt: at(8, '15:00'),
        endsAt: at(8, '16:00'),
      }),
      201,
    );
    for (const startsAt of [at(8, '11:15'), at(8, '15:30')]) {
      expectError(
        await call('post', '/appointments', people.ownerA, {
          clientId: ids.c3,
          staffUserId: people.staffA.id,
          typeId: consult.id,
          startsAt,
        }),
        409,
        'SLOT_TAKEN',
      );
    }
    // Back to back is fine.
    await book({
      clientId: ids.c3,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(8, '10:30'),
    });
    const day8 = exact(
      AppointmentList,
      await call('get', `/appointments?${range(8, 9)}`, people.ownerA),
    ).items;
    expect(day8).toHaveLength(2);
  });

  it('refuses archived types and clients (409), unknown or other firms records (404), bad input (400)', async () => {
    const old = await createType({ name: `Retired ${run}`, durationMinutes: 30 });
    await call('post', `/appointment-types/${old.id}/archive`, people.ownerA, {});
    const base = { clientId: ids.c3, staffUserId: people.staffA.id, startsAt: at(9, '09:00') };
    expectError(
      await call('post', '/appointments', people.ownerA, { ...base, typeId: old.id }),
      409,
      'TYPE_ARCHIVED',
    );
    expectError(
      await call('post', '/appointments', people.ownerA, {
        ...base,
        clientId: ids.archived,
        typeId: consult.id,
      }),
      409,
      'CLIENT_ARCHIVED',
    );
    for (const body of [
      { ...base, clientId: ids.clientB, typeId: consult.id },
      { ...base, clientId: randomUUID(), typeId: consult.id },
      { ...base, staffUserId: people.formerA.id, typeId: consult.id },
      { ...base, staffUserId: people.ownerB.id, typeId: consult.id },
      { ...base, typeId: ids.typeB },
      { ...base, typeId: consult.id, engagementId: ids.engagementC2 },
    ]) {
      expectError(await call('post', '/appointments', people.ownerA, body), 404, 'NOT_FOUND');
    }
    for (const body of [
      { ...base },
      { ...base, typeId: consult.id, durationMinutes: 20 },
      { ...base, typeId: consult.id, startsAt: '2026-10-12T10:00:00' },
      { ...base, typeId: consult.id, businessId: ids.firmB },
      { ...base, typeId: consult.id, bookedByClient: true },
      // Outside the calendar's years (2000 to 2100): the date math would leave four digits.
      { ...base, typeId: consult.id, startsAt: '9999-12-31T23:00:00Z' },
      { ...base, typeId: consult.id, startsAt: '0000-01-01T00:00:00+14:00' },
    ]) {
      expectError(
        await call('post', '/appointments', people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  it('Staff book only for their assigned clients (404 otherwise), with any staff member', async () => {
    const a = await book(
      {
        clientId: ids.c1,
        staffUserId: people.staffA2.id,
        typeId: consult.id,
        startsAt: at(9, '11:00'),
      },
      people.staffA,
    );
    expect(a.staff.userId).toBe(people.staffA2.id);
    for (const clientId of [ids.c2, ids.c3]) {
      expectError(
        await call('post', '/appointments', people.staffA, {
          clientId,
          staffUserId: people.staffA.id,
          typeId: consult.id,
          startsAt: at(9, '09:30'),
        }),
        404,
        'NOT_FOUND',
      );
    }
  });
});

describe('the calendar and the Staff rule', () => {
  let mineAsStaff: Appointment;
  let assignedToMe: Appointment;
  let notMine: Appointment;

  beforeAll(async () => {
    // staffA is the staff member; c3 is nobody's.
    mineAsStaff = await book({
      clientId: ids.c3,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(10, '09:00'),
    });
    // c1 is assigned to staffA; the staff member is someone else.
    assignedToMe = await book({
      clientId: ids.c1,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(10, '10:00'),
    });
    // Neither: Busy for staffA.
    notMine = await book({
      clientId: ids.c2,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(10, '11:00'),
      locationDetails: 'https://meet.example.test/secret-room',
    });
  });

  it('Owner and Admin see every appointment in full, oldest first', async () => {
    for (const who of [people.ownerA, people.adminA]) {
      const items = exact(
        AppointmentList,
        await call('get', `/appointments?${range(10, 11)}`, who),
      ).items;
      expect(items.map((i) => [i.id, i.restricted])).toEqual([
        [mineAsStaff.id, false],
        [assignedToMe.id, false],
        [notMine.id, false],
      ]);
    }
  });

  it('Staff see their own and their clients in full, the rest only as Busy', async () => {
    const res = await call('get', `/appointments?${range(10, 11)}`, people.staffA);
    const items = exact(AppointmentList, res).items;
    expect(items.map((i) => [i.id, i.restricted])).toEqual([
      [mineAsStaff.id, false],
      [assignedToMe.id, false],
      [notMine.id, true],
    ]);
    // Only the time, staff member and status: no client, type, location or reason.
    const raw = (res.body as { items: Record<string, unknown>[] }).items[2];
    expect(Object.keys(raw ?? {}).sort()).toEqual(
      ['endsAt', 'id', 'restricted', 'staff', 'startsAt', 'status'].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('Riley');
    expect(JSON.stringify(res.body)).not.toContain('secret-room');
  });

  it("Staff get 404 for a Busy appointment's detail and every change, and a client not theirs", async () => {
    expect((await detail(assignedToMe.id, people.staffA)).id).toBe(assignedToMe.id);
    expect((await detail(mineAsStaff.id, people.staffA)).id).toBe(mineAsStaff.id);
    for (const [path, body] of [
      [`/appointments/${notMine.id}/reschedule`, { startsAt: at(10, '11:30') }],
      [`/appointments/${notMine.id}/cancel`, {}],
      [`/appointments/${notMine.id}/complete`, {}],
      [`/appointments/${notMine.id}/no-show`, {}],
    ] as const) {
      expectError(await call('post', path, people.staffA, body), 404, 'NOT_FOUND');
    }
    expectError(await call('get', `/appointments/${notMine.id}`, people.staffA), 404, 'NOT_FOUND');
    // Nor can a Busy one be the appointment being moved in the free slots.
    const moving = `typeId=${consult.id}&from=${day(10)}&to=${day(10)}&excludeAppointmentId=`;
    expectError(
      await call('get', `/appointments/slots?${moving}${notMine.id}`, people.staffA),
      404,
      'NOT_FOUND',
    );
    exact(
      SlotList,
      await call('get', `/appointments/slots?${moving}${assignedToMe.id}`, people.staffA),
    );
    for (const clientId of [ids.c2, ids.c3, randomUUID()]) {
      expectError(
        await call('get', `/appointments?${range(10, 11)}&clientId=${clientId}`, people.staffA),
        404,
        'NOT_FOUND',
      );
    }
    const theirs = exact(
      AppointmentList,
      await call('get', `/appointments?${range(10, 11)}&clientId=${ids.c1}`, people.staffA),
    ).items;
    expect(theirs.map((i) => i.id)).toEqual([assignedToMe.id]);
    // The Busy one is still unchanged.
    expect((await detail(notMine.id)).status).toBe('SCHEDULED');
  });

  it('filters by staff member, client and status; the range is at most 62 days', async () => {
    const byStaff = exact(
      AppointmentList,
      await call(
        'get',
        `/appointments?${range(10, 11)}&staffUserId=${people.staffA2.id}`,
        people.ownerA,
      ),
    ).items;
    expect(byStaff.map((i) => i.id)).toEqual([assignedToMe.id, notMine.id]);
    const byClient = exact(
      AppointmentList,
      await call('get', `/appointments?${range(10, 11)}&clientId=${ids.c2}`, people.ownerA),
    ).items;
    expect(byClient.map((i) => i.id)).toEqual([notMine.id]);
    const cancelled = exact(
      AppointmentList,
      await call('get', `/appointments?${range(10, 11)}&status=CANCELLED`, people.ownerA),
    ).items;
    expect(cancelled).toEqual([]);
    for (const q of [
      range(10, 80),
      `from=${encodeURIComponent(at(11, '00:00'))}&to=${encodeURIComponent(at(10, '00:00'))}`,
      `${range(10, 11)}&status=LATE`,
      `${range(10, 11)}&extra=1`,
      'from=yesterday&to=today',
      'from=1999-12-01T00%3A00%3A00Z&to=1999-12-02T00%3A00%3A00Z',
      `${range(10, 11)}&from=${encodeURIComponent(at(10, '00:00'))}`,
    ]) {
      expectError(await call('get', `/appointments?${q}`, people.ownerA), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await call('get', '/appointments/not-a-uuid', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('changes and their history', () => {
  it('reschedule moves the time and the staff member; the detail lists who did what', async () => {
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(11, '09:00'),
    });
    const moved = exact(
      Appointment,
      await call('post', `/appointments/${a.id}/reschedule`, people.staffA, {
        startsAt: at(11, '10:00'),
        staffUserId: people.staffA2.id,
      }),
    );
    expect(moved).toMatchObject({
      startsAt: at(11, '10:00'),
      endsAt: at(11, '10:30'),
      staff: { userId: people.staffA2.id, name: names.staffA2 },
      rescheduleCount: 1,
    });
    // The same time and staff member again changes nothing.
    const same = exact(
      Appointment,
      await call('post', `/appointments/${a.id}/reschedule`, people.ownerA, {
        startsAt: at(11, '10:00'),
      }),
    );
    expect(same.rescheduleCount).toBe(1);
    const cancelled = exact(
      Appointment,
      await call('post', `/appointments/${a.id}/cancel`, people.adminA, {
        reason: 'Client asked to call instead',
      }),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Client asked to call instead',
    });
    expect(cancelled.cancelledAt).not.toBeNull();

    const d = await detail(a.id);
    expect(d.history.map((e) => [e.action, e.by.kind, e.by.name, e.reason])).toEqual([
      ['BOOKED', 'STAFF', names.ownerA, null],
      ['RESCHEDULED', 'STAFF', names.staffA, null],
      ['CANCELLED', 'STAFF', names.adminA, 'Client asked to call instead'],
    ]);
    expect(d.history[0]).toMatchObject({
      from: null,
      to: {
        startsAt: at(11, '09:00'),
        endsAt: at(11, '09:30'),
        staff: { userId: people.staffA.id },
      },
    });
    expect(d.history[1]).toMatchObject({
      from: { startsAt: at(11, '09:00'), staff: { userId: people.staffA.id, name: names.staffA } },
      to: { startsAt: at(11, '10:00'), staff: { userId: people.staffA2.id, name: names.staffA2 } },
    });
    expect(d.history[2]).toMatchObject({ from: { startsAt: at(11, '10:00') }, to: null });
  });

  it('a reschedule onto a taken time is 409 SLOT_TAKEN and changes nothing', async () => {
    const first = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(12, '09:00'),
    });
    const second = await book({
      clientId: ids.c3,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(12, '10:00'),
    });
    expectError(
      await call('post', `/appointments/${second.id}/reschedule`, people.ownerA, {
        startsAt: at(12, '09:15'),
      }),
      409,
      'SLOT_TAKEN',
    );
    expectError(
      await call('post', `/appointments/${second.id}/reschedule`, people.ownerA, {
        startsAt: at(12, '09:00'),
        staffUserId: people.formerA.id,
      }),
      404,
      'NOT_FOUND',
    );
    for (const body of [
      { startsAt: '1999-12-31T09:00:00Z' },
      { startsAt: at(12, '11:00'), typeId: consult.id },
      { staffUserId: people.staffA2.id },
    ]) {
      expectError(
        await call('post', `/appointments/${second.id}/reschedule`, people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    expect((await detail(second.id)).startsAt).toBe(at(12, '10:00'));
    expect((await detail(first.id)).history).toHaveLength(1);
  });

  it('cancelled, completed and no-show are final (409 APPOINTMENT_CLOSED)', async () => {
    const make = (time: string) =>
      book({
        clientId: ids.c3,
        staffUserId: people.adminA.id,
        typeId: consult.id,
        startsAt: at(13, time),
      });
    const done = await make('09:00');
    const missed = await make('10:00');
    const dropped = await make('11:00');
    expect(
      exact(Appointment, await call('post', `/appointments/${done.id}/complete`, people.ownerA, {}))
        .status,
    ).toBe('COMPLETED');
    expect(
      exact(
        Appointment,
        await call('post', `/appointments/${missed.id}/no-show`, people.adminA, {}),
      ).status,
    ).toBe('NO_SHOW');
    // No body at all reads as no reason.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/business/appointments/${dropped.id}/cancel`)
      .set('x-business-id', ids.firmA)
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`)
      .set('x-forwarded-for', viewer());
    expect(exact(Appointment, res).cancelReason).toBeNull();
    for (const a of [done, missed, dropped]) {
      for (const [path, body] of [
        ['reschedule', { startsAt: at(13, '12:00') }],
        ['cancel', {}],
        ['complete', {}],
        ['no-show', {}],
      ] as const) {
        expectError(
          await call('post', `/appointments/${a.id}/${path}`, people.ownerA, body),
          409,
          'APPOINTMENT_CLOSED',
        );
      }
    }
    const history = (await detail(missed.id)).history;
    expect(history.map((e) => e.action)).toEqual(['BOOKED', 'NO_SHOW']);
    expect(history[1]).toMatchObject({ from: { startsAt: at(13, '10:00') }, to: null });
    expectError(
      await call('post', `/appointments/${done.id}/cancel`, people.ownerA, {
        reason: 'x'.repeat(501),
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('free slots', () => {
  const slots = async (query: string, who: Who = people.ownerA) =>
    exact(SlotList, await call('get', `/appointments/slots?${query}`, who));
  const starts = (list: z.output<typeof SlotList>, userId: string) =>
    list.slots.filter((s) => s.staff.userId === userId).map((s) => s.startsAt);

  it("15-minute starts inside one member's hours, outside appointments and blocks", async () => {
    const q = `typeId=${review.id}&from=${day(14)}&to=${day(14)}&staffUserId=${people.staffA.id}`;
    const before = await slots(q);
    expect(before.timezone).toBe(TZ);
    // 60 minutes in 09:00-12:00: 09:00, 09:15, ... 11:00.
    expect(starts(before, people.staffA.id)).toEqual(
      ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00'].map((t) =>
        at(14, t),
      ),
    );
    expect(before.slots[0]).toEqual({
      startsAt: at(14, '09:00'),
      endsAt: at(14, '10:00'),
      staff: { userId: people.staffA.id, name: names.staffA },
    });
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(14, '10:00'),
    });
    exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: null,
        startsAt: at(14, '11:45'),
        endsAt: at(14, '12:00'),
      }),
      201,
    );
    const after = await slots(q);
    // 10:00-10:30 is booked and 11:45-12:00 blocked; back to back with either is fine.
    expect(starts(after, people.staffA.id)).toEqual(
      ['09:00', '10:30', '10:45'].map((t) => at(14, t)),
    );
    // Rescheduling: the moved appointment's own time counts as free.
    const moving = await slots(`${q}&excludeAppointmentId=${a.id}`);
    expect(starts(moving, people.staffA.id)).toEqual(
      ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45'].map((t) =>
        at(14, t),
      ),
    );
  });

  it("Staff get every member's slots; past days have none; unknown types and members are 404", async () => {
    const all = await slots(`typeId=${consult.id}&from=${day(15)}&to=${day(15)}`, people.staffA2);
    expect(starts(all, people.staffA.id)).toHaveLength(11);
    // staffA2 also works 13:00-14:00: three more.
    expect(starts(all, people.staffA2.id)).toHaveLength(14);
    expect(all.slots.map((s) => s.startsAt)).toEqual([...all.slots.map((s) => s.startsAt)].sort());
    const past = await slots(`typeId=${consult.id}&from=${day(-3)}&to=${day(-1)}`);
    expect(past.slots).toEqual([]);
    for (const q of [
      `typeId=${ids.typeB}&from=${day(15)}&to=${day(15)}`,
      `typeId=${randomUUID()}&from=${day(15)}&to=${day(15)}`,
      `typeId=${consult.id}&from=${day(15)}&to=${day(15)}&staffUserId=${people.formerA.id}`,
      `typeId=${consult.id}&from=${day(15)}&to=${day(15)}&excludeAppointmentId=${randomUUID()}`,
    ]) {
      expectError(await call('get', `/appointments/slots?${q}`, people.ownerA), 404, 'NOT_FOUND');
    }
    for (const q of [
      `typeId=${consult.id}&from=${day(1)}&to=${day(40)}`,
      `typeId=${consult.id}&from=${day(2)}&to=${day(1)}`,
      `typeId=${consult.id}&from=${at(1, '09:00')}&to=${day(2)}`,
      `from=${day(1)}&to=${day(2)}`,
      `typeId=${consult.id}&from=9999-12-01&to=9999-12-31`,
      `typeId=${consult.id}&from=0000-01-01&to=0000-01-02`,
    ]) {
      expectError(
        await call('get', `/appointments/slots?${encodeURI(q)}`, people.ownerA),
        400,
        'VALIDATION_FAILED',
      );
    }
  });
});

describe('another firm', () => {
  it("gets 404 on every route for firm A's records and changes nothing", async () => {
    const block = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.staffA.id,
        startsAt: at(16, '11:00'),
        endsAt: at(16, '11:30'),
      }),
      201,
    );
    const B = ids.firmB;
    for (const [method, path, body] of [
      ['patch', `/appointment-types/${consult.id}`, { name: 'Taken over' }],
      ['post', `/appointment-types/${consult.id}/archive`, {}],
      ['post', `/appointment-types/${consult.id}/restore`, {}],
      ['delete', `/blocked-times/${block.id}`, undefined],
      ['put', `/availability/${people.staffA.id}/working-hours`, { hours: [] }],
      [
        'post',
        '/blocked-times',
        { userId: people.staffA.id, startsAt: at(16, '13:00'), endsAt: at(16, '14:00') },
      ],
    ] as const) {
      expectError(await call(method, path, people.ownerB, body, B), 404, 'NOT_FOUND');
    }
    const theirTypes = exact(
      AppointmentTypeList,
      await call('get', '/appointment-types?status=all', people.ownerB, undefined, B),
    );
    expect(theirTypes.items.map((t) => t.id)).not.toContain(consult.id);
    const theirBlocks = exact(
      BlockedTimeList,
      await call('get', `/blocked-times?${range(16, 17)}`, people.ownerB, undefined, B),
    );
    expect(theirBlocks.items).toEqual([]);
    const theirWeek = exact(
      Availability,
      await call('get', '/availability', people.ownerB, undefined, B),
    );
    expect(theirWeek.members.map((m) => m.member.userId)).toEqual([people.ownerB.id]);
    // Nothing changed in firm A.
    expect(
      (await call('get', `/appointment-types?status=active`, people.ownerA)).body,
    ).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: consult.id, name: consult.name }),
      ]),
    });
    const blocks = exact(
      BlockedTimeList,
      await call('get', `/blocked-times?${range(16, 17)}`, people.ownerA),
    );
    expect(blocks.items.map((b) => b.id)).toContain(block.id);
    const week = exact(
      Availability,
      await call('get', '/availability', people.ownerA),
    ).members.find((m) => m.member.userId === people.staffA.id)?.hours;
    expect(week).toHaveLength(7);
  });

  it("gets 404 on every appointment route for firm A's records and changes nothing", async () => {
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(26, '09:00'),
    });
    const B = ids.firmB;
    for (const [method, path, body] of [
      ['get', `/appointments/${a.id}`, undefined],
      ['post', `/appointments/${a.id}/reschedule`, { startsAt: at(26, '10:00') }],
      ['post', `/appointments/${a.id}/cancel`, {}],
      ['post', `/appointments/${a.id}/complete`, {}],
      ['post', `/appointments/${a.id}/no-show`, {}],
      ['get', `/appointments/slots?typeId=${consult.id}&from=${day(26)}&to=${day(26)}`, undefined],
      [
        'post',
        '/appointments',
        {
          clientId: ids.c1,
          staffUserId: people.ownerB.id,
          typeId: ids.typeB,
          startsAt: at(26, '13:00'),
        },
      ],
    ] as const) {
      expectError(await call(method, path, people.ownerB, body, B), 404, 'NOT_FOUND');
    }
    const theirs = exact(
      AppointmentList,
      await call('get', `/appointments?${range(26, 27)}`, people.ownerB, undefined, B),
    );
    expect(theirs.items).toEqual([]);
    // Nothing changed in firm A.
    const after = await detail(a.id);
    expect([after.status, after.startsAt, after.history.length]).toEqual([
      'SCHEDULED',
      at(26, '09:00'),
      1,
    ]);
  });
});

describe('text Postgres cannot hold', () => {
  it('a NUL or half a surrogate pair in any text is 400 and stores nothing; emoji are kept', async () => {
    const t = await createType({ name: `Text ${run}`, durationMinutes: 30 });
    const typeCount = async () =>
      exact(AppointmentTypeList, await call('get', '/appointment-types?status=all', people.ownerA))
        .items.length;
    const typesBefore = await typeCount();
    for (const bad of ['a\u0000b', '\u0000', 'Half \ud800 pair', 'x\udfff', '\ud83d']) {
      for (const [method, path, body] of [
        ['post', '/appointment-types', { name: bad, durationMinutes: 30 }],
        ['patch', `/appointment-types/${t.id}`, { name: bad }],
        [
          'post',
          '/blocked-times',
          {
            userId: people.staffA.id,
            startsAt: at(23, '11:00'),
            endsAt: at(23, '11:30'),
            reason: bad,
          },
        ],
      ] as const) {
        const res = await call(method, path, people.ownerA, body);
        expect([res.status, codeOf(res)], `${path} ${JSON.stringify(bad)}`).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    }
    // Nothing was stored or changed.
    expect(await typeCount()).toBe(typesBefore);
    expect(
      exact(
        AppointmentTypeList,
        await call('get', '/appointment-types?status=all', people.ownerA),
      ).items.find((x) => x.id === t.id)?.name,
    ).toBe(t.name);
    expect(
      exact(BlockedTimeList, await call('get', `/blocked-times?${range(23, 24)}`, people.ownerA))
        .items,
    ).toEqual([]);

    // Whole surrogate pairs are ordinary text.
    const emoji = await createType({ name: `Review 😀 ${run}`, durationMinutes: 30 });
    expect(emoji.name).toBe(`Review 😀 ${run}`);
    const block = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.staffA.id,
        startsAt: at(23, '11:00'),
        endsAt: at(23, '11:30'),
        reason: 'Away 🏖️ (fake)',
      }),
      201,
    );
    expect(block.reason).toBe('Away 🏖️ (fake)');
  });

  it('a NUL or half a surrogate pair in appointment text is 400 and stores nothing; emoji are kept', async () => {
    const appt = await book({
      clientId: ids.c3,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(27, '09:00'),
    });
    for (const bad of ['a\u0000b', '\u0000', 'Half \ud800 pair', 'x\udfff', '\ud83d']) {
      for (const [method, path, body] of [
        [
          'post',
          '/appointments',
          {
            clientId: ids.c3,
            staffUserId: people.staffA2.id,
            typeId: consult.id,
            startsAt: at(27, '10:00'),
            locationDetails: bad,
          },
        ],
        ['post', `/appointments/${appt.id}/cancel`, { reason: bad }],
      ] as const) {
        const res = await call(method, path, people.ownerA, body);
        expect([res.status, codeOf(res)], `${path} ${JSON.stringify(bad)}`).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    }
    // Nothing was stored or changed.
    const day27 = exact(
      AppointmentList,
      await call('get', `/appointments?${range(27, 28)}`, people.ownerA),
    ).items;
    expect(day27.map((i) => [i.id, i.status])).toEqual([[appt.id, 'SCHEDULED']]);
    // Whole surrogate pairs are ordinary text.
    const booked = await book({
      clientId: ids.c3,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(27, '10:00'),
      locationDetails: 'Room 📍 2',
    });
    expect(booked.locationDetails).toBe('Room 📍 2');
    const cancelled = exact(
      Appointment,
      await call('post', `/appointments/${appt.id}/cancel`, people.ownerA, { reason: 'Moved 📅' }),
    );
    expect(cancelled.cancelReason).toBe('Moved 📅');
    expect((await detail(appt.id)).history.at(-1)?.reason).toBe('Moved 📅');
  });
});

describe('the firm must be active', () => {
  it('a suspended firm is 403 BUSINESS_INACTIVE; one still in setup 403 BUSINESS_SETUP_REQUIRED', async () => {
    const reads = [
      '/appointment-types',
      '/availability',
      `/appointments?${range(1, 2)}`,
      `/blocked-times?${range(1, 2)}`,
    ];
    for (const path of reads) {
      expectError(
        await call('get', path, fx.users.ownerSuspended, undefined, fx.suspended.id),
        403,
        'BUSINESS_INACTIVE',
      );
      expectError(
        await call('get', path, people.ownerSetup, undefined, ids.firmSetup),
        403,
        'BUSINESS_SETUP_REQUIRED',
      );
    }
    for (const [who, firm, code] of [
      [fx.users.ownerSuspended, fx.suspended.id, 'BUSINESS_INACTIVE'],
      [people.ownerSetup, ids.firmSetup, 'BUSINESS_SETUP_REQUIRED'],
    ] as const) {
      expectError(
        await call('post', '/appointment-types', who, { name: 'Gated', durationMinutes: 30 }, firm),
        403,
        code,
      );
    }
  });
});

describe('at the same time', () => {
  const plus = (iso: string, minutes: number) =>
    new Date(Date.parse(iso) + minutes * 60_000).toISOString();

  it('parallel archives of one type agree on one change and one audit row', async () => {
    const t = await createType({ name: `Parallel ${run}`, durationMinutes: 30 });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call(
          'post',
          `/appointment-types/${t.id}/archive`,
          i % 2 ? people.adminA : people.ownerA,
          {},
        ),
      ),
    );
    const archivedAt = results.map((r) => exact(AppointmentType, r).archivedAt);
    expect(new Set(archivedAt).size).toBe(1);
    expect(archivedAt[0]).not.toBeNull();
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: t.id } }),
    );
    expect(rows.map((r) => r.action).sort()).toEqual([
      'appointment_type.archived',
      'appointment_type.created',
    ]);
  });

  it('parallel deletes of one block: one 200, the rest 404, no 500', async () => {
    const block = exact(
      BlockedTime,
      await call('post', '/blocked-times', people.ownerA, {
        userId: people.staffA.id,
        startsAt: at(24, '13:00'),
        endsAt: at(24, '14:00'),
      }),
      201,
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call('delete', `/blocked-times/${block.id}`, i % 2 ? people.adminA : people.ownerA),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404, 404, 404]);
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: block.id } }),
    );
    expect(rows.map((r) => r.action).sort()).toEqual([
      'blocked_time.created',
      'blocked_time.deleted',
    ]);
  });

  it('two working-week replacements at once leave one of them, never both', async () => {
    const weeks = [1, 2, 3, 4].map((weekday) => ({
      hours: [{ weekday, startsAt: '08:00', endsAt: '08:30' }],
    }));
    const results = await Promise.all(
      weeks.map((week) =>
        call('put', `/availability/${people.adminA.id}/working-hours`, people.ownerA, week),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const week = exact(
      Availability,
      await call('get', '/availability', people.ownerA),
    ).members.find((m) => m.member.userId === people.adminA.id)?.hours;
    expect(weeks.map((w) => w.hours)).toContainEqual(week);
    await call('put', `/availability/${people.adminA.id}/working-hours`, people.ownerA, {
      hours: [],
    });
  });

  it('waits out a calendar lock held briefly elsewhere; answers 429 RATE_LIMITED when it stays held', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    // The firm-wide key, which a whole-firm block takes (a booking takes it shared).
    const key = calendarLockKey(ids.firmA);
    // Holds the key for `ms` in another connection while `during` runs; the request is handed
    // back wrapped, so the holding transaction never waits for it.
    const hold = (ms: number, during: () => Promise<Response>) =>
      runInScope(owner, { kind: 'platform' }, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const pending = during();
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { pending };
      });
    try {
      const body = (time: string) => ({
        userId: null,
        startsAt: at(22, time),
        endsAt: plus(at(22, time), 30),
      });
      const started = Date.now();
      const short = await hold(400, () =>
        call('post', '/blocked-times', people.ownerA, body('09:00')),
      );
      const waited = await short.pending;
      expect(waited.status, JSON.stringify(waited.body)).toBe(201);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      // Held longer than the API keeps trying (2 s): busy, answered like the rate limit, and
      // nothing is stored.
      const long = await hold(5_000, () =>
        call('post', '/blocked-times', people.ownerA, body('10:00')),
      );
      const refused = await long.pending;
      expectError(refused, 429, 'RATE_LIMITED');
      expect(refused.headers['retry-after']).toBe('2');
      const day22 = exact(
        BlockedTimeList,
        await call('get', `/blocked-times?${range(22, 23)}`, people.ownerA),
      ).items;
      expect(day22.map((b) => b.startsAt)).toEqual([at(22, '09:00')]);
    } finally {
      await owner.$disconnect();
    }
  });

  it('six bookings of one staff member at one time: one 201, the rest 409 SLOT_TAKEN', async () => {
    const clients = [ids.c1, ids.c2, ids.c3];
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        call('post', '/appointments', people.ownerA, {
          clientId: clients[i % 3],
          staffUserId: people.adminA.id,
          typeId: consult.id,
          startsAt: at(19, '09:00'),
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expectError(r, 409, 'SLOT_TAKEN');
    const items = exact(
      AppointmentList,
      await call('get', `/appointments?${range(19, 20)}`, people.ownerA),
    ).items;
    expect(items).toHaveLength(1);
  });

  it('a block and a booking of the same time never both pass', async () => {
    for (const [i, userId] of [
      [0, people.staffA2.id],
      [1, people.staffA2.id],
      [2, null],
      [3, people.staffA2.id],
      [4, null],
    ] as const) {
      const startsAt = at(20, `${String(9 + i).padStart(2, '0')}:00`);
      const [blocked, booked] = await Promise.all([
        call('post', '/blocked-times', people.ownerA, {
          userId,
          startsAt,
          endsAt: plus(startsAt, 30),
        }),
        call('post', '/appointments', people.adminA, {
          clientId: ids.c3,
          staffUserId: people.staffA2.id,
          typeId: consult.id,
          startsAt,
        }),
      ]);
      expect(
        [
          [201, 409],
          [409, 201],
        ],
        JSON.stringify([blocked.body, booked.body]),
      ).toContainEqual([blocked.status, booked.status]);
      if (blocked.status === 409) expectError(blocked, 409, 'BLOCKS_APPOINTMENT');
      if (booked.status === 409) expectError(booked, 409, 'SLOT_TAKEN');
    }
    // No scheduled appointment of the firm overlaps blocked time for its member or the firm.
    const overlapping = await asOwner(
      ids.firmA,
      (tx) =>
        tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM appointments a
        JOIN blocked_times b ON b.business_id = a.business_id
          AND (b.user_id = a.staff_user_id OR b.user_id IS NULL)
          AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
        WHERE a.business_id = ${ids.firmA}::uuid AND a.status = 'SCHEDULED'`,
    );
    expect(overlapping[0]?.n).toBe(0);
  });

  it('a cancel and a completion of one appointment: one wins, the other is 409 APPOINTMENT_CLOSED', async () => {
    for (const time of ['09:00', '10:00', '11:00']) {
      const a = await book({
        clientId: ids.c3,
        staffUserId: people.adminA.id,
        typeId: consult.id,
        startsAt: at(21, time),
      });
      const results = await Promise.all([
        call('post', `/appointments/${a.id}/cancel`, people.ownerA, { reason: 'Clash test' }),
        call('post', `/appointments/${a.id}/complete`, people.adminA, {}),
        call('post', `/appointments/${a.id}/no-show`, people.ownerA, {}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expectError(r, 409, 'APPOINTMENT_CLOSED');
      }
      // One final status, and the history has that one change after the booking.
      const d = await detail(a.id);
      expect(['CANCELLED', 'COMPLETED', 'NO_SHOW']).toContain(d.status);
      expect(d.history.map((e) => e.action)).toEqual(['BOOKED', d.status]);
    }
  });

  it('a booking also waits out a held calendar briefly, then answers 429 RATE_LIMITED', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    // The firm-wide key, which a booking takes shared.
    const key = calendarLockKey(ids.firmA);
    // Holds the key for `ms` in another connection while `during` runs; the request is handed
    // back wrapped, so the holding transaction never waits for it.
    const hold = (ms: number, during: () => Promise<Response>) =>
      runInScope(owner, { kind: 'platform' }, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const pending = during();
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { pending };
      });
    try {
      const body = (time: string) => ({
        clientId: ids.c3,
        staffUserId: people.adminA.id,
        typeId: consult.id,
        startsAt: at(25, time),
      });
      const started = Date.now();
      const short = await hold(400, () =>
        call('post', '/appointments', people.ownerA, body('09:00')),
      );
      const waited = await short.pending;
      expect(waited.status, JSON.stringify(waited.body)).toBe(201);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      // Held longer than the API keeps trying (2 s): busy, answered like the rate limit, and
      // nothing is booked.
      const long = await hold(5_000, () =>
        call('post', '/appointments', people.ownerA, body('10:00')),
      );
      const refused = await long.pending;
      expectError(refused, 429, 'RATE_LIMITED');
      expect(refused.headers['retry-after']).toBe('2');
      const day25 = exact(
        AppointmentList,
        await call('get', `/appointments?${range(25, 26)}`, people.ownerA),
      ).items;
      expect(day25.map((i) => i.startsAt)).toEqual([at(25, '09:00')]);
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('audit', () => {
  it('logs every change with ids and times, never names, emails or reasons', async () => {
    const all = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA } }),
    );
    const text = JSON.stringify(all.map((r) => r.metadata));
    for (const secret of ['Dentist', 'Away', 'Jamie', 'Fake R12a', '@r12.test']) {
      expect(text).not.toContain(secret);
    }
    const actions = new Set(all.map((r) => r.action));
    for (const action of [
      'appointment_type.created',
      'appointment_type.updated',
      'appointment_type.archived',
      'appointment_type.restored',
      'working_hours.set',
      'blocked_time.created',
      'blocked_time.deleted',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
  });
});

describe('appointment audit and notices', () => {
  it('logs reads and changes with ids and times, never names, emails, locations or reasons', async () => {
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: consult.id,
      startsAt: at(17, '09:00'),
      locationDetails: 'Private address 42',
    });
    await call('post', `/appointments/${a.id}/reschedule`, people.ownerA, {
      startsAt: at(17, '10:00'),
    });
    await call('post', `/appointments/${a.id}/cancel`, people.ownerA, {
      reason: 'Sensitive reason',
    });
    await detail(a.id);
    await call('get', `/appointments?${range(17, 18)}`, people.staffA);
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: ids.firmA,
          OR: [{ entityId: a.id }, { action: 'appointments.listed' }],
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const mine = rows.filter((r) => r.entityId === a.id);
    expect(mine.map((r) => r.action)).toEqual([
      'appointment.booked',
      'appointment.rescheduled',
      'appointment.cancelled',
      'appointment.viewed',
    ]);
    expect(mine[1]?.metadata).toEqual({
      by: 'STAFF',
      clientId: ids.c1,
      from: { startsAt: at(17, '09:00'), endsAt: at(17, '09:30'), staffUserId: people.staffA.id },
      to: { startsAt: at(17, '10:00'), endsAt: at(17, '10:30'), staffUserId: people.staffA.id },
    });
    expect(mine[2]?.metadata).toMatchObject({ to: null, reasonGiven: true });
    expect(mine.every((r) => r.actorUserId === people.ownerA.id)).toBe(true);
    expect(
      rows.some((r) => r.action === 'appointments.listed' && r.actorUserId === people.staffA.id),
    ).toBe(true);
    const all = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA } }),
    );
    const text = JSON.stringify(all.map((r) => r.metadata));
    for (const secret of [
      'Sensitive reason',
      'Private address',
      'Jamie',
      'Fake R12a',
      'Dentist',
      '@r12.test',
    ]) {
      expect(text).not.toContain(secret);
    }
    const actions = new Set(all.map((r) => r.action));
    for (const action of [
      'appointment_type.created',
      'appointment_type.updated',
      'appointment_type.archived',
      'appointment_type.restored',
      'working_hours.set',
      'blocked_time.created',
      'blocked_time.deleted',
      'appointment.completed',
      'appointment.no_show',
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
  });

  it("tells the client's primary login about a booking and a new time; nothing for a cancel", async () => {
    outbox.length = 0;
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: review.id,
      startsAt: at(18, '09:00'),
    });
    await call('post', `/appointments/${a.id}/reschedule`, people.ownerA, {
      startsAt: at(18, '10:00'),
    });
    await call('post', `/appointments/${a.id}/cancel`, people.ownerA, {});
    // c3 has no login and no email: nothing to send.
    await book({
      clientId: ids.c3,
      staffUserId: people.staffA2.id,
      typeId: consult.id,
      startsAt: at(18, '11:00'),
    });
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['appointment.booked', people.clientA.email],
      ['appointment.changed', people.clientA.email],
    ]);
    expect(outbox[1]).toMatchObject({
      businessId: ids.firmA,
      recipient: { clientAccountId: expect.any(String) },
      data: {
        name: names.clientA,
        title: review.name,
        startsAt: new Date(at(18, '10:00')),
        timeZone: TZ,
        link: expect.stringMatching(/\/r12a-firma-[0-9a-f]+\/appointments$/),
      },
    });
  });
});
