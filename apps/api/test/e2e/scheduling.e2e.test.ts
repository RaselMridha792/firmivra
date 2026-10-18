// End-to-end: R58, the Appointments scheduling API (contract in
// packages/types/src/appointments/scheduling.ts). Part 1: summary, agenda, options, contacts,
// record, schedule, details and confirm. Every response is parsed with the contract and must equal
// the body (a field the contract does not name fails). Staff see Busy entries for appointments
// that are not theirs; another firm gets 404 and changes nothing; audit rows hold ids, times and
// field names only. Synthetic data only.
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
  AgendaPage,
  AppointmentRecord,
  AppointmentsSummary,
  ContactSearchResult,
  SchedulingOptions,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const TZ = 'Asia/Kolkata';
const person = (key: string) => ({ id: randomUUID(), email: `r58a-${key}-${run}@r58.test` });
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
  /** Assigned to staffA. */
  c1: '',
  /** Assigned to staffA2. */
  c2: '',
  /** Assigned to no one. */
  c3: '',
  archived: '',
  clientB: '',
  typeA: '',
  typeA2: '',
  typeB: '',
  serviceA: '',
  serviceB: '',
  office: '',
  room: '',
  officeB: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.52.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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

const today = zonedDate(TZ, Date.now());
const day = (n: number) => addDays(today, n);
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, day(n), minutesOf(time))).toISOString();
/** A day offset of its own for each test that books, so no two overlap. */
let nextDay = 40;
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

interface Seed {
  clientId: string;
  staff: Who;
  startsAt: string;
  minutes?: number;
  typeId?: string;
  status?: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  confirmed?: boolean;
  businessId?: string;
  staffUserId?: string;
}
/** An appointment written straight to the database (the database's own rules still apply). */
async function seed(s: Seed): Promise<string> {
  const businessId = s.businessId ?? ids.firmA;
  const start = new Date(s.startsAt);
  return asOwner(businessId, async (tx) => {
    const row = await tx.appointment.create({
      data: {
        businessId,
        clientId: s.clientId,
        staffUserId: s.staffUserId ?? s.staff.id,
        typeId: s.typeId ?? ids.typeA,
        startsAt: start,
        endsAt: new Date(start.getTime() + (s.minutes ?? 30) * 60_000),
        locationKind: 'VIDEO',
        status: s.status ?? 'SCHEDULED',
        cancelledAt: s.status === 'CANCELLED' ? new Date() : null,
        confirmedAt: s.confirmed ? new Date() : null,
        bookedByUserId: people.ownerA.id,
      },
      select: { id: true },
    });
    return row.id;
  });
}

