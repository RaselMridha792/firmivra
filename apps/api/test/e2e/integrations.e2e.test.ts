// End-to-end: R55, Integrations (contract in packages/types/src/integrations): the main page and
// marketplace (data from the catalog), connect (a provider's own authorization with a state bound
// to the browser, write-only credentials, built-in providers), settings checked against the
// provider, sync runs, pause and resume, the connection test and health, disconnect (secrets
// removed, history kept), mappings, requests and Custom API & Webhooks. No secret is ever in a
// response or an audit row. Firm B never reads or changes firm A's connections.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  ConnectIntegrationResult,
  CustomIntegrationConfig,
  CustomIntegrationEventList,
  CustomIntegrationTestResult,
  IntegrationActivityPage,
  IntegrationConnectionDetail,
  IntegrationConnectionHealth,
  IntegrationConnectionSummary,
  IntegrationHistoryPage,
  IntegrationMappings,
  IntegrationMarketplace,
  IntegrationPermissionList,
  IntegrationProviderDetail,
  IntegrationRequestList,
  IntegrationRequestRow,
  IntegrationsOverview,
  IntegrationSyncRun,
  IntegrationSyncRunDetail,
  IntegrationTestResult,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  AdapterError,
  INTEGRATION_ADAPTERS,
  type AdapterCheck,
  type ProviderAdapter,
} from '../../src/integrations/provider-adapter.js';
import { OUTBOUND_HTTP, type OutboundHttp } from '../../src/integrations/safe-http.js';
import { MemorySecretStore, SECRET_STORE } from '../../src/integrations/secret-store.js';

const SECRET = 'tok_SUPERSECRET_value_1234';
const API_KEY = 'key_SUPERSECRET_apikey_9876';
const WEBHOOK_SECRET = 'whsec_SUPERSECRET_webhook_0042';

// What the fake providers do, switched per test.
const behavior = {
  syncGate: null as Promise<void> | null,
  syncError: null as AdapterError | null,
  syncFailed: 0,
  checks: null as AdapterCheck[] | null,
  revoked: 0,
};
const quickbooks: ProviderAdapter = {
  provider: 'quickbooks',
  authorizeUrl: ({ redirectUri, state }) =>
    `https://login.example/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`,
  exchange: (input) => {
    if (input.code === 'bad-code') return Promise.reject(new Error('refused'));
    return Promise.resolve({
      secret: SECRET,
      accountLabel: 'LVP Accounting & Taxes LLC',
      accountId: '1234567890123456',
      grantedPermissions: ['accounting.read', 'accounting.write'],
    });
  },
  test: () =>
    Promise.resolve(
      behavior.checks ?? [
        { key: 'AUTHENTICATION', ok: true },
        { key: 'API', ok: true },
      ],
    ),
  sync: async () => {
    if (behavior.syncGate) await behavior.syncGate;
    if (behavior.syncError) throw behavior.syncError;
    return { records: 42, failed: behavior.syncFailed };
  },
  revoke: () => {
    behavior.revoked += 1;
    return Promise.resolve();
  },
};
const textmagic: ProviderAdapter = {
  provider: 'textmagic',
  verifyCredentials: (credentials) =>
    credentials.apiKey === API_KEY
      ? Promise.resolve({
          secret: JSON.stringify(credentials),
          accountLabel: 'Fake Text Account',
          accountId: '55550001',
        })
      : Promise.reject(new AdapterError('credentials_rejected')),
  test: () => Promise.resolve([{ key: 'AUTHENTICATION', ok: true }]),
};

const secrets = new MemorySecretStore();
const posted: { url: string; headers: Record<string, string>; body: string }[] = [];
const outbound: OutboundHttp & {
  next: { status: number | null; failure: 'blocked' | 'timeout' | 'unreachable' | null };
} = {
  next: { status: 200, failure: null },
  post(url, headers, body) {
    posted.push({ url, headers, body });
    return Promise.resolve({ ...this.next, durationMs: 12 });
  },
};

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55i-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.55.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const waitFor = async (fn: () => Promise<boolean>, ms = 8_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out');
};

