// End-to-end: R2 step 5 guards. 401 without a session, 404 without a link to the firm, 403 for
// the wrong role or a firm in the wrong status; Super Admins only on /api/v1/admin/*.
import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  AllowBusinessStatuses,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../../src/auth/decorators.js';
import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/request-context.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';
import { PlatformPrisma } from '../../src/database/database.module.js';

@Controller('probe')
class FirmProbe {
  constructor(private readonly platform: PlatformPrisma) {}

  @Get('managers')
  @Roles(...FIRM_MANAGERS)
  managers(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }

  @Get('staff')
  @Roles(...FIRM_STAFF)
  staff(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }

  @Get('setup')
  @Roles(...FIRM_MANAGERS)
  @AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
  setup(@CurrentTenant() tenant: TenantContext) {
    return tenant;
  }

  /** A firm route reaching for platform tables: PlatformPrisma must refuse. */
  @Get('platform-misuse')
  @Roles(...FIRM_STAFF)
  async misuse() {
    return { businesses: await this.platform.db.business.count() };
  }
}

@Controller('admin/probe')
class AdminProbe {
  constructor(private readonly platform: PlatformPrisma) {}

  @Get()
  @Roles('SUPER_ADMIN')
  async get() {
    return { businesses: await this.platform.db.business.count() };
  }
}

/** Unreachable by design: the API must refuse to start with it. */
@Controller('reports')
class MisplacedSuperAdminRoute {
  @Get()
  @Roles('SUPER_ADMIN')
  get() {
    return {};
  }
}

const fx = inject('fixtures');
let app: INestApplication;
let env: Env;

const people = {
  pendingOwner: { id: randomUUID(), email: `r2-guards-pending-${randomUUID()}@p.test` },
  twoFirms: { id: randomUUID(), email: `r2-guards-two-${randomUUID()}@a.test` },
  formerAdmin: { id: randomUUID(), email: `r2-guards-former-${randomUUID()}@firmivra.test` },
};
let pendingFirm: { id: string; slug: string };

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}

async function call(path: string, email: string | undefined, businessId?: string) {
  const token = email ? await tokenFor(email) : undefined;
  let req = request(app.getHttpServer()).get(path);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  if (businessId) req = req.set('x-business-id', businessId);
  return req;
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function createApp(controllers: unknown[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
    controllers: controllers as never[],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  return nest;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  pendingFirm = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [p, pool] of [
      [people.pendingOwner, 'STAFF'],
      [people.twoFirms, 'STAFF'],
      [people.formerAdmin, 'ADMIN'],
    ] as const) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: 'Fake R2 person' },
      });
    }
    const slug = `r2-pending-${randomUUID().slice(0, 8)}`;
    return tx.business.create({
      data: { slug, name: slug, status: 'PENDING_SETUP' },
      select: { id: true, slug: true },
    });
  });
  const memberships = [
    [pendingFirm.id, people.pendingOwner.id, 'OWNER'],
    [fx.firmA.id, people.twoFirms.id, 'STAFF'],
    [fx.firmB.id, people.twoFirms.id, 'STAFF'],
  ] as const;
  for (const [businessId, userId, role] of memberships) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await owner.$disconnect();

  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  app = await createApp([FirmProbe, AdminProbe]);
});

afterAll(async () => {
  await app.close();
});

describe('firm routes', () => {
  it('managers-only route: 200 owner, 403 staff and client, 404 other firm, 401 no session', async () => {
    const path = '/api/v1/probe/managers';
    const owner = await call(path, fx.users.ownerA.email, fx.firmA.id);
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual({ businessId: fx.firmA.id, role: 'OWNER', kind: 'staff' });

    for (const email of [fx.users.staffA.email, fx.users.clientA.email]) {
      const res = await call(path, email, fx.firmA.id);
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
    const outsider = await call(path, fx.users.ownerB.email, fx.firmA.id);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
    expect((await call(path, undefined, fx.firmA.id)).status).toBe(401);
    // A Super Admin session never works on the firm API.
    expect((await call(path, fx.users.admin.email, fx.firmA.id)).status).toBe(401);
  });

  it('needs a chosen firm when the person works at several', async () => {
    const res = await call('/api/v1/probe/staff', people.twoFirms.email);
    expect([res.status, codeOf(res)]).toEqual([400, 'BUSINESS_REQUIRED']);
    const chosen = await call('/api/v1/probe/staff', people.twoFirms.email, fx.firmB.id);
    expect(chosen.body).toEqual({ businessId: fx.firmB.id, role: 'STAFF', kind: 'staff' });
  });

  it('refuses a suspended firm with 403 BUSINESS_INACTIVE', async () => {
    const res = await call('/api/v1/probe/staff', fx.users.ownerSuspended.email, fx.suspended.id);
    expect([res.status, codeOf(res)]).toEqual([403, 'BUSINESS_INACTIVE']);
  });

  it('lets a firm in setup reach only the routes that allow it', async () => {
    const owner = people.pendingOwner.email;
    const blocked = await call('/api/v1/probe/staff', owner, pendingFirm.id);
    expect([blocked.status, codeOf(blocked)]).toEqual([403, 'BUSINESS_SETUP_REQUIRED']);
    const wizard = await call('/api/v1/probe/setup', owner, pendingFirm.id);
    expect(wizard.body).toEqual({ businessId: pendingFirm.id, role: 'OWNER', kind: 'staff' });

    // Outsiders learn nothing about the firm, not even that it is in setup.
    const outsider = await call('/api/v1/probe/setup', fx.users.ownerB.email, pendingFirm.id);
    expect(outsider.status).toBe(404);
  });

  it('never hands platform tables to a firm route', async () => {
    const res = await call('/api/v1/probe/platform-misuse', fx.users.ownerA.email, fx.firmA.id);
    expect([res.status, codeOf(res)]).toEqual([500, 'INTERNAL_ERROR']);
  });
});

describe('Super Admin routes', () => {
  it('admits a Super Admin with platform scope; nobody else', async () => {
    const admin = await call('/api/v1/admin/probe', fx.users.admin.email);
    expect(admin.status).toBe(200);
    expect((admin.body as { businesses: number }).businesses).toBeGreaterThanOrEqual(4);

    // Admins pool, but no platform_admins row (for example removed from the team).
    const former = await call('/api/v1/admin/probe', people.formerAdmin.email);
    expect([former.status, codeOf(former)]).toEqual([403, 'FORBIDDEN']);
    // Staff sessions never work on the admin API.
    expect((await call('/api/v1/admin/probe', fx.users.ownerA.email)).status).toBe(401);
  });

  it('refuses to start with a Super Admin route outside /admin/', async () => {
    await expect(createApp([MisplacedSuperAdminRoute])).rejects.toThrow(
      /MisplacedSuperAdminRoute\.get \(\/reports\): SUPER_ADMIN outside \/admin\//,
    );
  });
});
