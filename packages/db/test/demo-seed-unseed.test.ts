// R0, PART 2: the demo seed and unseed round-trip, over every stage (seedDemo) and every demo firm
// (`demo` and the 8 `demo-` firms of stage 4). Proves that a second `pnpm db:seed:demo` changes no
// row count in any table, that `pnpm db:unseed:demo` removes exactly what the seed created (table
// by table across the firms, plus the business rows, the standalone applications and the synthetic
// users) and nothing else, that it is safe to call again once there is nothing left, that it works
// as the migrate role works on RDS (no superuser, no BYPASSRLS) and puts every RLS and trigger
// setting back as it was, and that deleting a whole firm this way never weakens
// memberships_keep_an_owner for an ordinary firm that keeps existing (r0_last_owner). Tables are
// found from the catalog, so a later stage's new module is covered without editing this file.
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs, which would stall or deadlock other files'
// transactions in a shared database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { seedDemo } from '../prisma/seed-demo-all.js';
import { SEED_DEMO_BUSINESS, SEED_DEMO_FIRMS } from '../prisma/seed-demo-data.js';
import { seedPlatformPlans } from '../prisma/seed-platform-plans.js';
import {
  demoApplicationIds,
  demoUserIds,
  unseedDemoIn,
  unseedDemoOrg,
} from '../prisma/unseed-demo-org.js';

let owner: ReturnType<typeof createPrismaClient>;
let appUrl: string;
const SLOW = 300_000;
const SLUGS = [SEED_DEMO_BUSINESS.slug, ...SEED_DEMO_FIRMS.map((f) => f.slug)];

beforeAll(async () => {
  const urls = await prepareTestDatabase('demo_seed');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  appUrl = urls.app;
  // Stage 4 acts as the earliest SUPER_ADMIN and needs the plan ladder; a fresh database has
  // neither (on dev, the real admins and the platform-org bootstrap provide them).
  const admin = randomUUID();
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: admin,
        cognitoSub: admin,
        pool: 'ADMIN',
        email: `${admin}@sup.test`,
        name: 'Reviewer',
      },
    });
    await tx.platformAdmin.create({ data: { userId: admin, role: 'SUPER_ADMIN' } });
  });
  await seedPlatformPlans(owner);
}, SLOW);

afterAll(async () => {
  await unseedDemoOrg(owner);
  await owner.$disconnect();
});

const firmIds = async () =>
  (await owner.business.findMany({ where: { slug: { in: SLUGS } }, select: { id: true } })).map(
    (b) => b.id,
  );

/**
 * Every row the demo owns: per firm table, summed over the demo firms (non-zero only), plus the
 * business rows, the standalone applications with their history, and the demo's logins. The test
 * owner is a superuser and skips RLS, so each count filters by business_id itself.
 */
async function demoRows(): Promise<Record<string, number>> {
  const ids = await firmIds();
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
      `SELECT count(*) AS n FROM "${table_name}" WHERE business_id = ANY ($1::uuid[])`,
      ids,
    );
    if (Number(row!.n) > 0) counts[table_name] = Number(row!.n);
  }
  const apps = demoApplicationIds();
  const [standalone] = await owner.$queryRaw<{ apps: bigint; history: bigint }[]>`
    SELECT (SELECT count(*) FROM firm_applications WHERE id = ANY (${apps}::uuid[])) AS apps,
           (SELECT count(*) FROM firm_application_status_history h
             JOIN firm_applications a ON a.id = h.application_id
             WHERE a.id = ANY (${apps}::uuid[]) OR a.business_id = ANY (${ids}::uuid[])) AS history`;
  const extra: Record<string, number> = {
    businesses: ids.length,
    firm_applications: (counts['firm_applications'] ?? 0) + Number(standalone!.apps),
    firm_application_status_history: Number(standalone!.history),
    users: await owner.user.count({ where: { id: { in: demoUserIds() } } }),
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v > 0) counts[k] = v;
    else delete counts[k];
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

const asTotals = (r: {
  tables: { table_name: string; deleted: bigint }[];
  deletedUsers: number;
}) => ({
  ...Object.fromEntries(r.tables.map((t) => [t.table_name, Number(t.deleted)])),
  users: r.deletedUsers,
});

describe('demo seed and unseed', () => {
  it(
    'seeds every stage; a second run changes nothing; unseed removes exactly what was created',
    async () => {
      const seeded = await seedDemo(owner);
      const first = await demoRows();
      expect(first).toMatchObject({
        businesses: SLUGS.length,
        memberships: 7 + 7, // the demo firm's 7, and one owner in each firm past setup
        clients: 25,
        users: demoUserIds().length,
        firm_applications: SEED_DEMO_FIRMS.length + demoApplicationIds().length,
      });
      for (const table of [
        'engagements',
        'tasks',
        'invoices',
        'offline_payments',
        'appointments',
        'documents',
        'messages',
        'intakes',
        'intake_signatures',
        'leads',
        'lead_activities',
        'esign_requests',
        'notifications',
        'platform_firm_subscriptions',
        'firm_application_status_history',
        'client_tax_statuses',
        'content_items',
        'task_types',
        'task_templates',
        'task_series',
        'task_occurrences',
        'task_checklist_items',
        'task_assignees',
        'task_reminders',
        'task_attachments',
        'tags',
        'client_tags',
        'lead_tags',
      ]) {
        expect(first[table], table).toBeGreaterThan(0);
      }

      const again = await seedDemo(owner);
      expect(again.businessId).toBe(seeded.businessId);
      expect(await demoRows()).toEqual(first);

      const result = await unseedDemoOrg(owner);
      expect(result?.businessId).toBe(seeded.businessId);
      expect(asTotals(result!)).toEqual(first);
      expect(await demoRows()).toEqual({});
    },
    SLOW,
  );

  it('is a no-op once there is nothing left to unseed', async () => {
    await expect(unseedDemoOrg(owner)).resolves.toBeNull();
  });

  it(
    'works as the migrate role on RDS (no superuser, no BYPASSRLS) and puts every setting back',
    async () => {
      await seedDemo(owner);
      const created = await demoRows();
      const before = await settings();
      const role = `fv_unseed_${randomUUID().slice(0, 8)}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        const result = await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            return unseedDemoIn(tx);
          },
          { timeout: SLOW },
        );
        // Including what policies alone never let it delete: append-only history and payments,
        // the businesses, the applications and the staff logins.
        expect(asTotals(result!)).toEqual(created);
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }
      expect(await demoRows()).toEqual({});
      expect(await settings()).toEqual(before);
    },
    SLOW,
  );

  it('the app role can run neither function', async () => {
    const app = createPrismaClient(appUrl, TEST_CLIENT_OPTIONS);
    try {
      await expect(
        app.$queryRaw`SELECT * FROM app_delete_business_data(${randomUUID()}::uuid)`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        app.$queryRaw`SELECT * FROM app_delete_firm_applications(${[randomUUID()]}::uuid[])`,
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
