// The prod bootstrap one-off (Rasel, Oct 24; docs/work/R1-prod-morning.md, section 4): refuses
// outside prod and without the confirmation, makes the first Super Admin (CEO-mapped) and LVP with
// its Owner, writes the audit rows, stores no email from the task input, changes nothing when run
// again, and refuses a second Super Admin unless asked to add one. Runs against its own test
// database: it reads every Super Admin in the database, and other files make their own.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapProd,
  parseProdBootstrapEnv,
  type LookupProdUser,
} from '../src/bootstrap-prod.js';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';

let owner: ReturnType<typeof createPrismaClient>;

const adminSub = randomUUID();
const ownerSub = randomUUID();
const secondAdminSub = randomUUID();
// What Cognito holds for each sub (synthetic). The task input never carries these.
const cognito: Record<string, { email: string; name: string }> = {
  [adminSub]: { email: 'First.Admin@prod-bootstrap.test', name: 'First Admin (fake)' },
  [ownerSub]: { email: 'owner@prod-bootstrap.test', name: 'Firm Owner (fake)' },
  [secondAdminSub]: { email: 'second.admin@prod-bootstrap.test', name: 'Second Admin (fake)' },
};
const lookups: string[] = [];
const lookup: LookupProdUser = async (pool, sub) => {
  lookups.push(`${pool}:${sub}`);
  return cognito[sub] ?? {};
};

const env = (extra: Record<string, string | undefined> = {}) => ({
  APP_ENV: 'prod',
  CONFIRM_PROD_BOOTSTRAP: 'yes',
  SUPER_ADMIN_SUB: adminSub,
  OWNER_SUB: ownerSub,
  FIRM_LEGAL_NAME: 'Fake Legal Name LLC',
  ...extra,
});

const counts = () =>
  runInScope(owner, { kind: 'platform' }, async (tx) => ({
    users: await tx.user.count(),
    admins: await tx.platformAdmin.count(),
    members: await tx.platformMember.count(),
    businesses: await tx.business.count(),
    audit: await tx.auditLog.count(),
  }));

