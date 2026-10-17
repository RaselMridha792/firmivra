// R0, PART 2: the demo seed and unseed round-trip, over every stage (seedDemo). Proves that a second
// `pnpm db:seed:demo` changes no row count in any table, that `pnpm db:unseed:demo` removes exactly
// what the seed created (table by table, plus the business row and the synthetic users) and
// nothing else, that it is safe to call again once there is nothing left, and that deleting a
// whole firm this way never weakens memberships_keep_an_owner for an ordinary firm that keeps
// existing (R0-schema's r0_last_owner rule). Tables are found from the catalog, so a later stage's
// new module is covered without editing this file.
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { seedDemo } from '../prisma/seed-demo-all.js';
import { SEED_DEMO_BUSINESS, SEED_DEMO_USERS } from '../prisma/seed-demo-data.js';
import { unseedDemoOrg } from '../prisma/unseed-demo-org.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const SLOW = 180_000;

/**
 * Rows per table for one business, every table with a business_id column (non-zero only). The
 * owner role bypasses row-level security, so each count filters by business_id itself.
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

afterAll(async () => {
  // Leave the shared test database as it found it, in case a later assertion throws early.
  await unseedDemoOrg(owner);
});

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
