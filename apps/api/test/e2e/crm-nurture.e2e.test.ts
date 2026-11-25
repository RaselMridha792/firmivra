// End-to-end: Q35 block 6, the nurture sender job. Due steps of active enrollments are sent by
// email with the template's merge fields filled; the last one completes the enrollment. A
// paused journey waits; a contact without consent at send time is stopped; a template no longer
// active fails the step; a refused send is retried (15, 30, 60 minutes) and then FAILED with its
// enrollment. Each run here is limited to this file's own journeys.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { CrmEnrollment, CrmJourneyDetail, CrmJourneyVersion } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  CRM_NURTURE_MAX_RETRIES,
  CrmNurtureSender,
  retryDelayMs,
} from '../../src/crm/crm-nurture.job.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/crm';
const run = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const ids = { template: '', category: '' };

type Sent = { template: string; to: string; data: { subject: string; body: string } };
const sent: Sent[] = [];
/** When set, the next sends are refused with this provider reason. */
let refuse: string | null = null;

let app: INestApplication;
let sender: CrmNurtureSender;
let token = '';

async function owner<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(client, { kind: 'admin', adminUserId: fx.users.admin.id }, work);
  } finally {
    await client.$disconnect();
  }
}

function call(method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object) {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${token}`)
    .set('x-forwarded-for', '198.70.1.1, 10.0.0.5');
  return body === undefined ? req : req.send(body);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

let contacts = 0;
async function consentedContact(
  email: string | null = `nurture-${run}-${++contacts}@example.test`,
) {
  const c = await owner((tx) =>
    tx.salesContact.create({ data: { name: `Fakey Lead${contacts}`, email } }),
  );
  ok(await call('put', `/contacts/${c.id}/consent`, { consented: true, suppressed: false }));
  return c.id;
}

const journeys: string[] = [];
/** A live journey with one step per delay, and a consented contact enrolled on it. */
async function enrolled(delays: number[], email?: string | null) {
  const j = CrmJourneyDetail.parse(
    ok(await call('post', '/journeys', { name: 'Fake nurture' }), 201),
  );
  journeys.push(j.id);
  const steps = delays.map((delayDays) => ({
    delayDays,
    channel: 'EMAIL',
    templateId: ids.template,
  }));
  const v = CrmJourneyVersion.parse(
    ok(await call('post', `/journeys/${j.id}/versions`, { steps }), 201),
  );
  ok(await call('post', `/journeys/${j.id}/versions/${v.id}/publish`));
  const contactId = await consentedContact(email);
  const e = CrmEnrollment.parse(
    ok(await call('post', `/journeys/${j.id}/enrollments`, { contactId }), 201),
  );
  return { journeyId: j.id, contactId, enrollment: e, at: new Date(e.enrolledAt).getTime() };
}
const enrollment = async (journeyId: string) =>
  CrmEnrollment.parse(
    (ok(await call('get', `/journeys/${journeyId}/enrollments`)) as { items: unknown[] }).items[0],
  );
const tick = (now: number) => sender.run({ now: new Date(now), journeyIds: journeys });

beforeAll(async () => {
  await owner(async (tx) => {
    ids.category = (
      await tx.commTemplateCategory.create({
        data: { name: `Fake nurture category ${run}`, position: 103 },
      })
    ).id;
    ids.template = (
      await tx.commTemplate.create({
        data: {
          categoryId: ids.category,
          name: `Fake nurture template ${run}`,
          channel: 'EMAIL',
          subject: 'Hello {{contact.first_name}}',
          body: 'Hi {{contact.first_name}}, this is {{platform.name}}.',
          mergeFields: ['contact.first_name', 'platform.name'],
        },
      })
    ).id;
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
    .useValue({
      send: (message: Sent) => {
        if (refuse) return Promise.reject(Object.assign(new Error('refused'), { reason: refuse }));
        sent.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  sender = nest.get(CrmNurtureSender);
  token = (
    (
      await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .set('x-forwarded-for', '198.70.1.1, 10.0.0.5')
        .send({ email: fx.users.admin.email })
        .expect(200)
    ).body as { token: string }
  ).token;
});

beforeEach(() => {
  sent.length = 0;
  refuse = null;
});

afterAll(async () => {
  await app.close();
});

describe('the nurture sender', () => {
  it('sends each step when due, fills the merge fields, then completes', async () => {
    const e = await enrolled([0, 2]);
    const first = await tick(e.at + 60_000);
    expect(first).toMatchObject({ skipped: false, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      template: 'platform.message-email',
      data: { subject: 'Hello Fakey', body: `Hi Fakey, this is Firmivra.` },
    });
    let now = await enrollment(e.journeyId);
    expect(now.steps.map((s) => s.status)).toEqual(['SENT', 'PENDING']);
    expect(now.status).toBe('ACTIVE');

    // Not due yet: nothing more goes out.
    await tick(e.at + DAY);
    expect(sent).toHaveLength(1);

    await tick(e.at + 2 * DAY + 60_000);
    expect(sent).toHaveLength(2);
    now = await enrollment(e.journeyId);
    expect(now.steps.map((s) => s.status)).toEqual(['SENT', 'SENT']);
    expect(now.status).toBe('COMPLETED');
    expect(now.completedAt).not.toBeNull();
  });

  it('a paused journey waits, and sends once it resumes', async () => {
    const e = await enrolled([0]);
    ok(await call('patch', `/journeys/${e.journeyId}`, { status: 'PAUSED' }));
    await tick(e.at + 60_000);
    expect(sent).toHaveLength(0);
    expect((await enrollment(e.journeyId)).steps[0]!.status).toBe('PENDING');
    ok(await call('patch', `/journeys/${e.journeyId}`, { status: 'ACTIVE' }));
    await tick(e.at + 120_000);
    expect(sent).toHaveLength(1);
  });

  it('stops a contact whose consent was withdrawn before the send', async () => {
    const e = await enrolled([0, 1]);
    ok(
      await call('put', `/contacts/${e.contactId}/consent`, {
        consented: false,
        suppressed: false,
      }),
    );
    const res = await tick(e.at + 60_000);
    expect(res).toMatchObject({ stopped: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    const now = await enrollment(e.journeyId);
    expect(now).toMatchObject({ status: 'STOPPED', stopReason: 'no_consent' });
    expect(now.steps.every((s) => s.status === 'SKIPPED')).toBe(true);
  });

  it('a template archived after publishing fails the step and the enrollment', async () => {
    const e = await enrolled([0]);
    await owner((tx) =>
      tx.commTemplate.update({ where: { id: ids.template }, data: { status: 'ARCHIVED' } }),
    );
    try {
      await tick(e.at + 60_000);
      const now = await enrollment(e.journeyId);
      expect(now.status).toBe('FAILED');
      expect(now.steps[0]!.status).toBe('FAILED');
      expect(sent).toHaveLength(0);
    } finally {
      await owner((tx) =>
        tx.commTemplate.update({ where: { id: ids.template }, data: { status: 'ACTIVE' } }),
      );
    }
  });

  it('retries a refused send at 15, 30 and 60 minutes, then fails', async () => {
    const e = await enrolled([0]);
    refuse = 'InvalidRecipient';
    let at = e.at + 60_000;
    for (let retry = 1; retry <= CRM_NURTURE_MAX_RETRIES; retry++) {
      expect(await tick(at)).toMatchObject({ retried: 1 });
      const step = (await enrollment(e.journeyId)).steps[0]!;
      expect(step).toMatchObject({ status: 'PENDING', retryCount: retry });
      expect(new Date(step.scheduledAt).getTime()).toBe(at + retryDelayMs(retry));
      // Before the retry is due, nothing is tried.
      expect(await tick(at + retryDelayMs(retry) - 1_000)).toMatchObject({ retried: 0 });
      at += retryDelayMs(retry);
    }
    expect(await tick(at)).toMatchObject({ failed: 1 });
    const now = await enrollment(e.journeyId);
    expect(now.status).toBe('FAILED');
    expect(now.steps[0]).toMatchObject({ status: 'FAILED', retryCount: CRM_NURTURE_MAX_RETRIES });
  });

  it('a contact with no email fails the step without a send', async () => {
    const e = await enrolled([0], null);
    expect(await tick(e.at + 60_000)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
    expect((await enrollment(e.journeyId)).status).toBe('FAILED');
  });
});
