// End-to-end: Appointments Review 2, row 3 (booking links). Each appointment type has a public
// booking link, `{PORTAL_BASE_URL}/{slug}/book/{typeId}`, and a button for the firm's website
// (not an iframe: booking needs the portal's sign-in). The firm reads both
// (GET /business/appointment-types/:id/public-link); the portal page reads the type without
// signing in (GET /portal/:slug/booking-types/:id) and never sees its staff-only description.
// An archived type, or one clients can't book online, says so, and booking it is refused. Another
// firm's type is 404 on both routes.
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
  MyAppointment,
  MySlotList,
  PublicBookingType,
  PublicLink,
  publicButtonCode,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, zonedDate } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const TZ = 'America/Chicago';
const PORTAL = 'https://portal.r56-booking.test';
const BUTTON = '#0A7A5A';
const BRAND = '#123456';
const STAFF_ONLY = `Fake staff-only words ${run}`;
const person = (key: string) => ({ id: randomUUID(), email: `r56b-${key}-${run}@r56.test` });
const people = {
  ownerP: person('owner-p'),
  staffP: person('staff-p'),
  clientP: person('client-p'),
  ownerQ: person('owner-q'),
};
const ids = {
  firmP: '',
  firmQ: '',
  slugP: `r56b-p-${run}`,
  slugQ: `r56b-q-${run}`,
  slugSetup: `r56b-setup-${run}`,
  typeQ: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.18.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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

/** A firm route: /api/v1/business/... */
async function firm(
  method: 'get' | 'post' | 'put',
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

/** The public booking page's read: no sign-in. */
const visit = (typeId: string, slug = ids.slugP) =>
  request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/booking-types/${typeId}`)
    .set('x-forwarded-for', viewer());

/** The signed-in client's portal routes: /api/v1/portal/{slug}/me/appointments... */
async function portal(method: 'get' | 'post', path: string, body?: object): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slugP}/me/appointments${path}`)
    .set('authorization', `Bearer ${await tokenFor(people.clientP.email)}`)
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

const createType = async (body: object) =>
  exact(AppointmentType, await firm('post', '/appointment-types', body), 201);
const linkOf = async (typeId: string, who: Who = people.ownerP) =>
  exact(PublicLink, await firm('get', `/appointment-types/${typeId}/public-link`, undefined, who));
const urlOf = (typeId: string) => `${PORTAL}/${ids.slugP}/book/${typeId}`;

let live: AppointmentType;
let hidden: AppointmentType;
let archived: AppointmentType;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientP' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R56b ${key}`,
        },
      });
    }
    ids.firmP = (
      await tx.business.create({ data: { slug: ids.slugP, name: ids.slugP, status: 'ACTIVE' } })
    ).id;
    ids.firmQ = (
      await tx.business.create({ data: { slug: ids.slugQ, name: ids.slugQ, status: 'ACTIVE' } })
    ).id;
    await tx.business.create({
      data: { slug: ids.slugSetup, name: ids.slugSetup, status: 'PENDING_SETUP' },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmP }, async (tx) => {
    const P = { businessId: ids.firmP };
    await tx.businessSettings.create({
      data: { ...P, timezone: TZ, buttonColor: BUTTON, brandColor: BRAND },
    });
    await tx.membership.create({
      data: { ...P, userId: people.ownerP.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { ...P, userId: people.staffP.id, role: 'STAFF', status: 'ACTIVE' },
    });
    const client = await tx.client.create({
      data: { ...P, displayName: 'Jordan Sample (fake)', assignedUserId: people.ownerP.id },
    });
    await tx.clientAccount.create({
      data: {
        ...P,
        userId: people.clientP.id,
        clientId: client.id,
        email: people.clientP.email,
        status: 'ACTIVE',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmQ }, async (tx) => {
    const Q = { businessId: ids.firmQ };
    await tx.membership.create({
      data: { ...Q, userId: people.ownerQ.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.typeQ = (
      await tx.appointmentType.create({
        data: { ...Q, name: 'Q type', durationMinutes: 30, clientBookable: true },
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
    PORTAL_BASE_URL: PORTAL,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;

  live = await createType({ name: `Live ${run}`, durationMinutes: 30, clientBookable: true });
  hidden = await createType({ name: `Hidden ${run}`, durationMinutes: 30, clientBookable: false });
  archived = await createType({ name: `Gone ${run}`, durationMinutes: 30, clientBookable: true });
  expect((await firm('post', `/appointment-types/${archived.id}/archive`)).status).toBe(200);
  // The staff-only description, which no client-facing answer may carry (Review 2 row 10).
  const config = await firm('put', `/appointment-types/${live.id}/config`, {
    description: STAFF_ONLY,
    methods: ['VIDEO', 'PHONE'],
  });
  expect(config.status, JSON.stringify(config.body)).toBe(200);
  // The Owner (the client's staff member) works 09:00-17:00 every day, so the link's type books.
  const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startsAt: '09:00',
    endsAt: '17:00',
  }));
  const set = await firm('put', `/availability/${people.ownerP.id}/working-hours`, { hours });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe("the firm's booking link (GET /business/appointment-types/:id/public-link)", () => {
  it("gives every member the exact type's link and a button in the firm's colour, not an iframe", async () => {
    for (const who of [people.ownerP, people.staffP]) {
      const link = await linkOf(live.id, who);
      expect(link).toEqual({
        kind: 'APPOINTMENT_TYPE',
        itemId: live.id,
        url: urlOf(live.id),
        embedCode: publicButtonCode(urlOf(live.id), `Book ${live.name}`, BUTTON),
        state: 'LIVE',
      });
      expect(link.embedCode).toContain(`href="${urlOf(live.id)}"`);
      expect(link.embedCode).not.toContain('<iframe');
    }
    // Each type's link is its own.
    expect((await linkOf(hidden.id)).url).toBe(urlOf(hidden.id));
  });

  it('says when the link takes no bookings: archived, or not bookable by clients', async () => {
    expect((await linkOf(hidden.id)).state).toBe('HIDDEN');
    expect((await linkOf(archived.id)).state).toBe('ARCHIVED');
    // Restored, the same link takes bookings again; archived again for the tests below.
    expect((await firm('post', `/appointment-types/${archived.id}/restore`)).status).toBe(200);
    const again = await linkOf(archived.id);
    expect([again.url, again.state]).toEqual([urlOf(archived.id), 'LIVE']);
    expect((await firm('post', `/appointment-types/${archived.id}/archive`)).status).toBe(200);
  });

  it('takes the brand colour when the firm sets no button colour', async () => {
    await asOwner(ids.firmP, (tx) =>
      tx.businessSettings.update({ where: { businessId: ids.firmP }, data: { buttonColor: null } }),
    );
    try {
      expect((await linkOf(live.id)).embedCode).toContain(`background:${BRAND}`);
    } finally {
      await asOwner(ids.firmP, (tx) =>
        tx.businessSettings.update({
          where: { businessId: ids.firmP },
          data: { buttonColor: BUTTON },
        }),
      );
    }
  });

  it("is 404 for another firm's type, at either firm", async () => {
    expectError(
      await firm(
        'get',
        `/appointment-types/${live.id}/public-link`,
        undefined,
        people.ownerQ,
        ids.firmQ,
      ),
      404,
      'NOT_FOUND',
    );
    expectError(await firm('get', `/appointment-types/${ids.typeQ}/public-link`), 404, 'NOT_FOUND');
    expectError(
      await firm('get', '/appointment-types/not-a-type/public-link'),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('the booking page (GET /portal/:slug/booking-types/:id, public)', () => {
  it('shows a visitor the type without signing in, and never its staff-only description', async () => {
    const res = await visit(live.id);
    expect(exact(PublicBookingType, res)).toEqual({
      id: live.id,
      name: live.name,
      durationMinutes: 30,
      methods: ['VIDEO', 'PHONE'],
      state: 'LIVE',
    });
    expect(JSON.stringify(res.body)).not.toContain(STAFF_ONLY);
  });

  it('says so for an archived type and for one clients cannot book online', async () => {
    expect(exact(PublicBookingType, await visit(archived.id)).state).toBe('ARCHIVED');
    expect(exact(PublicBookingType, await visit(hidden.id)).state).toBe('HIDDEN');
  });

  it("is 404 for another firm's type, an unknown type, and a slug that is not an active firm", async () => {
    expectError(await visit(live.id, ids.slugQ), 404, 'NOT_FOUND');
    expectError(await visit(ids.typeQ), 404, 'NOT_FOUND');
    expectError(await visit(randomUUID()), 404, 'NOT_FOUND');
    expectError(await visit(live.id, ids.slugSetup), 404, 'NOT_FOUND');
    expectError(await visit(live.id, `nobody-${run}`), 404, 'NOT_FOUND');
    expectError(await visit('not-a-type'), 400, 'VALIDATION_FAILED');
  });
});

describe('booking from the link (row 3)', () => {
  it('the signed-in client books the exact type of the link; an archived or hidden type is refused', async () => {
    const from = addDays(zonedDate(TZ, Date.now()), 3);
    const to = addDays(from, 2);
    const slotsOf = (typeId: string) =>
      portal('get', `/slots?typeId=${typeId}&from=${from}&to=${to}`);

    const free = exact(MySlotList, await slotsOf(live.id));
    const slot = free.slots[0];
    expect(slot, 'the Owner works every day, so the type has free starts').toBeDefined();
    const booked = exact(
      MyAppointment,
      await portal('post', '', { typeId: live.id, startsAt: slot!.startsAt }),
      201,
    );
    expect([booked.type?.id, booked.startsAt]).toEqual([live.id, slot!.startsAt]);

    for (const refused of [archived, hidden]) {
      expectError(await slotsOf(refused.id), 404, 'NOT_FOUND');
      expectError(
        await portal('post', '', { typeId: refused.id, startsAt: free.slots[1]!.startsAt }),
        404,
        'NOT_FOUND',
      );
    }
    // Nothing was booked for the refused types.
    const rows = await asOwner(ids.firmP, (tx) =>
      tx.appointment.findMany({
        where: { businessId: ids.firmP, typeId: { in: [archived.id, hidden.id] } },
        select: { id: true },
      }),
    );
    expect(rows).toEqual([]);
  });
});
