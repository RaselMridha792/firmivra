// End-to-end: R12 step 2, the client's own appointments in the portal (contract in
// packages/types/src/appointments): bookable types, free starts without staff, booking (the
// client's assigned staff member when free, else the free member with the fewest appointments
// that day), reschedule and cancel until the 24-hour cutoff (409 CHANGE_WINDOW_CLOSED after it;
// the firm can still change it), and the history the firm reads. The client comes from the
// session, never the URL: another client or another firm's client gets 404 and changes nothing.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  Appointment,
  AppointmentDetail,
  AppointmentType,
  BookableTypeList,
  MyAppointment,
  MyAppointmentList,
  MySlotList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
/** No daylight saving, so firm-local times are exact on any day. */
const TZ = 'Asia/Kolkata';
const HOUR = 60 * 60_000;
const person = (key: string) => ({ id: randomUUID(), email: `r12p-${key}-${run}@r12.test` });
const people = {
  ownerP: person('owner-p'),
  staffP1: person('staff-p1'),
  staffP2: person('staff-p2'),
  /** Client cA's login; cA is assigned to staffP1. */
  clientA: person('client-a'),
  /** Client cB's login; cB is assigned to no one. */
  clientB: person('client-b'),
  /** A login not linked to a client record yet. */
  clientC: person('client-c'),
  /** The login of an archived client record. */
  clientZ: person('client-z'),
  ownerQ: person('owner-q'),
  clientQ: person('client-q'),
  /** A client login of a suspended firm. */
  clientS: person('client-s'),
};
type Key = keyof typeof people;
const names = Object.fromEntries(Object.keys(people).map((k) => [k, `Fake R12p ${k}`])) as Record<
  Key,
  string
