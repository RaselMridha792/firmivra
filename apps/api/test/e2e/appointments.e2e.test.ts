// End-to-end: R12 step 2, part A of the firm's side of appointments (contract in
// packages/types/src/appointments): appointment types, working hours and blocked time. The
// calendar with the Staff rule, free slots and booking come in part B, the client's own in part
// C; until then the tests write an appointment straight to the database where they need one.
// Another firm gets 404 and changes nothing; changes are audited without names, emails or
// reasons.
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
  AppointmentType,
  AppointmentTypeList,
  Availability,
  BlockedTime,
  BlockedTimeList,
  MemberAvailability,
  OkResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { calendarLockKey } from '../../src/appointments/calendar-locks.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

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
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
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
});

describe('the firm must be active', () => {
  it('a suspended firm is 403 BUSINESS_INACTIVE; one still in setup 403 BUSINESS_SETUP_REQUIRED', async () => {
    const reads = ['/appointment-types', '/availability', `/blocked-times?${range(1, 2)}`];
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
      expectError(await long.pending, 429, 'RATE_LIMITED');
      const day22 = exact(
        BlockedTimeList,
        await call('get', `/blocked-times?${range(22, 23)}`, people.ownerA),
      ).items;
      expect(day22.map((b) => b.startsAt)).toEqual([at(22, '09:00')]);
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
