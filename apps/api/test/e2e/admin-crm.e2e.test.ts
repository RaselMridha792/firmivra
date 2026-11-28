// End-to-end: Q35, Super Admin Leads & CRM backend P0 on the sales_lead_consents,
// sales_nurture_* and sales_demo_* tables. Every route under /api/v1/admin/crm: consent and
// suppression (which stops enrollments), journeys (draft, publish, the one-draft rule, the
// published version that never changes, pause and archive), enrollment (consent, suppression,
// once per journey, the step schedule), stop, demo requests (the opportunity of the same
// contact), booking (the DEMO follow-up) and appointment outcomes. Every change leaves an audit
// row. A firm's session reaches none of it.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  CrmConsent,
  CrmDemo,
  CrmDemoAppointment,
  CrmDemoList,
  CrmEnrollment,
  CrmEnrollmentList,
  CrmJourneyDetail,
  CrmJourneyList,
  CrmJourneyVersion,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/crm';
const run = randomUUID().slice(0, 8);
const ids = { template: '', archivedTemplate: '', pipeline: '', stage: '' };

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.69.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function owner<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(client, { kind: 'admin', adminUserId: fx.users.admin.id }, work);
  } finally {
    await client.$disconnect();
  }
}

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

type Method = 'get' | 'post' | 'put' | 'patch';
async function call(
  method: Method,
  path: string,
  body?: object,
  email = fx.users.admin.email,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;
const expectStatus = (res: Response, status: number) =>
  expect(res.status, JSON.stringify(res.body)).toBe(status);
const refused = async (res: Promise<Response>, status: number, errorCode: string) => {
  const r = await res;
  expect([r.status, code(r)], JSON.stringify(r.body)).toEqual([status, errorCode]);
};

let contacts = 0;
/** A new Sales contact (with an opportunity when asked). */
async function contact(withOpportunity = false) {
  contacts += 1;
  return owner(async (tx) => {
    const c = await tx.salesContact.create({
      data: { name: `Fake CRM Lead ${contacts}`, email: `crm-${run}-${contacts}@example.test` },
    });
    const opp = withOpportunity
      ? await tx.salesOpportunity.create({
          data: {
            pipelineId: ids.pipeline,
            stageId: ids.stage,
            contactId: c.id,
            title: `Fake CRM sale ${contacts}`,
          },
        })
      : null;
    return { id: c.id, opportunityId: opp?.id ?? null };
  });
}
const consent = (contactId: string, body: object) =>
  call('put', `/contacts/${contactId}/consent`, body);
const consented = async () => {
  const c = await contact();
  expectStatus(await consent(c.id, { consented: true, suppressed: false }), 200);
  return c;
};
const steps = (delays: number[]) =>
  delays.map((delayDays) => ({ delayDays, channel: 'EMAIL', templateId: ids.template }));

/** A journey with version 1 published (live), from the API. */
async function liveJourney(delays = [0, 2, 3]) {
  const j = CrmJourneyDetail.parse(
    (await call('post', '/journeys', { name: `Fake journey ${run}` })).body,
  );
  const v = CrmJourneyVersion.parse(
    (await call('post', `/journeys/${j.id}/versions`, { steps: steps(delays) })).body,
  );
  const res = await call('post', `/journeys/${j.id}/versions/${v.id}/publish`);
  expectStatus(res, 200);
  return CrmJourneyDetail.parse(res.body);
}

const audits = (entityId: string) =>
  owner((tx) =>
    tx.auditLog.findMany({ where: { entityId }, select: { action: true, businessId: true } }),
  );

beforeAll(async () => {
  await owner(async (tx) => {
    const category = await tx.commTemplateCategory.create({
      data: { name: `Fake CRM category ${run}`, position: 102 },
    });
    const template = (name: string, status: 'ACTIVE' | 'ARCHIVED') =>
      tx.commTemplate.create({
        data: {
          categoryId: category.id,
          name: `${name} ${run}`,
          channel: 'EMAIL',
          status,
          subject: 'Fake',
          body: 'Fake body',
        },
      });
    ids.template = (await template('Fake CRM template', 'ACTIVE')).id;
    ids.archivedTemplate = (await template('Fake CRM old template', 'ARCHIVED')).id;
    const shipped = await tx.salesPipeline.findFirstOrThrow({
      where: { systemKey: 'firmivra_default' },
      include: { stages: true },
    });
    ids.pipeline = shipped.id;
    ids.stage = shipped.stages.find((s) => s.systemKey === 'new_lead')!.id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('access', () => {
  it('a firm Owner’s session gets 401 on every CRM route', async () => {
    const c = await contact();
    const as = fx.users.ownerA.email;
    expect((await call('get', '/journeys', undefined, as)).status).toBe(401);
    expect((await call('get', '/demos', undefined, as)).status).toBe(401);
    expect((await call('get', `/contacts/${c.id}/consent`, undefined, as)).status).toBe(401);
    expect(
      (await call('put', `/contacts/${c.id}/consent`, { consented: true, suppressed: false }, as))
        .status,
    ).toBe(401);
  });

  it('a malformed id is 400 and an unknown one 404', async () => {
    expectStatus(await call('get', '/journeys/not-a-uuid'), 400);
    await refused(call('get', `/journeys/${randomUUID()}`), 404, 'NOT_FOUND');
    await refused(call('get', `/contacts/${randomUUID()}/consent`), 404, 'NOT_FOUND');
    await refused(call('get', `/demos/${randomUUID()}`), 404, 'NOT_FOUND');
  });
});

describe('consent', () => {
  it('reads defaults, saves, keeps the first consent time and audits', async () => {
    const c = await contact();
    expect(CrmConsent.parse((await call('get', `/contacts/${c.id}/consent`)).body)).toMatchObject({
      consented: false,
      suppressed: false,
      updatedAt: null,
    });
    const first = CrmConsent.parse(
      (await consent(c.id, { consented: true, consentSource: 'website_form', suppressed: false }))
        .body,
    );
    expect(first).toMatchObject({ consented: true, consentSource: 'website_form' });
    const again = CrmConsent.parse(
      (await consent(c.id, { consented: true, suppressed: false })).body,
    );
    expect(again.consentedAt).toBe(first.consentedAt);
    expect(again.consentSource).toBe('website_form');
    expect(await audits(c.id)).toEqual(
      expect.arrayContaining([{ action: 'crm_consent.saved', businessId: null }]),
    );
  });

  it('suppression needs a reason; an unknown contact is 404; extra fields are 400', async () => {
    const c = await contact();
    expectStatus(await consent(c.id, { consented: true, suppressed: true }), 400);
    expectStatus(
      await consent(c.id, { consented: true, suppressed: false, businessId: c.id }),
      400,
    );
    await refused(consent(randomUUID(), { consented: true, suppressed: false }), 404, 'NOT_FOUND');
  });

  it('suppressing a contact stops their active enrollments and skips what is left', async () => {
    const c = await consented();
    const j = await liveJourney();
    expectStatus(await call('post', `/journeys/${j.id}/enrollments`, { contactId: c.id }), 201);
    expectStatus(
      await consent(c.id, { consented: true, suppressed: true, suppressionReason: 'unsubscribe' }),
      200,
    );
    const [e] = CrmEnrollmentList.parse(
      (await call('get', `/journeys/${j.id}/enrollments`)).body,
    ).items;
    expect(e).toMatchObject({ status: 'STOPPED', stopReason: 'suppressed' });
    expect(e!.steps.every((s) => s.status === 'SKIPPED')).toBe(true);
  });
});

describe('journeys', () => {
  it('create, draft, publish: the journey goes live on its current version', async () => {
    const created = await call('post', '/journeys', { name: '  Fake Onboarding  ' });
    expectStatus(created, 201);
    const j = CrmJourneyDetail.parse(created.body);
    expect(j).toMatchObject({ name: 'Fake Onboarding', status: 'DRAFT', currentVersionId: null });
    const v = CrmJourneyVersion.parse(
      (await call('post', `/journeys/${j.id}/versions`, { steps: steps([1]) })).body,
    );
    expect(v).toMatchObject({ version: 1, publishedAt: null });
    await refused(
      call('post', `/journeys/${j.id}/versions`, { steps: steps([1]) }),
      409,
      'DRAFT_EXISTS',
    );
    const edited = await call('put', `/journeys/${j.id}/versions/${v.id}`, {
      steps: steps([1, 4]),
    });
    expectStatus(edited, 200);
    expect(CrmJourneyVersion.parse(edited.body).steps).toHaveLength(2);
    const live = CrmJourneyDetail.parse(
      (await call('post', `/journeys/${j.id}/versions/${v.id}/publish`)).body,
    );
    expect(live).toMatchObject({ status: 'ACTIVE', currentVersionId: v.id });
    expect(live.versions[0]!.publishedAt).not.toBeNull();
    const list = CrmJourneyList.parse((await call('get', '/journeys?status=ACTIVE')).body);
    expect(list.items.map((i) => i.id)).toContain(j.id);
    expect((await audits(j.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'crm_journey.created',
        'crm_journey_version.created',
        'crm_journey_version.updated',
        'crm_journey_version.published',
      ]),
    );
  });

  it('a published version never changes; v2 starts a new draft', async () => {
    const j = await liveJourney([1]);
    const v1 = j.versions[0]!;
    await refused(
      call('put', `/journeys/${j.id}/versions/${v1.id}`, { steps: steps([9]) }),
      409,
      'VERSION_PUBLISHED',
    );
    await refused(
      call('post', `/journeys/${j.id}/versions/${v1.id}/publish`),
      409,
      'VERSION_PUBLISHED',
    );
    const v2 = CrmJourneyVersion.parse(
      (await call('post', `/journeys/${j.id}/versions`, { steps: steps([2]) })).body,
    );
    expect(v2.version).toBe(2);
  });

  it('refuses an empty publish, an unusable template and ACTIVE without a version', async () => {
    const j = CrmJourneyDetail.parse(
      (await call('post', '/journeys', { name: 'Fake empty' })).body,
    );
    await refused(
      call('patch', `/journeys/${j.id}`, { status: 'ACTIVE' }),
      422,
      'NO_PUBLISHED_VERSION',
    );
    await refused(
      call('post', `/journeys/${j.id}/versions`, {
        steps: [{ delayDays: 1, channel: 'EMAIL', templateId: ids.archivedTemplate }],
      }),
      422,
      'TEMPLATE_NOT_USABLE',
    );
    const v = CrmJourneyVersion.parse(
      (await call('post', `/journeys/${j.id}/versions`, { steps: [] })).body,
    );
    await refused(call('post', `/journeys/${j.id}/versions/${v.id}/publish`), 422, 'EMPTY_JOURNEY');
    expectStatus(
      await call('post', `/journeys/${j.id}/versions`, {
        steps: [{ delayDays: 400, channel: 'EMAIL', templateId: ids.template }],
      }),
      400,
    );
  });

  it('pause blocks enrollment; archive stops everyone and is final', async () => {
    const j = await liveJourney([1]);
    const a = await consented();
    expectStatus(await call('post', `/journeys/${j.id}/enrollments`, { contactId: a.id }), 201);
    expectStatus(await call('patch', `/journeys/${j.id}`, { status: 'PAUSED' }), 200);
    const b = await consented();
    await refused(
      call('post', `/journeys/${j.id}/enrollments`, { contactId: b.id }),
      422,
      'JOURNEY_NOT_ACTIVE',
    );
    const archived = CrmJourneyDetail.parse(
      (await call('patch', `/journeys/${j.id}`, { status: 'ARCHIVED' })).body,
    );
    expect(archived).toMatchObject({ status: 'ARCHIVED', activeEnrollments: 0 });
    await refused(call('patch', `/journeys/${j.id}`, { name: 'Again' }), 409, 'JOURNEY_ARCHIVED');
    await refused(
      call('post', `/journeys/${j.id}/versions`, { steps: steps([1]) }),
      409,
      'JOURNEY_ARCHIVED',
    );
  });
});

describe('enrollments', () => {
  it('schedules each step from the enrollment, once per contact', async () => {
    const j = await liveJourney([0, 2, 3]);
    const c = await consented();
    const res = await call('post', `/journeys/${j.id}/enrollments`, { contactId: c.id });
    expectStatus(res, 201);
    const e = CrmEnrollment.parse(res.body);
    expect(e).toMatchObject({ status: 'ACTIVE', version: 1, contact: { id: c.id } });
    const start = new Date(e.enrolledAt).getTime();
    expect(e.steps.map((s) => (new Date(s.scheduledAt).getTime() - start) / 86_400_000)).toEqual([
      0, 2, 5,
    ]);
    expect(e.steps.every((s) => s.status === 'PENDING')).toBe(true);
    await refused(
      call('post', `/journeys/${j.id}/enrollments`, { contactId: c.id }),
      409,
      'ALREADY_ENROLLED',
    );
    expect((await audits(e.id)).map((a) => a.action)).toContain('crm_enrollment.created');
  });

  it('needs consent and no suppression', async () => {
    const j = await liveJourney([1]);
    const none = await contact();
    await refused(
      call('post', `/journeys/${j.id}/enrollments`, { contactId: none.id }),
      422,
      'NO_CONSENT',
    );
    const blocked = await contact();
    expectStatus(
      await consent(blocked.id, { consented: true, suppressed: true, suppressionReason: 'bounce' }),
      200,
    );
    await refused(
      call('post', `/journeys/${j.id}/enrollments`, { contactId: blocked.id }),
      422,
      'SUPPRESSED',
    );
    await refused(
      call('post', `/journeys/${j.id}/enrollments`, { contactId: randomUUID() }),
      404,
      'NOT_FOUND',
    );
  });

  it('stop: once, with a reason, skipping what is left', async () => {
    const j = await liveJourney([1, 1]);
    const c = await consented();
    const e = CrmEnrollment.parse(
      (await call('post', `/journeys/${j.id}/enrollments`, { contactId: c.id })).body,
    );
    expectStatus(await call('post', `/enrollments/${e.id}/stop`, { reason: '' }), 400);
    const stopped = CrmEnrollment.parse(
      (await call('post', `/enrollments/${e.id}/stop`, { reason: 'converted' })).body,
    );
    expect(stopped).toMatchObject({ status: 'STOPPED', stopReason: 'converted' });
    expect(stopped.stoppedAt).not.toBeNull();
    expect(stopped.steps.every((s) => s.status === 'SKIPPED')).toBe(true);
    await refused(
      call('post', `/enrollments/${e.id}/stop`, { reason: 'again' }),
      409,
      'ENROLLMENT_CLOSED',
    );
  });
});

describe('demos', () => {
  it('a request on the contact’s own opportunity; another contact’s is refused', async () => {
    const c = await contact(true);
    const other = await contact(true);
    await refused(
      call('post', '/demos', { contactId: c.id, opportunityId: other.opportunityId }),
      422,
      'OPPORTUNITY_MISMATCH',
    );
    await refused(call('post', '/demos', { contactId: randomUUID() }), 404, 'NOT_FOUND');
    const res = await call('post', '/demos', {
      contactId: c.id,
      opportunityId: c.opportunityId,
      topic: 'Fake platform tour',
      preferredTime: 'Weekday mornings',
    });
    expectStatus(res, 201);
    expect(CrmDemo.parse(res.body)).toMatchObject({
      status: 'PENDING',
      opportunityId: c.opportunityId,
      contact: { id: c.id },
      appointments: [],
    });
  });

  it('booking schedules the request and adds a DEMO follow-up on its opportunity', async () => {
    const c = await contact(true);
    const d = CrmDemo.parse(
      (await call('post', '/demos', { contactId: c.id, opportunityId: c.opportunityId })).body,
    );
    expectStatus(
      await call('post', `/demos/${d.id}/appointments`, {
        scheduledAt: inDays(2),
        videoLink: 'http://insecure.example.test/x',
      }),
      400,
    );
    expectStatus(
      await call('post', `/demos/${d.id}/appointments`, {
        scheduledAt: inDays(2),
        durationMinutes: 4,
      }),
      400,
    );
    const booked = CrmDemo.parse(
      (
        await call('post', `/demos/${d.id}/appointments`, {
          scheduledAt: inDays(2),
          durationMinutes: 45,
          videoLink: 'https://meet.example.test/fake',
        })
      ).body,
    );
    expect(booked.status).toBe('SCHEDULED');
    const a = booked.appointments[0]!;
    expect(a).toMatchObject({ durationMinutes: 45, status: 'SCHEDULED' });
    expect(a.followUpId).not.toBeNull();
    const followUp = await owner((tx) =>
      tx.salesFollowUp.findUniqueOrThrow({ where: { id: a.followUpId! } }),
    );
    expect(followUp).toMatchObject({
      kind: 'DEMO',
      opportunityId: c.opportunityId,
      assignedToUserId: fx.users.admin.id,
      status: 'SCHEDULED',
    });

    const moved = CrmDemoAppointment.parse(
      (await call('patch', `/demos/appointments/${a.id}`, { scheduledAt: inDays(3) })).body,
    );
    expect(moved.scheduledAt).not.toBe(a.scheduledAt);
    const done = await call('patch', `/demos/appointments/${a.id}`, { status: 'COMPLETED' });
    expectStatus(done, 200);
    expect(CrmDemo.parse((await call('get', `/demos/${d.id}`)).body).status).toBe('COMPLETED');
    expect(
      await owner((tx) => tx.salesFollowUp.findUniqueOrThrow({ where: { id: a.followUpId! } })),
    ).toMatchObject({ status: 'COMPLETED' });
    await refused(
      call('patch', `/demos/appointments/${a.id}`, { notes: 'late' }),
      409,
      'DEMO_CLOSED',
    );
    await refused(
      call('post', `/demos/${d.id}/appointments`, { scheduledAt: inDays(4) }),
      409,
      'DEMO_CLOSED',
    );
    expect((await audits(d.id)).map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'crm_demo.created',
        'crm_demo.booked',
        'crm_demo_appointment.updated',
      ]),
    );
  });

  it('cancelling the request cancels its booked appointments and follow-ups', async () => {
    const c = await contact(true);
    const d = CrmDemo.parse(
      (await call('post', '/demos', { contactId: c.id, opportunityId: c.opportunityId })).body,
    );
    const booked = CrmDemo.parse(
      (await call('post', `/demos/${d.id}/appointments`, { scheduledAt: inDays(1) })).body,
    );
    const cancelled = CrmDemo.parse(
      (await call('patch', `/demos/${d.id}`, { status: 'CANCELLED' })).body,
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.appointments[0]!.status).toBe('CANCELLED');
    expect(
      await owner((tx) =>
        tx.salesFollowUp.findUniqueOrThrow({ where: { id: booked.appointments[0]!.followUpId! } }),
      ),
    ).toMatchObject({ status: 'CANCELLED' });
    await refused(call('patch', `/demos/${d.id}`, { status: 'PENDING' }), 409, 'DEMO_CLOSED');
    const list = CrmDemoList.parse((await call('get', '/demos?status=CANCELLED')).body);
    expect(list.items.map((i) => i.id)).toContain(d.id);
    expectStatus(await call('patch', `/demos/${d.id}`, { status: 'SCHEDULED' }), 400);
  });
});
