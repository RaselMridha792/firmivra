// R60's Edit Team Member (Oct 20): the CEO (admin scope) saves a team member's name and phone on
// their login (users_admin_team_update). Only org-chart logins, only name and phone; a TEAM_MEMBER
// admin, an admin row with no member row and firm logins stay closed.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8).toUpperCase();
const ids = {
  ceo: randomUUID(),
  member: randomUUID(),
  unlinked: randomUUID(),
  firmOwner: randomUUID(),
};

const asAdmin = <T>(adminUserId: string, fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const login = (id: string) =>
  runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.findUniqueOrThrow({ where: { id }, select: { name: true, phone: true, email: true } }),
  );
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.ceo, 'ADMIN'],
      [ids.member, 'ADMIN'],
      [ids.unlinked, 'ADMIN'],
      [ids.firmOwner, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@team.test`, name: 'Fake Person' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.member, role: 'TEAM_MEMBER' } });
    await tx.platformAdmin.create({ data: { userId: ids.unlinked, role: 'TEAM_MEMBER' } });

    const dept = await tx.platformDepartment.create({
      data: { code: `ATP_DEPT_${run}`, name: 'Test Department' },
    });
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `ATP_CEO_${run}`,
        title: 'Test CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    const icRole = await tx.platformRoleDefinition.create({
      data: {
        code: `ATP_IC_${run}`,
        title: 'Test IC',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.ceo,
        roleDefinitionId: ceoRole.id,
        departmentId: dept.id,
        scopeType: 'COMPANY',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.member,
        roleDefinitionId: icRole.id,
        departmentId: dept.id,
        reportsToUserId: ids.ceo,
        scopeType: 'OWN_RECORDS',
      },
    });

    // A firm owner: admin scope reads this login (users_admin_owners) but never changes it.
    const firm = await tx.business.create({
      data: { slug: `atp-${run.toLowerCase()}`, name: 'Fake Firm' },
    });
    await tx.membership.create({
      data: { businessId: firm.id, userId: ids.firmOwner, role: 'OWNER', status: 'ACTIVE' },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

describe('users_admin_team_update: the CEO edits a team member’s name and phone', () => {
  it('saves a changed name and phone, and the change is read back', async () => {
    const saved = await asAdmin(ids.ceo, (tx) =>
      tx.user.update({
        where: { id: ids.member },
        data: { name: 'Fake Renamed', phone: '+15555550142' },
        select: { name: true, phone: true },
      }),
    );
    expect(saved).toEqual({ name: 'Fake Renamed', phone: '+15555550142' });
    expect(await login(ids.member)).toMatchObject({ name: 'Fake Renamed', phone: '+15555550142' });
    // Clearing the phone is a change too.
    await asAdmin(ids.ceo, (tx) =>
      tx.user.update({ where: { id: ids.member }, data: { phone: null } }),
    );
    expect((await login(ids.member)).phone).toBeNull();
  });

  it('the CEO can edit their own login the same way', async () => {
    await asAdmin(ids.ceo, (tx) =>
      tx.user.update({ where: { id: ids.ceo }, data: { name: 'Fake Chief' } }),
    );
    expect((await login(ids.ceo)).name).toBe('Fake Chief');
  });

  it('still refuses identity columns in admin scope (email, cognito_sub, pool)', async () => {
    for (const data of [
      { email: `other-${run}@team.test` },
      { cognitoSub: randomUUID() },
      { pool: 'STAFF' as const },
    ]) {
      expect(
        await outcome(
          asAdmin(ids.ceo, (tx) => tx.user.update({ where: { id: ids.member }, data })),
        ),
      ).not.toBe('ok');
    }
    expect((await login(ids.member)).email).toBe(`${ids.member}@team.test`);
  });
});

describe('everyone else stays closed', () => {
  const rename = (actor: string, target: string) =>
    asAdmin(actor, (tx) =>
      tx.user.updateMany({ where: { id: target }, data: { name: 'Fake Intruder' } }),
    );

  it('an admin row with no org-chart row, and a firm owner’s login, are not changed', async () => {
    expect(await rename(ids.ceo, ids.unlinked)).toEqual({ count: 0 });
    expect(await rename(ids.ceo, ids.firmOwner)).toEqual({ count: 0 });
    expect((await login(ids.unlinked)).name).toBe('Fake Person');
    expect((await login(ids.firmOwner)).name).toBe('Fake Person');
  });

  it('a TEAM_MEMBER admin cannot change anyone’s login, not even their own, in admin scope', async () => {
    expect(await rename(ids.member, ids.ceo)).toEqual({ count: 0 });
    expect(await rename(ids.member, ids.member)).toEqual({ count: 0 });
    expect((await login(ids.ceo)).name).not.toBe('Fake Intruder');
  });
});
