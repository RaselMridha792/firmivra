// End-to-end: R55, the Intake Forms workspace, step 2 and 3 (contract in
// packages/types/src/intake/workspace.ts): send a form (retry-safe) and its drafts, one form's
// record, notes, the row More menu (assign, dates, resend, remind, archive), Export PDF, and the
// form builder (create, save, publish, duplicate, archive). Staff reach only their own clients'
// forms; the portal never shows a form that was not sent; firm B sees none of firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AssignedFormRecord,
  FormFileLink,
  FormNote,
  IntakeFormDetail,
  IntakeFormList,
  INTAKE_FORMS,
  SendDraft,
  SendIntakeFormResult,
  AppointmentRecord,
  addDays,
  zonedInstant,
  AppointmentTypeConfig,
} from '@firmivra/types';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { IntakeScheduleJobs } from '../../src/intake-workspace/intake-schedule.jobs.js';
import { IntakeAutomations } from '../../src/intake-workspace/intake-automations.js';

class MemoryFiles implements ReportFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string; fileName: string }) {
    return Promise.resolve(`memory:${input.key}?name=${encodeURIComponent(input.fileName)}`);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
const files = new MemoryFiles();
/** 19b: every email NotifyService was asked to send; `failMail` makes the mail service refuse. */
const mail: NotifyMessage[] = [];
let failMail = false;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55s-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  otherStaffA: person('other-staff-a'),
  ownerB: person('owner-b'),
  portalClient: person('portal-client'),
  mailClient: person('mail-client'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const slugs = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.64.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

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

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const { ownerA, adminA, staffA, otherStaffA, ownerB, portalClient } = people;
const ids = {} as Record<string, string>;
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** EXPIRY-01: a day's end (11:59:59.999 PM) in the firm's time zone (the default, New York). */
const NY = 'America/New_York';
const nyEnd = (day: string) =>
  new Date(zonedInstant(day, '23:59', NY).getTime() + 59_999).toISOString();
const nyDay = (days: number) =>
  addDays(new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(new Date()), days);
const LATER = 'Choose an expiration date and time later than now.';
const auditCount = (action: string, entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.count({ where: { businessId: firms.a, action, entityType: 'intake', entityId } }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'portalClient' || key === 'mailClient' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R55s ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      slugs[key] = `r55s-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug: slugs[key], name: `Firm ${slugs[key]}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['a', otherStaffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId, role, status: 'ACTIVE' },
      }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Individual Tax ${run}`, status: 'ACTIVE' },
      select: { id: true },
    });
    ids.service = service.id;
    const def = INTAKE_FORMS.ANNUAL_TAX;
    if (!def) throw new Error('the built-in annual tax form is missing');
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Annual Tax Intake',
        definition: def as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { id: true, templateId: true },
    });
    ids.form = form.id;
    ids.template = form.templateId as string;
    const client = async (key: string, name: string, assigned?: string, engaged = true) => {
      const c = await tx.client.create({
        data: {
          businessId,
          displayName: name,
          email: `${key}-${run}@client.test`,
          assignedUserId: assigned,
        },
        select: { id: true },
      });
      ids[`${key}Client`] = c.id;
      if (engaged) {
        const e = await tx.engagement.create({
          data: { businessId, clientId: c.id, serviceId: service.id, title: `${name} tax` },
          select: { id: true },
        });
        ids[`${key}Engagement`] = e.id;
      }
    };
    await client('mine', 'Mina Mine (fake)', staffA.id);
    await client('theirs', 'Theo Theirs (fake)', otherStaffA.id);
    await client('email', 'Emma Email (fake)');
    await client('fresh', 'Fred Fresh (fake)');
    await client('loose', 'Lou Loose (fake)');
    await client('bare', 'Bea Bare (fake)', undefined, false);
    await client('mail', 'Mae Mail (fake)');
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: portalClient.id,
        clientId: ids.mineClient!,
        email: portalClient.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.mailClient.id,
        clientId: ids.mailClient!,
        email: people.mailClient.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
    });
    ids.lead = (
      await tx.lead.create({
        data: {
          businessId,
          serviceId: service.id,
          firstName: 'Lee',
          lastName: 'Lead (fake)',
          email: `lead-${run}@lead.test`,
          assignedUserId: staffA.id,
        },
        select: { id: true },
      })
    ).id;
    const intake = async (key: string, over: object) => {
      const row = await tx.intake.create({
        data: { businessId, formId: form.id, ...over },
        select: { id: true },
      });
      await tx.intakeSubmission.create({ data: { businessId, intakeId: row.id, version: 1 } });
      ids[key] = row.id;
    };
    await intake('submitted', { engagementId: ids.looseEngagement, status: 'SUBMITTED' });
    await intake('expired', { engagementId: ids.theirsEngagement, status: 'EXPIRED' });
    await intake('leadForm', { leadId: ids.lead, status: 'SENT' });
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        if (failMail) return Promise.reject(new Error('Throttling'));
        mail.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const sendBody = (over: object = {}) => ({
  idempotencyKey: randomUUID(),
  recipient: { kind: 'CLIENT', id: ids.mineClient },
  formId: ids.template,
  channel: 'PORTAL',
  subject: 'Your intake form',
  message: 'Please fill this in.',
  ...over,
});

describe('send a form', () => {
  it('refuses what cannot be sent yet, before anything is written', async () => {
    expectError(
      await call('post', '/intakes/send', ownerA, sendBody({ channel: 'SMS' })),
      400,
      'SMS_UNAVAILABLE',
    );
    expectError(
      await call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({ recipient: { kind: 'LEAD', id: ids.lead } }),
      ),
      409,
      'PORTAL_UNAVAILABLE',
    );
    expectError(
      await call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({
          recipient: { kind: 'NEW_CONTACT', name: 'New Person', email: `new-${run}@x.test` },
          channel: 'EMAIL',
        }),
      ),
      503,
      'LEAD_LINK_UNAVAILABLE',
    );
    expectError(
      await call('post', '/intakes/send', ownerA, sendBody({ formId: randomUUID() })),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({ recipient: { kind: 'CLIENT', id: ids.bareClient } }),
      ),
      409,
      'PORTAL_UNAVAILABLE',
    );
    // N8-23: no active service is no longer a refusal; this one fails on the portal, and the
    // pending request it would have made is rolled back with it.
    expect(
      await inFirm('a', (tx) =>
        tx.engagement.count({ where: { businessId: firms.a, clientId: ids.bareClient } }),
      ),
    ).toBe(0);
    expectError(
      await call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({ recipient: { kind: 'CLIENT', id: ids.emailClient } }),
      ),
      409,
      'PORTAL_UNAVAILABLE',
    );
    expectError(
      await call(
        'post',
        '/intakes/send',
        staffA,
        sendBody({ recipient: { kind: 'CLIENT', id: ids.theirsClient } }),
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/intakes/send', ownerA, sendBody({ expiresOn: '2020-01-01' })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({ dueOn: future(20), expiresOn: future(10) }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    expect((await call('post', '/intakes/send', ownerA, { formId: ids.template })).status).toBe(
      400,
    );
  });

  it('sends to a client in the portal, once per key, and refuses a second open copy', async () => {
    const body = sendBody({ dueOn: future(5), assignedUserId: staffA.id });
    const res = SendIntakeFormResult.parse(ok(await call('post', '/intakes/send', staffA, body)));
    expect(res.delivery).toEqual({
      channel: 'PORTAL',
      status: 'SENT',
      to: 'Client portal',
      portalNotice: true,
      reason: null,
    });
    // A form sent in the portal sends no email of its own.
    expect(mail.filter((m) => m.template === 'intake.sent')).toEqual([]);
    expect(res.form).toMatchObject({
      status: 'SENT',
      recipient: { kind: 'CLIENT', id: ids.mineClient },
      form: { id: ids.template },
      assignedTo: { userId: staffA.id },
      dueOn: future(5),
    });
    // EXPIRY-01: the default (14 days) ends at 11:59 PM in the firm's time zone.
    expect(res.form.expiresAt).toBe(nyEnd(nyDay(14)));
    ids.sent = res.form.id;
    const again = SendIntakeFormResult.parse(ok(await call('post', '/intakes/send', staffA, body)));
    expect(again.form.id).toBe(ids.sent);
    expect(await auditCount('intake.sent', ids.sent)).toBe(1);
    expectError(await call('post', '/intakes/send', ownerA, sendBody()), 409, 'FORM_ALREADY_OPEN');
    // Another member reusing someone's key gets nothing of theirs.
    expectError(await call('post', '/intakes/send', ownerA, body), 404, 'NOT_FOUND');
    const row = await inFirm('a', (tx) => tx.intake.findFirstOrThrow({ where: { id: ids.sent } }));
    expect(row).toMatchObject({
      deliveryChannel: 'PORTAL',
      messageSubject: 'Your intake form',
      createdByUserId: staffA.id,
    });
    expect(row.sentAt).toBeTruthy();
  });

  it('by email to a client with no portal login keeps the form and reports the delivery failed', async () => {
    const res = SendIntakeFormResult.parse(
      ok(
        await call(
          'post',
          '/intakes/send',
          ownerA,
          sendBody({ recipient: { kind: 'CLIENT', id: ids.emailClient }, channel: 'EMAIL' }),
        ),
      ),
    );
    expect(res.delivery).toEqual({
      channel: 'EMAIL',
      status: 'FAILED',
      to: `e***@client.test`,
      portalNotice: false,
      reason: expect.stringContaining('no client portal login') as string,
    });
    ids.emailed = res.form.id;
  });

  it('19b: by email to a client with a portal login, the email opens the exact form, and the result says the mail service accepted it', async () => {
    const before = mail.length;
    const res = SendIntakeFormResult.parse(
      ok(
        await call(
          'post',
          '/intakes/send',
          ownerA,
          sendBody({
            recipient: { kind: 'CLIENT', id: ids.mailClient },
            channel: 'EMAIL',
            subject: 'Please fill this in',
            message: 'Thank you (fake).',
            dueOn: future(5),
          }),
        ),
      ),
    );
    expect(res.delivery).toEqual({
      channel: 'EMAIL',
      status: 'SENT',
      to: 'm***@client.test',
      portalNotice: true,
      reason: null,
    });
    const sentMail = mail.slice(before).filter((m) => m.template === 'intake.sent');
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]).toMatchObject({
      to: people.mailClient.email,
      businessId: firms.a,
      data: {
        formTitle: 'Annual Tax Intake',
        subject: 'Please fill this in',
        message: 'Thank you (fake).',
        dueOn: future(5),
      },
    });
    const data = sentMail[0]!.data as { link: string; expiresAt: Date | null };
    expect(data.link.endsWith(`/${slugs.a}/intake/${res.form.id}`)).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
    // The outbox row says the same: SENT, once.
    const rows = await inFirm('a', (tx) =>
      tx.notificationDelivery.findMany({
        where: { businessId: firms.a, channel: 'EMAIL', notification: { entityId: res.form.id } },
        select: { status: true, attempts: true },
      }),
    );
    expect(rows).toEqual([{ status: 'SENT', attempts: 1 }]);

    // The mail service refuses a reminder: its row is FAILED with the reason, for the retry job.
    failMail = true;
    try {
      ok(await call('post', `/intakes/${res.form.id}/remind`, ownerA), 200);
    } finally {
      failMail = false;
    }
    const after = await inFirm('a', (tx) =>
      tx.notificationDelivery.findMany({
        where: {
          businessId: firms.a,
          channel: 'EMAIL',
          notification: { entityId: res.form.id, eventKey: { startsWith: 'intake.reminded:' } },
        },
        select: { status: true, lastError: true },
      }),
    );
    expect(after).toEqual([{ status: 'FAILED', lastError: 'Error' }]);
  });

  it('A9: a type asks for its service form; a form sent for an appointment shows on it until completed; another client or a cancelled appointment is refused', async () => {
    // A random day in 2031 (one staff member's appointments may not overlap), 15:00 to 16:00.
    const base = Math.floor(Math.random() * 300);
    const day = (n: number, h: number) => new Date(Date.UTC(2031, 0, 1 + base + n * 2, h));
    const made = await inFirm('a', async (tx) => {
      const client = async (name: string) => {
        const c = await tx.client.create({
          data: {
            businessId: firms.a,
            displayName: name,
            email: `${name.split(' ')[0]!.toLowerCase()}-${run}@client.test`,
          },
          select: { id: true },
        });
        await tx.engagement.create({
          data: {
            businessId: firms.a,
            clientId: c.id,
            serviceId: ids.service!,
            title: `${name} tax`,
          },
        });
        return c.id;
      };
      const ada = await client('Ada Appointment (fake)');
      const ben = await client('Ben Booked (fake)');
      const type = await tx.appointmentType.create({
        data: { businessId: firms.a, name: `Fake A9 consult ${run}`, durationMinutes: 30 },
        select: { id: true },
      });
      const appointment = async (clientId: string, n: number, cancelled = false) =>
        (
          await tx.appointment.create({
            data: {
              businessId: firms.a,
              clientId,
              typeId: type.id,
              staffUserId: ownerA.id,
              startsAt: day(n, 15),
              endsAt: day(n, 16),
              locationKind: 'VIDEO',
              ...(cancelled ? { status: 'CANCELLED', cancelledAt: new Date() } : {}),
            },
            select: { id: true },
          })
        ).id;
      return {
        ada,
        type: type.id,
        adaVisit: await appointment(ada, 1),
        benVisit: await appointment(ben, 2),
        adaCancelled: await appointment(ada, 3, true),
      };
    });

    // The type asks for the service's form; an unknown form is 404.
    const config = AppointmentTypeConfig.parse(
      ok(
        await call('put', `/appointment-types/${made.type}/config`, ownerA, {
          requiredIntakeFormId: ids.template,
        }),
      ),
    );
    expect(config.requiredIntakeFormId).toBe(ids.template);
    expect(
      AppointmentTypeConfig.parse(
        ok(await call('get', `/appointment-types/${made.type}/config`, ownerA)),
      ).requiredIntakeFormId,
    ).toBe(ids.template);
    expectError(
      await call('put', `/appointment-types/${made.type}/config`, ownerA, {
        requiredIntakeFormId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );

    const toAda = (appointmentId: string) =>
      sendBody({
        recipient: { kind: 'CLIENT', id: made.ada },
        channel: 'EMAIL',
        appointmentId,
      });
    expectError(
      await call('post', '/intakes/send', ownerA, toAda(made.benVisit)),
      409,
      'APPOINTMENT_MISMATCH',
    );
    expectError(
      await call('post', '/intakes/send', ownerA, toAda(made.adaCancelled)),
      409,
      'APPOINTMENT_MISMATCH',
    );
    const sent = SendIntakeFormResult.parse(
      ok(await call('post', '/intakes/send', ownerA, toAda(made.adaVisit))),
    );
    const row = await inFirm('a', (tx) =>
      tx.intake.findFirstOrThrow({ where: { id: sent.form.id }, select: { appointmentId: true } }),
    );
    expect(row.appointmentId).toBe(made.adaVisit);

    const related = async () =>
      AppointmentRecord.parse(
        ok(await call('get', `/appointments/${made.adaVisit}/record`, ownerA)),
      ).related.intakeForm;
    expect(await related()).toMatchObject({ id: sent.form.id, completed: false });
    await inFirm('a', (tx) =>
      tx.intake.update({ where: { id: sent.form.id }, data: { status: 'COMPLETED' } }),
    );
    expect(await related()).toMatchObject({ id: sent.form.id, completed: true });
    // Another firm reaches neither the type's settings nor the appointment.
    expectError(
      await call('get', `/appointments/${made.adaVisit}/record`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });
});

describe('send drafts', () => {
  it('saves, lists and updates the member own drafts, never shown in the portal', async () => {
    expectError(
      await call('post', '/intakes/send-drafts', ownerA, { subject: 'No recipient' }),
      400,
      'VALIDATION_FAILED',
    );
    const lead = SendDraft.parse(
      ok(
        await call('post', '/intakes/send-drafts', staffA, {
          recipient: { kind: 'LEAD', id: ids.lead },
          formId: ids.template,
          channel: 'EMAIL',
        }),
        201,
      ),
    );
    expect(lead.data).toMatchObject({ recipient: { kind: 'LEAD', id: ids.lead } });
    const portalDraft = SendDraft.parse(
      ok(
        await call('post', '/intakes/send-drafts', ownerA, {
          recipient: { kind: 'CLIENT', id: ids.mineClient },
          formId: ids.template,
        }),
        201,
      ),
    );
    const updated = SendDraft.parse(
      ok(
        await call('put', `/intakes/send-drafts/${lead.id}`, staffA, {
          subject: 'Draft subject',
          dueOn: future(3),
        }),
      ),
    );
    expect(updated.id).toBe(lead.id);
    expect(updated.data).toMatchObject({ subject: 'Draft subject', dueOn: future(3) });
    const mine = z
      .object({ items: z.array(SendDraft) })
      .parse(ok(await call('get', '/intakes/send-drafts', staffA)));
    expect(mine.items.map((d) => d.id)).toEqual([lead.id]);
    expectError(
      await call('put', `/intakes/send-drafts/${lead.id}`, ownerA, { subject: 'x' }),
      404,
      'NOT_FOUND',
    );
    // The client's portal shows the sent form, never the draft.
    const portal = await request(app.getHttpServer())
      .get(`/api/v1/portal/${slugs.a}/me/intakes`)
      .set('authorization', `Bearer ${await tokenFor(portalClient.email)}`);
    const shown = (portal.body as { items: { id: string }[] }).items.map((i) => i.id);
    expect(shown).toContain(ids.sent);
    expect(shown).not.toContain(portalDraft.id);
    const one = await request(app.getHttpServer())
      .get(`/api/v1/portal/${slugs.a}/me/intakes/${portalDraft.id}`)
      .set('authorization', `Bearer ${await tokenFor(portalClient.email)}`);
    expect(one.status).toBe(404);
  });

  it('sending the form promotes the member own draft instead of making a second one', async () => {
    const draft = SendDraft.parse(
      ok(
        await call('post', '/intakes/send-drafts', ownerA, {
          recipient: { kind: 'CLIENT', id: ids.freshClient },
          formId: ids.template,
          subject: 'Saved subject',
        }),
        201,
      ),
    );
    const res = SendIntakeFormResult.parse(
      ok(
        await call(
          'post',
          '/intakes/send',
          ownerA,
          sendBody({ recipient: { kind: 'CLIENT', id: ids.freshClient }, channel: 'EMAIL' }),
        ),
      ),
    );
    expect(res.form.id).toBe(draft.id);
    const left = z
      .object({ items: z.array(SendDraft) })
      .parse(ok(await call('get', '/intakes/send-drafts', ownerA)));
    expect(left.items.map((d) => d.id)).not.toContain(draft.id);
  });
});

describe('one form', () => {
  it('shows the record with progress, history and communications', async () => {
    const r = AssignedFormRecord.parse(
      ok(await call('get', `/intakes/${ids.sent}/record`, ownerA)),
    );
    expect(r).toMatchObject({
      id: ids.sent,
      status: 'SENT',
      notes: [],
      documents: [],
      revisionNote: null,
      progress: { percent: 0, submitted: false, readyForReview: false },
    });
    expect(r.history.map((e) => [e.kind, e.by])).toEqual([['SENT', 'Fake R55s staffA']]);
    expect(r.communications).toHaveLength(1);
    expect(
      AssignedFormRecord.parse(ok(await call('get', `/intakes/${ids.submitted}/record`, adminA)))
        .progress,
    ).toMatchObject({ submitted: true, readyForReview: true });
    expectError(await call('get', `/intakes/${ids.sent}/record`, otherStaffA), 404, 'NOT_FOUND');
    expectError(await call('get', `/intakes/${randomUUID()}/record`, ownerA), 404, 'NOT_FOUND');
    expectError(await call('get', '/intakes/nope/record', ownerA), 400, 'VALIDATION_FAILED');
  });

  it('24b-i: a staff note is kept on the form, newest first, its author and time; the audit has no text', async () => {
    const first = FormNote.parse(
      ok(await call('post', `/intakes/${ids.sent}/notes`, ownerA, { text: 'Fake note one' }), 201),
    );
    expect(first).toMatchObject({ text: 'Fake note one', by: { userId: ownerA.id } });
    const second = FormNote.parse(
      ok(await call('post', `/intakes/${ids.sent}/notes`, adminA, { text: 'Fake note two' }), 201),
    );
    const record = AssignedFormRecord.parse(
      ok(await call('get', `/intakes/${ids.sent}/record`, ownerA)),
    );
    expect(record.notes.map((n) => n.id).slice(0, 2)).toEqual([second.id, first.id]);
    const audits = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: ids.sent, action: 'intake.note_added' },
        select: { metadata: true },
      }),
    );
    expect(audits.map((a) => a.metadata)).toEqual(
      expect.arrayContaining([{ noteId: first.id }, { noteId: second.id }]),
    );
    expect(JSON.stringify(audits)).not.toContain('Fake note');
    expect((await call('post', `/intakes/${ids.sent}/notes`, ownerA, {})).status).toBe(400);
    const long = { text: 'x'.repeat(2001) };
    expect((await call('post', `/intakes/${ids.sent}/notes`, ownerA, long)).status).toBe(400);
    expectError(
      await call('post', `/intakes/${ids.sent}/notes`, otherStaffA, { text: 'x' }),
      404,
      'NOT_FOUND',
    );
  });

  it('changes the assignee and the dates, and an expired form reopens', async () => {
    const r = AssignedFormRecord.parse(
      ok(
        await call('patch', `/intakes/${ids.sent}`, ownerA, {
          assignedUserId: adminA.id,
          expiresOn: future(30),
        }),
      ),
    );
    expect(r.assignedTo?.userId).toBe(adminA.id);
    // A whole day ends at 11:59 PM in the firm's time zone (EXPIRY-01).
    expect(r.expiresAt).toBe(nyEnd(future(30)));
    expect(r.history.map((e) => e.kind)).toEqual(['SENT', 'ASSIGNED', 'EXTENDED']);
    expectError(
      await call('patch', `/intakes/${ids.sent}`, ownerA, { dueOn: future(40) }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/intakes/${ids.sent}`, ownerA, { assignedUserId: ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );
    expect((await call('patch', `/intakes/${ids.sent}`, ownerA, {})).status).toBe(400);
    const reopened = AssignedFormRecord.parse(
      ok(await call('patch', `/intakes/${ids.expired}`, ownerA, { expiresOn: future(7) })),
    );
    expect(reopened.status).toBe('SENT');
  });

