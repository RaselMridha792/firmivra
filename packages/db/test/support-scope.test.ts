// Support access (R8, Rasel's Oct 6 rule): app_enter_support_scope(firm, view) takes a Super
// Admin from admin scope into one firm's business scope only through an approved, unexpired,
// unrevoked grant of their own. It holds the grant so a revoke waits (and later entries queue
// behind the revoke), writes the platform's and the firm's audit rows, and leaves the
// transaction read-only. Runs as the app role.
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
const SIGNATURE = 'app_enter_support_scope(uuid, text, text, text, text)';
const enter = (tx: TxClient, businessId: string | null, view = 'audit_log') =>
  tx.$queryRaw<{ until: Date }[]>`
    SELECT app_enter_support_scope(${businessId}::uuid, ${view}, '203.0.113.7', 'Fake agent', 'req-1')
      AS until`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
/** Waits until the backend `pid` is blocked by another one. */
async function blocked(pid: number) {
  for (let i = 0; ; i++) {
    const [row] = await owner.$queryRaw<{ n: number }[]>`
      SELECT cardinality(pg_blocking_pids(${pid}::int))::int AS n`;
    if (row!.n > 0) return;
    if (i === 300) throw new Error(`backend ${pid} never waited`);
    await sleep(20);
  }
}
/** Runs `fn` in `scope`, reporting the backend pid first so a test can see it wait. */
const withPid = <T>(
  scope: Parameters<typeof runInScope>[1],
  onPid: (pid: number) => void,
  fn: (tx: TxClient) => Promise<T>,
) =>
  runInScope(app, scope, async (tx) => {
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    onPid(row!.pid);
    return fn(tx);
  });

