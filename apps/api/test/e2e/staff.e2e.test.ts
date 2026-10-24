// End-to-end: R55, the Staff Management directory (contract in packages/types/src/staff): list with
// filters, summary, form options, one member's details and the import template. Everyone with the
// Staff Management view reads; firm B sees none of firm A's; no email or phone is ever in a log.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { StaffDetail, StaffFormOptions, StaffListResponse, StaffSummary } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55s-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  invitedA: person('invited-a'),
  lockedA: person('locked-a'),
  gonerA: person('goner-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.62.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const { ownerA, adminA, staffA, managerA, invitedA, ownerB } = people;
const member = {} as Record<keyof typeof people, string>;
const dept = {} as Record<'tax' | 'books', string>;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55s ${key}`,
          phone: key === 'staffA' ? '+15550001111' : null,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55s-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role, status, title] of [
    ['a', 'ownerA', 'OWNER', 'ACTIVE', 'Principal'],
    ['a', 'adminA', 'ADMIN', 'ACTIVE', 'Office Manager'],
    ['a', 'staffA', 'STAFF', 'ACTIVE', 'Tax Preparer'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE', 'Senior Preparer'],
    ['a', 'invitedA', 'STAFF', 'INVITED', 'Bookkeeper'],
    ['a', 'lockedA', 'STAFF', 'LOCKED', 'Tax Preparer'],
    ['a', 'gonerA', 'STAFF', 'DEACTIVATED', 'Tax Preparer'],
    ['b', 'ownerB', 'OWNER', 'ACTIVE', 'Principal B'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: {
            businessId: firms[firm],
            userId: people[key].id,
            role,
            status,
            jobTitle: title,
          },
          select: { id: true },
        }),
      ).then((m) => m)
    ).id;
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    dept.tax = (
      await tx.department.create({ data: { businessId, name: `Tax ${run}` }, select: { id: true } })
    ).id;
    dept.books = (
      await tx.department.create({
        data: { businessId, name: `Books ${run}` },
        select: { id: true },
      })
    ).id;
    await tx.memberDepartment.createMany({
      data: [
        { businessId, membershipId: member.staffA, departmentId: dept.tax },
        { businessId, membershipId: member.staffA, departmentId: dept.books },
        { businessId, membershipId: member.invitedA, departmentId: dept.books },
      ],
    });
    await tx.team.create({
      data: { businessId, departmentId: dept.tax, name: `Evening ${run}` },
    });
    await tx.staffProfile.create({
      data: {
        businessId,
        membershipId: member.staffA,
        office: `Main Office ${run}`,
        workSchedule: `Mon-Thu ${run}`,
        supervisorId: member.managerA,
        employeeId: 'E-77',
        serviceAreas: ['TAX_PREPARATION'],
        accessLevel: 'MANAGER',
        notes: 'Seasonal hire',
        notesUpdatedAt: new Date(),
        notesUpdatedById: member.ownerA,
      },
    });
    await tx.staffSecuritySettings.create({
      data: {
        businessId,
        membershipId: member.staffA,
        lastLoginAt: new Date('2026-10-01T12:00:00Z'),
      },
    });
    await tx.invite.create({
      data: {
        businessId,
        membershipId: member.invitedA,
        tokenHash: createHash('sha256').update(`token-${run}`).digest('hex'),
        email: invitedA.email,
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the list', () => {
  it('lists everyone with their role, status, departments, last login and invite', async () => {
    const list = StaffListResponse.parse(ok(await call('get', '/staff?pageSize=100', ownerA)));
    expect(list.total).toBe(7);
    const by = (k: keyof typeof people) => list.items.find((i) => i.id === member[k])!;
    expect(by('ownerA')).toMatchObject({ role: 'OWNER', status: 'ACTIVE', isYou: true });
    expect(by('adminA').isYou).toBe(false);
    expect(by('staffA')).toMatchObject({
      status: 'ACTIVE',
      jobTitle: 'Tax Preparer',
      accessLevel: 'MANAGER',
      lastLoginAt: '2026-10-01T12:00:00.000Z',
      invite: null,
    });
    expect(
      by('staffA')
        .departments.map((d) => d.id)
        .sort(),
    ).toEqual([dept.tax, dept.books].sort());
    expect(by('invitedA')).toMatchObject({ status: 'INVITED', mfa: 'PENDING' });
    expect(by('invitedA').invite?.sentAt).toBeTruthy();
    expect(by('lockedA').status).toBe('LOCKED');
    expect(by('gonerA').status).toBe('DEACTIVATED');
    expect(by('ownerA').accessLevel).toBe('STANDARD_USER');
  });

  it('filters by status, role, department and search, and pages', async () => {
    const ids = async (q: string) =>
      StaffListResponse.parse(ok(await call('get', `/staff?${q}`, ownerA))).items.map((i) => i.id);
    expect(await ids('status=invited')).toEqual([member.invitedA]);
    expect(await ids('status=locked')).toEqual([member.lockedA]);
    expect(await ids('status=inactive')).toEqual([member.gonerA]);
    expect((await ids('status=active')).sort()).toEqual(
      [member.ownerA, member.adminA, member.staffA, member.managerA].sort(),
    );
    expect(await ids('role=MANAGER')).toEqual([member.managerA]);
    expect((await ids(`departmentId=${dept.books}`)).sort()).toEqual(
      [member.staffA, member.invitedA].sort(),
    );
    expect(await ids(`search=${encodeURIComponent('Senior Prep')}`)).toEqual([member.managerA]);
    expect(await ids(`search=${encodeURIComponent(adminA.email.slice(0, 12))}`)).toContain(
      member.adminA,
    );
    const page = StaffListResponse.parse(
      ok(await call('get', '/staff?pageSize=10&page=2', ownerA)),
    );
    expect(page).toMatchObject({ total: 7, page: 2, pageSize: 10, items: [] });
    expect((await call('get', '/staff?pageSize=7', ownerA)).status).toBe(400);
    expect((await call('get', '/staff?status=nope', ownerA)).status).toBe(400);
  });
});

describe('summary, options and the template', () => {
  it('counts the staff of the firm', async () => {
    const s = StaffSummary.parse(ok(await call('get', '/staff/summary', ownerA)));
    expect(s).toEqual({
      total: 7,
      addedThisMonth: 7,
      active: 4,
      inactive: 1,
      invited: 1,
      locked: 1,
      departments: 2,
    });
  });

  it('serves the form options: only active groups and managers, the roles the caller may give', async () => {
    const o = StaffFormOptions.parse(ok(await call('get', '/staff/options', adminA)));
    expect(o.departments.map((d) => d.id).sort()).toEqual([dept.tax, dept.books].sort());
    expect(o.teams).toHaveLength(1);
    expect(o.teams[0]?.departmentId).toBe(dept.tax);
    expect(o.managers.map((m) => m.id)).not.toContain(member.invitedA);
    expect(o.managers.map((m) => m.id)).toContain(member.managerA);
    // An Admin may give the roles below Admin, not Admin or Owner.
    expect(o.roles.map((r) => r.role)).toEqual([
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'BUSINESS_CONSULTANT',
      'READ_ONLY',
    ]);
    const owner = StaffFormOptions.parse(ok(await call('get', '/staff/options', ownerA)));
    expect(owner.roles.map((r) => r.role)).toContain('ADMIN');
    expect(o.jobTitles).toContain('Senior Preparer');
    expect(o.offices).toContain(`Main Office ${run}`);
    expect(o.serviceAreas.map((s) => s.code)).toContain('TAX_PREPARATION');
    // The presets first, then the firm's own schedules already given (Octavia's SM8).
    expect(o.workSchedules.slice(0, 5)).toContain('Flexible');
    expect(o.workSchedules).toContain(`Mon-Thu ${run}`);
    expect(o.workSchedules.indexOf(`Mon-Thu ${run}`)).toBeGreaterThanOrEqual(5);
  });

  it('serves the import template as a CSV file', async () => {
    const res = await call('get', '/staff/import/template', ownerA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const text = res.text.charCodeAt(0) === 0xfeff ? res.text.slice(1) : res.text;
    expect(text.split('\r\n')[0]).toBe(
      'firstName,lastName,email,phone,jobTitle,role,department,employmentType,office,hireDate,employeeId',
    );
  });
});

describe('one member', () => {
  it('shows the details, with the profile, teams, supervisor and notes', async () => {
    await inFirm('a', async (tx) => {
      const team = await tx.team.findFirstOrThrow({ where: { name: { startsWith: 'Evening' } } });
      await tx.teamMember.create({
        data: {
          businessId: firms.a,
          teamId: team.id,
          membershipId: member.staffA,
          kind: 'PRIMARY',
        },
      });
    });
    const d = StaffDetail.parse(ok(await call('get', `/staff/${member.staffA}`, adminA)));
    expect(d).toMatchObject({
      id: member.staffA,
      userId: staffA.id,
      email: staffA.email,
      phone: '+15550001111',
      role: 'STAFF',
      status: 'ACTIVE',
      accessLevel: 'MANAGER',
      serviceAreas: ['TAX_PREPARATION'],
      isYou: false,
    });
    expect(d.firstName).toBe('Fake');
    expect(d.profile).toMatchObject({
      employeeId: 'E-77',
      office: `Main Office ${run}`,
      acceptsNewClients: true,
    });
    expect(d.profile.supervisor?.id).toBe(member.managerA);
    expect(d.profile.primaryTeam?.name).toBe(`Evening ${run}`);
    expect(d.profile.backupTeam).toBeNull();
    expect(d.notes).toMatchObject({ text: 'Seasonal hire', updatedBy: 'Fake R55s ownerA' });
    expect(d.lastLogin?.at).toBe('2026-10-01T12:00:00.000Z');
    expect(d.version).toBeTruthy();
    const self = StaffDetail.parse(ok(await call('get', `/staff/${member.ownerA}`, ownerA)));
    expect(self.isYou).toBe(true);
    expect(self.notes).toBeNull();
    const invited = StaffDetail.parse(ok(await call('get', `/staff/${member.invitedA}`, ownerA)));
    expect(invited.invite?.expiresAt).toBeTruthy();
  });
});

describe('who may', () => {
  it('lets Owner and Admin read, keeps Staff and strangers out, and a Manager out until granted', async () => {
    ok(await call('get', '/staff', adminA));
    // Staff Management is a sensitive module: a Manager reads it only when the firm grants it.
    expectError(await call('get', '/staff/summary', managerA), 403, 'FORBIDDEN');
    expectError(await call('get', '/staff', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/staff/summary', staffA), 403, 'FORBIDDEN');
    expectError(await call('get', '/staff', undefined), 401, 'UNAUTHENTICATED');
  });

  it('shows firm B nothing of firm A', async () => {
    expectError(
      await call('get', `/staff/${member.staffA}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    const b = StaffListResponse.parse(ok(await call('get', '/staff', ownerB, undefined, 'b')));
    expect(b.total).toBe(1);
    expect(b.items[0]?.id).toBe(member.ownerB);
    expect(
      StaffSummary.parse(ok(await call('get', '/staff/summary', ownerB, undefined, 'b'))).total,
    ).toBe(1);
    const o = StaffFormOptions.parse(
      ok(await call('get', '/staff/options', ownerB, undefined, 'b')),
    );
    expect(o.departments).toHaveLength(0);
    expect(o.managers.map((m) => m.id)).toEqual([member.ownerB]);
    expect(
      StaffListResponse.parse(
        ok(await call('get', `/staff?departmentId=${dept.tax}`, ownerB, undefined, 'b')),
      ).items,
    ).toHaveLength(0);
    expectError(await call('get', `/staff/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
    expectError(await call('get', '/staff/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
  });
});
