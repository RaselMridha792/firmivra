// End-to-end: R55, Staff Management's changes (contract in packages/types/src/staff): Create
// Staff (idempotent, with the invite's outcome), Edit Staff, the account actions, a member's
// permissions (applied by the roles guard), notes, pay and drafts. Owner and Admin change;
// firm B reaches none of firm A's members; audit rows never hold an email, a note or an amount.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  CreateStaffResponse,
  StaffActionResult,
  StaffCompensation,
  StaffDetail,
  StaffDraft,
  StaffPermissions,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { ACTIVATION_MAILER, type ActivationEmail } from '../../src/auth/activation-mailer.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55w-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  admin2A: person('admin2-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  invitedA: person('invited-a'),
  lockedA: person('locked-a'),
  gonerA: person('goner-a'),
  neverA: person('never-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const newEmail = (key: string) => `r55w-new-${key}-${run}@r55.test`;
/** The stand-in mailer fails for these addresses (the email sender is down). */
const FAILING = newEmail('mail-fails');
const sent: string[] = [];

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
const { ownerA, adminA, staffA, managerA, invitedA, gonerA, neverA, ownerB } = people;
const member = {} as Record<keyof typeof people, string>;
const dept = {} as Record<'tax' | 'books' | 'old' | 'otherFirm', string>;
const team = {} as Record<'evening' | 'morning', string>;

const account = (key: string, over: object = {}) => ({
  firstName: 'Fake',
  lastName: `Hire ${key}`,
  email: newEmail(key),
  departmentIds: [dept.tax],
  jobTitle: 'Tax Preparer',
  role: 'TAX_PREPARER',
  ...over,
});
const membersWith = (email: string) =>
  inFirm('a', (tx) => tx.membership.count({ where: { businessId: firms.a, user: { email } } }));

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55w ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55w-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role, status, joined] of [
    ['a', 'ownerA', 'OWNER', 'ACTIVE', true],
    ['a', 'adminA', 'ADMIN', 'ACTIVE', true],
    ['a', 'admin2A', 'ADMIN', 'ACTIVE', true],
    ['a', 'staffA', 'STAFF', 'ACTIVE', true],
    ['a', 'managerA', 'MANAGER', 'ACTIVE', true],
    ['a', 'invitedA', 'STAFF', 'INVITED', false],
    ['a', 'lockedA', 'STAFF', 'LOCKED', true],
    ['a', 'gonerA', 'STAFF', 'DEACTIVATED', true],
    ['a', 'neverA', 'BOOKKEEPER', 'DEACTIVATED', false],
    ['b', 'ownerB', 'OWNER', 'ACTIVE', true],
  ] as const) {
    member[key] = (
      await inFirm(firm, async (tx) => {
        // The database stamps joined_at when a member first turns ACTIVE.
        const m = await tx.membership.create({
          data: {
            businessId: firms[firm],
            userId: people[key].id,
            role,
            status: joined ? 'ACTIVE' : status,
            jobTitle: 'Preparer',
          },
          select: { id: true },
        });
        if (joined && status !== 'ACTIVE')
          await tx.membership.update({ where: { id: m.id }, data: { status } });
        return m;
      })
    ).id;
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const department = (name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
      tx.department
        .create({ data: { businessId, name: `${name} ${run}`, status }, select: { id: true } })
        .then((d) => d.id);
    dept.tax = await department('Tax');
    dept.books = await department('Books');
    dept.old = await department('Old', 'INACTIVE');
    team.evening = (
      await tx.team.create({
        data: { businessId, departmentId: dept.tax, name: `Evening ${run}` },
        select: { id: true },
      })
    ).id;
    team.morning = (
      await tx.team.create({
        data: { businessId, departmentId: dept.tax, name: `Morning ${run}` },
        select: { id: true },
      })
    ).id;
    await tx.memberDepartment.create({
      data: { businessId, membershipId: member.staffA, departmentId: dept.tax },
    });
    await tx.invite.create({
      data: {
        businessId,
        membershipId: member.invitedA,
        tokenHash: createHash('sha256').update(`invited-${run}`).digest('hex'),
        name: 'Fake Invited',
        email: invitedA.email,
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
      },
    });
    const never = await tx.invite.create({
      data: {
        businessId,
        membershipId: member.neverA,
        tokenHash: createHash('sha256').update(`never-${run}`).digest('hex'),
        name: 'Fake Never Joined',
        email: neverA.email,
        expiresAt: new Date(Date.now() + 5 * 86_400_000),
      },
      select: { id: true },
    });
    await tx.invite.update({ where: { id: never.id }, data: { revokedAt: new Date() } });
    for (const key of ['staffA', 'lockedA'] as const)
      await tx.staffSession.create({
        data: {
          businessId,
          membershipId: member[key],
          tokenHash: createHash('sha256').update(`session-${key}-${run}`).digest('hex'),
          device: 'Chrome on macOS',
        },
      });
  });
  dept.otherFirm = await inFirm('b', (tx) =>
    tx.department
      .create({ data: { businessId: firms.b, name: `B ${run}` }, select: { id: true } })
      .then((d) => d.id),
  );
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(ACTIVATION_MAILER)
    .useValue({
      send: (email: ActivationEmail) => {
        if (email.to === FAILING) return Promise.reject(new Error('email sender down'));
        sent.push(email.to);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Create Staff', () => {
  it('creates the member with all four steps, invites them, and answers a retry with the first result', async () => {
    const draft = StaffDraft.parse(
      ok(
        await call('post', '/staff-drafts', ownerA, {
          step: 2,
          data: { account: { firstName: 'Fake' } },
        }),
        201,
      ),
    );
    const body = {
      idempotencyKey: randomUUID(),
      account: account('full', {
        phone: '(555) 010-2030',
        departmentIds: [dept.tax, dept.books],
        serviceAreas: ['TAX_PREPARATION'],
        accessLevel: 'MANAGER',
        accessStartsOn: '2026-11-01',
      }),
      permissions: [{ module: 'CLIENTS', capability: 'EDIT', granted: false }],
      access: {
        autoLogoutMinutes: 30,
        maxConcurrentSessions: 2,
        notices: {
          newDeviceLogin: true,
          failedLogins: false,
          passwordChanges: true,
          securityAlerts: true,
          lockouts: true,
        },
      },
      details: {
        employmentType: 'FULL_TIME',
        office: `Main ${run}`,
        hireDate: '2026-11-01',
        supervisorId: member.managerA,
        employeeId: `E-${run}`,
        primaryTeamId: team.evening,
        backupTeamId: team.morning,
        maxWorkload: 40,
      },
      compensation: { payType: 'HOURLY', rateCents: 4500, payFrequency: 'BIWEEKLY' },
      draftId: draft.id,
    };
    const first = CreateStaffResponse.parse(ok(await call('post', '/staff', ownerA, body), 201));
    expect(first.invitation.status).toBe('SENT');
    expect(sent).toContain(body.account.email);
    expect(first.staff).toMatchObject({
      status: 'INVITED',
      role: 'TAX_PREPARER',
      jobTitle: 'Tax Preparer',
      email: body.account.email,
      accessLevel: 'MANAGER',
      accessStartsOn: '2026-11-01',
      serviceAreas: ['TAX_PREPARATION'],
      profile: {
        employmentType: 'FULL_TIME',
        hireDate: '2026-11-01',
        employeeId: `E-${run}`,
        maxWorkload: 40,
        primaryTeam: { id: team.evening },
        backupTeam: { id: team.morning },
        supervisor: { id: member.managerA },
      },
    });
    expect(first.staff.departments.map((d) => d.id).sort()).toEqual([dept.tax, dept.books].sort());

    // A retry (or a double click) answers the first result: one member, one email.
    const again = CreateStaffResponse.parse(ok(await call('post', '/staff', ownerA, body), 201));
    expect(again.staff.id).toBe(first.staff.id);
    expect(again.invitation).toEqual(first.invitation);
    expect(await membersWith(body.account.email)).toBe(1);
    expect(sent.filter((e) => e === body.account.email)).toHaveLength(1);
    // The same key from someone else is not theirs to replay.
    expectError(await call('post', '/staff', adminA, body), 404, 'NOT_FOUND');

    const id = first.staff.id;
    const stored = await inFirm('a', async (tx) => ({
      security: await tx.staffSecuritySettings.findUniqueOrThrow({
        where: { businessId_membershipId: { businessId: firms.a, membershipId: id } },
      }),
      own: await tx.memberPermission.findMany({ where: { businessId: firms.a, membershipId: id } }),
      draft: await tx.staffDraft.count({ where: { businessId: firms.a, id: draft.id } }),
      audit: await tx.auditLog.findMany({
        where: { businessId: firms.a, entityId: id, action: 'staff.created' },
      }),
    }));
    expect(stored.security).toMatchObject({
      autoLogoutMinutes: 30,
      maxConcurrentSessions: 2,
      notifyFailedLogins: false,
    });
    expect(stored.own).toEqual([
      expect.objectContaining({ module: 'CLIENTS', capability: 'EDIT', granted: false }),
    ]);
    expect(stored.draft).toBe(0);
    expect(stored.audit).toHaveLength(1);
    const audit = JSON.stringify(stored.audit[0]!.metadata);
    expect(audit).not.toContain(body.account.email);
    expect(audit).not.toContain('4500');
    expect(audit).toContain('compensation');

    const pay = StaffCompensation.parse(ok(await call('get', `/staff/${id}/compensation`, ownerA)));
    expect(pay).toMatchObject({ payType: 'HOURLY', rateCents: 4500, payFrequency: 'BIWEEKLY' });
  });

  it('creates without sending when "Send welcome email" is off, and reports a failed send as FAILED', async () => {
    const quiet = CreateStaffResponse.parse(
      ok(
        await call('post', '/staff', adminA, {
          idempotencyKey: randomUUID(),
          account: account('quiet'),
          sendWelcomeEmail: false,
        }),
        201,
      ),
    );
    expect(quiet.invitation).toEqual({ status: 'NOT_SENT', sentAt: null, expiresAt: null });
    expect(sent).not.toContain(newEmail('quiet'));

    const failed = CreateStaffResponse.parse(
      ok(
        await call('post', '/staff', adminA, {
          idempotencyKey: randomUUID(),
          account: account('mail-fails'),
        }),
        201,
      ),
    );
    expect(failed.invitation.status).toBe('FAILED');
    expect(failed.staff.status).toBe('INVITED');
    // Kept, never a second member: Resend is the way on.
    expect(await membersWith(FAILING)).toBe(1);
  });

  it('refuses an email someone here already has', async () => {
    for (const email of [staffA.email, invitedA.email.toUpperCase(), gonerA.email])
      expectError(
        await call('post', '/staff', ownerA, {
          idempotencyKey: randomUUID(),
          account: account('dupe', { email }),
        }),
        409,
        'DUPLICATE_EMAIL',
      );
  });

  it('refuses a role the actor cannot give, and anyone but an Owner or Admin', async () => {
    expectError(
      await call('post', '/staff', adminA, {
        idempotencyKey: randomUUID(),
        account: account('admin', { role: 'ADMIN' }),
      }),
      403,
      'CANNOT_GRANT',
    );
    for (const who of [staffA, managerA])
      expectError(
        await call('post', '/staff', who, {
          idempotencyKey: randomUUID(),
          account: account('nope'),
        }),
        403,
        'FORBIDDEN',
      );
  });

  it('checks the departments, teams and grid before anyone is invited', async () => {
    const cases = [
      [account('inactive', { departmentIds: [dept.old] }), {}, 409, 'GROUP_INACTIVE'],
      [account('other-firm', { departmentIds: [dept.otherFirm] }), {}, 404, 'NOT_FOUND'],
      [
        account('same-team'),
        { details: { primaryTeamId: team.evening, backupTeamId: team.evening } },
        400,
        'VALIDATION_FAILED',
      ],
      [
        account('no-view'),
        {
          permissions: [{ module: 'CLIENTS', capability: 'VIEW', granted: false }],
        },
        400,
        'PERMISSION_NEEDS_VIEW',
      ],
    ] as const;
    for (const [acc, extra, status, code] of cases) {
      expectError(
        await call('post', '/staff', ownerA, {
          idempotencyKey: randomUUID(),
          account: acc,
          ...extra,
        }),
        status,
        code,
      );
      expect(await membersWith(acc.email)).toBe(0);
    }
  });
});

describe('Edit Staff', () => {
  it('saves the changed groups with the version, and refuses a stale version', async () => {
    const before = StaffDetail.parse(ok(await call('get', `/staff/${member.staffA}`, ownerA)));
    const saved = StaffDetail.parse(
      ok(
        await call('patch', `/staff/${member.staffA}`, ownerA, {
          version: before.version,
          account: {
            jobTitle: 'Senior Preparer',
            departmentIds: [dept.books],
            firstName: before.firstName,
          },
          details: {
            office: `North ${run}`,
            primaryTeamId: team.morning,
            acceptsNewClients: false,
          },
          notifyMember: true,
        }),
      ),
    );
    expect(saved).toMatchObject({
      jobTitle: 'Senior Preparer',
      departments: [{ id: dept.books }],
      profile: {
        office: `North ${run}`,
        primaryTeam: { id: team.morning },
        acceptsNewClients: false,
      },
    });
    expect(saved.version).not.toBe(before.version);
    expectError(
      await call('patch', `/staff/${member.staffA}`, ownerA, {
        version: before.version,
        account: { jobTitle: 'Late' },
      }),
      409,
      'SAVE_CONFLICT',
    );
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, entityId: member.staffA, action: 'staff.updated' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit.metadata).toMatchObject({ notifyMember: true });
    expect(JSON.stringify(audit.metadata)).not.toContain('North');
  });

  it("refuses a change of the person's name or email, and roles the actor cannot give", async () => {
    const v = async () =>
      StaffDetail.parse(ok(await call('get', `/staff/${member.staffA}`, ownerA))).version;
    expectError(
      await call('patch', `/staff/${member.staffA}`, ownerA, {
        version: await v(),
        account: { lastName: 'Renamed' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/staff/${member.staffA}`, ownerA, {
        version: await v(),
        account: { email: newEmail('moved') },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/staff/${member.staffA}`, adminA, {
        version: await v(),
        account: { role: 'ADMIN' },
      }),
      403,
      'CANNOT_GRANT',
    );
    const moved = StaffDetail.parse(
      ok(
        await call('patch', `/staff/${member.staffA}`, ownerA, {
          version: await v(),
          account: { role: 'TAX_PREPARER' },
        }),
      ),
    );
    expect(moved.role).toBe('TAX_PREPARER');
    ok(
      await call('patch', `/staff/${member.staffA}`, ownerA, {
        version: moved.version,
        account: { role: 'STAFF' },
      }),
    );
  });

  it('never changes yourself, and an Admin never changes another Admin', async () => {
    const own = StaffDetail.parse(ok(await call('get', `/staff/${member.adminA}`, adminA)));
    expectError(
      await call('patch', `/staff/${member.adminA}`, adminA, {
        version: own.version,
        account: { jobTitle: 'Boss' },
      }),
      409,
      'CANNOT_CHANGE_SELF',
    );
    const other = StaffDetail.parse(ok(await call('get', `/staff/${member.admin2A}`, adminA)));
    expectError(
      await call('patch', `/staff/${member.admin2A}`, adminA, {
        version: other.version,
        account: { jobTitle: 'Boss' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('account actions', () => {
  const action = (path: string, who: Who, body?: object) =>
    call('post', path, who, body).then((r) => StaffActionResult.parse(ok(r)));

  it('locks with a reason and signs the sessions out, then unlocks', async () => {
    expectError(
      await call('post', `/staff/${member.staffA}/lock`, ownerA, { confirm: true }),
      400,
      'VALIDATION_FAILED',
    );
    const locked = await action(`/staff/${member.staffA}/lock`, ownerA, {
      reason: 'Suspicious sign-ins',
      confirm: true,
    });
    expect(locked).toMatchObject({ status: 'LOCKED', sessionsRevoked: 1 });
    // Not ACTIVE: the tenant guard no longer finds them in the firm.
    expectError(await call('get', '/staff/summary', staffA), 404, 'NOT_FOUND');
    const settings = await inFirm('a', (tx) =>
      tx.staffSecuritySettings.findUniqueOrThrow({
        where: { businessId_membershipId: { businessId: firms.a, membershipId: member.staffA } },
      }),
    );
    expect(settings.lockedReason).toBe('Suspicious sign-ins');
    expect((await action(`/staff/${member.staffA}/unlock`, adminA)).status).toBe('ACTIVE');
    // Harmless to repeat; a deactivated member is not unlocked.
    expect((await action(`/staff/${member.staffA}/unlock`, adminA)).status).toBe('ACTIVE');
    expectError(await call('post', `/staff/${member.neverA}/unlock`, adminA), 409, 'NOT_LOCKED');
  });

  it('deactivates (harmless to repeat) and reactivates someone who had joined', async () => {
    const off = await action(`/staff/${member.lockedA}/deactivate`, adminA, {
      reason: 'Left the firm',
      confirm: true,
    });
    expect(off).toMatchObject({ status: 'DEACTIVATED', sessionsRevoked: 1 });
    expect(
      (await action(`/staff/${member.lockedA}/deactivate`, adminA, { confirm: true })).status,
    ).toBe('DEACTIVATED');
    expect((await action(`/staff/${member.gonerA}/reactivate`, adminA)).status).toBe('ACTIVE');
  });

  it('invites someone who never joined again when reactivated', async () => {
    const back = await action(`/staff/${member.neverA}/reactivate`, ownerA);
    expect(back.status).toBe('INVITED');
    expect(back.invitation?.status).toBe('SENT');
    expect(sent).toContain(neverA.email);
  });

  it('resends and revokes an invite', async () => {
    const again = await action(`/staff/${member.invitedA}/invite/resend`, adminA);
    expect(again).toMatchObject({ status: 'INVITED', invitation: { status: 'SENT' } });
    expect((await action(`/staff/${member.invitedA}/invite/revoke`, adminA)).status).toBe(
      'DEACTIVATED',
    );
    const open = await inFirm('a', (tx) =>
      tx.invite.count({
        where: { businessId: firms.a, membershipId: member.invitedA, revokedAt: null },
      }),
    );
    expect(open).toBe(0);
    expectError(
      await call('post', `/staff/${member.invitedA}/invite/revoke`, adminA),
      409,
      'NOT_INVITED',
    );
  });

  it('never acts on yourself or above your role', async () => {
    expectError(
      await call('post', `/staff/${member.adminA}/lock`, adminA, { reason: 'x', confirm: true }),
      409,
      'CANNOT_CHANGE_SELF',
    );
    expectError(
      await call('post', `/staff/${member.ownerA}/deactivate`, adminA, { confirm: true }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/staff/${member.managerA}/lock`, staffA, { reason: 'x', confirm: true }),
      403,
      'FORBIDDEN',
    );
  });
});

describe("a member's permissions", () => {
  it('reads the grid with where each cell comes from', async () => {
    const grid = StaffPermissions.parse(
      ok(await call('get', `/staff/${member.managerA}/permissions`, ownerA)),
    );
    expect(grid.role).toBe('MANAGER');
    expect(grid.cells).toHaveLength(24 * 7);
    expect(grid.cells.every((c) => c.source === 'ROLE_DEFAULT')).toBe(true);
  });

  it('takes a module away, and the roles guard applies it at once', async () => {
    ok(await call('get', '/clients', staffA));
    const saved = StaffPermissions.parse(
      ok(
        await call('put', `/staff/${member.staffA}/permissions`, ownerA, {
          grants: ['VIEW', 'CREATE', 'EDIT'].map((capability) => ({
            module: 'CLIENTS',
            capability,
            granted: false,
          })),
        }),
      ),
    );
    const clients = saved.cells.filter((c) => c.module === 'CLIENTS' && c.capability === 'VIEW');
    expect(clients).toEqual([expect.objectContaining({ granted: false, source: 'MEMBER' })]);
    expectError(await call('get', '/clients', staffA), 403, 'FORBIDDEN');
    // Back to the role's: the rows go, and so does the refusal.
    ok(
      await call('put', `/staff/${member.staffA}/permissions`, ownerA, {
        grants: ['VIEW', 'CREATE', 'EDIT'].map((capability) => ({
          module: 'CLIENTS',
          capability,
          granted: true,
        })),
      }),
    );
    ok(await call('get', '/clients', staffA));
  });

  it('asks before giving more than the role, and refuses a capability without View', async () => {
    const more = { grants: [{ module: 'REPORTS', capability: 'VIEW', granted: true }] };
    expectError(
      await call('put', `/staff/${member.staffA}/permissions`, ownerA, more),
      409,
      'PERMISSION_ESCALATION',
    );
    ok(
      await call('put', `/staff/${member.staffA}/permissions`, ownerA, {
        ...more,
        acknowledgeEscalation: true,
      }),
    );
    expectError(
      await call('put', `/staff/${member.staffA}/permissions`, ownerA, {
        grants: [{ module: 'PAYROLL', capability: 'EDIT', granted: true }],
        acknowledgeEscalation: true,
      }),
      400,
      'PERMISSION_NEEDS_VIEW',
    );
  });

  it('sets Inherit, Allow or Deny per cell; an Allow the role already gives stays theirs', async () => {
    const patch = (overrides: object[], extra: object = {}) =>
      call('patch', `/staff/${member.staffA}/permissions`, ownerA, { overrides, ...extra });
    const cellOf = (p: StaffPermissions, module: string, capability: string) =>
      p.cells.find((c) => c.module === module && c.capability === capability);
    // Clients View is the Staff role's: an Allow keeps it as the person's own.
    const kept = StaffPermissions.parse(
      ok(await patch([{ module: 'CLIENTS', capability: 'VIEW', mode: 'ALLOW' }])),
    );
    expect(cellOf(kept, 'CLIENTS', 'VIEW')).toMatchObject({ granted: true, source: 'MEMBER' });
    // Deny takes it away for this person, and the guard applies it at once.
    const clients = ['VIEW', 'CREATE', 'EDIT'].map((capability) => ({
      module: 'CLIENTS',
      capability,
    }));
    ok(await patch(clients.map((c) => ({ ...c, mode: 'DENY' }))));
    expectError(await call('get', '/clients', staffA), 403, 'FORBIDDEN');
    // Inherit (Reset to Inherit) gives the cells back to the role.
    const back = StaffPermissions.parse(
      ok(await patch(clients.map((c) => ({ ...c, mode: 'INHERIT' })))),
    );
    expect(cellOf(back, 'CLIENTS', 'VIEW')).toMatchObject({
      granted: true,
      source: 'ROLE_DEFAULT',
    });
    ok(await call('get', '/clients', staffA));
    const row = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'staff.permissions_overridden', entityId: member.staffA },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(row.metadata).toMatchObject({ changedCells: 3, inherited: 3, allowed: 0, denied: 0 });
  });

  it('asks before an Allow beyond the role, needs View first, never the Owner', async () => {
    const grid = StaffPermissions.parse(
      ok(await call('get', `/staff/${member.staffA}/permissions`, ownerA)),
    );
    const extra = grid.cells.find(
      (c) => c.capability === 'VIEW' && !c.granted && c.source === 'ROLE_DEFAULT',
    )!;
    const allow = { overrides: [{ module: extra.module, capability: 'VIEW', mode: 'ALLOW' }] };
    const patch = (who: Who, id: string, body: object) =>
      call('patch', `/staff/${id}/permissions`, who, body);
    expectError(await patch(ownerA, member.staffA, allow), 409, 'PERMISSION_ESCALATION');
    ok(await patch(ownerA, member.staffA, { ...allow, acknowledgeEscalation: true }));
    ok(
      await patch(ownerA, member.staffA, {
        overrides: [{ module: extra.module, capability: 'VIEW', mode: 'INHERIT' }],
      }),
    );
    expectError(
      await patch(ownerA, member.staffA, {
        overrides: [{ module: extra.module, capability: 'EDIT', mode: 'ALLOW' }],
        acknowledgeEscalation: true,
      }),
      400,
      'PERMISSION_NEEDS_VIEW',
    );
    // Saved data elsewhere (a capability without View, in a module the role does not see) does
    // not block a change to another module.
    await inFirm('a', (tx) =>
      tx.memberPermission.create({
        data: {
          businessId: firms.a,
          membershipId: member.staffA,
          module: extra.module,
          capability: 'CREATE',
          granted: true,
        },
      }),
    );
    ok(
      await patch(ownerA, member.staffA, {
        overrides: [{ module: 'TASKS', capability: 'DELETE', mode: 'DENY' }],
      }),
    );
    ok(
      await patch(ownerA, member.staffA, {
        overrides: [
          { module: 'TASKS', capability: 'DELETE', mode: 'INHERIT' },
          { module: extra.module, capability: 'CREATE', mode: 'INHERIT' },
        ],
      }),
    );
    // An Admin never manages the Owner (refused before the Owner's own guard is reached).
    expectError(await patch(adminA, member.ownerA, allow), 403, 'FORBIDDEN');
    expectError(await patch(staffA, member.managerA, allow), 403, 'FORBIDDEN');
    expectError(
      await patch(ownerA, member.staffA, { overrides: [allow.overrides[0], allow.overrides[0]] }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("copies another member's grid", async () => {
    const copied = StaffPermissions.parse(
      ok(
        await call(
          'post',
          `/staff/${member.gonerA}/permissions/copy-from/${member.managerA}`,
          ownerA,
        ),
      ),
    );
    const manager = StaffPermissions.parse(
      ok(await call('get', `/staff/${member.managerA}/permissions`, ownerA)),
    );
    const granted = (p: StaffPermissions) =>
      p.cells.filter((c) => c.granted).map((c) => `${c.module}:${c.capability}`);
    expect(granted(copied)).toEqual(granted(manager));
  });
});

describe('notes and pay', () => {
  it('keeps the note for Owners and Admins only', async () => {
    const saved = ok(
      await call('put', `/staff/${member.managerA}/notes`, adminA, { text: 'Covers evenings' }),
    ) as { note: { text: string; updatedBy: string } };
    expect(saved.note).toMatchObject({ text: 'Covers evenings', updatedBy: 'Fake R55w adminA' });
    expect(ok(await call('get', `/staff/${member.managerA}/notes`, ownerA))).toMatchObject({
      note: { text: 'Covers evenings' },
    });
    expectError(await call('get', `/staff/${member.managerA}/notes`, staffA), 403, 'FORBIDDEN');
    const cleared = ok(await call('put', `/staff/${member.managerA}/notes`, adminA, { text: '' }));
    expect(cleared).toEqual({ note: null });
  });

  it('shows pay to the Owner, and to an Admin only for the roles they manage', async () => {
    ok(
      await call('put', `/staff/${member.managerA}/compensation`, adminA, {
        payType: 'SALARY',
        rateCents: 6_500_000,
        payFrequency: 'MONTHLY',
        payrollId: 'P-1',
      }),
    );
    expect(
      StaffCompensation.parse(
        ok(await call('get', `/staff/${member.managerA}/compensation`, ownerA)),
      ),
    ).toMatchObject({ payType: 'SALARY', rateCents: 6_500_000, payrollId: 'P-1' });
    expectError(
      await call('get', `/staff/${member.admin2A}/compensation`, adminA),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('get', `/staff/${member.managerA}/compensation`, staffA),
      403,
      'FORBIDDEN',
    );
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: {
          businessId: firms.a,
          entityId: member.managerA,
          action: 'staff.compensation_saved',
        },
      }),
    );
    expect(JSON.stringify(audit.metadata)).not.toContain('6500000');
  });
});

describe('drafts', () => {
  it('creates, lists, saves again and deletes a draft', async () => {
    const draft = StaffDraft.parse(
      ok(
        await call('post', '/staff-drafts', adminA, {
          step: 1,
          data: { account: { firstName: 'Fake', email: newEmail('draft') } },
        }),
        201,
      ),
    );
    expect(draft).toMatchObject({ step: 1, createdBy: 'Fake R55w adminA' });
    const list = ok(await call('get', '/staff-drafts', ownerA)) as { items: StaffDraft[] };
    expect(list.items.map((d) => d.id)).toContain(draft.id);
    const saved = StaffDraft.parse(
      ok(await call('put', `/staff-drafts/${draft.id}`, ownerA, { step: 3, data: {} })),
    );
    expect(saved.step).toBe(3);
    expectError(
      await call('post', '/staff-drafts', ownerA, { step: 1, data: { compensation: {} } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', '/staff-drafts', staffA), 403, 'FORBIDDEN');
    expect(ok(await call('delete', `/staff-drafts/${draft.id}`, ownerA))).toEqual({ ok: true });
    expectError(await call('get', `/staff-drafts/${draft.id}`, ownerA), 404, 'NOT_FOUND');
  });
});

describe('firm B', () => {
  it("reaches none of firm A's members or drafts", async () => {
    const draft = StaffDraft.parse(
      ok(await call('post', '/staff-drafts', ownerA, { step: 1, data: {} }), 201),
    );
    for (const [method, path, body] of [
      ['patch', `/staff/${member.managerA}`, { version: 'x', account: { jobTitle: 'X' } }],
      ['post', `/staff/${member.managerA}/lock`, { reason: 'x', confirm: true }],
      ['post', `/staff/${member.gonerA}/reactivate`, undefined],
      ['put', `/staff/${member.managerA}/permissions`, { grants: [] }],
      ['post', `/staff/${member.managerA}/permissions/copy-from/${member.staffA}`, undefined],
      ['get', `/staff/${member.managerA}/notes`, undefined],
      ['get', `/staff/${member.managerA}/compensation`, undefined],
      ['get', `/staff-drafts/${draft.id}`, undefined],
      ['delete', `/staff-drafts/${draft.id}`, undefined],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
  });
});
