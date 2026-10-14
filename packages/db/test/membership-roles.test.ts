// R35: the eight staff roles and the LOCKED status. Existing rules keep holding: a firm keeps an
// active owner, and a member of one firm is invisible to another. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { MembershipRole, MembershipStatus } from '../src/generated/prisma/enums.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', ownerA: '', memberA: '' };

beforeAll(async () => {
  const users = [randomUUID(), randomUUID(), randomUUID()];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of users) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ra-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `rb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const add = (userId: string, role: 'OWNER' | 'STAFF') =>
      tx.membership.create({ data: { businessId: ids.firmA, userId, role, status: 'ACTIVE' } });
    ids.ownerA = (await add(users[0]!, 'OWNER')).id;
    ids.memberA = (await add(users[1]!, 'STAFF')).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: users[2]!, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('membership roles and statuses', () => {
  it('has the eight roles and the four statuses', () => {
    expect(Object.values(MembershipRole)).toEqual([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'STAFF',
      'BOOKKEEPER',
      'TAX_PREPARER',
      'CLIENT_SUPPORT',
      'READ_ONLY',
    ]);
    expect(Object.values(MembershipStatus)).toEqual(['INVITED', 'ACTIVE', 'LOCKED', 'DEACTIVATED']);
  });

  it('stores every role and LOCKED', async () => {
    for (const role of Object.values(MembershipRole).filter((r) => r !== 'OWNER')) {
      const m = await db
        .forBusiness(ids.firmA)
        .membership.update({ where: { id: ids.memberA }, data: { role } });
      expect(m.role).toBe(role);
    }
    const locked = await db
      .forBusiness(ids.firmA)
      .membership.update({ where: { id: ids.memberA }, data: { status: 'LOCKED' } });
    expect(locked.status).toBe('LOCKED');
  });

  it('refuses to lock or demote the last active owner', async () => {
    const firm = db.forBusiness(ids.firmA);
    await expect(
      firm.membership.update({ where: { id: ids.ownerA }, data: { status: 'LOCKED' } }),
    ).rejects.toThrow(/LAST_ACTIVE_OWNER/);
    await expect(
      firm.membership.update({ where: { id: ids.ownerA }, data: { role: 'MANAGER' } }),
    ).rejects.toThrow(/LAST_ACTIVE_OWNER/);
  });

  it("keeps a firm's members out of another firm", async () => {
    expect(
      await db.forBusiness(ids.firmB).membership.findUnique({ where: { id: ids.memberA } }),
    ).toBeNull();
  });
});
