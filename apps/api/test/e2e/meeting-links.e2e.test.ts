// End-to-end: R14 meeting links (contract in packages/types/src/appointments/schemas.ts, "Meeting
// links"): each member's default link (set by themselves, or by Owner and Admin), copied into
// VIDEO appointments at booking (firm and portal), swapped on a change of staff member unless a
// custom link was typed, and Edit location (PATCH /business/appointments/{id}). Another firm or
// another client gets 404. A link never reaches the audit log or a notice. The store is the
// in-memory fake until R0's memberships.meeting_url; the real binding answers 503 for now.
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
  AppointmentType,
  Availability,
  MemberAvailability,
  MyAppointment,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { MEETING_LINKS } from '../../src/appointments/meeting-links.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { FakeMeetingLinks } from '../fake-meeting-links.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const TZ = 'Asia/Kolkata';
const person = (key: string) => ({ id: randomUUID(), email: `r14m-${key}-${run}@r14.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  formerA: person('former-a'),
  /** The login of c1 (assigned to staffA). */
  clientA: person('client-a'),
  /** The login of c2 (assigned to staffA2). */
  clientA2: person('client-a2'),
  ownerB: person('owner-b'),
};
type Key = keyof typeof people;
const CLIENTS: readonly Key[] = ['clientA', 'clientA2'];
const ids = { firmA: '', firmB: '', slugA: `r14m-a-${run}`, c1: '', c2: '', apptB: '' };
/** Synthetic links (fake meeting ids and passcodes). */
const LINK_A = `https://us02web.zoom.us/j/1000${run}?pwd=fakeA${run}`;
const LINK_A2 = `https://meet.google.com/fake-a2-${run}`;
const CUSTOM = `https://teams.microsoft.com/l/meetup-join/fake-${run}`;

let app: INestApplication;
const links = new FakeMeetingLinks();
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `192.0.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

async function tokenFor(target: INestApplication, email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(target.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Who = { email: string };
type Method = 'get' | 'post' | 'patch' | 'put';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmA,
  target = app,
): Promise<Response> {
  const req = request(target.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(target, who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
async function portal(method: Method, path: string, who: Who, body?: object): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${ids.slugA}/me/appointments${path}`)
    .set('authorization', `Bearer ${await tokenFor(app, who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

const day = (n: number) => addDays(zonedDate(TZ, Date.now()), n);
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, day(n), minutesOf(time))).toISOString();

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
const auditRows = () =>
  asOwner(ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { businessId: ids.firmA },
      select: { action: true, entityId: true, metadata: true },
    }),
  );

const setLink = (userId: string, meetingUrl: string | null, who: Who = people.ownerA) =>
  call('put', `/availability/${userId}/meeting-link`, who, { meetingUrl });
const book = async (body: object, who: Who = people.ownerA) =>
  exact(Appointment, await call('post', '/appointments', who, body), 201);

let video: AppointmentType;
let inPerson: AppointmentType;

async function startApp(env: Env, fake: boolean): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    });
  if (fake) builder = builder.overrideProvider(MEETING_LINKS).useValue(links);
  const nest = (await builder.compile()).createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  return nest;
}
let env: Env;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: CLIENTS.includes(key as Key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R14m ${key}`,
        },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: ids.slugA, status: 'ACTIVE' } })
    ).id;
    const slugB = `r14m-b-${run}`;
    ids.firmB = (
      await tx.business.create({ data: { slug: slugB, name: slugB, status: 'ACTIVE' } })
    ).id;
  });
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
    ids.c1 = (
      await tx.client.create({
        data: { ...A, displayName: 'Jamie Sample (fake)', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.c2 = (
      await tx.client.create({
        data: { ...A, displayName: 'Riley Example (fake)', assignedUserId: people.staffA2.id },
      })
    ).id;
    for (const [who, clientId] of [
      [people.clientA, ids.c1],
      [people.clientA2, ids.c2],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: who.id, clientId, email: who.email, status: 'ACTIVE' },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...B, displayName: 'B Client (fake)' } });
    const start = new Date(Date.now() + 5 * 86_400_000);
    ids.apptB = (
      await tx.appointment.create({
        data: {
          ...B,
          clientId: client.id,
          staffUserId: people.ownerB.id,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
          locationKind: 'VIDEO',
          bookedByUserId: people.ownerB.id,
        },
      })
    ).id;
  });
  await owner.$disconnect();

  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  app = await startApp(env, true);

  const type = async (body: object) =>
    exact(AppointmentType, await call('post', '/appointment-types', people.ownerA, body), 201);
  video = await type({ name: `Video ${run}`, durationMinutes: 30, clientBookable: true });
  inPerson = await type({ name: `Office ${run}`, durationMinutes: 30, locationKind: 'IN_PERSON' });
  // staffA works 09:00-12:00; staffA2 09:00-12:00 and 13:00-14:00 (firm time), every day.
  for (const [who, ranges] of [
    [people.staffA, [['09:00', '12:00']]],
    [
      people.staffA2,
      [
        ['09:00', '12:00'],
        ['13:00', '14:00'],
      ],
    ],
  ] as const) {
    const hours = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      ranges.map(([startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
    );
    const res = await call('put', `/availability/${who.id}/working-hours`, people.ownerA, {
      hours,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
});

afterAll(async () => {
  await app.close();
});

describe('a member’s meeting link', () => {
  it('Staff set and clear their own; GET availability shows it; the audit has no link', async () => {
    const set = exact(MemberAvailability, await setLink(people.staffA.id, LINK_A, people.staffA));
    expect(set).toMatchObject({ member: { userId: people.staffA.id }, meetingUrl: LINK_A });
    expect(set.hours.length).toBeGreaterThan(0);
    const cleared = exact(MemberAvailability, await setLink(people.staffA.id, '', people.staffA));
    expect(cleared.meetingUrl).toBeNull();
    exact(MemberAvailability, await setLink(people.staffA.id, LINK_A, people.staffA));
    const all = exact(Availability, await call('get', '/availability', people.staffA2));
    const urlOf = (userId: string) =>
      all.members.find((m) => m.member.userId === userId)?.meetingUrl;
    expect(urlOf(people.staffA.id)).toBe(LINK_A);
    expect(urlOf(people.ownerA.id)).toBeNull();
    const rows = (await auditRows()).filter((r) => r.action === 'meeting_link.set');
    expect(rows.map((r) => r.metadata)).toEqual([
      { userId: people.staffA.id, set: true },
      { userId: people.staffA.id, set: false },
      { userId: people.staffA.id, set: true },
    ]);
  });

  it('Staff cannot set another member’s (403); Owner and Admin can', async () => {
    expectError(await setLink(people.staffA2.id, LINK_A2, people.staffA), 403, 'FORBIDDEN');
    expect(exact(MemberAvailability, await setLink(people.staffA2.id, CUSTOM)).meetingUrl).toBe(
      CUSTOM,
    );
    const byAdmin = await setLink(people.staffA2.id, LINK_A2, people.adminA);
    expect(exact(MemberAvailability, byAdmin).meetingUrl).toBe(LINK_A2);
    expect((await setLink(people.staffA.id, null, people.clientA)).status).toBe(403);
  });

  it('takes only an https link to a domain on the default port, without credentials (400)', async () => {
    for (const meetingUrl of [
      'http://zoom.us/j/1',
      'https://10.0.0.1/j/1',
      'https://[::1]/j/1',
      'https://zoom.us:8443/j/1',
      'https://user:pass@zoom.us/j/1',
      'https://zoom.us/j/1\tx',
      'zoom.us/j/1',
      `https://zoom.us/${'x'.repeat(500)}`,
    ]) {
      expectError(await setLink(people.staffA.id, meetingUrl), 400, 'VALIDATION_FAILED');
    }
    const extra = await call(
      'put',
      `/availability/${people.staffA.id}/meeting-link`,
      people.ownerA,
      {
        meetingUrl: LINK_A,
        userId: people.staffA2.id,
      },
    );
    expectError(extra, 400, 'VALIDATION_FAILED');
    expectError(await setLink('not-a-uuid', LINK_A), 400, 'VALIDATION_FAILED');
  });

  it('is 404 for a former member, another firm’s member or no one; firms never share links', async () => {
    for (const userId of [people.formerA.id, people.ownerB.id, randomUUID()]) {
      expectError(await setLink(userId, LINK_A), 404, 'NOT_FOUND');
    }
    const b = exact(
      Availability,
      await call('get', '/availability', people.ownerB, undefined, ids.firmB),
    );
    expect(b.members.map((m) => [m.member.userId, m.meetingUrl])).toEqual([
      [people.ownerB.id, null],
    ]);
    expect(links.links.size).toBe(2);
  });
});

describe('the link in appointments', () => {
  it('a VIDEO booking by staff without details gets the staff member’s link; details or another kind keep theirs', async () => {
    const copied = await book(
      {
        clientId: ids.c1,
        staffUserId: people.staffA.id,
        typeId: video.id,
        startsAt: at(3, '09:00'),
      },
      people.staffA,
    );
    expect(copied.locationDetails).toBe(LINK_A);
    const typed = await book({
      clientId: ids.c2,
      staffUserId: people.staffA.id,
      typeId: video.id,
      startsAt: at(3, '10:00'),
      locationDetails: CUSTOM,
    });
    expect(typed.locationDetails).toBe(CUSTOM);
    const office = await book({
      clientId: ids.c2,
      staffUserId: people.staffA.id,
      typeId: inPerson.id,
      startsAt: at(3, '11:00'),
    });
    expect([office.locationKind, office.locationDetails]).toEqual(['IN_PERSON', null]);
    const none = await book({
      clientId: ids.c2,
      staffUserId: people.ownerA.id,
      typeId: video.id,
      startsAt: at(3, '09:00'),
    });
    expect(none.locationDetails).toBeNull();
  });

  it('a client’s portal booking gets the chosen staff member’s link', async () => {
    const mine = exact(
      MyAppointment,
      await portal('post', '', people.clientA, { typeId: video.id, startsAt: at(4, '09:00') }),
      201,
    );
    expect([mine.staffName, mine.locationDetails]).toEqual(['Fake R14m staffA', LINK_A]);
  });

  it('a change of staff member swaps a copied or empty link and keeps a custom one', async () => {
    const copied = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: video.id,
      startsAt: at(5, '09:00'),
    });
    const moved = exact(
      Appointment,
      await call('post', `/appointments/${copied.id}/reschedule`, people.ownerA, {
        startsAt: at(5, '09:00'),
        staffUserId: people.staffA2.id,
      }),
    );
    expect(moved.locationDetails).toBe(LINK_A2);
    const custom = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: video.id,
      startsAt: at(5, '10:00'),
      locationDetails: CUSTOM,
    });
    const kept = exact(
      Appointment,
      await call('post', `/appointments/${custom.id}/reschedule`, people.ownerA, {
        startsAt: at(5, '10:00'),
        staffUserId: people.staffA2.id,
      }),
    );
    expect(kept.locationDetails).toBe(CUSTOM);
    const empty = await book({
      clientId: ids.c1,
      staffUserId: people.ownerA.id,
      typeId: video.id,
      startsAt: at(5, '11:00'),
    });
    const filled = exact(
      Appointment,
      await call('post', `/appointments/${empty.id}/reschedule`, people.ownerA, {
        startsAt: at(5, '11:00'),
        staffUserId: people.staffA.id,
      }),
    );
    expect(filled.locationDetails).toBe(LINK_A);
  });

  it('a portal reschedule to another staff member swaps the link; another client gets 404', async () => {
    const mine = exact(
      MyAppointment,
      await portal('post', '', people.clientA, { typeId: video.id, startsAt: at(6, '09:00') }),
      201,
    );
    expect(mine.locationDetails).toBe(LINK_A);
    expectError(
      await portal('post', `/${mine.id}/reschedule`, people.clientA2, { startsAt: at(6, '13:00') }),
      404,
      'NOT_FOUND',
    );
    // Only staffA2 works 13:00-14:00.
    const moved = exact(
      MyAppointment,
      await portal('post', `/${mine.id}/reschedule`, people.clientA, { startsAt: at(6, '13:00') }),
    );
    expect([moved.staffName, moved.locationDetails]).toEqual(['Fake R14m staffA2', LINK_A2]);
  });
});

