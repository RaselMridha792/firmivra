// End-to-end: R55, Appointments A1 (group appointments). Schedule Appointment and Edit Existing
// name other clients of the firm who attend; staff see them all on the record. Each attendee is
// checked as the client is (another firm's client or one a Staff member does not see is 404, an
// archived one 409) and is double booked as the client would be. In the portal an attendee sees
// the appointment read only (time, method, place, staff, the firm's instructions), never who else
// attends; each notice goes to one person with their own name only. A client who does not attend,
// and the attendee through another firm's portal, never see it (404 on a change). Synthetic data only.
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
  ConflictResult,
  MyAppointment,
  MyAppointmentList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
/** No daylight saving, so firm-local times are exact on any day. */
const TZ = 'Asia/Kolkata';
const person = (key: string) => ({ id: randomUUID(), email: `r55a1-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
  /** The primary client's login. */
  primary: person('primary'),
  /** An attendee's login. */
  guest: person('guest'),
  /** A client login of firm B. */
  clientB: person('client-b'),
  /** A client of firm A who attends nothing. */
  outsider: person('outsider'),
};
type Key = keyof typeof people;
const CLIENT_LOGINS: readonly Key[] = ['primary', 'guest', 'outsider', 'clientB'];
const NAMES = {
  primary: 'Jamie Primary (fake)',
  guest: 'Riley Guest (fake)',
  second: 'Casey Second (fake)',
  outsider: 'Drew Outsider (fake)',
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r55a1-a-${run}`,
  slugB: `r55a1-b-${run}`,
  primary: '',
  guest: '',
  /** An attendee without a login: their notice goes to the client record's email. */
  second: '',
  outsider: '',
  /** Assigned to no one, so staffA does not see them. */
  unassigned: '',
  archived: '',
  clientB: '',
  typeA: '',
};

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.53.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
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
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

/** A portal route of the signed-in client: /api/v1/portal/{slug}/me/appointments... */
async function portal(
  method: 'get' | 'post',
  path: string,
  who: Who,
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/appointments${path}`)
    .set('authorization', `Bearer ${token}`)
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
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, addDays(today, n), minutesOf(time))).toISOString();
/** A day of its own for each test that books, so no two overlap. */
let nextDay = 30;
const freshDay = () => (nextDay += 1);

const schedule = (extra: object = {}) => {
  const d = freshDay();
  return {
    idempotencyKey: randomUUID(),
    contact: { kind: 'CLIENT', id: ids.primary },
    typeId: ids.typeA,
    startsAt: at(d, '10:00'),
    endsAt: at(d, '10:30'),
    method: 'VIDEO',
    staffUserIds: [people.staffA.id],
    clientInstructions: 'Bring last year return (fake)',
    ...extra,
  };
};
const scheduled = async (extra: object = {}, who: Who = people.ownerA) =>
  exact(AppointmentRecord, await call('post', '/appointments/schedule', who, schedule(extra)));

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

const attendeeRows = (appointmentId: string) =>
  asOwner(ids.firmA, (tx) =>
    tx.appointmentAttendee.findMany({ where: { appointmentId }, select: { clientId: true } }),
  );

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
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: ids.slugA, status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: ids.slugB, status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: TZ } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    for (let weekday = 0; weekday < 7; weekday++) {
      await tx.workingHours.create({
        data: {
          ...A,
          userId: people.staffA.id,
          weekday,
          startsAt: new Date('1970-01-01T09:00:00Z'),
          endsAt: new Date('1970-01-01T17:00:00Z'),
        },
      });
    }
    const client = (displayName: string, assigned: boolean, extra: object = {}) =>
      tx.client.create({
        data: {
          ...A,
          displayName,
          assignedUserId: assigned ? people.staffA.id : null,
          email: `${displayName.split(' ')[0]?.toLowerCase()}-${run}@sample.test`,
          ...extra,
        },
      });
    ids.primary = (await client(NAMES.primary, true)).id;
    ids.guest = (await client(NAMES.guest, true)).id;
    ids.second = (await client(NAMES.second, true)).id;
    ids.outsider = (await client(NAMES.outsider, true)).id;
    ids.unassigned = (await client('Sam Unassigned (fake)', false)).id;
    ids.archived = (await client('Old Client (fake)', true, { archivedAt: new Date() })).id;
    for (const [key, clientId] of [
      ['primary', ids.primary],
      ['guest', ids.guest],
      ['outsider', ids.outsider],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: people[key].id,
          clientId,
          email: people[key].email,
          status: 'ACTIVE',
        },
      });
    }
    ids.typeA = (
      await tx.appointmentType.create({
        data: {
          ...A,
          name: `Group review ${run}`,
          durationMinutes: 30,
          clientBookable: true,
          meetingMethods: ['VIDEO', 'IN_PERSON', 'PHONE'],
        },
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

describe('Schedule Appointment with other attendees', () => {
  it('books them on the appointment; staff see each one, the client is never repeated', async () => {
    const before = outbox.length;
    const record = await scheduled({
      attendeeClientIds: [ids.guest, ids.second, ids.guest.toUpperCase(), ids.primary],
    });
    expect(record.attendees).toEqual([
      { id: ids.guest, name: NAMES.guest },
      { id: ids.second, name: NAMES.second },
    ]);
    expect((await attendeeRows(record.id)).map((r) => r.clientId).sort()).toEqual(
      [ids.guest, ids.second].sort(),
    );
    // The record as staff read it again.
    const again = exact(
      AppointmentRecord,
      await call('get', `/appointments/${record.id}/record`, people.staffA),
    );
    expect(again.attendees.map((a) => a.name)).toEqual([NAMES.guest, NAMES.second]);

    // One booked notice each, to their own address with their own name, naming no one else.
    const sent = outbox.slice(before).filter((m) => m.template === 'appointment.booked');
    expect(sent.map((m) => m.to).sort()).toEqual(
      [people.primary.email, people.guest.email, `casey-${run}@sample.test`].sort(),
    );
    for (const m of sent) {
      const text = JSON.stringify(m);
      const own =
        m.to === people.guest.email
          ? 'guest'
          : m.to === people.primary.email
            ? 'primary'
            : 'second';
      for (const [key, name] of Object.entries(NAMES)) {
        if (key !== own) expect(text, `${m.to} names ${key}`).not.toContain(name);
      }
    }

    // Audited with ids only.
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findFirst({
        where: { entityId: record.id, action: 'appointment.attendees_added' },
        select: { metadata: true },
      }),
    );
    expect(audit?.metadata).toEqual({
      clientId: ids.primary,
      attendeeClientIds: [ids.guest, ids.second],
    });
    expect(JSON.stringify(audit)).not.toContain('fake');
  });

  it('only the client is asked to confirm a booking the firm made; an attendee is never asked', async () => {
    const before = outbox.length;
    await scheduled({ status: 'PENDING', attendeeClientIds: [ids.guest] });
    const asks = outbox
      .slice(before)
      .filter((m) => m.template === 'appointment.booked')
      .map((m) => [m.to, (m.data as { confirmAsk?: boolean }).confirmAsk]);
    expect(asks.sort()).toEqual(
      [
        [people.guest.email, false],
        [people.primary.email, true],
      ].sort(),
    );
  });

  it("refuses another firm's client, one the Staff member does not see, an archived one and more than 20", async () => {
    const count = () =>
      asOwner(ids.firmA, (tx) => tx.appointment.count({ where: { businessId: ids.firmA } }));
    const n = await count();
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ attendeeClientIds: [ids.clientB] }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.staffA,
        schedule({ attendeeClientIds: [ids.unassigned] }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.ownerA,
        schedule({ attendeeClientIds: [ids.archived] }),
      ),
      409,
      'CLIENT_ARCHIVED',
    );
    const many = Array.from({ length: 21 }, () => randomUUID());
    const tooMany = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({ attendeeClientIds: many }),
    );
    expect(tooMany.status, JSON.stringify(tooMany.body)).toBe(400);
    expect(await count()).toBe(n);
    // The Owner sees every client of the firm, so the unassigned one may attend.
    const record = await scheduled({ attendeeClientIds: [ids.unassigned] });
    expect(record.attendees.map((a) => a.id)).toEqual([ids.unassigned]);
  });

  it('an attendee is double booked as the client would be, both ways (409, the check agrees)', async () => {
    const group = await scheduled({ attendeeClientIds: [ids.guest] });
    // The guest as the client of a new appointment at the same time, with another staff member.
    const clash = await call('post', '/appointments/schedule', people.ownerA, {
      ...schedule({ contact: { kind: 'CLIENT', id: ids.guest } }),
      startsAt: group.startsAt,
      endsAt: group.endsAt,
      staffUserIds: [people.ownerA.id],
      overrideConflicts: { reason: 'Fake: the owner keeps no hours' },
    });
    expectError(clash, 409, 'SCHEDULING_CONFLICT');
    expect(JSON.stringify(clash.body)).toContain('CLIENT_DOUBLE_BOOKED');
    // The outsider's own appointment then; adding them as an attendee is refused too.
    const check = exact(
      ConflictResult,
      await call('post', '/appointments/conflicts', people.ownerA, {
        staffUserIds: [people.ownerA.id],
        startsAt: group.startsAt,
        endsAt: group.endsAt,
        contact: { kind: 'CLIENT', id: ids.outsider },
        attendeeClientIds: [ids.guest],
      }),
    );
    expect(check.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'CLIENT_DOUBLE_BOOKED',
          message: 'An attendee already has an appointment at this time',
        }),
      ]),
    );
    // Another firm's client in the check is 404, as in a booking.
    expectError(
      await call('post', '/appointments/conflicts', people.ownerA, {
        staffUserIds: [people.staffA.id],
        startsAt: group.startsAt,
        endsAt: group.endsAt,
        attendeeClientIds: [ids.clientB],
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('a draft and a duplicate keep them, by name; another firm’s client in a draft is 404', async () => {
    const draft = exact(
      AppointmentDraft,
      await call('post', '/appointment-drafts', people.ownerA, {
        contact: { kind: 'CLIENT', id: ids.primary },
        attendeeClientIds: [ids.guest],
      }),
      201,
    );
    expect(draft.data).toMatchObject({ attendeeClientIds: [ids.guest] });
    // Reopened, the form gets their names back.
    const reopened = exact(
      AppointmentDraft,
      await call('get', `/appointment-drafts/${draft.id}`, people.ownerA),
    );
    expect(reopened.attendees).toEqual([{ id: ids.guest, name: NAMES.guest }]);
    // Duplicate opens a new form with the same attendees.
    const record = await scheduled({ attendeeClientIds: [ids.second] });
    const copy = exact(
      AppointmentDraft,
      await call('post', `/appointments/${record.id}/duplicate`, people.ownerA),
    );
    expect(copy.data).toMatchObject({ attendeeClientIds: [ids.second] });
    expect(copy.attendees).toEqual([{ id: ids.second, name: NAMES.second }]);
    expectError(
      await call('post', '/appointment-drafts', people.ownerA, {
        contact: { kind: 'CLIENT', id: ids.primary },
        attendeeClientIds: [ids.clientB],
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('Edit Existing', () => {
  it('replaces the attendees: a new one hears of the booking, the removed one is gone', async () => {
    const record = await scheduled({ attendeeClientIds: [ids.guest] });
    const before = outbox.length;
    const edited = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${record.id}/details`, people.ownerA, {
        version: record.version,
        attendeeClientIds: [ids.second],
      }),
    );
    expect(edited.attendees).toEqual([{ id: ids.second, name: NAMES.second }]);
    expect(edited.version).not.toBe(record.version);
    const sent = outbox.slice(before);
    expect(sent.map((m) => [m.template, m.to])).toEqual([
      ['appointment.booked', `casey-${run}@sample.test`],
    ]);
    const actions = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: record.id, action: { startsWith: 'appointment.attendees_' } },
        select: { action: true, metadata: true },
      }),
    );
    // The booking's own row, then the edit's two.
    expect(actions).toHaveLength(3);
    expect(actions).toEqual(
      expect.arrayContaining([
        {
          action: 'appointment.attendees_removed',
          metadata: { clientId: ids.primary, attendeeClientIds: [ids.guest] },
        },
        {
          action: 'appointment.attendees_added',
          metadata: { clientId: ids.primary, attendeeClientIds: [ids.second] },
        },
      ]),
    );

    // Left out, they stay; a new time reaches the client and the attendee, each on their own.
    const later = outbox.length;
    const d = freshDay();
    const moved = exact(
      AppointmentRecord,
      await call('patch', `/appointments/${record.id}/details`, people.ownerA, {
        version: edited.version,
        startsAt: at(d, '11:00'),
        endsAt: at(d, '11:30'),
      }),
    );
    expect(moved.attendees.map((a) => a.id)).toEqual([ids.second]);
    expect(
      outbox
        .slice(later)
        .map((m) => [m.template, m.to])
        .sort(),
    ).toEqual(
      [
        ['appointment.changed', people.primary.email],
        ['appointment.changed', `casey-${run}@sample.test`],
      ].sort(),
    );
  });

  it("another firm's client as a new attendee is 404 and changes nothing", async () => {
    const record = await scheduled({ attendeeClientIds: [ids.guest] });
    expectError(
      await call('patch', `/appointments/${record.id}/details`, people.ownerA, {
        version: record.version,
        attendeeClientIds: [ids.guest, ids.clientB],
      }),
      404,
      'NOT_FOUND',
    );
    expect((await attendeeRows(record.id)).map((r) => r.clientId)).toEqual([ids.guest]);
    // Firm B cannot read or change firm A's appointment at all.
    expectError(
      await call('get', `/appointments/${record.id}/record`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
  });
});

