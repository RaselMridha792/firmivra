// The firm's record of a Super Admin's support ask (R21, issue #215): app_log_support_request
// writes one support.requested row in the firm's audit log from admin scope, inside the ask's
// transaction, only for the admin's own pending request for that firm. Runs as the app role.
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
};
const SIGNATURE = 'app_log_support_request(uuid, uuid)';
const HOUR = 3_600_000;

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.admin) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const log = (tx: TxClient, businessId: string | null, grantId: string | null) =>
  tx.$executeRaw`SELECT app_log_support_request(${businessId}::uuid, ${grantId}::uuid)`;
/** The admin's ask: a pending request, and the firm's row, in one transaction. */
const ask = (businessId: string, adminUserId = ids.admin) =>
  asAdmin(async (tx) => {
    const grant = await tx.supportAccessGrant.create({
      data: { businessId, adminUserId, reason: 'Fake support request' },
    });
    await log(tx, businessId, grant.id);
    return grant;
  }, adminUserId);
const firmRows = (grantId: string) =>
  owner.auditLog.findMany({ where: { action: 'support.requested', entityId: grantId } });
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

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
    ids.firmA = (await tx.business.create({ data: { slug: `srla-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `srlb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmA, userId: ids.ownerA, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('app_log_support_request', () => {
  it('writes one firm row with the ask, actor the admin, no IP, ids only, and keeps admin scope', async () => {
    const after = await asAdmin(async (tx) => {
      const grant = await tx.supportAccessGrant.create({
        data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Fake support request' },
      });
      await log(tx, ids.firmA, grant.id);
      const [row] = await tx.$queryRaw<{ scope: string; firm: string }[]>`
        SELECT current_setting('app.scope', true) AS scope,
               current_setting('app.current_business_id', true) AS firm`;
      // Still admin scope: the firm's data stays out of reach.
      return { grant, scope: row!, clients: await tx.client.count() };
    });
    expect(after.scope).toEqual({ scope: 'admin', firm: '' });
    expect(after.clients).toBe(0);
    const rows = await firmRows(after.grant.id);
    expect(
      rows.map((r) => [r.businessId, r.actorUserId, r.entityType, r.metadata, r.ip, r.userAgent]),
    ).toEqual([[ids.firmA, ids.admin, 'support_access_grant', {}, null, null]]);
  });

  it('commits with the ask or not at all', async () => {
    let grantId = '';
    const result = await outcome(
      asAdmin(async (tx) => {
        const grant = await tx.supportAccessGrant.create({
          data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Fake, rolled back' },
        });
        grantId = grant.id;
        await log(tx, ids.firmA, grant.id);
        throw new Error('the ask failed after the log');
      }),
    );
    expect(result).toBe('the ask failed after the log');
    expect(await firmRows(grantId)).toEqual([]);
  });

  it("refuses another admin's, another firm's, a decided or revoked request, a second row, and other scopes", async () => {
    const mine = await ask(ids.firmA);
    const theirs = await ask(ids.firmA, ids.otherAdmin);
    const refused = async (businessId: string | null, grantId: string | null) =>
      outcome(asAdmin((tx) => log(tx, businessId, grantId)));
    expect(await refused(ids.firmA, theirs.id)).toMatch(/no pending support request of yours/);
    expect(await refused(ids.firmB, mine.id)).toMatch(/no pending support request of yours/);
    expect(await refused(ids.firmA, randomUUID())).toMatch(/no pending support request of yours/);
    expect(await refused(null, mine.id)).toMatch(/only a Super Admin/);
    expect(await refused(ids.firmA, null)).toMatch(/only a Super Admin/);
    // One row per request.
    expect(await refused(ids.firmA, mine.id)).toMatch(/already in the firm's log/);
    expect(await firmRows(mine.id)).toHaveLength(1);
    // An approved request, or a revoked one, is no longer an ask.
    const approved = await asAdmin((tx) =>
      tx.supportAccessGrant.create({
        data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Fake, approved' },
      }),
    );
    await db.forBusiness(ids.firmA).supportAccessGrant.update({
      where: { id: approved.id },
      data: { grantedByUserId: ids.ownerA, expiresAt: new Date(Date.now() + HOUR) },
    });
    expect(await refused(ids.firmA, approved.id)).toMatch(/no pending support request of yours/);
    const revoked = await asAdmin((tx) =>
      tx.supportAccessGrant.create({
        data: { businessId: ids.firmA, adminUserId: ids.admin, reason: 'Fake, revoked' },
      }),
    );
    await db
      .forBusiness(ids.firmA)
      .supportAccessGrant.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } });
    expect(await refused(ids.firmA, revoked.id)).toMatch(/no pending support request of yours/);
    // Not from a firm's scope, nor the platform's.
    for (const scope of [
      { kind: 'business', businessId: ids.firmA },
      { kind: 'platform' },
    ] as const) {
      expect(await outcome(runInScope(app, scope, (tx) => log(tx, ids.firmA, mine.id)))).toMatch(
        /only a Super Admin/,
      );
    }
  });

  it('PUBLIC may not run it, the app role may', async () => {
    const [rights] = await owner.$queryRaw<{ app: boolean; pub: boolean }[]>`
      SELECT has_function_privilege('firmivra_app', ${SIGNATURE}, 'EXECUTE') AS app,
             EXISTS (SELECT 1 FROM information_schema.routine_privileges
                     WHERE routine_name = 'app_log_support_request' AND grantee = 'PUBLIC') AS pub`;
    expect(rights).toEqual({ app: true, pub: false });
  });

  it('owned by a role that is no superuser (as on RDS), it still reads, locks and writes under RLS', async () => {
    const role = `fv_srl_${run}`;
    const [me] = await owner.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
    const migrate = me!.name;
    await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
    await owner.$executeRawUnsafe(`GRANT "${migrate}" TO ${role}`);
    await owner.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO ${role}`);
    await owner.$executeRawUnsafe(`ALTER FUNCTION ${SIGNATURE} OWNER TO ${role}`);
    try {
      const grant = await ask(ids.firmA);
      expect(await firmRows(grant.id)).toHaveLength(1);
      expect(await outcome(asAdmin((tx) => log(tx, ids.firmA, grant.id)))).toMatch(
        /already in the firm's log/,
      );
    } finally {
      await owner.$executeRawUnsafe(`ALTER FUNCTION ${SIGNATURE} OWNER TO "${migrate}"`);
      await owner.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });
});
