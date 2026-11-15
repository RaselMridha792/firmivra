// End-to-end: R55, Appointments A3 (the waitlist for an earlier time). The firm's switch and its
// one mode; a client waits for one of their own appointments; the job offers an earlier opening to
// one entry at a time (never the same time to two), only to clients whose portal access is active,
// by a bell item and an email that holds the times only; taking it moves the appointment at once or
// asks staff, after the time is checked again (409 OFFER_TAKEN and back to WAITING when it went).
// The original time stands until the move. Another client or firm gets 404. Synthetic data only.
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
  MyWaitlist,
  MyWaitlistEntry,
  WaitlistEntry,
  WaitlistEntryList,
  WaitlistSettings,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { WaitlistJob } from '../../src/appointments/waitlist.job.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
/** No daylight saving, so firm-local times are exact on any day. */
const TZ = 'Asia/Kolkata';
const person = (key: string) => ({ id: randomUUID(), email: `r55a3-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  /** Sees in full none of these appointments. */
  staffA2: person('staff-a2'),
  ownerB: person('owner-b'),
  c1: person('c1'),
  c2: person('c2'),
  locked: person('locked'),
  disabled: person('disabled'),
  clientB: person('client-b'),
};
type Key = keyof typeof people;
const CLIENT_LOGINS: readonly Key[] = ['c1', 'c2', 'locked', 'disabled', 'clientB'];
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r55a3-a-${run}`,
  slugB: `r55a3-b-${run}`,
  c1: '',
  c2: '',
  locked: '',
  disabled: '',
  clientB: '',
  typeA: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.54.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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
async function firm(
  method: 'get' | 'post' | 'put',
  path: string,
  who: Who = people.ownerA,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/appointment-waitlist${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
async function portal(
  method: 'get' | 'post',
  path: string,
  who: Who,
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/appointment-waitlist${path}`)
    .set('authorization', `Bearer ${token}`)
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

const today = zonedDate(TZ, Date.now());
const at = (n: number, time: string) => zonedInstant(TZ, addDays(today, n), minutesOf(time));
const iso = (ms: number) => new Date(ms).toISOString();

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

/** An appointment of staffA, written straight to the database (its own rules still apply). */
const seed = (clientId: string, day: number, time: string, extra: object = {}) =>
  asOwner(ids.firmA, async (tx) => {
    const start = at(day, time);
    const row = await tx.appointment.create({
      data: {
        businessId: ids.firmA,
        clientId,
        staffUserId: people.staffA.id,
        typeId: ids.typeA,
        startsAt: new Date(start),
        endsAt: new Date(start + 30 * 60_000),
        locationKind: 'VIDEO',
        bookedByUserId: people.ownerA.id,
        ...extra,
      },
      select: { id: true },
    });
    return row.id;
  });
const appointmentAt = (id: string) =>
  asOwner(ids.firmA, (tx) =>
    tx.appointment.findUniqueOrThrow({ where: { id }, select: { startsAt: true } }),
  ).then((a) => a.startsAt.toISOString());
const setMode = async (enabled: boolean, mode: 'AUTO_CONFIRM' | 'STAFF_APPROVAL') =>
  exact(WaitlistSettings, await firm('put', '/settings', people.ownerA, { enabled, mode }));
const join = async (who: Who, appointmentId: string) =>
  exact(MyWaitlistEntry, await portal('post', '', who, { appointmentId }), 201);
/** The job, as if it ran on `day` at 06:00 firm time: offers start from 08:00 that day. */
const runJob = (day: number) =>
  app.get(WaitlistJob).run({ businessIds: [ids.firmA], now: new Date(at(day, '06:00')) });
const mineOf = async (who: Who, id: string) =>
  exact(MyWaitlist, await portal('get', '', who)).items.find((e) => e.id === id);

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
          name: `Fake R55 ${key}`,
        },
      });
    }
    for (const [key, slug] of [
      ['firmA', ids.slugA],
      ['firmB', ids.slugB],
    ] as const) {
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: TZ } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    // staffA works 09:00 to 12:00 every day.
    for (let weekday = 0; weekday < 7; weekday++) {
      await tx.workingHours.create({
        data: {
          ...A,
          userId: people.staffA.id,
          weekday,
          startsAt: new Date('1970-01-01T09:00:00Z'),
          endsAt: new Date('1970-01-01T12:00:00Z'),
        },
      });
    }
    const client = async (key: 'c1' | 'c2' | 'locked' | 'disabled', status = 'ACTIVE' as const) => {
      const c = await tx.client.create({
        data: { ...A, displayName: `Fake ${key} client`, assignedUserId: people.staffA.id },
      });
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: people[key].id,
          clientId: c.id,
          email: people[key].email,
          status: key === 'disabled' ? 'DISABLED' : status,
        },
      });
      return c.id;
    };
    ids.c1 = await client('c1');
    ids.c2 = await client('c2');
    ids.locked = await client('locked');
    ids.disabled = await client('disabled');
    await tx.clientPortalLock.create({
      data: { ...A, clientId: ids.locked, lockedByUserId: people.ownerA.id },
    });
    ids.typeA = (
      await tx.appointmentType.create({
        data: { ...A, name: `Review ${run}`, durationMinutes: 30, clientBookable: true },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: 'B Client (fake)' } })).id;
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: ids.clientB,
        email: people.clientB.email,
        status: 'ACTIVE',
      },
    });
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

describe('the firm’s switch and mode', () => {
  it('is off until an Owner or Admin turns it on; Staff may not; a client cannot join while off', async () => {
    expect(exact(WaitlistSettings, await firm('get', '/settings'))).toEqual({
      enabled: false,
      mode: 'STAFF_APPROVAL',
    });
    const appt = await seed(ids.c1, 10, '10:00');
    expectError(await portal('post', '', people.c1, { appointmentId: appt }), 409, 'WAITLIST_OFF');
    const staff = await firm('put', '/settings', people.staffA, {
      enabled: true,
      mode: 'AUTO_CONFIRM',
    });
    expect(staff.status, JSON.stringify(staff.body)).toBe(403);
    expect(await setMode(true, 'AUTO_CONFIRM')).toEqual({ enabled: true, mode: 'AUTO_CONFIRM' });
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'appointment_waitlist.settings_updated' },
        select: { metadata: true },
      }),
    );
    expect(audit?.metadata).toEqual({ enabled: true, mode: 'AUTO_CONFIRM' });
  });
});

describe('joining', () => {
  it('only the client of a scheduled appointment waits, once; another client or firm gets 404', async () => {
    const appt = await seed(ids.c1, 12, '10:00');
    const entry = await join(people.c1, appt);
    expect(entry).toMatchObject({ appointmentId: appt, status: 'WAITING', offer: null });
    expectError(
      await portal('post', '', people.c1, { appointmentId: appt }),
      409,
      'ALREADY_WAITING',
    );
    expectError(await portal('post', '', people.c2, { appointmentId: appt }), 404, 'NOT_FOUND');
    expectError(
      await portal('post', '', people.clientB, { appointmentId: appt }, ids.slugB),
      404,
      'NOT_FOUND',
    );
    // The client sees it; staff see it with the client's name; another member never.
    expect(await mineOf(people.c1, entry.id)).toMatchObject({ status: 'WAITING' });
    expect((await mineOf(people.c2, entry.id)) ?? null).toBeNull();
    const list = exact(WaitlistEntryList, await firm('get', ''));
    expect(list.items.find((e) => e.id === entry.id)).toMatchObject({
      client: { id: ids.c1, name: 'Fake c1 client' },
      staffName: 'Fake R55 staffA',
      startsAt: iso(at(12, '10:00')),
    });
    const theirs = exact(WaitlistEntryList, await firm('get', '', people.staffA2));
    expect(theirs.items.map((e) => e.id)).not.toContain(entry.id);
    // Leaving ends it; a second leave is 409.
    expect(
      exact(MyWaitlistEntry, await portal('post', `/${entry.id}/leave`, people.c1)).status,
    ).toBe('LEFT');
    expectError(
      await portal('post', `/${entry.id}/leave`, people.c1),
      409,
      'WAITLIST_ENTRY_CLOSED',
    );
  });
});

describe('the job’s offers', () => {
  it('offers one time to one entry, by Portal and an email of times only, never to a locked or inactive client', async () => {
    const day = 20;
    const secret = 'Private planning note (fake)';
    const a1 = await seed(ids.c1, day + 2, '10:00', {
      internalNotes: secret,
      clientInstructions: 'Bring the folder (fake)',
    });
    const a2 = await seed(ids.c2, day + 2, '11:00');
    const aLocked = await seed(ids.locked, day + 2, '09:00');
    const aDisabled = await seed(ids.disabled, day + 3, '09:00');
    const e1 = await join(people.c1, a1);
    const e2 = await join(people.c2, a2);
    // The locked and the inactive clients cannot sign in: their entries are written directly.
    const [eLocked, eDisabled] = await asOwner(ids.firmA, async (tx) => [
      (
        await tx.appointmentWaitlistEntry.create({
          data: { businessId: ids.firmA, appointmentId: aLocked, clientId: ids.locked },
        })
      ).id,
      (
        await tx.appointmentWaitlistEntry.create({
          data: { businessId: ids.firmA, appointmentId: aDisabled, clientId: ids.disabled },
        })
      ).id,
    ]);
    const before = outbox.length;
    const result = await runJob(day);
    expect(result).toMatchObject({ skipped: false, offered: 2 });

    // The oldest entry gets the first opening; the next one another time, never the same.
    const o1 = (await mineOf(people.c1, e1.id))?.offer;
    const o2 = (await mineOf(people.c2, e2.id))?.offer;
    expect(o1?.startsAt).toBe(iso(at(day, '09:00')));
    expect(o2?.startsAt).toBe(iso(at(day, '09:30')));
    const states = await asOwner(ids.firmA, (tx) =>
      tx.appointmentWaitlistEntry.findMany({
        where: { id: { in: [eLocked, eDisabled] } },
        select: { status: true },
      }),
    );
    expect(states.map((s) => s.status)).toEqual(['WAITING', 'WAITING']);

    // The emails: one to each offered client, holding the times only.
    const sent = outbox.slice(before).filter((m) => m.template === 'appointment.waitlist-offer');
    expect(sent.map((m) => m.to).sort()).toEqual([people.c1.email, people.c2.email].sort());
    for (const m of sent) {
      expect(Object.keys(m.data as object).sort()).toEqual(
        ['expiresAt', 'link', 'name', 'offeredStartsAt', 'startsAt', 'timeZone'].sort(),
      );
      const text = JSON.stringify(m);
      for (const word of [secret, 'Bring the folder', `Review ${run}`, 'Fake R55 staffA']) {
        expect(text, `${m.to}: ${word}`).not.toContain(word);
      }
    }
    expect(
      outbox.slice(before).some((m) => [people.locked.email, people.disabled.email].includes(m.to)),
    ).toBe(false);
    // The bell item is the client's.
    const bell = await asOwner(ids.firmA, (tx) =>
      tx.notification.count({ where: { entityId: a1, recipientUserId: people.c1.id } }),
    );
    expect(bell).toBe(1);
    // A second run offers nothing new: both times are held.
    expect(await runJob(day)).toMatchObject({ offered: 0 });

    // AUTO_CONFIRM: taking it moves the appointment at once.
    const moved = exact(MyWaitlistEntry, await portal('post', `/${e1.id}/accept`, people.c1));
    expect(moved.status).toBe('MOVED');
    expect(await appointmentAt(a1)).toBe(iso(at(day, '09:00')));
    // The other turns it down; the entry ends.
    expect(
      exact(MyWaitlistEntry, await portal('post', `/${e2.id}/decline`, people.c2)).status,
    ).toBe('DECLINED');
    expect(await appointmentAt(a2)).toBe(iso(at(day + 2, '11:00')));
  });

  it('a time taken since the offer is 409 OFFER_TAKEN and the entry waits again', async () => {
    const day = 30;
    const appt = await seed(ids.c1, day + 2, '10:00');
    const entry = await join(people.c1, appt);
    await runJob(day);
    const offer = (await mineOf(people.c1, entry.id))?.offer;
    expect(offer?.startsAt).toBe(iso(at(day, '09:00')));
    // Someone else is booked at that time meanwhile.
    await seed(ids.c2, day, '09:00');
    expectError(await portal('post', `/${entry.id}/accept`, people.c1), 409, 'OFFER_TAKEN');
    expect(await mineOf(people.c1, entry.id)).toMatchObject({ status: 'WAITING', offer: null });
    expect(await appointmentAt(appt)).toBe(iso(at(day + 2, '10:00')));
    // The next run offers the next opening.
    await runJob(day);
    expect((await mineOf(people.c1, entry.id))?.offer?.startsAt).toBe(iso(at(day, '09:30')));
    await portal('post', `/${entry.id}/leave`, people.c1);
  });

  it('an offer not taken in time expires', async () => {
    const day = 40;
    const appt = await seed(ids.c1, day + 3, '10:00');
    const entry = await join(people.c1, appt);
    await runJob(day);
    expect((await mineOf(people.c1, entry.id))?.status).toBe('OFFERED');
    // Held until an hour before the 09:00 opening; the job runs again after that.
    expect((await mineOf(people.c1, entry.id))?.offer?.expiresAt).toBe(iso(at(day, '08:00')));
    await app.get(WaitlistJob).run({ businessIds: [ids.firmA], now: new Date(at(day, '08:30')) });
    expect((await mineOf(people.c1, entry.id))?.status).toBe('EXPIRED');
    expectError(
      await portal('post', `/${entry.id}/accept`, people.c1),
      409,
      'WAITLIST_ENTRY_CLOSED',
    );
  });
});

describe('STAFF_APPROVAL', () => {
  it('taking an offer asks staff; the time stands until they approve, or stays when they reject', async () => {
    await setMode(true, 'STAFF_APPROVAL');
    const day = 50;
    const a1 = await seed(ids.c1, day + 2, '10:00');
    const a2 = await seed(ids.c2, day + 2, '11:00');
    const e1 = await join(people.c1, a1);
    const e2 = await join(people.c2, a2);
    await runJob(day);
    for (const [who, e] of [
      [people.c1, e1],
      [people.c2, e2],
    ] as const) {
      expect(exact(MyWaitlistEntry, await portal('post', `/${e.id}/accept`, who)).status).toBe(
        'REQUESTED',
      );
    }
    expect(await appointmentAt(a1)).toBe(iso(at(day + 2, '10:00')));
    // Another firm, another client and a member who does not see it get 404.
    expectError(
      await firm('post', `/${e1.id}/approve`, people.ownerB, {}, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(await firm('post', `/${e1.id}/approve`, people.staffA2), 404, 'NOT_FOUND');
    expectError(await portal('post', `/${e1.id}/accept`, people.c2), 404, 'NOT_FOUND');

    const approved = exact(WaitlistEntry, await firm('post', `/${e1.id}/approve`, people.staffA));
    expect(approved).toMatchObject({ status: 'MOVED', startsAt: iso(at(day, '09:00')) });
    expect(await appointmentAt(a1)).toBe(iso(at(day, '09:00')));
    const rejected = exact(WaitlistEntry, await firm('post', `/${e2.id}/reject`));
    expect(rejected.status).toBe('REJECTED');
    expect(await appointmentAt(a2)).toBe(iso(at(day + 2, '11:00')));
    expectError(await firm('post', `/${e2.id}/approve`), 409, 'WAITLIST_ENTRY_CLOSED');
    const decided = await asOwner(ids.firmA, (tx) =>
      tx.appointmentWaitlistEntry.findUniqueOrThrow({
        where: { id: e1.id },
        select: { decidedByUserId: true },
      }),
    );
    expect(decided.decidedByUserId).toBe(people.staffA.id);
  });
});
