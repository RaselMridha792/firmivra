// R35: departments, teams and who is in them. Each firm sees only its own, links cannot point at
// another firm, names and places are unique where the screens need it, and nothing joins an
// inactive group. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', memberA: '', member2A: '', memberB: '', deptB: '' };
const firmA = () => db.forBusiness(ids.firmA);
const firmB = () => db.forBusiness(ids.firmB);
const dept = (name: string, extra: Record<string, unknown> = {}) =>
  firmA().department.create({ data: { businessId: ids.firmA, name, ...extra } });
const team = (departmentId: string, name: string, extra: Record<string, unknown> = {}) =>
  firmA().team.create({ data: { businessId: ids.firmA, departmentId, name, ...extra } });

beforeAll(async () => {
  const users = [randomUUID(), randomUUID(), randomUUID()];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of users) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ga-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `gb-${run}`, name: 'B' } })).id;
  });
  const member = (tx: Parameters<Parameters<typeof runInScope>[2]>[0], b: string, u: string) =>
    tx.membership
      .create({ data: { businessId: b, userId: u, role: 'MANAGER', status: 'ACTIVE' } })
      .then((m) => m.id);
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.memberA = await member(tx, ids.firmA, users[0]!);
    ids.member2A = await member(tx, ids.firmA, users[1]!);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.memberB = await member(tx, ids.firmB, users[2]!);
    ids.deptB = (await tx.department.create({ data: { businessId: ids.firmB, name: 'Tax' } })).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('staff groups: isolation', () => {
  it("a firm cannot see or change another firm's departments", async () => {
    await dept('Tax');
    expect(await firmA().department.findMany()).toHaveLength(1);
    expect(await firmB().department.findMany()).toHaveLength(1);
    expect(await firmA().department.findUnique({ where: { id: ids.deptB } })).toBeNull();
    const { count } = await firmA().department.updateMany({
      where: { id: ids.deptB },
      data: { name: 'Hacked' },
    });
    expect(count).toBe(0);
  });

  it('refuses a row written for another firm', async () => {
    await expect(
      firmA().department.create({ data: { businessId: ids.firmB, name: 'Sneaky' } }),
    ).rejects.toThrow();
  });

  it('refuses links that point at another firm', async () => {
    await expect(dept('Bad head', { headMembershipId: ids.memberB })).rejects.toThrow();
    await expect(team(ids.deptB, 'Bad department')).rejects.toThrow();
    const ok = await dept('Links');
    await expect(team(ok.id, 'Bad lead', { leadMembershipId: ids.memberB })).rejects.toThrow();
  });
});

describe('staff groups: rules', () => {
  it('keeps names unique per firm, ignoring case, until archived', async () => {
    const d = await dept('Payroll');
    await expect(dept(' payroll ')).rejects.toThrow();
    await firmA().department.update({ where: { id: d.id }, data: { status: 'ARCHIVED' } });
    await expect(dept('PAYROLL')).resolves.toBeTruthy();
    // The same name is fine in another firm.
    await expect(
      firmB().department.create({ data: { businessId: ids.firmB, name: 'Payroll' } }),
    ).resolves.toBeTruthy();
  });

  it('refuses blank, long and multi-line names', async () => {
    await expect(dept('   ')).rejects.toThrow();
    await expect(dept('x'.repeat(81))).rejects.toThrow();
    await expect(dept('two\nlines')).rejects.toThrow();
    await expect(dept('Fine', { description: 'x'.repeat(501) })).rejects.toThrow();
  });

  it('puts teams only in ACTIVE departments', async () => {
    const d = await dept('Marketing');
    await firmA().department.update({ where: { id: d.id }, data: { status: 'INACTIVE' } });
    await expect(team(d.id, 'Social')).rejects.toThrow(/ACTIVE department/);
  });

  it('lets a member join only active teams, with one primary and one backup', async () => {
    const d = await dept('Bookkeeping');
    const t1 = await team(d.id, 'Books 1');
    const t2 = await team(d.id, 'Books 2');
    const t3 = await team(d.id, 'Books 3');
    const join = (teamId: string, kind: 'PRIMARY' | 'BACKUP' | 'MEMBER') =>
      firmA().teamMember.create({
        data: { businessId: ids.firmA, teamId, membershipId: ids.memberA, kind },
      });
    await join(t1.id, 'PRIMARY');
    await expect(join(t2.id, 'PRIMARY')).rejects.toThrow();
    await join(t2.id, 'BACKUP');
    await expect(join(t3.id, 'BACKUP')).rejects.toThrow();
    await expect(join(t3.id, 'MEMBER')).resolves.toBeTruthy();
    await expect(join(t3.id, 'MEMBER')).rejects.toThrow(); // already in
    await firmA().team.update({ where: { id: t3.id }, data: { status: 'INACTIVE' } });
    await expect(
      firmA().teamMember.create({
        data: { businessId: ids.firmA, teamId: t3.id, membershipId: ids.member2A },
      }),
    ).rejects.toThrow(/ACTIVE team/);
  });

  it('does not delete a member who heads a department, and keeps places in deactivated groups', async () => {
    const d = await dept('Admin', { headMembershipId: ids.member2A });
    await expect(
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.membership.delete({ where: { id: ids.member2A } }),
      ),
    ).rejects.toThrow();
    await firmA().memberDepartment.create({
      data: { businessId: ids.firmA, membershipId: ids.memberA, departmentId: d.id },
    });
    await firmA().department.update({ where: { id: d.id }, data: { status: 'INACTIVE' } });
    expect(await firmA().memberDepartment.count({ where: { departmentId: d.id } })).toBe(1);
    await expect(
      firmA().memberDepartment.create({
        data: { businessId: ids.firmA, membershipId: ids.member2A, departmentId: d.id },
      }),
    ).rejects.toThrow(/ACTIVE department/);
  });

  it('never deletes a department or a team', async () => {
    const d = await dept('Keep');
    await expect(firmA().department.delete({ where: { id: d.id } })).rejects.toThrow();
    const t = await team(d.id, 'Keep team');
    await expect(firmA().team.delete({ where: { id: t.id } })).rejects.toThrow();
  });
});