  it('EXPIRY-01: an exact expiration later than now, refused on its own field otherwise; null never expires', async () => {
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const r = AssignedFormRecord.parse(
      ok(await call('patch', `/intakes/${ids.sent}`, ownerA, { dueOn: null, expiresAt: soon })),
    );
    expect(r.expiresAt).toBe(soon);
    for (const expiresAt of [
      new Date(Date.now() - 60_000).toISOString(),
      new Date().toISOString(),
    ]) {
      const late = await call('patch', `/intakes/${ids.sent}`, ownerA, { expiresAt });
      expectError(late, 400, 'VALIDATION_FAILED');
      expect((late.body as { error: { details?: unknown } }).error.details).toEqual([
        { path: 'expiresAt', message: LATER },
      ]);
    }
    expectError(
      await call('patch', `/intakes/${ids.sent}`, ownerA, {
        expiresAt: soon,
        expiresOn: future(3),
      }),
      400,
      'VALIDATION_FAILED',
    );
    const never = AssignedFormRecord.parse(
      ok(await call('patch', `/intakes/${ids.sent}`, ownerA, { expiresAt: null })),
    );
    expect(never.expiresAt).toBeNull();
    // A send refuses a time that has passed on the same field, and sends nothing.
    const eve = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Eve Expiry (fake)',
          email: `eve-${run}@client.test`,
        },
        select: { id: true },
      });
      await tx.engagement.create({
        data: { businessId: firms.a, clientId: c.id, serviceId: ids.service!, title: 'Eve tax' },
      });
      return c.id;
    });
    const refused = await call(
      'post',
      '/intakes/send',
      ownerA,
      sendBody({
        recipient: { kind: 'CLIENT', id: eve },
        channel: 'EMAIL',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    expectError(refused, 400, 'VALIDATION_FAILED');
    expect((refused.body as { error: { details?: unknown } }).error.details).toEqual([
      { path: 'expiresAt', message: LATER },
    ]);
  });

  it('resends and reminds an open form only', async () => {
    const resent = AssignedFormRecord.parse(
      ok(await call('post', `/intakes/${ids.sent}/resend`, staffA)),
    );
    expect(resent.communications.map((e) => e.kind)).toEqual(['SENT', 'RESENT']);
    const reminded = AssignedFormRecord.parse(
      ok(await call('post', `/intakes/${ids.sent}/remind`, staffA)),
    );
    expect(reminded.communications.map((e) => e.kind)).toEqual(['SENT', 'RESENT', 'REMINDER']);
    expect(await auditCount('intake.sent', ids.sent!)).toBe(1);
    expectError(
      await call('post', `/intakes/${ids.submitted}/remind`, ownerA),
      409,
      'INVALID_STATUS',
    );
    // A lead's form is resent with a new secure link (intake-link.e2e.test.ts has the rest).
    ok(await call('post', `/intakes/${ids.leadForm}/resend`, ownerA));
    const lead = await inFirm('a', (tx) =>
      tx.intake.findUniqueOrThrow({
        where: { id: ids.leadForm! },
        select: { accessTokenHash: true },
      }),
    );
    expect(lead.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expectError(await call('post', `/intakes/${ids.sent}/remind`, otherStaffA), 404, 'NOT_FOUND');
  });

  it('19b: a Remind or Resend answers its true result, and History keeps it', async () => {
    // To the portal: the notice is written.
    const sent = AssignedFormRecord.parse(
      ok(await call('post', `/intakes/${ids.sent}/remind`, ownerA)),
    );
    expect(sent.delivery).toEqual({ status: 'SENT', reason: null });
    expect(sent.history.at(-1)?.label).toBe('Reminder sent');
    // By email to a client with no portal login: nothing reached them, and both say why.
    for (const [path, label] of [
      ['remind', 'Reminder not delivered: the client has no portal sign-in'],
      ['resend', 'Resend not delivered: the client has no portal sign-in'],
    ] as const) {
      const missed = AssignedFormRecord.parse(
        ok(await call('post', `/intakes/${ids.emailed}/${path}`, ownerA)),
      );
      expect(missed.delivery).toEqual({
        status: 'FAILED',
        reason: expect.stringContaining('no client portal login') as string,
      });
      expect(missed.history.map((e) => e.label)).toContain(label);
    }
    const kept = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: ids.emailed!, action: 'intake.reminded' },
        select: { metadata: true },
      }),
    );
    expect(kept.metadata).toEqual({ delivered: false, status: 'FAILED', code: 'NO_PORTAL_LOGIN' });
    // A record read later has no delivery: it belongs to the answer only.
    const later = AssignedFormRecord.parse(
      ok(await call('get', `/intakes/${ids.emailed}/record`, ownerA)),
    );
    expect(later.delivery).toBeUndefined();
  });

  it('exports the answers as a PDF behind a short link', async () => {
    const link = FormFileLink.parse(ok(await call('get', `/intakes/${ids.submitted}/pdf`, adminA)));
    expect(link.url).toMatch(/^memory:tenant\/[0-9a-f-]+\/reports\/intake-/);
    expect(link.url).toContain(firms.a);
    const key = decodeURIComponent(link.url.slice('memory:'.length).split('?')[0]!);
    expect(files.objects.get(key)?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await auditCount('intake.pdf_exported', ids.submitted!)).toBe(1);
  });

  it('archives once; an archived form takes no reminder', async () => {
    const r = AssignedFormRecord.parse(
      ok(await call('post', `/intakes/${ids.emailed}/archive`, ownerA)),
    );
    expect(r.status).toBe('ARCHIVED');
    ok(await call('post', `/intakes/${ids.emailed}/archive`, ownerA));
    expect(await auditCount('intake.archived', ids.emailed!)).toBe(1);
    expectError(
      await call('post', `/intakes/${ids.emailed}/remind`, ownerA),
      409,
      'INVALID_STATUS',
    );
    expectError(
      await call('patch', `/intakes/${ids.emailed}`, ownerA, { dueOn: future(2) }),
      409,
      'INVALID_STATUS',
    );
  });
});