const connect = (
  provider: string,
  body: object = {},
  who: Who = people.ownerA,
  firm: 'a' | 'b' = 'a',
) => call('post', `/integrations/providers/${provider}/connect`, who, body, firm);
const connectionOf = async (
  provider: string,
  firm: 'a' | 'b' = 'a',
  env: 'LIVE' | 'TEST' = 'LIVE',
) =>
  inFirm(firm, (tx) =>
    tx.integrationConnection.findFirstOrThrow({
      where: { businessId: firms[firm], provider, environment: env },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R55i ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55i-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const client = await tx.client.create({
      data: { businessId: firms.a, displayName: 'Integration Client (fake)' },
      select: { id: true },
    });
    await tx.clientAccount.create({
      data: {
        businessId: firms.a,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: client.id,
        status: 'ACTIVE',
      },
    });
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(INTEGRATION_ADAPTERS)
    .useValue([quickbooks, textmagic])
    .overrideProvider(SECRET_STORE)
    .useValue(secrets)
    .overrideProvider(OUTBOUND_HTTP)
    .useValue(outbound)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const everywhere = (value: unknown) => JSON.stringify(value);
const noSecrets = (value: unknown) => {
  const text = everywhere(value);
  for (const s of [SECRET, API_KEY, WEBHOOK_SECRET]) expect(text).not.toContain(s);
};

describe('the main page and marketplace', () => {
  it('lists the catalog with counts that follow the Live and Test switch; staff only read', async () => {
    const overview = IntegrationsOverview.parse(
      ok(await call('get', '/integrations', people.ownerA)),
    );
    expect(overview.summary.total).toBeGreaterThanOrEqual(18);
    expect(overview.summary.total).toBe(
      overview.summary.connected +
        overview.summary.needsAttention +
        overview.summary.available +
        overview.summary.paused,
    );
    expect(overview.items.find((c) => c.provider.provider === 'quickbooks')).toMatchObject({
      status: 'AVAILABLE',
      action: 'CONNECT',
    });
    expect(overview.items.find((c) => c.provider.provider === 'custom_api')?.action).toBe(
      'CONFIGURE',
    );
    expect(overview.canManage).toBe(true);
    expect(
      IntegrationsOverview.parse(ok(await call('get', '/integrations', people.staffA))).canManage,
    ).toBe(false);

    const test = IntegrationsOverview.parse(
      ok(await call('get', '/integrations?environment=TEST', people.ownerA)),
    );
    expect(test.items.some((c) => c.provider.provider === 'quickbooks')).toBe(true);
    expect(test.items.some((c) => c.provider.provider === 'microsoft365')).toBe(false);

    const search = IntegrationsOverview.parse(
      ok(await call('get', '/integrations?search=quick', people.ownerA)),
    );
    expect(search.items.map((c) => c.provider.provider)).toEqual(['quickbooks']);
    expect(
      IntegrationsOverview.parse(
        ok(await call('get', '/integrations?tab=attention', people.ownerA)),
      ).items,
    ).toEqual([]);
    expectError(
      await call('get', '/integrations?tab=everything', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', '/integrations', people.clientA), 403, 'FORBIDDEN');
    expectError(await call('get', '/integrations', undefined), 401, 'UNAUTHENTICATED');
  });

  it('the marketplace has categories, featured providers, a sort and a search', async () => {
    const m = IntegrationMarketplace.parse(
      ok(await call('get', '/integrations/marketplace', people.staffA)),
    );
    expect(m.total).toBe(m.items.length);
    expect(m.featured.length).toBeGreaterThan(0);
    expect(
      m.categories.find((c) => c.category === 'ACCOUNTING_FINANCE')?.count,
    ).toBeGreaterThanOrEqual(3);
    expect(m.items[0]?.provider.popularity).toBeGreaterThanOrEqual(
      m.items.at(-1)?.provider.popularity ?? 0,
    );
    const byName = IntegrationMarketplace.parse(
      ok(await call('get', '/integrations/marketplace?sort=name&category=PAYMENTS', people.ownerA)),
    );
    expect(byName.items.map((c) => c.provider.name)).toEqual(
      [...byName.items.map((c) => c.provider.name)].sort((a, b) => a.localeCompare(b)),
    );
    expect(byName.items.every((c) => c.provider.category === 'PAYMENTS')).toBe(true);
    expectError(
      await call('get', '/integrations/marketplace?sort=best', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('a provider has its definition; an unknown one is not found', async () => {
    const d = IntegrationProviderDetail.parse(
      ok(await call('get', '/integrations/providers/microsoft365', people.staffA)),
    );
    expect(d.provider.entities.map((e) => e.key)).toEqual([
      'email',
      'calendar',
      'contacts',
      'files',
    ]);
    expect(d.provider.authMethod).toBe('OAUTH2');
    expect(d.provider.comingSoon).toBe(true);
    expect(
      IntegrationProviderDetail.parse(
        ok(await call('get', '/integrations/providers/quickbooks', people.ownerA)),
      ).provider.comingSoon,
    ).toBe(false);
    expectError(await call('get', '/integrations/providers/nope', people.ownerA), 404, 'NOT_FOUND');
    expectError(
      await call('get', '/integrations/providers/Not%20A%20Code', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('connecting', () => {
  it('a provider with no adapter is coming soon; only managers connect', async () => {
    expectError(await connect('xero'), 409, 'COMING_SOON');
    expectError(await connect('website_forms', {}, people.staffA), 403, 'FORBIDDEN');
    expectError(await connect('website_forms', {}, people.clientA), 403, 'FORBIDDEN');
    expectError(await connect('website_forms', { businessId: firms.b }), 400, 'VALIDATION_FAILED');
    expectError(await connect('nope'), 404, 'NOT_FOUND');
    expectError(await connect('quickbooks', { environment: 'SANDBOX' }), 400, 'VALIDATION_FAILED');
    expectError(await connect('stripe_nope', {}), 404, 'NOT_FOUND');
  });

  it('a built-in provider connects at once, once per environment, with its own settings', async () => {
    const made = ConnectIntegrationResult.parse(
      ok(await connect('website_forms', { settings: { syncMode: 'MANUAL' } }, people.adminA)),
    );
    expect(made.mode).toBe('CONNECTED');
    if (made.mode !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(made.connection).toMatchObject({
      provider: 'website_forms',
      status: 'CONNECTED',
      syncMode: 'MANUAL',
      syncEveryMinutes: null,
      direction: 'IMPORT',
    });
    expectError(await connect('website_forms'), 409, 'ALREADY_CONNECTED');
    expectError(await connect('website_forms', { environment: 'TEST' }), 409, 'NOT_SUPPORTED');
    // Firm B has its own and sees none of A's.
    const b = IntegrationsOverview.parse(
      ok(await call('get', '/integrations', people.ownerB, undefined, 'b')),
    );
    expect(b.items.find((c) => c.provider.provider === 'website_forms')?.status).toBe('AVAILABLE');
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { action: 'integration.connected', entityId: made.connection.id },
      }),
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/token|secret/i);
  });

  it('an authorization goes through the provider and returns to a state bound to this browser', async () => {
    const start = await connect('quickbooks', {
      settings: { entities: ['invoices', 'customers'], syncEveryMinutes: 60 },
    });
    const result = ConnectIntegrationResult.parse(ok(start));
    expect(result.mode).toBe('REDIRECT');
    if (result.mode !== 'REDIRECT') throw new Error('expected REDIRECT');
    const url = new URL(result.url);
    const state = url.searchParams.get('state')!;
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/v1\/integrations\/callback$/);
    const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('fv_int_state='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Nothing is connected yet.
    expect(
      await inFirm('a', (tx) =>
        tx.integrationConnection.count({ where: { provider: 'quickbooks' } }),
      ),
    ).toBe(0);

    const callback = (qs: string, cookieHeader?: string) => {
      let req = request(app.getHttpServer())
        .get(`/api/v1/integrations/callback?${qs}`)
        .set('x-forwarded-for', viewer());
      if (cookieHeader) req = req.set('cookie', cookieHeader);
      return req;
    };
    // No cookie (another browser): refused, and nothing is connected.
    const foreign = await callback(`state=${encodeURIComponent(state)}&code=good`);
    expect(foreign.status).toBe(302);
    expect(foreign.headers.location).toMatch(/\/integrations\?result=failed$/);
    // A forged state.
    expect(
      (await callback('state=garbage&code=good', cookie.split(';')[0])).headers.location,
    ).toMatch(/result=failed/);
    // The provider refused (error): back to the setup with a failed result, no error text in the address.
    const refused = await callback(
      `state=${encodeURIComponent(state)}&error=access_denied`,
      cookie.split(';')[0],
    );
    expect(refused.headers.location).toMatch(/\/integrations\/quickbooks\/setup\?result=failed$/);
    expect(refused.headers.location).not.toContain('access_denied');
    // A code the provider rejects.
    expect(
      (await callback(`state=${encodeURIComponent(state)}&code=bad-code`, cookie.split(';')[0]))
        .headers.location,
    ).toMatch(/setup\?result=failed$/);
    expect(
      await inFirm('a', (tx) =>
        tx.integrationConnection.count({ where: { provider: 'quickbooks' } }),
      ),
    ).toBe(0);

    const good = await callback(
      `state=${encodeURIComponent(state)}&code=good`,
      cookie.split(';')[0],
    );
    expect(good.status).toBe(302);
    expect(good.headers.location).toMatch(/\/integrations\/quickbooks\/setup\?result=connected$/);
    expect(good.headers.location).not.toMatch(/good|state=/);

    const c = await connectionOf('quickbooks');
    expect(c).toMatchObject({
      status: 'CONNECTED',
      accountLabel: 'LVP Accounting & Taxes LLC',
      accountIdLast4: '3456',
      syncEveryMinutes: 60,
      connectedByUserId: people.ownerA.id,
    });
    expect(c.entities).toEqual(['invoices', 'customers']);
    // The database holds a NAME for the secret, never the secret.
    expect(c.secretRef).toBe(`firmivra/tenant/${firms.a}/integrations/${c.id}`);
    expect(JSON.stringify(c)).not.toContain(SECRET);
    expect(await secrets.get(c.secretRef!)).toBe(SECRET);
    // A connect test ran after connecting.
    const runs = await inFirm('a', (tx) =>
      tx.integrationSyncRun.findMany({ where: { connectionId: c.id } }),
    );
    expect(runs.map((r) => [r.entity, r.status])).toEqual([['test', 'SUCCEEDED']]);

    const detail = IntegrationConnectionDetail.parse(
      ok(await call('get', `/integrations/connections/${c.id}`, people.staffA)),
    );
    expect(detail).toMatchObject({
      accountIdMasked: '•••• 3456',
      connectionType: 'OAuth 2.0 (Secure)',
      entities: ['invoices', 'customers'],
      canManage: false,
    });
    noSecrets(detail);
    expectError(await connect('quickbooks'), 409, 'ALREADY_CONNECTED');
    // The state cannot be used twice for another connection: the connection exists, so a replay is refused.
    const replay = await callback(
      `state=${encodeURIComponent(state)}&code=good`,
      cookie.split(';')[0],
    );
    expect(replay.headers.location).toMatch(/result=/);
  });

  it('credentials are write-only: rejected ones save nothing, good ones are never shown again', async () => {
    expectError(
      await connect('textmagic', { credentials: { username: 'fake', apiKey: 'wrong' } }),
      400,
      'CREDENTIALS_REJECTED',
    );
    expect(
      await inFirm('a', (tx) =>
        tx.integrationConnection.count({ where: { provider: 'textmagic' } }),
      ),
    ).toBe(0);
    expectError(
      await connect('textmagic', { credentials: { username: 'fake' } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await connect('textmagic', {}), 400, 'VALIDATION_FAILED');
    expectError(
      await connect('textmagic', {
        credentials: { username: 'fake', apiKey: API_KEY, extra: 'x' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const made = ConnectIntegrationResult.parse(
      ok(await connect('textmagic', { credentials: { username: 'fake', apiKey: API_KEY } })),
    );
    expect(made.mode).toBe('CONNECTED');
    noSecrets(made);
    const c = await connectionOf('textmagic');
    expect(c.accountIdLast4).toBe('0001');
    noSecrets(c);
    noSecrets(await inFirm('a', (tx) => tx.auditLog.findMany({ where: { entityId: c.id } })));
  });
});

describe('settings', () => {
  it('are checked against the provider: its objects, directions, frequencies and options', async () => {
    const c = await connectionOf('quickbooks');
    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/integrations/connections/${c.id}/settings`, who, body);
    expectError(await patch({ entities: ['unicorns'] }), 409, 'INVALID_CONFIGURATION');
    expectError(
      await patch({ entities: ['employees'], direction: 'TWO_WAY' }),
      409,
      'NOT_SUPPORTED',
    );
    expectError(await patch({ syncEveryMinutes: 7 }), 409, 'NOT_SUPPORTED');
    expectError(
      await patch({ syncMode: 'MANUAL', syncEveryMinutes: 60 }),
      409,
      'INVALID_CONFIGURATION',
    );
    expectError(await patch({ options: { nope: true } }), 409, 'INVALID_CONFIGURATION');
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ syncMode: 'MANUAL' }, people.staffA), 403, 'FORBIDDEN');
    const saved = IntegrationConnectionDetail.parse(
      ok(
        await patch({
          entities: ['invoices', 'payments'],
          syncEveryMinutes: 240,
          direction: 'IMPORT',
        }),
      ),
    );
    expect(saved).toMatchObject({
      entities: ['invoices', 'payments'],
      syncEveryMinutes: 240,
      direction: 'IMPORT',
      syncMode: 'AUTO',
    });
    expect(saved.nextSyncAt).not.toBeNull();
    const manual = IntegrationConnectionDetail.parse(ok(await patch({ syncMode: 'MANUAL' })));
    expect(manual).toMatchObject({ syncMode: 'MANUAL', syncEveryMinutes: null, nextSyncAt: null });
    ok(
      await patch({
        syncMode: 'AUTO',
        syncEveryMinutes: 60,
        entities: ['invoices', 'customers', 'payments'],
        direction: 'TWO_WAY',
      }),
    );
  });
});

describe('sync, pause, test and health', () => {
  it('Sync Now queues one run per object, refuses a second while one runs, and records the counts', async () => {
    const c = await connectionOf('quickbooks');
    let release!: () => void;
    behavior.syncGate = new Promise<void>((r) => (release = r));
    const first = IntegrationSyncRun.parse(
      ok(
        await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {
          entities: ['invoices'],
        }),
      ),
    );
    expect(first).toMatchObject({
      entity: 'invoices',
      manual: true,
      requestedBy: { userId: people.ownerA.id },
    });
    expect(['QUEUED', 'RUNNING']).toContain(first.status);
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {}),
      409,
      'SYNC_IN_PROGRESS',
    );
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {
        entities: ['employees'],
      }),
      409,
      'SYNC_IN_PROGRESS',
    );
    behavior.syncGate = null;
    release();
    await waitFor(
      async () =>
        (await connectionOf('quickbooks')).status === 'CONNECTED' &&
        (await inFirm('a', (tx) =>
          tx.integrationSyncRun.count({
            where: { connectionId: c.id, status: 'SUCCEEDED', entity: 'invoices' },
          }),
        )) === 1,
    );
    const detail = IntegrationSyncRunDetail.parse(
      ok(await call('get', `/integrations/connections/${c.id}/history/${first.id}`, people.staffA)),
    );
    expect(detail).toMatchObject({
      status: 'SUCCEEDED',
      recordCount: 42,
      failedCount: 0,
      guidance: [],
    });
    expect((await connectionOf('quickbooks')).lastSyncAt).not.toBeNull();
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {
        entities: ['employees'],
      }),
      409,
      'INVALID_CONFIGURATION',
    );
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, { entities: [] }),
      400,
      'VALIDATION_FAILED',
    );

    const history = IntegrationHistoryPage.parse(
      ok(
        await call(
          'get',
          `/integrations/connections/${c.id}/history?status=SUCCEEDED&manual=true`,
          people.staffA,
        ),
      ),
    );
    expect(history.items.map((r) => r.entity)).toContain('invoices');
    expect(history.items.every((r) => r.status === 'SUCCEEDED' && r.manual)).toBe(true);
    expectError(
      await call('get', `/integrations/connections/${c.id}/history/${randomUUID()}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
  });

  it('a failed sync with an expired authorization needs attention, with the fix; a partial one says so', async () => {
    const c = await connectionOf('quickbooks');
    behavior.syncFailed = 3;
    const partial = IntegrationSyncRun.parse(
      ok(
        await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {
          entities: ['customers'],
        }),
      ),
    );
    await waitFor(
      async () =>
        (
          await inFirm('a', (tx) =>
            tx.integrationSyncRun.findFirstOrThrow({ where: { id: partial.id } }),
          )
        ).finishedAt !== null,
    );
    behavior.syncFailed = 0;
    expect(
      await inFirm('a', (tx) =>
        tx.integrationSyncRun.findFirstOrThrow({ where: { id: partial.id } }),
      ),
    ).toMatchObject({ status: 'PARTIAL', failedCount: 3 });
    await waitFor(async () => (await connectionOf('quickbooks')).status === 'CONNECTED');

    behavior.syncError = new AdapterError('authorization_expired');
    const failing = IntegrationSyncRun.parse(
      ok(
        await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {
          entities: ['invoices'],
        }),
      ),
    );
    await waitFor(async () => (await connectionOf('quickbooks')).status === 'NEEDS_ATTENTION');
    behavior.syncError = null;
    const run = IntegrationSyncRunDetail.parse(
      ok(
        await call('get', `/integrations/connections/${c.id}/history/${failing.id}`, people.ownerA),
      ),
    );
    expect(run).toMatchObject({ status: 'FAILED', errorCode: 'authorization_expired' });
    expect(run.guidance[0]).toMatch(/Reconnect/);
    const summary = IntegrationConnectionDetail.parse(
      ok(await call('get', `/integrations/connections/${c.id}`, people.ownerA)),
    );
    expect(summary).toMatchObject({
      status: 'NEEDS_ATTENTION',
      issue: 'AUTHORIZATION_EXPIRED',
      statusMessage: 'Authorization expired',
      statusAction: 'RECONNECT',
    });
    const health = IntegrationConnectionHealth.parse(
      ok(await call('get', `/integrations/connections/${c.id}/health`, people.staffA)),
    );
    expect(health.ok).toBe(false);
    expect(health.checks.find((x) => x.key === 'AUTHENTICATION')?.ok).toBe(false);
    expect(health.suggestions.join(' ')).toMatch(/Reconnect/);
    const overview = IntegrationsOverview.parse(
      ok(await call('get', '/integrations?tab=attention', people.ownerA)),
    );
    expect(overview.items.map((i) => i.provider.provider)).toEqual(['quickbooks']);
    expect(overview.summary.allOperational).toBe(false);
    expect(overview.health.authorizationIssues).toBe(1);
    // A connection that needs attention does not sync until it is reconnected.
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {}),
      409,
      'NOT_CONNECTED',
    );
    expectError(
      await call('post', `/integrations/connections/${c.id}/pause`, people.ownerA),
      409,
      'NOT_CONNECTED',
    );
  });

  it('reconnecting an expired connection goes back through the provider and clears the problem', async () => {
    const c = await connectionOf('quickbooks');
    const start = await call(
      'post',
      `/integrations/connections/${c.id}/reconnect`,
      people.ownerA,
      {},
    );
    const result = ConnectIntegrationResult.parse(ok(start));
    expect(result.mode).toBe('REDIRECT');
    if (result.mode !== 'REDIRECT') throw new Error('expected REDIRECT');
    const state = new URL(result.url).searchParams.get('state')!;
    const cookie = (
      (start.headers['set-cookie'] as unknown as string[]).find((x) =>
        x.startsWith('fv_int_state='),
      ) ?? ''
    ).split(';')[0]!;
    const back = await request(app.getHttpServer())
      .get(`/api/v1/integrations/callback?state=${encodeURIComponent(state)}&code=good`)
      .set('cookie', cookie)
      .set('x-forwarded-for', viewer());
    expect(back.headers.location).toMatch(/result=connected$/);
    const after = await connectionOf('quickbooks');
    expect(after).toMatchObject({ id: c.id, status: 'CONNECTED', statusReason: null });
    // The settings it had are kept.
    expect(after.entities).toEqual(['invoices', 'customers', 'payments']);
    expectError(
      await call('post', `/integrations/connections/${c.id}/reconnect`, people.staffA, {}),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/integrations/connections/${randomUUID()}/reconnect`, people.ownerA, {}),
      404,
      'NOT_FOUND',
    );
  });

  it('pauses and resumes; repeating either is a clear conflict', async () => {
    const c = await connectionOf('quickbooks');
    const paused = IntegrationConnectionSummary.parse(
      ok(await call('post', `/integrations/connections/${c.id}/pause`, people.ownerA)),
    );
    expect(paused).toMatchObject({ status: 'PAUSED', nextSyncAt: null });
    expectError(
      await call('post', `/integrations/connections/${c.id}/pause`, people.ownerA),
      409,
      'ALREADY_PAUSED',
    );
    expect(
      IntegrationsOverview.parse(ok(await call('get', '/integrations', people.ownerA))).items.find(
        (i) => i.provider.provider === 'quickbooks',
      ),
    ).toMatchObject({ status: 'PAUSED', action: 'RESUME' });
    const resumed = IntegrationConnectionSummary.parse(
      ok(await call('post', `/integrations/connections/${c.id}/resume`, people.ownerA)),
    );
    expect(resumed.status).toBe('CONNECTED');
    expect(resumed.nextSyncAt).not.toBeNull();
    expectError(
      await call('post', `/integrations/connections/${c.id}/resume`, people.ownerA),
      409,
      'ALREADY_PAUSED',
    );
  });

  it('the connection test records a run and marks what it found', async () => {
    const c = await connectionOf('quickbooks');
    const good = IntegrationTestResult.parse(
      ok(await call('post', `/integrations/connections/${c.id}/test`, people.ownerA)),
    );
    expect(good.ok).toBe(true);
    expect((await connectionOf('quickbooks')).lastCheckAt).not.toBeNull();
    behavior.checks = [
      { key: 'AUTHENTICATION', ok: true },
      { key: 'PERMISSIONS', ok: false, message: 'Missing invoices permission' },
    ];
    const bad = IntegrationTestResult.parse(
      ok(await call('post', `/integrations/connections/${c.id}/test`, people.ownerA)),
    );
    behavior.checks = null;
    expect(bad.ok).toBe(false);
    expect(bad.checks.find((x) => x.key === 'PERMISSIONS')).toMatchObject({
      ok: false,
      message: 'Missing invoices permission',
    });
    expect(await connectionOf('quickbooks')).toMatchObject({
      status: 'NEEDS_ATTENTION',
      statusReason: 'permission_missing',
    });
    ok(await call('post', `/integrations/connections/${c.id}/test`, people.ownerA));
    expect((await connectionOf('quickbooks')).status).toBe('CONNECTED');
    expectError(
      await call('post', `/integrations/connections/${c.id}/test`, people.staffA),
      403,
      'FORBIDDEN',
    );
    const activity = IntegrationActivityPage.parse(
      ok(await call('get', '/integrations/activity?provider=quickbooks', people.staffA)),
    );
    expect(activity.items.some((a) => a.kind === 'TEST')).toBe(true);
    expect(activity.items.some((a) => a.kind === 'CONNECT')).toBe(true);
    expect(everywhere(activity)).not.toMatch(/SUPERSECRET/);
  });
});

describe('mappings and permissions', () => {
  it('save the pairs of a scope from the provider’s lists, nothing else', async () => {
    const c = await connectionOf('quickbooks');
    const put = (body: object, who: Who = people.ownerA) =>
      call('put', `/integrations/connections/${c.id}/mappings`, who, body);
    const pair = (localField: string, externalField: string) => ({ localField, externalField });
    const saved = IntegrationMappings.parse(
      ok(
        await put({
          scope: 'client',
          pairs: [pair('client.name', 'DisplayName'), pair('client.email', 'PrimaryEmailAddr')],
        }),
      ),
    );
    expect(
      saved.scopes
        .find((s) => s.scope === 'client')
        ?.pairs.map((p) => [p.localLabel, p.externalLabel]),
    ).toEqual([
      ['Client Name', 'Customer Name'],
      ['Email', 'Email'],
    ]);
    expectError(
      await put({ scope: 'client', pairs: [pair('client.name', 'Nope')] }),
      409,
      'INVALID_CONFIGURATION',
    );
    expectError(await put({ scope: 'weather', pairs: [] }), 409, 'INVALID_CONFIGURATION');
    expectError(
      await put({
        scope: 'client',
        pairs: [pair('client.name', 'DisplayName'), pair('client.name', 'PrimaryPhone')],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await put({ scope: 'client', pairs: [] }, people.staffA), 403, 'FORBIDDEN');
    const replaced = IntegrationMappings.parse(
      ok(await put({ scope: 'client', pairs: [pair('client.phone', 'PrimaryPhone')] })),
    );
    expect(replaced.scopes.find((s) => s.scope === 'client')?.pairs).toHaveLength(1);
    expect(
      IntegrationMappings.parse(
        ok(await call('get', `/integrations/connections/${c.id}/mappings`, people.staffA)),
      ).scopes.length,
    ).toBe(2);
    const overview = IntegrationsOverview.parse(
      ok(await call('get', '/integrations', people.ownerA)),
    );
    expect(overview.mapping).toEqual([
      { scope: 'client', label: 'Client fields', mappedFields: 1 },
    ]);
  });

  it('list what was granted in plain words', async () => {
    const c = await connectionOf('quickbooks');
    const list = IntegrationPermissionList.parse(
      ok(await call('get', `/integrations/connections/${c.id}/permissions`, people.staffA)),
    );
    expect(list.items.every((p) => p.granted)).toBe(true);
    expect(list.needsReconnect).toBe(false);
  });
});

describe('Custom API & Webhooks', () => {
  it('keeps its setup, its secret write-only, and tests the endpoint with a signed event', async () => {
    const made = ConnectIntegrationResult.parse(ok(await connect('custom_api')));
    if (made.mode !== 'CONNECTED') throw new Error('expected CONNECTED');
    const id = made.connection.id;
    const events = CustomIntegrationEventList.parse(
      ok(await call('get', '/integrations/custom-events', people.staffA)),
    );
    expect(events.items.map((e) => e.key)).toContain('client.created');

    const initial = CustomIntegrationConfig.parse(
      ok(await call('get', `/integrations/connections/${id}/custom`, people.staffA)),
    );
    expect(initial).toMatchObject({ enabled: false, authMethod: 'NONE', secretLast4: null });
    expect(initial.inboundUrl).toContain(id);

    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/integrations/connections/${id}/custom`, who, body);
    expectError(
      await patch({ endpointUrl: 'http://insecure.example/hook' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await patch({ endpointUrl: 'https://localhost/hook' }), 400, 'VALIDATION_FAILED');
    expectError(
      await patch({ endpointUrl: 'https://169.254.169.254/latest' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await patch({ endpointUrl: 'https://user:pass@hooks.example/x' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await patch({ events: ['nope.event'] }), 409, 'INVALID_CONFIGURATION');
    expectError(await patch({ enabled: true }), 409, 'INVALID_CONFIGURATION');
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ name: 'x' }, people.staffA), 403, 'FORBIDDEN');
    const saved = CustomIntegrationConfig.parse(
      ok(
        await patch({
          name: 'Acme hook',
          endpointUrl: 'https://hooks.example/firmivra',
          authMethod: 'HMAC_SIGNATURE',
          events: ['client.created', 'invoice.paid'],
        }),
      ),
    );
    expect(saved).toMatchObject({
      name: 'Acme hook',
      events: ['client.created', 'invoice.paid'],
      enabled: false,
    });
    expectError(await patch({ enabled: true }), 409, 'INVALID_CONFIGURATION');

    const rotated = CustomIntegrationConfig.parse(
      ok(
        await call('post', `/integrations/connections/${id}/custom/secret`, people.ownerA, {
          secret: WEBHOOK_SECRET,
        }),
      ),
    );
    expect(rotated.secretLast4).toBe('0042');
    expect(rotated.secretRotatedAt).not.toBeNull();
    noSecrets(rotated);
    expectError(
      await call('post', `/integrations/connections/${id}/custom/secret`, people.ownerA, {
        secret: 'short',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(CustomIntegrationConfig.parse(ok(await patch({ enabled: true }))).enabled).toBe(true);
    noSecrets(
      await call('get', `/integrations/connections/${id}/custom`, people.ownerA).then(
        (r) => r.body,
      ),
    );
    noSecrets(
      await inFirm('a', (tx) => tx.integrationConnection.findFirstOrThrow({ where: { id } })),
    );
    noSecrets(await inFirm('a', (tx) => tx.auditLog.findMany({ where: { entityId: id } })));

    posted.length = 0;
    const tested = CustomIntegrationTestResult.parse(
      ok(await call('post', `/integrations/connections/${id}/custom/test`, people.ownerA)),
    );
    expect(tested).toMatchObject({ ok: true, statusCode: 200, durationMs: 12 });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe('https://hooks.example/firmivra');
    expect(posted[0]!.headers['x-firmivra-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(JSON.parse(posted[0]!.body)).toMatchObject({ event: 'test' });
    outbound.next = { status: 500, failure: null };
    const failed = CustomIntegrationTestResult.parse(
      ok(await call('post', `/integrations/connections/${id}/custom/test`, people.ownerA)),
    );
    outbound.next = { status: null, failure: 'blocked' };
    const blocked = CustomIntegrationTestResult.parse(
      ok(await call('post', `/integrations/connections/${id}/custom/test`, people.ownerA)),
    );
    outbound.next = { status: 200, failure: null };
    expect(failed).toMatchObject({ ok: false, statusCode: 500 });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/public https/);
    expectError(
      await call('post', `/integrations/connections/${id}/custom/test`, people.staffA),
      403,
      'FORBIDDEN',
    );
    // Only the custom provider has this route.
    const c = await connectionOf('quickbooks');
    expectError(
      await call('get', `/integrations/connections/${c.id}/custom`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    // Firm B cannot reach it.
    expectError(
      await call('get', `/integrations/connections/${id}/custom`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'post',
        `/integrations/connections/${id}/custom/secret`,
        people.ownerB,
        { secret: 'x'.repeat(20) },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
  });
});

describe('requests for an integration that is not listed', () => {
  it('are made and listed by the firm; the status and internal note are Super Admin’s', async () => {
    const body = {
      providerName: 'Acme CRM',
      connectTo: 'Leads and clients',
      websiteUrl: 'https://acme.example',
      category: 'CRM_LEADS',
      businessReason: 'We use it daily',
    };
    const made = IntegrationRequestRow.parse(
      ok(await call('post', '/integration-requests', people.ownerA, body), 201),
    );
    expect(made).toMatchObject({
      providerName: 'Acme CRM',
      status: 'NEW',
      requestedBy: { userId: people.ownerA.id },
      category: 'CRM_LEADS',
    });
    expect(everywhere(made)).not.toMatch(/internalNote|businessId/);
    expectError(
      await call('post', '/integration-requests', people.ownerA, { providerName: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/integration-requests', people.ownerA, { ...body, status: 'AVAILABLE' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('post', '/integration-requests', people.staffA, body), 403, 'FORBIDDEN');
    const list = IntegrationRequestList.parse(
      ok(await call('get', '/integration-requests', people.staffA)),
    );
    expect(list.items.map((r) => r.id)).toContain(made.id);
    expect(
      IntegrationRequestList.parse(
        ok(await call('get', '/integration-requests', people.ownerB, undefined, 'b')),
      ).items,
    ).toEqual([]);
  });
});

describe('disconnecting', () => {
  it('needs the confirmation, removes the secret, keeps the history, and can be reconnected', async () => {
    const c = await connectionOf('textmagic');
    expectError(
      await call('post', `/integrations/connections/${c.id}/disconnect`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/integrations/connections/${c.id}/disconnect`, people.staffA, {
        confirm: true,
      }),
      403,
      'FORBIDDEN',
    );
    const done = IntegrationConnectionSummary.parse(
      ok(
        await call('post', `/integrations/connections/${c.id}/disconnect`, people.ownerA, {
          confirm: true,
        }),
      ),
    );
    expect(done.status).toBe('DISCONNECTED');
    expect(await secrets.get(c.secretRef!)).toBeNull();
    const after = await connectionOf('textmagic');
    expect(after).toMatchObject({ status: 'DISCONNECTED', secretRef: null });
    expect(after.disconnectedAt).not.toBeNull();
    // Idempotent.
    expect(
      IntegrationConnectionSummary.parse(
        ok(
          await call('post', `/integrations/connections/${c.id}/disconnect`, people.ownerA, {
            confirm: true,
          }),
        ),
      ).status,
    ).toBe('DISCONNECTED');
    expectError(
      await call('post', `/integrations/connections/${c.id}/sync`, people.ownerA, {}),
      409,
      'NOT_CONNECTED',
    );
    expectError(
      await call('patch', `/integrations/connections/${c.id}/settings`, people.ownerA, {
        syncMode: 'MANUAL',
      }),
      409,
      'NOT_CONNECTED',
    );
    // The history and the audit stay.
    expect(
      await inFirm('a', (tx) => tx.integrationSyncRun.count({ where: { connectionId: c.id } })),
    ).toBeGreaterThan(0);
    expect(
      (
        await inFirm('a', (tx) =>
          tx.auditLog.findMany({ where: { entityId: c.id }, select: { action: true } }),
        )
      ).map((a) => a.action),
    ).toEqual(expect.arrayContaining(['integration.connected', 'integration.disconnected']));
    // Reconnect reuses the same row.
    const again = ConnectIntegrationResult.parse(
      ok(await connect('textmagic', { credentials: { username: 'fake', apiKey: API_KEY } })),
    );
    if (again.mode !== 'CONNECTED') throw new Error('expected CONNECTED');
    expect(again.connection.id).toBe(c.id);
    expect(again.connection.status).toBe('CONNECTED');
    // A disconnected provider's revoke was asked of the adapter (best effort).
    ok(
      await call(
        'post',
        `/integrations/connections/${(await connectionOf('quickbooks')).id}/disconnect`,
        people.ownerA,
        { confirm: true },
      ),
    );
    expect(behavior.revoked).toBeGreaterThanOrEqual(1);
  });
});

describe('another firm', () => {
  it('never reads or changes firm A’s connections', async () => {
    const c = await connectionOf('website_forms');
    for (const [method, path, body] of [
      ['get', `/integrations/connections/${c.id}`, undefined],
      ['get', `/integrations/connections/${c.id}/health`, undefined],
      ['get', `/integrations/connections/${c.id}/history`, undefined],
      ['get', `/integrations/connections/${c.id}/mappings`, undefined],
      ['get', `/integrations/connections/${c.id}/permissions`, undefined],
      ['patch', `/integrations/connections/${c.id}/settings`, { syncMode: 'MANUAL' }],
      ['post', `/integrations/connections/${c.id}/sync`, {}],
      ['post', `/integrations/connections/${c.id}/pause`, undefined],
      ['post', `/integrations/connections/${c.id}/test`, undefined],
      ['post', `/integrations/connections/${c.id}/reconnect`, {}],
      ['post', `/integrations/connections/${c.id}/disconnect`, { confirm: true }],
      ['put', `/integrations/connections/${c.id}/mappings`, { scope: 'lead', pairs: [] }],
    ] as const) {
      const res = await call(method, path, people.ownerB, body, 'b');
      expect([res.status, codeOf(res)], `${method} ${path}`).toEqual([404, 'NOT_FOUND']);
    }
    expect((await connectionOf('website_forms')).status).toBe('CONNECTED');
    const activity = IntegrationActivityPage.parse(
      ok(await call('get', '/integrations/activity', people.ownerB, undefined, 'b')),
    );
    expect(activity.items).toEqual([]);
  });
});

void z;