>;
const CLIENT_LOGINS: readonly Key[] = [
  'clientA',
  'clientB',
  'clientC',
  'clientZ',
  'clientQ',
  'clientS',
];
const ids = {
  firmP: '',
  firmQ: '',
  firmS: '',
  slugP: `r12p-p-${run}`,
  slugQ: `r12p-q-${run}`,
  slugS: `r12p-s-${run}`,
  cA: '',
  cB: '',
  /** Clients without a login, for the firm's own bookings. */
  cX: '',
  cY: '',
  cQ: '',
  typeQ: '',
  accountA: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `203.0.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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
type Method = 'get' | 'post';

/** A portal route of the signed-in client: /api/v1/portal/{slug}/me/appointments... */
async function portal(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  slug = ids.slugP,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/appointments${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

/** A firm route: /api/v1/business/... */
async function firm(
  method: Method | 'put',
  path: string,
  body?: object,
  who: Who = people.ownerP,
  businessId = ids.firmP,
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
const day = (n: number) => addDays(today, n);
/** An instant on firm-local day `n` at a firm-local time ("10:30"). */
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, day(n), minutesOf(time))).toISOString();
const minus24h = (iso: string) => new Date(Date.parse(iso) - 24 * HOUR).toISOString();

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

/** The firm books (any time that is free; working hours are a guide for the firm). */
const firmBook = async (body: {
  clientId: string;
  staffUserId: string;
  startsAt: string;
  typeId?: string;
  durationMinutes?: number;
}) =>
  exact(
    Appointment,
    await firm('post', '/appointments', body.typeId ? body : { durationMinutes: 30, ...body }),
    201,
  );
const book = async (who: Who, typeId: string, startsAt: string) =>
  exact(MyAppointment, await portal('post', '', who, { typeId, startsAt }), 201);
const firmDetail = async (id: string) =>
  exact(AppointmentDetail, await firm('get', `/appointments/${id}`));

let consult: AppointmentType;
let long: AppointmentType;
let internal: AppointmentType;
let retired: AppointmentType;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: CLIENT_LOGINS.includes(key as Key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: names[key as Key],
        },
      });
    }
    ids.firmP = (
      await tx.business.create({ data: { slug: ids.slugP, name: ids.slugP, status: 'ACTIVE' } })
    ).id;
    ids.firmQ = (
      await tx.business.create({ data: { slug: ids.slugQ, name: ids.slugQ, status: 'ACTIVE' } })
    ).id;
    ids.firmS = (
      await tx.business.create({
        data: { slug: ids.slugS, name: ids.slugS, status: 'SUSPENDED' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmS }, async (tx) => {
    const S = { businessId: ids.firmS };
    const record = await tx.client.create({ data: { ...S, displayName: 'S Client (fake)' } });
    await tx.clientAccount.create({
      data: {
        ...S,
        userId: people.clientS.id,
        clientId: record.id,
        email: people.clientS.email,
        status: 'ACTIVE',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmP }, async (tx) => {
    const P = { businessId: ids.firmP };
    await tx.businessSettings.create({ data: { ...P, timezone: TZ } });
    for (const [userId, role] of [
      [people.ownerP.id, 'OWNER'],
      [people.staffP1.id, 'STAFF'],
      [people.staffP2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...P, userId, role, status: 'ACTIVE' } });
    }
    const client = (displayName: string, assignedUserId: string | null) =>
      tx.client.create({ data: { ...P, displayName, assignedUserId } });
    ids.cA = (await client('Jamie Sample (fake)', people.staffP1.id)).id;
    ids.cB = (await client('Riley Example (fake)', null)).id;
    ids.cX = (await client('Casey Walkin (fake)', null)).id;
    ids.cY = (await client('Drew Walkin (fake)', null)).id;
    const login = (who: Who & { id: string }, clientId: string | null) =>
      tx.clientAccount.create({
        data: { ...P, userId: who.id, clientId, email: who.email, status: 'ACTIVE' },
      });
    ids.accountA = (await login(people.clientA, ids.cA)).id;
    await login(people.clientB, ids.cB);
    await login(people.clientC, null);
    const archived = await tx.client.create({
      data: { ...P, displayName: 'Former Client (fake)', archivedAt: new Date() },
    });
    await login(people.clientZ, archived.id);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmQ }, async (tx) => {
    const Q = { businessId: ids.firmQ };
    await tx.membership.create({
      data: { ...Q, userId: people.ownerQ.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.cQ = (await tx.client.create({ data: { ...Q, displayName: 'Q Client (fake)' } })).id;
    await tx.clientAccount.create({
      data: {
        ...Q,
        userId: people.clientQ.id,
        clientId: ids.cQ,
        email: people.clientQ.email,
        status: 'ACTIVE',
      },
    });
    ids.typeQ = (
      await tx.appointmentType.create({
        data: { ...Q, name: 'Q consult', durationMinutes: 30, clientBookable: true },
      })
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

  const type = async (body: object) =>
    exact(AppointmentType, await firm('post', '/appointment-types', body), 201);
  consult = await type({ name: `Consult ${run}`, durationMinutes: 30, clientBookable: true });
  long = await type({
    name: `Long review ${run}`,
    durationMinutes: 60,
    locationKind: 'PHONE',
    clientBookable: true,
  });
  internal = await type({ name: `Internal ${run}`, durationMinutes: 30 });
  retired = await type({ name: `Retired ${run}`, durationMinutes: 30, clientBookable: true });
  exact(AppointmentType, await firm('post', `/appointment-types/${retired.id}/archive`, {}));
  // staffP1 and staffP2 work 09:00-12:00 every day (firm time); the owner has no hours.
  const hours = {
    hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startsAt: '09:00',
      endsAt: '12:00',
    })),
  };
  for (const who of [people.staffP1, people.staffP2]) {
    const res = await firm('put', `/availability/${who.id}/working-hours`, hours);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
});

afterAll(async () => {
  await app.close();
});

describe('who may call', () => {
  it('only the firm’s own client logins: staff are signed out here, another firm’s client is 404', async () => {
    expect((await portal('get', '', people.ownerP)).status).toBe(401);
    expect((await portal('get', '', people.staffP1)).status).toBe(401);
    expectError(await portal('get', '', people.clientQ), 404, 'NOT_FOUND');
    expectError(await portal('get', '/types', people.clientQ), 404, 'NOT_FOUND');
    // A client is not a firm member.
    expect((await firm('get', '/appointments/slots', undefined, people.clientA)).status).toBe(403);
  });

  it('a suspended firm’s portal is 403 BUSINESS_INACTIVE for its own clients', async () => {
    for (const [method, path, body] of [
      ['get', '', undefined],
      ['get', '/types', undefined],
      ['get', `/slots?typeId=${randomUUID()}&from=${day(2)}&to=${day(2)}`, undefined],
      ['post', '', { typeId: randomUUID(), startsAt: at(2, '09:00') }],
    ] as const) {
      expectError(
        await portal(method, path, people.clientS, body, ids.slugS),
        403,
        'BUSINESS_INACTIVE',
      );
    }
  });
});

describe('bookable types', () => {
  it('lists only client-bookable, active types, each with the 24-hour change window', async () => {
    const items = exact(BookableTypeList, await portal('get', '/types', people.clientA)).items;
    expect(items).toEqual([
      {
        id: consult.id,
        name: consult.name,
        durationMinutes: 30,
        locationKind: 'VIDEO',
        cancelCutoffHours: 24,
      },
      {
        id: long.id,
        name: long.name,
        durationMinutes: 60,
        locationKind: 'PHONE',
        cancelCutoffHours: 24,
      },
    ]);
    const theirs = exact(
      BookableTypeList,
      await portal('get', '/types', people.clientQ, undefined, ids.slugQ),
    ).items;
    expect(theirs.map((t) => t.id)).toEqual([ids.typeQ]);
  });
});

describe('free starts', () => {
  const slots = async (who: Who, query: string) =>
    exact(MySlotList, await portal('get', `/slots?${query}`, who));
  const times = (list: z.output<typeof MySlotList>) =>
    list.slots.map((s) => s.startsAt.slice(0, 16));
  const local = (n: number, list: string[]) => list.map((t) => at(n, t).slice(0, 16));

  it('are the union of every member’s free starts, without staff, minus the client’s own appointments', async () => {
    const query = `typeId=${consult.id}&from=${day(2)}&to=${day(2)}`;
    const before = await slots(people.clientA, query);
    expect(before.timezone).toBe(TZ);
    expect(times(before)).toEqual(
      local(2, [
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
      ]),
    );
    expect(before.slots[0]).toEqual({ startsAt: at(2, '09:00'), endsAt: at(2, '09:30') });
    // Both members busy at 09:00; the client herself at 10:00 (with the owner, who has no hours).
    await firmBook({ clientId: ids.cX, staffUserId: people.staffP1.id, startsAt: at(2, '09:00') });
    await firmBook({ clientId: ids.cY, staffUserId: people.staffP2.id, startsAt: at(2, '09:00') });
    const own = await firmBook({
      clientId: ids.cA,
      staffUserId: people.ownerP.id,
      typeId: consult.id,
      startsAt: at(2, '10:00'),
    });
    const forB = local(2, [
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
    expect(times(await slots(people.clientA, query))).toEqual(
      local(2, ['09:30', '10:30', '10:45', '11:00', '11:15', '11:30']),
    );
    expect(times(await slots(people.clientB, query))).toEqual(forB);
    // Rescheduling: the client's own appointment's time counts as free.
    expect(times(await slots(people.clientA, `${query}&excludeAppointmentId=${own.id}`))).toEqual(
      forB,
    );
    // An hour-long type fits fewer starts.
    expect(
      times(await slots(people.clientB, `typeId=${long.id}&from=${day(2)}&to=${day(2)}`)),
    ).toEqual(local(2, ['09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']));
    // A past day has none.
    expect(
      (await slots(people.clientB, `typeId=${consult.id}&from=${day(-3)}&to=${day(-1)}`)).slots,
    ).toEqual([]);
    // Someone else's appointment cannot be excluded.
    expectError(
      await portal('get', `/slots?${query}&excludeAppointmentId=${own.id}`, people.clientB),
      404,
      'NOT_FOUND',
    );
  });

  it('are 404 for types the client cannot book and 400 for bad queries', async () => {
    for (const typeId of [internal.id, retired.id, ids.typeQ, randomUUID()]) {
      expectError(
        await portal('get', `/slots?typeId=${typeId}&from=${day(2)}&to=${day(2)}`, people.clientA),
        404,
        'NOT_FOUND',
      );
    }
    for (const query of [
      `typeId=${consult.id}&from=${day(3)}&to=${day(2)}`,
      `typeId=${consult.id}&from=${day(1)}&to=${day(40)}`,
      `typeId=${consult.id}&from=${encodeURIComponent(at(1, '09:00'))}&to=${day(2)}`,
      `typeId=${consult.id}&from=${day(1)}&to=${day(2)}&staffUserId=${people.staffP1.id}`,
      `from=${day(1)}&to=${day(2)}`,
      `typeId=not-a-uuid&from=${day(1)}&to=${day(2)}`,
      // Outside the calendar's years (2000 to 2100).
      `typeId=${consult.id}&from=9999-12-01&to=9999-12-31`,
      `typeId=${consult.id}&from=0000-01-01&to=0000-01-02`,
    ]) {
      expectError(await portal('get', `/slots?${query}`, people.clientA), 400, 'VALIDATION_FAILED');
    }
  });

  it('open a type the client cannot book only while moving their own scheduled appointment of it', async () => {
    const own = await firmBook({
      clientId: ids.cA,
      staffUserId: people.staffP2.id,
      typeId: internal.id,
      startsAt: at(14, '09:00'),
    });
    const query = `typeId=${internal.id}&from=${day(15)}&to=${day(15)}`;
    expectError(await portal('get', `/slots?${query}`, people.clientA), 404, 'NOT_FOUND');
    const moving = await slots(people.clientA, `${query}&excludeAppointmentId=${own.id}`);
    expect(moving.slots.length).toBeGreaterThan(0);
    // Once it is cancelled (or finished, or past the cutoff) it opens nothing.
    exact(Appointment, await firm('post', `/appointments/${own.id}/cancel`, {}));
    expectError(
      await portal('get', `/slots?${query}&excludeAppointmentId=${own.id}`, people.clientA),
      404,
      'NOT_FOUND',
    );
  });
});

describe('booking', () => {
  it('takes the client’s assigned member when free; the firm sees it booked by the client', async () => {
    outbox.length = 0;
    const mine = await book(people.clientA, consult.id, at(3, '09:00'));
    expect(mine).toEqual({
      id: mine.id,
      type: { id: consult.id, name: consult.name },
      staffName: names.staffP1,
      startsAt: at(3, '09:00'),
      endsAt: at(3, '09:30'),
      status: 'SCHEDULED',
      locationKind: 'VIDEO',
      locationDetails: null,
      changeableUntil: minus24h(at(3, '09:00')),
    });
    const seen = await firmDetail(mine.id);
    expect(seen).toMatchObject({
      client: { id: ids.cA },
      staff: { userId: people.staffP1.id },
      bookedByClient: true,
      engagementId: null,
    });
    expect(seen.history.map((e) => [e.action, e.by.kind, e.by.name, e.from, e.reason])).toEqual([
      ['BOOKED', 'CLIENT', names.clientA, null, null],
    ]);
    expect(seen.history[0]?.to).toEqual({
      startsAt: at(3, '09:00'),
      endsAt: at(3, '09:30'),
      staff: { userId: people.staffP1.id, name: names.staffP1 },
    });
    // The confirmation goes to the login that booked, with their preferences.
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      template: 'appointment.booked',
      to: people.clientA.email,
      businessId: ids.firmP,
      recipient: { clientAccountId: ids.accountA },
      data: {
        name: names.clientA,
        firmName: ids.slugP,
        title: consult.name,
        startsAt: new Date(at(3, '09:00')),
        timeZone: TZ,
        link: expect.stringMatching(new RegExp(`/${ids.slugP}/appointments$`)),
      },
    });
  });

  it('otherwise the free member with the fewest appointments that day (then by name)', async () => {
    await firmBook({ clientId: ids.cX, staffUserId: people.staffP1.id, startsAt: at(4, '11:00') });
    // staffP1 has one that day, staffP2 none: staffP2.
    expect((await book(people.clientB, consult.id, at(4, '09:00'))).staffName).toBe(names.staffP2);
    // One each: the first by name.
    expect((await book(people.clientB, consult.id, at(4, '10:00'))).staffName).toBe(names.staffP1);
    // The assigned member is busy: someone else who is free.
    await firmBook({ clientId: ids.cX, staffUserId: people.staffP1.id, startsAt: at(5, '09:00') });
    expect((await book(people.clientA, consult.id, at(5, '09:00'))).staffName).toBe(names.staffP2);
  });

  it('refuses a time that is not a free start (409 SLOT_UNAVAILABLE)', async () => {
    await firmBook({ clientId: ids.cX, staffUserId: people.staffP1.id, startsAt: at(6, '10:00') });
    await firmBook({ clientId: ids.cY, staffUserId: people.staffP2.id, startsAt: at(6, '10:00') });
    for (const startsAt of [
      at(6, '09:05'), // off the 15-minute grid
      at(6, '15:00'), // outside everyone's hours
      at(6, '11:45'), // would end after 12:00
      at(-1, '09:00'), // past
      at(6, '10:00'), // nobody free
      at(6, '10:15'),
    ]) {
      expectError(
        await portal('post', '', people.clientA, { typeId: consult.id, startsAt }),
        409,
        'SLOT_UNAVAILABLE',
      );
    }
  });

  it('refuses a time when the client already has an appointment (409 SLOT_TAKEN)', async () => {
    await firmBook({
      clientId: ids.cA,
      staffUserId: people.ownerP.id,
      startsAt: at(6, '11:00'),
    });
    for (const startsAt of [at(6, '11:00'), at(6, '10:45')]) {
      expectError(
        await portal('post', '', people.clientA, { typeId: consult.id, startsAt }),
        409,
        'SLOT_TAKEN',
      );
    }
    // Back to back is fine.
    expect((await book(people.clientA, consult.id, at(6, '11:30'))).startsAt).toBe(at(6, '11:30'));
  });

  it('two clients booking the same start at once both get it, with different members', async () => {
    const [a, b] = await Promise.all([
      portal('post', '', people.clientA, { typeId: consult.id, startsAt: at(7, '10:00') }),
      portal('post', '', people.clientB, { typeId: consult.id, startsAt: at(7, '10:00') }),
    ]);
    const both = [exact(MyAppointment, a, 201), exact(MyAppointment, b, 201)];
    expect(both.map((x) => x.staffName).sort()).toEqual([names.staffP1, names.staffP2]);
    // A third time overlapping both: nobody is free any more.
    expectError(
      await portal('post', '', people.clientA, { typeId: consult.id, startsAt: at(7, '10:15') }),
      409,
      'SLOT_UNAVAILABLE',
    );
  });

  it('is 404 for types the client cannot book or a login without a client record; 400 for bad input', async () => {
    for (const typeId of [internal.id, retired.id, ids.typeQ, randomUUID()]) {
      expectError(
        await portal('post', '', people.clientA, { typeId, startsAt: at(8, '11:00') }),
        404,
        'NOT_FOUND',
      );
    }
    expectError(
      await portal('post', '', people.clientC, { typeId: consult.id, startsAt: at(8, '11:00') }),
      404,
      'NOT_FOUND',
    );
    // An archived client books through the firm.
    expectError(
      await portal('post', '', people.clientZ, { typeId: consult.id, startsAt: at(8, '11:00') }),
      409,
      'CLIENT_ARCHIVED',
    );
    for (const body of [
      { typeId: consult.id },
      { startsAt: at(8, '11:00') },
      { typeId: consult.id, startsAt: '2026-10-20T10:00:00' },
      { typeId: consult.id, startsAt: at(8, '11:00'), staffUserId: people.staffP2.id },
      { typeId: consult.id, startsAt: at(8, '11:00'), clientId: ids.cB },
      { typeId: consult.id, startsAt: '9999-12-31T23:00:00Z' },
      { typeId: consult.id, startsAt: '0000-01-01T00:00:00+14:00' },
    ]) {
      expectError(await portal('post', '', people.clientA, body), 400, 'VALIDATION_FAILED');
    }
  });
});

describe('the client’s list', () => {
  it('upcoming soonest first, past newest first; only their own', async () => {
    const soon = await book(people.clientB, consult.id, at(8, '09:00'));
    const later = await book(people.clientB, consult.id, at(9, '09:00'));
    const dropped = await book(people.clientB, consult.id, at(9, '10:00'));
    exact(MyAppointment, await portal('post', `/${dropped.id}/cancel`, people.clientB, {}));
    const before = await firmBook({
      clientId: ids.cB,
      staffUserId: people.ownerP.id,
      startsAt: at(-2, '10:00'),
    });

    const upcoming = exact(MyAppointmentList, await portal('get', '', people.clientB)).items;
    const upcomingIds = upcoming.map((i) => i.id);
    expect(upcomingIds).toEqual(expect.arrayContaining([soon.id, later.id]));
    expect(upcomingIds.indexOf(soon.id)).toBeLessThan(upcomingIds.indexOf(later.id));
    expect(upcoming.map((i) => i.startsAt)).toEqual(upcoming.map((i) => i.startsAt).sort());
    expect(upcoming.every((i) => i.status === 'SCHEDULED')).toBe(true);
    expect(upcomingIds).not.toContain(dropped.id);
    expect(upcoming.find((i) => i.id === soon.id)?.changeableUntil).toBe(minus24h(at(8, '09:00')));

    const past = exact(MyAppointmentList, await portal('get', '?when=past', people.clientB)).items;
    expect(past.map((i) => i.id)).toEqual([dropped.id, before.id]);
    expect(past.map((i) => [i.status, i.changeableUntil])).toEqual([
      ['CANCELLED', null],
      ['SCHEDULED', null],
    ]);

    // Another client sees none of these; a login without a client record sees nothing.
    const theirs = exact(MyAppointmentList, await portal('get', '?when=upcoming', people.clientA));
    expect(theirs.items.map((i) => i.id)).not.toContain(soon.id);
    expect(exact(MyAppointmentList, await portal('get', '', people.clientC)).items).toEqual([]);
    expectError(await portal('get', '?when=soon', people.clientB), 400, 'VALIDATION_FAILED');
  });
});

describe('reschedule and cancel', () => {
  it('moves the time (same member when free, else another), with history and a notice', async () => {
    const mine = await book(people.clientA, consult.id, at(10, '09:00'));
    outbox.length = 0;
    const moved = exact(
      MyAppointment,
      await portal('post', `/${mine.id}/reschedule`, people.clientA, {
        startsAt: at(10, '10:00'),
      }),
    );
    expect(moved).toMatchObject({
      id: mine.id,
      staffName: names.staffP1,
      startsAt: at(10, '10:00'),
      endsAt: at(10, '10:30'),
      changeableUntil: minus24h(at(10, '10:00')),
    });
    expect(outbox.map((m) => [m.template, m.to])).toEqual([
      ['appointment.changed', people.clientA.email],
    ]);
    // The same time again changes nothing.
    exact(
      MyAppointment,
      await portal('post', `/${mine.id}/reschedule`, people.clientA, {
        startsAt: at(10, '10:00'),
      }),
    );
    // Its member is busy at the new time: another free member takes it.
    await firmBook({ clientId: ids.cX, staffUserId: people.staffP1.id, startsAt: at(10, '11:00') });
    const again = exact(
      MyAppointment,
      await portal('post', `/${mine.id}/reschedule`, people.clientA, {
        startsAt: at(10, '11:00'),
      }),
    );
    expect(again.staffName).toBe(names.staffP2);
    // Not a free start: refused, and nothing changes.
    expectError(
      await portal('post', `/${mine.id}/reschedule`, people.clientA, {
        startsAt: at(10, '13:00'),
      }),
      409,
      'SLOT_UNAVAILABLE',
    );
    const seen = await firmDetail(mine.id);
    expect([seen.startsAt, seen.rescheduleCount, seen.staff.userId]).toEqual([
      at(10, '11:00'),
      2,
      people.staffP2.id,
    ]);
    expect(seen.history.map((e) => [e.action, e.by.kind, e.by.name])).toEqual([
      ['BOOKED', 'CLIENT', names.clientA],
      ['RESCHEDULED', 'CLIENT', names.clientA],
      ['RESCHEDULED', 'CLIENT', names.clientA],
    ]);
    expect(seen.history[2]).toMatchObject({
      from: { startsAt: at(10, '10:00'), staff: { userId: people.staffP1.id } },
      to: { startsAt: at(10, '11:00'), staff: { userId: people.staffP2.id } },
    });
  });

  it('cancels with a reason the firm reads; final after that (409 APPOINTMENT_CLOSED)', async () => {
    const mine = await book(people.clientA, long.id, at(11, '09:00'));
    outbox.length = 0;
    const res = await portal('post', `/${mine.id}/cancel`, people.clientA, {
      reason: 'Need to travel that week',
    });
    const cancelled = exact(MyAppointment, res);
    expect([cancelled.status, cancelled.changeableUntil]).toEqual(['CANCELLED', null]);
    expect(JSON.stringify(res.body)).not.toContain('travel');
    expect(outbox).toEqual([]);
    const seen = await firmDetail(mine.id);
    expect([seen.status, seen.cancelReason]).toEqual(['CANCELLED', 'Need to travel that week']);
    expect(seen.history.map((e) => [e.action, e.by.kind, e.reason])).toEqual([
      ['BOOKED', 'CLIENT', null],
      ['CANCELLED', 'CLIENT', 'Need to travel that week'],
    ]);
    for (const [path, body] of [
      ['cancel', {}],
      ['reschedule', { startsAt: at(11, '10:00') }],
    ] as const) {
      expectError(
        await portal('post', `/${mine.id}/${path}`, people.clientA, body),
        409,
        'APPOINTMENT_CLOSED',
      );
    }
  });

  it('after the 24-hour cutoff the client gets 409 CHANGE_WINDOW_CLOSED; the firm can still change it', async () => {
    // Three hours from now, on the minute: the firm may book any free time.
    const startsAt = new Date(Math.ceil((Date.now() + 3 * HOUR) / 60_000) * 60_000).toISOString();
    const soon = await firmBook({
      clientId: ids.cA,
      staffUserId: people.ownerP.id,
      typeId: consult.id,
      startsAt,
    });
    const listed = exact(MyAppointmentList, await portal('get', '', people.clientA)).items;
    expect(listed.find((i) => i.id === soon.id)?.changeableUntil).toBeNull();
    for (const [path, body] of [
      ['reschedule', { startsAt: at(12, '09:00') }],
      ['cancel', {}],
    ] as const) {
      expectError(
        await portal('post', `/${soon.id}/${path}`, people.clientA, body),
        409,
        'CHANGE_WINDOW_CLOSED',
      );
    }
    expect((await firmDetail(soon.id)).status).toBe('SCHEDULED');
    const byFirm = exact(Appointment, await firm('post', `/appointments/${soon.id}/cancel`, {}));
    expect(byFirm.status).toBe('CANCELLED');
  });

  it('another client, or another firm’s client, gets 404 and changes nothing; bad input is 400', async () => {
    const mine = await book(people.clientA, consult.id, at(12, '10:00'));
    for (const [who, slug] of [
      [people.clientB, ids.slugP],
      [people.clientC, ids.slugP],
      [people.clientQ, ids.slugQ],
    ] as const) {
      for (const [path, body] of [
        ['reschedule', { startsAt: at(12, '11:00') }],
        ['cancel', {}],
      ] as const) {
        expectError(await portal('post', `/${mine.id}/${path}`, who, body, slug), 404, 'NOT_FOUND');
      }
      const listed = exact(MyAppointmentList, await portal('get', '', who, undefined, slug));
      expect(listed.items.map((i) => i.id)).not.toContain(mine.id);
    }
    const seen = await firmDetail(mine.id);
    expect([seen.status, seen.startsAt, seen.history.length]).toEqual([
      'SCHEDULED',
      at(12, '10:00'),
      1,
    ]);
    for (const [path, body] of [
      [`/${mine.id}/reschedule`, {}],
      [`/${mine.id}/reschedule`, { startsAt: at(12, '11:00'), staffUserId: people.staffP2.id }],
      [`/${mine.id}/reschedule`, { startsAt: '2101-01-01T09:00:00Z' }],
      [`/${mine.id}/cancel`, { reason: 'x'.repeat(501) }],
      [`/${mine.id}/cancel`, { reason: 'ok', extra: true }],
      // Text Postgres cannot hold: a NUL, or half of a surrogate pair.
      [`/${mine.id}/cancel`, { reason: 'Busy\u0000day' }],
      [`/${mine.id}/cancel`, { reason: 'Half \ud800 pair' }],
      [`/${mine.id}/cancel`, { reason: '\udc00' }],
      ['/not-a-uuid/cancel', {}],
    ] as const) {
      expectError(await portal('post', path, people.clientA, body), 400, 'VALIDATION_FAILED');
    }
    const after = await firmDetail(mine.id);
    expect([after.status, after.cancelReason, after.history.length]).toEqual([
      'SCHEDULED',
      null,
      1,
    ]);
    // A whole pair (an emoji) is ordinary text.
    exact(
      MyAppointment,
      await portal('post', `/${mine.id}/cancel`, people.clientA, { reason: 'Sick 🤒 (fake)' }),
    );
    expect((await firmDetail(mine.id)).cancelReason).toBe('Sick 🤒 (fake)');
  });
});

describe('audit', () => {
  it('records the client’s reads and changes with ids and times only', async () => {
    const mine = await book(people.clientB, consult.id, at(13, '09:00'));
    exact(
      MyAppointment,
      await portal('post', `/${mine.id}/cancel`, people.clientB, { reason: 'Private matter' }),
    );
    exact(MyAppointmentList, await portal('get', '?when=past', people.clientB));
    const rows = await asOwner(ids.firmP, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmP }, orderBy: { createdAt: 'asc' } }),
    );
    const forIt = rows.filter((r) => r.entityId === mine.id);
    expect(forIt.map((r) => [r.action, r.actorUserId])).toEqual([
      ['appointment.booked', people.clientB.id],
      ['appointment.cancelled', people.clientB.id],
    ]);
    expect(forIt[1]?.metadata).toEqual({
      by: 'CLIENT',
      clientId: ids.cB,
      from: {
        startsAt: at(13, '09:00'),
        endsAt: at(13, '09:30'),
        staffUserId: expect.any(String),
      },
      to: null,
      reasonGiven: true,
    });
    const viewed = rows.filter(
      (r) => r.action === 'portal.appointments_viewed' && r.actorUserId === people.clientB.id,
    );
    expect(viewed.at(-1)).toMatchObject({
      entityType: 'client',
      entityId: ids.cB,
      metadata: { when: 'past', count: expect.any(Number) },
    });
    const text = JSON.stringify(rows.map((r) => r.metadata));
    for (const secret of ['Private matter', 'travel', 'Fake R12p', 'Jamie', '@r12.test']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('#108 review, on the portal', () => {
  it('takes ids in any letter case: a same-time reschedule in capitals changes nothing', async () => {
    const mine = await book(people.clientB, consult.id.toUpperCase(), at(20, '09:00'));
    outbox.length = 0;
    const same = exact(
      MyAppointment,
      await portal('post', `/${mine.id.toUpperCase()}/reschedule`, people.clientB, {
        startsAt: at(20, '09:00'),
      }),
    );
    expect(same.startsAt).toBe(at(20, '09:00'));
    expect((await firmDetail(mine.id)).history.map((e) => e.action)).toEqual(['BOOKED']);
    expect(outbox).toEqual([]);
    exact(
      MyAppointment,
      await portal('post', `/${mine.id.toUpperCase()}/cancel`, people.clientB, {}),
    );
  });

  it('writes the history row in the change: when it fails, nothing is booked, and the retry books', async () => {
    const audit = app.get(AuditService);
    const failing = vi
      .spyOn(audit, 'logIn')
      .mockRejectedValueOnce(new Error('The audit insert failed'));
    try {
      const res = await portal('post', '', people.clientB, {
        typeId: consult.id,
        startsAt: at(21, '09:00'),
      });
      expect(res.status).toBe(500);
    } finally {
      failing.mockRestore();
    }
    const retried = await book(people.clientB, consult.id, at(21, '09:00'));
    expect((await firmDetail(retried.id)).history.map((e) => e.action)).toEqual(['BOOKED']);
  });
});