const sections = [
  {
    key: 'about',
    title: 'About you',
    questions: [
      { key: 'fullName', type: 'SHORT_ANSWER', label: 'Full name', required: true },
      { key: 'pick', type: 'DROPDOWN', label: 'Pick one', required: false },
    ],
  },
];

describe('the form builder', () => {
  it('creates a draft, refuses an incomplete publish, then publishes it', async () => {
    expectError(
      await call('post', '/intake-forms', staffA, { name: 'Nope', category: 'PERSONAL_TAX' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/intake-forms', ownerA, { name: 'Nope', category: 'PAYROLL' }),
      400,
      'VALIDATION_FAILED',
    );
    const d = IntakeFormDetail.parse(
      ok(
        await call('post', '/intake-forms', ownerA, {
          name: 'Fake Builder Form',
          category: 'PERSONAL_TAX',
          description: 'Fake description',
          internalNotes: 'Fake notes',
          isTemplate: true,
          sections,
          settings: { expiresAfterDays: 9 },
        }),
        201,
      ),
    );
    ids.built = d.id;
    expect(d).toMatchObject({
      name: 'Fake Builder Form',
      status: 'DRAFT',
      version: 1,
      custom: true,
      // The service already has its default form.
      isTemplate: false,
      description: 'Fake description',
      internalNotes: 'Fake notes',
      service: { id: ids.service },
    });
    expect(d.settings.expiresAfterDays).toBe(9);
    expect(d.sections[0]!.questions.map((q) => q.key)).toEqual(['fullName', 'pick']);
    expectError(
      await call('post', `/intake-forms/${d.id}/publish`, ownerA),
      400,
      'FORM_INCOMPLETE',
    );
    expectError(
      await call('post', '/intakes/send', ownerA, sendBody({ formId: d.id })),
      409,
      'FORM_NOT_PUBLISHED',
    );
    const fixed = structuredClone(sections);
    (fixed[0]!.questions[1] as { options?: string[] }).options = ['A', 'B'];
    ok(
      await call('put', `/intake-forms/${d.id}`, adminA, {
        name: 'Fake Builder Form',
        category: 'PERSONAL_TAX',
        sections: fixed,
      }),
    );
    const live = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${d.id}/publish`, ownerA)),
    );
    expect(live).toMatchObject({ status: 'PUBLISHED', version: 1 });
    expect(live.publishedAt).toBeTruthy();
    expect(live.description).toBe('Fake description');
    ok(await call('post', `/intake-forms/${d.id}/publish`, ownerA));
  });

  it('saving a published form starts the next draft version; publishing retires the old one', async () => {
    const next = IntakeFormDetail.parse(
      ok(
        await call('put', `/intake-forms/${ids.built}`, ownerA, {
          name: 'Fake Builder Form v2',
          category: 'PERSONAL_TAX',
        }),
      ),
    );
    expect(next).toMatchObject({ version: 2, status: 'DRAFT', name: 'Fake Builder Form v2' });
    const list = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    expect(list.items.find((f) => f.id === ids.built)?.status).toBe('PUBLISHED');
    const v2 = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${ids.built}/publish`, ownerA)),
    );
    expect(v2).toMatchObject({ version: 2, status: 'PUBLISHED', name: 'Fake Builder Form v2' });
    const versions = await inFirm('a', (tx) =>
      tx.intakeForm.findMany({
        where: { templateId: ids.built },
        orderBy: { version: 'asc' },
        select: { status: true },
      }),
    );
    expect(versions.map((v) => v.status)).toEqual(['RETIRED', 'PUBLISHED']);
    expectError(
      await call('put', `/intake-forms/${ids.built}`, ownerA, {
        name: 'x',
        category: 'PERSONAL_TAX',
        serviceId: randomUUID(),
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('starts a form from a template, duplicates and archives', async () => {
    const from = IntakeFormDetail.parse(
      ok(
        await call('post', '/intake-forms', ownerA, {
          name: 'From the template',
          category: 'PERSONAL_TAX',
          startFrom: { kind: 'TEMPLATE', formId: ids.template },
        }),
        201,
      ),
    );
    const original = IntakeFormDetail.parse(
      ok(await call('get', `/intake-forms/${ids.template}`, ownerA)),
    );
    expect(from.sections.map((s) => s.key)).toEqual(original.sections.map((s) => s.key));
    const copy = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${ids.built}/duplicate`, adminA, {}), 201),
    );
    // USABILITY-03: an assigned form's own version, copied exactly; never another template's.
    const fromVersion = IntakeFormDetail.parse(
      ok(
        await call('post', `/intake-forms/${ids.template}/duplicate`, ownerA, { formId: ids.form }),
        201,
      ),
    );
    expect(fromVersion).toMatchObject({ status: 'DRAFT', name: 'Copy of Annual Tax Intake' });
    expectError(
      await call('post', `/intake-forms/${ids.built}/duplicate`, ownerA, { formId: ids.form }),
      404,
      'NOT_FOUND',
    );
    expect(copy.id).not.toBe(ids.built);
    expect(copy).toMatchObject({
      status: 'DRAFT',
      version: 1,
      name: 'Copy of Fake Builder Form v2',
    });
    const gone = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${ids.built}/archive`, ownerA)),
    );
    expect(gone.status).toBe('RETIRED');
    const list = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    expect(list.items.map((f) => f.id)).not.toContain(ids.built);
    expectError(
      await call('post', '/intakes/send', ownerA, sendBody({ formId: ids.built })),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('put', `/intake-forms/${ids.built}`, ownerA, {
        name: 'x',
        category: 'PERSONAL_TAX',
      }),
      409,
      'INVALID_STATUS',
    );
    expectError(await call('post', `/intake-forms/${copy.id}/archive`, staffA), 403, 'FORBIDDEN');
    // Intake Review 2 24c-i: the Archived view lists it; Restore (Owner and Admin) brings it back
    // as a draft, its content kept, ready to publish; audited once.
    const archivedView = IntakeFormList.parse(
      ok(await call('get', '/intake-forms?archived=true', ownerA)),
    );
    expect(archivedView.items.find((f) => f.id === ids.built)).toMatchObject({ archived: true });
    expect(archivedView.items.every((f) => f.archived)).toBe(true);
    expectError(await call('post', `/intake-forms/${ids.built}/restore`, staffA), 403, 'FORBIDDEN');
    const back = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${ids.built}/restore`, adminA)),
    );
    expect(back).toMatchObject({ status: 'DRAFT', archived: false, name: gone.name });
    expect(back.sections).toEqual(gone.sections);
    ok(await call('post', `/intake-forms/${ids.built}/restore`, adminA));
    const live = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    expect(live.items.map((f) => f.id)).toContain(ids.built);
    const restored = await inFirm('a', (tx) =>
      tx.auditLog.findMany({ where: { entityId: ids.built, action: 'intake_form.restored' } }),
    );
    expect(restored).toHaveLength(1);
    // Published again, it can be sent.
    expect(
      IntakeFormDetail.parse(ok(await call('post', `/intake-forms/${ids.built}/publish`, ownerA)))
        .status,
    ).toBe('PUBLISHED');
  });

  it('18d: a copy keeps every question, the description, the settings, the notes and the default assignee, and stays its own form', async () => {
    const content = [
      {
        key: 'about',
        title: 'About you',
        description: 'Fake section help',
        questions: [
          {
            key: 'fullName',
            type: 'SHORT_ANSWER',
            label: 'Full name',
            help: 'As on your ID (fake)',
            required: true,
          },
          {
            key: 'pick',
            type: 'DROPDOWN',
            label: 'Pick one',
            required: false,
            options: ['A', 'B'],
          },
          {
            key: 'why',
            type: 'PARAGRAPH',
            label: 'Why B',
            required: false,
            showIf: { questionKey: 'pick', equals: 'B' },
          },
        ],
      },
      {
        key: 'more',
        title: 'More',
        questions: [{ key: 'kids', type: 'YES_NO', label: 'Any children?', required: true }],
      },
    ];
    const source = IntakeFormDetail.parse(
      ok(
        await call('post', '/intake-forms', ownerA, {
          name: 'Fake Faithful Form',
          category: 'PERSONAL_TAX',
          description: 'Fake words for the client',
          internalNotes: 'Fake staff notes',
          sections: content,
          settings: {
            requireAllQuestions: true,
            allowFileUploads: false,
            requireSignature: true,
            showProgressBar: false,
            expiresAfterDays: 21,
            successMessage: 'Fake thanks',
          },
        }),
        201,
      ),
    );
    await inFirm('a', (tx) =>
      tx.intakeTemplate.update({
        where: { id: source.id },
        data: { defaultAssignedUserId: adminA.id },
      }),
    );
    const assignee = (id: string) =>
      inFirm('a', (tx) =>
        tx.intakeTemplate.findFirstOrThrow({
          where: { id },
          select: { defaultAssignedUserId: true },
        }),
      );
    const copy = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${source.id}/duplicate`, ownerA, {}), 201),
    );
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name: 'Copy of Fake Faithful Form',
      status: 'DRAFT',
      category: source.category,
      service: source.service,
      description: source.description,
      internalNotes: source.internalNotes,
      settings: source.settings,
    });
    expect(copy.sections).toEqual(source.sections);
    expect((await assignee(copy.id)).defaultAssignedUserId).toBe(adminA.id);
    // Changing the copy leaves the source as it was.
    ok(
      await call('put', `/intake-forms/${copy.id}`, ownerA, {
        name: 'Fake Faithful Form, changed',
        category: 'PERSONAL_TAX',
        description: 'Changed words',
        sections: content.slice(0, 1),
        settings: { requireSignature: false, expiresAfterDays: 3 },
      }),
    );
    const after = IntakeFormDetail.parse(
      ok(await call('get', `/intake-forms/${source.id}`, ownerA)),
    );
    expect(after).toMatchObject({
      name: source.name,
      description: source.description,
      settings: source.settings,
    });
    expect(after.sections).toEqual(source.sections);
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    for (const [method, path, body] of [
      ['get', `/intakes/${ids.sent}/record`, undefined],
      ['patch', `/intakes/${ids.sent}`, { dueOn: future(3) }],
      ['post', `/intakes/${ids.sent}/resend`, undefined],
      ['post', `/intakes/${ids.sent}/remind`, undefined],
      ['post', `/intakes/${ids.sent}/archive`, undefined],
      ['get', `/intakes/${ids.sent}/pdf`, undefined],
      ['post', `/intakes/${ids.sent}/notes`, { text: 'x' }],
      ['put', `/intake-forms/${ids.template}`, { name: 'x', category: 'PERSONAL_TAX' }],
      ['post', `/intake-forms/${ids.template}/publish`, undefined],
      ['post', `/intake-forms/${ids.template}/duplicate`, {}],
      ['post', `/intake-forms/${ids.template}/archive`, undefined],
      ['post', `/intake-forms/${ids.template}/restore`, undefined],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    expectError(await call('post', '/intakes/send', ownerB, sendBody(), 'b'), 404, 'NOT_FOUND');
    expect(
      z
        .object({ items: z.array(SendDraft) })
        .parse(ok(await call('get', '/intakes/send-drafts', ownerB, undefined, 'b'))).items,
    ).toEqual([]);
    expectError(await call('post', '/intakes/send', undefined, sendBody()), 401, 'UNAUTHENTICATED');
  });
});

