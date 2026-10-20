// End-to-end: Super Admin Integrations, part 2 (R56 on R0's B8 and B1; contract in
// packages/types/src/admin-integrations/operations.ts). API keys: issued once (hash only),
// rotated, revoked. Webhooks: the signing secret once, rotation, deliveries and redelivery as a
// later PENDING attempt. The integration log with its filters, facets, a record with its related
// events, and a B1 export job. The usage report from the rollup, and the module's audit trail.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type {
  AdminApiKey,
  AdminExportJob,
  AdminIssuedApiKey,
  AdminLogFacets,
  AdminLogRecord,
  AdminPlatformIntegrationDetail,
  AdminUsageReport,
  AdminWebhookDelivery,
  AdminWebhookEndpoint,
  AdminWebhookWithSecret,
  ListAdminIntegrationAuditResponse,
  ListAdminIntegrationLogsResponse,
  ListAdminWebhookDeliveriesResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const BASE = '/api/v1/admin/integrations';
const DAY_MS = 86_400_000;

let app: INestApplication;
let token = '';
let viewerSeq = 0;
const newViewer = () => `198.21.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;

type Method = 'get' | 'post' | 'patch';
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

async function platform<T>(fn: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(db, { kind: 'platform' }, fn);
  } finally {
    await db.$disconnect();
  }
}
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const key = (d: Date) => d.toISOString().slice(0, 10);

let firmName = '';

beforeAll(async () => {
  firmName = await platform(
    async (tx) => (await tx.business.findUniqueOrThrow({ where: { id: fx.firmA.id } })).name,
  );
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

describe('API keys', () => {
  let issued: AdminIssuedApiKey;
  let rotated: AdminIssuedApiKey;

  it('needs the Super Admin site’s session', async () => {
    expect((await call('get', '/api-keys', undefined, false)).status).toBe(401);
  });

  it('issues a key once and keeps only its hash', async () => {
    const past = await call('post', '/api-keys', {
      name: `Fake ${run}`,
      environment: 'TEST',
      scopes: ['usage:read'],
      expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
    });
    expect(past.status).toBe(400);
    issued = await ok('post', '/api-keys', {
      name: `Fake reporting ${run}`,
      environment: 'TEST',
      scopes: ['usage:read', 'logs:read', 'usage:read'],
      rateLimitPerMinute: 120,
    });
    expect(issued.secret).toMatch(/^fv_test_[a-z0-9]{40}$/);
    expect(issued.key).toMatchObject({
      status: 'ACTIVE',
      environment: 'TEST',
      scopes: ['usage:read', 'logs:read'],
      rateLimitPerMinute: 120,
      lastFour: issued.secret.slice(-4),
      usage24h: { requests: null, peakPerMinute: null, rateLimited: null },
    });
    expect(issued.secret.startsWith(issued.key.prefix)).toBe(true);
    const row = await platform((tx) =>
      tx.platformApiKey.findUniqueOrThrow({ where: { id: issued.key.id } }),
    );
    expect(row.keyHash).toBe(createHash('sha256').update(issued.secret).digest('hex'));
    const listed = await ok<AdminApiKey[]>('get', '/api-keys?status=ACTIVE&environment=TEST');
    const mine = listed.find((k) => k.id === issued.key.id);
    expect(JSON.stringify(mine)).not.toContain(issued.secret);
  });

  it('rotates into a new key naming the old one, which is revoked', async () => {
    rotated = await ok('post', `/api-keys/${issued.key.id}/rotate`);
    expect(rotated.secret).not.toBe(issued.secret);
    expect(rotated.key).toMatchObject({
      rotatedFromId: issued.key.id,
      status: 'ACTIVE',
      scopes: ['usage:read', 'logs:read'],
    });
    const keys = await ok<AdminApiKey[]>('get', '/api-keys?status=REVOKED');
    expect(keys.find((k) => k.id === issued.key.id)).toMatchObject({
      status: 'REVOKED',
      rotatedToId: rotated.key.id,
    });
    expect(codeOf(await call('post', `/api-keys/${issued.key.id}/rotate`))).toBe('INVALID_STATE');
  });

  it('revokes once, and shows the rollup’s latest day of use', async () => {
    await platform((tx) =>
      tx.platformIntegrationUsageDaily.create({
        data: {
          day: day(0),
          scope: 'API',
          subjectKey: rotated.key.id,
          requests: 42,
          successes: 41,
          failures: 1,
        },
      }),
    );
    const revoked = await ok<AdminApiKey>('post', `/api-keys/${rotated.key.id}/revoke`, {
      reason: 'Fake leak',
    });
    expect(revoked).toMatchObject({ status: 'REVOKED', usage24h: { requests: 42 } });
    expect(revoked.revokedBy).not.toBeNull();
    expect(codeOf(await call('post', `/api-keys/${rotated.key.id}/revoke`, {}))).toBe(
      'INVALID_STATE',
    );
    expect((await call('post', `/api-keys/${randomUUID()}/revoke`, {})).status).toBe(404);
    const trail = await ok<ListAdminIntegrationAuditResponse>(
      'get',
      `/audit?targetId=${rotated.key.id}`,
    );
    expect(trail.items.map((i) => i.action)).toEqual([
      'integrations.api_key.revoked',
      'integrations.api_key.rotated',
    ]);
    expect(trail.items[0]).toMatchObject({ category: 'SECURITY', target: { type: 'API_KEY' } });
  });
});

describe('webhooks and deliveries', () => {
  let outbound: AdminWebhookWithSecret;
  let inbound: AdminWebhookWithSecret;
  const ids = { done: '', pending: '', inbound: '' };

  it('creates https endpoints and shows the signing secret once', async () => {
    const unknown = await call('post', '/webhooks', {
      direction: 'OUTBOUND',
      url: 'https://hooks.example.test/fake',
      events: ['made.up'],
    });
    expect(unknown.status).toBe(400);
    expect(
      (
        await call('post', '/webhooks', {
          direction: 'OUTBOUND',
          url: 'http://hooks.example.test',
          events: ['invoice.paid'],
        })
      ).status,
    ).toBe(400);
    outbound = await ok('post', '/webhooks', {
      direction: 'OUTBOUND',
      url: `https://hooks.example.test/${run}`,
      description: 'Fake receiver',
      events: ['invoice.paid', 'firm.connected'],
    });
    expect(outbound.signingSecret).toMatch(/^whsec_[A-Za-z0-9]{32}$/);
    expect(outbound.endpoint).toMatchObject({
      status: 'ACTIVE',
      maxRetries: 5,
      signingSecretHint: 'whsec_••••••••',
      integration: null,
      stats: { deliveries7d: 0, lastStatus: null },
    });
    expect(outbound.endpoint.secretRotatedAt).not.toBeNull();
    const row = await platform((tx) =>
      tx.platformWebhookEndpoint.findUniqueOrThrow({ where: { id: outbound.endpoint.id } }),
    );
    expect(row.signingSecretRef).toMatch(/^local:/);
    inbound = await ok('post', '/webhooks', {
      direction: 'INBOUND',
      url: `https://in.example.test/${run}`,
      events: ['provider.custom_event'],
    });
  });

  it('updates, and rotates the signing secret on request', async () => {
    const same = await ok<AdminWebhookWithSecret>('patch', `/webhooks/${outbound.endpoint.id}`, {
      maxRetries: 3,
    });
    expect(same).toMatchObject({ signingSecret: null, endpoint: { maxRetries: 3 } });
    const fresh = await ok<AdminWebhookWithSecret>('patch', `/webhooks/${outbound.endpoint.id}`, {
      rotateSecret: true,
    });
    expect(fresh.signingSecret).toMatch(/^whsec_/);
    expect(fresh.signingSecret).not.toBe(outbound.signingSecret);
    const list = await ok<AdminWebhookEndpoint[]>('get', '/webhooks?direction=INBOUND');
    expect(list.map((w) => w.id)).toContain(inbound.endpoint.id);
    expect(list.map((w) => w.id)).not.toContain(outbound.endpoint.id);
    const trail = await ok<ListAdminIntegrationAuditResponse>(
      'get',
      `/audit?targetId=${outbound.endpoint.id}`,
    );
    expect(trail.items[0]).toMatchObject({
      action: 'integrations.webhook.secret_rotated',
      category: 'SECURITY',
    });
  });

  it('lists deliveries, and redelivers a finished one as a later PENDING attempt', async () => {
    await platform(async (tx) => {
      const make = (endpointId: string, eventId: string) =>
        tx.platformWebhookDelivery.create({
          data: { endpointId, eventType: 'invoice.paid', eventId, attempt: 1 },
        });
      ids.done = (await make(outbound.endpoint.id, `evt_${run}_1`)).id;
      ids.pending = (await make(outbound.endpoint.id, `evt_${run}_2`)).id;
      ids.inbound = (await make(inbound.endpoint.id, `evt_${run}_3`)).id;
      for (const id of [ids.done, ids.inbound])
        await tx.platformWebhookDelivery.update({
          where: { id },
          data: {
            status: 'FAILED',
            responseStatusCode: 500,
            durationMs: 1900,
            errorCode: 'http_500',
          },
        });
    });
    const page = await ok<ListAdminWebhookDeliveriesResponse>(
      'get',
      `/webhooks/${outbound.endpoint.id}/deliveries`,
    );
    expect(page.total).toBe(2);
    expect(page.items.find((d) => d.id === ids.done)).toMatchObject({
      canRedeliver: true,
      errorCode: 'HTTP_500',
      payload: null,
    });
    expect(page.items.find((d) => d.id === ids.pending)?.canRedeliver).toBe(false);
    const again = await ok<AdminWebhookDelivery>('post', `/deliveries/${ids.done}/redeliver`);
    expect(again).toMatchObject({
      status: 'PENDING',
      attempt: 2,
      retries: 1,
      redeliveryOfId: ids.done,
      canRedeliver: false,
    });
    expect(again.requestedBy).not.toBeNull();
    expect(codeOf(await call('post', `/deliveries/${ids.pending}/redeliver`))).toBe(
      'INVALID_STATE',
    );
    expect(codeOf(await call('post', `/deliveries/${ids.inbound}/redeliver`))).toBe(
      'INVALID_STATE',
    );
    const failed = await ok<ListAdminWebhookDeliveriesResponse>(
      'get',
      `/webhooks/${outbound.endpoint.id}/deliveries?status=FAILED`,
    );
    expect(failed.items.map((d) => d.id)).toEqual([ids.done]);
    const [endpoint] = (
      await ok<AdminWebhookEndpoint[]>('get', '/webhooks?direction=OUTBOUND')
    ).filter((w) => w.id === outbound.endpoint.id);
    expect(endpoint?.stats).toMatchObject({
      deliveries7d: 3,
      failures7d: 1,
      lastStatus: 'PENDING',
    });
  });
});