const schedule = (extra: object = {}) => ({
  idempotencyKey: randomUUID(),
  contact: { kind: 'CLIENT', id: ids.c1 },
  typeId: ids.typeA,
  startsAt: at(freshDay(), '10:00'),
  endsAt: at(nextDay, '10:30'),
  method: 'VIDEO',
  staffUserIds: [people.staffA.id],
  ...extra,
});
const scheduled = async (extra: object = {}, who: Who = people.ownerA) =>
  exact(AppointmentRecord, await call('post', '/appointments/schedule', who, schedule(extra)));

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R58 ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `r58a-${key.toLowerCase()}-${run}`;
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
            startsAt: new Date('1970-01-01T09:00:00Z'),
            endsAt: new Date('1970-01-01T17:00:00Z'),
          },
        });
      }
    }
    const client = (displayName: string, assignedUserId: string | null, extra: object = {}) =>
      tx.client.create({
        data: {
          ...A,
          displayName,
          assignedUserId,
          email: `${displayName.split(' ')[0]?.toLowerCase()}-${run}@sample.test`,
          ...extra,
        },
      });
    ids.c1 = (await client('Jamie Sample (fake)', people.staffA.id, { phone: '555-0101' })).id;
    ids.c2 = (await client('Riley Example (fake)', people.staffA2.id)).id;
    ids.c3 = (await client('Casey Nobody (fake)', null)).id;
    ids.archived = (
      await client('Old Client (fake)', people.staffA.id, { archivedAt: new Date() })
    ).id;
    ids.serviceA = (
      await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
    ids.typeA = (
      await tx.appointmentType.create({
        data: {
          ...A,
          name: `Consult ${run}`,
          durationMinutes: 30,
          color: 'BLUE',
          serviceId: ids.serviceA,
        },
      })
    ).id;
    ids.typeA2 = (
      await tx.appointmentType.create({
        data: { ...A, name: `Buffered ${run}`, durationMinutes: 30, bufferAfterMinutes: 15 },
      })
    ).id;
    ids.office = (await tx.firmOffice.create({ data: { ...A, name: `Main ${run}` } })).id;
    ids.room = (
      await tx.firmRoom.create({ data: { ...A, officeId: ids.office, name: 'Room 1' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: 'B Client (fake)' } })).id;
    ids.typeB = (
      await tx.appointmentType.create({ data: { ...B, name: 'B type', durationMinutes: 30 } })
    ).id;
    ids.serviceB = (
      await tx.service.create({ data: { ...B, kind: 'ANNUAL_TAX', name: `B tax ${run}` } })
    ).id;
    ids.officeB = (await tx.firmOffice.create({ data: { ...B, name: 'B office' } })).id;
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
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('routes before :id', () => {
  it('summary, agenda, options and contacts answer instead of being read as an id (400)', async () => {
    const range = `from=${encodeURIComponent(at(0, '00:00'))}&to=${encodeURIComponent(at(2, '00:00'))}`;
    for (const path of [
      '/appointments/summary',
      `/appointments/agenda?${range}`,
      '/appointments/options',
      '/appointments/contacts?search=jam',
    ]) {
      const res = await call('get', path, people.ownerA);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it('are for the firm staff only: a signed-out caller and a stranger are refused', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/business/appointments/summary')
      .set('x-business-id', ids.firmA);
    expect(res.status).toBe(401);
    // Firm B's owner has no link to firm A.
    expect(
      (await call('get', '/appointments/options', people.ownerB, undefined, ids.firmA)).status,
    ).toBe(404);
  });
});

describe('summary', () => {
  it('counts the month and the month before it, and Staff count only what they see', async () => {
    const month = '2031-03';
    const d = (n: number) => `2031-03-${String(n).padStart(2, '0')}`;
    const prev = (n: number) => `2031-02-${String(n).padStart(2, '0')}`;
    const t = (date: string, time: string) =>
      new Date(zonedInstant(TZ, date, minutesOf(time))).toISOString();
    // This month: 2 scheduled (staffA's c1, staffA2's c2), 1 completed, 1 no-show, 1 canceled.
    await seed({ clientId: ids.c1, staff: people.staffA, startsAt: t(d(3), '10:00') });
    await seed({ clientId: ids.c2, staff: people.staffA2, startsAt: t(d(3), '11:00') });
    await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: t(d(4), '10:00'),
      status: 'COMPLETED',
    });
    await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: t(d(5), '10:00'),
      status: 'NO_SHOW',
    });
    await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: t(d(6), '10:00'),
      status: 'CANCELLED',
    });
    // Last month: 1 completed, 1 canceled. Last day of the month in Kolkata counts for February.
    await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: t(prev(10), '10:00'),
      status: 'COMPLETED',
    });
    await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: t(prev(28), '23:30'),
      status: 'CANCELLED',
    });

    const owner = exact(
      AppointmentsSummary,
      await call('get', `/appointments/summary?month=${month}`, people.ownerA),
    );
    expect(owner).toEqual({
      month,
      total: { value: 5, previous: 2 },
      upcoming: expect.any(Number),
      completed: { value: 1, previous: 1 },
      noShows: { value: 1, previous: 0 },
      canceled: { value: 1, previous: 1 },
    });
    const staff = exact(
      AppointmentsSummary,
      await call('get', `/appointments/summary?month=${month}`, people.staffA2),
    );
    // staffA2 sees its own (c2) and nothing of staffA's clients.
    expect(staff.total).toEqual({ value: 1, previous: 0 });
    expect(staff.completed.value).toBe(0);
  });

  it('defaults to this month and refuses a bad month and unknown fields', async () => {
    const res = exact(
      AppointmentsSummary,
      await call('get', '/appointments/summary', people.adminA),
    );
    expect(res.month).toBe(today.slice(0, 7));
    expectError(
      await call('get', '/appointments/summary?month=2031-13', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/appointments/summary?businessId=x', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('counts upcoming as the next 7 days, not cancelled', async () => {
    const before = exact(
      AppointmentsSummary,
      await call('get', '/appointments/summary', people.ownerA),
    ).upcoming;
    const startsAt = new Date(Date.now() + 2 * 86_400_000);
    startsAt.setUTCMinutes(0, 0, 0);
    // Staff and client are free at this time because no one else books 2 days out at this hour.
    const id = await seed({
      clientId: ids.c3,
      staff: people.staffA2,
      startsAt: startsAt.toISOString(),
    });
    expect(
      exact(AppointmentsSummary, await call('get', '/appointments/summary', people.ownerA))
        .upcoming,
    ).toBe(before + 1);
    await asOwner(ids.firmA, (tx) =>
      tx.appointment.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      }),
    );
    expect(
      exact(AppointmentsSummary, await call('get', '/appointments/summary', people.ownerA))
        .upcoming,
    ).toBe(before);
  });
});

