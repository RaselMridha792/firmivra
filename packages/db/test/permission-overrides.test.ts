// R35: the firm's permission grid overrides, per role and per member. Each firm sees only its
// own, the Owner's permissions cannot be overridden, and "Reset to Default" is a delete.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', ownerA: '', staffA: '', ownerB: '' };
const firm = () => db.forBusiness(ids.firmA);
const rolePerm = (data: Record<string, unknown> = {}) =>
  firm().rolePermission.create({
    data: {
      businessId: ids.firmA,
      role: 'TAX_PREPARER',
      module: 'CLIENTS',
      capability: 'EDIT',
      granted: false,
      ...data,
    },
  });
const memberPerm = (data: Record<string, unknown> = {}) =>
  firm().memberPermission.create({
    data: {
      businessId: ids.firmA,
      membershipId: ids.staffA,
      module: 'REPORTS',
      capability: 'EXPORT',
      granted: true,
      ...data,
    },
  });

beforeAll(async () => {
  const users = [randomUUID(), randomUUID(), randomUUID()];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of users) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `pm-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `pm-b-${run}`, name: 'B' } })).id;
  });
  const add = (
    tx: Parameters<Parameters<typeof runInScope>[2]>[0],
    business: string,
    userId: string,
    role: 'OWNER' | 'STAFF',
  ) =>
    tx.membership
      .create({ data: { businessId: business, userId, role, status: 'ACTIVE' } })
      .then((m) => m.id);
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.ownerA = await add(tx, ids.firmA, users[0]!, 'OWNER');
    ids.staffA = await add(tx, ids.firmA, users[1]!, 'STAFF');
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.ownerB = await add(tx, ids.firmB, users[2]!, 'OWNER');
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('permission overrides: isolation', () => {
  it('a firm sees only its own overrides', async () => {
    await rolePerm();
    await memberPerm();
    const other = db.forBusiness(ids.firmB);
    expect(await other.rolePermission.findMany()).toEqual([]);
    expect(await other.memberPermission.findMany()).toEqual([]);
    expect(await firm().rolePermission.count()).toBe(1);
  });

  it("refuses a row for another firm, or one that names another firm's member", async () => {
    await expect(
      db.forBusiness(ids.firmB).rolePermission.create({
        data: {
          businessId: ids.firmA,
          role: 'MANAGER',
          module: 'CLIENTS',
          capability: 'VIEW',
          granted: true,
        },
      }),
    ).rejects.toThrow();
    await expect(memberPerm({ membershipId: ids.ownerB, module: 'CLIENTS' })).rejects.toThrow();
    await expect(rolePerm({ module: 'LEADS', updatedById: ids.ownerB })).rejects.toThrow();
  });
});

describe('permission overrides: rules', () => {
  it('holds one row per role, module and capability', async () => {
    await expect(rolePerm()).rejects.toThrow();
    await expect(memberPerm()).rejects.toThrow();
  });

  it('never overrides the Owner', async () => {
    await expect(rolePerm({ role: 'OWNER', module: 'SETTINGS' })).rejects.toThrow();
    await expect(
      memberPerm({ membershipId: ids.ownerA, module: 'SETTINGS', granted: false }),
    ).rejects.toThrow(/Owner/);
  });

  it('takes the other seven roles, changes a grant, and resets by deleting', async () => {
    for (const role of [
      'ADMIN',
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'CLIENT_SUPPORT',
      'READ_ONLY',
    ] as const) {
      await expect(
        rolePerm({ role, module: 'TEMPLATES', capability: 'VIEW', granted: true }),
      ).resolves.toBeTruthy();
    }
    const key = {
      businessId_role_module_capability: {
        businessId: ids.firmA,
        role: 'TAX_PREPARER',
        module: 'CLIENTS',
        capability: 'EDIT',
      },
    } as const;
    await expect(
      firm().rolePermission.update({
        where: key,
        data: { granted: true, updatedById: ids.ownerA },
      }),
    ).resolves.toMatchObject({ granted: true });
    await firm().rolePermission.delete({ where: key });
    expect(await firm().rolePermission.findUnique({ where: key })).toBeNull();
  });

  it('keeps who changed it inside the firm', async () => {
    await expect(
      memberPerm({ module: 'MESSAGES', capability: 'VIEW', updatedById: ids.ownerA }),
    ).resolves.toBeTruthy();
  });
});