describe('the intake schedule (Intake Forms Review Two 10c: reminders, the alert, Expired)', () => {
  const MIN = 60_000;
  /** A client of firm A with an active portal login, an engagement and the form sent by Email. */
  const sentForm = async (key: string, days = 20, extra: object = {}) => {
    const userId = randomUUID();
    const email = `${key}-${run}@client.test`;
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: userId, cognitoSub: userId, pool: 'CLIENT', email, name: `Fake ${key}` },
      }),
    );
    const clientId = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: { businessId: firms.a, displayName: `${key} (fake)`, email },
        select: { id: true },
      });
      await tx.engagement.create({
        data: { businessId: firms.a, clientId: c.id, serviceId: ids.service!, title: `${key} tax` },
      });
      await tx.clientAccount.create({
        data: {
          businessId: firms.a,
          userId,
          clientId: c.id,
          email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
      return c.id;
    });
    // 20 days: the first reminder (3 days in) and the final (7 days before) fall apart.
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const res = SendIntakeFormResult.parse(
      ok(
        await call(
          'post',
          '/intakes/send',
          ownerA,
          sendBody({
            recipient: { kind: 'CLIENT', id: clientId },
            channel: 'EMAIL',
            expiresAt,
            ...extra,
          }),
        ),
      ),
    );
    return { id: res.form.id, clientId, email, expiresAt: Date.parse(expiresAt) };
  };
  const row = (id: string) =>
    inFirm('a', (tx) =>
      tx.intake.findFirstOrThrow({
        where: { id },
        select: {
          status: true,
          reminderFirstMinutes: true,
          reminderFinalMinutes: true,
          expiryAlertMinutes: true,
          firstReminderSentAt: true,
          finalReminderSentAt: true,
          expiryAlertSentAt: true,
        },
      }),
    );
  const audits = (id: string) =>
    inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: id, action: { startsWith: 'intake.' } },
        select: { action: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  const reminders = (to: string) =>
    mail.filter((m) => m.template === 'intake.reminder' && m.to === to);

  it('keeps the schedule from sending; first and final reminders go once each by email, then the alert and Expired', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    const f = await sentForm('sched');
    // The firm's defaults, fixed on the form when it was sent.
    expect(await row(f.id)).toMatchObject({
      reminderFirstMinutes: 4320,
      reminderFinalMinutes: 10080,
      expiryAlertMinutes: 1440,
      firstReminderSentAt: null,
    });
    const at = (ms: number) => ({ now: new Date(ms), businessIds: [firms.a] });
    const sentAt = Date.now();
    // Nothing is due an hour in.
    await jobs.run('intake-reminders', at(sentAt + 60 * MIN));
    expect(reminders(f.email)).toEqual([]);
    // Three days in: the first reminder, by email, the exact form's link; once.
    await jobs.run('intake-reminders', at(sentAt + 4320 * MIN + MIN));
    await jobs.run('intake-reminders', at(sentAt + 4320 * MIN + 2 * MIN));
    expect(reminders(f.email)).toHaveLength(1);
    expect((reminders(f.email)[0]!.data as { link: string }).link).toMatch(
      new RegExp(`/intake/${f.id}$`),
    );
    expect((await row(f.id)).firstReminderSentAt).not.toBeNull();
    // Seven days before it expires: the final reminder (10c counts it back from the expiry).
    await jobs.run('intake-reminders', at(f.expiresAt - 10080 * MIN + MIN));
    expect(reminders(f.email)).toHaveLength(2);
    expect((await row(f.id)).finalReminderSentAt).not.toBeNull();
    // A day before: the staff's alert, once.
    await jobs.run('intake-expiry', at(f.expiresAt - 1440 * MIN + MIN));
    await jobs.run('intake-expiry', at(f.expiresAt - 1440 * MIN + 2 * MIN));
    expect((await row(f.id)).expiryAlertSentAt).not.toBeNull();
    // At the expiration: Expired, and it shows in the history.
    await jobs.run('intake-expiry', at(f.expiresAt + MIN));
    expect((await row(f.id)).status).toBe('EXPIRED');
    const actions = (await audits(f.id)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'intake.first_reminder_sent',
        'intake.final_reminder_sent',
        'intake.expiry_alert_sent',
        'intake.expired',
      ]),
    );
    expect(actions.filter((a) => a === 'intake.first_reminder_sent')).toHaveLength(1);
    const record = AssignedFormRecord.parse(
      ok(await call('get', `/intakes/${f.id}/record`, ownerA)),
    );
    expect(record.history.map((e) => e.label)).toEqual(
      expect.arrayContaining(['First reminder sent', 'Final reminder sent', 'Form expired']),
    );
    // An expired form takes no reminder.
    await jobs.run('intake-reminders', at(f.expiresAt + 2 * MIN));
    expect(reminders(f.email)).toHaveLength(2);
  });

  it('never emails a locked portal: the reminder is marked and audited as skipped, with its reason; another firm is untouched', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    const f = await sentForm('locked');
    await inFirm('a', (tx) =>
      tx.clientPortalLock.create({
        data: { businessId: firms.a, clientId: f.clientId, lockedByUserId: ownerA.id },
      }),
    );
    const due = new Date(Date.now() + 4320 * MIN + MIN);
    // Firm B's run never reaches firm A's form.
    await jobs.run('intake-reminders', { now: due, businessIds: [firms.b] });
    expect((await row(f.id)).firstReminderSentAt).toBeNull();
    await jobs.run('intake-reminders', { now: due, businessIds: [firms.a] });
    expect(reminders(f.email)).toEqual([]);
    expect((await row(f.id)).firstReminderSentAt).not.toBeNull();
    expect(
      (await audits(f.id)).find((a) => a.action === 'intake.reminder_skipped')?.metadata,
    ).toEqual({ kind: 'FIRST', reason: 'PORTAL_LOCKED' });
  });

  it('23-d to 23-f: one follow-up task per form, for its assignee, else the engagement staff (Route by service type), else the default owner', async () => {
    const automations = app.get(IntakeAutomations);
    const settings = (data: {
      autoCreateFollowUpTask?: boolean;
      routeByService?: boolean;
      followUpOwnerUserId?: string | null;
    }) =>
      inFirm('a', (tx) =>
        tx.intakeSettings.upsert({
          where: { businessId: firms.a },
          create: { businessId: firms.a, ...data },
          update: data,
        }),
      );
    const tasksOf = (intakeId: string) =>
      inFirm('a', (tx) =>
        tx.task.findMany({
          where: { businessId: firms.a, idempotencyKey: intakeId },
          select: { id: true, assignedUserId: true, clientId: true },
        }),
      );
    const submitted = async (key: string, assignedUserId: string | null) => {
      const f = await sentForm(key);
      await inFirm('a', async (tx) => {
        await tx.intake.update({
          where: { id: f.id },
          data: { assignedUserId, status: 'SUBMITTED' },
        });
        await tx.engagement.updateMany({
          where: { businessId: firms.a, clientId: f.clientId },
          data: { assignedUserId: staffA.id },
        });
      });
      return f;
    };
    await settings({
      autoCreateFollowUpTask: true,
      routeByService: true,
      followUpOwnerUserId: adminA.id,
    });
    // No assignee: the client's engagement staff, as Route by service type is on. Once only.
    const routed = await submitted('auto-route', null);
    const first = await automations.afterSubmit(firms.a, routed.id);
    expect((await automations.afterSubmit(firms.a, routed.id)).taskId).toBeNull();
    expect(await tasksOf(routed.id)).toEqual([
      { id: first.taskId, assignedUserId: staffA.id, clientId: routed.clientId },
    ]);
    // The form's assignee comes first.
    const assigned = await submitted('auto-assignee', otherStaffA.id);
    await automations.afterSubmit(firms.a, assigned.id);
    expect((await tasksOf(assigned.id)).map((t) => t.assignedUserId)).toEqual([otherStaffA.id]);
    // Route by service type off: the default follow-up owner.
    await settings({ routeByService: false });
    const fallback = await submitted('auto-default', null);
    await automations.afterSubmit(firms.a, fallback.id);
    expect((await tasksOf(fallback.id)).map((t) => t.assignedUserId)).toEqual([adminA.id]);
    // Off: nothing, as before.
    await settings({ autoCreateFollowUpTask: false });
    const off = await submitted('auto-off', null);
    expect(await automations.afterSubmit(firms.a, off.id)).toEqual({
      taskId: null,
      clientId: null,
    });
    expect(await tasksOf(off.id)).toEqual([]);
    const audits = await inFirm('a', (tx) =>
      tx.auditLog.count({
        where: { entityId: routed.id, action: 'intake.follow_up_task_created' },
      }),
    );
    expect(audits).toBe(1);
  });

  it('10c order: a first that would come after the final is skipped from the send, in History, and never sent', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    // 9 days: the final (7 days before) comes on day 2, the first (3 days in) on day 3.
    const f = await sentForm('order', 9);
    const skipped = async () =>
      (await audits(f.id))
        .filter((a) => a.action === 'intake.reminder_skipped')
        .map((a) => a.metadata);
    expect(await skipped()).toEqual([{ kind: 'FIRST', reason: 'AFTER_FINAL' }]);
    const at = (ms: number) => ({ now: new Date(ms), businessIds: [firms.a] });
    // Day 2: the final goes, and only the final is marked.
    await jobs.run('intake-reminders', at(f.expiresAt - 10080 * MIN + MIN));
    expect(reminders(f.email)).toHaveLength(1);
    expect(await row(f.id)).toMatchObject({ firstReminderSentAt: null });
    expect((await row(f.id)).finalReminderSentAt).not.toBeNull();
    // Day 3 and later: the first never goes.
    await jobs.run('intake-reminders', at(Date.now() + 4320 * MIN + MIN));
    expect(reminders(f.email)).toHaveLength(1);
    expect((await row(f.id)).firstReminderSentAt).toBeNull();
    expect(await skipped()).toHaveLength(1);
    const record = AssignedFormRecord.parse(
      ok(await call('get', `/intakes/${f.id}/record`, ownerA)),
    );
    expect(record.history.map((e) => e.label)).toEqual(
      expect.arrayContaining([
        'First reminder skipped: it would come after the final reminder',
        'Final reminder sent',
      ]),
    );
    expect(record.history.map((e) => e.label)).not.toContain('First reminder sent');
  });

  it("23-g: Auto-generate submission ID gives a sent form SUB-00012 on its record and in the client's completion; off, none", async () => {
    const settings = async (autoSubmissionId: boolean) => {
      const s = z
        .object({ version: z.string() })
        .parse(ok(await call('get', '/intake-settings', ownerA)));
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: s.version,
          general: { autoSubmissionId },
        }),
      );
    };
    const recordOf = async (id: string) =>
      AssignedFormRecord.parse(ok(await call('get', `/intakes/${id}/record`, ownerA)));
    await settings(true);
    const on = await sentForm('subid-on');
    const record = await recordOf(on.id);
    expect(record.submissionId).toMatch(/^SUB-\d{5}$/);
    const mine = await request(app.getHttpServer())
      .get(`/api/v1/portal/${slugs.a}/me/intakes/${on.id}`)
      .set('authorization', `Bearer ${await tokenFor(on.email)}`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((mine.body as { completion: { submissionId: string | null } }).completion).toMatchObject(
      {
        submissionId: record.submissionId,
      },
    );
    await settings(false);
    const off = await sentForm('subid-off');
    expect((await recordOf(off.id)).submissionId).toBeNull();
  });

  it('22: a submitted or completed form gets no reminder, even with one due', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    const submitted = await sentForm('stop-sub');
    const completed = await sentForm('stop-done');
    await inFirm('a', async (tx) => {
      await tx.intake.update({ where: { id: submitted.id }, data: { status: 'SUBMITTED' } });
      await tx.intake.update({ where: { id: completed.id }, data: { status: 'COMPLETED' } });
    });
    const at = (ms: number) => ({ now: new Date(ms), businessIds: [firms.a] });
    // Both reminders are due by then (first 3 days in, final 7 days before the expiry).
    await jobs.run('intake-reminders', at(Date.now() + 4320 * MIN + MIN));
    await jobs.run('intake-reminders', at(submitted.expiresAt - 10080 * MIN + MIN));
    for (const f of [submitted, completed]) {
      expect(reminders(f.email)).toEqual([]);
      expect(await row(f.id)).toMatchObject({
        firstReminderSentAt: null,
        finalReminderSentAt: null,
      });
    }
  });

  it('10c order: when the final goes before a first that was due (the job was behind), the first is skipped, never marked sent', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    const f = await sentForm('behind');
    // The job's first run is after both times: one reminder, the final.
    await jobs.run('intake-reminders', {
      now: new Date(f.expiresAt - 10080 * MIN + MIN),
      businessIds: [firms.a],
    });
    expect(reminders(f.email)).toHaveLength(1);
    expect(await row(f.id)).toMatchObject({ firstReminderSentAt: null });
    const actions = (await audits(f.id)).map((a) => [a.action, a.metadata]);
    expect(actions).toEqual(
      expect.arrayContaining([
        ['intake.final_reminder_sent', expect.anything()],
        ['intake.reminder_skipped', { kind: 'FIRST', reason: 'AFTER_FINAL' }],
      ]),
    );
  });

  it('22: the firm’s No reminders holds; a send asking for reminders gets none', async () => {
    ok(await call('get', '/intake-settings', ownerA));
    const reminding = (on: boolean) =>
      inFirm('a', (tx) =>
        tx.intakeSettings.update({
          where: { businessId: firms.a },
          data: { remindersEnabled: on },
        }),
      );
    await reminding(false);
    try {
      const f = await sentForm('noreminders', 20, { reminders: { enabled: true } });
      expect(await row(f.id)).toMatchObject({
        reminderFirstMinutes: null,
        reminderFinalMinutes: null,
      });
      await app.get(IntakeScheduleJobs).run('intake-reminders', {
        now: new Date(Date.now() + 4320 * MIN + MIN),
        businessIds: [firms.a],
      });
      expect(reminders(f.email)).toEqual([]);
    } finally {
      await reminding(true);
    }
  });

  it('22: the job takes only the forms with a reminder due, whatever older ones wait', async () => {
    const jobs = app.get(IntakeScheduleJobs);
    // The older form's first reminder is three days out; the newer one's is due in 5 minutes.
    const waiting = await sentForm('waiting');
    const soon = await sentForm('soon');
    await inFirm('a', (tx) =>
      tx.intake.update({ where: { id: soon.id }, data: { reminderFirstMinutes: 5 } }),
    );
    // One form per run: the oldest open one would have been the waiting one.
    await jobs.run('intake-reminders', {
      now: new Date(Date.now() + 6 * MIN),
      businessIds: [firms.a],
      batch: 1,
    });
    expect(reminders(soon.email)).toHaveLength(1);
    expect(reminders(waiting.email)).toEqual([]);
    expect((await row(waiting.id)).firstReminderSentAt).toBeNull();
  });

  it('Extend Expiration to a later time gives the final reminder and the alert their own time again', async () => {
    const f = await sentForm('extend');
    await inFirm('a', (tx) =>
      tx.intake.update({
        where: { id: f.id },
        data: { finalReminderSentAt: new Date(), expiryAlertSentAt: new Date() },
      }),
    );
    const later = new Date(f.expiresAt + 5 * 86_400_000).toISOString();
    ok(await call('patch', `/intakes/${f.id}`, ownerA, { expiresAt: later }));
    expect(await row(f.id)).toMatchObject({ finalReminderSentAt: null, expiryAlertSentAt: null });
  });
});