describe('agenda', () => {
  const win = (from: string, to: string) =>
    `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  let a1 = '';
  let a2 = '';
  let a3 = '';
  let range = '';
  beforeAll(async () => {
    const n = freshDay();
    range = win(at(n, '00:00'), at(n + 1, '00:00'));
    a1 = await seed({
      clientId: ids.c1,
      staff: people.staffA,
      startsAt: at(n, '10:00'),
      confirmed: true,
    });
    a2 = await seed({ clientId: ids.c2, staff: people.staffA2, startsAt: at(n, '11:00') });
    a3 = await seed({
      clientId: ids.c3,
      staff: people.staffA2,
      startsAt: at(n, '12:00'),
      status: 'COMPLETED',
    });
  });

  it('Owner sees every appointment in full, sorted by start, with the contract fields', async () => {
    const page = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.ownerA),
    );
    expect(page.timezone).toBe(TZ);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((i) => i.id)).toEqual([a1, a2, a3]);
    const first = page.items[0];
    expect(first).toMatchObject({
      restricted: false,
      status: 'CONFIRMED',
      method: 'VIDEO',
      color: '#2563eb',
      internal: false,
      allDay: false,
      type: { id: ids.typeA },
      contact: {
        kind: 'CLIENT',
        id: ids.c1,
        name: 'Jamie Sample (fake)',
        clientType: 'INDIVIDUAL',
      },
      staff: [{ userId: people.staffA.id }],
    });
    expect(page.items[1]).toMatchObject({ status: 'PENDING' });
    expect(page.items[2]).toMatchObject({ status: 'COMPLETED' });
  });

  it('Staff see their own and their assigned clients in full and the rest as Busy', async () => {
    const page = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.staffA),
    );
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(a1)).toMatchObject({ restricted: false });
    expect(byId.get(a2)).toEqual({
      restricted: true,
      id: a2,
      startsAt: expect.any(String),
      endsAt: expect.any(String),
      staff: [{ userId: people.staffA2.id, name: expect.any(String) }],
      status: 'PENDING',
    });
    expect(JSON.stringify(byId.get(a2))).not.toContain('Riley');
  });

  it('filters by display status, staff and client', async () => {
    const ids_ = async (q: string, who: Who = people.ownerA) =>
      exact(AgendaPage, await call('get', `/appointments/agenda?${range}&${q}`, who)).items.map(
        (i) => i.id,
      );
    expect(await ids_('status=CONFIRMED')).toEqual([a1]);
    expect(await ids_('status=PENDING')).toEqual([a2]);
    expect(await ids_('status=COMPLETED')).toEqual([a3]);
    expect(await ids_('status=DRAFT')).toEqual([]);
    expect(await ids_(`staffUserId=${people.staffA2.id}`)).toEqual([a2, a3]);
    expect(await ids_(`clientId=${ids.c1}`)).toEqual([a1]);
  });

  it('searches client name, email, type and service; Staff search only what they see in full', async () => {
    const found = async (search: string, who: Who = people.ownerA) =>
      exact(
        AgendaPage,
        await call(
          'get',
          `/appointments/agenda?${range}&search=${encodeURIComponent(search)}`,
          who,
        ),
      ).items.map((i) => i.id);
    expect(await found('jamie')).toEqual([a1]);
    expect(await found(`riley-${run}`)).toEqual([a2]);
    expect(await found('Consult')).toEqual([a1, a2, a3]);
    expect(await found('Tax')).toEqual([]); // the appointments have no service of their own
    expect(await found(`Fake R58 staffA2`)).toEqual([a2, a3]);
    // Staff: Riley is behind a Busy entry, so searching the name finds nothing and reveals nothing.
    expect(await found('riley', people.staffA)).toEqual([]);
    expect(await found('jamie', people.staffA)).toEqual([a1]);
  });

  it('pages with a cursor and refuses a cursor it did not make', async () => {
    const first = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}&limit=2`, people.ownerA),
    );
    expect(first.items.map((i) => i.id)).toEqual([a1, a2]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = exact(
      AgendaPage,
      await call(
        'get',
        `/appointments/agenda?${range}&limit=2&cursor=${first.nextCursor}`,
        people.ownerA,
      ),
    );
    expect(second.items.map((i) => i.id)).toEqual([a3]);
    expect(second.nextCursor).toBeNull();
    expectError(
      await call('get', `/appointments/agenda?${range}&cursor=nope`, people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("Staff cannot probe another staff member's client by filter (404); bad input is 400", async () => {
    expectError(
      await call('get', `/appointments/agenda?${range}&clientId=${ids.c2}`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', '/appointments/agenda?from=x&to=y', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', `/appointments/agenda?${range}&limit=9999`, people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', `/appointments/agenda?${range}&firmId=${ids.firmB}`, people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("never shows another firm's appointments", async () => {
    const n = nextDay;
    const b = await seed({
      businessId: ids.firmB,
      clientId: ids.clientB,
      staff: people.ownerB,
      typeId: ids.typeB,
      startsAt: at(n, '10:00'),
    });
    const mine = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.ownerA),
    );
    expect(mine.items.map((i) => i.id)).not.toContain(b);
    const theirs = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.ownerB, undefined, ids.firmB),
    );
    expect(theirs.items.map((i) => i.id)).toEqual([b]);
  });
});

