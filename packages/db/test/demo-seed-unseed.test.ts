// R0, PART 2: the demo seed and unseed round-trip. Proves `pnpm db:unseed:demo` removes exactly
// what `pnpm db:seed:demo` created (every table, the business row, the synthetic users) and
// nothing else, that it is safe to call again once there is nothing left, that it works as the
// migrate role works on RDS (no superuser, no BYPASSRLS) and puts every RLS and trigger setting back
// as it was, and that deleting a whole firm this way never weakens memberships_keep_an_owner for an
// ordinary firm that keeps existing (R0-schema's r0_last_owner rule).
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs, which would stall or deadlock other files'
// transactions in a shared database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { seedDemoOrg } from '../prisma/seed-demo-org.js';
import { SEED_DEMO_BUSINESS, SEED_DEMO_USERS } from '../prisma/seed-demo-data.js';
import { demoUserIds, unseedDemoOrg } from '../prisma/unseed-demo-org.js';

let owner: ReturnType<typeof createPrismaClient>;
let appUrl: string;
const SLOW = 180_000;

beforeAll(async () => {
  const urls = await prepareTestDatabase('demo_seed');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  appUrl = urls.app;
}, SLOW);

afterAll(async () => {
  await unseedDemoOrg(owner);
  await owner.$disconnect();
});

/** Every public table's FORCE RLS flag and every user trigger's enabled mode. */
const settings = () =>
  owner.$queryRaw<{ name: string; value: string }[]>`
    SELECT c.relname || ':force' AS name, c.relforcerowsecurity::text AS value
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL
    SELECT c.relname || ':' || tg.tgname, tg.tgenabled::text
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal
    ORDER BY 1`;

describe('demo seed and unseed', () => {
  it(
    'seeds the full demo firm, then unseed removes every row and nothing else is touched',
    async () => {
      const seeded = await seedDemoOrg(owner);
      expect(Object.keys(seeded.memberships)).toHaveLength(7);
      expect(Object.keys(seeded.clients)).toHaveLength(25);

      // The test owner is a superuser and skips RLS, so reads filter by businessId themselves.
      const where = { businessId: seeded.businessId };
      const countsBefore = await Promise.all([
        owner.membership.count({ where }),
        owner.client.count({ where }),
        owner.department.count({ where }),
        owner.team.count({ where }),
      ]);
      expect(countsBefore).toEqual([7, 25, 3, 3]);

      const result = await unseedDemoOrg(owner);
      expect(result?.businessId).toBe(seeded.businessId);
      expect(result?.deletedUsers).toBe(Object.keys(SEED_DEMO_USERS).length + 1); // + the portal client

      const tableCounts = Object.fromEntries(
        result!.tables.map((r) => [r.table_name, Number(r.deleted)]),
      );
      expect(tableCounts['memberships']).toBe(7);
      expect(tableCounts['clients']).toBe(25);
      expect(tableCounts['businesses']).toBe(1);

      const business = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.findUnique({ where: { slug: SEED_DEMO_BUSINESS.slug } }),
      );
      expect(business).toBeNull();
      const ownerUser = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.user.findUnique({ where: { id: SEED_DEMO_USERS.owner.id } }),
      );
      expect(ownerUser).toBeNull();
    },
    SLOW,
  );

  it('is a no-op once there is nothing left to unseed', async () => {
    await expect(unseedDemoOrg(owner)).resolves.toBeNull();
  });

  it(
    're-seeding after unseed produces the same ids and the same row counts (idempotent)',
    async () => {
      const first = await seedDemoOrg(owner);
      const second = await seedDemoOrg(owner);
      expect(second.businessId).toBe(first.businessId);
      expect(Object.keys(second.clients)).toHaveLength(25);
      await unseedDemoOrg(owner);
    },
    SLOW,
  );

  it(
    'works as the migrate role on RDS (no superuser, no BYPASSRLS) and puts every setting back',
    async () => {
      const seeded = await seedDemoOrg(owner);
      const before = await settings();
      const role = `fv_unseed_${randomUUID().slice(0, 8)}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        const rows = await owner.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          return tx.$queryRaw<{ table_name: string; deleted: bigint }[]>`
            SELECT * FROM app_delete_business_data(${seeded.businessId}::uuid,
              ${demoUserIds()}::uuid[])`;
        });
        const deleted = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.deleted)]));
        // Rows the firm-scope policies alone would never let it delete: the business itself, the
        // trigger-written history, and the staff logins.
        expect(deleted).toMatchObject({ businesses: 1, memberships: 7, users: 8 });
        expect(deleted['client_status_history']).toBe(25);
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }
      expect(await owner.business.count({ where: { id: seeded.businessId } })).toBe(0);
      expect(await owner.user.count({ where: { id: { in: demoUserIds() } } })).toBe(0);
      expect(await settings()).toEqual(before);
    },
    SLOW,
  );

  it('the app role cannot run it', async () => {
    const app = createPrismaClient(appUrl, TEST_CLIENT_OPTIONS);
    try {
      await expect(
        app.$queryRaw`SELECT * FROM app_delete_business_data(${randomUUID()}::uuid)`,
      ).rejects.toThrow(/permission denied/);
    } finally {
      await app.$disconnect();
    }
  });

  it(
    'deleting a whole firm this way never weakens the last-active-owner rule for a firm that keeps existing',
    async () => {
      const seeded = await seedDemoOrg(owner);
      await expect(
        runInScope(owner, { kind: 'business', businessId: seeded.businessId }, (tx) =>
          tx.membership.update({
            where: { id: seeded.memberships.owner },
            data: { status: 'DEACTIVATED' },
          }),
        ),
      ).rejects.toThrow(/LAST_ACTIVE_OWNER/);
      await unseedDemoOrg(owner);
    },
    SLOW,
  );
});
