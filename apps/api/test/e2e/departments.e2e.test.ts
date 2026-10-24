// End-to-end: R55, Teams & Departments and the org chart (contract in
// packages/types/src/staff/departments.ts). Owner and Admin change; others with the Staff
// Management view read; firm B sees none of firm A's. Nothing is deleted; no audit row holds a
// name or a description.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  Department,
  DepartmentDetail,
  DepartmentListResponse,
  DepartmentMembers,
  DepartmentSummary,
  OrgChart,
  StaffTeam,
  StaffTeamDetail,
  StaffTeamList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55d-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  managerA: person('manager-a'),
  staffA: person('staff-a'),
  invitedA: person('invited-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<keyof typeof people, string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.60.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const { ownerA, adminA, managerA, staffA, ownerB } = people;

const dept = async (over: object = {}, who: Who = ownerA) =>
  Department.parse(
    ok(await call('post', '/departments', who, { name: mark('Dept'), ...over }), 201),
  );
const team = async (departmentId: string, over: object = {}, who: Who = ownerA) =>
  StaffTeam.parse(
    ok(await call('post', '/teams', who, { departmentId, name: mark('Team'), ...over }), 201),
  );
const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55d ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55d-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role, status] of [
    ['a', 'ownerA', 'OWNER', 'ACTIVE'],
    ['a', 'adminA', 'ADMIN', 'ACTIVE'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE'],
    ['a', 'staffA', 'STAFF', 'ACTIVE'],
    ['a', 'invitedA', 'STAFF', 'INVITED'],
    ['b', 'ownerB', 'OWNER', 'ACTIVE'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: {
            businessId: firms[firm],
            userId: people[key].id,
            role,
            status,
            jobTitle: `Title ${key}`,
          },
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

describe('departments', () => {
  it('creates, reads and lists with a head, counts and filters', async () => {
    const d = await dept({ description: 'Does the books', headMembershipId: member.managerA });
    expect(d).toMatchObject({ status: 'ACTIVE', teamCount: 0, staffCount: 0 });
    expect(d.head).toMatchObject({
      id: member.managerA,
      userId: managerA.id,
      jobTitle: 'Title managerA',
    });
    const found = DepartmentListResponse.parse(
      ok(await call('get', `/departments?search=${encodeURIComponent(d.name)}`, ownerA)),
    );
    expect(found.items.map((i) => i.id)).toEqual([d.id]);
    expect(
      DepartmentListResponse.parse(
        ok(
          await call(
            'get',
            `/departments?status=archived&search=${encodeURIComponent(d.name)}`,
            ownerA,
          ),
        ),
      ).items,
    ).toHaveLength(0);
    const detail = DepartmentDetail.parse(ok(await call('get', `/departments/${d.id}`, ownerA)));
    expect(detail.teams).toEqual([]);
    const sum = DepartmentSummary.parse(ok(await call('get', '/departments/summary', ownerA)));
    expect(sum.departments).toBeGreaterThanOrEqual(1);
    expect(sum.activeStaff).toBe(4);
    expect(sum.staff).toBe(5);
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toEqual(['department.created']);
    expect(JSON.stringify(rows)).not.toMatch(/books|Dept/);
  });

  it('refuses a duplicate name across departments and teams, and a head who is not active', async () => {
    const d = await dept();
    expectError(
      await call('post', '/departments', ownerA, { name: d.name.toUpperCase() }),
      409,
      'DUPLICATE_NAME',
    );
    const t = await team(d.id);
    expectError(
      await call('post', '/departments', ownerA, { name: t.name }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/departments', ownerA, {
        name: mark('X'),
        headMembershipId: member.invitedA,
      }),
      409,
      'MEMBER_NOT_ACTIVE',
    );
    expect(
      (
        await call('post', '/departments', ownerA, {
          name: mark('Y'),
          headMembershipId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect((await call('post', '/departments', ownerA, { name: '' })).status).toBe(400);
    expect((await call('post', '/departments', ownerA, { name: mark('Z'), extra: 1 })).status).toBe(
      400,
    );
    // Archiving frees the name.
    ok(await call('patch', `/teams/${t.id}`, ownerA, { status: 'ARCHIVED' }));
    ok(await call('post', '/departments', ownerA, { name: t.name }), 201);
  });

  it('edits, changes the head, and keeps people when it is deactivated with a place to move them', async () => {
    const a = await dept();
    const b = await dept();
    const t = await team(a.id);
    await inFirm('a', (tx) =>
      tx.memberDepartment.create({
        data: { businessId: firms.a, membershipId: member.staffA, departmentId: a.id },
      }),
    );
    const edited = Department.parse(
      ok(
        await call('patch', `/departments/${a.id}`, ownerA, {
          description: 'New',
          headMembershipId: member.adminA,
        }),
      ),
    );
    expect(edited).toMatchObject({ description: 'New', staffCount: 1, teamCount: 1 });
    expect(edited.head?.id).toBe(member.adminA);
    expect(
      Department.parse(
        ok(await call('patch', `/departments/${a.id}`, ownerA, { headMembershipId: null })),
      ).head,
    ).toBeNull();
    // People and teams are in it: it cannot just go.
    expectError(
      await call('patch', `/departments/${a.id}`, ownerA, { status: 'INACTIVE' }),
      409,
      'GROUP_IN_USE',
    );
    expect(
      (await call('patch', `/departments/${a.id}`, ownerA, { status: 'INACTIVE', moveTo: a.id }))
        .status,
    ).toBe(400);
    const gone = Department.parse(
      ok(await call('patch', `/departments/${a.id}`, ownerA, { status: 'INACTIVE', moveTo: b.id })),
    );
    expect(gone).toMatchObject({ status: 'INACTIVE', staffCount: 0, teamCount: 0 });
    const target = DepartmentDetail.parse(ok(await call('get', `/departments/${b.id}`, ownerA)));
    expect(target).toMatchObject({ staffCount: 1 });
    expect(target.teams.map((x) => x.id)).toEqual([t.id]);
    // Reactivating is fine; nothing is ever deleted.
    expect(
      Department.parse(
        ok(await call('patch', `/departments/${a.id}`, ownerA, { status: 'ACTIVE' })),
      ).status,
    ).toBe('ACTIVE');
    expect((await call('patch', `/departments/${a.id}`, ownerA, {})).status).toBe(400);
    expect((await call('delete', `/departments/${a.id}`, ownerA)).status).toBe(404);
    const rows = await auditRows(a.id);
    expect(rows.every((r) => r.action.startsWith('department.'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('New');
  });
});

describe('teams', () => {
  it('creates a team in an active department and lists it', async () => {
    const d = await dept();
    const t = await team(d.id, { description: 'Evening shift', leadMembershipId: member.staffA });
    expect(t).toMatchObject({
      status: 'ACTIVE',
      memberCount: 0,
      department: { id: d.id, name: d.name },
    });
    expect(t.lead?.id).toBe(member.staffA);
    const list = StaffTeamList.parse(ok(await call('get', `/teams?departmentId=${d.id}`, ownerA)));
    expect(list.items.map((i) => i.id)).toEqual([t.id]);
    expect(
      StaffTeamList.parse(
        ok(
          await call('get', `/teams?search=${encodeURIComponent(t.name)}&status=inactive`, ownerA),
        ),
      ).items,
    ).toHaveLength(0);
    const idle = await dept();
    ok(await call('patch', `/departments/${idle.id}`, ownerA, { status: 'INACTIVE' }));
    expect(
      (await call('post', '/teams', ownerA, { departmentId: idle.id, name: mark('In inactive') }))
        .status,
    ).toBe(400);
    expectError(
      await call('post', '/teams', ownerA, { departmentId: randomUUID(), name: mark('T') }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/teams', ownerA, {
        departmentId: (await dept()).id,
        name: mark('T'),
        leadMembershipId: member.invitedA,
      }),
      409,
      'MEMBER_NOT_ACTIVE',
    );
  });

  it('sets members as a whole list, with one primary and one backup team each', async () => {
    const d = await dept();
    const t1 = await team(d.id);
    const t2 = await team(d.id);
    const set = StaffTeamDetail.parse(
      ok(
        await call('put', `/teams/${t1.id}/members`, ownerA, {
          members: [
            { membershipId: member.staffA, kind: 'PRIMARY' },
            { membershipId: member.managerA, kind: 'MEMBER' },
          ],
        }),
      ),
    );
    expect(set.memberCount).toBe(2);
    expect(set.members.map((m) => [m.id, m.kind]).sort()).toEqual(
      [
        [member.staffA, 'PRIMARY'],
        [member.managerA, 'MEMBER'],
      ].sort(),
    );
    // Pat is already the primary of another team.
    expect(
      (
        await call('put', `/teams/${t2.id}/members`, ownerA, {
          members: [{ membershipId: member.staffA, kind: 'PRIMARY' }],
        })
      ).status,
    ).toBe(400);
    ok(
      await call('put', `/teams/${t2.id}/members`, ownerA, {
        members: [{ membershipId: member.staffA, kind: 'BACKUP' }],
      }),
    );
    expectError(
      await call('put', `/teams/${t2.id}/members`, ownerA, {
        members: [{ membershipId: member.invitedA, kind: 'MEMBER' }],
      }),
      409,
      'MEMBER_NOT_ACTIVE',
    );
    expect(
      (
        await call('put', `/teams/${t2.id}/members`, ownerA, {
          members: [
            { membershipId: member.staffA, kind: 'MEMBER' },
            { membershipId: member.staffA, kind: 'BACKUP' },
          ],
        })
      ).status,
    ).toBe(400);
    // The whole list is replaced.
    expect(
      StaffTeamDetail.parse(
        ok(await call('put', `/teams/${t1.id}/members`, ownerA, { members: [] })),
      ).members,
    ).toHaveLength(0);
    // A team with active people cannot be deactivated.
    ok(
      await call('put', `/teams/${t1.id}/members`, ownerA, {
        members: [{ membershipId: member.managerA, kind: 'MEMBER' }],
      }),
    );
    expectError(
      await call('patch', `/teams/${t1.id}`, ownerA, { status: 'INACTIVE' }),
      409,
      'GROUP_IN_USE',
    );
    ok(await call('put', `/teams/${t1.id}/members`, ownerA, { members: [] }));
    expect(
      StaffTeam.parse(ok(await call('patch', `/teams/${t1.id}`, ownerA, { status: 'INACTIVE' })))
        .status,
    ).toBe('INACTIVE');
    expect(
      (
        await call('put', `/teams/${t1.id}/members`, ownerA, {
          members: [{ membershipId: member.managerA, kind: 'MEMBER' }],
        })
      ).status,
    ).toBe(400);
    const rows = await auditRows(t1.id);
    expect(rows.map((r) => r.action)).toContain('team.members_set');
  });

  it('moves a team to another active department and renames it', async () => {
    const a = await dept();
    const b = await dept();
    const t = await team(a.id);
    const moved = StaffTeam.parse(
      ok(
        await call('patch', `/teams/${t.id}`, ownerA, {
          departmentId: b.id,
          name: mark('Renamed'),
        }),
      ),
    );
    expect(moved.department.id).toBe(b.id);
    expectError(
      await call('patch', `/teams/${t.id}`, ownerA, { name: a.name }),
      409,
      'DUPLICATE_NAME',
    );
    expect(StaffTeamDetail.parse(ok(await call('get', `/teams/${t.id}`, ownerA))).id).toBe(t.id);
  });
});

describe('the org chart', () => {
  it('draws the active people with their lines up, departments and headed departments', async () => {
    const d = await dept({ headMembershipId: member.managerA });
    await inFirm('a', async (tx) => {
      await tx.staffProfile.create({
        data: { businessId: firms.a, membershipId: member.staffA, supervisorId: member.managerA },
      });
      await tx.memberDepartment.create({
        data: { businessId: firms.a, membershipId: member.staffA, departmentId: d.id },
      });
    });
    const chart = OrgChart.parse(ok(await call('get', '/org-chart', ownerA)));
    const by = (id: string) => chart.nodes.find((n) => n.id === id);
    expect(chart.nodes.map((n) => n.id)).not.toContain(member.invitedA);
    expect(by(member.staffA)).toMatchObject({ supervisorId: member.managerA });
    expect(by(member.staffA)?.departments.map((x) => x.id)).toContain(d.id);
    expect(by(member.managerA)?.heads.map((x) => x.id)).toContain(d.id);
    expect(by(member.ownerA)?.supervisorId).toBeNull();
    expect(JSON.stringify(chart)).not.toContain('@');
  });
});

describe('who may', () => {
  it('lets Owner and Admin change, and Staff and signed-out people nothing', async () => {
    const d = await dept({}, adminA);
    expectError(await call('post', '/departments', staffA, { name: mark('S') }), 403, 'FORBIDDEN');
    expectError(
      await call('patch', `/departments/${d.id}`, staffA, { description: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/teams', staffA, { departmentId: d.id, name: mark('S') }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('put', `/teams/${randomUUID()}/members`, staffA, { members: [] }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/departments', managerA, { name: mark('M') }),
      403,
      'FORBIDDEN',
    );
    // Staff reads nothing here unless the firm's grid gives the role Staff Management view.
    expectError(await call('get', '/departments', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/org-chart', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/departments', undefined), 401, 'UNAUTHENTICATED');
  });

  it('shows firm B nothing of firm A', async () => {
    const d = await dept();
    const t = await team(d.id);
    expectError(
      await call('get', `/departments/${d.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('patch', `/departments/${d.id}`, ownerB, { description: 'x' }, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/teams/${t.id}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expectError(
      await call('put', `/teams/${t.id}/members`, ownerB, { members: [] }, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(
      DepartmentListResponse.parse(ok(await call('get', '/departments', ownerB, undefined, 'b')))
        .items,
    ).toHaveLength(0);
    expect(
      OrgChart.parse(ok(await call('get', '/org-chart', ownerB, undefined, 'b'))).nodes.map(
        (n) => n.id,
      ),
    ).toEqual([expect.any(String)]);
    // A person of another firm cannot be a head or a member.
    expectError(
      await call('post', '/departments', ownerA, {
        name: mark('Cross'),
        headMembershipId: randomUUID(),
      }),
      409,
      'MEMBER_NOT_ACTIVE',
    );
    expectError(await call('get', `/departments/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
    expectError(await call('get', '/departments/nope', ownerA), 400, 'VALIDATION_FAILED');
  });
});

describe("department members (Octavia's SM13)", () => {
  const members = (id: string, who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
    call('get', `/departments/${id}/members`, who, undefined, firm);
  const setMembers = (id: string, membershipIds: string[], who: Who = ownerA) =>
    call('put', `/departments/${id}/members`, who, { membershipIds });
  const names = (res: Response) => DepartmentMembers.parse(ok(res)).members.map((m) => m.id);

  it('adds and removes staff with no team; the count and the staff filter follow', async () => {
    const d1 = await dept();
    const d2 = await dept();
    // staffA belongs to d2 too, so taking them out of d1 later is allowed.
    expect(names(await setMembers(d2.id, [member.staffA]))).toEqual([member.staffA]);
    const both = names(await setMembers(d1.id, [member.staffA, member.invitedA]));
    expect(new Set(both)).toEqual(new Set([member.staffA, member.invitedA]));
    expect(new Set(names(await members(d1.id, adminA)))).toEqual(
      new Set([member.staffA, member.invitedA]),
    );
    // The count is active staff (the invitee waits); the directory filter is direct assignment.
    expect(
      DepartmentDetail.parse(ok(await call('get', `/departments/${d1.id}`, ownerA))).staffCount,
    ).toBe(1);
    const filtered = ok(await call('get', `/staff?departmentId=${d1.id}&status=all`, ownerA)) as {
      items: { id: string }[];
    };
    expect(new Set(filtered.items.map((i) => i.id))).toEqual(
      new Set([member.staffA, member.invitedA]),
    );
    // No team was made or touched.
    const teams = ok(await call('get', `/teams?departmentId=${d1.id}`, ownerA)) as {
      items: unknown[];
    };
    expect(teams.items).toEqual([]);

    expect(names(await setMembers(d1.id, [member.invitedA], adminA))).toEqual([member.invitedA]);
    expect(names(await members(d2.id))).toEqual([member.staffA]);
    const audits = await auditRows(d1.id);
    expect(
      audits.filter((a) => a.action === 'department.members_set').map((a) => a.metadata),
    ).toEqual([
      expect.objectContaining({ departmentId: d1.id, added: 2, removed: 0 }),
      expect.objectContaining({ departmentId: d1.id, added: 0, removed: 1 }),
    ]);
  });

  it("refuses taking someone out of their only department, and people who can't join", async () => {
    const d = await dept();
    ok(await setMembers(d.id, [member.managerA]));
    // managerA may belong to other departments from earlier tests: give them this one alone.
    const others = await inFirm('a', (tx) =>
      tx.memberDepartment.findMany({
        where: { membershipId: member.managerA, departmentId: { not: d.id } },
      }),
    );
    for (const o of others) {
      await inFirm('a', (tx) =>
        tx.memberDepartment.delete({
          where: {
            membershipId_departmentId: {
              membershipId: o.membershipId,
              departmentId: o.departmentId,
            },
          },
        }),
      );
    }
    const last = await setMembers(d.id, []);
    expectError(last, 409, 'LAST_DEPARTMENT');
    expect(JSON.stringify(last.body)).toContain('has no other department');
    expectError(await setMembers(d.id, [member.managerA, member.ownerB]), 409, 'MEMBER_NOT_ACTIVE');
    expectError(
      await setMembers(d.id, [member.managerA, member.managerA]),
      400,
      'VALIDATION_FAILED',
    );
    const archived = await dept();
    ok(await call('patch', `/departments/${archived.id}`, ownerA, { status: 'ARCHIVED' }));
    expectError(await setMembers(archived.id, [member.staffA]), 400, 'VALIDATION_FAILED');
  });

  it('staff cannot change them; another firm sees nothing', async () => {
    const d = await dept();
    expectError(await setMembers(d.id, [member.staffA], staffA), 403, 'FORBIDDEN');
    expectError(await members(d.id, ownerB, 'b'), 404, 'NOT_FOUND');
    expectError(
      await call('put', `/departments/${d.id}/members`, ownerB, { membershipIds: [] }, 'b'),
      404,
      'NOT_FOUND',
    );
  });
});
