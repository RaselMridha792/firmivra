// Rules tightened on Oct 5: support access grants, user updates, business status and slug.
// Runs as the app role (firmivra_app), so RLS policies and triggers both apply.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

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

describe('users: only client logins nothing points at are deleted, in platform scope', () => {
  const login = async (pool: 'CLIENT' | 'STAFF') => {
    const id = randomUUID();
    await platform().user.create({
      data: { id, cognitoSub: id, pool, email: `gone-${id}@p.test`, name: 'Fake Gone' },
    });
    return id;
  };

  it('the platform removes an unused client login; nobody else removes any login', async () => {
    const id = await login('CLIENT');
    expect((await firmA().user.deleteMany({ where: { id } })).count).toBe(0);
    expect((await db.forUser(id).user.deleteMany({ where: { id } })).count).toBe(0);
    expect((await platform().user.deleteMany({ where: { id } })).count).toBe(1);
  });

  it('staff logins and client logins with an account stay', async () => {
    const staff = await login('STAFF');
    expect((await platform().user.deleteMany({ where: { id: staff } })).count).toBe(0);
    const client = await login('CLIENT');
    await firmA().clientAccount.create({
      data: { businessId: ids.firmA, userId: client, email: `gone-${client}@p.test` },
    });
    await expect(platform().user.deleteMany({ where: { id: client } })).rejects.toThrow();
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

  it('compares emails case-insensitively: only lower-case is stored', async () => {
    const email = `case-${run}@p.test`;
    await newUser('STAFF', email);
    // "Case-…@P.test" can never sit next to "case-…@p.test": mixed case is refused outright.
    const mixed = `Case-${run}@P.test`;
    await expect(newUser('STAFF', mixed)).rejects.toThrow(/check constraint/i);

    const client = await newUser('CLIENT', `client-case-${run}@p.test`);
    await expect(
      firmA().clientAccount.create({
        data: { businessId: ids.firmA, userId: client.id, email: `Client-Case-${run}@P.test` },
      }),
    ).rejects.toThrow(/check constraint/i);
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

describe('setup wizard Finish and the locked legal name (T02)', () => {
  /** A new firm in the given status, with settings; setup finished or not. */
  const newFirm = async (
    status: 'PENDING_SETUP' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
    done: boolean,
  ) => {
    const firm = await platform().business.create({
      data: {
        slug: `t2-${randomUUID().slice(0, 8)}`,
        name: 'Setup',
        legalName: 'Setup LLC',
        status,
      },
    });
    await db.forBusiness(firm.id).businessSettings.create({
      data: { businessId: firm.id, setupCompletedAt: done ? new Date() : null },
    });
    return firm.id;
  };
  const setStatus = (businessId: string, status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_SETUP') =>
    db.forBusiness(businessId).business.update({ where: { id: businessId }, data: { status } });

  it('Finish: a firm moves itself from Pending Setup to Active only once setup is done', async () => {
    const firm = await newFirm('PENDING_SETUP', false);
    await expect(setStatus(firm, 'ACTIVE')).rejects.toThrow(/platform scope, except Finish/);
    await db.forBusiness(firm).businessSettings.update({
      where: { businessId: firm },
      data: { setupCompletedAt: new Date() },
    });
    await expect(setStatus(firm, 'ACTIVE')).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('no other status change by the firm: not from Active, Suspended or Closed', async () => {
    await expect(setStatus(await newFirm('PENDING_SETUP', true), 'SUSPENDED')).rejects.toThrow(
      /platform scope/,
    );
    await expect(setStatus(await newFirm('ACTIVE', true), 'SUSPENDED')).rejects.toThrow(
      /platform scope/,
    );
    await expect(setStatus(await newFirm('ACTIVE', true), 'PENDING_SETUP')).rejects.toThrow(
      /platform scope/,
    );
    for (const status of ['SUSPENDED', 'CLOSED'] as const) {
      await expect(setStatus(await newFirm(status, true), 'ACTIVE')).rejects.toThrow(
        /platform scope/,
      );
    }
  });

  it('the firm never changes its KMS key, business type or pack', async () => {
    const firm = await newFirm('ACTIVE', true);
    for (const data of [{ kmsKeyId: 'alias/other' }, { businessType: 'Other' }]) {
      await expect(
        db.forBusiness(firm).business.update({ where: { id: firm }, data }),
      ).rejects.toThrow(/change only in platform scope/);
    }
  });

  it('the legal name is locked for the firm; the platform can change it', async () => {
    const firm = await newFirm('ACTIVE', true);
    await expect(
      db
        .forBusiness(firm)
        .business.update({ where: { id: firm }, data: { legalName: 'Other LLC' } }),
    ).rejects.toThrow(/legal name change only in platform scope/);
    await expect(
      platform().business.update({ where: { id: firm }, data: { legalName: 'Renamed LLC' } }),
    ).resolves.toMatchObject({ legalName: 'Renamed LLC' });
  });

  it('setup_completed_at is set once and never changes or clears, in any scope', async () => {
    const firm = await newFirm('PENDING_SETUP', true);
    for (const setupCompletedAt of [null, new Date(Date.now() + 60_000)]) {
      await expect(
        db.forBusiness(firm).businessSettings.update({
          where: { businessId: firm },
          data: { setupCompletedAt },
        }),
      ).rejects.toThrow(/set once and never changes/);
    }
    await expect(
      runInScope(
        owner,
        { kind: 'platform' },
        (tx) =>
          tx.$executeRaw`UPDATE business_settings SET setup_completed_at = NULL WHERE business_id = ${firm}::uuid`,
      ),
    ).rejects.toThrow(/set once and never changes/);
  });
});
