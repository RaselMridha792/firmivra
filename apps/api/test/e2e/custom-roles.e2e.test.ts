// End-to-end: R55, custom roles (Settings > Users & Roles; contract in
// packages/types/src/staff/roles.ts; R1's schema #995). Create saves the role and its whole grid
// together; Edit Permissions, rename and Archive; giving one through Edit Staff keeps the role it
// is based on; the guard reads its grid in place of the role's, and the member's own Allow still
// wins. Owner and Admin only; firm B reaches none of firm A's roles. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  CustomRole,
  CustomRoleDetail,
  FirmUserList,
  RoleList,
  StaffDetail,
  StaffFormOptions,
  StaffPermissions,
  UsersSummary,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55c-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  booksA: person('books-a'),
  books2A: person('books2-a'),
  deskA: person('desk-a'),
  ownerB: person('owner-b'),
  staffB: person('staff-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<keyof typeof people, string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.63.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'post' | 'patch' | 'put';
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
const { ownerA, adminA, staffA, booksA, books2A, deskA, ownerB } = people;

/** Gives a member a role through Edit Staff (with GET's version). */
async function give(id: string, account: object, who: Who = ownerA): Promise<Response> {
  const { version } = StaffDetail.parse(ok(await call('get', `/staff/${id}`, who)));
  return call('patch', `/staff/${id}`, who, { version, account });
}
const lastAudit = (action: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findFirstOrThrow({
      where: { businessId: firms.a, action },
      orderBy: { createdAt: 'desc' },
    }),
  );
const cell = (module: string, capability: string, granted: boolean) => ({
  module,
  capability,
  granted,
});

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55c ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55c-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role] of [
    ['a', 'ownerA', 'OWNER'],
    ['a', 'adminA', 'ADMIN'],
    ['a', 'staffA', 'STAFF'],
    ['a', 'booksA', 'BOOKKEEPER'],
    ['a', 'books2A', 'BOOKKEEPER'],
    ['a', 'deskA', 'CLIENT_SUPPORT'],
    ['b', 'ownerB', 'OWNER'],
    ['b', 'staffB', 'STAFF'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId: people[key].id, role, status: 'ACTIVE' },
          select: { id: true },
        }),
      )
    ).id;
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

const roles = {} as Record<'senior' | 'desk' | 'office', string>;

describe('Create Custom Role', () => {
  it('saves the role and its whole grid together, after the escalation is confirmed', async () => {
    const body = {
      name: ' Senior Bookkeeper ',
      description: 'Books plus the leads they bring in',
      basedOn: 'BOOKKEEPER',
      grants: [cell('LEADS', 'VIEW', true), cell('INVOICES_PAYMENTS', 'VIEW', false)],
    };
    // Leads is more than a Bookkeeper has: ask first, and nothing is saved meanwhile.
    expectError(await call('post', '/roles/custom', ownerA, body), 409, 'PERMISSION_ESCALATION');
    expect(await inFirm('a', (tx) => tx.customRole.count({ where: { businessId: firms.a } }))).toBe(
      0,
    );
    const made = CustomRole.parse(
      ok(
        await call('post', '/roles/custom', ownerA, { ...body, acknowledgeEscalation: true }),
        201,
      ),
    );
    roles.senior = made.id;
    expect(made).toMatchObject({
      name: 'Senior Bookkeeper',
      basedOn: 'BOOKKEEPER',
      memberCount: 0,
      archivedAt: null,
    });
    const detail = CustomRoleDetail.parse(
      ok(await call('get', `/roles/custom/${made.id}`, adminA)),
    );
    expect(detail.cells).toHaveLength(24 * 7);
    const has = (m: string, c: string) =>
      detail.cells.find((x) => x.module === m && x.capability === c)?.granted;
    // The template's grid (Clients view), Leads given, Invoices taken away.
    expect([
      has('CLIENTS', 'VIEW'),
      has('LEADS', 'VIEW'),
      has('INVOICES_PAYMENTS', 'VIEW'),
    ]).toEqual([true, true, false]);
    expect(detail.updatedBy).toBe('Fake R55c ownerA');
    // The template itself never changes.
    const template = ok(await call('get', '/roles/BOOKKEEPER/permissions', ownerA)) as {
      cells: { module: string; capability: string; granted: boolean }[];
    };
    expect(
      template.cells.find((x) => x.module === 'LEADS' && x.capability === 'VIEW')?.granted,
    ).toBe(false);
    const audit = await lastAudit('role.custom_created');
    expect([audit.entityType, audit.entityId]).toEqual(['custom_role', made.id]);
    expect(audit.metadata).toMatchObject({
      basedOn: 'BOOKKEEPER',
      changedCells: 2,
      escalated: true,
    });
  });

  it('refuses a taken name, View missing, the Owner as template, and anyone but Owner or Admin', async () => {
    const base = { basedOn: 'STAFF' };
    for (const name of ['senior bookkeeper', 'BOOKKEEPER', 'Admin'])
      expectError(
        await call('post', '/roles/custom', ownerA, { ...base, name }),
        409,
        'ROLE_NAME_TAKEN',
      );
    expectError(
      await call('post', '/roles/custom', ownerA, {
        ...base,
        name: 'No view',
        grants: [cell('TASKS', 'VIEW', false)],
      }),
      400,
      'PERMISSION_NEEDS_VIEW',
    );
    expectError(
      await call('post', '/roles/custom', ownerA, { name: 'Co-owner', basedOn: 'OWNER' }),
      400,
      'VALIDATION_FAILED',
    );
    const desk = { ...base, name: 'Front Desk' };
    expectError(await call('post', '/roles/custom', staffA, desk), 403, 'FORBIDDEN');
    expect((await call('post', '/roles/custom', undefined, desk)).status).toBe(401);
  });

  it('lets an Admin create one too, and lists the live roles with their people', async () => {
    roles.desk = CustomRole.parse(
      ok(
        await call('post', '/roles/custom', adminA, {
          name: 'Front Desk',
          basedOn: 'STAFF',
          grants: ['VIEW', 'CREATE', 'EDIT'].map((c) => cell('CLIENTS', c, false)),
        }),
        201,
      ),
    ).id;
    roles.office = CustomRole.parse(
      ok(
        await call('post', '/roles/custom', ownerA, { name: 'Office Admin', basedOn: 'ADMIN' }),
        201,
      ),
    ).id;
    const list = RoleList.parse(ok(await call('get', '/roles', ownerA)));
    expect(list.custom?.map((r) => r.name)).toEqual([
      'Front Desk',
      'Office Admin',
      'Senior Bookkeeper',
    ]);
  });
});

