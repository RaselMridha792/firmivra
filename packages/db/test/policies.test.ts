// Rules tightened on Oct 5: support access grants, user updates, business status and slug.
// Runs as the app role (firmivra_app), so RLS policies and triggers both apply.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  ownerA: randomUUID(),
  staffA: randomUUID(),
  ownerB: randomUUID(),
  admin: randomUUID(),
};
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

const firmA = () => db.forBusiness(ids.firmA);
const platform = () => db.forPlatform();
/** A fresh support access request from the Super Admin side. */
const request = () =>
  platform().supportAccessGrant.create({
    data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Customer asked for help' },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.ownerA, 'STAFF'],
      [ids.staffA, 'STAFF'],
      [ids.ownerB, 'STAFF'],
      [ids.admin, 'ADMIN'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@p.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    ids.firmA = (await tx.business.create({ data: { slug: `pa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `pb-${run}`, name: 'B' } })).id;
  });
  for (const [businessId, userId, role] of [
    [ids.firmA, ids.ownerA, 'OWNER'],
    [ids.firmA, ids.staffA, 'STAFF'],
    [ids.firmB, ids.ownerB, 'OWNER'],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('support access grants', () => {
  it('the platform can request access, but not create an approved grant', async () => {
    await expect(request()).resolves.toMatchObject({ grantedByUserId: null, expiresAt: null });
    await expect(
      platform().supportAccessGrant.create({
        data: {
          businessId: ids.firmA,
          adminUserId: ids.admin,
          reason: 'x',
          grantedByUserId: ids.ownerA,
          expiresAt: hours(24),
        },
      }),
    ).rejects.toThrow();
  });

  it('the platform cannot approve its own request', async () => {
    const g = await request();
    const result = await platform().supportAccessGrant.updateMany({
      where: { id: g.id },
      data: { grantedByUserId: ids.admin, expiresAt: hours(24) },
    });
    expect(result.count).toBe(0);
  });

  it('a firm cannot create requests itself', async () => {
    await expect(
      firmA().supportAccessGrant.create({
        data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'x' },
      }),
    ).rejects.toThrow();
  });

  it('an active owner approves for up to 72 hours', async () => {
    const g = await request();
    const approved = await firmA().supportAccessGrant.update({
      where: { id: g.id },
      data: { grantedByUserId: ids.ownerA, expiresAt: hours(24) },
    });
    expect(approved.grantedByUserId).toBe(ids.ownerA);
  });

  it('approval needs an expiry within 72 hours', async () => {
    const g = await request();
    for (const expiresAt of [null, hours(73), hours(-1)]) {
      await expect(
        firmA().supportAccessGrant.update({
          where: { id: g.id },
          data: { grantedByUserId: ids.ownerA, expiresAt },
        }),
      ).rejects.toThrow(/72 hours/);
    }
  });

  it('judges the 72 hours by the database clock, so a fast API clock never fails approval', async () => {
    for (const apiClockAhead of [0, 30_000]) {
      const g = await request();
      const requested = new Date(hours(72).getTime() + apiClockAhead);
      const approved = await firmA().supportAccessGrant.update({
        where: { id: g.id },
        data: { grantedByUserId: ids.ownerA, expiresAt: requested },
      });
      const [db72h] = await owner.$queryRaw<
        { at: Date }[]
      >`SELECT now() + interval '72 hours' AS at`;
      expect(approved.expiresAt!.getTime()).toBeLessThanOrEqual(db72h!.at.getTime());
      expect(approved.expiresAt!.getTime()).toBeLessThanOrEqual(requested.getTime());
    }
  });

  it('staff, or an owner of another firm, cannot approve', async () => {
    const g = await request();
    for (const approver of [ids.staffA, ids.ownerB]) {
      await expect(
        firmA().supportAccessGrant.update({
          where: { id: g.id },
          data: { grantedByUserId: approver, expiresAt: hours(24) },
        }),
      ).rejects.toThrow(/active owner/);
    }
  });

  it("another firm cannot touch firm A's request", async () => {
    const g = await request();
    const result = await db.forBusiness(ids.firmB).supportAccessGrant.updateMany({
      where: { id: g.id },
      data: { grantedByUserId: ids.ownerB, expiresAt: hours(24) },
    });
    expect(result.count).toBe(0);
  });

  it('an approval cannot be extended or edited, only revoked once', async () => {
    const g = await request();
    await firmA().supportAccessGrant.update({
      where: { id: g.id },
      data: { grantedByUserId: ids.ownerA, expiresAt: hours(24) },
    });
    await expect(
      firmA().supportAccessGrant.update({ where: { id: g.id }, data: { expiresAt: hours(48) } }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      firmA().supportAccessGrant.update({ where: { id: g.id }, data: { reason: 'edited' } }),
    ).rejects.toThrow(/only approval and revocation/);

    await firmA().supportAccessGrant.update({
      where: { id: g.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      firmA().supportAccessGrant.update({ where: { id: g.id }, data: { revokedAt: null } }),
    ).rejects.toThrow(/cannot be undone/);
  });

  it('a declined request cannot be approved later', async () => {
    const g = await request();
    await firmA().supportAccessGrant.update({
      where: { id: g.id },
      data: { revokedAt: new Date() },
    });
    await expect(
      firmA().supportAccessGrant.update({
        where: { id: g.id },
        data: { grantedByUserId: ids.ownerA, expiresAt: hours(24) },
      }),
    ).rejects.toThrow(/cannot be approved/);
  });

  it('nobody in the app can delete a grant', async () => {
    await request();
    await expect(firmA().supportAccessGrant.deleteMany({})).rejects.toThrow(/permission denied/i);
  });
});

describe('users: only the platform or the person themself can update', () => {
  it('a firm cannot update its own members', async () => {
    const result = await firmA().user.updateMany({
      where: { id: ids.ownerA },
      data: { name: 'changed by firm' },
    });
    expect(result.count).toBe(0);
    await expect(
      firmA().user.update({ where: { id: ids.staffA }, data: { name: 'x' } }),
    ).rejects.toThrow();
  });

  it('a person can update their own name, but not someone else', async () => {
    const me = db.forUser(ids.ownerA);
    await expect(
      me.user.update({ where: { id: ids.ownerA }, data: { name: 'New Name' } }),
    ).resolves.toMatchObject({ name: 'New Name' });
    const other = await me.user.updateMany({ where: { id: ids.staffA }, data: { name: 'x' } });
    expect(other.count).toBe(0);
  });

  it('a person cannot change their own identity fields', async () => {
    const me = db.forUser(ids.ownerA);
    for (const data of [{ email: 'new@p.test' }, { pool: 'ADMIN' as const }, { cognitoSub: 'x' }]) {
      await expect(me.user.update({ where: { id: ids.ownerA }, data })).rejects.toThrow(
        /platform scope/,
      );
    }
  });

  it('the platform can update any user', async () => {
    await expect(
      platform().user.update({
        where: { id: ids.staffA },
        data: { email: `renamed-${run}@p.test` },
      }),
    ).resolves.toMatchObject({ email: `renamed-${run}@p.test` });
  });
});

describe('users: one staff or admin identity per email, clients one per firm', () => {
  const newUser = (pool: 'STAFF' | 'ADMIN' | 'CLIENT', email: string) => {
    const id = randomUUID();
    return platform().user.create({ data: { id, cognitoSub: id, pool, email, name: 'Fake' } });
  };

  it('a second STAFF or ADMIN user with the same email is refused', async () => {
    for (const pool of ['STAFF', 'ADMIN'] as const) {
      const email = `dup-${pool.toLowerCase()}-${run}@p.test`;
      await newUser(pool, email);
      await expect(newUser(pool, email)).rejects.toThrow(/unique constraint/i);
    }
  });

  it('the same email may have a CLIENT user per firm, and a staff identity too', async () => {
    const email = `client-twice-${run}@p.test`;
    await newUser('CLIENT', email);
    await expect(newUser('CLIENT', email)).resolves.toMatchObject({ pool: 'CLIENT' });
    await expect(newUser('STAFF', email)).resolves.toMatchObject({ pool: 'STAFF' });
  });
});

describe('businesses: status and slug belong to the platform', () => {
  it('a firm can rename itself', async () => {
    await expect(
      firmA().business.update({ where: { id: ids.firmA }, data: { name: 'Firm A Renamed' } }),
    ).resolves.toMatchObject({ name: 'Firm A Renamed' });
  });

  it('a firm cannot change its status or slug', async () => {
    for (const data of [{ status: 'ACTIVE' as const }, { slug: `hijack-${run}` }]) {
      await expect(firmA().business.update({ where: { id: ids.firmA }, data })).rejects.toThrow(
        /platform scope/,
      );
    }
  });

  it('the platform can change status and slug', async () => {
    await expect(
      platform().business.update({
        where: { id: ids.firmA },
        data: { status: 'ACTIVE', slug: `pa2-${run}` },
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE', slug: `pa2-${run}` });
  });
});
