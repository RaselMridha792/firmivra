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
