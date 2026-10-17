// The reusable half of `pnpm db:unseed:demo` (R0, PART 2): removes exactly what the demo seed
// created, and nothing else. Separate from unseed-demo.ts (the CLI script) the same way
// seed-demo-org.ts is separate from seed-demo.ts: a plain function with no top-level side effect,
// so a test can import it without running anything at import time.
import type { createPrismaClient } from '../src/client.js';
import {
  demoApplicationId,
  demoFirmOwnerId,
  demoId,
  demoSignupUserId,
  SEED_DEMO_APPLICATIONS,
  SEED_DEMO_BUSINESS,
  SEED_DEMO_CLIENTS,
  SEED_DEMO_FIRMS,
  SEED_DEMO_SIGNUPS,
  SEED_DEMO_USERS,
} from './seed-demo-data.js';

type Prisma = ReturnType<typeof createPrismaClient>;

type Row = { table_name: string; deleted: bigint };

export interface UnseedDemoOrgResult {
  /** The `demo` firm's id. */
  businessId: string;
  /** Rows deleted per table across every demo firm, the business rows included, the users not. */
  tables: Row[];
  deletedUsers: number;
}

/** The demo's own logins: owner and staff, the portal client, sign-ups, the other firms' owners. */
export const demoUserIds = (): string[] => [
  ...Object.values(SEED_DEMO_USERS).map((u) => u.id),
  ...SEED_DEMO_CLIENTS.filter((c) => c.portal).map((c) => demoId(`user:client:${c.key}`)),
  ...SEED_DEMO_SIGNUPS.map((s) => demoSignupUserId(s.key)),
  ...SEED_DEMO_FIRMS.map((f) => demoFirmOwnerId(f.slug)),
];

/** Applications that never became a firm (a firm's own goes with the firm). */
export const demoApplicationIds = (): string[] =>
  SEED_DEMO_APPLICATIONS.map((a) => demoApplicationId(a.key));

const add = (into: Map<string, bigint>, rows: Row[]) => {
  for (const r of rows) into.set(r.table_name, (into.get(r.table_name) ?? 0n) + BigInt(r.deleted));
};

/** Anything that can run a raw query: the client, or a transaction (as a test may, under a role). */
type Sql = Pick<Prisma, '$queryRaw'>;

/**
 * Deletes every demo firm (the 8 `demo-` firms, then `demo` with the demo's logins) and the demo's
 * standalone applications, through `sql`. `null` if the `demo` firm is not there.
 */
export async function unseedDemoIn(sql: Sql): Promise<UnseedDemoOrgResult | null> {
  const slugs = [SEED_DEMO_BUSINESS.slug, ...SEED_DEMO_FIRMS.map((f) => f.slug)];
  // Platform scope for this read (businesses has FORCE RLS; on RDS the owner goes through it).
  // Its own statement, so the policy sees it.
  await sql.$queryRaw`SELECT set_config('app.scope', 'platform', true)`;
  const firms = await sql.$queryRaw<{ id: string; slug: string }[]>`
    SELECT id::text AS id, slug FROM businesses WHERE slug = ANY (${slugs}::text[])`;
  const demo = firms.find((f) => f.slug === SEED_DEMO_BUSINESS.slug);
  if (!demo) return null;

  const totals = new Map<string, bigint>();
  // Owner/migrate role only. The other firms first, then `demo` with every demo login, which the
  // function can delete once no membership or client account points at it any more.
  for (const firm of firms.filter((f) => f.id !== demo.id)) {
    add(
      totals,
      await sql.$queryRaw<Row[]>`
      SELECT * FROM app_delete_business_data(${firm.id}::uuid, '{}'::uuid[])`,
    );
  }
  add(
    totals,
    await sql.$queryRaw<Row[]>`
    SELECT * FROM app_delete_business_data(${demo.id}::uuid, ${demoUserIds()}::uuid[])`,
  );
  add(
    totals,
    await sql.$queryRaw<Row[]>`
    SELECT * FROM app_delete_firm_applications(${demoApplicationIds()}::uuid[])`,
  );

  const deletedUsers = Number(totals.get('users') ?? 0n);
  totals.delete('users');
  return {
    businessId: demo.id,
    tables: [...totals].map(([table_name, deleted]) => ({ table_name, deleted })),
    deletedUsers,
  };
}

/** The whole unseed in one transaction: all of it, or none of it. */
export async function unseedDemoOrg(prisma: Prisma): Promise<UnseedDemoOrgResult | null> {
  return prisma.$transaction((tx) => unseedDemoIn(tx));
}