describe('Clients Review Two N8-23: no active service is needed to send a form', () => {
  it('sends a Bookkeeping form to a client with no service, on one pending request: fillable in the portal, nothing billed or started', async () => {
    const userId = randomUUID();
    const email = `noservice-${run}@client.test`;
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: userId, cognitoSub: userId, pool: 'CLIENT', email, name: 'Fake No Service' },
      }),
    );
    const { clientId, serviceId, templateId } = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: { businessId: firms.a, displayName: 'No Service (fake)', email },
        select: { id: true },
      });
      await tx.clientAccount.create({
        data: {
          businessId: firms.a,
          userId,
          clientId: c.id,
          email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
      const service = await tx.service.create({
        data: { businessId: firms.a, kind: 'BOOKKEEPING', name: `Books ${run}`, status: 'ACTIVE' },
        select: { id: true },
      });
      const def = INTAKE_FORMS.BOOKKEEPING;
      if (!def) throw new Error('the built-in bookkeeping form is missing');
      const form = await tx.intakeForm.create({
        data: {
          businessId: firms.a,
          serviceId: service.id,
          version: 1,
          title: 'Business Bookkeeping Intake (fake)',
          definition: def as object,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: ownerA.id,
        },
        select: { templateId: true },
      });
      return { clientId: c.id, serviceId: service.id, templateId: form.templateId as string };
    });
    const engagements = () =>
      inFirm('a', (tx) =>
        tx.engagement.findMany({
          where: { businessId: firms.a, clientId, serviceId },
          select: { id: true, status: true, title: true },
        }),
      );
    const send = () =>
      call(
        'post',
        '/intakes/send',
        ownerA,
        sendBody({ recipient: { kind: 'CLIENT', id: clientId }, formId: templateId }),
      );
    const first = SendIntakeFormResult.parse(ok(await send()));
    // Linked to one pending request for the service, as the screen says.
    const made = await engagements();
    expect(made).toEqual([
      { id: expect.any(String), status: 'PENDING', title: 'Requested (from an intake send)' },
    ]);
    // The client opens and fills it in the portal.
    const token = await tokenFor(email);
    const mine = await request(app.getHttpServer())
      .get(`/api/v1/portal/${slugs.a}/me/intakes/${first.form.id}`)
      .set('authorization', `Bearer ${token}`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    const saved = await request(app.getHttpServer())
      .put(`/api/v1/portal/${slugs.a}/me/intakes/${first.form.id}/steps/business`)
      .set('authorization', `Bearer ${token}`)
      .send({ answers: { firstName: 'Sam' } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // Nothing billed or started: no invoice, the request still pending, the client still New.
    const after = await inFirm('a', async (tx) => ({
      invoices: await tx.invoice.count({ where: { businessId: firms.a, clientId } }),
      client: (
        await tx.client.findFirstOrThrow({ where: { id: clientId }, select: { status: true } })
      ).status,
    }));
    expect(after).toEqual({ invoices: 0, client: 'NEW' });
    expect((await engagements()).map((e) => e.status)).toEqual(['PENDING']);
    // A second send (once the first is archived) reuses the pending request, never a second one.
    ok(await call('post', `/intakes/${first.form.id}/archive`, ownerA));
    SendIntakeFormResult.parse(ok(await send()));
    expect((await engagements()).map((e) => e.id)).toEqual([made[0]!.id]);
    const requested = await inFirm('a', (tx) =>
      tx.auditLog.count({ where: { businessId: firms.a, action: 'engagement.requested' } }),
    );
    expect(requested).toBeGreaterThanOrEqual(1);
  });
});