describe('options', () => {
  it('lists the types, services, staff, offices and rooms of this firm only', async () => {
    const o = exact(SchedulingOptions, await call('get', '/appointments/options', people.staffA));
    expect(o.timezone).toBe(TZ);
    expect(o.types.map((t) => t.id)).toEqual(expect.arrayContaining([ids.typeA, ids.typeA2]));
    expect(o.types.find((t) => t.id === ids.typeA)).toEqual({
      id: ids.typeA,
      name: `Consult ${run}`,
      durationMinutes: 30,
      color: '#2563eb',
      serviceId: ids.serviceA,
    });
    expect(o.types.map((t) => t.id)).not.toContain(ids.typeB);
    expect(o.services.map((s) => s.id)).toEqual([ids.serviceA]);
    expect(o.staff.map((s) => s.userId).sort()).toEqual(
      [people.ownerA.id, people.adminA.id, people.staffA.id, people.staffA2.id].sort(),
    );
    expect(o.offices?.map((x) => x.id)).toEqual([ids.office]);
    expect(o.rooms).toEqual([{ id: ids.room, name: 'Room 1', officeId: ids.office }]);
    expect(o).toMatchObject({ smsEnabled: false, portalEnabled: true, videoProvider: null });
  });

  it('leaves archived types out and shows a connected video integration', async () => {
    const t = await asOwner(ids.firmA, (tx) =>
      tx.appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `Old ${run}`,
          durationMinutes: 30,
          archivedAt: new Date(),
        },
        select: { id: true },
      }),
    );
    await asOwner(ids.firmA, async (tx) => {
      await tx.messageSettings.create({ data: { businessId: ids.firmA, smsEnabled: true } });
      await tx.integrationConnection.create({ data: { businessId: ids.firmA, provider: 'zoom' } });
    });
    const o = exact(SchedulingOptions, await call('get', '/appointments/options', people.ownerA));
    expect(o.types.map((x) => x.id)).not.toContain(t.id);
    expect(o).toMatchObject({ smsEnabled: true, videoProvider: 'ZOOM' });
    // Firm B has neither.
    const b = exact(
      SchedulingOptions,
      await call('get', '/appointments/options', people.ownerB, undefined, ids.firmB),
    );
    expect(b).toMatchObject({ smsEnabled: false, videoProvider: null });
    expect(b.offices?.map((x) => x.id)).toEqual([ids.officeB]);
    await asOwner(ids.firmA, async (tx) => {
      await tx.messageSettings.deleteMany({ where: { businessId: ids.firmA } });
      await tx.integrationConnection.deleteMany({ where: { businessId: ids.firmA } });
    });
  });
});

