// R8 step 2 (R0's #123 answer): the admin site never opens a plain business scope. A Super Admin
// reaches a firm's data only through SupportScope (app_enter_support_scope: their own active
// grant, read-only). This calls every route under /api/v1/admin as a Super Admin (writes with a
// valid body against real records) and fails if any of them opened a firm's scope through
// forBusiness or withScope({ kind: 'business' }). Exceptions: AuditService writing a firm's own
// audit row ("Firmivra Support"), which only inserts; and ONBOARDING below, where approving an
// application sets up the firm it just created, and only that firm.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type Database, type Scope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { requestContext } from '../../src/common/request-context.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DATABASE } from '../../src/database/database.module.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { apiRoutes, fillPath } from './routes.js';

const fx = inject('fixtures');
let app: INestApplication;
/** Business scopes opened during requests, outside AuditService: the path and the firm. */
const opens: { path: string; businessId: string }[] = [];
const opened = () => opens.map((o) => o.path);

function record(businessId: string): void {
  const path = requestContext.getStore()?.path;
  if (path === undefined) return;
  if (new Error().stack?.includes('audit/audit.service')) return;
  opens.push({ path, businessId });
}

/**
 * Admin writes allowed to open a business scope, and only the scope of the firm their own
 * application created (still in setup): approve copies the application's details into the new
 * firm's settings and invites its Owner; owner-invite resends that invite. They read no other
 * firm's data. R0 may later move them behind a definer function like the support scope.
 */
const ONBOARDING = new Set([
  'POST /api/v1/admin/firm-applications/:id/approve',
  'POST /api/v1/admin/firm-applications/:id/owner-invite',
]);

/** A pending application per write case, so each action meets a record it can act on. */
const applications: Record<string, string> = {};

/**
 * Every admin write, with a body that passes validation, run in this order; `app` names the
 * application it acts on (the owner invite resends for the one just approved).
 */
const WRITES: Record<string, { body: object; app?: string }> = {
  'POST /api/v1/admin/firm-applications/:id/approve': { body: {}, app: 'approve' },
  'POST /api/v1/admin/firm-applications/:id/request-info': {
    body: { message: 'Fake: please send your licence' },
    app: 'info',
  },
  'POST /api/v1/admin/firm-applications/:id/decline': {
    body: { reason: 'Fake reason' },
    app: 'decline',
  },
  'POST /api/v1/admin/firm-applications/:id/owner-invite': { body: {}, app: 'approve' },
  'PUT /api/v1/admin/firm-applications/:id/notes': { body: { notes: 'Fake note' }, app: 'notes' },
  'POST /api/v1/admin/firms/:businessId/support-access': { body: { reason: 'Fake reason' } },
};

/** The firm an approved application created, or null. */
async function firmOf(applicationId: string): Promise<string | null> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const row = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.firmApplication.findUnique({ where: { id: applicationId }, select: { businessId: true } }),
  );
  await owner.$disconnect();
  return row?.businessId ?? null;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const c of Object.values(WRITES)) {
      if (!c.app || c.app in applications) continue;
      const tag = randomUUID().slice(0, 8);
      const row = await tx.firmApplication.create({
        data: {
          legalName: `Fake Scope Firm ${tag}`,
          contactName: 'Fake Applicant',
          contactEmail: `scope-${tag}@scope.example.test`,
          data: {},
        },
      });
      applications[c.app] = row.id;
    }
  });
  await owner.$disconnect();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  })
    // No mail server in tests: the invites and notices go nowhere.
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  const db = nest.get<Database>(DATABASE);
  const forBusiness = db.forBusiness.bind(db);
  const withScope = db.withScope.bind(db);
  db.forBusiness = (...args: Parameters<Database['forBusiness']>) => {
    record(args[0]);
    return forBusiness(...args);
  };
  db.withScope = ((scope: Scope, ...rest: [never, never]) => {
    if (scope.kind === 'business') record(scope.businessId);
    return withScope(scope, ...rest);
  }) as Database['withScope'];
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  email: string,
  firm?: string,
  body?: object,
) {
  const { token } = (
    await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email }).expect(200)
  ).body as { token: string };
  const req = request(app.getHttpServer())[method](path).set('authorization', `Bearer ${token}`);
  const scoped = firm ? req.set('x-business-id', firm) : req;
  return body === undefined ? scoped : scoped.send(body);
}

describe('the admin site never opens a business scope', () => {
  it('every GET under /api/v1/admin, as a Super Admin, with real and unknown firm ids', async () => {
    const admin = apiRoutes(app).filter(
      (r) => r.method === 'GET' && /^\/api\/v1\/admin(\/|$)/i.test(r.path),
    );
    expect(admin.length).toBeGreaterThan(5);
    for (const firm of [fx.firmA.id, randomUUID()]) {
      for (const route of admin) {
        const path = fillPath(route.path, { businessId: firm, id: firm }, randomUUID);
        const res = await call('get', path, fx.users.admin.email);
        expect(res.status, `${route.name} ${path}`).toBeLessThan(500);
      }
    }
    expect(opened().filter((p) => /^\/api\/v1\/admin(\/|$)/i.test(p))).toEqual([]);
  });

  it('every write under /api/v1/admin, as a Super Admin, with a valid body and real records', async () => {
    const writes = apiRoutes(app).filter(
      (r) => r.method !== 'GET' && !r.isPublic && /^\/api\/v1\/admin(\/|$)/i.test(r.path),
    );
    const keys = writes.map((r) => `${r.method} ${r.path}`);
    expect(
      keys.filter((k) => !(k in WRITES)),
      'add the new admin write to WRITES',
    ).toEqual([]);
    const order = Object.keys(WRITES);
    writes.sort(
      (a, b) => order.indexOf(`${a.method} ${a.path}`) - order.indexOf(`${b.method} ${b.path}`),
    );
    const wrong: string[] = [];
    for (const route of writes) {
      const key = `${route.method} ${route.path}`;
      const c = WRITES[key]!;
      const values = { businessId: fx.firmA.id, id: c.app ? applications[c.app]! : randomUUID() };
      const path = fillPath(route.path, values);
      const method = route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete';
      const from = opens.length;
      const res = await call(method, path, fx.users.admin.email, undefined, c.body);
      expect(res.status, `${route.name} ${path} ${JSON.stringify(res.body)}`).toBeLessThan(400);
      const created = c.app ? await firmOf(applications[c.app]!) : null;
      for (const o of opens.slice(from)) {
        const allowed = ONBOARDING.has(key) && created !== null && o.businessId === created;
        if (!allowed) wrong.push(`${key}: opened firm ${o.businessId}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the check sees a business scope when one opens (a firm route)', async () => {
    const res = await call('get', '/api/v1/business/audit-log', fx.users.ownerA.email, fx.firmA.id);
    expect(res.status).toBe(200);
    expect(opened()).toContain('/api/v1/business/audit-log');
  });
});
