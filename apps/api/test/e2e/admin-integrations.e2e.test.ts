// End-to-end: Super Admin Integrations, part 1 (R56 on R0's B8; contract in
// packages/types/src/admin-integrations). Platform integrations: the wizard's draft, versioned
// saves, credentials kept only as a secret reference with masked hints, the connection test as a
// TEST run and a log row (finished in platform scope), activation rules, disable, enable, remove,
// sync and the run history. The catalog: entries, plans and firm rules, the access-loss warning
// from the rollup, the preview. Every change leaves an audit row; no secret ever comes back.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminCatalogItem,
  AdminCatalogPreview,
  AdminConnectionTestResult,
  AdminIntegrationSummary,
  AdminPlatformIntegrationDetail,
  AdminPlatformRun,
  ListAdminCatalogResponse,
  ListAdminPlatformResponse,
  ListAdminPlatformRunsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const BASE = '/api/v1/admin/integrations';
const SECRET = `sk_test_${run}abcdefgh4242`;
const WEBHOOK = `whsec_${run}abcd0001`;

let app: INestApplication;
let token = '';
let viewerSeq = 0;
const newViewer = () => `198.20.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
async function call(method: Method, path: string, body?: object, auth = true): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  if (auth) req = req.set('authorization', `Bearer ${token}`);
  return method === 'get' ? req : req.send(body ?? {});
}
async function ok<T>(method: Method, path: string, body?: object): Promise<T> {
  const res = await call(method, path, body);
  expect(res.status, `${method} ${path} ${JSON.stringify(res.body)}`).toBeLessThan(300);
  return res.body as T;
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
async function platformRead<T>(fn: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const db = owner();
  try {
    return await runInScope(db, { kind: 'platform' }, fn);
  } finally {
    await db.$disconnect();
  }
}
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

const plans = { main: '', extra: '' };
let firmName = '';

beforeAll(async () => {
  await platformRead(async (tx) => {
    for (const key of ['main', 'extra'] as const) {
      const plan = await tx.platformPlan.create({
        data: {
          code: `R56I_${key.toUpperCase()}_${run.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
          name: `Fake ${key} ${run}`,
          basePriceCents: 1000,
          includedSeats: 1,
          displayOrder: 900,
        },
      });
      plans[key] = plan.id;
    }
    firmName = (await tx.business.findUniqueOrThrow({ where: { id: fx.firmA.id } })).name;
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
  token = (
    (
      await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .send({ email: fx.users.admin.email })
        .expect(200)
    ).body as { token: string }
  ).token;
});

afterAll(async () => {
  await app.close();
});

describe('access and options', () => {
  it('needs the Super Admin site’s session', async () => {
    expect((await call('get', '/summary', undefined, false)).status).toBe(401);
  });

  it('answers who may do what, the providers, the plans and the firm picker', async () => {
    expect(await ok('get', '/access')).toMatchObject({
      role: 'SUPER_ADMIN',
      canManageSecrets: true,
    });
    const providers = await ok<{ key: string; critical?: boolean }[]>('get', '/providers');
    expect(providers.map((p) => p.key)).toEqual(expect.arrayContaining(['stripe', 'custom']));
    expect(providers[0]).not.toHaveProperty('critical');
    const planList = await ok<{ id: string }[]>('get', '/plans');
    expect(planList.map((p) => p.id)).toEqual(expect.arrayContaining([plans.main, plans.extra]));
    const firms = await ok<{ id: string; planId: string | null }[]>(
      'get',
      `/firm-options?search=${encodeURIComponent(firmName.slice(0, 6))}`,
    );
    expect(firms.some((f) => f.id === fx.firmA.id)).toBe(true);
  });
});

