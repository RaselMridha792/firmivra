// End-to-end: P4-1 (Leads Review Two 26 and 17), appointments for leads. A lead's own appointment
// has a lead and no client; every response that names the client names the lead instead (the
// calendar, the agenda, the dashboard's Upcoming Appointments). Every response is parsed with the
// contract and must equal the body. Another firm's lead is 404. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  AgendaPage,
  AppointmentDetail,
  AppointmentList,
  AppointmentRecord,
  ClientTimelinePage,
  ConvertLeadToClientResult,
  DashboardSummary,
  LeadActivityPage,
  LeadAppointment,
  LeadMessageThreadList,
  LeadProfile,
  RemindersSent,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { addDays, minutesOf, zonedDate, zonedInstant } from '../../src/appointments/calendar.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const TZ = 'America/Chicago';
const person = (key: string) => ({ id: randomUUID(), email: `p41-${key}-${run}@p41.test` });
const people = {
  ownerA: person('owner-a'),
  /** The lead's own member (leads.assigned_user_id). */
  staffA: person('staff-a'),
  /** Neither the lead's member nor its appointment's. */
  staffB: person('staff-b'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  service: '',
  type: '',
  /** Assigned to staffA. */
  lead: '',
  leadB: '',
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
const at = (n: number, time: string) =>
  new Date(zonedInstant(TZ, addDays(today, n), minutesOf(time))).toISOString();
/** A day of its own for each test that books, so no two overlap. */
let nextDay = 3;
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

/** A lead of the pipeline (New Lead), straight to the database. */
async function newLead(
  name: string,
  extra: { assignedUserId?: string | null; businessId?: string; email?: string } = {},
): Promise<string> {
  const businessId = extra.businessId ?? ids.firmA;
  const [first, ...rest] = name.split(' ');
  return asOwner(businessId, async (tx) => {
    const service =
      businessId === ids.firmA
        ? ids.service
        : (
            await tx.service.create({
              data: { businessId, kind: 'OTHER', name: `B svc ${randomUUID().slice(0, 6)}` },
            })
          ).id;
    const row = await tx.lead.create({
      data: {
        businessId,
        serviceId: service,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        firstName: first ?? 'Fake',
        lastName: rest.join(' ') || 'Lead',
        email: extra.email ?? `lead-${randomUUID().slice(0, 8)}@p41.test`,
        phone: '+15550100777',
        assignedUserId: extra.assignedUserId === undefined ? null : extra.assignedUserId,
      },
      select: { id: true },
    });
    return row.id;
  });
}

/** A lead's own appointment written straight to the database (its rules still apply). */
async function seedLeadAppointment(leadId: string, day: number, staffId = people.staffA.id) {
  const start = new Date(at(day, '10:00'));
  return asOwner(ids.firmA, async (tx) => {
    const row = await tx.appointment.create({
      data: {
        businessId: ids.firmA,
        leadId,
        staffUserId: staffId,
        typeId: ids.type,
        startsAt: start,
        endsAt: new Date(start.getTime() + 30 * 60_000),
        locationKind: 'PHONE',
        bookedByUserId: people.ownerA.id,
      },
      select: { id: true },
    });
    return row.id;
  });
}

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
          name: `Fake P41 ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB'] as const) {
      const slug = `p41-${key.toLowerCase()}-${run}`;
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.businessSettings.create({ data: { ...A, timezone: TZ } });
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffB.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    for (const userId of [people.staffA.id, people.staffB.id, people.ownerA.id]) {
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
    ids.service = (
      await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
    ids.type = (
      await tx.appointmentType.create({
        data: {
          ...A,
          name: `Consult ${run}`,
          durationMinutes: 30,
          meetingMethods: ['PHONE', 'VIDEO', 'IN_PERSON'],
        },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
  });
  await owner.$disconnect();
  ids.lead = await newLead('Jordan Leadwell', { assignedUserId: people.staffA.id });
  ids.leadB = await newLead('Other Firmlead', { businessId: ids.firmB });

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

describe('contracts: a lead’s own appointment names its lead (item 1)', () => {
  it('the calendar, the detail and the agenda show the lead where the client was', async () => {
    const day = freshDay();
    const id = await seedLeadAppointment(ids.lead, day);
    const range = `from=${encodeURIComponent(at(day, '00:00'))}&to=${encodeURIComponent(at(day + 1, '00:00'))}`;

    const list = exact(AppointmentList, await call('get', `/appointments?${range}`, people.ownerA));
    const mine = list.items.find((a) => a.id === id);
    expect(mine).toMatchObject({
      restricted: false,
      client: null,
      lead: { id: ids.lead, name: 'Jordan Leadwell' },
    });

    const detail = exact(
      AppointmentDetail,
      await call('get', `/appointments/${id}`, people.ownerA),
    );
    expect(detail.client).toBeNull();
    expect(detail.lead).toEqual({ id: ids.lead, name: 'Jordan Leadwell' });

    const agenda = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.ownerA),
    );
    const entry = agenda.items.find((a) => a.id === id);
    expect(entry).toMatchObject({
      restricted: false,
      contact: { kind: 'LEAD', id: ids.lead, name: 'Jordan Leadwell', clientType: null },
    });
  });
});

// ---- item 2 ----
const schedule = (extra: object = {}, contactId = ids.lead) => ({
  idempotencyKey: randomUUID(),
  contact: { kind: 'LEAD', id: contactId },
  typeId: ids.type,
  startsAt: at(freshDay(), '10:00'),
  endsAt: at(nextDay, '10:30'),
  method: 'PHONE',
  staffUserIds: [people.ownerA.id],
  ...extra,
});
const book = async (extra: object = {}, who: Who = people.ownerA, contactId = ids.lead) =>
  exact(
    AppointmentRecord,
    await call('post', '/appointments/schedule', who, schedule(extra, contactId)),
  );
/** R12's answers to a change: the appointment without its history. */
const Changed = AppointmentDetail.omit({ history: true });

describe('booking a lead (item 2)', () => {
  it('books a lead that is not a client yet: no client, its lead, audited by id only', async () => {
    const record = await book();
    expect(record.contact).toMatchObject({ kind: 'LEAD', id: ids.lead, name: 'Jordan Leadwell' });
    const row = await asOwner(ids.firmA, (tx) =>
      tx.appointment.findUniqueOrThrow({
        where: { id: record.id },
        select: { clientId: true, leadId: true },
      }),
    );
    expect(row).toEqual({ clientId: null, leadId: ids.lead });
    const audit = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: ids.firmA, entityId: record.id, action: 'appointment.booked' },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toMatchObject({ clientId: null, leadId: ids.lead });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/Jordan|Leadwell|@p41\.test/);
    // The lead's own timeline has it, by the type's name.
    const activity = await asOwner(ids.firmA, (tx) =>
      tx.leadActivity.findFirst({
        where: { businessId: ids.firmA, leadId: ids.lead, kind: 'APPOINTMENT_SCHEDULED' },
        select: { summary: true },
      }),
    );
    expect(activity?.summary).toBe(`Consult ${run}`);
  });

  it('a lead is not double booked', async () => {
    const first = await book();
    const res = await call('post', '/appointments/schedule', people.ownerA, {
      ...schedule({ staffUserIds: [people.staffB.id] }),
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(['SCHEDULING_CONFLICT', 'SLOT_TAKEN']).toContain(codeOf(res));
  });

  it("refuses a tax return, a tax plan and other attendees on a lead's own appointment (400)", async () => {
    const other = randomUUID();
    for (const [extra, path] of [
      [{ related: { taxReturnId: other } }, 'related.taxReturnId'],
      [{ taxPlanId: other }, 'taxPlanId'],
      [{ attendeeClientIds: [other] }, 'attendeeClientIds'],
    ] as const) {
      const res = await call('post', '/appointments/schedule', people.ownerA, schedule(extra));
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain(path);
      expect(JSON.stringify(res.body)).toContain('Convert the lead');
    }
  });

  it('404 for another firm’s lead, an archived lead, and a lead a Staff member does not reach', async () => {
    expectError(
      await call('post', '/appointments/schedule', people.ownerA, schedule({}, ids.leadB)),
      404,
      'NOT_FOUND',
    );
    const archived = await newLead('Gone Archived', { assignedUserId: people.staffA.id });
    await asOwner(ids.firmA, (tx) =>
      tx.lead.update({
        where: { id: archived },
        data: { archivedAt: new Date(), archivedByUserId: people.ownerA.id },
      }),
    );
    expectError(
      await call('post', '/appointments/schedule', people.ownerA, schedule({}, archived)),
      404,
      'NOT_FOUND',
    );
    // staffB is not the lead's member (staffA is).
    expectError(
      await call(
        'post',
        '/appointments/schedule',
        people.staffB,
        schedule({ staffUserIds: [people.staffB.id] }),
      ),
      404,
      'NOT_FOUND',
    );
    // The conflict check resolves the lead by the same rule.
    expectError(
      await call('post', '/appointments/conflicts', people.ownerA, {
        staffUserIds: [people.ownerA.id],
        contact: { kind: 'LEAD', id: ids.leadB },
        startsAt: at(60, '10:00'),
        endsAt: at(60, '10:30'),
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('reschedules, cancels and completes a lead’s own appointment like a client’s', async () => {
    const record = await book();
    const moved = exact(
      Changed,
      await call('post', `/appointments/${record.id}/reschedule`, people.ownerA, {
        startsAt: at(freshDay(), '11:00'),
      }),
    );
    expect(moved).toMatchObject({ client: null, lead: { id: ids.lead }, rescheduleCount: 1 });
    const cancelled = exact(
      Changed,
      await call('post', `/appointments/${record.id}/cancel`, people.ownerA, {
        reason: 'Fake: the lead asked',
      }),
    );
    expect(cancelled.status).toBe('CANCELLED');
    const past = await seedLeadAppointment(ids.lead, -2);
    // P4-2: with its outcome (the outcome tests are below).
    const done = exact(
      Changed,
      await call('post', `/appointments/${past}/complete`, people.ownerA, {
        outcome: 'KEEP_LEAD',
        notes: 'Fake: still deciding',
      }),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', client: null });
    const detail = exact(
      AppointmentDetail,
      await call('get', `/appointments/${record.id}`, people.ownerA),
    );
    expect(detail.history.map((h) => h.action)).toEqual(['BOOKED', 'RESCHEDULED', 'CANCELLED']);
  });
});

// ---- item 3 ----
describe('reach: the lead pages’ rule (item 3)', () => {
  it('Staff see a lead’s own appointment in full when the lead is theirs, else as Busy', async () => {
    // The owner is its staff member; staffA has the lead, staffB has neither.
    const record = await book();
    const range = `from=${encodeURIComponent(at(nextDay, '00:00'))}&to=${encodeURIComponent(at(nextDay + 1, '00:00'))}`;

    const theirs = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.staffA),
    );
    expect(theirs.items.find((i) => i.id === record.id)).toMatchObject({
      restricted: false,
      contact: { kind: 'LEAD', id: ids.lead },
    });
    exact(AppointmentRecord, await call('get', `/appointments/${record.id}/record`, people.staffA));

    const others = exact(
      AgendaPage,
      await call('get', `/appointments/agenda?${range}`, people.staffB),
    );
    const busy = others.items.find((i) => i.id === record.id);
    expect(busy).toMatchObject({ restricted: true });
    expect(JSON.stringify(busy)).not.toContain('Leadwell');
    expectError(
      await call('get', `/appointments/${record.id}/record`, people.staffB),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/appointments/${record.id}`, people.staffB), 404, 'NOT_FOUND');
    const calendar = exact(
      AppointmentList,
      await call('get', `/appointments?${range}`, people.staffB),
    );
    expect(calendar.items.find((i) => i.id === record.id)).toMatchObject({ restricted: true });
    // Searching by the lead's name finds it only for who sees it in full.
    const search = `${range}&search=Leadwell`;
    const found = async (who: Who) =>
      exact(AgendaPage, await call('get', `/appointments/agenda?${search}`, who)).items.map(
        (i) => i.id,
      );
    expect(await found(people.staffA)).toContain(record.id);
    expect(await found(people.staffB)).not.toContain(record.id);
  });
});