describe('Edit location (PATCH /business/appointments/{id})', () => {
  it('changes the kind and details, audits field names only and sends the changed notice', async () => {
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: video.id,
      startsAt: at(7, '09:00'),
    });
    outbox.length = 0;
    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/appointments/${a.id}`, who, body);
    const custom = exact(Appointment, await patch({ locationDetails: CUSTOM }, people.staffA));
    expect([custom.locationKind, custom.locationDetails, custom.startsAt]).toEqual([
      'VIDEO',
      CUSTOM,
      a.startsAt,
    ]);
    const office = exact(Appointment, await patch({ locationKind: 'IN_PERSON' }));
    expect([office.locationKind, office.locationDetails]).toEqual(['IN_PERSON', null]);
    const named = exact(Appointment, await patch({ locationDetails: 'LVP Office (fake)' }));
    expect(named.locationDetails).toBe('LVP Office (fake)');
    // Back to VIDEO with details left out: the staff member's link.
    const back = exact(Appointment, await patch({ locationKind: 'VIDEO' }));
    expect([back.locationKind, back.locationDetails]).toEqual(['VIDEO', LINK_A]);
    // Nothing changed writes nothing.
    exact(Appointment, await patch({ locationDetails: LINK_A }));
    const rows = (await auditRows()).filter(
      (r) => r.action === 'appointment.location_changed' && r.entityId === a.id,
    );
    expect(rows.map((r) => r.metadata)).toEqual([
      { clientId: ids.c1, fields: ['locationDetails'], detailsSet: true },
      { clientId: ids.c1, fields: ['locationKind', 'locationDetails'], detailsSet: false },
      { clientId: ids.c1, fields: ['locationDetails'], detailsSet: true },
      { clientId: ids.c1, fields: ['locationKind', 'locationDetails'], detailsSet: true },
    ]);
    expect(outbox.map((m) => [m.template, m.to])).toEqual(
      Array(4).fill(['appointment.changed', people.clientA.email]),
    );
    const cleared = exact(Appointment, await patch({ locationDetails: '' }));
    expect(cleared.locationDetails).toBeNull();
  });

  it('is 404 for another firm’s appointment or one Staff do not see in full; 409 when closed; 400 empty', async () => {
    expectError(
      await call('patch', `/appointments/${ids.apptB}`, people.ownerA, { locationDetails: CUSTOM }),
      404,
      'NOT_FOUND',
    );
    const a = await book({
      clientId: ids.c1,
      staffUserId: people.staffA.id,
      typeId: video.id,
      startsAt: at(8, '09:00'),
    });
    expectError(
      await call(
        'patch',
        `/appointments/${a.id}`,
        people.ownerB,
        { locationDetails: CUSTOM },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/appointments/${a.id}`, people.staffA2, { locationDetails: CUSTOM }),
      404,
      'NOT_FOUND',
    );
    for (const body of [{}, { startsAt: at(8, '10:00') }, { locationKind: 'ONLINE' }]) {
      expectError(
        await call('patch', `/appointments/${a.id}`, people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    await call('post', `/appointments/${a.id}/cancel`, people.ownerA, {});
    expectError(
      await call('patch', `/appointments/${a.id}`, people.ownerA, { locationDetails: CUSTOM }),
      409,
      'APPOINTMENT_CLOSED',
    );
    const b = await asOwner(ids.firmB, (tx) =>
      tx.appointment.findUniqueOrThrow({
        where: { id: ids.apptB },
        select: { locationDetails: true },
      }),
    );
    expect(b.locationDetails).toBeNull();
    expect(
      await asOwner(ids.firmB, (tx) => tx.auditLog.count({ where: { businessId: ids.firmB } })),
    ).toBe(0);
  });
});

describe('links never leave the firm workspace and the portal', () => {
  it('no audit row and no notice holds a link', async () => {
    const rows = JSON.stringify(await auditRows());
    const sent = JSON.stringify(outbox);
    for (const link of [LINK_A, LINK_A2, CUSTOM, `fakeA${run}`]) {
      expect(rows).not.toContain(link);
      expect(sent).not.toContain(link);
    }
    expect(outbox.length).toBeGreaterThan(0);
  });
});

describe('until R0’s memberships.meeting_url', () => {
  it('the real binding reads no links and answers 503 MEETING_LINKS_UNAVAILABLE on PUT', async () => {
    const real = await startApp(env, false);
    try {
      const res = await call(
        'put',
        `/availability/${people.staffA.id}/meeting-link`,
        people.ownerA,
        { meetingUrl: LINK_A },
        ids.firmA,
        real,
      );
      expectError(res, 503, 'MEETING_LINKS_UNAVAILABLE');
      const all = exact(
        Availability,
        await call('get', '/availability', people.ownerA, undefined, ids.firmA, real),
      );
      expect(all.members.every((m) => m.meetingUrl === null)).toBe(true);
    } finally {
      await real.close();
    }
  });
});