/** A support grant for `adminUserId` on firm A: requested, and approved unless `pending`. */
async function grant(
  options: { adminUserId?: string; pending?: boolean; expiresInMs?: number } = {},
) {
  const adminUserId = options.adminUserId ?? ids.admin;
  const request = await db.forAdmin(adminUserId).supportAccessGrant.create({
    data: { businessId: ids.firmA, adminUserId, reason: 'Fake support request' },
  });
  if (options.pending) return request;
  return db.forBusiness(ids.firmA).supportAccessGrant.update({
    where: { id: request.id },
    data: {
      grantedByUserId: ids.ownerA,
      expiresAt: new Date(Date.now() + (options.expiresInMs ?? HOUR)),
    },
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
      SELECT has_function_privilege('firmivra_app', ${SIGNATURE}, 'EXECUTE') AS app,
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
    await owner.$executeRawUnsafe(`ALTER FUNCTION ${SIGNATURE} OWNER TO ${role}`);
    try {
      await grant();
      const clients = await asAdmin(async (tx) => {
        await enter(tx, ids.firmA, 'rds_owner_check');
        return tx.client.count();
      });
      expect(clients).toBe(1);
      // Both audit rows pass the policies under RLS too.
      const rows = await owner.auditLog.count({
        where: { metadata: { path: ['view'], equals: 'rds_owner_check' } },
      });
      expect(rows).toBe(2);
    } finally {
      await owner.$executeRawUnsafe(`ALTER FUNCTION ${SIGNATURE} OWNER TO "${migrate}"`);
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

  it('writes the platform row (the person) and the firm row (Firmivra Support, no IP), and clears earlier settings', async () => {
    const g = await grant();
    const after = await asAdmin(async (tx) => {
      // An actor set in admin scope must not carry into the firm (it would open private notes).
      await tx.$executeRaw`SELECT set_config('app.current_actor_id', ${ids.ownerA}, true)`;
      await enter(tx, ids.firmA, 'clients_page');
      const [row] = await tx.$queryRaw<
        { actor: string; user: string; admin: string; lock: string; ro: string }[]
      >`SELECT current_setting('app.current_actor_id', true) AS actor,
               current_setting('app.current_user_id', true) AS user,
               current_setting('app.current_admin_id', true) AS admin,
               current_setting('lock_timeout') AS lock,
               current_setting('transaction_read_only') AS ro`;
      return row!;
    });
    expect(after).toEqual({ actor: '', user: '', admin: '', lock: '0', ro: 'on' });
    const rows = await owner.auditLog.findMany({
      where: { entityId: g.id, action: 'support.viewed' },
      orderBy: { businessId: { sort: 'asc', nulls: 'first' } },
    });
    expect(
      rows.map((r) => [r.businessId, r.actorUserId, r.entityType, r.metadata, r.ip, r.userAgent]),
    ).toEqual([
      [
        null,
        ids.admin,
        'support_access_grant',
        { businessId: ids.firmA, view: 'clients_page' },
        '203.0.113.7',
        'Fake agent',
      ],
      [ids.firmA, ids.admin, 'support_access_grant', { view: 'clients_page' }, null, null],
    ]);
    expect(rows.map((r) => r.requestId)).toEqual(['req-1', 'req-1']);
    expect(await outcome(asAdmin((tx) => enter(tx, ids.firmA, 'Bad View')))).toMatch(
      /name the support view/,
    );
    await revokeAll();
  });

  it('nothing in the firm can change afterwards: no client update, no member, no approval in the owner name', async () => {
    await grant();
    const pending = await grant({ pending: true });
    const writes: ((tx: TxClient) => Promise<unknown>)[] = [
      (tx) => tx.client.update({ where: { id: ids.clientA }, data: { displayName: 'Changed' } }),
      (tx) =>
        tx.membership.create({
          data: { businessId: ids.firmA, userId: ids.admin, role: 'OWNER', status: 'ACTIVE' },
        }),
      (tx) =>
        tx.supportAccessGrant.update({
          where: { id: pending.id },
          data: { grantedByUserId: ids.ownerA, expiresAt: new Date(Date.now() + 71 * HOUR) },
        }),
      (tx) => tx.$executeRaw`SELECT set_config('transaction_read_only', 'off', true)`,
    ];
    for (const write of writes) {
      const result = await outcome(
        asAdmin(async (tx) => {
          await enter(tx, ids.firmA);
          await write(tx);
        }),
      );
      expect(result).toMatch(/read-only transaction|before any query/);
    }
    const still = await db
      .forBusiness(ids.firmA)
      .supportAccessGrant.findUniqueOrThrow({ where: { id: pending.id } });
    expect(still.grantedByUserId).toBeNull();
    await revokeAll();
  });

  it('a support transaction that starts while a revoke waits queues behind it, then is refused', async () => {
    const g = await grant();
    let letGo!: () => void;
    const released = new Promise<void>((resolve) => (letGo = resolve));
    let entered!: () => void;
    const holding = new Promise<void>((resolve) => (entered = resolve));
    const first = asAdmin(async (tx) => {
      await enter(tx, ids.firmA);
      entered();
      await released;
    });
    await holding;
    // The firm's revoke waits on the first support transaction...
    let revokePid!: (pid: number) => void;
    const revokeStarted = new Promise<number>((resolve) => (revokePid = resolve));
    const revoke = outcome(
      withPid({ kind: 'business', businessId: ids.firmA }, revokePid, (tx) =>
        tx.supportAccessGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } }),
      ),
    );
    await blocked(await revokeStarted);
    // ...and a second one, started now, waits behind the revoke instead of entering ahead of it.
    let secondPid!: (pid: number) => void;
    const secondStarted = new Promise<number>((resolve) => (secondPid = resolve));
    const second = outcome(
      withPid({ kind: 'admin', adminUserId: ids.admin }, secondPid, (tx) => enter(tx, ids.firmA)),
    );
    await blocked(await secondStarted);
    letGo();
    await first;
    expect(await revoke).toBe('ok');
    expect(await second).toMatch(/no approved, unexpired support access/);
  });

  it('an expiry passed while the transaction was open counts (the clock, not the transaction start)', async () => {
    await grant({ expiresInMs: 1500 });
    const result = await outcome(
      asAdmin(async (tx) => {
        await tx.$queryRaw`SELECT now()`;
        await sleep(2000);
        await enter(tx, ids.firmA);
      }),
    );
    expect(result).toMatch(/no approved, unexpired support access/);
    await revokeAll();
  });

  it('gives up after 2 s behind a lock (55P03) instead of holding a connection', async () => {
    const g = await grant();
    let letGo!: () => void;
    const released = new Promise<void>((resolve) => (letGo = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const holder = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM support_access_grants WHERE id = ${g.id}::uuid FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 30_000 },
    );
    await holding;
    const started = Date.now();
    try {
      expect(await outcome(asAdmin((tx) => enter(tx, ids.firmA)))).toMatch(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      letGo();
      await holder;
    }
    await revokeAll();
  });
});