beforeAll(async () => {
  const urls = await prepareTestDatabase('prod_bootstrap');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, 300_000);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('the task settings', () => {
  it('refuses outside prod and without CONFIRM_PROD_BOOTSTRAP=yes', () => {
    for (const appEnv of [undefined, 'dev', 'PROD', 'production']) {
      expect(() => parseProdBootstrapEnv(env({ APP_ENV: appEnv }))).toThrow(/APP_ENV=prod/);
    }
    for (const confirm of [undefined, 'true', 'YES', 'y']) {
      expect(() => parseProdBootstrapEnv(env({ CONFIRM_PROD_BOOTSTRAP: confirm }))).toThrow(
        /CONFIRM_PROD_BOOTSTRAP=yes/,
      );
    }
  });

  it('takes subs and the legal name only: no email, no unknown setting', () => {
    expect(parseProdBootstrapEnv(env())).toEqual({
      superAdminSub: adminSub,
      addSuperAdmin: false,
      firm: { legalName: 'Fake Legal Name LLC', name: 'Fake Legal Name LLC', ownerSub },
    });
    expect(parseProdBootstrapEnv(env({ FIRM_NAME: 'Fake Display' })).firm?.name).toBe(
      'Fake Display',
    );
    expect(() => parseProdBootstrapEnv(env({ SUPER_ADMIN_SUB: 'admin@example.test' }))).toThrow(
      /SUPER_ADMIN_SUB must be a Cognito sub/,
    );
    expect(() => parseProdBootstrapEnv(env({ FIRM_LEGAL_NAME: 'owner@example.test' }))).toThrow(
      /no email address/,
    );
    expect(() => parseProdBootstrapEnv(env({ FIRM_LEGAL_NAME: ' ' }))).toThrow(/1 to 200/);
    expect(() => parseProdBootstrapEnv(env({ BOOTSTRAP_OWNER_EMAIL: 'x' }))).toThrow(
      /does not take BOOTSTRAP_OWNER_EMAIL/,
    );
    expect(() => parseProdBootstrapEnv(env({ OWNER_SUB: adminSub }))).toThrow(/one user/);
    // Adding a Super Admin takes that sub only.
    expect(() => parseProdBootstrapEnv(env({ ADD_SUPER_ADMIN: 'yes' }))).toThrow(
      /leave the firm settings out/,
    );
    expect(
      parseProdBootstrapEnv({
        APP_ENV: 'prod',
        CONFIRM_PROD_BOOTSTRAP: 'yes',
        ADD_SUPER_ADMIN: 'yes',
        SUPER_ADMIN_SUB: secondAdminSub,
      }),
    ).toEqual({ superAdminSub: secondAdminSub, addSuperAdmin: true });
  });
});

describe('bootstrapProd', () => {
  it('makes the Super Admin (CEO-mapped) and LVP with its Owner, with audit rows', async () => {
    const result = await bootstrapProd(owner, parseProdBootstrapEnv(env()), lookup);
    expect(result.superAdmin.created).toBe(true);
    expect(result.firm?.businessCreated).toBe(true);
    expect(result.firm?.owner.created).toBe(true);
    expect(lookups).toEqual([`ADMIN:${adminSub}`, `STAFF:${ownerSub}`]);

    const rows = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
      admin: await tx.user.findUniqueOrThrow({
        where: { cognitoSub: adminSub },
        include: { platformAdmin: true },
      }),
      owner: await tx.user.findUniqueOrThrow({ where: { cognitoSub: ownerSub } }),
      firm: await tx.business.findUniqueOrThrow({ where: { slug: 'lvp' } }),
      member: await tx.platformMember.findUnique({
        where: { userId: result.superAdmin.userId },
        include: { roleDefinition: { select: { code: true } } },
      }),
      plans: await tx.platformPlan.count(),
    }));
    expect(rows.admin).toMatchObject({
      pool: 'ADMIN',
      email: 'first.admin@prod-bootstrap.test',
      name: 'First Admin (fake)',
      platformAdmin: { role: 'SUPER_ADMIN' },
    });
    expect(rows.owner).toMatchObject({ pool: 'STAFF', email: 'owner@prod-bootstrap.test' });
    expect(rows.firm).toMatchObject({
      name: 'Fake Legal Name LLC',
      legalName: 'Fake Legal Name LLC',
      status: 'ACTIVE',
    });
    expect(rows.member?.roleDefinition.code).toBe('EXECUTIVE_CEO');
    expect(rows.plans).toBeGreaterThan(0);

    const businessId = rows.firm.id;
    const firmRows = await runInScope(owner, { kind: 'business', businessId }, async (tx) => ({
      settings: await tx.businessSettings.count({ where: { businessId } }),
      memberships: await tx.membership.findMany({ where: { businessId } }),
    }));
    expect(firmRows.settings).toBe(1);
    expect(firmRows.memberships).toMatchObject([
      { userId: rows.owner.id, role: 'OWNER', status: 'ACTIVE' },
    ]);

    const audit = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'business.bootstrapped',
      'membership.bootstrapped',
      'platform_admin.bootstrapped',
      'platform_member.mapped_to_ceo',
    ]);
    expect(audit.find((a) => a.action === 'platform_member.mapped_to_ceo')?.metadata).toMatchObject(
      { from: 'prod-bootstrap' },
    );
    // Ids only: no email anywhere in the audit rows.
    expect(JSON.stringify(audit)).not.toMatch(/@/);
  });

  it('changes nothing when run again with the same input', async () => {
    const before = await counts();
    const again = await bootstrapProd(owner, parseProdBootstrapEnv(env()), lookup);
    expect(again.superAdmin.created).toBe(false);
    expect(again.firm?.businessCreated).toBe(false);
    expect(again.firm?.owner.created).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it('refuses another Super Admin, unless asked to add one, and then adds only that one', async () => {
    const before = await counts();
    await expect(
      bootstrapProd(owner, parseProdBootstrapEnv(env({ SUPER_ADMIN_SUB: secondAdminSub })), lookup),
    ).rejects.toThrow(/A Super Admin already exists/);
    expect(await counts()).toEqual(before);

    const added = await bootstrapProd(
      owner,
      parseProdBootstrapEnv({
        APP_ENV: 'prod',
        CONFIRM_PROD_BOOTSTRAP: 'yes',
        ADD_SUPER_ADMIN: 'yes',
        SUPER_ADMIN_SUB: secondAdminSub,
      }),
      lookup,
    );
    expect(added).toEqual({ superAdmin: { userId: expect.any(String), created: true } });
    const after = await counts();
    expect(after).toEqual({
      ...before,
      users: before.users + 1,
      admins: before.admins + 1,
      members: before.members + 1,
      // platform_admin.bootstrapped and platform_member.mapped_to_ceo
      audit: before.audit + 2,
    });
  });

  it('refuses a sub that belongs to the other pool', async () => {
    const staffAsAdmin = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.platformAdmin.count({ where: { user: { cognitoSub: ownerSub } } }),
    );
    expect(staffAsAdmin).toBe(0);
    await expect(
      bootstrapProd(
        owner,
        parseProdBootstrapEnv({
          APP_ENV: 'prod',
          CONFIRM_PROD_BOOTSTRAP: 'yes',
          ADD_SUPER_ADMIN: 'yes',
          SUPER_ADMIN_SUB: ownerSub,
        }),
        lookup,
      ),
    ).rejects.toThrow(/is in pool STAFF, not ADMIN/);
  });
});
