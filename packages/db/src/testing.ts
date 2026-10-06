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
    await owner.query(`TRUNCATE businesses, users, memberships, client_accounts, platform_admins,
      support_access_grants, audit_logs, firm_applications, business_settings,
      firm_legal_documents, tax_statuses, invites, clients, client_profiles, client_tax_statuses,
      client_tax_status_history, services, engagements, engagement_status_history, tasks, notes,
      engagement_reports, document_categories, documents, document_requests, intake_forms, intakes,
      intake_submissions, leads, lead_uploads, notifications, notification_deliveries, legal_acceptances,
      notification_preferences, appointment_types, working_hours, blocked_times, appointments,
      message_threads, messages, message_attachments, client_private_notes, client_note_reminders,
      invoices, invoice_lines, payments, payment_events, content_items, calculator_definitions,
      stripe_accounts, verification_codes CASCADE`);
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
