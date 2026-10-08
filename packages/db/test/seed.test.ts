// "Seed loads" (R0 done-when): the real seed runs against the test database, twice (it must be
// safe to run again), and afterwards every table has rows and every firm table has LVP rows.
// A new table without seed data, or a rule change that breaks the seed, fails here.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const urls = inject('dbUrls');
const client = new pg.Client({ connectionString: urls.owner });
const DB_PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

const runSeed = () =>
  execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: urls.owner },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe('seed', () => {
  it('loads, runs again, and leaves rows in every table and LVP rows in every firm table', async () => {
    runSeed();
    runSeed();

    const { rows: lvp } = await client.query<{ id: string }>(
      `SELECT id FROM businesses WHERE slug = 'lvp'`,
    );
    expect(lvp).toHaveLength(1);
    const lvpId = lvp[0]!.id;

    const { rows: tables } = await client.query<{ name: string; tenant: boolean }>(`
      SELECT c.relname AS name,
             EXISTS (SELECT 1 FROM information_schema.columns k
                     WHERE k.table_schema = 'public' AND k.table_name = c.relname
                       AND k.column_name = 'business_id') AS tenant
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`);
    expect(tables.length).toBeGreaterThan(40);

    const empty: string[] = [];
    for (const t of tables) {
      const sql = t.tenant
        ? `SELECT count(*)::int AS n FROM "${t.name}" WHERE business_id = $1`
        : `SELECT count(*)::int AS n FROM "${t.name}"`;
      const { rows } = await client.query<{ n: number }>(sql, t.tenant ? [lvpId] : []);
      if (rows[0]!.n === 0) empty.push(t.name);
    }
    expect(empty).toEqual([]);
  }, 180_000);
});