describe('contacts', () => {
  const find = async (q: string, who: Who = people.ownerA) =>
    exact(
      ContactSearchResult,
      await call('get', `/appointments/contacts?search=${encodeURIComponent(q)}`, who),
    ).items;

  it('finds clients by name, email and phone; Staff only their assigned clients', async () => {
    const [jamie, ...none] = await find('jamie');
    expect(none).toEqual([]);
    expect(jamie).toEqual({
      kind: 'CLIENT',
      id: ids.c1,
      name: 'Jamie Sample (fake)',
      businessName: null,
      email: `jamie-${run}@sample.test`,
      phone: '555-0101',
      clientType: 'INDIVIDUAL',
    });
    expect((await find('555-0101')).map((c) => c.id)).toEqual([ids.c1]);
    expect((await find(`riley-${run}@`)).map((c) => c.id)).toEqual([ids.c2]);
    expect((await find('(fake)', people.staffA)).map((c) => c.id)).toEqual([ids.c1]);
    expect(await find('riley', people.staffA)).toEqual([]);
  });

  it("leaves archived clients and other firms' clients out; limits and validates", async () => {
    expect((await find('old client')).map((c) => c.id)).toEqual([]);
    expect(await find('B Client')).toEqual([]);
    expect((await find('(fake)')).length).toBe(3);
    const limited = exact(
      ContactSearchResult,
      await call('get', '/appointments/contacts?search=fake&limit=2', people.ownerA),
    );
    expect(limited.items).toHaveLength(2);
    expect(await find('')).toEqual([]);
    expectError(
      await call('get', '/appointments/contacts', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/appointments/contacts?search=a&limit=21', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('finds a client by the number shown as CL-nnnnn', async () => {
    const number = await asOwner(
      ids.firmA,
      async (tx) =>
        (
          await tx.client.findUniqueOrThrow({
            where: { id: ids.c3 },
            select: { clientNumber: true },
          })
        ).clientNumber,
    );
    expect((await find(`CL-${number}`)).map((c) => c.id)).toEqual([ids.c3]);
    expect((await find(String(number))).map((c) => c.id)).toContain(ids.c3);
  });
});

describe('schedule', () => {
  it('books one appointment and answers the record the screens read', async () => {
    const body = schedule({
      serviceId: ids.serviceA,
      color: '#16a34a',
      internalNotes: "Bring last year's return",
      clientInstructions: 'Join from the link',
      videoUrl: 'https://meet.example.test/room-1',
      reminders: [
        { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
        { channel: 'PORTAL', amount: 2, unit: 'HOURS' },
      ],
      status: 'PENDING',
    });
    const record = exact(
      AppointmentRecord,
      await call('post', '/appointments/schedule', people.adminA, body),
    );
    expect(record).toMatchObject({
      restricted: false,
      status: 'PENDING',
      method: 'VIDEO',
      color: '#16a34a',
      videoUrl: 'https://meet.example.test/room-1',
      service: { id: ids.serviceA },
      type: { id: ids.typeA },
      contact: { id: ids.c1 },
      staff: [{ userId: people.staffA.id }],
      timezone: TZ,
      internalNotes: "Bring last year's return",
      clientInstructions: 'Join from the link',
      seriesId: null,
      recurrence: null,
      notices: [],
    });
    expect(record.reminders).toEqual([
      { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
      { channel: 'PORTAL', amount: 2, unit: 'HOURS' },
    ]);
    expect(record.history.map((h) => h.action)).toEqual(['BOOKED']);
    expect(record.related).toEqual({
      taxReturn: null,
      bookkeepingEngagement: null,
      invoice: null,
      task: null,
      intakeForm: null,
      documentRequest: null,
    });
    const read = exact(
      AppointmentRecord,
      await call('get', `/appointments/${record.id}/record`, people.ownerA),
    );
    expect(read).toEqual(record);
  });

  it("defaults to Confirmed with the type's colour and the staff member's link, and tells the client", async () => {
    const before = outbox.length;
    await asOwner(ids.firmA, (tx) =>
      tx.membership.updateMany({
        where: { businessId: ids.firmA, userId: people.staffA.id },
        data: { meetingUrl: 'https://meet.example.test/staff-a' },
      }),
    );
    const r = await scheduled();
    expect(r).toMatchObject({
      status: 'CONFIRMED',
      color: '#2563eb',
      videoUrl: 'https://meet.example.test/staff-a',
    });
    expect(outbox.slice(before).map((m) => m.template)).toContain('appointment.booked');
    const quiet = outbox.length;
    await scheduled({ sendConfirmation: false });
    expect(outbox.length).toBe(quiet);
  });

  it('is retry-safe: the same idempotencyKey returns the first appointment and books once', async () => {
    const body = schedule();
    const first = exact(
      AppointmentRecord,
      await call('post', '/appointments/schedule', people.ownerA, body),
    );
    const again = exact(
      AppointmentRecord,
      await call('post', '/appointments/schedule', people.ownerA, body),
    );
    expect(again.id).toBe(first.id);
    const count = await asOwner(ids.firmA, (tx) =>
      tx.appointment.count({
        where: { businessId: ids.firmA, idempotencyKey: body.idempotencyKey },
      }),
    );
    expect(count).toBe(1);
    // Four at once: still one.
    const parallel = schedule();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => call('post', '/appointments/schedule', people.ownerA, parallel)),
    );
    const okIds = new Set(
      results.filter((r) => r.status === 200).map((r) => (r.body as { id: string }).id),
    );
    expect(okIds.size).toBe(1);
    expect(
      results.filter((r) => r.status !== 200).every((r) => [409, 429].includes(r.status)),
    ).toBe(true);
  });

  it('refuses a time the staff member, client or room already has with 409 SCHEDULING_CONFLICT and a way out', async () => {
    const n = freshDay();
    await scheduled({ startsAt: at(n, '10:00'), endsAt: at(n, '11:00') });
    const res = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({ startsAt: at(n, '10:30'), endsAt: at(n, '11:30') }),
    );
    expectError(res, 409, 'SCHEDULING_CONFLICT');
    const details = (
      res.body as {
        error: {
          details: {
            ok: boolean;
            conflicts: { kind: string }[];
            alternatives: unknown[];
            canOverride: boolean;
          };
        };
      }
    ).error.details;
    expect(details.ok).toBe(false);
    expect(details.conflicts.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['STAFF_BOOKED', 'CLIENT_DOUBLE_BOOKED']),
    );
    expect(details.canOverride).toBe(false);
    expect(details.alternatives.length).toBeGreaterThan(0);
    // A reason does not unlock a hard conflict.
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({
          startsAt: at(n, '10:30'),
          endsAt: at(n, '11:30'),
          overrideConflicts: { reason: 'Please' },
        }),
      ),
      409,
      'SCHEDULING_CONFLICT',
    );
  });

  it('treats blocked time and time off as conflicts', async () => {
    const n = freshDay();
    await asOwner(ids.firmA, (tx) =>
      tx.blockedTime.create({
        data: {
          businessId: ids.firmA,
          userId: people.staffA.id,
          startsAt: new Date(at(n, '10:00')),
          endsAt: new Date(at(n, '12:00')),
          kind: 'TIME_OFF',
        },
      }),
    );
    const res = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({ startsAt: at(n, '11:00'), endsAt: at(n, '11:30') }),
    );
    expectError(res, 409, 'SCHEDULING_CONFLICT');
    expect(
      (res.body as { error: { details: { conflicts: { kind: string }[] } } }).error.details
        .conflicts[0]?.kind,
    ).toBe('TIME_OFF');
  });

  it('lets Owner and Admin override working hours with a reason (audited); Staff cannot', async () => {
    const n = freshDay();
    const outside = { startsAt: at(n, '07:00'), endsAt: at(n, '07:30') };
    const blocked = await call('post', '/appointments/schedule', people.ownerA, schedule(outside));
    expectError(blocked, 409, 'SCHEDULING_CONFLICT');
    expect(
      (blocked.body as { error: { details: { canOverride: boolean } } }).error.details.canOverride,
    ).toBe(true);
    const r = exact(
      AppointmentRecord,
      await call(
        'post',
        '/appointments/schedule',
        people.adminA,
        schedule({ ...outside, overrideConflicts: { reason: 'Early client call' } }),
      ),
    );
    expect(r.startsAt).toBe(outside.startsAt);
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, action: 'appointment.conflict_overridden' },
      }),
    );
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('Early client call');
    // staffA books for its own client in hours it does not work.
    const staffTry = await call(
      'post',
      '/appointments/schedule',
      people.staffA,
      schedule({
        startsAt: at(n, '06:00'),
        endsAt: at(n, '06:30'),
        overrideConflicts: { reason: 'Please' },
      }),
    );
    expectError(staffTry, 409, 'SCHEDULING_CONFLICT');
  });

  it('counts buffers as hard conflicts, as the database does: too close is refused, even with a reason', async () => {
    const n = freshDay();
    await scheduled({ typeId: ids.typeA, startsAt: at(n, '10:00'), endsAt: at(n, '10:30') });
    // This type keeps 15 minutes free after: 09:30-10:00 would end 15 minutes into the first.
    const body = schedule({
      typeId: ids.typeA2,
      contact: { kind: 'CLIENT', id: ids.c2 },
      startsAt: at(n, '09:30'),
      endsAt: at(n, '10:00'),
    });
    const res = await call('post', '/appointments/schedule', people.ownerA, body);
    expectError(res, 409, 'SCHEDULING_CONFLICT');
    const details = (
      res.body as { error: { details: { conflicts: { kind: string }[]; canOverride: boolean } } }
    ).error.details;
    expect(details.conflicts.map((c) => c.kind)).toEqual(['BUFFER']);
    expect(details.canOverride).toBe(false);
    expectError(
      await call('post', '/appointments/schedule', people.adminA, {
        ...body,
        overrideConflicts: { reason: 'Back to back is fine' },
      }),
      409,
      'SCHEDULING_CONFLICT',
    );
    // 15 minutes earlier leaves the gap.
    exact(
      AppointmentRecord,
      await call('post', '/appointments/schedule', people.ownerA, {
        ...body,
        startsAt: at(n, '09:15'),
        endsAt: at(n, '09:45'),
        idempotencyKey: randomUUID(),
      }),
    );
  });

  it('repeats weekly and makes one appointment per occurrence in a series', async () => {
    const n = freshDay() + 60;
    const r = await scheduled({
      startsAt: at(n, '10:00'),
      endsAt: at(n, '10:30'),
      recurrence: { frequency: 'WEEKLY', interval: 1, count: 3 },
    });
    expect(r.seriesId).toEqual(expect.any(String));
    expect(r.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, count: 3 });
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.appointment.findMany({
        where: { businessId: ids.firmA, seriesId: r.seriesId },
        orderBy: { startsAt: 'asc' },
      }),
    );
    expect(rows.map((x) => x.startsAt.toISOString())).toEqual([
      at(n, '10:00'),
      at(n + 7, '10:00'),
      at(n + 14, '10:00'),
    ]);
  });

  it('refuses the whole series when a later occurrence conflicts, and books nothing', async () => {
    const n = freshDay() + 60;
    await asOwner(ids.firmA, (tx) =>
      tx.blockedTime.create({
        data: {
          businessId: ids.firmA,
          userId: people.staffA.id,
          startsAt: new Date(at(n + 7, '09:00')),
          endsAt: new Date(at(n + 7, '12:00')),
        },
      }),
    );
    const key = randomUUID();
    const res = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({
        idempotencyKey: key,
        startsAt: at(n, '10:00'),
        endsAt: at(n, '10:30'),
        recurrence: { frequency: 'WEEKLY', interval: 1, count: 3 },
      }),
    );
    expectError(res, 409, 'SCHEDULING_CONFLICT');
    expect(
      (res.body as { error: { details: { conflicts: { kind: string }[] } } }).error.details
        .conflicts[0]?.kind,
    ).toBe('RECURRING_OCCURRENCE');
    expect(
      await asOwner(ids.firmA, (tx) =>
        tx.appointment.count({ where: { businessId: ids.firmA, idempotencyKey: key } }),
      ),
    ).toBe(0);
  });

  it('keeps an office and room for in-person appointments, and a room cannot be double booked', async () => {
    const n = freshDay();
    const inPerson = {
      method: 'IN_PERSON',
      officeId: ids.office,
      roomId: ids.room,
      details: '1 Sample Street',
    };
    const r = await scheduled({ ...inPerson, startsAt: at(n, '10:00'), endsAt: at(n, '10:30') });
    expect(r).toMatchObject({
      method: 'IN_PERSON',
      videoUrl: null,
      place: { office: { id: ids.office }, room: { id: ids.room }, details: '1 Sample Street' },
    });
    const clash = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({
        ...inPerson,
        contact: { kind: 'CLIENT', id: ids.c2 },
        staffUserIds: [people.staffA2.id],
        startsAt: at(n, '10:00'),
        endsAt: at(n, '10:30'),
      }),
    );
    expectError(clash, 409, 'SCHEDULING_CONFLICT');
    expect(
      (
        clash.body as { error: { details: { conflicts: { kind: string }[] } } }
      ).error.details.conflicts.map((c) => c.kind),
    ).toEqual(['ROOM']);
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ officeId: ids.office }),
      ),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('refuses what the form can send but nothing can keep yet (400), without writing anything', async () => {
    const refused = async (extra: object) => {
      const before = await asOwner(ids.firmA, (tx) =>
        tx.appointment.count({ where: { businessId: ids.firmA } }),
      );
      const res = await call('post', '/appointments/schedule', people.ownerA, schedule(extra));
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(
        await asOwner(ids.firmA, (tx) =>
          tx.appointment.count({ where: { businessId: ids.firmA } }),
        ),
      ).toBe(before);
    };
    await refused({ contact: { kind: 'CONTACT', name: 'New Person', email: 'new@sample.test' } });
    await refused({ staffUserIds: [people.staffA.id, people.staffA2.id] });
    await refused({ method: 'OTHER' });
    await refused({ related: { taxReturnId: randomUUID() } });
    await refused({ recurrence: { frequency: 'CUSTOM', interval: 1, count: 3 } });
    await refused({ color: '#123456' });
    await refused({ timezone: 'Not/AZone' });
    await refused({ reminders: [{ channel: 'EMAIL', amount: 5, unit: 'WEEKS' }] });
    await refused({ endsAt: at(nextDay, '23:30') }); // longer than 12 hours
  });

  it('answers 409 VIDEO_NOT_CONNECTED and 400 SMS_UNAVAILABLE', async () => {
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ generateVideoLink: true }),
      ),
      409,
      'VIDEO_NOT_CONNECTED',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ reminders: [{ channel: 'SMS', amount: 1, unit: 'DAYS' }] }),
      ),
      400,
      'SMS_UNAVAILABLE',
    );
  });

  it("is 404 for another firm's ids and for a client Staff may not book; 409 for an archived client or type", async () => {
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ contact: { kind: 'CLIENT', id: ids.clientB } }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/appointments/schedule', people.ownerA, schedule({ typeId: ids.typeB })),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ serviceId: ids.serviceB }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ method: 'IN_PERSON', officeId: ids.officeB }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ staffUserIds: [people.ownerB.id] }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.staffA,
        schedule({ contact: { kind: 'CLIENT', id: ids.c2 } }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ contact: { kind: 'CLIENT', id: ids.archived } }),
      ),
      409,
      'CLIENT_ARCHIVED',
    );
    const archivedType = await asOwner(ids.firmA, (tx) =>
      tx.appointmentType.create({
        data: {
          businessId: ids.firmA,
          name: `Gone ${run}`,
          durationMinutes: 30,
          archivedAt: new Date(),
        },
        select: { id: true },
      }),
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ typeId: archivedType.id }),
      ),
      409,
      'TYPE_ARCHIVED',
    );
  });

  it('Staff book for their own clients, and a firm id in the body is refused (400)', async () => {
    const r = exact(
      AppointmentRecord,
      await call('post', '/appointments/schedule', people.staffA, schedule()),
    );
    expect(r.contact.id).toBe(ids.c1);
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ businessId: ids.firmB }),
      ),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('writes audit rows with ids and times only: never notes, instructions or links', async () => {
    const r = await scheduled({
      internalNotes: 'SECRET-NOTE',
      clientInstructions: 'SECRET-INSTRUCTION',
      videoUrl: 'https://meet.example.test/secret-link',
    });
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: r.id } }),
    );
    expect(rows.map((x) => x.action)).toContain('appointment.booked');
    const text = JSON.stringify(rows);
    for (const secret of ['SECRET-NOTE', 'SECRET-INSTRUCTION', 'secret-link', 'Jamie'])
      expect(text).not.toContain(secret);
  });
});

