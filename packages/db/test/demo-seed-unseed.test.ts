// R0, PART 2: the demo seed and unseed round-trip, over every stage (seedDemo). Proves that a second
// `pnpm db:seed:demo` changes no row count in any table, that `pnpm db:unseed:demo` removes exactly
// what the seed created (table by table, plus the business row and the synthetic users) and
// nothing else, that it is safe to call again once there is nothing left, that it works as the
// migrate role works on RDS (no superuser, no BYPASSRLS) and puts every RLS and trigger setting back
// as it was, and that deleting a whole firm this way never weakens memberships_keep_an_owner for an
// ordinary firm that keeps existing (R0-schema's r0_last_owner rule). Tables are found from the
// catalog, so a later stage's new module is covered without editing this file.
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs, which would stall or deadlock other files'
// transactions in a shared database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { seedDemo } from '../prisma/seed-demo-all.js';
import { SEED_DEMO_BUSINESS, SEED_DEMO_USERS } from '../prisma/seed-demo-data.js';
import { demoUserIds, unseedDemoOrg } from '../prisma/unseed-demo-org.js';

let owner: ReturnType<typeof createPrismaClient>;
let appUrl: string;
const SLOW = 240_000;

beforeAll(async () => {
  const urls = await prepareTestDatabase('demo_seed');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  appUrl = urls.app;
}, SLOW);

afterAll(async () => {
  await unseedDemoOrg(owner);
  await owner.$disconnect();
});

/**
 * Rows per table for one business, every table with a business_id column (non-zero only). The
 * test owner is a superuser and skips RLS, so each count filters by business_id itself.
 */
async function rowsOf(businessId: string): Promise<Record<string, number>> {
  const tables = await owner.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'business_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    // The name comes from the catalog, not from input.
    const [row] = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${table_name}" WHERE business_id = $1::uuid`,
      businessId,
    );
    const n = Number(row!.n);
    if (n > 0) counts[table_name] = n;
  }
  return counts;
}

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
    'seeds every stage; a second run changes nothing; unseed removes exactly what was created',
    async () => {
      const seeded = await seedDemo(owner);
      const first = await rowsOf(seeded.businessId);
      // Stage 1 (the firm) and stage 2 (client work) are both there.
      expect(first).toMatchObject({ memberships: 7, clients: 25, departments: 3, teams: 3 });
      for (const table of [
        'engagements',
        'tasks',
        'notes',
        'tax_returns',
        'invoices',
        'offline_payments',
        'appointments',
        'working_hours',
        'document_requests',
        'documents',
        'message_threads',
        'messages',
      ]) {
        expect(first[table], table).toBeGreaterThan(0);
      }

      const again = await seedDemo(owner);
      expect(again.businessId).toBe(seeded.businessId);
      expect(await rowsOf(seeded.businessId)).toEqual(first);

      const result = await unseedDemoOrg(owner);
      expect(result?.businessId).toBe(seeded.businessId);
      expect(result?.deletedUsers).toBe(Object.keys(SEED_DEMO_USERS).length + 1); // + the portal client
      const deleted = Object.fromEntries(
        result!.tables.map((r) => [r.table_name, Number(r.deleted)]),
      );
      expect(deleted).toEqual({ ...first, businesses: 1 });
      expect(await rowsOf(seeded.businessId)).toEqual({});

      const business = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.findUnique({ where: { slug: SEED_DEMO_BUSINESS.slug } }),
      );
      expect(business).toBeNull();
      expect(await owner.user.count({ where: { id: { in: demoUserIds() } } })).toBe(0);
    },
    SLOW,
  );

  it('is a no-op once there is nothing left to unseed', async () => {
    await expect(unseedDemoOrg(owner)).resolves.toBeNull();
  });

  it(
    'works as the migrate role on RDS (no superuser, no BYPASSRLS) and puts every setting back',
    async () => {
      const seeded = await seedDemo(owner);
      const before = await settings();
      const created = await rowsOf(seeded.businessId);
      const role = `fv_unseed_${randomUUID().slice(0, 8)}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        const rows = await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            return tx.$queryRaw<{ table_name: string; deleted: bigint }[]>`
              SELECT * FROM app_delete_business_data(${seeded.businessId}::uuid,
                ${demoUserIds()}::uuid[])`;
          },
          { timeout: SLOW },
        );
        const deleted = Object.fromEntries(rows.map((r) => [r.table_name, Number(r.deleted)]));
        // Including what firm-scope policies alone never let it delete: append-only history and
        // payments, the business itself and the staff logins.
        expect(deleted).toEqual({ ...created, businesses: 1, users: 8 });
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }
      expect(await rowsOf(seeded.businessId)).toEqual({});
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
      const seeded = await seedDemo(owner);
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
