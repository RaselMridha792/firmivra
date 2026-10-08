// Support access (R8, Rasel's Oct 6 rule): app_enter_support_scope(firm) takes a Super Admin
// from admin scope into one firm's business scope only through an approved, unexpired,
// unrevoked grant of their own, and holds the grant so a revoke waits. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  otherAdmin: randomUUID(),
  ownerA: randomUUID(),
  firmA: '',
  firmB: '',
  clientA: '',
};
const HOUR = 3_600_000;

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.admin) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const enter = (tx: TxClient, businessId: string | null) =>
  tx.$queryRaw<{ until: Date }[]>`SELECT app_enter_support_scope(${businessId}::uuid) AS until`;

/** A support grant for `adminUserId` on firm A: requested, and approved unless `pending`. */
async function grant(options: { adminUserId?: string; pending?: boolean } = {}) {
  const adminUserId = options.adminUserId ?? ids.admin;
  const request = await db.forAdmin(adminUserId).supportAccessGrant.create({
    data: { businessId: ids.firmA, adminUserId, reason: 'Fake support request' },
  });
  if (options.pending) return request;
  return db.forBusiness(ids.firmA).supportAccessGrant.update({
    where: { id: request.id },
    data: { grantedByUserId: ids.ownerA, expiresAt: new Date(Date.now() + HOUR) },
  });
}

/** Ends every live grant of firm A (they would otherwise open the scope for later tests). */
const revokeAll = () =>
  db.forBusiness(ids.firmA).supportAccessGrant.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date() },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.admin, 'ADMIN'],
      [ids.otherAdmin, 'ADMIN'],
      [ids.ownerA, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.admin } });
    await tx.platformAdmin.create({ data: { userId: ids.otherAdmin } });
    ids.firmA = (await tx.business.create({ data: { slug: `supa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `supb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.ownerA, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientA = (
      await tx.client.create({ data: { businessId: ids.firmA, displayName: 'Fake A' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.client.create({ data: { businessId: ids.firmB, displayName: 'Fake B' } }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('app_enter_support_scope', () => {
  it("an approved, unexpired grant opens that firm's scope, and only that firm's, for the rest of the transaction", async () => {
    const g = await grant();
    const seen = await asAdmin(async (tx) => {
      const before = await tx.client.count();
      const [row] = await enter(tx, ids.firmA);
      return {
        before,
        until: row!.until,
        clients: (await tx.client.findMany({ select: { id: true, businessId: true } })).map((c) => [
          c.id,
          c.businessId,
        ]),
      };
    });
    expect(seen.before).toBe(0);
    expect(seen.until).toEqual(g.expiresAt);
    expect(seen.clients).toEqual([[ids.clientA, ids.firmA]]);
    await revokeAll();
  });

  it("a pending, revoked, expired or another admin's grant, another firm or no firm open nothing", async () => {
    const refused = async (businessId: string | null, adminUserId = ids.admin) =>
      asAdmin(async (tx) => {
        await enter(tx, businessId);
        return tx.client.count();
      }, adminUserId);
    await grant({ pending: true });
    await expect(refused(ids.firmA)).rejects.toThrow(/no approved, unexpired support access/);
    const revoked = await grant();
    await db
      .forBusiness(ids.firmA)
      .supportAccessGrant.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    await expect(refused(ids.firmA)).rejects.toThrow(/no approved, unexpired support access/);
    const expired = await grant();
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
      // Past the 72 hours: the rules trigger never lets a decision change, so step around it.
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.supportAccessGrant.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
    });
    await expect(refused(ids.firmA)).rejects.toThrow(/no approved, unexpired support access/);
    await grant({ adminUserId: ids.otherAdmin });
    await expect(refused(ids.firmA)).rejects.toThrow(/no approved, unexpired support access/);
    await expect(refused(ids.firmB)).rejects.toThrow(/no approved, unexpired support access/);
    await expect(refused(null)).rejects.toThrow(/only a Super Admin/);
    await revokeAll();
  });

  it('works only from admin scope; PUBLIC may not run it, the app role may', async () => {
    await grant();
    for (const scope of [
      { kind: 'business', businessId: ids.firmB },
      { kind: 'platform' },
    ] as const) {
      await expect(runInScope(app, scope, (tx) => enter(tx, ids.firmA))).rejects.toThrow(
        /only a Super Admin/,
      );
    }
    const [rights] = await owner.$queryRaw<{ app: boolean; pub: boolean }[]>`
      SELECT has_function_privilege('firmivra_app', 'app_enter_support_scope(uuid)', 'EXECUTE') AS app,
             EXISTS (SELECT 1 FROM information_schema.routine_privileges
                     WHERE routine_name = 'app_enter_support_scope' AND grantee = 'PUBLIC') AS pub`;
    expect(rights).toEqual({ app: true, pub: false });
    await revokeAll();
  });

  it('owned by a role that is no superuser (as on RDS), it still locks the grant through its own policy', async () => {
    // The test owner is a superuser and skips RLS. Hand the function to a plain member of the
    // migrate role for this test, so the grant is read and locked under RLS.
    const role = `fv_sup_${run}`;
    const [me] = await owner.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
    const migrate = me!.name;
    await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
    await owner.$executeRawUnsafe(`GRANT "${migrate}" TO ${role}`);
    await owner.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO ${role}`);
    await owner.$executeRawUnsafe(`ALTER FUNCTION app_enter_support_scope(uuid) OWNER TO ${role}`);
    try {
      await grant();
      const clients = await asAdmin(async (tx) => {
        await enter(tx, ids.firmA);
        return tx.client.count();
      });
      expect(clients).toBe(1);
    } finally {
      await owner.$executeRawUnsafe(
        `ALTER FUNCTION app_enter_support_scope(uuid) OWNER TO "${migrate}"`,
      );
      await owner.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      await revokeAll();
    }
  });

  it('a revoke waits while a support transaction holds the grant, then nothing opens', async () => {
    const g = await grant();
    let letGo!: () => void;
    const released = new Promise<void>((resolve) => (letGo = resolve));
    let held!: (pid: number) => void;
    const holding = new Promise<number>((resolve) => (held = resolve));
    const support = asAdmin(async (tx) => {
      await enter(tx, ids.firmA);
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held(row!.pid);
      await released;
      return tx.client.count();
    });
    const pid = await holding;
    let revokedAt: number | null = null;
    const revoke = db
      .forBusiness(ids.firmA)
      .supportAccessGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } })
      .then(() => {
        revokedAt = Date.now();
      });
    for (let i = 0; ; i++) {
      const [row] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY (pg_blocking_pids(pid))`;
      if (row!.n > 0) break;
      if (i === 300) throw new Error('the revoke never waited');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(revokedAt).toBeNull();
    letGo();
    expect(await support).toBe(1);
    await revoke;
    expect(revokedAt).not.toBeNull();
    await expect(
      asAdmin(async (tx) => {
        await enter(tx, ids.firmA);
      }),
    ).rejects.toThrow(/no approved, unexpired support access/);
  });
});