describe('the client portal', () => {
  it('the attendee sees it read only, with the firm instructions and never who else attends', async () => {
    const record = await scheduled({ attendeeClientIds: [ids.guest, ids.second] });
    const list = exact(MyAppointmentList, await portal('get', '?when=upcoming', people.guest));
    const mine = list.items.find((a) => a.id === record.id);
    expect(mine).toMatchObject({
      attending: true,
      changeableUntil: null,
      staffName: 'Fake R55 staffA',
      instructions: 'Bring last year return (fake)',
      locationKind: 'VIDEO',
    });
    const text = JSON.stringify(list);
    for (const name of [NAMES.primary, NAMES.second, NAMES.outsider]) {
      expect(text).not.toContain(name);
    }
    for (const id of [ids.primary, ids.second]) expect(text).not.toContain(id);

    // The client's own copy says it is theirs.
    const own = exact(MyAppointmentList, await portal('get', '?when=upcoming', people.primary));
    expect(own.items.find((a) => a.id === record.id)).toMatchObject({ attending: false });
    expect(own.items.find((a) => a.id === record.id)?.changeableUntil).not.toBeNull();

    // Only its own client changes it.
    expectError(await portal('post', `/${record.id}/cancel`, people.guest, {}), 404, 'NOT_FOUND');
    expectError(
      await portal('post', `/${record.id}/reschedule`, people.guest, {
        startsAt: at(freshDay(), '10:00'),
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('a client who does not attend, and the attendee in another firm’s portal, never see it', async () => {
    const record = await scheduled({ attendeeClientIds: [ids.guest] });
    const outsider = exact(
      MyAppointmentList,
      await portal('get', '?when=upcoming', people.outsider),
    );
    expect(outsider.items.map((a) => a.id)).not.toContain(record.id);
    expectError(
      await portal('post', `/${record.id}/cancel`, people.outsider, {}),
      404,
      'NOT_FOUND',
    );
    // Through firm B's portal: the guest's login is not firm B's (refused), and firm B's own
    // client finds nothing of it (404 on a change).
    for (const path of ['?when=upcoming', `/${record.id}/cancel`]) {
      const res = await portal(
        path.startsWith('?') ? 'get' : 'post',
        path,
        people.guest,
        path.startsWith('?') ? undefined : {},
        ids.slugB,
      );
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toContain(record.id);
    }
    const inB = exact(
      MyAppointmentList,
      await portal('get', '?when=upcoming', people.clientB, undefined, ids.slugB),
    );
    expect(inB.items.map((a) => a.id)).not.toContain(record.id);
    expectError(
      await portal('post', `/${record.id}/cancel`, people.clientB, {}, ids.slugB),
      404,
      'NOT_FOUND',
    );
  });

  it('the attendee cannot book themselves into the time they attend (409 SLOT_TAKEN)', async () => {
    // With the Owner (no working hours, overridden), so staffA is free to take the portal booking.
    const record = await scheduled({
      attendeeClientIds: [ids.guest],
      staffUserIds: [people.ownerA.id],
      overrideConflicts: { reason: 'Fake: the owner keeps no hours' },
    });
    const res = await portal('post', '', people.guest, {
      typeId: ids.typeA,
      startsAt: record.startsAt,
    });
    expectError(res, 409, 'SLOT_TAKEN');
    // A free time still books, and it is the guest's own.
    const d = freshDay();
    const booked = exact(
      MyAppointment,
      await portal('post', '', people.guest, { typeId: ids.typeA, startsAt: at(d, '14:00') }),
      201,
    );
    expect(booked.attending).toBe(false);
  });
});

describe('booking from a package’s page (S12)', () => {
  /** A package of firm A whose Booking type is the group review type, live or not. */
  async function packageOf(name: string, live: boolean) {
    const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    try {
      return await runInScope(
        db,
        { kind: 'business', businessId: ids.firmA },
        async (tx) =>
          (
            await tx.servicePackage.create({
              data: {
                businessId: ids.firmA,
                name,
                shortDescription: 'Fake package',
                status: 'ACTIVE',
                packagePriceCents: 10_000,
                visibleToClients: live,
                displayOnPortal: live,
                appointmentTypeId: ids.typeA!,
              },
            })
          ).id,
      );
    } finally {
      await db.$disconnect();
    }
  }
  async function notesOf(id: string) {
    const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    try {
      return await runInScope(db, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.appointment.findUniqueOrThrow({ where: { id }, select: { internalNotes: true } }),
      );
    } finally {
      await db.$disconnect();
    }
  }

  it('names a live package in the firm’s staff notes, never in what the client gets back', async () => {
    const live = await packageOf(`Family bundle ${run}`, true);
    const res = await portal('post', '', people.guest, {
      typeId: ids.typeA,
      startsAt: at(freshDay(), '14:00'),
      packageId: live,
    });
    const booked = exact(MyAppointment, res, 201);
    expect(JSON.stringify(res.body)).not.toContain('Family bundle');
    expect((await notesOf(booked.id)).internalNotes).toBe(
      `Booked from the package "Family bundle ${run}".`,
    );
  });

  it('books as usual, without a note, for a package that is not live', async () => {
    const hidden = await packageOf(`Hidden bundle ${run}`, false);
    const booked = exact(
      MyAppointment,
      await portal('post', '', people.guest, {
        typeId: ids.typeA,
        startsAt: at(freshDay(), '14:00'),
        packageId: hidden,
      }),
      201,
    );
    expect((await notesOf(booked.id)).internalNotes).toBeNull();
  });
});
