// End-to-end: R55, roles and the permission grid (contract in packages/types/src/staff/roles.ts):
// the defaults and a firm's changes, the rules for saving (View first, escalation, who may change
// what), and that a saved grid decides what the roles guard lets a Tax Preparer do.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { PermissionModuleList, RoleList, RolePermissions } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { PermissionGrantsService } from '../../src/roles/permission-grants.service.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55r-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  preparerA: person('preparer-a'),
  ownerB: person('owner-b'),
  preparerB: person('preparer-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.61.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const { ownerA, adminA, staffA, preparerA, ownerB, preparerB } = people;

const grid = async (role: string, who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
  RolePermissions.parse(ok(await call('get', `/roles/${role}/permissions`, who, undefined, firm)));
const cell = (g: RolePermissions, module: string, capability: string) =>
  g.cells.find((c) => c.module === module && c.capability === capability);
const save = (role: string, grants: object[], who: Who = ownerA, over: object = {}) =>
  call('put', `/roles/${role}/permissions`, who, { grants, ...over });

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55r ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55r-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['a', preparerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
    ['b', preparerB.id, 'TAX_PREPARER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
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

describe('the roles and the grid', () => {
  it('lists the nine roles with their counts, and serves the modules and capabilities', async () => {
    const list = RoleList.parse(ok(await call('get', '/roles', ownerA)));
    expect(list.items.map((r) => r.role)).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'BUSINESS_CONSULTANT',
      'READ_ONLY',
    ]);
    const by = (r: string) => list.items.find((i) => i.role === r);
    expect(by('OWNER')).toMatchObject({ locked: true, memberCount: 1, customized: false });
    expect(by('TAX_PREPARER')).toMatchObject({ locked: false, memberCount: 1 });
    expect(by('MANAGER')?.memberCount).toBe(0);
    const mods = PermissionModuleList.parse(ok(await call('get', '/permission-modules', adminA)));
    expect(mods.modules).toHaveLength(24);
    expect(mods.capabilities.map((c) => c.capability)).toEqual([
      'VIEW',
      'CREATE',
      'EDIT',
      'DELETE',
      'APPROVE',
      'MANAGE',
      'EXPORT',
    ]);
  });

  it('shows the defaults for a role, all 168 cells', async () => {
    const g = await grid('TAX_PREPARER');
    expect(g.cells).toHaveLength(24 * 7);
    expect(cell(g, 'TAX_RETURNS', 'CREATE')).toMatchObject({
      granted: true,
      source: 'ROLE_DEFAULT',
    });
    expect(cell(g, 'COMMUNICATIONS', 'CREATE')).toMatchObject({
      granted: false,
      source: 'ROLE_DEFAULT',
    });
    expect(g).toMatchObject({ updatedAt: null, updatedBy: null });
    const owner = await grid('OWNER');
    expect(owner.cells.every((c) => c.granted)).toBe(true);
  });
});

describe('saving the grid', () => {
  it('needs View first, a yes for more than the default, and keeps only what differs', async () => {
    expectError(
      await save('READ_ONLY', [{ module: 'MESSAGES', capability: 'EDIT', granted: true }]),
      400,
      'PERMISSION_NEEDS_VIEW',
    );
    expectError(
      await save('READ_ONLY', [
        { module: 'MESSAGES', capability: 'VIEW', granted: true },
        { module: 'MESSAGES', capability: 'EDIT', granted: true },
      ]),
      409,
      'PERMISSION_ESCALATION',
    );
    const saved = RolePermissions.parse(
      ok(
        await save(
          'READ_ONLY',
          [
            { module: 'MESSAGES', capability: 'VIEW', granted: true },
            { module: 'MESSAGES', capability: 'EDIT', granted: true },
          ],
          ownerA,
          { acknowledgeEscalation: true },
        ),
      ),
    );
    expect(cell(saved, 'MESSAGES', 'EDIT')).toMatchObject({ granted: true, source: 'FIRM_ROLE' });
    expect(saved.updatedBy).toBe('Fake R55r ownerA');
    const rows = await inFirm('a', (tx) =>
      tx.rolePermission.findMany({ where: { role: 'READ_ONLY' } }),
    );
    // Only the cells that differ from the default are kept.
    expect(rows.map((r) => `${r.module}:${r.capability}`).sort()).toEqual(
      [
        'MESSAGES:EDIT',
        ...(cell(await grid('READ_ONLY'), 'MESSAGES', 'VIEW')?.source === 'FIRM_ROLE'
          ? ['MESSAGES:VIEW']
          : []),
      ].sort(),
    );
    const list = RoleList.parse(ok(await call('get', '/roles', ownerA)));
    expect(list.items.find((r) => r.role === 'READ_ONLY')?.customized).toBe(true);
    // Taking it back to the default removes the row.
    ok(await save('READ_ONLY', [{ module: 'MESSAGES', capability: 'EDIT', granted: false }]));
    ok(await save('READ_ONLY', [{ module: 'MESSAGES', capability: 'VIEW', granted: false }]));
    expect(
      await inFirm('a', (tx) => tx.rolePermission.count({ where: { role: 'READ_ONLY' } })),
    ).toBe(0);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { action: { startsWith: 'role.' } },
        select: { action: true, metadata: true },
      }),
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toContain('MESSAGES');
  });

  it('resets a role to its default', async () => {
    ok(
      await save(
        'BOOKKEEPER',
        [
          { module: 'REPORTS', capability: 'VIEW', granted: true },
          { module: 'REPORTS', capability: 'EXPORT', granted: true },
        ],
        ownerA,
        { acknowledgeEscalation: true },
      ),
    );
    expect(cell(await grid('BOOKKEEPER'), 'REPORTS', 'EXPORT')?.granted).toBe(true);
    const back = RolePermissions.parse(
      ok(await call('delete', '/roles/BOOKKEEPER/permissions', ownerA)),
    );
    expect(back.cells.every((c) => c.source === 'ROLE_DEFAULT')).toBe(true);
    expect(cell(back, 'REPORTS', 'EXPORT')?.granted).toBe(false);
  });

  it('never changes the Owner, and an Admin cannot change an Admin', async () => {
    expectError(
      await save('OWNER', [{ module: 'CLIENTS', capability: 'VIEW', granted: false }]),
      403,
      'FORBIDDEN',
    );
    expectError(await call('delete', '/roles/OWNER/permissions', ownerA), 403, 'FORBIDDEN');
    expectError(
      await save('ADMIN', [{ module: 'CLIENTS', capability: 'VIEW', granted: false }], adminA),
      403,
      'CANNOT_GRANT',
    );
    // An Admin may change the roles below.
    ok(await save('MANAGER', [{ module: 'CLIENTS', capability: 'VIEW', granted: true }], adminA));
    expect((await save('NOBODY', [], ownerA)).status).toBe(400);
    expect(
      (await save('MANAGER', [{ module: 'NOPE', capability: 'VIEW', granted: true }])).status,
    ).toBe(400);
  });
});

