// Tenant isolation: data of firm A is never visible to firm B, even with no WHERE clause.
// Runs as the real app role (firmivra_app) against the test database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const unscopedApp = createPrismaClient(urls.app);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  ownerA: randomUUID(),
  clientA: randomUUID(),
  ownerB: randomUUID(),
  clientB: randomUUID(),
  admin: randomUUID(),
  membershipA: '',
  clientAccountA: '',
  grantA: '',
};

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const users = [
      [ids.ownerA, 'STAFF', `owner-a-${run}@a.test`],
      [ids.clientA, 'CLIENT', `client-a-${run}@a.test`],
      [ids.ownerB, 'STAFF', `owner-b-${run}@b.test`],
      [ids.clientB, 'CLIENT', `client-b-${run}@b.test`],
      [ids.admin, 'ADMIN', `admin-${run}@firmivra.test`],
    ] as const;
    for (const [id, pool, email] of users) {
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name: 'Fake Person' } });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    ids.firmA = (await tx.business.create({ data: { slug: `firm-a-${run}`, name: 'Firm A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `firm-b-${run}`, name: 'Firm B' } })).id;
    await tx.firmApplication.create({
      data: {
        legalName: 'Applicant LLC',
        contactName: 'Fake',
        contactEmail: `apply-${run}@x.test`,
        data: {},
      },
    });
  });

  for (const [firm, ownerId, clientId] of [
    [ids.firmA, ids.ownerA, ids.clientA],
    [ids.firmB, ids.ownerB, ids.clientB],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId: firm }, async (tx) => {
      const m = await tx.membership.create({
        data: { businessId: firm, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: clientId } });
      const c = await tx.clientAccount.create({
        data: { businessId: firm, userId: clientId, email: user.email, status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          businessId: firm,
          actorUserId: ownerId,
          action: 'test.created',
          entityType: 'test',
        },
      });
      if (firm === ids.firmA) {
        ids.membershipA = m.id;
        ids.clientAccountA = c.id;
      }
    });
  }

  // Support access starts as a request from the platform side (Super Admin).
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const firm of [ids.firmA, ids.firmB]) {
      const g = await tx.supportAccessGrant.create({
        data: { businessId: firm, adminUserId: ids.admin, reason: 'test' },
      });
      if (firm === ids.firmA) ids.grantA = g.id;
    }
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), unscopedApp.$disconnect(), db.disconnect()]);
});

describe('no scope set', () => {
  it('the app role sees no rows in any table', async () => {
    expect(await unscopedApp.business.findMany()).toEqual([]);
    expect(await unscopedApp.user.findMany()).toEqual([]);
    expect(await unscopedApp.membership.findMany()).toEqual([]);
    expect(await unscopedApp.clientAccount.findMany()).toEqual([]);
    expect(await unscopedApp.auditLog.findMany()).toEqual([]);
    expect(await unscopedApp.firmApplication.findMany()).toEqual([]);
  });
});

