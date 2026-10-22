// End-to-end: R60, Super Admin Team on R0's stage A org chart. Every route under
// /api/v1/admin/team: meta, the KPIs, the directory (search, filters, sort, paging), one member,
// their trail, the forms' choices, Add Team Member (the ADMIN-pool login, its rows, the
// invitation), Edit Team Member (with the name and phone, and its refusals), the bulk changes,
// Resend Invitation, the department head's decision (APPROVE sends the invitation) and the daily
// caps, with the audit rows they write. Emails and texts go to a fake NotifyService that keeps
// them, so the tests read the links. A firm's session reaches none of it. Each run makes its own
// departments, roles, people and emails (`run`).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ADMIN_TEAM_ACTIVITY_ACTIONS,
  ADMIN_TEAM_KEYS,
  ADMIN_TEAM_STATUS_ORDER,
  AdminTeamActivityList,
  AdminTeamBulkResult,
  AdminTeamFormOptions,
  AdminTeamInvitationResult,
  type AdminTeamLevel,
  AdminTeamMember,
  AdminTeamMemberPage,
  AdminTeamMemberResult,
  AdminTeamMeta,
  type AdminTeamScope,
  type AdminTeamStatus,
  AdminTeamSummary,
  adminTeamActivityText,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import {
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../../src/auth/identity/identity-provider.js';
import { TEAM_INVITE_LIMITS, TeamInvitationTokens } from '../../src/admin-team/team-invitation.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/team';
const run = randomUUID().slice(0, 8);
const RUN = run.toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const A = ADMIN_TEAM_ACTIVITY_ACTIONS;

// R0's team.* template per level (seed-platform-team.ts), the part these tests read.
const LEVELS: AdminTeamLevel[] = [
  'CEO',
  'CHIEF_OFFICER',
  'VP_DIRECTOR',
  'MANAGER',
  'LEAD_SUPERVISOR',
  'INDIVIDUAL_CONTRIBUTOR',
];
const TEMPLATE: [string, boolean[]][] = [
  ['team.view', [true, true, true, true, true, true]],
  ['team.view_profile', [true, true, true, true, true, true]],
  ['org.view', [true, true, true, true, true, true]],
  ['team.create', [true, true, false, false, false, false]],
  ['team.edit', [true, true, true, true, false, false]],
  ['team.change_role', [true, true, false, false, false, false]],
  ['team.message_team', [true, true, true, true, true, false]],
];
const templateFor = (level: AdminTeamLevel) =>
  TEMPLATE.filter(([, at]) => at[LEVELS.indexOf(level)]).map(([key]) => key);

const dept = { exec: '', ops: '', sales: '', closed: '' };
const ROLES = {
  ceo: ['CEO', 'Fake Chief Executive', 'CEO', 'exec', 'COMPANY'],
  coo: ['COO', 'Fake Operations Chief', 'CHIEF_OFFICER', 'ops', 'DEPARTMENT'],
  opsVp: ['OPS_VP', 'Fake Operations Director', 'VP_DIRECTOR', 'ops', 'DIVISION'],
  opsVp2: ['OPS_VP2', 'Fake Programs Director', 'VP_DIRECTOR', 'ops', 'DIVISION'],
  opsManager: ['OPS_MANAGER', 'Fake Operations Manager', 'MANAGER', 'ops', 'TEAM'],
  opsLead: ['OPS_LEAD', 'Fake Operations Lead', 'LEAD_SUPERVISOR', 'ops', 'TEAM'],
  opsIc: ['OPS_IC', 'Fake Operations Specialist', 'INDIVIDUAL_CONTRIBUTOR', 'ops', 'OWN_RECORDS'],
  salesIc: ['SALES_IC', 'Fake Account Executive', 'INDIVIDUAL_CONTRIBUTOR', 'sales', 'OWN_RECORDS'],
} as const satisfies Record<
  string,
  readonly [string, string, AdminTeamLevel, keyof typeof dept, AdminTeamScope]
>;
type RoleKey = keyof typeof ROLES;
const role = {} as Record<RoleKey, string>;

const PEOPLE = [
  'ceo',
  'coo',
  'manager',
  'editor',
  'mover',
  'status',
  'noPassword',
  'invited',
  'hire',
  'hire2',
  'bulk1',
  'bulk2',
  'seller',
] as const;
type PersonKey = (typeof PEOPLE)[number];
const who = Object.fromEntries(
  PEOPLE.map((k) => [
    k,
    {
      id: randomUUID(),
      email: `r60-team-${k.toLowerCase()}-${run}@example.test`,
      name: `Fake ${k[0]!.toUpperCase()}${k.slice(1)} ${run}`,
    },
  ]),
) as Record<PersonKey, { id: string; email: string; name: string }>;
const EDITOR_PHONE = '+15555550142';
const signedInAt = new Date(Date.now() - 3_600_000);
const invitationExpires = new Date(Date.now() + 6 * 86_400_000);

let app: INestApplication;
let env: Env;
let links: TeamInvitationTokens;
let identity: IdentityProvider;
/** What the fake NotifyService was handed (an address with "bounce" in it fails instead). */
const messages: NotifyMessage[] = [];
/** Cognito logins the API disabled (a login lost to a race). */
const disabled: string[] = [];
/** Two Add Team Members for this email both reach Cognito before either writes its row. */
const RACE_EMAIL = `r60-team-race-${run}@example.test`;
let raceArrived = 0;
let releaseRace = () => {};
const raceReady = new Promise<void>((resolve) => {
  releaseRace = resolve;
});
async function raceGate(): Promise<void> {
  raceArrived += 1;
  if (raceArrived >= 2) releaseRace();
  await Promise.race([raceReady, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.69.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function owner<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(client, { kind: 'platform' }, work);
  } finally {
    await client.$disconnect();
  }
}

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

async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
  email = fx.users.admin.email,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;
const expectStatus = (res: Response, status: number) =>
  expect(res.status, JSON.stringify(res.body)).toBe(status);
const refusal = (res: Response) => [res.status, code(res)];

const get = async (id: string, email?: string) => {
  const res = await call('get', `/members/${id}`, undefined, email);
  expectStatus(res, 200);
  return AdminTeamMember.parse(res.body);
};
const patch = async (id: string, body: object) => {
  const res = await call('patch', `/members/${id}`, body);
  expectStatus(res, 200);
  return AdminTeamMember.parse(res.body);
};
const page = async (query: string) => {
  const res = await call('get', `/members?search=${run}${query}`);
  expectStatus(res, 200);
  return AdminTeamMemberPage.parse(res.body);
};
const trail = async (id: string) => {
  const res = await call('get', `/members/${id}/activity`);
  expectStatus(res, 200);
  return AdminTeamActivityList.parse(res.body).items;
};
const auditRows = (id: string) =>
  owner((tx) =>
    tx.auditLog.findMany({
      where: { entityType: 'platform_member', entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  );

/** The org-chart row as stored (status and version). */
const memberRow = (userId: string) =>
  owner((tx) =>
    tx.platformMember.findUniqueOrThrow({
      where: { userId },
      select: { userId: true, status: true, updatedAt: true },
    }),
  );
/** The newest message handed over for this address. */
const lastTo = (to: string) => [...messages].reverse().find((m) => m.to === to);
/** The token in a message's activation link (`{ADMIN_BASE_URL}/activate#token=...`). */
function tokenIn(message: NotifyMessage | undefined): string {
  const text = String((message?.data as { body?: unknown } | undefined)?.body ?? '');
  const prefix = `${new URL('/activate', env.ADMIN_BASE_URL).toString()}#token=`;
  const at = text.indexOf(prefix);
  if (at === -1) throw new Error('No activation link in the message');
  return /^[\w.-]+/.exec(text.slice(at + prefix.length))![0];
}
/** The newest invitation to this address, opened. */
const openedLink = async (to: string) => (await links.open(tokenIn(lastTo(to))))!;

beforeAll(async () => {
  await owner(async (tx) => {
    for (const [key, name, active] of [
      ['exec', 'Executive', true],
      ['ops', 'Operations', true],
      ['sales', 'Sales', true],
      ['closed', 'Closed', false],
    ] as const)
      dept[key] = (
        await tx.platformDepartment.create({
          data: {
            code: `T${RUN}_${key.toUpperCase()}`,
            name: `Fake ${name} ${run}`,
            isActive: active,
          },
        })
      ).id;
    for (const [key, [suffix, title, level, department, scope]] of Object.entries(ROLES)) {
      role[key as RoleKey] = (
        await tx.platformRoleDefinition.create({
          data: {
            code: `T${RUN}_${suffix}`,
            title: `${title} ${run}`,
            level,
            departmentId: dept[department],
            defaultScopeType: scope,
            permissions: {
              create: templateFor(level).map((permissionKey) => ({
                permissionKey,
                state: 'ALLOW' as const,
              })),
            },
          },
        })
      ).id;
    }
    for (const k of PEOPLE) {
      const p = who[k];
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'ADMIN',
          email: p.email,
          name: p.name,
          phone: k === 'editor' ? EDITOR_PHONE : null,
        },
      });
      await tx.platformAdmin.create({
        data: { userId: p.id, role: k === 'ceo' ? 'SUPER_ADMIN' : 'TEAM_MEMBER' },
      });
    }
    const member = (
      k: PersonKey,
      r: RoleKey,
      over: {
        status?: AdminTeamStatus;
        reportsTo?: PersonKey;
        intended?: RoleKey;
      } = {},
    ) =>
      tx.platformMember.create({
        data: {
          userId: who[k].id,
          roleDefinitionId: role[r],
          departmentId: dept[ROLES[r][3]],
          scopeType: ROLES[r][4],
          status: over.status ?? 'ACTIVE',
          reportsToUserId: over.reportsTo ? who[over.reportsTo].id : null,
          intendedRoleDefinitionId: over.intended ? role[over.intended] : null,
          invitedByUserId: fx.users.admin.id,
        },
      });
    await member('ceo', 'ceo');
    await member('coo', 'coo', { reportsTo: 'ceo' });
    await member('manager', 'opsManager', { reportsTo: 'coo' });
    await member('editor', 'opsIc', { reportsTo: 'manager' });
    await member('mover', 'opsIc');
    await member('status', 'opsIc');
    await member('noPassword', 'opsIc', { status: 'INACTIVE' });
    await member('invited', 'opsIc', { status: 'PENDING_INVITATION' });
    for (const k of ['hire', 'hire2'] as const)
      await member(k, 'opsVp', { status: 'PENDING_DEPARTMENT_HEAD_APPROVAL', intended: 'opsVp' });
    await member('bulk1', 'opsIc');
    await member('bulk2', 'opsIc');
    await member('seller', 'salesIc');
    await tx.auditLog.create({
      data: {
        actorUserId: who.editor.id,
        action: 'auth.signed_in',
        entityType: 'user',
        entityId: who.editor.id,
        metadata: { pool: 'ADMIN' },
        createdAt: signedInAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: fx.users.admin.id,
        action: A.INVITED,
        entityType: 'platform_member',
        entityId: who.invited.id,
        metadata: { channels: ['EMAIL'], expiresAt: invitationExpires.toISOString() },
      },
    });
  });
  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        if (message.to.includes('bounce')) return Promise.reject(new Error('Bounced'));
        messages.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  links = nest.get(TeamInvitationTokens, { strict: false });
  // One login that never set a password: reactivating it sends it back to Pending Invitation.
  identity = nest.get<IdentityProvider>(IDENTITY_PROVIDER, { strict: false });
  const hasPassword = identity.hasPassword.bind(identity);
  identity.hasPassword = (pool, sub) =>
    sub === who.noPassword.id ? Promise.resolve(false) : hasPassword(pool, sub);
  const createUser = identity.createUser.bind(identity);
  identity.createUser = async (pool, email, contact) => {
    if (email === RACE_EMAIL) await raceGate();
    return createUser(pool, email, contact);
  };
  const disableUser = identity.disableUser.bind(identity);
  identity.disableUser = (pool, sub) => {
    disabled.push(sub);
    return disableUser(pool, sub);
  };
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the routes', () => {
  it('a firm Owner’s session gets 401', async () => {
    expect((await call('get', '/meta', undefined, fx.users.ownerA.email)).status).toBe(401);
    expect((await call('get', '/members', undefined, fx.users.ownerA.email)).status).toBe(401);
    const bulk = await call(
      'post',
      '/members/bulk',
      { ids: [who.bulk1.id], confirmedCount: 1, action: { type: 'STATUS', status: 'INACTIVE' } },
      fx.users.ownerA.email,
    );
    expect(bulk.status).toBe(401);
    const email = `r60-team-owner-try-${run}@example.test`;
    const create = await call(
      'post',
      '/members',
      { firstName: 'Fake', lastName: 'Try', email, departmentId: dept.ops, roleId: role.opsIc },
      fx.users.ownerA.email,
    );
    expect(create.status).toBe(401);
    const resend = await call(
      'post',
      '/members/invitations',
      { ids: [who.invited.id] },
      fx.users.ownerA.email,
    );
    expect(resend.status).toBe(401);
    expect(await owner((tx) => tx.user.count({ where: { email } }))).toBe(0);
  });

  it('Add Team Member and Resend Invitation are registered: a bad body is 400, not 404', async () => {
    expect(refusal(await call('post', '/members', { firstName: 'Fake' }))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    expect(refusal(await call('post', '/members/invitations', { ids: [] }))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  });

  it('an id that is not a UUID is 400; someone unknown is 404 NOT_FOUND', async () => {
    expect((await call('get', '/members/not-an-id')).status).toBe(400);
    expect(refusal(await call('get', `/members/${randomUUID()}`))).toEqual([404, 'NOT_FOUND']);
    expect(refusal(await call('get', `/members/${randomUUID()}/activity`))).toEqual([
      404,
      'NOT_FOUND',
    ]);
    expect(refusal(await call('get', `/members/${randomUUID()}/form-options`))).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });
});

describe('the reads', () => {
  it('GET /meta: a Super Admin without an org-chart row is the CEO, with every right', async () => {
    const res = await call('get', '/meta');
    expectStatus(res, 200);
    const meta = AdminTeamMeta.parse(res.body);
    expect(meta.viewer).toMatchObject({
      id: fx.users.admin.id,
      role: null,
      department: null,
      scope: 'COMPANY',
      unrestricted: true,
    });
    expect(meta.can).toEqual({
      add: true,
      edit: true,
      changeRole: true,
      changeDepartment: true,
      changeStatus: true,
      customizePermissions: true,
      approve: true,
    });
    expect(meta.modules).toHaveLength(12);
    const team = meta.modules.find((m) => m.id === 'team')!;
    expect(team.permissions.map((p) => p.key).sort()).toEqual(
      Object.values(ADMIN_TEAM_KEYS).sort(),
    );
    expect(meta.viewer.permissions).toContain('sales.view');
    const departments = meta.filters.departments.map((d) => d.id);
    expect(departments).toEqual(expect.arrayContaining([dept.exec, dept.ops, dept.sales]));
    expect(departments).not.toContain(dept.closed);
    expect(meta.filters.statuses).toEqual([...ADMIN_TEAM_STATUS_ORDER]);
    expect(meta.filters.supervisors.map((s) => s.id)).toEqual(
      expect.arrayContaining([who.ceo.id, who.coo.id, who.manager.id]),
    );
    expect(meta.filters.roles.find((r) => r.id === role.opsIc)).toEqual({
      id: role.opsIc,
      title: `Fake Operations Specialist ${run}`,
      departmentId: dept.ops,
    });
  });

  it('GET /meta as a CEO-level member: their own role and department', async () => {
    const meta = AdminTeamMeta.parse((await call('get', '/meta', undefined, who.ceo.email)).body);
    expect(meta.viewer).toMatchObject({
      id: who.ceo.id,
      name: who.ceo.name,
      role: { id: role.ceo, level: 'CEO' },
      department: { id: dept.exec },
      unrestricted: true,
    });
    expect(meta.viewer.permissions).toEqual(expect.arrayContaining(templateFor('CEO')));
  });

  it('GET /summary: the KPI row adds up', async () => {
    const res = await call('get', '/summary');
    expectStatus(res, 200);
    const summary = AdminTeamSummary.parse(res.body);
    expect(Object.keys(summary.byStatus).sort()).toEqual([...ADMIN_TEAM_STATUS_ORDER].sort());
    expect(Object.values(summary.byStatus).reduce((a, b) => a + b, 0)).toBe(summary.total);
    expect(summary.admins + summary.standard).toBe(summary.total);
    expect(summary.total).toBeGreaterThanOrEqual(PEOPLE.length);
    expect(summary.pending).toBeGreaterThanOrEqual(3);
    expect(summary.addedLast30Days).toBeGreaterThanOrEqual(PEOPLE.length);
  });

  it('GET /members: search, filters, sort and paging on the server', async () => {
    const all = await page('&pageSize=100');
    expect(all.total).toBe(PEOPLE.length);
    expect(new Set(all.items.map((m) => m.id))).toEqual(new Set(PEOPLE.map((k) => who[k].id)));
    const names = all.items.map((m) => m.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-US')));
    const desc = await page('&pageSize=100&sort=NAME&dir=desc');
    expect(desc.items.map((m) => m.name)).toEqual([...names].reverse());
    const first = await page('&pageSize=5');
    expect([first.items.length, first.total, first.page, first.pageSize]).toEqual([5, 13, 1, 5]);
    const last = await page('&pageSize=5&page=99');
    expect([last.items.length, last.page]).toEqual([3, 3]);
    expect((await page(`&departmentId=${dept.ops}`)).total).toBe(11);
    expect((await page(`&roleId=${role.opsIc}&pageSize=100`)).total).toBe(7);
    const pending = await page('&statuses=PENDING_INVITATION,PENDING_DEPARTMENT_HEAD_APPROVAL');
    expect(new Set(pending.items.map((m) => m.id))).toEqual(
      new Set([who.invited.id, who.hire.id, who.hire2.id]),
    );
    expect((await page('&accessLevel=SUPER_ADMIN')).items.map((m) => m.id)).toEqual([who.ceo.id]);
    expect((await page(`&reportsToId=${who.manager.id}`)).items.map((m) => m.id)).toEqual([
      who.editor.id,
    ]);
    const byStatus = await page('&pageSize=100&sort=STATUS');
    expect(byStatus.items[0]!.status).toBe('PENDING_INVITATION');
    const phone = await call('get', `/members?search=5555550142`);
    expect(AdminTeamMemberPage.parse(phone.body).items.map((m) => m.id)).toContain(who.editor.id);
    expect((await call('get', '/members?statuses=NOPE')).status).toBe(400);
  });

  it('GET /members/:id: the profile, its references, sign-in and what the caller may do', async () => {
    const editor = await get(who.editor.id);
    expect(editor).toMatchObject({
      firstName: 'Fake',
      lastName: `Editor ${run}`,
      name: who.editor.name,
      email: who.editor.email,
      phone: EDITOR_PHONE,
      department: { id: dept.ops, code: `T${RUN}_OPS` },
      role: { id: role.opsIc, level: 'INDIVIDUAL_CONTRIBUTOR' },
      intendedRole: null,
      accessLevel: 'STANDARD',
      reportsTo: { id: who.manager.id, name: who.manager.name },
      scope: 'OWN_RECORDS',
      customScope: null,
      customPermissions: false,
      status: 'ACTIVE',
      invitedBy: { id: fx.users.admin.id },
      invitation: null,
      lastSignedInAt: signedInAt.toISOString(),
      isYou: false,
      allowed: {
        edit: true,
        changeRole: true,
        changeDepartment: true,
        changeStatus: true,
        customizePermissions: true,
        approve: false,
        resendInvitation: false,
        message: true,
      },
    });
    expect([...editor.permissions].sort()).toEqual(templateFor('INDIVIDUAL_CONTRIBUTOR').sort());
    const invited = await get(who.invited.id);
    expect(invited.invitation?.expiresAt).toBe(invitationExpires.toISOString());
    expect(invited.lastSignedInAt).toBeNull();
    expect(invited.allowed.resendInvitation).toBe(true);
    const hire = await get(who.hire.id);
    expect(hire.intendedRole?.id).toBe(role.opsVp);
    expect(hire.allowed).toMatchObject({ approve: true, changeRole: false, changeStatus: false });
    const ceo = await get(who.ceo.id);
    expect(ceo).toMatchObject({ accessLevel: 'SUPER_ADMIN', isYou: false });
    expect(ceo.allowed).toMatchObject({ edit: false, changeRole: false, changeStatus: false });
    // Yourself: Edit Team Member for your own name and phone, nothing else.
    expect(await get(who.ceo.id, who.ceo.email)).toMatchObject({
      isYou: true,
      allowed: { edit: true, changeRole: false, changeStatus: false, customizePermissions: false },
    });
  });

  it('GET /form-options: what an unrestricted member may give; never the CEO role', async () => {
    const res = await call('get', '/form-options');
    expectStatus(res, 200);
    const options = AdminTeamFormOptions.parse(res.body);
    expect(options).toMatchObject({ unrestricted: true, canCustomize: true, statuses: [] });
    expect(options.scopes).toHaveLength(7);
    const roles = new Map(options.roles.map((r) => [r.id, r]));
    expect(roles.has(role.ceo)).toBe(false);
    expect(roles.get(role.opsVp)).toMatchObject({
      needsApproval: false,
      defaultScope: 'DIVISION',
      departmentId: dept.ops,
    });
    // Departments with a role the member may give: this run's Executive holds only the CEO role.
    const departments = options.departments.map((d) => d.id);
    expect(departments).toEqual(expect.arrayContaining([dept.ops, dept.sales]));
    expect(departments).not.toContain(dept.exec);
    expect(departments).not.toContain(dept.closed);
    const supervisors = options.supervisors.map((s) => s.id);
    expect(supervisors).toEqual(expect.arrayContaining([who.ceo.id, who.coo.id, who.invited.id]));
    expect(supervisors).not.toContain(who.hire.id);
    expect(supervisors).not.toContain(who.noPassword.id);
    expect(options.ceiling).toEqual(expect.arrayContaining(['sales.view', 'team.create']));
  });

  it('GET /members/:id/form-options: Edit’s choices for that person', async () => {
    const editor = AdminTeamFormOptions.parse(
      (await call('get', `/members/${who.editor.id}/form-options`)).body,
    );
    expect(editor.statuses).toEqual(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED']);
    expect(editor.supervisors.map((s) => s.id)).not.toContain(who.editor.id);
    expect(editor.roles.map((r) => r.id)).toContain(role.opsIc);
    const manager = AdminTeamFormOptions.parse(
      (await call('get', `/members/${who.manager.id}/form-options`)).body,
    );
    expect(manager.supervisors.map((s) => s.id)).not.toContain(who.editor.id);
    const invited = AdminTeamFormOptions.parse(
      (await call('get', `/members/${who.invited.id}/form-options`)).body,
    );
    expect(invited.statuses).toEqual(['PENDING_INVITATION', 'INACTIVE', 'DEACTIVATED']);
    expect((await call('get', `/members/${who.editor.id}/activity?limit=0`)).status).toBe(400);
  });
});

describe('Edit Team Member (PATCH /members/:id)', () => {
  it('the whole form sent back is no change: nothing written', async () => {
    const before = await get(who.editor.id);
    const rows = (await auditRows(who.editor.id)).length;
    const same = await patch(who.editor.id, {
      firstName: before.firstName,
      lastName: before.lastName,
      phone: before.phone,
      departmentId: before.department.id,
      roleId: before.role.id,
      reportsToId: before.reportsTo?.id ?? null,
      scope: before.scope,
      permissions: before.permissions,
      status: 'ACTIVE',
      expectedUpdatedAt: before.updatedAt,
    });
    expect(same.updatedAt).toBe(before.updatedAt);
    expect((await auditRows(who.editor.id)).length).toBe(rows);
  });

  it('a new name and phone are saved on the login; the audit row has the field names only', async () => {
    const id = who.editor.id;
    const before = await get(id);
    const login = () =>
      owner((tx) =>
        tx.user.findUniqueOrThrow({ where: { id }, select: { name: true, phone: true } }),
      );
    const renamed = await patch(id, {
      firstName: 'Fakest',
      lastName: `Editor ${run}`,
      phone: '+1 (555) 555-0199',
      expectedUpdatedAt: before.updatedAt,
    });
    expect(renamed).toMatchObject({
      name: `Fakest Editor ${run}`,
      firstName: 'Fakest',
      phone: '+15555550199',
    });
    expect(renamed.updatedAt).not.toBe(before.updatedAt);
    expect(await login()).toEqual({ name: `Fakest Editor ${run}`, phone: '+15555550199' });
    const row = (await auditRows(id)).filter((r) => r.action === A.PROFILE_UPDATED).at(-1)!;
    expect(row).toMatchObject({
      businessId: null,
      actorUserId: fx.users.admin.id,
      metadata: { fields: ['name', 'phone'] },
    });
    expect(JSON.stringify(row.metadata)).not.toMatch(/Fakest|5550199/);
    expect((await trail(id))[0]!.kind).toBe('PROFILE_UPDATED');
    // The version read before is stale now.
    const stale = await call('patch', `/members/${id}`, {
      phone: null,
      expectedUpdatedAt: before.updatedAt,
    });
    expect(refusal(stale)).toEqual([409, 'CONFLICT']);
    // Back as it was: the tests below read the old name and phone.
    await patch(id, {
      firstName: before.firstName,
      lastName: before.lastName,
      phone: EDITOR_PHONE,
    });
    expect(await login()).toEqual({ name: who.editor.name, phone: EDITOR_PHONE });
    // Someone above you: refused, nothing written.
    expect(refusal(await call('patch', `/members/${who.ceo.id}`, { firstName: 'Other' }))).toEqual([
      403,
      'PEER_PROTECTED',
    ]);
  });

  it('your own name and phone: saved; anything else on your own row is still 403', async () => {
    const mine = (body: object) => call('patch', `/members/${who.ceo.id}`, body, who.ceo.email);
    const res = await mine({ firstName: 'Fakeceo', phone: '+15555550123' });
    expectStatus(res, 200);
    expect(AdminTeamMember.parse(res.body)).toMatchObject({
      name: `Fakeceo Ceo ${run}`,
      phone: '+15555550123',
      isYou: true,
    });
    const row = (await auditRows(who.ceo.id)).filter((r) => r.action === A.PROFILE_UPDATED).at(-1)!;
    expect(row).toMatchObject({ actorUserId: who.ceo.id, metadata: { fields: ['name', 'phone'] } });
    const roleToo = await mine({ firstName: 'Fake', roleId: role.coo, departmentId: dept.ops });
    expect(refusal(roleToo)).toEqual([403, 'SELF_CHANGE']);
    // Back as it was.
    expectStatus(await mine({ firstName: 'Fake', phone: null }), 200);
    expect((await get(who.ceo.id)).name).toBe(who.ceo.name);
  });

  it('the refusals', async () => {
    const id = who.editor.id;
    const send = (body: object, target = id, email?: string) =>
      call('patch', `/members/${target}`, body, email);
    expect(refusal(await send({ departmentId: dept.exec, roleId: role.ceo }))).toEqual([
      403,
      'ROLE_CEILING',
    ]);
    expect(refusal(await send({ roleId: role.salesIc }))).toEqual([422, 'ROLE_NOT_IN_DEPARTMENT']);
    expect(refusal(await send({ departmentId: dept.closed, roleId: role.opsIc }))).toEqual([
      422,
      'ROLE_NOT_IN_DEPARTMENT',
    ]);
    expect(refusal(await send({ reportsToId: who.bulk1.id }))).toEqual([422, 'SUPERVISOR_INVALID']);
    expect(refusal(await send({ reportsToId: who.seller.id }))).toEqual([
      422,
      'SUPERVISOR_INVALID',
    ]);
    expect(
      refusal(await send({ permissions: [...templateFor('INDIVIDUAL_CONTRIBUTOR'), 'nope.key'] })),
    ).toEqual([422, 'UNKNOWN_PERMISSION']);
    expect(
      refusal(
        await send({
          scope: 'CUSTOM',
          customScope: { departmentIds: [randomUUID()], memberIds: [] },
        }),
      ),
    ).toEqual([422, 'CUSTOM_SCOPE_INVALID']);
    expect(
      refusal(await send({ status: 'SUSPENDED', expectedUpdatedAt: new Date(0).toISOString() })),
    ).toEqual([409, 'CONFLICT']);
    expect(refusal(await send({ status: 'SUSPENDED' }, who.ceo.id))).toEqual([
      403,
      'PEER_PROTECTED',
    ]);
    expect(refusal(await send({ status: 'SUSPENDED' }, who.ceo.id, who.ceo.email))).toEqual([
      403,
      'SELF_CHANGE',
    ]);
    expect(refusal(await send({ status: 'INACTIVE' }, who.hire.id))).toEqual([
      409,
      'PENDING_APPROVAL',
    ]);
    expect(refusal(await send({ status: 'SUSPENDED' }, who.invited.id))).toEqual([
      409,
      'STATUS_NOT_ALLOWED',
    ]);
    expect(refusal(await send({ status: 'SUSPENDED' }, randomUUID()))).toEqual([404, 'NOT_FOUND']);
    expect((await send({})).status).toBe(400);
  });

  it('a new role loads its template and default scope; then scope, keys and the supervisor', async () => {
    const id = who.editor.id;
    const before = await get(id);
    const lead = await patch(id, { roleId: role.opsLead, expectedUpdatedAt: before.updatedAt });
    expect(lead).toMatchObject({
      role: { id: role.opsLead },
      scope: 'TEAM',
      reportsTo: { id: who.manager.id },
      customPermissions: false,
    });
    expect([...lead.permissions].sort()).toEqual(templateFor('LEAD_SUPERVISOR').sort());
    const custom = await patch(id, {
      scope: 'DIRECT_REPORTS',
      permissions: [...templateFor('LEAD_SUPERVISOR'), 'sales.view'],
    });
    expect(custom).toMatchObject({ scope: 'DIRECT_REPORTS', customPermissions: true });
    expect(custom.permissions).toContain('sales.view');
    const scoped = await patch(id, {
      scope: 'CUSTOM',
      customScope: { departmentIds: [dept.sales], memberIds: [who.coo.id] },
    });
    expect(scoped.customScope).toEqual({
      departments: [{ id: dept.sales, code: `T${RUN}_SALES`, name: `Fake Sales ${run}` }],
      members: [{ id: who.coo.id, name: who.coo.name }],
    });
    expect((await patch(id, { reportsToId: who.coo.id })).reportsTo?.id).toBe(who.coo.id);

    const items = await trail(id);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'ROLE_CHANGED',
        'SCOPE_CHANGED',
        'PERMISSIONS_CHANGED',
        'REPORTS_TO_CHANGED',
      ]),
    );
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort().reverse());
    const changed = items.find((i) => i.kind === 'ROLE_CHANGED')!;
    expect(adminTeamActivityText(changed)).toBe(
      `Role changed: Fake Operations Specialist ${run} → Fake Operations Lead ${run}`,
    );
    expect(changed.actor?.id).toBe(fx.users.admin.id);
    const granted = items.find((i) => i.kind === 'PERMISSIONS_CHANGED' && i.granted.length)!;
    expect(granted.granted).toEqual(['sales.view']);
    expect(items.find((i) => i.kind === 'SCOPE_CHANGED')?.newValue).toBe('Custom Scope');
    expect((await call('get', `/members/${id}/activity?limit=1`)).body).toMatchObject({
      items: [{ kind: 'REPORTS_TO_CHANGED', newValue: who.coo.name }],
    });
  });

  it('Change Department moves the person with a role in it', async () => {
    const moved = await patch(who.mover.id, { departmentId: dept.sales, roleId: role.salesIc });
    expect(moved).toMatchObject({
      department: { id: dept.sales },
      role: { id: role.salesIc },
      scope: 'OWN_RECORDS',
    });
    expect((await trail(who.mover.id)).map((i) => i.kind)).toEqual(
      expect.arrayContaining(['DEPARTMENT_CHANGED', 'ROLE_CHANGED']),
    );
  });

  it('status: suspend, reactivate; without a password back to Pending Invitation', async () => {
    expect((await patch(who.status.id, { status: 'SUSPENDED' })).status).toBe('SUSPENDED');
    expect((await patch(who.status.id, { status: 'ACTIVE' })).status).toBe('ACTIVE');
    const statusTrail = await trail(who.status.id);
    expect(statusTrail.map((i) => adminTeamActivityText(i)).slice(0, 2)).toEqual([
      'Status changed: Suspended → Active',
      'Status changed: Active → Suspended',
    ]);
    expect((await patch(who.noPassword.id, { status: 'ACTIVE' })).status).toBe(
      'PENDING_INVITATION',
    );
    expect((await patch(who.invited.id, { status: 'INACTIVE' })).status).toBe('INACTIVE');
  });

  it('every change wrote audit rows on the person: platform rows, ids and codes only', async () => {
    const rows = await auditRows(who.editor.id);
    const ours = rows.filter((r) => r.action.startsWith('platform_member.'));
    expect(ours.length).toBeGreaterThanOrEqual(6);
    for (const r of ours) {
      expect(r).toMatchObject({
        businessId: null,
        actorUserId: fx.users.admin.id,
        entityType: 'platform_member',
        entityId: who.editor.id,
      });
      const text = JSON.stringify(r.metadata);
      expect(text).not.toContain(who.editor.name);
      expect(text).not.toContain(who.editor.email);
      expect(text).not.toContain(EDITOR_PHONE);
    }
    expect(ours.map((r) => r.action)).toEqual(
      expect.arrayContaining([A.ROLE_CHANGED, A.SCOPE_CHANGED, A.PERMISSIONS_CHANGED]),
    );
  });
});

describe('the bulk changes (POST /members/bulk)', () => {
  const bulk = (ids: string[], action: object, email?: string) =>
    call('post', '/members/bulk', { ids, confirmedCount: ids.length, action }, email);
  const result = (res: Response) => {
    expectStatus(res, 200);
    return AdminTeamBulkResult.parse(res.body);
  };

  it('Change Status: each person on their own; skips with reasons; unchanged apart', async () => {
    const stranger = randomUUID();
    const ids = [who.bulk1.id, who.bulk2.id, who.ceo.id, stranger, who.hire2.id];
    const mismatch = await call('post', '/members/bulk', {
      ids,
      confirmedCount: 1,
      action: { type: 'STATUS', status: 'SUSPENDED' },
    });
    expect(refusal(mismatch)).toEqual([400, 'VALIDATION_FAILED']);
    const first = result(await bulk(ids, { type: 'STATUS', status: 'SUSPENDED' }));
    expect(first).toEqual({
      updated: 2,
      unchanged: 0,
      skipped: [
        { id: who.ceo.id, name: who.ceo.name, reason: 'OUT_OF_REACH' },
        { id: stranger, name: null, reason: 'NOT_FOUND' },
        { id: who.hire2.id, name: who.hire2.name, reason: 'PENDING_APPROVAL' },
      ],
    });
    expect((await get(who.bulk1.id)).status).toBe('SUSPENDED');
    const again = result(
      await bulk([who.bulk1.id, who.bulk2.id], { type: 'STATUS', status: 'SUSPENDED' }),
    );
    expect(again).toEqual({ updated: 0, unchanged: 2, skipped: [] });
    const rows = await auditRows(who.bulk1.id);
    expect(rows.find((r) => r.action === A.STATUS_CHANGED)?.metadata).toEqual({
      from: 'ACTIVE',
      to: 'SUSPENDED',
      bulk: true,
    });
    const self = result(
      await bulk([who.ceo.id], { type: 'STATUS', status: 'SUSPENDED' }, who.ceo.email),
    );
    expect(self.skipped).toEqual([{ id: who.ceo.id, name: who.ceo.name, reason: 'SELF' }]);
  });

  it('Change Role: people of that role’s department; the CEO role is above anyone', async () => {
    const roles = result(
      await bulk([who.bulk1.id, who.seller.id], { type: 'ROLE', roleId: role.opsLead }),
    );
    expect(roles).toEqual({
      updated: 1,
      unchanged: 0,
      skipped: [{ id: who.seller.id, name: who.seller.name, reason: 'NOT_IN_DEPARTMENT' }],
    });
    expect((await get(who.bulk1.id)).role.id).toBe(role.opsLead);
    const other = result(await bulk([who.coo.id], { type: 'ROLE', roleId: role.ceo }));
    expect(other.skipped).toEqual([
      { id: who.coo.id, name: who.coo.name, reason: 'NOT_IN_DEPARTMENT' },
    ]);
    const ceo = result(
      await bulk([who.coo.id], { type: 'DEPARTMENT', departmentId: dept.exec, roleId: role.ceo }),
    );
    expect(ceo.skipped).toEqual([{ id: who.coo.id, name: who.coo.name, reason: 'ROLE_CEILING' }]);
    const sameDepartment = result(
      await bulk([who.manager.id], { type: 'ROLE', roleId: role.opsVp }),
    );
    expect(sameDepartment.updated).toBe(1);
    expect(refusal(await bulk([who.bulk1.id], { type: 'ROLE', roleId: randomUUID() }))).toEqual([
      422,
      'ROLE_NOT_IN_DEPARTMENT',
    ]);
  });

  it('Change Department: with a role in it; a role outside it refuses the request', async () => {
    expect(
      refusal(
        await bulk([who.bulk2.id], {
          type: 'DEPARTMENT',
          departmentId: dept.sales,
          roleId: role.opsIc,
        }),
      ),
    ).toEqual([422, 'ROLE_NOT_IN_DEPARTMENT']);
    const moved = result(
      await bulk([who.bulk2.id], {
        type: 'DEPARTMENT',
        departmentId: dept.sales,
        roleId: role.salesIc,
      }),
    );
    expect(moved).toEqual({ updated: 1, unchanged: 0, skipped: [] });
    expect((await get(who.bulk2.id)).department.id).toBe(dept.sales);
    expect((await trail(who.bulk2.id)).map((i) => i.kind)).toEqual(
      expect.arrayContaining(['DEPARTMENT_CHANGED', 'ROLE_CHANGED', 'STATUS_CHANGED']),
    );
  });
});

describe('the department head’s decision (POST /members/:id/decision)', () => {
  const decide = (id: string, body: object) => call('post', `/members/${id}/decision`, body);

  it('refusals: a role that is not a VP there, a text without a phone, not waiting', async () => {
    expect(
      refusal(await decide(who.hire2.id, { decision: 'APPROVE', roleId: role.opsManager })),
    ).toEqual([422, 'ROLE_NOT_ALLOWED']);
    expect(
      refusal(
        await decide(who.hire2.id, { decision: 'APPROVE', invite: { email: true, sms: true } }),
      ),
    ).toEqual([422, 'PHONE_REQUIRED']);
    expect(refusal(await decide(who.editor.id, { decision: 'APPROVE' }))).toEqual([
      409,
      'NOT_PENDING_APPROVAL',
    ]);
    expect(refusal(await decide(randomUUID(), { decision: 'REJECT' }))).toEqual([404, 'NOT_FOUND']);
    expect((await decide(who.hire2.id, { decision: 'MAYBE' })).status).toBe(400);
  });

  it('APPROVE with another VP / Director role: Pending Invitation, the invitation goes out', async () => {
    const res = await decide(who.hire.id, { decision: 'APPROVE', roleId: role.opsVp2 });
    expectStatus(res, 200);
    const { member, invitation } = AdminTeamMemberResult.parse(res.body);
    expect(invitation).toMatchObject({ email: true, sms: false });
    expect(member).toMatchObject({
      status: 'PENDING_INVITATION',
      role: { id: role.opsVp2 },
      intendedRole: null,
      approvedBy: { id: fx.users.admin.id },
      invitation: { expiresAt: invitation!.expiresAt },
      allowed: { resendInvitation: true },
    });
    expect(lastTo(who.hire.email)?.template).toBe('platform.message-email');
    const opened = await openedLink(who.hire.email);
    expect(opened).toMatchObject({ userId: who.hire.id });
    expect(opened.expiresAt.toISOString()).toBe(invitation!.expiresAt);
    expect(TeamInvitationTokens.stillValid(opened, await memberRow(who.hire.id))).toBe(true);
    expect(refusal(await decide(who.hire.id, { decision: 'APPROVE' }))).toEqual([
      409,
      'NOT_PENDING_APPROVAL',
    ]);
    const items = await trail(who.hire.id);
    expect(items.find((i) => i.kind === 'APPROVED')).toMatchObject({
      previousValue: `Fake Operations Director ${run}`,
      newValue: `Fake Programs Director ${run}`,
      approver: { id: fx.users.admin.id },
    });
    expect(items.map((i) => i.kind)).toContain('INVITED');
    const rows = await auditRows(who.hire.id);
    expect(rows.find((r) => r.action === A.APPROVED)?.metadata).toMatchObject({
      invitationSent: true,
    });
    expect(rows.find((r) => r.action === A.INVITED)?.metadata).toEqual({
      channels: ['EMAIL'],
      expiresAt: invitation!.expiresAt,
      via: 'APPROVAL',
    });
  });

  it('REJECT: Inactive', async () => {
    const res = await decide(who.hire2.id, { decision: 'REJECT', reason: 'Fake reason' });
    expectStatus(res, 200);
    const { member } = AdminTeamMemberResult.parse(res.body);
    expect(member).toMatchObject({ status: 'INACTIVE', intendedRole: null });
    const rejected = (await trail(who.hire2.id)).find((i) => i.kind === 'REJECTED')!;
    expect(rejected).toMatchObject({
      previousValue: `Fake Operations Director ${run}`,
      approver: { id: fx.users.admin.id },
      reason: null,
    });
    const rows = await auditRows(who.hire2.id);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Fake reason');
  });
});

const join = (key: string, over: object = {}) => ({
  firstName: 'Fake',
  lastName: `${key} ${run}`,
  email: `r60-team-${key.toLowerCase()}-${run}@example.test`,
  departmentId: dept.ops,
  roleId: role.opsIc,
  ...over,
});
const create = (body: object) => call('post', '/members', body);
const made = (res: Response) => {
  expectStatus(res, 201);
  return AdminTeamMemberResult.parse(res.body);
};
const loginsOf = (email: string) =>
  owner((tx) =>
    tx.user.findMany({
      where: { email, pool: 'ADMIN' },
      select: {
        id: true,
        cognitoSub: true,
        name: true,
        phone: true,
        platformAdmin: { select: { role: true } },
      },
    }),
  );

/**
 * A new team member's `platform_admins` row needs INSERT on that table for the app's role. R0's
 * `r0_platform_tightening` (Oct 7) revoked it and #981 granted it back for TEAM_MEMBER rows; this
 * names the grant if it is ever missing, instead of a bare 500 from Add Team Member.
 */
async function needsAdminRowInsert(): Promise<void> {
  const [row] = await owner(
    (tx) =>
      tx.$queryRaw<{ ok: boolean }[]>`
        SELECT has_table_privilege('firmivra_app', 'platform_admins', 'INSERT') AS ok`,
  );
  expect(
    row?.ok,
    'R0: firmivra_app needs INSERT on platform_admins (TEAM_MEMBER rows, platform scope) for Add Team Member',
  ).toBe(true);
}

/** An ADMIN-pool login with a TEAM_MEMBER admin row and no org-chart row: a half-made create. */
async function halfMade(key: string, name = 'Fake Old'): Promise<{ id: string; email: string }> {
  const login = { id: randomUUID(), email: `r60-team-${key}-${run}@example.test` };
  await owner(async (tx) => {
    await tx.user.create({
      data: { id: login.id, cognitoSub: login.id, pool: 'ADMIN', email: login.email, name },
    });
    await tx.platformAdmin.create({ data: { userId: login.id, role: 'TEAM_MEMBER' } });
  });
  return login;
}

/** A member made with the owner client, in the status given. */
async function seeded(
  key: string,
  status: 'PENDING_INVITATION' | 'PENDING_DEPARTMENT_HEAD_APPROVAL',
  phone: string | null = null,
): Promise<{ id: string; email: string; name: string }> {
  const hire = status === 'PENDING_DEPARTMENT_HEAD_APPROVAL';
  const person = {
    id: randomUUID(),
    email: `r60-team-${key}-${run}@example.test`,
    name: `Fake ${key} ${run}`,
  };
  await owner(async (tx) => {
    await tx.user.create({
      data: {
        id: person.id,
        cognitoSub: person.id,
        pool: 'ADMIN',
        email: person.email,
        name: person.name,
        phone,
      },
    });
    await tx.platformAdmin.create({ data: { userId: person.id, role: 'TEAM_MEMBER' } });
    await tx.platformMember.create({
      data: {
        userId: person.id,
        roleDefinitionId: hire ? role.opsVp : role.opsIc,
        departmentId: dept.ops,
        scopeType: hire ? 'DIVISION' : 'OWN_RECORDS',
        status,
        intendedRoleDefinitionId: hire ? role.opsVp : null,
        invitedByUserId: fx.users.admin.id,
      },
    });
  });
  return person;
}

describe('Add Team Member (POST /members)', () => {
  it('the ADMIN-pool login, its admin row, the org-chart row, the audit rows and the invitation', async () => {
    await needsAdminRowInsert();
    const added = {
      email: `r60-team-added-${run}@example.test`,
      phone: '+15555550177',
      name: `Fake Added ${run}`,
    };
    const { member, invitation } = made(
      await create(
        join('Added', {
          email: added.email.toUpperCase(),
          phone: added.phone,
          reportsToId: who.manager.id,
          invite: { email: true, sms: true },
        }),
      ),
    );
    expect(invitation).toMatchObject({ email: true, sms: true });
    expect(Date.parse(invitation!.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(member).toMatchObject({
      name: added.name,
      email: added.email,
      phone: added.phone,
      status: 'PENDING_INVITATION',
      role: { id: role.opsIc },
      department: { id: dept.ops },
      reportsTo: { id: who.manager.id },
      scope: 'OWN_RECORDS',
      customPermissions: false,
      invitedBy: { id: fx.users.admin.id },
      invitation: { expiresAt: invitation!.expiresAt },
      allowed: { resendInvitation: true },
    });
    // The login: ADMIN pool, lower-case email, no password yet; a TEAM_MEMBER admin row.
    const logins = await loginsOf(added.email);
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({
      id: member.id,
      name: added.name,
      phone: added.phone,
      platformAdmin: { role: 'TEAM_MEMBER' },
    });
    expect(await identity.hasPassword('ADMIN', logins[0]!.cognitoSub)).toBe(false);
    const row = await memberRow(member.id);
    expect(row.status).toBe('PENDING_INVITATION');

    // Audit: platform rows on the person, ids and codes only.
    const rows = await auditRows(member.id);
    expect(rows.map((r) => r.action).sort()).toEqual([A.CREATED, A.INVITED].sort());
    for (const r of rows)
      expect(r).toMatchObject({
        businessId: null,
        actorUserId: fx.users.admin.id,
        entityType: 'platform_member',
        entityId: member.id,
      });
    expect(rows.find((r) => r.action === A.CREATED)?.metadata).toEqual({
      roleId: role.opsIc,
      departmentId: dept.ops,
      reportsToId: who.manager.id,
      scope: 'OWN_RECORDS',
      status: 'PENDING_INVITATION',
    });
    expect(rows.find((r) => r.action === A.INVITED)?.metadata).toEqual({
      channels: ['EMAIL', 'SMS'],
      expiresAt: invitation!.expiresAt,
      via: 'CREATE',
    });

    // The email and the text: Firmivra's own, with the same activation link.
    const mail = lastTo(added.email);
    expect(mail).toMatchObject({
      template: 'platform.message-email',
      businessId: null,
      data: { name: added.name },
    });
    const text = lastTo(added.phone);
    expect(text?.template).toBe('platform.message-sms');
    const token = tokenIn(mail);
    expect(tokenIn(text)).toBe(token);
    const opened = (await links.open(token))!;
    expect(opened.userId).toBe(member.id);
    expect(TeamInvitationTokens.stillValid(opened, row)).toBe(true);
    const audit = JSON.stringify(rows.map((r) => r.metadata));
    for (const value of [added.email, added.phone, added.name, token, '/activate'])
      expect(audit).not.toContain(value);
    expect((await trail(member.id)).map((i) => i.kind).sort()).toEqual(['CREATED', 'INVITED']);
  });

  it('409 EMAIL_TAKEN for a member or a Super Admin, before any login is made', async () => {
    for (const email of [who.editor.email, who.ceo.email.toUpperCase(), fx.users.admin.email])
      expect(refusal(await create(join('Taken', { email })))).toEqual([409, 'EMAIL_TAKEN']);
    expect(await loginsOf(`r60-team-taken-${run}@example.test`)).toEqual([]);
  });

  it('a staff or client login’s email is someone new: a login of its own in the ADMIN pool', async () => {
    await needsAdminRowInsert();
    const email = `r60-team-elsewhere-${run}@example.test`;
    await owner(async (tx) => {
      for (const pool of ['STAFF', 'CLIENT'] as const) {
        const id = randomUUID();
        await tx.user.create({ data: { id, cognitoSub: id, pool, email, name: 'Fake Elsewhere' } });
      }
    });
    const { member, invitation } = made(await create(join('Elsewhere', { email })));
    expect(member).toMatchObject({ email, status: 'PENDING_INVITATION' });
    expect(invitation).toMatchObject({ email: true, sms: false });
    const pools = await owner((tx) =>
      tx.user.findMany({ where: { email }, select: { id: true, pool: true } }),
    );
    expect(pools.map((u) => u.pool).sort()).toEqual(['ADMIN', 'CLIENT', 'STAFF']);
    expect(pools.find((u) => u.pool === 'ADMIN')!.id).toBe(member.id);
  });

  it('a login left half-made is reused, not refused, and the new name is saved', async () => {
    const half = await halfMade('half');
    const quiet = made(
      await create(join('Half', { email: half.email, invite: { email: false, sms: false } })),
    );
    expect(quiet.invitation).toBeNull();
    expect(quiet.member).toMatchObject({
      id: half.id,
      name: `Fake Half ${run}`,
      status: 'PENDING_INVITATION',
      invitation: null,
    });
    expect((await loginsOf(half.email))[0]?.name).toBe(`Fake Half ${run}`);
    expect((await auditRows(half.id)).map((r) => r.action)).toEqual([A.CREATED]);
    // Now on the team: the same email again is taken.
    expect(refusal(await create(join('Half', { email: half.email })))).toEqual([
      409,
      'EMAIL_TAKEN',
    ]);
  });

  it('an ADMIN-pool login with no admin row is reused too: its admin row is added', async () => {
    await needsAdminRowInsert();
    const bare = { id: randomUUID(), email: `r60-team-bare-${run}@example.test` };
    await owner((tx) =>
      tx.user.create({
        data: { id: bare.id, cognitoSub: bare.id, pool: 'ADMIN', email: bare.email, name: 'Fake' },
      }),
    );
    const reused = made(await create(join('Bare', { email: bare.email })));
    expect(reused.member.id).toBe(bare.id);
    expect((await loginsOf(bare.email))[0]).toMatchObject({
      name: `Fake Bare ${run}`,
      platformAdmin: { role: 'TEAM_MEMBER' },
    });
  });

  it('a failed email: the member stands; the answer says it was not sent', async () => {
    const login = await halfMade('bounce');
    const { member, invitation } = made(await create(join('Bounce', { email: login.email })));
    expect(invitation).toMatchObject({ email: false, sms: false });
    expect(member).toMatchObject({ id: login.id, status: 'PENDING_INVITATION' });
    expect((await auditRows(member.id)).map((r) => r.action).sort()).toEqual(
      [A.CREATED, A.INVITED].sort(),
    );
  });

  it('two at once for one new email: one member, the other 409; its extra login is disabled', async () => {
    await needsAdminRowInsert();
    const body = join('Race', { email: RACE_EMAIL });
    const both = await Promise.all([create(body), create(body)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(code(both.find((r) => r.status === 409)!)).toBe('EMAIL_TAKEN');
    const logins = await loginsOf(RACE_EMAIL);
    expect(logins).toHaveLength(1);
    expect(disabled).toHaveLength(1);
    expect(disabled[0]).not.toBe(logins[0]!.cognitoSub);
  });
});

describe('Resend Invitation (POST /members/invitations)', () => {
  const resend = (body: object) => call('post', '/members/invitations', body);
  const result = (res: Response) => {
    expectStatus(res, 200);
    return AdminTeamInvitationResult.parse(res.body);
  };
  const PHONE = '+15555550188';
  let pending: { id: string; email: string; name: string };

  beforeAll(async () => {
    pending = await seeded('resendee', 'PENDING_INVITATION', PHONE);
  });

  it('a new link for each person still Pending Invitation; their older links stop matching', async () => {
    const stranger = randomUUID();
    const first = result(await resend({ ids: [pending.id, who.editor.id, stranger], sms: true }));
    expect(first).toEqual({
      sent: 1,
      skipped: [
        { id: who.editor.id, name: who.editor.name, reason: 'NOT_PENDING_INVITATION' },
        { id: stranger, name: null, reason: 'NOT_FOUND' },
      ],
    });
    const older = tokenIn(lastTo(pending.email));
    expect(tokenIn(lastTo(PHONE))).toBe(older);
    expect(lastTo(PHONE)?.template).toBe('platform.message-sms');
    const before = await memberRow(pending.id);
    expect(TeamInvitationTokens.stillValid((await links.open(older))!, before)).toBe(true);

    expect(result(await resend({ ids: [pending.id] }))).toEqual({ sent: 1, skipped: [] });
    const row = await memberRow(pending.id);
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const fresh = await openedLink(pending.email);
    expect(TeamInvitationTokens.stillValid(fresh, row)).toBe(true);
    expect(TeamInvitationTokens.stillValid((await links.open(older))!, row)).toBe(false);
    const invited = (await auditRows(pending.id)).filter((r) => r.action === A.INVITED);
    expect(invited.map((r) => r.metadata)).toEqual([
      { channels: ['EMAIL', 'SMS'], expiresAt: expect.any(String), via: 'RESEND' },
      { channels: ['EMAIL'], expiresAt: expect.any(String), via: 'RESEND' },
    ]);
    expect((await get(pending.id)).invitation?.expiresAt).toBe(
      (invited[1]!.metadata as { expiresAt: string }).expiresAt,
    );
  });

  it('at most 5 links a day to one person, then RATE_LIMITED', async () => {
    // Two so far.
    for (let i = 2; i < TEAM_INVITE_LIMITS.perPerson; i++)
      expect(result(await resend({ ids: [pending.id] })).sent).toBe(1);
    expect(result(await resend({ ids: [pending.id] }))).toEqual({
      sent: 0,
      skipped: [{ id: pending.id, name: pending.name, reason: 'RATE_LIMITED' }],
    });
  });

  it('the platform’s daily cap: 429 for Add Team Member and APPROVE, a skip for a resend', async () => {
    const hire = await seeded('capped-hire', 'PENDING_DEPARTMENT_HEAD_APPROVAL');
    const quietLogin = await halfMade('capped-quiet');
    const cap = TEAM_INVITE_LIMITS.perPlatform;
    // Every link of the last day in this database (other test files' too) counts.
    TEAM_INVITE_LIMITS.perPlatform = await owner((tx) =>
      tx.auditLog.count({
        where: {
          action: A.INVITED,
          entityType: 'platform_member',
          businessId: null,
          createdAt: { gt: new Date(Date.now() - 86_400_000) },
        },
      }),
    );
    try {
      const email = `r60-team-capped-${run}@example.test`;
      expect(refusal(await create(join('Capped', { email })))).toEqual([429, 'RATE_LIMITED']);
      // Refused before any login is made.
      expect(await owner((tx) => tx.user.count({ where: { email } }))).toBe(0);
      // Without an invitation, Add Team Member still works; the link waits for tomorrow.
      const { member } = made(
        await create(
          join('Capped', { email: quietLogin.email, invite: { email: false, sms: false } }),
        ),
      );
      expect(result(await resend({ ids: [member.id] }))).toEqual({
        sent: 0,
        skipped: [{ id: member.id, name: `Fake Capped ${run}`, reason: 'RATE_LIMITED' }],
      });
      const decide = (body: object) => call('post', `/members/${hire.id}/decision`, body);
      expect(refusal(await decide({ decision: 'APPROVE' }))).toEqual([429, 'RATE_LIMITED']);
      expect((await memberRow(hire.id)).status).toBe('PENDING_DEPARTMENT_HEAD_APPROVAL');
      const quiet = await decide({ decision: 'APPROVE', invite: { email: false, sms: false } });
      expectStatus(quiet, 200);
      expect(AdminTeamMemberResult.parse(quiet.body)).toMatchObject({
        member: { status: 'PENDING_INVITATION' },
        invitation: null,
      });
    } finally {
      TEAM_INVITE_LIMITS.perPlatform = cap;
    }
  });
});
