// End-to-end: the platform's daily rollups (Rasel's yes of Nov 10): the job reads each firm in its
// own scope and writes only platform rows. A firm's report rows hold its own counts and nothing of
// another firm's; the integration usage rows are sums with no firm id, with connected firms by plan
// (SA-INT-R3); a run is idempotent per day; one API task at a time (the advisory lock); each run is
// audited with counts only. Run over two fixture firms only (`businessIds`).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AdminUsageReport } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { PlatformRollupJob, ROLLUP_LOCK_KEY } from '../../src/platform-rollups/rollups.job.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const provider = `r55t_${run}`;
const people = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID() };
const firms = { a: randomUUID(), b: randomUUID() };
const planCode = `R55T_${run.toUpperCase()}`;
let app: INestApplication;
let job: PlatformRollupJob;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const today = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, id] of Object.entries(people))
      await tx.user.create({
        data: {
          id,
          cognitoSub: id,
          pool: 'STAFF',
          email: `r55t-${key}-${run}@r55.test`,
          name: `Fake ${key}`,
        },
      });
    for (const [key, id] of Object.entries(firms))
      await tx.business.create({
        data: { id, slug: `r55t-${key}-${run}`, name: `Firm ${key} ${run}`, status: 'ACTIVE' },
      });
    const plan = await tx.platformPlan.create({
      data: {
        code: planCode,
        name: `Plan ${run}`,
        basePriceCents: 1000,
        includedSeats: 3,
        displayOrder: 99,
      },
      select: { id: true },
    });
    await tx.platformFirmSubscription.create({
      data: { businessId: firms.a, planId: plan.id, seatsIncluded: 3 },
    });
    // The provider in the customer catalog, so the Usage page's catalog scope lists it.
    await tx.platformIntegrationCatalog.create({
      data: {
        provider,
        name: `Fake Provider ${run}`,
        category: 'OTHER',
        shortDescription: 'A synthetic catalog entry for the rollup test.',
      },
    });
  });
  const now = new Date();
  await asOwner({ kind: 'business', businessId: firms.a }, async (tx) => {
    await tx.membership.create({
      data: {
        businessId: firms.a,
        userId: people.a1,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    await tx.membership.create({
      data: { businessId: firms.a, userId: people.a2, role: 'STAFF', status: 'ACTIVE' },
    });
    for (const n of [1, 2])
      await tx.client.create({ data: { businessId: firms.a, displayName: `Fake client A${n}` } });
    for (const [action, actor] of [
      ['auth.firm_session_started', people.a1],
      ['lead.created', people.a1],
      ['communication.sent', people.a2],
    ] as const)
      await tx.auditLog.create({
        data: { businessId: firms.a, actorUserId: actor, action, entityType: 'test' },
      });
    const conn = await tx.integrationConnection.create({
      data: { businessId: firms.a, provider, connectedAt: now },
      select: { id: true },
    });
    await tx.integrationSyncRun.create({
      data: {
        businessId: firms.a,
        connectionId: conn.id,
        entity: 'customers',
        status: 'SUCCEEDED',
        startedAt: new Date(now.getTime() - 2_000),
        finishedAt: now,
      },
    });
  });
  await asOwner({ kind: 'business', businessId: firms.b }, async (tx) => {
    await tx.membership.create({
      data: { businessId: firms.b, userId: people.b1, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.client.create({ data: { businessId: firms.b, displayName: 'Fake client B1' } });
    await tx.auditLog.create({
      data: {
        businessId: firms.b,
        actorUserId: people.b1,
        action: 'invoice.sent',
        entityType: 'test',
      },
    });
    await tx.integrationConnection.create({
      data: { businessId: firms.b, provider, connectedAt: now },
    });
  });

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
  job = app.get(PlatformRollupJob);
});

afterAll(async () => {
  await app.close();
});

const rows = () =>
  asOwner({ kind: 'platform' }, async (tx) => ({
    metrics: await tx.platformFirmMetricsDaily.findMany({
      where: { day: today(), businessId: { in: [firms.a, firms.b] } },
    }),
    features: await tx.platformFeatureUsageDaily.findMany({
      where: { day: today(), businessId: { in: [firms.a, firms.b] } },
    }),
    usage: await tx.platformIntegrationUsageDaily.findUnique({
      where: { day_scope_subjectKey: { day: today(), scope: 'CATALOG', subjectKey: provider } },
    }),
  }));

describe('the platform rollups', () => {
  it("writes each firm's own counts, and integration sums with no firm id", async () => {
    const result = await job.run({ businessIds: [firms.a, firms.b] });
    expect(result).toMatchObject({ skipped: false, firms: 2 });
    const { metrics, features, usage } = await rows();
    const a = metrics.find((m) => m.businessId === firms.a);
    const b = metrics.find((m) => m.businessId === firms.b);
    expect(a).toMatchObject({
      totalUsers: 2,
      activeUsers: 2,
      // The database stamps joined_at when a membership is ACTIVE: both joined today.
      newUsers: 2,
      logins: 1,
      totalClients: 2,
    });
    expect(a?.lastLoginAt).not.toBeNull();
    // Firm B's row holds firm B's counts only: nothing of firm A's members, clients or sign-ins.
    expect(b).toMatchObject({
      totalUsers: 1,
      activeUsers: 1,
      newUsers: 1,
      logins: 0,
      totalClients: 1,
      lastLoginAt: null,
    });
    const feature = (firm: string, key: string) =>
      features.find((f) => f.businessId === firm && f.feature === key);
    expect(feature(firms.a, 'crm.lead_created')).toMatchObject({ events: 1, activeUsers: 1 });
    expect(feature(firms.a, 'communications.sent')).toMatchObject({ events: 1, activeUsers: 1 });
    expect(feature(firms.a, 'billing.invoice_sent')).toBeUndefined();
    expect(feature(firms.b, 'billing.invoice_sent')).toMatchObject({ events: 1, activeUsers: 1 });
    expect(feature(firms.b, 'crm.lead_created')).toBeUndefined();

    // SA-INT-R3: both firms connected, one active, by plan (firm B has none).
    expect(usage).toMatchObject({
      connectedFirms: 2,
      activeFirms: 1,
      connects: 2,
      requests: 1,
      successes: 1,
      failures: 0,
      connectedFirmsByPlan: { [planCode]: 1, NONE: 1 },
    });
    expect(
      JSON.stringify(usage, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toMatch(new RegExp(`${firms.a}|${firms.b}`));
  });

  it('is idempotent: a second run rewrites the same rows', async () => {
    const before = await rows();
    await job.run({ businessIds: [firms.a, firms.b] });
    const after = await rows();
    expect(after.metrics).toHaveLength(2);
    expect(after.metrics.map((m) => [m.businessId, m.totalUsers, m.logins]).sort()).toEqual(
      before.metrics.map((m) => [m.businessId, m.totalUsers, m.logins]).sort(),
    );
    expect(after.features).toHaveLength(before.features.length);
    expect(after.usage?.connectedFirms).toBe(2);
  });

  it('runs in one API task at a time, and audits each run with counts only', async () => {
    // Another task holds the lock: this run is skipped.
    const skipped = await asOwner({ kind: 'platform' }, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${ROLLUP_LOCK_KEY}::bigint)) AS l`;
      return job.run({ businessIds: [firms.a] });
    });
    expect(skipped).toEqual({ skipped: true });
    const audit = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'platform.rollups_computed', businessId: null },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit.metadata).toMatchObject({ firms: 2 });
    expect(JSON.stringify(audit.metadata)).not.toMatch(new RegExp(`${firms.a}|${firms.b}`));
  });

  it('feeds the Usage page: connected firms by plan for the catalog entry (SA-INT-R3)', async () => {
    await job.run({ businessIds: [firms.a, firms.b] });
    const token = (
      (await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: fx.users.admin.email })) as { body: { token: string } }
    ).body.token;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/integrations/usage?scope=CATALOG&subject=${provider}`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = AdminUsageReport.parse(res.body);
    // Firm A's plan only: firm B has no plan, so it is not counted by plan.
    expect(report.planDistribution).toEqual([
      { planId: expect.any(String) as string, planName: `Plan ${run}`, firms: 1 },
    ]);
    expect(report.subjects[0]).toMatchObject({ key: provider, connectedFirms: 2 });
  });
});