describe('Giving a custom role (Edit Staff)', () => {
  it('keeps the role it is based on, shows it everywhere, and is audited', async () => {
    const detail = StaffDetail.parse(ok(await give(member.booksA, { customRoleId: roles.senior })));
    expect([detail.role, detail.customRole?.name]).toEqual(['BOOKKEEPER', 'Senior Bookkeeper']);
    expect((await lastAudit('membership.role_changed')).metadata).toEqual({
      from: 'BOOKKEEPER',
      to: 'BOOKKEEPER',
      fromCustomRoleId: null,
      toCustomRoleId: roles.senior,
    });
    // Giving one moves the role with it.
    const desk = StaffDetail.parse(ok(await give(member.deskA, { customRoleId: roles.desk })));
    expect([desk.role, desk.customRole?.name]).toEqual(['STAFF', 'Front Desk']);
    const perms = StaffPermissions.parse(
      ok(await call('get', `/staff/${member.booksA}/permissions`, ownerA)),
    );
    expect(perms.customRole?.name).toBe('Senior Bookkeeper');
    expect(perms.cells.find((c) => c.module === 'LEADS' && c.capability === 'VIEW')).toMatchObject({
      granted: true,
      source: 'FIRM_ROLE',
    });
    const row = FirmUserList.parse(
      ok(await call('get', `/users?customRoleId=${roles.senior}`, ownerA)),
    );
    expect(row.items.map((u) => [u.id, u.customRole?.name])).toEqual([
      [member.booksA, 'Senior Bookkeeper'],
    ]);
    const found = FirmUserList.parse(ok(await call('get', '/users?search=front%20desk', ownerA)));
    expect(found.items.map((u) => u.id)).toEqual([member.deskA]);
    expect(UsersSummary.parse(ok(await call('get', '/users/summary', ownerA)))).toMatchObject({
      roles: 12,
      customRoles: 3,
    });
    const csv = await call('get', `/users/export?customRoleId=${roles.senior}`, ownerA);
    expect(csv.text).toContain('Senior Bookkeeper');
  });

  it('refuses a role that does not match, one the Admin may not give, and another firm', async () => {
    expectError(
      await give(member.books2A, { role: 'STAFF', customRoleId: roles.senior }),
      400,
      'CUSTOM_ROLE_MISMATCH',
    );
    // An Admin gives the roles below Admin only, custom ones included.
    const options = StaffFormOptions.parse(ok(await call('get', '/staff/options', adminA)));
    expect(options.customRoles?.map((r) => r.name)).toEqual(['Front Desk', 'Senior Bookkeeper']);
    expectError(
      await give(member.books2A, { customRoleId: roles.office }, adminA),
      403,
      'CANNOT_GRANT',
    );
    const b = await call('get', '/staff/options', ownerB, undefined, 'b');
    expect(StaffFormOptions.parse(ok(b)).customRoles).toEqual([]);
    const { version } = StaffDetail.parse(
      ok(await call('get', `/staff/${member.staffB}`, ownerB, undefined, 'b')),
    );
    const other = await call(
      'patch',
      `/staff/${member.staffB}`,
      ownerB,
      { version, account: { customRoleId: roles.desk } },
      'b',
    );
    expect(other.status).toBe(404);
  });
});

