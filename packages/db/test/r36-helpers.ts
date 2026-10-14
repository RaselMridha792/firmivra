// Shared by the R36 tests (invoices, services, messages, client portal tab, branding). Not a test file.
import { expect } from 'vitest';
import { runInScope, type createPrismaClient } from '../src/client.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * How many rows of `ofFirm` the scope of `seenBy` sees in `table` (names and ids come from the
 * test, never from input).
 */
export async function rowsSeenBy(app: PrismaClient, seenBy: string, table: string, ofFirm: string) {
  const rows = await runInScope(app, { kind: 'business', businessId: seenBy }, (tx) =>
    tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${table} WHERE business_id = '${ofFirm}'::uuid`,
    ),
  );
  return rows[0]?.n ?? 0;
}

/**
 * Row-level security for firm tables: firm A has rows in each table, firm B has rows of its own
 * (for the second check), and neither firm sees the other's rows. Create rows for both first.
 */
export async function expectInvisibleToOtherFirm(
  app: PrismaClient,
  firmA: string,
  firmB: string,
  tables: string[],
) {
  for (const table of tables) {
    expect(await rowsSeenBy(app, firmA, table, firmA), `${table}: A sees its own`).toBeGreaterThan(
      0,
    );
    expect(await rowsSeenBy(app, firmB, table, firmA), `${table}: B sees A's`).toBe(0);
    expect(await rowsSeenBy(app, firmA, table, firmB), `${table}: A sees B's`).toBe(0);
  }
}

/** Two fresh firms and one client of firm A, made as the owner role (the test's setup). */
export async function createFirms(owner: PrismaClient, tag: string) {
  const run = Math.random().toString(36).slice(2, 8);
  const firms = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
    firmA: (await tx.business.create({ data: { slug: `${tag}-a-${run}`, name: 'A' } })).id,
    firmB: (await tx.business.create({ data: { slug: `${tag}-b-${run}`, name: 'B' } })).id,
  }));
  const client = await runInScope(owner, { kind: 'business', businessId: firms.firmA }, (tx) =>
    tx.client.create({ data: { businessId: firms.firmA, displayName: 'Fake Client' } }),
  );
  return { ...firms, client: client.id, run };
}
