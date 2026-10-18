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
  IntakeFormDetail,
  IntakeFormList,
  INTAKE_FORMS,
  SendDraft,
  SendIntakeFormResult,
} from '@firmivra/types';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';

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
          pool: key === 'portalClient' ? 'CLIENT' : 'STAFF',
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
        sendBody({ recipient: { kind: 'LEAD', id: ids.lead }, channel: 'EMAIL' }),
      ),
      503,
      'LEAD_LINK_UNAVAILABLE',
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
      'NO_ENGAGEMENT',
    );
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
    expect(res.delivery).toEqual({ channel: 'PORTAL', status: 'SENT', to: 'Client portal' });
    expect(res.form).toMatchObject({
      status: 'SENT',
      recipient: { kind: 'CLIENT', id: ids.mineClient },
      form: { id: ids.template },
      assignedTo: { userId: staffA.id },
      dueOn: future(5),
    });
    expect(res.form.expiresOn).toBe(future(14));
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
    });
    ids.emailed = res.form.id;
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

  it('notes need their table: 503 after the checks', async () => {
    expectError(
      await call('post', `/intakes/${ids.sent}/notes`, ownerA, { text: 'Fake note' }),
      503,
      'NOTES_UNAVAILABLE',
    );
    expect((await call('post', `/intakes/${ids.sent}/notes`, ownerA, {})).status).toBe(400);
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
    expect(r.expiresOn).toBe(future(30));
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
    expectError(
      await call('post', `/intakes/${ids.leadForm}/resend`, ownerA),
      503,
      'LEAD_LINK_UNAVAILABLE',
    );
    expectError(await call('post', `/intakes/${ids.sent}/remind`, otherStaffA), 404, 'NOT_FOUND');
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