describe('the integration log', () => {
  const corr = `corr_r56ops_${run}`;
  let integration: AdminPlatformIntegrationDetail;
  const logIds = { first: '', second: '', firm: '' };

  beforeAll(async () => {
    integration = await ok('post', '/platform', {
      name: `Fake Ops ${run}`,
      category: 'OTHER',
      description: 'Fake integration for the log',
    });
    await platform(async (tx) => {
      const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
      logIds.first = (
        await tx.platformIntegrationLog.create({
          data: {
            source: 'PLATFORM_INTEGRATION',
            integrationId: integration.id,
            provider: integration.provider,
            environment: 'TEST',
            severity: 'ERROR',
            eventType: 'sync.failed',
            action: 'sync',
            succeeded: false,
            errorCode: 'provider_unavailable',
            message: `Fake sync failed ${run}`,
            details: { objectsProcessed: 0, endpoint: 'https://api.example.test/v1' },
            correlationId: corr,
            createdAt: at(3),
          },
        })
      ).id;
      logIds.second = (
        await tx.platformIntegrationLog.create({
          data: {
            source: 'PLATFORM_INTEGRATION',
            integrationId: integration.id,
            provider: integration.provider,
            environment: 'TEST',
            severity: 'INFO',
            eventType: 'sync.retried',
            succeeded: true,
            message: `Fake sync retried ${run}`,
            correlationId: corr,
            createdAt: at(2),
          },
        })
      ).id;
      logIds.firm = (
        await tx.platformIntegrationLog.create({
          data: {
            source: 'FIRM_CONNECTION',
            provider: 'fake_books',
            severity: 'WARNING',
            eventType: 'firm.disconnected',
            succeeded: true,
            message: `Fake firm disconnected ${run}`,
            subjectBusinessId: fx.firmA.id,
            createdAt: at(1),
          },
        })
      ).id;
    });
  });

  it('filters by integration, outcome, firm, an exact id and text', async () => {
    const failures = await ok<ListAdminIntegrationLogsResponse>(
      'get',
      `/logs?integrationId=${integration.id}&outcome=FAILURE`,
    );
    expect(failures.items.map((l) => l.id)).toEqual([logIds.first]);
    expect(failures.items[0]).toMatchObject({
      integrationName: integration.name,
      action: 'Synchronization requested',
      errorCode: 'PROVIDER_UNAVAILABLE',
      endpoint: 'https://api.example.test/v1',
      actor: { type: 'SYSTEM' },
      // A custom provider has no status page to link.
      resolution: { action: 'VIEW_PROVIDER_STATUS', href: null },
    });
    expect(failures.items[0]?.details).toEqual(
      expect.arrayContaining([{ label: 'Objects processed', value: '0' }]),
    );
    const byTrace = await ok<ListAdminIntegrationLogsResponse>(
      'get',
      `/logs?requestId=${corr}&descending=false`,
    );
    expect(byTrace.items.map((l) => l.id)).toEqual([logIds.first, logIds.second]);
    const byFirm = await ok<ListAdminIntegrationLogsResponse>('get', `/logs?firmId=${fx.firmA.id}`);
    expect(byFirm.items.find((l) => l.id === logIds.firm)?.firm).toEqual({
      id: fx.firmA.id,
      name: firmName,
    });
    const byText = await ok<ListAdminIntegrationLogsResponse>(
      'get',
      `/logs?search=${encodeURIComponent(firmName)}&source=FIRM_CONNECTION`,
    );
    expect(byText.items.map((l) => l.id)).toContain(logIds.firm);
    const platformOnly = await ok<ListAdminIntegrationLogsResponse>(
      'get',
      `/logs?platformOnly=true&search=${run}`,
    );
    expect(platformOnly.items.map((l) => l.id)).not.toContain(logIds.firm);
    expect(codeOf(await call('get', '/logs?eventType=Not%20One'))).toBe('VALIDATION_FAILED');
  });

  it('answers the filter choices, and one record with its related events', async () => {
    const facets = await ok<AdminLogFacets>('get', '/logs/facets');
    expect(facets.integrations).toContainEqual({ id: integration.id, name: integration.name });
    expect(facets.eventTypes).toEqual(expect.arrayContaining(['sync.failed', 'firm.disconnected']));
    expect(facets.firms).toContainEqual({ id: fx.firmA.id, name: firmName });
    const record = await ok<AdminLogRecord>('get', `/logs/${logIds.first}`);
    expect(record.related.map((l) => l.id)).toEqual([logIds.second]);
    expect(record.integration).toMatchObject({ id: integration.id, status: 'DRAFT' });
    expect(record.previousId).not.toBeNull();
    expect((await call('get', `/logs/${randomUUID()}`)).status).toBe(404);
  });

  it('queues a B1 export job, lists mine and audits it', async () => {
    const res = await call('post', '/logs/export', {
      query: { integrationId: integration.id, platformOnly: true },
      format: 'CSV',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const job = res.body as AdminExportJob;
    expect(job).toMatchObject({ status: 'QUEUED', format: 'CSV', rowCount: null });
    expect((await ok<AdminExportJob[]>('get', '/logs/exports')).map((j) => j.id)).toContain(job.id);
    expect((await call('post', '/logs/export', { format: 'JSON' })).status).toBe(400);
    const row = await platform((tx) =>
      tx.platformExportJob.findUniqueOrThrow({ where: { id: job.id } }),
    );
    expect(row).toMatchObject({ module: 'INTEGRATION_LOGS', status: 'QUEUED' });
    expect(row.filters).toMatchObject({ integrationId: integration.id, platformOnly: true });
    const trail = await ok<ListAdminIntegrationAuditResponse>('get', `/audit?targetId=${job.id}`);
    expect(trail.items[0]).toMatchObject({
      action: 'export.created',
      target: { type: 'LOG_EXPORT' },
    });
  });

  it('reports usage from the rollup over whole days, N/A without rows', async () => {
    await platform(async (tx) => {
      for (const [offset, requests] of [
        [-1, 100],
        [0, 300],
      ] as const)
        await tx.platformIntegrationUsageDaily.create({
          data: {
            day: day(offset),
            scope: 'PLATFORM_INTEGRATION',
            subjectKey: integration.id,
            requests,
            successes: requests,
            failures: 0,
            avgLatencyMs: offset === 0 ? 100 : 200,
            volume: BigInt(requests),
          },
        });
    });
    const from = key(day(-2));
    const to = key(day(0));
    const report = await ok<AdminUsageReport>(
      'get',
      `/usage?scope=PLATFORM_INTEGRATION&subject=${integration.id}&from=${from}&to=${to}`,
    );
    expect(report.series.map((s) => s.requests)).toEqual([0, 100, 300]);
    expect(report.totals).toMatchObject({
      requests: 400,
      successRate: 100,
      avgLatencyMs: 125,
      volume: 400,
    });
    expect(report.subjects).toEqual([
      expect.objectContaining({ key: integration.id, name: integration.name, requests: 400 }),
    ]);
    expect(report).toMatchObject({ planDistribution: [], alerts: [] });
    const own = await ok<AdminUsageReport>(
      'get',
      `/platform/${integration.id}/usage?from=${from}&to=${to}`,
    );
    expect(own.totals.requests).toBe(400);
    expect((await call('get', `/platform/${randomUUID()}/usage`)).status).toBe(404);
    expect((await call('get', `/usage?from=${to}&to=${from}`)).status).toBe(400);
    expect((await call('get', '/usage?from=2024-01-01&to=2026-01-01')).status).toBe(400);
    const catalog = await ok<AdminUsageReport>('get', '/usage?scope=CATALOG');
    expect(catalog.series).toHaveLength(30);
  });
});
