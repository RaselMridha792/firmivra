// End-to-end: the eight firm roles (R35). One representative route per module, for each role: the
// guard lets a role in where its grid allows it, and refuses it everywhere else. Owner, Admin and
// Staff keep the access their routes list. The expected table is written out by hand so a change
// to the grid or to a route's access shows up here. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FIRM_ROLES, type MembershipRole } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const people = Object.fromEntries(
  FIRM_ROLES.map((role) => [
    role,
    { id: randomUUID(), email: `r35-${role.toLowerCase()}-${run}@r35.test` },
  ]),
) as Record<MembershipRole, { id: string; email: string }>;
const lockedMember = { id: randomUUID(), email: `r35-locked-${run}@r35.test` };
const stranger = { id: randomUUID(), email: `r35-other-${run}@r35.test` };
const firm = { id: '', slug: '' };
const anyId = randomUUID();

let app: INestApplication;
let appOrigin = '';
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

const call = async (
  role: { id: string },
  method: 'get' | 'post' | 'patch',
  path: string,
  body: object = {},
) => {
  const { token } = await app.get(TokenService).signLocal(role.id, 'STAFF');
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('x-business-id', firm.id)
    .set('authorization', `Bearer ${token}`);
  return method === 'get' ? req : req.set('origin', appOrigin).send(body);
};

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const p of [...Object.values(people), lockedMember, stranger]) {
      await tx.user.create({
        data: { ...p, cognitoSub: p.id, pool: 'STAFF', name: 'Fake R35 person' },
      });
    }
    const slug = `r35-${run}`;
    Object.assign(
      firm,
      await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
  });
  await runInScope(db, { kind: 'business', businessId: firm.id }, async (tx) => {
    for (const role of FIRM_ROLES) {
      await tx.membership.create({
        data: { businessId: firm.id, userId: people[role].id, role, status: 'ACTIVE' },
      });
    }
    await tx.membership.create({
      data: { businessId: firm.id, userId: lockedMember.id, role: 'MANAGER', status: 'LOCKED' },
    });
    await tx.client.create({
      data: {
        businessId: firm.id,
        displayName: 'Assigned (fake)',
        assignedUserId: people.TAX_PREPARER.id,
      },
    });
    await tx.client.create({ data: { businessId: firm.id, displayName: 'Unassigned (fake)' } });
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  appOrigin = new URL(env.APP_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const ALL = [...FIRM_ROLES];
const LEGACY = ['OWNER', 'ADMIN', 'STAFF'] as const;
const OWNER_ADMIN = ['OWNER', 'ADMIN'] as const;
const only = (...roles: MembershipRole[]) => roles;

/** Per route: the roles the guard lets in. Everyone else gets 403. */
const ROUTES: {
  module: string;
  method: 'get' | 'post' | 'patch';
  path: string;
  allowed: MembershipRole[];
}[] = [
  { module: 'Dashboard', method: 'get', path: '/business/dashboard/summary', allowed: ALL },
  { module: 'Dashboard (firm shell)', method: 'get', path: '/business', allowed: ALL },
  { module: 'Clients (view)', method: 'get', path: '/business/clients', allowed: ALL },
  {
    module: 'Clients (create)',
    method: 'post',
    path: '/business/clients',
    allowed: only(...LEGACY, 'MANAGER', 'TAX_PREPARER', 'CLIENT_SUPPORT'),
  },
  {
    module: 'Leads',
    method: 'get',
    path: '/business/leads',
    allowed: only(...LEGACY, 'MANAGER', 'TAX_PREPARER', 'CLIENT_SUPPORT'),
  },
  {
    module: 'Appointments',
    method: 'get',
    path: '/business/appointments',
    allowed: only(...LEGACY, 'MANAGER', 'TAX_PREPARER', 'CLIENT_SUPPORT', 'READ_ONLY'),
  },
  {
    module: 'Intake Forms',
    method: 'get',
    path: `/business/intakes/${anyId}`,
    allowed: only(...LEGACY, 'MANAGER', 'TAX_PREPARER', 'CLIENT_SUPPORT'),
  },
  {
    module: 'Documents',
    method: 'get',
    path: '/business/document-categories',
    allowed: only(...LEGACY, 'MANAGER', 'BOOKKEEPER', 'TAX_PREPARER', 'CLIENT_SUPPORT'),
  },
  { module: 'Tasks (view)', method: 'get', path: '/business/tasks', allowed: ALL },
  {
    module: 'Tasks (edit)',
    method: 'patch',
    path: `/business/tasks/${anyId}`,
    allowed: only(...LEGACY, 'MANAGER', 'BOOKKEEPER'),
  },
  {
    module: 'Tax Returns',
    method: 'get',
    path: `/business/clients/${anyId}/tax-returns`,
    allowed: only(...LEGACY, 'MANAGER', 'TAX_PREPARER'),
  },
  {
    module: 'Messages',
    method: 'get',
    path: '/business/message-threads',
    allowed: only(...LEGACY, 'MANAGER', 'BOOKKEEPER', 'TAX_PREPARER', 'CLIENT_SUPPORT'),
  },
  {
    module: 'Invoices & Payments',
    method: 'get',
    path: '/business/invoices',
    allowed: only(...LEGACY, 'MANAGER', 'BOOKKEEPER', 'TAX_PREPARER'),
  },
  // Not opened to the five newer roles (no @Access): Firm Sign, and anything Owner and Admin keep.
  { module: 'Firm Sign', method: 'get', path: '/esign/requests', allowed: only(...LEGACY) },
  {
    module: 'Staff Management',
    method: 'get',
    path: '/business/team',
    allowed: only(...OWNER_ADMIN),
  },
  { module: 'Settings', method: 'get', path: '/business/settings', allowed: only(...OWNER_ADMIN) },
  {
    module: 'Audit log',
    method: 'get',
    path: '/business/audit-log',
    allowed: only(...OWNER_ADMIN),
  },
];

describe('the eight firm roles on one route per module', () => {
  for (const route of ROUTES) {
    describe(`${route.module}: ${route.method.toUpperCase()} ${route.path}`, () => {
      for (const role of FIRM_ROLES) {
        const allowed = route.allowed.includes(role);
        it(`${role} is ${allowed ? 'let in' : 'refused (403)'}`, async () => {
          const res = await call(people[role], route.method, route.path);
          const refused = res.status === 403 && res.body?.error?.code === 'FORBIDDEN';
          expect(refused, JSON.stringify(res.body)).toBe(!allowed);
        });
      }
    });
  }
});

describe('scope and status', () => {
  it('scopes the newer roles to their assigned clients, like Staff; Admin sees all', async () => {
    const names = async (role: MembershipRole) => {
      const res = await call(people[role], 'get', '/business/clients');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as { items: { displayName: string }[] }).items.map((c) => c.displayName);
    };
    expect(await names('TAX_PREPARER')).toEqual(['Assigned (fake)']);
    expect(await names('MANAGER')).toEqual([]);
    expect((await names('ADMIN')).sort()).toEqual(['Assigned (fake)', 'Unassigned (fake)']);
  });

  it('refuses a locked member like a stranger (404), and a stranger too', async () => {
    expect((await call(lockedMember, 'get', '/business/clients')).status).toBe(404);
    expect((await call(stranger, 'get', '/business/clients')).status).toBe(404);
  });

  it("keeps an invite of a new role out of the newer roles' hands", async () => {
    const invite = { email: `x-${run}@r35.test`, name: 'Fake Invitee', role: 'BOOKKEEPER' };
    for (const role of ['TAX_PREPARER', 'MANAGER'] as const) {
      const res = await call(people[role], 'post', '/auth/invites', invite);
      expect([res.status, res.body.error?.code]).toEqual([403, 'FORBIDDEN']);
    }
  });
});