// ---- item 4 ----
const Strict = <S extends z.ZodObject>(schema: S) => z.strictObject(schema.shape);

describe('lists and counts (item 4)', () => {
  it('the lead’s Appointments tab and its profile list its appointments', async () => {
    const lead = await newLead('Tabby Listed', { assignedUserId: people.staffA.id });
    const record = await book({}, people.ownerA, lead);
    const res = await call('get', `/leads/${lead}/appointments`, people.staffA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = z.object({ items: z.array(Strict(LeadAppointment)) }).parse(res.body).items;
    expect(items).toEqual([
      {
        id: record.id,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        type: `Consult ${run}`,
        staff: { userId: people.ownerA.id, name: 'Fake P41 ownerA' },
        status: 'CONFIRMED',
        client: null,
      },
    ]);
    const profile = await call('get', `/leads/${lead}/profile`, people.staffA);
    expect(
      (profile.body as { upcomingAppointments: { id: string }[] }).upcomingAppointments,
    ).toEqual([expect.objectContaining({ id: record.id })]);
  });

  it('the dashboard counts a lead’s appointment today, in the calendar’s reach', async () => {
    const count = async (who: Who) =>
      DashboardSummary.parse((await call('get', '/dashboard/summary', who)).body).kpis
        .appointmentsToday!.value; // Owner and Staff may view Appointments (V5)
    const before = {
      owner: await count(people.ownerA),
      staffA: await count(people.staffA),
      staffB: await count(people.staffB),
    };
    // Late today in the firm's time zone, so it counts whenever the test runs.
    const start = new Date(zonedInstant(TZ, today, minutesOf('23:00')));
    await asOwner(ids.firmA, (tx) =>
      tx.appointment.create({
        data: {
          businessId: ids.firmA,
          leadId: ids.lead,
          staffUserId: people.ownerA.id,
          typeId: ids.type,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
          locationKind: 'PHONE',
        },
      }),
    );
    expect(await count(people.ownerA)).toBe(before.owner + 1);
    expect(await count(people.staffA)).toBe(before.staffA + 1);
    expect(await count(people.staffB)).toBe(before.staffB);
  });
});

// ---- item 5 ----
describe('notices (item 5)', () => {
  it('the lead gets its confirmation and reminder by email, never with a portal link', async () => {
    const email = `notice-${run}@p41.test`;
    const lead = await newLead('Nora Notice', { assignedUserId: people.staffA.id, email });
    outbox.length = 0;
    const record = await book({ sendConfirmation: true }, people.ownerA, lead);
    expect(outbox.map((m) => [m.template, m.to])).toEqual([['appointment.lead-booked', email]]);
    const booked = outbox[0]!;
    expect(booked.data).not.toHaveProperty('link');
    expect(JSON.stringify(booked.data)).not.toMatch(/portal/i);
    expect(booked).not.toHaveProperty('recipient');

    outbox.length = 0;
    const sent = exact(
      RemindersSent,
      await call('post', `/appointments/${record.id}/send-reminder`, people.ownerA, {
        channels: ['EMAIL'],
      }),
    );
    expect(sent).toEqual({ sent: 1, skipped: 0 });
    expect(outbox.map((m) => [m.template, m.to])).toEqual([['appointment.lead-reminder', email]]);
    expect(outbox[0]!.data).not.toHaveProperty('link');
  });

  it('refuses a text reminder on a lead’s own appointment (400)', async () => {
    const record = await book();
    const now = await call('post', `/appointments/${record.id}/send-reminder`, people.ownerA, {
      channels: ['SMS'],
    });
    expectError(now, 400, 'SMS_UNAVAILABLE');
    expect(JSON.stringify(now.body)).toContain('not sent to leads');
    const atBooking = await call(
      'post',
      '/appointments/schedule',
      people.ownerA,
      schedule({ reminders: [{ channel: 'SMS', amount: 1, unit: 'DAYS' }] }),
    );
    expectError(atBooking, 400, 'SMS_UNAVAILABLE');
  });
});

// ---- item 6 ----
describe('conversion (item 6)', () => {
  it('the lead’s appointments take the client; its history shows on the client’s Activity and Messages', async () => {
    const email = `convert-${run}@p41.test`;
    const lead = await newLead('Cora Convert', { assignedUserId: people.staffA.id, email });
    const record = await book({ sendConfirmation: false }, people.ownerA, lead);
    const logged = await call('post', `/leads/${lead}/activity`, people.ownerA, {
      kind: 'CALL',
      summary: 'Fake: discussed the 2025 return',
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);
    const thread = await asOwner(ids.firmA, (tx) =>
      tx.messageThread.create({
        data: {
          businessId: ids.firmA,
          leadId: lead,
          subject: 'Fake: welcome',
          createdByUserId: people.ownerA.id,
        },
        select: { id: true },
      }),
    );

    const res = await call('post', `/leads/${lead}/convert-to-client`, people.ownerA, {
      idempotencyKey: randomUUID(),
      accountType: 'INDIVIDUAL',
      fullName: 'Cora Convert',
      email,
      phone: '+15550100999',
      serviceIds: [ids.service],
      primaryStaffUserId: people.staffA.id,
      sendPortalInvite: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = ConvertLeadToClientResult.parse(res.body);
    expect(result.carried).toMatchObject({ appointments: 1, communications: 1 });

    const row = await asOwner(ids.firmA, (tx) =>
      tx.appointment.findUniqueOrThrow({
        where: { id: record.id },
        select: { clientId: true, leadId: true },
      }),
    );
    expect(row).toEqual({ clientId: result.clientId, leadId: lead });
    const detail = exact(
      AppointmentDetail,
      await call('get', `/appointments/${record.id}`, people.ownerA),
    );
    expect(detail).toMatchObject({
      client: { id: result.clientId, displayName: 'Cora Convert' },
      lead: { id: lead, name: 'Cora Convert' },
    });

    const timeline = ClientTimelinePage.parse(
      (await call('get', `/clients/${result.clientId}/timeline`, people.ownerA)).body,
    );
    const titles = timeline.items.map((i) => [i.title, i.summary]);
    expect(titles).toContainEqual(['As a lead: call', 'Fake: discussed the 2025 return']);
    expect(titles).toContainEqual(['As a lead: appointment scheduled', `Consult ${run}`]);

    // The lead's tab keeps it, now under the client.
    const tab = (await call('get', `/leads/${lead}/appointments`, people.ownerA)).body as {
      items: { id: string; client: unknown }[];
    };
    expect(tab.items).toEqual([
      expect.objectContaining({
        id: record.id,
        client: { id: result.clientId, name: 'Cora Convert' },
      }),
    ]);

    // Its message threads stay on the lead and show in the client's Messages (staffA: theirs).
    const threads = exact(
      LeadMessageThreadList,
      await call('get', `/lead-message-threads?clientId=${result.clientId}`, people.staffA),
    );
    expect(threads.items.map((t) => t.id)).toEqual([thread.id]);
    expectError(
      await call('get', `/lead-message-threads?clientId=${result.clientId}`, people.staffB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'get',
        `/lead-message-threads?clientId=${result.clientId}`,
        people.ownerB,
        undefined,
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
  });
});

// ---- P4-2 ----
describe('outcomes of a completed appointment with a lead (P4-2, Clients Review 2 N8-18, N8-19)', () => {
  const leadStatus = (id: string) =>
    asOwner(ids.firmA, (tx) =>
      tx.lead.findUniqueOrThrow({ where: { id }, select: { status: true, clientId: true } }),
    );
  const outcomeAudit = (appointmentId: string) =>
    asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: ids.firmA,
          entityId: appointmentId,
          action: 'appointment.outcome_recorded',
        },
        select: { metadata: true },
      }),
    );
  const fieldsOf = (res: Response) =>
    (res.body as { error?: { details?: { path: string }[] } }).error?.details?.map((d) => d.path);
  const activity = async (lead: string) =>
    exact(LeadActivityPage, await call('get', `/leads/${lead}/activity`, people.ownerA)).items;

  it('a lead’s own appointment needs its outcome and notes (400, the field named)', async () => {
    const lead = await newLead('Nell Needsoutcome', { assignedUserId: people.staffA.id });
    const past = await seedLeadAppointment(lead, -3);
    const path = `/appointments/${past}/complete`;
    for (const [body, field] of [
      [{}, 'outcome'],
      [{ notes: 'Fake: no outcome' }, 'outcome'],
      [{ outcome: 'KEEP_LEAD' }, 'notes'],
      [{ outcome: 'KEEP_LEAD', notes: '   ' }, 'notes'],
      [{ outcome: 'MAYBE', notes: 'Fake' }, 'outcome'],
      [{ outcome: 'KEEP_LEAD', notes: 'Fake', followUpOn: addDays(today, 2) }, 'followUpOn'],
    ] as const) {
      const res = await call('post', path, people.ownerA, body);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldsOf(res), JSON.stringify(body)).toContain(field);
    }
    const row = await asOwner(ids.firmA, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: past }, select: { status: true } }),
    );
    expect(row.status).toBe('SCHEDULED');
    // Another firm's member never reaches it.
    expectError(
      await call('post', path, people.ownerB, { outcome: 'KEEP_LEAD', notes: 'x' }, ids.firmB),
      404,
      'NOT_FOUND',
    );
  });

  it('Keep as Lead: no status changes; the outcome and notes are on the appointment and the lead; audited by code', async () => {
    const lead = await newLead('Kim Keeplead', { assignedUserId: people.staffA.id });
    const past = await seedLeadAppointment(lead, -8);
    // The lead's own Staff member completes it (they see it in full).
    const done = exact(
      Changed,
      await call('post', `/appointments/${past}/complete`, people.staffA, {
        outcome: 'KEEP_LEAD',
        notes: 'Fake: compared two services, will decide later',
      }),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', client: null, lead: { id: lead } });
    expect(await leadStatus(lead)).toEqual({ status: 'SUBMITTED', clientId: null });
    const record = exact(
      AppointmentRecord,
      await call('get', `/appointments/${past}/record`, people.ownerA),
    );
    expect(record.internalNotes).toContain(
      'Outcome: Keep as Lead. Fake: compared two services, will decide later',
    );
    const rows = await asOwner(ids.firmA, (tx) =>
      tx.leadActivity.findMany({
        where: { businessId: ids.firmA, leadId: lead, kind: 'MEETING' },
        select: { summary: true, body: true, metadata: true },
      }),
    );
    expect(rows).toEqual([
      {
        summary: 'Appointment completed: Keep as Lead',
        body: 'Fake: compared two services, will decide later',
        metadata: { appointmentId: past, outcome: 'KEEP_LEAD' },
      },
    ]);
    expect((await activity(lead)).map((a) => a.label)).toContain(
      'Meeting: Appointment completed: Keep as Lead',
    );
    const audits = await outcomeAudit(past);
    expect(audits.map((a) => a.metadata)).toEqual([{ leadId: lead, outcome: 'KEEP_LEAD' }]);
    expect(JSON.stringify(audits)).not.toContain('compared two services');
    // Final: a second completion is 409.
    expectError(
      await call('post', `/appointments/${past}/complete`, people.ownerA, {
        outcome: 'KEEP_LEAD',
        notes: 'Fake: again',
      }),
      409,
      'APPOINTMENT_CLOSED',
    );
  });

  it('Keep as Lead and Follow Up needs a date, today or later, and sets the lead’s next follow-up', async () => {
    const lead = await newLead('Fran Followup', { assignedUserId: people.staffA.id });
    const past = await seedLeadAppointment(lead, -4);
    const path = `/appointments/${past}/complete`;
    const res = await call('post', path, people.ownerA, {
      outcome: 'KEEP_LEAD_FOLLOW_UP',
      notes: 'Fake: call back next week',
    });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(fieldsOf(res)).toEqual(['followUpOn']);
    const yesterday = await call('post', path, people.ownerA, {
      outcome: 'KEEP_LEAD_FOLLOW_UP',
      notes: 'Fake: call back next week',
      followUpOn: addDays(today, -1),
    });
    expectError(yesterday, 400, 'VALIDATION_FAILED');
    expect(fieldsOf(yesterday)).toEqual(['followUpOn']);

    const on = addDays(today, 5);
    exact(
      Changed,
      await call('post', path, people.ownerA, {
        outcome: 'KEEP_LEAD_FOLLOW_UP',
        notes: 'Fake: call back next week',
        followUpOn: on,
      }),
    );
    const profile = exact(LeadProfile, await call('get', `/leads/${lead}/profile`, people.ownerA));
    expect(profile.stage).toBe('SUBMITTED');
    expect(profile.nextAction).toMatchObject({
      type: 'FOLLOW_UP',
      dueAt: new Date(zonedInstant(TZ, on, minutesOf('10:00'))).toISOString(),
    });
    expect(profile.followUps.filter((f) => !f.doneAt).map((f) => f.type)).toEqual(['FOLLOW_UP']);
    const record = exact(
      AppointmentRecord,
      await call('get', `/appointments/${past}/record`, people.ownerA),
    );
    expect(record.internalNotes).toContain(
      `Outcome: Keep as Lead and Follow Up (follow up on ${on}). Fake: call back next week`,
    );
    const added = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, entityId: lead, action: 'lead.follow_up_added' },
        select: { metadata: true },
      }),
    );
    expect(added.map((a) => a.metadata)).toEqual([{ type: 'FOLLOW_UP' }]);
  });

  it('Keep as Lead and Follow Up on a closed lead is refused, and nothing is saved', async () => {
    const lead = await newLead('Lou Lostlead', { assignedUserId: people.staffA.id });
    const past = await seedLeadAppointment(lead, -5);
    await asOwner(ids.firmA, (tx) =>
      tx.lead.update({ where: { id: lead }, data: { status: 'LOST' } }),
    );
    expectError(
      await call('post', `/appointments/${past}/complete`, people.ownerA, {
        outcome: 'KEEP_LEAD_FOLLOW_UP',
        notes: 'Fake: try later',
        followUpOn: addDays(today, 3),
      }),
      409,
      'LEAD_CLOSED',
    );
    const row = await asOwner(ids.firmA, (tx) =>
      tx.appointment.findUniqueOrThrow({
        where: { id: past },
        select: { status: true, internalNotes: true },
      }),
    );
    expect(row).toEqual({ status: 'SCHEDULED', internalNotes: null });
  });

  it('Convert to New client converts nothing by itself: the lead stays a lead, with no client', async () => {
    const lead = await newLead('Cody Convertlater', { assignedUserId: people.staffA.id });
    const past = await seedLeadAppointment(lead, -6);
    const clientsBefore = await asOwner(ids.firmA, (tx) => tx.client.count());
    const done = exact(
      Changed,
      await call('post', `/appointments/${past}/complete`, people.ownerA, {
        outcome: 'CONVERT_NEW',
        notes: 'Fake: chose Annual Tax',
      }),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', client: null, lead: { id: lead } });
    expect(await leadStatus(lead)).toEqual({ status: 'SUBMITTED', clientId: null });
    expect(await asOwner(ids.firmA, (tx) => tx.client.count())).toBe(clientsBefore);
    expect((await activity(lead)).map((a) => a.label)).toContain(
      'Meeting: Appointment completed: Convert to New client',
    );
    expect((await outcomeAudit(past)).map((a) => a.metadata)).toEqual([
      { leadId: lead, outcome: 'CONVERT_NEW' },
    ]);
  });

  it('a client’s appointment completes as before, and takes no outcome (400)', async () => {
    const clientId = await asOwner(ids.firmA, async (tx) => {
      const row = await tx.client.create({
        data: {
          businessId: ids.firmA,
          displayName: 'Carla Client (fake)',
          email: `carla-${randomUUID().slice(0, 8)}@p41.test`,
        },
        select: { id: true },
      });
      return row.id;
    });
    const start = new Date(at(-7, '10:00'));
    const past = await asOwner(ids.firmA, async (tx) => {
      const row = await tx.appointment.create({
        data: {
          businessId: ids.firmA,
          clientId,
          staffUserId: people.ownerA.id,
          typeId: ids.type,
          startsAt: start,
          endsAt: new Date(start.getTime() + 30 * 60_000),
          locationKind: 'PHONE',
          bookedByUserId: people.ownerA.id,
        },
        select: { id: true },
      });
      return row.id;
    });
    const refused = await call('post', `/appointments/${past}/complete`, people.ownerA, {
      outcome: 'KEEP_LEAD',
      notes: 'Fake: not a lead',
    });
    expectError(refused, 400, 'VALIDATION_FAILED');
    expect(fieldsOf(refused)).toEqual(['outcome']);
    const done = exact(
      Changed,
      await call('post', `/appointments/${past}/complete`, people.ownerA, {}),
    );
    expect(done).toMatchObject({ status: 'COMPLETED', client: { id: clientId }, lead: null });
    expect(await outcomeAudit(past)).toEqual([]);
  });
});
