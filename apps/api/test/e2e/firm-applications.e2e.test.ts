// End-to-end: the Super Admin's read side of firm applications (R4 step 1 and T05): the list
// with filters and pages, counts, the review page with history and checks, firms, the dashboard.
// Applications are written the way the app writes them: submitted in platform scope, reviewed in
// admin scope (the database records the history).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminDashboard,
  FirmApplicationCounts,
  FirmApplicationRecord,
  FirmCounts,
  FirmRecord,
  ListFirmApplicationsResponse,
  ListFirmsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;

/** A word only this file's applications contain, so other tests' rows never disturb the lists. */
const tag = `r4e2e${randomUUID().slice(0, 8)}`;
const ids = {
  pending: randomUUID(),
  asked: randomUUID(),
  approved: randomUUID(),
  declined: randomUUID(),
};
const firm = { id: randomUUID(), slug: `${tag}-approved-tax` };

/** The stored form (`data`), as submit writes it: the review page's groups, EIN last 4 only. */
const stored = (n: number, email: string) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Tax ${tag} ${n}`,
    dbaName: null,
    entityType: 'LLC',
    einLast4: '0001',
    email: null,
    phone: null,
    website: n === 1 ? 'https://sample.example.test' : null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: `Jordan Sample ${n}`,
    email,
    phone: '+14045550101',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: 3,
    clientVolume: 'FROM_250',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
const get = (path: string, token = adminToken) =>
  request(app.getHttpServer()).get(`/api/v1${path}`).set('authorization', `Bearer ${token}`);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  const rows: [string, number, string][] = [
    [ids.pending, 1, 'jordan1@sample.example.test'],
    [ids.asked, 2, 'jordan2@mail.example.test'],
    [ids.approved, 3, 'jordan3@mail.example.test'],
    // Same email as the pending one: the DUPLICATE_EMAIL check warns on both.
    [ids.declined, 4, 'jordan1@sample.example.test'],
  ];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, n, email] of rows) {
      const data = stored(n, email);
      await tx.firmApplication.create({
        data: {
          id,
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: email,
          contactPhone: data.primaryAdmin.phone,
          data,
        },
      });
    }
    await tx.business.create({
      data: { id: firm.id, slug: firm.slug, name: `Sample Tax ${tag} 3`, status: 'PENDING_SETUP' },
    });
  });
  const asAdmin = { kind: 'admin', adminUserId: fx.users.admin.id } as const;
  const review = (id: string, data: Record<string, unknown>) =>
    runInScope(owner, asAdmin, (tx) =>
      tx.firmApplication.update({
        where: { id },
        data: { reviewedByUserId: fx.users.admin.id, reviewedAt: new Date(), ...data },
      }),
    );
  // Request Information keeps it pending and sets the message (the trigger writes history).
  await review(ids.asked, { decisionReason: 'Please send your PTIN.' });
  await review(ids.approved, { decisionReason: 'Please send your PTIN.' });
  await review(ids.approved, { status: 'APPROVED' });
  await review(ids.declined, { status: 'DECLINED', decisionReason: 'Not a tax practice.' });
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.firmApplication.update({ where: { id: ids.approved }, data: { businessId: firm.id } }),
  );
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  adminToken = await tokenFor(fx.users.admin.email);
});

afterAll(async () => {
  await app.close();
});

describe('the contract', () => {
  it('every answer parses with the schema the web client uses', async () => {
    const checks = [
      [`/admin/firm-applications?search=${tag}`, ListFirmApplicationsResponse],
      ['/admin/firm-applications/counts', FirmApplicationCounts],
      ...Object.values(ids).map(
        (id) => [`/admin/firm-applications/${id}`, FirmApplicationRecord] as const,
      ),
      [`/admin/firms?search=${tag}`, ListFirmsResponse],
      ['/admin/firms/counts', FirmCounts],
      [`/admin/firms/${firm.id}`, FirmRecord],
      ['/admin/dashboard', AdminDashboard],
    ] as const;
    for (const [path, schema] of checks) {
      const res = await get(path).expect(200);
      expect(schema.safeParse(res.body).error?.issues ?? [], path).toEqual([]);
    }
  });
});

describe('who may read', () => {
  it('answers Super Admins only: firm and client sessions get 401 on admin routes', async () => {
    for (const email of [fx.users.ownerA.email, fx.users.clientA.email]) {
      const token = await tokenFor(email);
      for (const path of ['/admin/firm-applications', '/admin/firms', '/admin/dashboard']) {
        expect((await get(path, token)).status).toBe(401);
      }
    }
    expect((await request(app.getHttpServer()).get('/api/v1/admin/firm-applications')).status).toBe(
      401,
    );
  });
});

describe('GET /admin/firm-applications', () => {
  it('lists newest first, with the stored form flattened into each row', async () => {
    const res = await get(`/admin/firm-applications?search=${tag}`).expect(200);
    const body = res.body as ListFirmApplicationsResponse;
    expect(body.total).toBe(4);
    expect(body.items.map((i) => i.id)).toEqual([
      ids.declined,
      ids.approved,
      ids.asked,
      ids.pending,
    ]);
    const pending = body.items.find((i) => i.id === ids.pending)!;
    expect(pending).toMatchObject({
      status: 'PENDING_REVIEW',
      practiceType: 'TAX_ACCOUNTING',
      services: ['TAX_PREPARATION'],
      requestedPlan: 'PROFESSIONAL',
      contactEmail: 'jordan1@sample.example.test',
      decidedAt: null,
    });
    expect(body.items.find((i) => i.id === ids.approved)?.decidedAt).not.toBeNull();
  });

  it('filters by status (an information request stays pending), and pages', async () => {
    const pending = (await get(`/admin/firm-applications?search=${tag}&status=PENDING_REVIEW`))
      .body as ListFirmApplicationsResponse;
    expect(pending.items.map((i) => i.id).sort()).toEqual([ids.asked, ids.pending].sort());
    const page2 = (
      await get(`/admin/firm-applications?search=${tag}&order=oldest&page=2&pageSize=3`)
    ).body as ListFirmApplicationsResponse;
    expect([page2.total, page2.items.map((i) => i.id)]).toEqual([4, [ids.declined]]);
    const none = (await get(`/admin/firm-applications?search=${tag}&to=2000-01-01T00:00:00Z`))
      .body as ListFirmApplicationsResponse;
    expect(none.total).toBe(0);
  });

  it('refuses bad filters with 400', async () => {
    for (const q of [
      'status=INFO_REQUESTED',
      'pageSize=500',
      'businessId=x',
      'from=2026-10-07T00:00:00Z&to=2026-10-01T00:00:00Z',
    ]) {
      expect((await get(`/admin/firm-applications?${q}`)).status).toBe(400);
    }
  });

  it('counts every status (this file adds two pending, one approved, one declined)', async () => {
    const c = (await get('/admin/firm-applications/counts').expect(200))
      .body as FirmApplicationCounts;
    expect(c.pendingReview).toBeGreaterThanOrEqual(2);
    expect(c.approvedThisMonth).toBeGreaterThanOrEqual(1);
    expect(c.declinedThisMonth).toBeGreaterThanOrEqual(1);
    expect(c.all).toBe(c.pendingReview + c.approved + c.declined);
  });
});

describe('GET /admin/firm-applications/{id}', () => {
  it('shows the review page: history newest first, checks, the suggested address', async () => {
    const res = await get(`/admin/firm-applications/${ids.asked}`).expect(200);
    const a = res.body as FirmApplicationRecord;
    expect(a.status).toBe('PENDING_REVIEW');
    expect(a.business.einLast4).toBe('0001');
    expect(JSON.stringify(a)).not.toMatch(/"ein"/);
    expect(a.history.map((h) => [h.type, h.message, h.by?.userId ?? null])).toEqual([
      ['INFO_REQUESTED', 'Please send your PTIN.', fx.users.admin.id],
      ['SUBMITTED', null, null],
    ]);
    expect(a.decision).toBeNull();
    expect(a.suggestedSlug).toBe(`sample-tax-${tag}-2`);
    expect(a.documents).toEqual([]);
  });

  it('gives the decline reason, but no reason for an approval (only its history)', async () => {
    const declined = (await get(`/admin/firm-applications/${ids.declined}`))
      .body as FirmApplicationRecord;
    expect(declined.decision).toMatchObject({
      reason: 'Not a tax practice.',
      by: { userId: fx.users.admin.id },
    });
    expect(declined.checks.find((c) => c.key === 'DUPLICATE_EMAIL')?.result).toBe('WARN');
    expect(declined.suggestedSlug).toBeNull();

    const approved = (await get(`/admin/firm-applications/${ids.approved}`))
      .body as FirmApplicationRecord;
    expect(approved.decision?.reason).toBeNull();
    expect(approved.firm).toEqual({
      id: firm.id,
      slug: firm.slug,
      name: `Sample Tax ${tag} 3`,
      status: 'PENDING_SETUP',
    });
    expect(approved.history.map((h) => h.type)).toEqual([
      'APPROVED',
      'INFO_REQUESTED',
      'SUBMITTED',
    ]);
  });

  it('runs the checks: the email domain against the website, duplicates', async () => {
    const a = (await get(`/admin/firm-applications/${ids.pending}`)).body as FirmApplicationRecord;
    expect(Object.fromEntries(a.checks.map((c) => [c.key, c.result]))).toEqual({
      DUPLICATE_EIN: 'SKIPPED',
      DUPLICATE_NAME: 'PASS',
      DUPLICATE_EMAIL: 'WARN',
      EMAIL_DOMAIN: 'PASS',
    });
  });

  it('audits who opened it, with ids only', async () => {
    await get(`/admin/firm-applications/${ids.pending}`).expect(200);
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: { action: 'firm_application.viewed', entityId: ids.pending },
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({
        businessId: null,
        actorUserId: fx.users.admin.id,
        metadata: null,
      });
    } finally {
      await owner.$disconnect();
    }
  });

  it('answers 404 for an unknown id and 400 for a bad one', async () => {
    expect((await get(`/admin/firm-applications/${randomUUID()}`)).status).toBe(404);
    expect((await get('/admin/firm-applications/not-an-id')).status).toBe(400);
  });
});

describe('GET /admin/firms and /admin/dashboard', () => {
  it('lists firms with the owner from the application until the owner joins', async () => {
    const res = await get(`/admin/firms?search=${tag}`).expect(200);
    const body = res.body as ListFirmsResponse;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: firm.id,
      status: 'PENDING_SETUP',
      owner: { name: 'Jordan Sample 3', email: 'jordan3@mail.example.test' },
      plan: 'PROFESSIONAL',
    });
    expect(body.items[0]?.approvedAt).not.toBeNull();
  });

  it('filters by status: INACTIVE is suspended or closed', async () => {
    const inactive = (await get('/admin/firms?status=INACTIVE&pageSize=100'))
      .body as ListFirmsResponse;
    expect(inactive.items.map((f) => f.id)).toContain(fx.suspended.id);
    expect(inactive.items.every((f) => f.status === 'SUSPENDED' || f.status === 'CLOSED')).toBe(
      true,
    );
  });

  it('opens a firm with its application, and counts firms', async () => {
    const f = (await get(`/admin/firms/${firm.id}`).expect(200)).body as FirmRecord;
    expect(f.application?.id).toBe(ids.approved);
    const plain = (await get(`/admin/firms/${fx.firmA.id}`).expect(200)).body as FirmRecord;
    expect(plain.application).toBeNull();
    expect((await get(`/admin/firms/${randomUUID()}`)).status).toBe(404);
    const counts = (await get('/admin/firms/counts').expect(200)).body as Record<string, number>;
    expect(counts.total).toBe(counts.active! + counts.pendingSetup! + counts.inactive!);
  });

  it('gives the dashboard counts it can read (user counts wait for R0)', async () => {
    const d = (await get('/admin/dashboard').expect(200)).body as AdminDashboard;
    expect(d.pendingApplications).toBeGreaterThanOrEqual(2);
    expect(d.activeFirms).toBeGreaterThanOrEqual(2);
    expect([d.totalUsers, d.newUsersThisWeek, d.monthlyRevenueCents]).toEqual([null, null, null]);
  });
});