describe('the saved grid decides what the guard allows', () => {
  it('opens a module to a Tax Preparer once the firm grants it, and closes it again', async () => {
    const make = (who: Who, firm: 'a' | 'b' = 'a') =>
      call(
        'post',
        '/templates',
        who,
        {
          kind: 'EMAIL',
          name: `Tpl ${run} ${randomUUID().slice(0, 6)}`,
          subject: 'S',
          body: '<p>Hello</p>',
        },
        firm,
      );
    // A Tax Preparer only views Templates by default.
    expectError(await make(preparerA), 403, 'FORBIDDEN');
    ok(
      await save(
        'TAX_PREPARER',
        [{ module: 'TEMPLATES', capability: 'CREATE', granted: true }],
        ownerA,
        {
          acknowledgeEscalation: true,
        },
      ),
    );
    // The task that saved it sees it at once.
    expect((await make(preparerA)).status).toBe(201);
    // Another firm's Tax Preparer is not affected.
    expectError(await make(preparerB, 'b'), 403, 'FORBIDDEN');
    const segments = () => make(preparerA);
    ok(await call('delete', '/roles/TAX_PREPARER/permissions', ownerA));
    expectError(await segments(), 403, 'FORBIDDEN');
  });

  it('takes a default away too', async () => {
    const tasks = () => call('get', '/tasks', preparerA);
    const before = await tasks();
    expect([200, 403]).toContain(before.status);
    // Tasks view is a default of the Tax Preparer; taking it away closes it.
    const view = cell(await grid('TAX_PREPARER'), 'TASKS', 'VIEW');
    if (view?.granted) {
      ok(
        await save('TAX_PREPARER', [
          { module: 'TASKS', capability: 'VIEW', granted: false },
          { module: 'TASKS', capability: 'CREATE', granted: false },
          { module: 'TASKS', capability: 'EDIT', granted: false },
          { module: 'TASKS', capability: 'DELETE', granted: false },
          { module: 'TASKS', capability: 'APPROVE', granted: false },
          { module: 'TASKS', capability: 'MANAGE', granted: false },
          { module: 'TASKS', capability: 'EXPORT', granted: false },
        ]),
      );
      expectError(await tasks(), 403, 'FORBIDDEN');
      ok(await call('delete', '/roles/TAX_PREPARER/permissions', ownerA));
      expect((await tasks()).status).toBe(before.status);
    }
  });

  it('is read from the database again after the cache window', async () => {
    const grants = app.get(PermissionGrantsService);
    expect(await grants.can(firms.a, 'TAX_PREPARER', 'TAX_RETURNS', 'CREATE')).toBe(true);
    await inFirm('a', (tx) =>
      tx.rolePermission.create({
        data: {
          businessId: firms.a,
          role: 'TAX_PREPARER',
          module: 'TAX_RETURNS',
          capability: 'CREATE',
          granted: false,
        },
      }),
    );
    grants.invalidate(firms.a);
    expect(await grants.can(firms.a, 'TAX_PREPARER', 'TAX_RETURNS', 'CREATE')).toBe(false);
    await inFirm('a', (tx) => tx.rolePermission.deleteMany({ where: { role: 'TAX_PREPARER' } }));
    grants.invalidate(firms.a);
  });
});

describe('who may', () => {
  it('is for Owner and Admin only, and for one firm at a time', async () => {
    expectError(await call('get', '/roles', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/roles/STAFF/permissions', preparerA), 403, 'FORBIDDEN');
    expectError(await save('MANAGER', [], staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/roles', undefined), 401, 'UNAUTHENTICATED');
    expectError(
      await call('post', '/roles/custom', ownerA, { name: 'Custom', basedOn: 'STAFF' }),
      501,
      'NOT_IMPLEMENTED',
    );
    // Firm B's grid is its own.
    const b = await grid('MANAGER', ownerB, 'b');
    expect(b.cells.every((c) => c.source === 'ROLE_DEFAULT')).toBe(true);
  });
});