describe('The guard reads the custom grid', () => {
  it("gives and takes away by the custom role's grid; the member's own Allow still wins", async () => {
    // Senior Bookkeeper: Leads given (a plain Bookkeeper is refused), Invoices taken away.
    expect((await call('get', '/leads', booksA)).status).toBe(200);
    expect((await call('get', '/leads', books2A)).status).toBe(403);
    expect((await call('get', '/invoices', booksA)).status).toBe(403);
    expect((await call('get', '/invoices', books2A)).status).toBe(200);
    // Front Desk (Staff): Clients taken away, which plain Staff has by @Roles.
    expect((await call('get', '/clients', deskA)).status).toBe(403);
    expect((await call('get', '/clients', staffA)).status).toBe(200);
    // The member's own Allow wins over the custom grid.
    ok(
      await call('put', `/staff/${member.booksA}/permissions`, ownerA, {
        grants: [cell('INVOICES_PAYMENTS', 'VIEW', true)],
        acknowledgeEscalation: true,
      }),
    );
    expect((await call('get', '/invoices', booksA)).status).toBe(200);
    // Inherit goes back to the custom role's grid, not the Bookkeeper's.
    ok(
      await call('patch', `/staff/${member.booksA}/permissions`, ownerA, {
        overrides: [{ module: 'INVOICES_PAYMENTS', capability: 'VIEW', mode: 'INHERIT' }],
      }),
    );
    expect((await call('get', '/invoices', booksA)).status).toBe(403);
  });

  it('applies Edit Permissions on the next request', async () => {
    const saved = CustomRoleDetail.parse(
      ok(
        await call('patch', `/roles/custom/${roles.desk}`, ownerA, {
          name: 'Front desk',
          grants: [cell('CLIENTS', 'VIEW', true)],
        }),
      ),
    );
    expect(saved.role.name).toBe('Front desk');
    expect((await call('get', '/clients', deskA)).status).toBe(200);
    expect((await lastAudit('role.custom_updated')).metadata).toMatchObject({
      renamed: true,
      changedCells: 1,
      escalated: false,
    });
    expectError(
      await call('patch', `/roles/custom/${roles.desk}`, ownerA, {
        grants: [cell('PAYROLL', 'VIEW', true)],
      }),
      409,
      'PERMISSION_ESCALATION',
    );
    expectError(
      await call('patch', `/roles/custom/${roles.desk}`, ownerA, { name: 'Senior Bookkeeper' }),
      409,
      'ROLE_NAME_TAKEN',
    );
  });
});

describe('Archive', () => {
  it('is refused while someone has the role, then stops it being given', async () => {
    expectError(
      await call('post', `/roles/custom/${roles.desk}/archive`, ownerA),
      409,
      'CUSTOM_ROLE_IN_USE',
    );
    // A new built-in role alone takes the custom role away.
    const moved = StaffDetail.parse(ok(await give(member.deskA, { role: 'MANAGER' })));
    expect([moved.role, moved.customRole]).toEqual(['MANAGER', null]);
    const archived = CustomRole.parse(
      ok(await call('post', `/roles/custom/${roles.desk}/archive`, ownerA)),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect((await lastAudit('role.custom_archived')).entityId).toBe(roles.desk);
    expectError(
      await give(member.deskA, { customRoleId: roles.desk }),
      409,
      'CUSTOM_ROLE_ARCHIVED',
    );
    expectError(
      await call('patch', `/roles/custom/${roles.desk}`, ownerA, { name: 'Again' }),
      409,
      'CUSTOM_ROLE_ARCHIVED',
    );
    const list = RoleList.parse(ok(await call('get', '/roles', ownerA)));
    expect(list.custom?.map((r) => r.name)).toEqual(['Office Admin', 'Senior Bookkeeper']);
    // Its name is free again.
    ok(await call('post', '/roles/custom', ownerA, { name: 'Front desk', basedOn: 'STAFF' }), 201);
  });
});

describe('Another firm', () => {
  it("never reads, changes or archives firm A's roles", async () => {
    for (const [method, path, body] of [
      ['get', `/roles/custom/${roles.senior}`, undefined],
      ['patch', `/roles/custom/${roles.senior}`, { name: 'Taken over' }],
      ['post', `/roles/custom/${roles.senior}/archive`, undefined],
    ] as const)
      expect((await call(method, path, ownerB, body, 'b')).status).toBe(404);
    const b = RoleList.parse(ok(await call('get', '/roles', ownerB, undefined, 'b')));
    expect(b.custom).toEqual([]);
    expect((await call('get', '/roles/custom/nope', ownerA)).status).toBe(400);
  });
});