describe('business scope: firm B', () => {
  const b = () => db.forBusiness(ids.firmB);

  it('lists only its own rows with no WHERE clause', async () => {
    const businesses = await b().business.findMany();
    expect(businesses.map((x) => x.id)).toEqual([ids.firmB]);

    for (const rows of [
      await b().membership.findMany(),
      await b().clientAccount.findMany(),
      await b().supportAccessGrant.findMany(),
      await b().auditLog.findMany(),
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.businessId === ids.firmB)).toBe(true);
    }

    const users = await b().user.findMany();
    expect(users.map((u) => u.id).sort()).toEqual([ids.ownerB, ids.clientB].sort());
  });

  it("cannot read firm A's rows by id", async () => {
    expect(await b().business.findUnique({ where: { id: ids.firmA } })).toBeNull();
    expect(await b().membership.findUnique({ where: { id: ids.membershipA } })).toBeNull();
    expect(await b().clientAccount.findUnique({ where: { id: ids.clientAccountA } })).toBeNull();
    expect(await b().supportAccessGrant.findUnique({ where: { id: ids.grantA } })).toBeNull();
    expect(await b().user.findUnique({ where: { id: ids.ownerA } })).toBeNull();
    expect(await b().user.findUnique({ where: { id: ids.clientA } })).toBeNull();
  });

  it("cannot update or delete firm A's rows", async () => {
    expect(
      (await b().membership.updateMany({ data: { role: 'STAFF' }, where: { id: ids.membershipA } }))
        .count,
    ).toBe(0);
    expect((await b().membership.deleteMany({ where: { businessId: ids.firmA } })).count).toBe(0);
    expect((await b().clientAccount.deleteMany({ where: { id: ids.clientAccountA } })).count).toBe(
      0,
    );
    expect(
      (await b().business.updateMany({ data: { name: 'hacked' }, where: { id: ids.firmA } })).count,
    ).toBe(0);
    await expect(
      b().membership.update({ where: { id: ids.membershipA }, data: { role: 'STAFF' } }),
    ).rejects.toThrow();

    const stillThere = await db
      .forBusiness(ids.firmA)
      .membership.findUnique({ where: { id: ids.membershipA } });
    expect(stillThere?.role).toBe('OWNER');
  });

  it('cannot write rows into firm A', async () => {
    await expect(
      b().membership.create({ data: { businessId: ids.firmA, userId: ids.ownerB, role: 'ADMIN' } }),
    ).rejects.toThrow();
    await expect(
      b().auditLog.create({ data: { businessId: ids.firmA, action: 'x', entityType: 'x' } }),
    ).rejects.toThrow();
  });

  it('sees no platform tables', async () => {
    expect(await b().firmApplication.findMany()).toEqual([]);
    expect(await b().platformAdmin.findMany()).toEqual([]);
  });
});

describe('user scope', () => {
  it("sees only the person's own memberships and firms", async () => {
    const u = db.forUser(ids.ownerA);
    const memberships = await u.membership.findMany();
    expect(memberships.map((m) => m.businessId)).toEqual([ids.firmA]);
    expect((await u.business.findMany()).map((x) => x.id)).toEqual([ids.firmA]);
    expect((await u.user.findMany()).map((x) => x.id)).toEqual([ids.ownerA]);
    expect(await u.clientAccount.findMany()).toEqual([]);
    expect(await u.auditLog.findMany()).toEqual([]);
  });
});

describe('platform scope', () => {
  it('sees firms and applications but no firm data', async () => {
    const p = db.forPlatform();
    const firms = (await p.business.findMany()).map((x) => x.id);
    expect(firms).toEqual(expect.arrayContaining([ids.firmA, ids.firmB]));
    expect((await p.firmApplication.findMany()).length).toBeGreaterThan(0);
    expect(await p.membership.findMany()).toEqual([]);
    expect(await p.clientAccount.findMany()).toEqual([]);
    expect((await p.auditLog.findMany()).every((r) => r.businessId === null)).toBe(true);
  });
});

describe('audit log', () => {
  it('is append-only for the app role', async () => {
    await expect(
      db.withScope({ kind: 'business', businessId: ids.firmA }, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.withScope({ kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.auditLog.updateMany({ data: { action: 'changed' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('withScope transactions', () => {
  it('keeps every statement in the transaction inside the scope', async () => {
    const counts = await db.withScope({ kind: 'business', businessId: ids.firmA }, async (tx) => {
      const viaModel = await tx.membership.count();
      const viaRaw = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM memberships`;
      return { viaModel, viaRaw: Number(viaRaw[0]?.n) };
    });
    expect(counts).toEqual({ viaModel: 1, viaRaw: 1 });
  });

  it('rejects a malformed business id before touching the database', () => {
    expect(() => db.forBusiness("x' OR 1=1 --")).toThrow(/invalid business id/i);
  });
});