describe('record', () => {
  it("Staff read their own and their clients' appointments; others are 404; so is another firm", async () => {
    const n = freshDay();
    const own = await seed({ clientId: ids.c3, staff: people.staffA, startsAt: at(n, '10:00') });
    const assigned = await seed({
      clientId: ids.c1,
      staff: people.staffA2,
      startsAt: at(n, '11:00'),
    });
    const other = await seed({ clientId: ids.c2, staff: people.staffA2, startsAt: at(n, '12:00') });
    for (const id of [own, assigned]) {
      exact(AppointmentRecord, await call('get', `/appointments/${id}/record`, people.staffA));
    }
    expectError(
      await call('get', `/appointments/${other}/record`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/appointments/${other}/record`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/appointments/${randomUUID()}/record`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', '/appointments/not-an-id/record', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('reads the history back and records the view in the audit log', async () => {
    const r = await scheduled();
    await call('post', `/appointments/${r.id}/reschedule`, people.ownerA, {
      startsAt: at(freshDay(), '10:00'),
    });
    const again = exact(
      AppointmentRecord,
      await call('get', `/appointments/${r.id}/record`, people.ownerA),
    );
    expect(again.history.map((h) => h.action)).toEqual(['BOOKED', 'RESCHEDULED']);
    expect(again.status).toBe('RESCHEDULED');
    const views = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.count({
        where: { businessId: ids.firmA, action: 'appointment.viewed', entityId: r.id },
      }),
    );
    expect(views).toBeGreaterThan(0);
  });
});

describe('details (Edit Existing)', () => {
  it('changes only what is sent, keeps the same record and answers a new version', async () => {
    const r = await scheduled({ internalNotes: 'First' });
    const before = outbox.length;
    const edited = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        internalNotes: 'Second',
        clientInstructions: 'Bring ID',
        color: '#e11d48',
        status: 'PENDING',
        reminders: [{ channel: 'EMAIL', amount: 3, unit: 'HOURS' }],
      }),
    );
    expect(edited).toMatchObject({
      id: r.id,
      internalNotes: 'Second',
      clientInstructions: 'Bring ID',
      color: '#e11d48',
      status: 'PENDING',
      startsAt: r.startsAt,
    });
    expect(edited.reminders).toEqual([{ channel: 'EMAIL', amount: 3, unit: 'HOURS' }]);
    expect(edited.version).not.toBe(r.version);
    expect(edited.history.map((h) => h.action)).toEqual(['BOOKED']);
    // Notes, colour and reminders are not news to the client.
    expect(outbox.length).toBe(before);
    const cleared = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: edited.version,
        internalNotes: '',
        serviceId: null,
      }),
    );
    expect(cleared.internalNotes).toBeNull();
  });

  it('a change that changes nothing writes nothing and keeps the version', async () => {
    const r = await scheduled();
    const same = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        typeId: ids.typeA,
      }),
    );
    expect(same.version).toBe(r.version);
    const edits = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.count({
        where: { businessId: ids.firmA, action: 'appointment.details_updated', entityId: r.id },
      }),
    );
    expect(edits).toBe(0);
  });

  it('a new time or staff member is a reschedule: history, a notice, and the conflict check', async () => {
    const r = await scheduled();
    const n = freshDay();
    const before = outbox.length;
    const moved = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        startsAt: at(n, '14:00'),
        endsAt: at(n, '14:30'),
        staffUserIds: [people.staffA2.id],
      }),
    );
    expect(moved).toMatchObject({
      status: 'RESCHEDULED',
      startsAt: at(n, '14:00'),
      staff: [{ userId: people.staffA2.id }],
    });
    expect(moved.history.map((h) => h.action)).toEqual(['BOOKED', 'RESCHEDULED']);
    expect(outbox.slice(before).map((m) => m.template)).toContain('appointment.changed');
    const other = await scheduled({
      startsAt: at(n, '15:00'),
      endsAt: at(n, '15:30'),
      contact: { kind: 'CLIENT', id: ids.c2 },
    });
    const clash = await call('patch', `/appointments/${other.id}/details`, people.ownerA, {
      version: other.version,
      startsAt: at(n, '14:00'),
      endsAt: at(n, '14:30'),
      staffUserIds: [people.staffA2.id],
    });
    expectError(clash, 409, 'SCHEDULING_CONFLICT');
  });

  it('answers 409 SAVE_CONFLICT on a stale version and 409 APPOINTMENT_CLOSED once it is over', async () => {
    const r = await scheduled();
    exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        internalNotes: 'Mine',
      }),
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.adminA, {
        version: r.version,
        internalNotes: 'Theirs',
      }),
      409,
      'SAVE_CONFLICT',
    );
    await call('post', `/appointments/${r.id}/cancel`, people.ownerA, {});
    const closed = exact(
      AppointmentRecord,
      await call('get', `/appointments/${r.id}/record`, people.ownerA),
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: closed.version,
        internalNotes: 'Late',
      }),
      409,
      'APPOINTMENT_CLOSED',
    );
  });

  it('refuses a change of client, related items and unknown fields; Staff reach only their own', async () => {
    const r = await scheduled();
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        contact: { kind: 'CLIENT', id: ids.c2 },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        related: { invoiceId: randomUUID() },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        businessId: ids.firmB,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        internalNotes: 'No version',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/appointments/${r.id}/details`, people.staffA2, {
        version: r.version,
        internalNotes: 'x',
      }),
      404,
      'NOT_FOUND',
    );
    exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.staffA, {
        version: r.version,
        internalNotes: 'By its staff member',
      }),
    );
  });

  it('moves a video appointment to an in-person one with an office, and clears them when it goes back', async () => {
    const r = await scheduled();
    const a = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: r.version,
        method: 'IN_PERSON',
        officeId: ids.office,
        roomId: ids.room,
        details: '2 Sample Road',
      }),
    );
    expect(a).toMatchObject({
      method: 'IN_PERSON',
      place: { office: { id: ids.office }, room: { id: ids.room }, details: '2 Sample Road' },
    });
    const b = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${r.id}/details`, people.ownerA, {
        version: a.version,
        method: 'PHONE',
        details: '555-0100',
      }),
    );
    expect(b).toMatchObject({
      method: 'PHONE',
      place: { office: null, room: null, details: '555-0100' },
      videoUrl: null,
    });
  });

  it('is 404 in another firm and changes nothing', async () => {
    const r = await scheduled();
    expectError(
      await call(
        'patch',
        `/appointments/${r.id}/details`,
        people.ownerB,
        { version: r.version, internalNotes: 'Intruder' },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    const still = exact(
      AppointmentRecord,
      await call('get', `/appointments/${r.id}/record`, people.ownerA),
    );
    expect(still.version).toBe(r.version);
  });
});

