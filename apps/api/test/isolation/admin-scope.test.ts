// R8 step 2 (R0's #123 answer): the admin site never opens a plain business scope. A Super Admin
// reaches a firm's data only through SupportScope (app_enter_support_scope: their own active
// grant, read-only). This calls every GET route under /api/v1/admin as a Super Admin and fails if
// any of them opened the firm's scope through forBusiness or withScope({ kind: 'business' }).
// The one exception is AuditService writing a firm's own audit row ("Firmivra Support"), which
// only inserts and reads nothing.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, Scope } from '@firmivra/db';
import { AppModule } from '../../src/app.module.js';
import { requestContext } from '../../src/common/request-context.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DATABASE } from '../../src/database/database.module.js';
import { apiRoutes, fillPath } from './routes.js';

const fx = inject('fixtures');
let app: INestApplication;
/** Request paths that opened a business scope, outside AuditService. */
const opened: string[] = [];

function record(): void {
  const path = requestContext.getStore()?.path;
  if (path === undefined) return;
  if (new Error().stack?.includes('audit/audit.service')) return;
  opened.push(path);
}

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  const db = nest.get<Database>(DATABASE);
  const forBusiness = db.forBusiness.bind(db);
  const withScope = db.withScope.bind(db);
  db.forBusiness = (...args: Parameters<Database['forBusiness']>) => {
    record();
    return forBusiness(...args);
  };
  db.withScope = ((scope: Scope, ...rest: [never, never]) => {
    if (scope.kind === 'business') record();
    return withScope(scope, ...rest);
  }) as Database['withScope'];
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

async function call(method: 'get', path: string, email: string, firm?: string) {
  const { token } = (
    await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email }).expect(200)
  ).body as { token: string };
  const req = request(app.getHttpServer())[method](path).set('authorization', `Bearer ${token}`);
  return firm ? req.set('x-business-id', firm) : req;
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
    expect(opened.filter((p) => /^\/api\/v1\/admin(\/|$)/i.test(p))).toEqual([]);
  });

  it('the check sees a business scope when one opens (a firm route)', async () => {
    const res = await call('get', '/api/v1/business/audit-log', fx.users.ownerA.email, fx.firmA.id);
    expect(res.status).toBe(200);
    expect(opened).toContain('/api/v1/business/audit-log');
  });
});
