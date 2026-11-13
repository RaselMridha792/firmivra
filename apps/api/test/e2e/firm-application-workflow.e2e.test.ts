// End-to-end: the Oct 31 Super Admin review's application workflow (SA-APP-F02 to F09, Y01, Y04):
// In Review on open (an explicit POST), Request Additional Information with its own request record
// and a protected link (only the token's hash is kept), Request again, Approve and Decline from
// In Review and Awaiting Information, the assigned reviewer, last activity, the request state, a
// response's files (viewed only once scanned clean) and the counts. The NotifyService is a recorder.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  FirmApplicationCounts,
  FirmApplicationFileLink,
  FirmApplicationRecord,
  FirmApplicationReviewers,
  ListFirmApplicationsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage[] = [];

const tag = `r55wf${randomUUID().slice(0, 8)}`;
const ids = {
  opened: randomUUID(),
  asked: randomUUID(),
  decided: randomUUID(),
  approved: randomUUID(),
  assigned: randomUUID(),
  answered: randomUUID(),
  other: randomUUID(),
};

const stored = (n: number) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Workflow ${tag} ${n}`,
    dbaName: null,
    entityType: 'LLC',
    email: null,
    phone: null,
    website: null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['BOOKKEEPING'],
  },
  primaryAdmin: {
    fullName: `Casey Example ${n}`,
    email: `casey${n}@${tag}.example.test`,
    phone: '+14045550102',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'STARTER',
    teamSize: 2,
    clientVolume: 'UNDER_100',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

async function asOwner<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'platform' }, fn);
  } finally {
    await owner.$disconnect();
  }
}
const base = (id: string) => `/api/v1/admin/firm-applications/${id}`;
const call = (method: 'get' | 'post' | 'put', path: string, body?: unknown, token = adminToken) => {
  const req = request(app.getHttpServer())[method](path).set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
};
const record = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return FirmApplicationRecord.parse(res.body);
};
const codeOf = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
/** The link's token from an info-requested email (after "#token="). */
const tokenIn = (m: NotifyMessage) => {
  const link = (m.data as { link: string }).link;
  expect(link).toMatch(/\/apply\/respond#token=[A-Za-z0-9_-]{43}$/);
  return link.slice(link.indexOf('#token=') + 7);
};
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

beforeAll(async () => {
  await asOwner(async (tx) => {
    let n = 0;
    for (const id of Object.values(ids)) {
      const data = stored(++n);
      await tx.firmApplication.create({
        data: {
          id,
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: data.primaryAdmin.email,
          contactPhone: data.primaryAdmin.phone,
          data,
        },
      });
    }
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: (m: NotifyMessage) => (sent.push(m), Promise.resolve()) })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  adminToken = (
    (
      await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: fx.users.admin.email })
    ).body as { token: string }
  ).token;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('In Review on open (SA-APP-F02)', () => {
  it('reading changes nothing; the explicit open moves Pending to In Review once, recorded', async () => {
    expect(record(await call('get', base(ids.opened))).status).toBe('PENDING_REVIEW');
    await call('get', `/api/v1/admin/firm-applications?search=${tag}`).expect(200);
    expect(record(await call('get', base(ids.opened))).status).toBe('PENDING_REVIEW');

    const opened = record(await call('post', `${base(ids.opened)}/open`));
    expect(opened.status).toBe('IN_REVIEW');
    expect(opened.history[0]).toMatchObject({
      type: 'REVIEW_STARTED',
      by: { userId: fx.users.admin.id },
    });
    expect(opened.lastActivity.event).toBe('REVIEW_STARTED');
    expect(opened.can).toMatchObject({ requestInfo: true, approve: true, decline: true });
    // Again: no change, no second entry.
    const again = record(await call('post', `${base(ids.opened)}/open`));
    expect(again.history.filter((h) => h.type === 'REVIEW_STARTED')).toHaveLength(1);
    const audited = await asOwner((tx) =>
      tx.auditLog.count({
        where: { action: 'firm_application.review_started', entityId: ids.opened },
      }),
    );
    expect(audited).toBe(1);
  });
});

describe('Request Additional Information (SA-APP-F03)', () => {
  it('makes a request record and a protected link, then Request again closes the earlier one', async () => {
    const asked = record(
      await call('post', `${base(ids.asked)}/request-info`, { message: 'Please send your PTIN.' }),
    );
    expect(asked.status).toBe('INFO_REQUESTED');
    expect(asked.requestState.state).toBe('WAITING');
    expect(asked.requests).toHaveLength(1);
    expect(asked.requests[0]).toMatchObject({ reason: 'Please send your PTIN.', status: 'OPEN' });
    const days = (Date.parse(asked.requests[0]?.expiresAt ?? '') - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ template: 'firm-application.info-requested' });
    const first = tokenIn(sent[0] as NotifyMessage);
    // Only the token's hash is stored.
    const rows = await asOwner((tx) =>
      tx.firmApplicationInfoRequest.findMany({ where: { applicationId: ids.asked } }),
    );
    expect(rows.map((r) => r.tokenHash)).toEqual([sha(first)]);
    expect(JSON.stringify(rows)).not.toContain(first);

    // The same message again (a double click): nothing changes, nothing is sent.
    sent.length = 0;
    const same = record(
      await call('post', `${base(ids.asked)}/request-info`, { message: 'Please send your PTIN.' }),
    );
    expect(same.requests).toHaveLength(1);
    expect(sent).toHaveLength(0);

    // Request again: the open one is closed, a new one opens with a new link.
    const again = record(
      await call('post', `${base(ids.asked)}/request-info`, {
        message: 'Please also send the EIN letter.',
      }),
    );
    expect(again.status).toBe('INFO_REQUESTED');
    expect(again.requests.map((r) => r.status)).toEqual(['OPEN', 'SUPERSEDED']);
    expect(again.requests[1]?.closedAt).not.toBeNull();
    expect(tokenIn(sent[0] as NotifyMessage)).not.toBe(first);
    expect(again.history.filter((h) => h.type === 'INFO_REQUESTED')).toHaveLength(2);
  });
});

describe('Approve and Decline from In Review and Awaiting Information (SA-APP-F05)', () => {
  it('declines an application awaiting information and closes its open request', async () => {
    record(
      await call('post', `${base(ids.decided)}/request-info`, { message: 'Send the license.' }),
    );
    const declined = record(
      await call('post', `${base(ids.decided)}/decline`, { reason: 'Not a tax practice.' }),
    );
    expect(declined.status).toBe('DECLINED');
    expect(declined.requests[0]?.status).toBe('SUPERSEDED');
    expect(declined.can).toMatchObject({ requestInfo: false, approve: false, assign: false });
    expect(declined.lastActivity.event).toBe('DECIDED');
  });

  it('approves an application in review', async () => {
    record(await call('post', `${base(ids.approved)}/open`));
    const approved = record(await call('post', `${base(ids.approved)}/approve`, {}));
    expect(approved.status).toBe('APPROVED');
    expect(approved.firm?.status).toBe('PENDING_SETUP');
  });
});

describe('the assigned reviewer (SA-APP-F06)', () => {
  it('lists the reviewers, assigns, unassigns, and records each change', async () => {
    const reviewers = FirmApplicationReviewers.parse(
      (await call('get', '/api/v1/admin/firm-applications/reviewers').expect(200)).body,
    );
    expect(reviewers.items.map((r) => r.userId)).toContain(fx.users.admin.id);
    const assigned = record(
      await call('put', `${base(ids.assigned)}/reviewer`, { userId: fx.users.admin.id }),
    );
    expect(assigned.assignedReviewer?.userId).toBe(fx.users.admin.id);
    expect(assigned.history[0]).toMatchObject({ type: 'REVIEWER_ASSIGNED' });
    expect(assigned.lastActivity.event).toBe('REVIEWER_ASSIGNED');
    // Shown again when reopened, and on the list.
    expect(record(await call('get', base(ids.assigned))).assignedReviewer?.userId).toBe(
      fx.users.admin.id,
    );
    const list = ListFirmApplicationsResponse.parse(
      (await call('get', `/api/v1/admin/firm-applications?search=${tag}&pageSize=100`)).body,
    );
    expect(list.items.find((i) => i.id === ids.assigned)?.assignedReviewer?.userId).toBe(
      fx.users.admin.id,
    );
    const cleared = record(await call('put', `${base(ids.assigned)}/reviewer`, { userId: null }));
    expect(cleared.assignedReviewer).toBeNull();
    expect(cleared.history[0]).toMatchObject({ type: 'REVIEWER_ASSIGNED', message: 'Unassigned' });
    // Not an admin: 404. A decided application: 409.
    const unknown = await call('put', `${base(ids.assigned)}/reviewer`, { userId: randomUUID() });
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'NOT_FOUND']);
    const decided = await call('put', `${base(ids.decided)}/reviewer`, {
      userId: fx.users.admin.id,
    });
    expect([decided.status, codeOf(decided)]).toEqual([409, 'APPLICATION_DECIDED']);
  });
});

describe('a response and its files (SA-APP-F04 read side, F08, F09)', () => {
  it('shows the answered request, and opens a file only once scanned clean, on its own application', async () => {
    record(
      await call('post', `${base(ids.answered)}/request-info`, { message: 'Send the letter.' }),
    );
    // The applicant's answer, as the response page writes it (platform scope).
    const file = await asOwner(async (tx) => {
      const req = await tx.firmApplicationInfoRequest.findFirstOrThrow({
        where: { applicationId: ids.answered, status: 'OPEN' },
      });
      const response = await tx.firmApplicationResponse.create({
        data: { applicationId: ids.answered, requestId: req.id, text: 'Attached is the letter.' },
      });
      const f = await tx.firmApplicationResponseFile.create({
        data: {
          applicationId: ids.answered,
          responseId: response.id,
          s3Key: `tenant/${ids.answered}/applications/${response.id}/${randomUUID()}.pdf`,
          fileName: 'letter.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1200,
        },
      });
      await tx.firmApplicationInfoRequest.update({
        where: { id: req.id },
        data: { status: 'RESPONDED', closedAt: new Date() },
      });
      await tx.firmApplication.update({
        where: { id: ids.answered },
        data: { status: 'IN_REVIEW' },
      });
      return f;
    });
    const seen = record(await call('get', base(ids.answered)));
    expect(seen.status).toBe('IN_REVIEW');
    expect(seen.requestState.state).toBe('RESPONDED');
    expect(seen.lastActivity.event).toBe('RESPONSE_RECEIVED');
    expect(seen.requests[0]).toMatchObject({ status: 'RESPONDED' });
    expect(seen.requests[0]?.responses[0]).toMatchObject({ text: 'Attached is the letter.' });
    expect(seen.requests[0]?.responses[0]?.files[0]).toMatchObject({
      id: file.id,
      fileName: 'letter.pdf',
      scanStatus: 'PENDING',
    });
    expect(seen.history.some((h) => h.type === 'RESPONSE_RECEIVED')).toBe(true);

    const pending = await call('get', `${base(ids.answered)}/files/${file.id}`);
    expect([pending.status, codeOf(pending)]).toEqual([409, 'FILE_NOT_READY']);
    await asOwner((tx) =>
      tx.firmApplicationResponseFile.update({
        where: { id: file.id },
        data: { scanStatus: 'CLEAN' },
      }),
    );
    const link = FirmApplicationFileLink.parse(
      (await call('get', `${base(ids.answered)}/files/${file.id}`).expect(200)).body,
    );
    expect(link.fileName).toBe('letter.pdf');
    expect(link.url).toContain(file.s3Key.split('/').at(-1));
    // Another application's path never reaches the file.
    const elsewhere = await call('get', `${base(ids.other)}/files/${file.id}`);
    expect([elsewhere.status, codeOf(elsewhere)]).toEqual([404, 'NOT_FOUND']);
    const viewed = await asOwner((tx) =>
      tx.auditLog.count({
        where: { action: 'firm_application.file_viewed', entityId: ids.answered },
      }),
    );
    expect(viewed).toBe(1);
  });
});

describe('the list and the counts (SA-APP-F07, F08, Y04)', () => {
  it('orders by last activity, filters each status, and the counts add up', async () => {
    const list = async (q: string) =>
      ListFirmApplicationsResponse.parse(
        (await call('get', `/api/v1/admin/firm-applications?search=${tag}&pageSize=100${q}`)).body,
      );
    const byActivity = (await list('&order=activity')).items.map((i) => i.lastActivity.at);
    expect([...byActivity].sort().reverse()).toEqual(byActivity);
    expect((await list('&status=IN_REVIEW')).items.map((i) => i.status)).not.toHaveLength(0);
    expect(new Set((await list('&status=INFO_REQUESTED')).items.map((i) => i.status))).toEqual(
      new Set(['INFO_REQUESTED']),
    );
    const asked = (await list('')).items.find((i) => i.id === ids.asked);
    expect(asked?.requestState.state).toBe('WAITING');
    const approved = (await list('')).items.find((i) => i.id === ids.approved);
    expect(approved?.accountStatus).toBe('PENDING_SETUP');

    const c = FirmApplicationCounts.parse(
      (await call('get', '/api/v1/admin/firm-applications/counts').expect(200)).body,
    );
    expect(c.all).toBe(
      c.pendingReview + c.inReview + c.awaitingInformation + c.approved + c.declined,
    );
    expect(c.inReview).toBeGreaterThanOrEqual(2);
    expect(c.awaitingInformation).toBeGreaterThanOrEqual(1);
  });

  it('refuses a firm session on the new routes', async () => {
    const staff = (
      (
        await request(app.getHttpServer())
          .post('/api/v1/dev/token')
          .send({ email: fx.users.ownerA.email })
      ).body as { token: string }
    ).token;
    for (const [method, path, body] of [
      ['post', `${base(ids.other)}/open`, undefined],
      ['put', `${base(ids.other)}/reviewer`, { userId: null }],
      ['get', '/api/v1/admin/firm-applications/reviewers', undefined],
      ['get', `${base(ids.other)}/files/${randomUUID()}`, undefined],
    ] as const) {
      const res = await call(method, path, body, staff);
      expect([401, 403]).toContain(res.status);
    }
    expect(record(await call('get', base(ids.other))).status).toBe('PENDING_REVIEW');
  });
});
