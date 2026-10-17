import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Test helpers. Tests run against `<database>_test` next to the dev database, so they never
 * touch dev data. Import from '@firmivra/db/testing' in test setup only.
 */

const DB_PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

function withDatabaseName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (copy .env.example to .env)`);
  return value;
}

/**
 * Owner and app connection strings for a test database named `<database>_<suffix>`.
 * Each package's tests use their own suffix so parallel test runs never share data.
 */
export function testDatabaseUrls(suffix = 'test'): { owner: string; app: string } {
  const owner = required('DATABASE_URL');
  const app = required('DATABASE_URL_APP');
  const name = `${databaseName(owner)}_${suffix}`;
  return { owner: withDatabaseName(owner, name), app: withDatabaseName(app, name) };
}

/**
 * Creates the test database if needed, applies all migrations and empties every table.
 * Needs an owner role that can create databases (local Docker and CI Postgres are superusers).
 */
export async function prepareTestDatabase(
  suffix = 'test',
): Promise<{ owner: string; app: string }> {
  const urls = testDatabaseUrls(suffix);
  const name = databaseName(urls.owner);

  const admin = new pg.Client({ connectionString: withDatabaseName(urls.owner, 'postgres') });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: urls.owner },
    stdio: 'pipe',
  });

  const owner = new pg.Client({ connectionString: urls.owner });
  await owner.connect();
  try {
    // Every table, from the catalog: a hand-kept list missed tables with no foreign-key path to
    // the listed ones (compliance_calendars, for one), so on a reused local test database a fixed
    // seed id survived from the last run and broke the next seed.
    const { rows } = await owner.query<{ name: string }>(
      `SELECT quote_ident(tablename) AS name FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    await owner.query(`TRUNCATE ${rows.map((r) => r.name).join(', ')} CASCADE`);
  } finally {
    await owner.end();
  }
  return urls;
}

/**
 * Client options for tests. Several suites (or other sessions' suites) on one Postgres can keep
 * an interactive transaction from starting within Prisma's default 2 s, which fails a file's
 * setup with "Unable to start a transaction in the given time". Wait longer instead.
 */
export const TEST_CLIENT_OPTIONS = {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
} as const;
