// "Seed loads" (R0 done-when): the real seed runs against the test database, twice (it must be
// safe to run again), and afterwards every table has rows and every firm table has LVP rows.
// A new table without seed data, or a rule change that breaks the seed, fails here.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FirmApplicationRecord } from '@firmivra/types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { SEED_LVP_APPLICATION_OLD_DATA, SEED_PLATFORM_IDS } from '../prisma/seed-data.js';

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

    // Every LVP answer is a question of its stored form (the form engine refuses other keys).
    const { rows: strays } = await client.query(
      `SELECT k.key FROM intake_submissions s
         JOIN intakes i ON i.id = s.intake_id JOIN intake_forms f ON f.id = i.form_id
         CROSS JOIN jsonb_object_keys(s.answers) AS k(key)
       WHERE s.business_id = $1 AND NOT jsonb_path_exists(f.definition,
         '$.steps[*].sections[*].fields[*] ? (@.key == $k)', jsonb_build_object('k', k.key))`,
      [lvpId],
    );
    expect(strays).toEqual([]);
  }, 180_000);

  it("stores LVP's application form so the review page reads it, and repairs an older seed's", async () => {
    // The API's StoredApplication: what the Super Admin's review page reads (formReadable).
    const R = FirmApplicationRecord.shape;
    const StoredApplication = z.object({
      business: R.business.unwrap().omit({ einLast4: true }),
      primaryAdmin: R.primaryAdmin.unwrap(),
      account: R.account.unwrap(),
      credentials: R.credentials,
    });
    const lvpApplication = async () => {
      const { rows } = await client.query<{ data: unknown; contact_phone: string | null }>(
        `SELECT data, contact_phone FROM firm_applications WHERE id = $1`,
        [SEED_PLATFORM_IDS.lvpApplication],
      );
      return rows[0]!;
    };

    const seeded = await lvpApplication();
    expect(StoredApplication.safeParse(seeded.data).success).toBe(true);
    expect(seeded.contact_phone).toBe('+14045550100');

    // An older seed's row, written in platform scope as the seed writes it.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.scope', 'platform', true)`);
    await client.query(
      `UPDATE firm_applications SET data = $2, contact_phone = NULL WHERE id = $1`,
      [SEED_PLATFORM_IDS.lvpApplication, SEED_LVP_APPLICATION_OLD_DATA],
    );
    await client.query('COMMIT');
    expect(StoredApplication.safeParse((await lvpApplication()).data).success).toBe(false);
    runSeed();
    expect(await lvpApplication()).toEqual(seeded);
  }, 120_000);
});