describe('platform integrations', () => {
  let stripe: AdminPlatformIntegrationDetail;
  let datadog: AdminPlatformIntegrationDetail;

  it('saves the wizard’s first step as a draft, one per provider and environment', async () => {
    stripe = await ok('post', '/platform', {
      provider: 'stripe',
      name: 'Stripe',
      category: 'PAYMENTS_BILLING',
      description: 'Fake payments for the test',
      websiteUrl: 'https://stripe.com',
    });
    expect(stripe).toMatchObject({
      provider: 'stripe',
      status: 'DRAFT',
      environment: 'TEST',
      setupStep: 'CONNECTION',
      critical: false,
      settings: { scopes: ['charges:read'], syncSchedule: 'DAILY' },
      connection: { complete: false, authType: 'API_KEY' },
      websiteUrl: 'https://stripe.com/',
    });
    expect(stripe.reference).toMatch(/^int_\d{3,}$/);
    const again = await call('post', '/platform', {
      provider: 'stripe',
      name: 'Stripe again',
      category: 'PAYMENTS_BILLING',
      description: 'Duplicate',
    });
    expect([again.status, codeOf(again)]).toEqual([409, 'DUPLICATE_CONNECTION']);
    const unknown = await call('post', '/platform', {
      provider: 'nope_provider',
      name: 'Nope',
      category: 'OTHER',
      description: 'Unknown',
    });
    expect(unknown.status).toBe(400);
    const custom = await ok<AdminPlatformIntegrationDetail>('post', '/platform', {
      name: `Acme ${run}`,
      category: 'OTHER',
      description: 'A provider without a template',
    });
    expect(custom.provider).toBe(`custom_acme_${run}`);
    const audit = await platformRead((tx) =>
      tx.auditLog.findFirst({
        where: { entityId: stripe.id, action: 'integrations.platform.created' },
      }),
    );
    expect(audit).toMatchObject({
      category: 'INTEGRATION',
      outcome: 'SUCCESS',
      actorType: 'PLATFORM',
    });
  });

  it('saves the configuration with the version read; secrets never go there', async () => {
    const stale = await call('patch', `/platform/${stripe.id}`, { version: 99, name: 'Late' });
    expect([stale.status, codeOf(stale)]).toEqual([409, 'CONFLICT']);
    const secret = await call('patch', `/platform/${stripe.id}`, {
      version: stripe.version,
      connection: { secretKey: SECRET },
    });
    expect(secret.status).toBe(400);
    const scopes = await call('patch', `/platform/${stripe.id}`, {
      version: stripe.version,
      settings: { scopes: ['not:offered'] },
    });
    expect(scopes.status).toBe(400);
    const saved = await ok<AdminPlatformIntegrationDetail>('patch', `/platform/${stripe.id}`, {
      version: stripe.version,
      longDescription: 'Longer fake text',
      connection: { publishableKey: 'pk_test_fake123' },
      settings: { scopes: ['charges:read', 'invoices:write'], features: ['invoicing'] },
      setupStep: 'SETTINGS',
    });
    expect(saved.version).toBe(stripe.version + 1);
    expect(saved).toMatchObject({
      longDescription: 'Longer fake text',
      setupStep: 'SETTINGS',
      settings: { scopes: ['charges:read', 'invoices:write'], features: ['invoicing'] },
    });
    expect(saved.connection.fields.find((f) => f.key === 'publishableKey')?.display).toBe(
      'pk_test_fake123',
    );
    stripe = saved;
  });

  it('tests, keeps credentials as a reference with masked hints, then activates', async () => {
    const missing = await ok<AdminConnectionTestResult>('post', `/platform/${stripe.id}/test`);
    expect(missing).toMatchObject({ ok: false, kind: 'MISSING_CONFIGURATION' });

    const mixed = await call('put', `/platform/${stripe.id}/credentials`, {
      values: { secretKey: `sk_live_${run}abcdefgh` },
    });
    expect(mixed.status).toBe(400);
    const res = await call('put', `/platform/${stripe.id}/credentials`, {
      values: { secretKey: SECRET, webhookSecret: WEBHOOK },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK);
    const withKeys = res.body as AdminPlatformIntegrationDetail;
    expect(withKeys.connection.fields.find((f) => f.key === 'secretKey')?.display).toBe(
      'sk_test_••••4242',
    );
    expect(withKeys.connection.complete).toBe(true);
    const row = await platformRead((tx) =>
      tx.platformIntegration.findUniqueOrThrow({ where: { id: stripe.id } }),
    );
    expect(row.secretRef).toMatch(/^local:/);
    expect(JSON.stringify(row.settings)).not.toContain(SECRET);
    const security = await platformRead((tx) =>
      tx.auditLog.findFirst({
        where: { entityId: stripe.id, action: 'integrations.credentials.set' },
      }),
    );
    expect(security?.category).toBe('SECURITY');

    const early = await call('post', `/platform/${stripe.id}/activate`, {});
    expect([early.status, codeOf(early)]).toEqual([409, 'TEST_REQUIRED']);

    const passed = await ok<AdminConnectionTestResult>('post', `/platform/${stripe.id}/test`);
    expect(passed).toMatchObject({ ok: true, kind: 'OK', errorCode: null });
    expect(passed.integration).toMatchObject({ lastCheckOk: true, status: 'DRAFT' });
    expect(passed.integration.lastCheckMessage).toMatch(/Checked locally/);
    const log = await platformRead((tx) =>
      tx.platformIntegrationLog.findUniqueOrThrow({ where: { id: passed.logId } }),
    );
    expect(log).toMatchObject({
      eventType: 'connection.test',
      succeeded: true,
      actorUserId: fx.users.admin.id,
    });

    const active = await ok<AdminPlatformIntegrationDetail>(
      'post',
      `/platform/${stripe.id}/activate`,
      {},
    );
    expect(active).toMatchObject({
      status: 'ACTIVE',
      setupStep: 'REVIEW',
      activatedWithoutTest: false,
    });
    expect(active.activatedAt).not.toBeNull();

    const runs = await ok<ListAdminPlatformRunsResponse>(
      'get',
      `/platform/${stripe.id}/runs?kind=TEST`,
    );
    expect(runs.items.map((r) => r.status)).toEqual(['SUCCEEDED', 'FAILED']);
    expect(runs.items[0]).toMatchObject({ trigger: 'MANUAL', logId: passed.logId });
    expect(runs.items[1]?.errorCode).toBe('MISSING_CONFIGURATION');
  });

  it('queues one sync at a time, and disables and re-enables only on request', async () => {
    const first = await ok<AdminPlatformRun>('post', `/platform/${stripe.id}/sync`);
    expect(first).toMatchObject({ kind: 'SYNC', status: 'QUEUED', trigger: 'MANUAL' });
    expect((await ok<AdminPlatformRun>('post', `/platform/${stripe.id}/sync`)).id).toBe(first.id);

    const off = await ok<AdminPlatformIntegrationDetail>('post', `/platform/${stripe.id}/disable`, {
      reason: 'Fake maintenance',
    });
    expect(off.status).toBe('DISABLED');
    expect(codeOf(await call('post', `/platform/${stripe.id}/disable`, {}))).toBe('INVALID_STATE');
    expect(codeOf(await call('post', `/platform/${stripe.id}/sync`))).toBe('INVALID_STATE');
    const on = await ok<AdminPlatformIntegrationDetail>('post', `/platform/${stripe.id}/enable`);
    expect(on.status).toBe('ACTIVE');
  });

  it('shows the rollup’s usage and success rate, N/A without data', async () => {
    const empty = await ok<AdminPlatformIntegrationDetail>('get', `/platform/${stripe.id}`);
    expect(empty.highlights.every((h) => h.value === null)).toBe(true);
    expect(empty.uptime30d).toBeNull();
    await platformRead((tx) =>
      tx.platformIntegrationUsageDaily.create({
        data: {
          day: today(),
          scope: 'PLATFORM_INTEGRATION',
          subjectKey: stripe.id,
          requests: 200,
          successes: 199,
          failures: 1,
          volume: 123_456n,
        },
      }),
    );
    const detail = await ok<AdminPlatformIntegrationDetail>('get', `/platform/${stripe.id}`);
    expect(detail.uptime30d).toBe(99.5);
    expect(detail.highlights).toEqual([
      { key: 'requests', label: 'Transactions', value: 200, unit: 'COUNT' },
      { key: 'volume', label: 'Total Processed', value: 123_456, unit: 'CENTS' },
      { key: 'successRate', label: 'Success Rate', value: 99.5, unit: 'PERCENT' },
    ]);
    expect(detail.accessControl.find((a) => a.permission === 'ROTATE_CREDENTIALS')?.locked).toBe(
      true,
    );
  });

  it('changes the environment only when confirmed, and clears the credentials', async () => {
    const current = await ok<AdminPlatformIntegrationDetail>('get', `/platform/${stripe.id}`);
    const ask = await call('patch', `/platform/${stripe.id}`, {
      version: current.version,
      environment: 'LIVE',
    });
    expect([ask.status, codeOf(ask)]).toEqual([409, 'CONFIRMATION_REQUIRED']);
    const live = await ok<AdminPlatformIntegrationDetail>('patch', `/platform/${stripe.id}`, {
      version: current.version,
      environment: 'LIVE',
      confirmEnvironmentChange: true,
    });
    expect(live).toMatchObject({
      environment: 'LIVE',
      status: 'NEEDS_ATTENTION',
      critical: true,
      statusReason: { code: 'CREDENTIALS_REQUIRED' },
      connection: { complete: false, secretRotatedAt: null },
      lastCheckOk: null,
    });
    const row = await platformRead((tx) =>
      tx.platformIntegration.findUniqueOrThrow({ where: { id: stripe.id } }),
    );
    expect(row.secretRef).toBeNull();
  });

  it('activates a provider without a test endpoint only with a confirmation', async () => {
    datadog = await ok('post', '/platform', {
      provider: 'datadog',
      name: 'Datadog',
      category: 'SECURITY_INFRASTRUCTURE',
      description: 'Fake monitoring',
    });
    expect(codeOf(await call('post', `/platform/${datadog.id}/test`))).toBe('INVALID_STATE');
    await ok('put', `/platform/${datadog.id}/credentials`, {
      values: { apiKey: `dd${run}apikey00`, appKey: `dd${run}appkey00`, site: 'datadoghq.com' },
    });
    const ask = await call('post', `/platform/${datadog.id}/activate`, {});
    expect([ask.status, codeOf(ask)]).toEqual([409, 'CONFIRMATION_REQUIRED']);
    const active = await ok<AdminPlatformIntegrationDetail>(
      'post',
      `/platform/${datadog.id}/activate`,
      {
        confirmWithoutTest: true,
      },
    );
    expect(active).toMatchObject({ status: 'ACTIVE', activatedWithoutTest: true });
    expect(codeOf(await call('post', `/platform/${datadog.id}/reconnect`))).toBe('INVALID_STATE');
  });

  it('reconnects an OAuth provider only, and says the account is not linked yet', async () => {
    const docusign = await ok<AdminPlatformIntegrationDetail>('post', '/platform', {
      provider: 'docusign',
      name: 'DocuSign',
      category: 'ESIGN',
      description: 'Fake signatures',
    });
    expect(docusign.connection.oauth).toEqual({
      connected: false,
      account: null,
      connectedAt: null,
    });
    await ok('patch', `/platform/${docusign.id}`, {
      version: docusign.version,
      connection: {
        integrationKey: `key-${run}`,
        accountId: `acct-${run}`,
        baseUrl: 'https://na4.example.test',
      },
    });
    const again = await ok<AdminConnectionTestResult>('post', `/platform/${docusign.id}/reconnect`);
    expect(again).toMatchObject({ ok: false, kind: 'MISSING_CONFIGURATION' });
    expect(again.message).toMatch(/Link the DocuSign account/);
  });

  it('lists with filters and sorts, and counts the dashboard', async () => {
    const list = await ok<ListAdminPlatformResponse>(
      'get',
      `/platform?status=ACTIVE,NEEDS_ATTENTION&search=${encodeURIComponent(stripe.reference)}`,
    );
    expect(list.items.map((i) => i.id)).toEqual([stripe.id]);
    const byName = await ok<ListAdminPlatformResponse>('get', '/platform?sort=name&pageSize=100');
    const names = byName.items.map((i) => i.name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(codeOf(await call('get', '/platform?status=NOPE'))).toBe('VALIDATION_FAILED');
    const summary = await ok<AdminIntegrationSummary>('get', '/summary');
    expect(summary.platformTotal).toBeGreaterThanOrEqual(3);
    expect(summary.needsAttention).toBeGreaterThanOrEqual(1);
    expect(summary.drafts).toBeGreaterThanOrEqual(1);
    expect((await call('get', `/platform/${randomUUID()}`)).status).toBe(404);
  });

  it('removes a critical live service only with its name typed, and revokes it', async () => {
    const ask = await call('post', `/platform/${stripe.id}/remove`, {});
    expect([ask.status, codeOf(ask)]).toEqual([409, 'CONFIRMATION_REQUIRED']);
    const removed = await ok<AdminPlatformIntegrationDetail>(
      'post',
      `/platform/${stripe.id}/remove`,
      {
        confirmation: 'Stripe',
      },
    );
    expect(removed).toMatchObject({ status: 'REMOVED' });
    expect(removed.removedAt).not.toBeNull();
    expect(codeOf(await call('post', `/platform/${stripe.id}/enable`))).toBe('INVALID_STATE');
    const hidden = await ok<ListAdminPlatformResponse>(
      'get',
      `/platform?search=${stripe.reference}`,
    );
    expect(hidden.items).toEqual([]);
    const shown = await ok<ListAdminPlatformResponse>(
      'get',
      `/platform?includeRemoved=true&search=${stripe.reference}`,
    );
    expect(shown.items.map((i) => i.status)).toEqual(['REMOVED']);
  });

  describe('the catalog', () => {
    const provider = `fake_books_${run}`;
    let entry: AdminCatalogItem;

    it('adds an entry, disabled and on all plans, one per provider', async () => {
      entry = await ok('post', '/catalog', {
        provider,
        name: 'Fake Books',
        category: 'OTHER',
        shortDescription: 'Fake accounting sync',
        platformIntegrationId: datadog.id,
      });
      expect(entry).toMatchObject({
        provider,
        status: 'DISABLED',
        planAccess: 'ALL_PLANS',
        requiredRole: 'OWNER_ADMIN',
        platformIntegration: { id: datadog.id, status: 'ACTIVE' },
        stats: { firmsUsing: 0 },
      });
      const again = await call('post', '/catalog', {
        provider,
        name: 'Again',
        category: 'OTHER',
        shortDescription: 'Duplicate',
      });
      expect([again.status, codeOf(again)]).toEqual([409, 'DUPLICATE_PROVIDER']);
    });

    it('saves with the version read, keeps badge labels, refuses Firmivra secrets', async () => {
      const stale = await call('patch', `/catalog/${entry.id}`, { version: 99, name: 'Late' });
      expect(codeOf(stale)).toBe('CONFLICT');
      const leak = await call('patch', `/catalog/${entry.id}`, {
        version: entry.version,
        setup: { instructions: 'Paste sk_live_123 here' },
      });
      expect(leak.status).toBe(400);
      entry = await ok('patch', `/catalog/${entry.id}`, {
        version: entry.version,
        status: 'ENABLED',
        badges: ['Most Popular', 'New'],
        displayLabel: 'Books',
        setup: { authType: 'API_KEY', instructions: 'Enter your fake key.' },
        advanced: { beta: true },
      });
      expect(entry).toMatchObject({
        status: 'ENABLED',
        badges: ['Most Popular', 'New'],
        displayLabel: 'Books',
        setup: { authType: 'API_KEY', instructions: 'Enter your fake key.' },
        advanced: { beta: true },
      });
      const preview = await ok<AdminCatalogPreview>('get', `/catalog/${entry.id}/preview`);
      expect(preview).toMatchObject({
        name: 'Books',
        connectable: true,
        connectLabel: 'Connect',
        badges: ['Most Popular', 'New', 'Beta'],
      });
    });

    it('warns before hiding it from firms while firms have it connected', async () => {
      await platformRead((tx) =>
        tx.platformIntegrationUsageDaily.create({
          data: {
            day: today(),
            scope: 'CATALOG',
            subjectKey: provider,
            requests: 10,
            successes: 10,
            failures: 0,
            connectedFirms: 3,
            activeFirms: 2,
            connects: 1,
          },
        }),
      );
      const warned = await call('patch', `/catalog/${entry.id}`, {
        version: entry.version,
        planAccess: 'SELECTED_PLANS',
        planIds: [plans.main],
      });
      expect([warned.status, codeOf(warned)]).toEqual([409, 'ACCESS_LOSS']);
      entry = await ok('patch', `/catalog/${entry.id}`, {
        version: entry.version,
        planAccess: 'SELECTED_PLANS',
        planIds: [plans.main],
        confirmAccessLoss: true,
      });
      expect(entry.plans.map((p) => p.id)).toEqual([plans.main]);
      expect(entry.stats).toMatchObject({ firmsUsing: 3, activeFirms: 2, connects30d: 1 });
      const audit = await platformRead((tx) =>
        tx.auditLog.findFirst({
          where: { entityId: entry.id, action: 'integrations.catalog.access_changed' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect((audit?.metadata as { firmsLosingAccess?: number }).firmsLosingAccess).toBeGreaterThan(
        0,
      );
    });

    it('adds and removes plans, keeping at least one', async () => {
      entry = await ok('put', `/catalog/${entry.id}/plans/${plans.extra}`);
      expect(entry.plans).toHaveLength(2);
      entry = await ok('delete', `/catalog/${entry.id}/plans/${plans.extra}`, {});
      expect(entry.plans.map((p) => p.id)).toEqual([plans.main]);
      expect((await call('delete', `/catalog/${entry.id}/plans/${plans.main}`, {})).status).toBe(
        400,
      );
      expect((await call('put', `/catalog/${entry.id}/plans/${randomUUID()}`)).status).toBe(404);
    });

    it('allows or denies one firm over its plan, and warns before taking it away', async () => {
      entry = await ok('put', `/catalog/${entry.id}/firms/${fx.firmA.id}`, {
        access: 'ALLOW',
        reason: 'Fake pilot',
      });
      expect(entry.firmRules).toEqual([
        expect.objectContaining({ businessId: fx.firmA.id, access: 'ALLOW', firmName }),
      ]);
      const warned = await call('delete', `/catalog/${entry.id}/firms/${fx.firmA.id}`, {});
      expect(codeOf(warned)).toBe('ACCESS_LOSS');
      entry = await ok('delete', `/catalog/${entry.id}/firms/${fx.firmA.id}`, {
        confirmAccessLoss: true,
      });
      expect(entry.firmRules).toEqual([]);
      expect(
        (await call('put', `/catalog/${entry.id}/firms/${randomUUID()}`, { access: 'DENY' }))
          .status,
      ).toBe(404);
    });

    it('lists by status, plan and search, and unlinks a removed platform integration', async () => {
      const list = await ok<ListAdminCatalogResponse>(
        'get',
        `/catalog?status=ENABLED&plan=${plans.main}&search=${encodeURIComponent('fake books')}&sort=customers&descending=true`,
      );
      expect(list.items.map((i) => i.id)).toContain(entry.id);
      const other = await ok<ListAdminCatalogResponse>(
        'get',
        `/catalog?plan=${plans.extra}&search=${provider}`,
      );
      expect(other.items).toEqual([]);
      await ok('post', `/platform/${datadog.id}/disable`, {});
      await ok('post', `/platform/${datadog.id}/remove`, {});
      expect(
        (await ok<AdminCatalogItem>('get', `/catalog/${entry.id}`)).platformIntegration,
      ).toBeNull();
      expect((await call('get', `/catalog/${randomUUID()}`)).status).toBe(404);
      const summary = await ok<AdminIntegrationSummary>('get', '/summary');
      expect(summary.catalog.enabled).toBeGreaterThanOrEqual(1);
      expect(summary.catalog.addedThisMonth).toBeGreaterThanOrEqual(1);
    });
  });
});