// Clients Review Two (N8-25): a form sent to a client who already has an active service for the
// form's service is linked to that service (the existing engagement), automatically: not to an
// older completed one, not to another service's, and no new request is made.
describe("Clients Review Two N8-25: a sent form links the client's existing active service", () => {
  it("links the sent form to the client's active engagement for the form's service, making no request", async () => {
    const userId = randomUUID();
    const email = `active-svc-${run}@client.test`;
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id: userId,
          cognitoSub: userId,
          pool: 'CLIENT',
          email,
          name: 'Fake Active Service',
        },
      }),
    );
    const f = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Active Service (fake)',
          email,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      await tx.clientAccount.create({
        data: {
          businessId: firms.a,
          userId,
          clientId: c.id,
          email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
      const service = (kind: 'BOOKKEEPING' | 'PAYROLL', name: string) =>
        tx.service.create({
          data: { businessId: firms.a, kind, name: `${name} ${run}`, status: 'ACTIVE' },
          select: { id: true },
        });
      const books = await service('BOOKKEEPING', 'Linked Books');
      const payroll = await service('PAYROLL', 'Linked Payroll');
      const engagement = (serviceId: string, status: 'ACTIVE' | 'COMPLETED', title: string) =>
        tx.engagement.create({
          data: {
            businessId: firms.a,
            clientId: c.id,
            serviceId,
            title,
            status,
            ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
          },
          select: { id: true },
        });
      const completed = await engagement(books.id, 'COMPLETED', 'Fake books 2024');
      const active = await engagement(books.id, 'ACTIVE', 'Fake books 2026');
      // Made last, so the newest of all: still never the one a Bookkeeping form links.
      const otherService = await engagement(payroll.id, 'ACTIVE', 'Fake payroll 2026');
      const def = INTAKE_FORMS.BOOKKEEPING;
      if (!def) throw new Error('the built-in bookkeeping form is missing');
      const form = await tx.intakeForm.create({
        data: {
          businessId: firms.a,
          serviceId: books.id,
          version: 1,
          title: 'Linked Bookkeeping Intake (fake)',
          definition: def as object,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: ownerA.id,
        },
        select: { templateId: true },
      });
      return {
        clientId: c.id,
        booksId: books.id,
        templateId: form.templateId as string,
        completed: completed.id,
        active: active.id,
        otherService: otherService.id,
      };
    });

    const sent = SendIntakeFormResult.parse(
      ok(
        await call(
          'post',
          '/intakes/send',
          ownerA,
          sendBody({ recipient: { kind: 'CLIENT', id: f.clientId }, formId: f.templateId }),
        ),
      ),
    );
    const after = await inFirm('a', async (tx) => ({
      linked: (
        await tx.intake.findUniqueOrThrow({
          where: { id: sent.form.id },
          select: { engagementId: true },
        })
      ).engagementId,
      engagements: await tx.engagement.findMany({
        where: { businessId: firms.a, clientId: f.clientId },
        select: { id: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
      requested: await tx.auditLog.count({
        where: {
          businessId: firms.a,
          action: 'engagement.requested',
          metadata: { path: ['clientId'], equals: f.clientId },
        },
      }),
    }));
    expect(after.linked).toBe(f.active);
    // Nothing new: the same three engagements, none of them a pending request.
    expect(after.engagements).toEqual([
      { id: f.completed, status: 'COMPLETED' },
      { id: f.active, status: 'ACTIVE' },
      { id: f.otherService, status: 'ACTIVE' },
    ]);
    expect(after.requested).toBe(0);
  });
});
