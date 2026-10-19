// End-to-end: R55, Super Admin Reports & Analytics (contract in packages/types/src/admin-reports):
// the overview, tabs, firms report and Firm Report Detail, the builder with CSV export, and saved
// reports. A figure with no source is null; the rollups' figures appear once rollup rows exist.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminFeatureUsageReport,
  AdminFirmReport,
  AdminFirmsReport,
  AdminReportCatalog,
  AdminReportFile,
  AdminReportResult,
  AdminReportsOverview,
  AdminRevenueReport,
  AdminSavedReport,
  AdminSupportReport,
  AdminUsersReport,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const people = {
  super1: { id: randomUUID(), email: `r55r-super1-${run}@r55.test`, pool: 'ADMIN' as const },
  super2: { id: randomUUID(), email: `r55r-super2-${run}@r55.test`, pool: 'ADMIN' as const },
  ownerA: { id: randomUUID(), email: `r55r-owner-${run}@r55.test`, pool: 'STAFF' as const },
};
const firms = {} as Record<'a' | 'b', string>;
const today = new Date().toISOString().slice(0, 10);
let app: INestApplication;
const tokens = new Map<string, string>();

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
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  tokens.set(email, (res.body as { token: string }).token);
  return tokens.get(email)!;
}
async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
  who = people.super1,
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/admin/reports${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: p.pool,
          email: p.email,
          name: `Fake R55r ${p.email.split('-')[1]}`,
        },
      });
    await tx.platformAdmin.create({ data: { userId: people.super1.id } });
    await tx.platformAdmin.create({ data: { userId: people.super2.id } });
    for (const key of ['a', 'b'] as const)
      firms[key] = (
        await tx.business.create({
          data: {
            slug: `r55r-${key}-${run}`,
            name: `Fake Reports Firm ${key} ${run}`,
            status: 'ACTIVE',
          },
          select: { id: true },
        })
      ).id;
    const plan = await tx.platformPlan.create({
      data: {
        code: `R55R_${run.toUpperCase()}`,
        name: `Fake Plan ${run}`,
        basePriceCents: 9_900,
        billingCycle: 'MONTHLY',
        includedSeats: 3,
        includedLocations: 1,
        displayOrder: 99,
      },
      select: { id: true, code: true },
    });
    await tx.platformFirmSubscription.create({
      data: {
        businessId: firms.a,
        planId: plan.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        seatsIncluded: 3,
        seatsPurchased: 0,
        locationsIncluded: 1,
        locationsPurchased: 0,
      },
    });
    // Two days of rollups for firm A: users, documents, a feature.
    for (const [d, users, docs] of [
      [today, 7, 3],
      [new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), 6, 2],
    ] as const) {
      await tx.platformFirmMetricsDaily.create({
        data: {
          day: new Date(`${d}T00:00:00Z`),
          businessId: firms.a,
          totalUsers: users,
          activeUsers: users - 1,
          newUsers: 1,
          logins: 4,
          totalClients: 10,
          documentsCreated: docs,
          documentsCompleted: 1,
          activeDocuments: docs * 2,
          leadsCreated: 2,
          esignSent: 1,
          esignCompleted: 0,
        },
      });
      await tx.platformFeatureUsageDaily.create({
        data: {
          day: new Date(`${d}T00:00:00Z`),
          businessId: firms.a,
          feature: 'esign.send',
          events: 3,
          activeUsers: 2,
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the dashboard', () => {
  it('answers the overview with live figures and uptime as not available', async () => {
    const o = AdminReportsOverview.parse(ok(await call('get', '/overview')));
    expect(o.range.to).toBe(today);
    expect(o.kpis.uptimePercent).toEqual({ value: null, previous: null });
    expect(o.kpis.totalFirms.value).toBeGreaterThanOrEqual(2);
    expect(o.firmGrowth).toHaveLength(6);
    expect(o.planDistribution.map((p) => p.planName)).toEqual(
      expect.arrayContaining([`Fake Plan ${run}`, 'No plan']),
    );
    const esign = o.featureUsage.find((f) => f.feature === 'esign.send')!;
    expect(esign).toMatchObject({ label: 'eSignature' });
    expect(esign.events).toBeGreaterThanOrEqual(6);
    expect(o.recentActivity.map((a) => a.detail)).toContain(`Fake Reports Firm a ${run}`);
  });

  it('answers the tabs', async () => {
    const rev = AdminRevenueReport.parse(ok(await call('get', '/revenue')));
    expect(rev.trend).toHaveLength(6);
    expect(rev.arrCents.value).toBe((rev.mrrCents.value ?? 0) * 12);
    const users = AdminUsersReport.parse(ok(await call('get', '/users')));
    expect(users.byFirm.find((f) => f.id === firms.a)).toMatchObject({
      totalUsers: 7,
      activeUsers: 6,
    });
    const usage = AdminFeatureUsageReport.parse(
      ok(await call('get', '/feature-usage?feature=esign.send')),
    );
    expect(usage.hasData).toBe(true);
    expect(usage.rows).toHaveLength(1);
    AdminSupportReport.parse(ok(await call('get', '/support')));
    expectError(await call('get', '/overview?from=yesterday'), 400, 'VALIDATION_FAILED');
  });

  it('is for Super Admins only', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/reports/overview')
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('firms', () => {
  it('lists firms with search, plan and sort, and shows one firm in detail', async () => {
    const list = AdminFirmsReport.parse(ok(await call('get', `/firms?search=r55r-a-${run}`)));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: firms.a,
      planName: `Fake Plan ${run}`,
      totalUsers: 7,
    });
    const byPlan = AdminFirmsReport.parse(
      ok(await call('get', `/firms?planCode=R55R_${run.toUpperCase()}`)),
    );
    expect(byPlan.items.map((f) => f.id)).toEqual([firms.a]);
    const joined = async (q: string) =>
      AdminFirmsReport.parse(ok(await call('get', `/firms?search=r55r-a-${run}&${q}`))).items
        .length;
    expect(await joined(`joinedFrom=${today}&joinedTo=${today}`)).toBe(1);
    expect(await joined('joinedTo=2020-01-01')).toBe(0);
    const a = AdminFirmReport.parse(ok(await call('get', `/firms/${firms.a}`)));
    expect(a).toMatchObject({
      hasActivityData: true,
      firm: { planName: `Fake Plan ${run}`, location: null },
    });
    expect(a.kpis.totalUsers.value).toBe(7);
    expect(a.kpis.leads.value).toBe(4);
    expect(a.documentActivity.at(-1)).toMatchObject({ created: 5, completed: 2 });
    const b = AdminFirmReport.parse(ok(await call('get', `/firms/${firms.b}`)));
    expect(b).toMatchObject({
      hasActivityData: false,
      kpis: { totalUsers: { value: null }, leads: { value: null } },
    });
    expectError(await call('get', `/firms/${randomUUID()}`), 404, 'NOT_FOUND');
  });
});

describe('the builder and saved reports', () => {
  it('lists the fields, runs a preview, refuses an unknown field and exports a CSV', async () => {
    const cat = AdminReportCatalog.parse(ok(await call('get', '/builder/fields?type=FIRMS')));
    expect(cat.fields.find((f) => f.key === 'firm.contact_email')?.sensitive).toBe(true);
    const def = {
      type: 'FIRMS',
      fields: ['firm.name', 'firm.plan', 'firm.total_users'],
      filters: { search: `reports firm a ${run}` },
      sort: [{ field: 'firm.name', direction: 'asc' }],
    };
    const res = AdminReportResult.parse(ok(await call('post', '/builder/run', def)));
    expect(res.total).toBe(1);
    expect(res.rows[0]).toEqual({
      'firm.name': `Fake Reports Firm a ${run}`,
      'firm.plan': `Fake Plan ${run}`,
      'firm.total_users': 7,
    });
    expectError(
      await call('post', '/builder/run', { ...def, fields: ['firm.secret'] }),
      400,
      'UNKNOWN_FIELD',
    );
    const early = { ...def, filters: { ...def.filters, joinedTo: '2020-01-01' } };
    expect(AdminReportResult.parse(ok(await call('post', '/builder/run', early))).total).toBe(0);
    const bad = { ...def, filters: { ...def.filters, joinedFrom: 'soon' } };
    expectError(await call('post', '/builder/run', bad), 400, 'UNKNOWN_FIELD');
    const file = AdminReportFile.parse(
      ok(await call('post', '/builder/export', { ...def, format: 'CSV', title: 'Fake firms' })),
    );
    expect(file.rowCount).toBe(1);
    expect(file.content).toContain('Fake firms');
    expect(file.content).toContain('Firm Name,Plan Type,Total Users');
    const audited = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.count({ where: { action: 'reports.exported', actorUserId: people.super1.id } }),
    );
    expect(audited).toBe(1);
  });

  it('saves, shares, runs, duplicates and deletes, the owner alone changing it', async () => {
    const saved = AdminSavedReport.parse(
      ok(
        await call('post', '/saved', {
          name: `Fake firms ${run}`,
          type: 'FIRMS',
          fields: ['firm.name', 'firm.status'],
          filters: { status: 'ACTIVE' },
        }),
        201,
      ),
    );
    expect(saved).toMatchObject({
      isYours: true,
      shared: false,
      dateRange: { preset: 'LAST_30_DAYS' },
    });
    expectError(
      await call('post', '/saved', {
        name: `Fake firms ${run}`,
        type: 'FIRMS',
        fields: ['firm.name'],
      }),
      409,
      'DUPLICATE_NAME',
    );
    const shared = AdminSavedReport.parse(
      ok(await call('patch', `/saved/${saved.id}`, { shared: true })),
    );
    expect(shared.shared).toBe(true);
    expectError(
      await call('patch', `/saved/${saved.id}`, { name: 'Mine now' }, people.super2),
      404,
      'NOT_FOUND',
    );
    const ran = AdminReportResult.parse(
      ok(await call('post', `/saved/${saved.id}/run`, undefined, people.super2)),
    );
    expect(ran.total).toBeGreaterThanOrEqual(2);
    const copy = AdminSavedReport.parse(
      ok(await call('post', `/saved/${saved.id}/duplicate`, undefined, people.super2), 201),
    );
    expect(copy).toMatchObject({ name: `Fake firms ${run} (copy)`, isYours: true, shared: false });
    const mine = ok(await call('get', '/saved', undefined, people.super2)) as {
      items: AdminSavedReport[];
    };
    expect(mine.items.map((s) => s.id)).toEqual(expect.arrayContaining([saved.id, copy.id]));
    expect(mine.items.find((s) => s.id === saved.id)?.lastRunAt).toBeTruthy();
    expect(ok(await call('delete', `/saved/${saved.id}`))).toEqual({ ok: true });
    expectError(await call('delete', `/saved/${copy.id}`), 404, 'NOT_FOUND');
  });
});
