// R0 stage A (Oct 16): Firmivra's own org chart and the firm-facing plan ladder. platform_admins
// is untouched, so app_is_admin() stays CEO-equivalent only; a TEAM_MEMBER admin row never gets
// admin-scope rights, even once it has an ACTIVE platform_members row (Rasel's change A).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8).toUpperCase();
const ids = {
  ceoAdmin: randomUUID(),
  teamMemberAdmin: randomUUID(),
  unlinkedAdmin: randomUUID(),
  firmA: '',
  firmB: '',
  execDept: '',
  ceoRole: '',
  icRole: '',
};

const asAdmin = <T>(adminUserId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asBusiness = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.ceoAdmin, 'ADMIN'],
      [ids.teamMemberAdmin, 'ADMIN'],
      [ids.unlinkedAdmin, 'ADMIN'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceoAdmin, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.teamMemberAdmin, role: 'TEAM_MEMBER' } });
    // unlinkedAdmin: a platform_admins row with no platform_members row yet (the hierarchy
    // doc's "roles may exist without an occupant", mirrored on the admin side: an admin row may
    // exist with no member row yet).

    const dept = await tx.platformDepartment.create({
      data: { code: `TEST_DEPT_${run}`, name: 'Test Department' },
    });
    ids.execDept = dept.id;
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `TEST_CEO_${run}`,
        title: 'Test CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    ids.ceoRole = ceoRole.id;
    const icRole = await tx.platformRoleDefinition.create({
      data: {
        code: `TEST_IC_${run}`,
        title: 'Test IC',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    ids.icRole = icRole.id;

    const lower = run.toLowerCase();
    ids.firmA = (await tx.business.create({ data: { slug: `pth-a-${lower}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `pth-b-${lower}`, name: 'B' } })).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('the CEO / TEAM_MEMBER correspondence (platform_members_ceo_role_check)', () => {
  it('a SUPER_ADMIN row may only belong to a CEO-level member', async () => {
    expect(
      await outcome(
        asAdmin(ids.ceoAdmin, (tx) =>
          tx.platformMember.create({
            data: {
              userId: ids.ceoAdmin,
              roleDefinitionId: ids.icRole, // not CEO-level
              departmentId: ids.execDept,
              scopeType: 'OWN_RECORDS',
            },
          }),
        ),
      ),
    ).toMatch(/a SUPER_ADMIN admin row may only belong to a CEO-level member/);
  });

  it('a CEO-level member must be a SUPER_ADMIN', async () => {
    expect(
      await outcome(
        asAdmin(ids.ceoAdmin, (tx) =>
          tx.platformMember.create({
            data: {
              userId: ids.teamMemberAdmin, // TEAM_MEMBER, not SUPER_ADMIN
              roleDefinitionId: ids.ceoRole,
              departmentId: ids.execDept,
              scopeType: 'COMPANY',
            },
          }),
        ),
      ),
    ).toMatch(/a CEO-level member must be a SUPER_ADMIN/);
  });

  it('refuses a member row for a non-platform_admins user', async () => {
    // Raw SQL (not Prisma's .create()): the foreign key alone already refuses this from the
    // ORM path, but the trigger is a second, independent wall for any direct SQL too.
    const stranger = randomUUID();
    expect(
      await outcome(
        asAdmin(
          ids.ceoAdmin,
          (tx) => tx.$executeRaw`
          INSERT INTO platform_members (user_id, role_definition_id, department_id, scope_type, updated_at)
          VALUES (${stranger}::uuid, ${ids.icRole}::uuid, ${ids.execDept}::uuid, 'OWN_RECORDS', now())`,
        ),
      ),
    ).toMatch(/is not a platform_admins row|foreign key/i);
  });

  it('the matching combinations succeed: CEO/SUPER_ADMIN and a team member/TEAM_MEMBER', async () => {
    await expect(
      asAdmin(ids.ceoAdmin, (tx) =>
        tx.platformMember.create({
          data: {
            userId: ids.ceoAdmin,
            roleDefinitionId: ids.ceoRole,
            departmentId: ids.execDept,
            scopeType: 'COMPANY',
          },
        }),
      ),
    ).resolves.toMatchObject({ userId: ids.ceoAdmin });
    await expect(
      asAdmin(ids.ceoAdmin, (tx) =>
        tx.platformMember.create({
          data: {
            userId: ids.teamMemberAdmin,
            roleDefinitionId: ids.icRole,
            departmentId: ids.execDept,
            scopeType: 'OWN_RECORDS',
          },
        }),
      ),
    ).resolves.toMatchObject({ userId: ids.teamMemberAdmin });
    // Downgrading the now-CEO member away from CEO-level is refused the same way.
    expect(
      await outcome(
        asAdmin(ids.ceoAdmin, (tx) =>
          tx.platformMember.update({
            where: { userId: ids.ceoAdmin },
            data: { roleDefinitionId: ids.icRole },
          }),
        ),
      ),
    ).toMatch(/a SUPER_ADMIN admin row may only belong to a CEO-level member/);
  });
});

describe('admin-scope rights stay CEO-only (app_is_admin), even once TEAM_MEMBER has a member row', () => {
  it('app_is_admin() is true only for the CEO; app_is_platform_member() is true for both', async () => {
    const read = (adminUserId: string) =>
      asAdmin(
        adminUserId,
        (tx) =>
          tx.$queryRaw<{ is_admin: boolean; is_member: boolean }[]>`
          SELECT app_is_admin() AS is_admin, app_is_platform_member() AS is_member`,
      ).then((r) => r[0]!);
    expect(await read(ids.ceoAdmin)).toEqual({ is_admin: true, is_member: true });
    expect(await read(ids.teamMemberAdmin)).toEqual({ is_admin: false, is_member: true });
    expect(await read(ids.unlinkedAdmin)).toEqual({ is_admin: false, is_member: false });
  });

  it('nothing admin-scope-gated opens up for a TEAM_MEMBER (existing firm_applications policy)', async () => {
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.firmApplication.create({
        data: {
          id: randomUUID(),
          legalName: `Fake LLC ${run}`,
          contactName: 'Fake',
          contactEmail: `fake-${run}@test`,
          data: {},
        },
      }),
    );
    const count = (adminUserId: string) => asAdmin(adminUserId, (tx) => tx.firmApplication.count());
    expect(await count(ids.ceoAdmin)).toBeGreaterThan(0);
    expect(await count(ids.teamMemberAdmin)).toBe(0);
  });
});

describe('the role and department catalog', () => {
  it('is readable by any active member, not by an unlinked admin row', async () => {
    const count = (adminUserId: string) =>
      asAdmin(adminUserId, (tx) => tx.platformRoleDefinition.count());
    expect(await count(ids.ceoAdmin)).toBeGreaterThan(0);
    expect(await count(ids.teamMemberAdmin)).toBeGreaterThan(0);
    expect(await count(ids.unlinkedAdmin)).toBe(0);
  });

  it('is written only by the CEO (app_is_admin)', async () => {
    await expect(
      outcome(
        asAdmin(ids.teamMemberAdmin, (tx) =>
          tx.platformDepartment.create({ data: { code: `NOPE_${run}`, name: 'Nope' } }),
        ),
      ),
    ).resolves.not.toBe('ok');
    await expect(
      asAdmin(ids.ceoAdmin, (tx) =>
        tx.platformDepartment.create({ data: { code: `YES_${run}`, name: 'Yes' } }),
      ),
    ).resolves.toMatchObject({ code: `YES_${run}` });
  });
});

describe('platform_members: the CEO sees everyone, a member sees only their own row', () => {
  it('self-read only, no self-write', async () => {
    const ownRow = await asAdmin(ids.teamMemberAdmin, (tx) => tx.platformMember.findMany());
    expect(ownRow.map((r) => r.userId)).toEqual([ids.teamMemberAdmin]);
    // The CEO's view is not exclusive to this file's fixtures (the test database is shared), so
    // check it is a superset, not an exact match.
    const all = await asAdmin(ids.ceoAdmin, (tx) =>
      tx.platformMember.findMany({
        where: { userId: { in: [ids.ceoAdmin, ids.teamMemberAdmin] } },
      }),
    );
    expect(all.map((r) => r.userId).sort()).toEqual([ids.ceoAdmin, ids.teamMemberAdmin].sort());
    await expect(
      outcome(
        asAdmin(ids.teamMemberAdmin, (tx) =>
          tx.platformMember.update({
            where: { userId: ids.teamMemberAdmin },
            data: { scopeType: 'COMPANY' },
          }),
        ),
      ),
    ).resolves.not.toBe('ok');
  });
});

describe("plans and subscriptions (Rasel's change C)", () => {
  it('a firm reads the plan ladder but cannot write it', async () => {
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformPlan.upsert({
        where: { code: `TEST_PLAN_${run}` },
        update: {},
        create: {
          code: `TEST_PLAN_${run}`,
          name: 'Test Plan',
          basePriceCents: 1000,
          includedSeats: 1,
          displayOrder: 1,
        },
      }),
    );
    const plans = await asBusiness(ids.firmA, (tx) => tx.platformPlan.findMany());
    expect(plans.length).toBeGreaterThan(0);
    const updated = await asBusiness(ids.firmA, (tx) =>
      tx.platformPlan.updateMany({
        where: { code: `TEST_PLAN_${run}` },
        data: { name: 'Hacked' },
      }),
    );
    expect(updated.count).toBe(0);
  });

  it('a firm reads only its own subscription row, never writes it; no row means no limits', async () => {
    const plan = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformPlan.findUniqueOrThrow({ where: { code: `TEST_PLAN_${run}` } }),
    );
    await asAdmin(ids.ceoAdmin, (tx) =>
      tx.platformFirmSubscription.create({
        data: { businessId: ids.firmA, planId: plan.id, seatsIncluded: plan.includedSeats },
      }),
    );
    expect(
      await asBusiness(ids.firmA, (tx) => tx.platformFirmSubscription.findMany()),
    ).toHaveLength(1);
    expect(await asBusiness(ids.firmB, (tx) => tx.platformFirmSubscription.findMany())).toEqual([]);
    const updated = await asBusiness(ids.firmA, (tx) =>
      tx.platformFirmSubscription.updateMany({
        where: { businessId: ids.firmA },
        data: { autoRenew: false },
      }),
    );
    expect(updated.count).toBe(0);
  });
});

describe('scope_ids has no foreign key (stage A, documented)', () => {
  it('accepts an id that names nothing yet', async () => {
    await expect(
      asAdmin(ids.ceoAdmin, (tx) =>
        tx.platformMember.update({
          where: { userId: ids.ceoAdmin },
          data: { scopeIds: [randomUUID()] },
        }),
      ),
    ).resolves.toMatchObject({ userId: ids.ceoAdmin });
  });
});