describe('confirm', () => {
  it('turns Pending into Confirmed, once, and audits it', async () => {
    const r = await scheduled({ status: 'PENDING' });
    expect(r.status).toBe('PENDING');
    const c = exact(
      AppointmentRecord,
      await call('post', `/appointments/${r.id}/confirm`, people.staffA, {}),
    );
    expect(c.status).toBe('CONFIRMED');
    const again = exact(
      AppointmentRecord,
      await call('post', `/appointments/${r.id}/confirm`, people.ownerA, {}),
    );
    expect(again.version).toBe(c.version);
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.count({
        where: { businessId: ids.firmA, action: 'appointment.confirmed', entityId: r.id },
      }),
    );
    expect(rows).toBe(1);
  });

  it("is 404 for Staff on someone else's and for another firm, 409 once closed", async () => {
    const r = await scheduled({ status: 'PENDING' });
    expectError(
      await call('post', `/appointments/${r.id}/confirm`, people.staffA2, {}),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/appointments/${r.id}/confirm`, people.ownerB, {}, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expect(
      exact(AppointmentRecord, await call('get', `/appointments/${r.id}/record`, people.ownerA))
        .status,
    ).toBe('PENDING');
    await call('post', `/appointments/${r.id}/cancel`, people.ownerA, {});
    expectError(
      await call('post', `/appointments/${r.id}/confirm`, people.ownerA, {}),
      409,
      'APPOINTMENT_CLOSED',
    );
  });
});
