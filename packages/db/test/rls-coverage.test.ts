// Guards against a future migration adding a table without row-level security.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const urls = inject('dbUrls');
const client = new pg.Client({ connectionString: urls.owner });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe('row-level security coverage', () => {
  it('every table has RLS enabled and forced, with at least one policy', async () => {
    const { rows } = await client.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`);
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows
      .filter((r) => !r.rls || !r.forced || r.policies === 0)
      .map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it('every table with business_id is covered', async () => {
    const { rows } = await client.query<{ table: string }>(`
      SELECT c.table_name AS table FROM information_schema.columns c
      JOIN pg_class t ON t.relname = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'business_id' AND NOT t.relforcerowsecurity`);
    expect(rows).toEqual([]);
  });

  it('the app role can reach every table, and nothing else in public', async () => {
    const { rows } = await client.query<{ table: string; select: boolean; insert: boolean }>(`
      SELECT c.relname AS table,
             has_table_privilege('firmivra_app', c.oid, 'SELECT') AS select,
             has_table_privilege('firmivra_app', c.oid, 'INSERT') AS insert
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    const app = rows.filter((r) => r.table !== '_prisma_migrations');
    // platform_admins is read-only for the app: Super Admins are added by ops or the seed. The
    // others are written only by their triggers, running as the table owner.
    const readOnly = [
      'platform_admins',
      'client_tax_status_history',
      'platform_user_signups',
      'platform_owner_invites',
    ];
    expect(app.filter((r) => !r.select).map((r) => r.table)).toEqual([]);
    expect(app.filter((r) => !r.insert && !readOnly.includes(r.table)).map((r) => r.table)).toEqual(
      [],
    );
    expect(rows.find((r) => r.table === '_prisma_migrations')).toMatchObject({
      select: false,
      insert: false,
    });
  });

  it('keeps the deliberate limits: append-only tables, nothing deleted that is kept as a record', async () => {
    const { rows } = await client.query<{ tbl: string; privilege: string; granted: boolean }>(`
      SELECT p.tbl, p.privilege, has_table_privilege('firmivra_app', p.tbl, p.privilege) AS granted
      FROM (VALUES ('audit_logs', 'UPDATE'), ('audit_logs', 'DELETE'),
                   ('support_access_grants', 'DELETE'),
                   ('firm_legal_documents', 'UPDATE'), ('firm_legal_documents', 'DELETE'),
                   ('invites', 'DELETE'),
                   ('clients', 'DELETE'), ('client_profiles', 'DELETE'),
                   ('client_tax_statuses', 'DELETE'),
                   ('client_tax_status_history', 'INSERT'),
                   ('client_tax_status_history', 'UPDATE'),
                   ('client_tax_status_history', 'DELETE'),
                   ('engagements', 'DELETE'),
                   ('engagement_status_history', 'UPDATE'),
                   ('engagement_status_history', 'DELETE'),
                   ('document_requests', 'DELETE'),
                   ('intakes', 'DELETE'), ('intake_submissions', 'DELETE'),
                   ('leads', 'DELETE'),
                   ('notifications', 'DELETE'), ('notification_deliveries', 'DELETE'),
                   ('appointments', 'DELETE'),
                   ('message_threads', 'DELETE'), ('messages', 'DELETE'),
                   ('message_attachments', 'UPDATE'), ('message_attachments', 'DELETE'),
                   ('client_private_notes', 'UPDATE'), ('client_private_notes', 'DELETE'),
                   ('invoices', 'DELETE'), ('payments', 'DELETE'), ('payment_events', 'DELETE'),
                   ('payment_refunds', 'DELETE'),
                   ('businesses', 'DELETE'),
                   ('platform_user_signups', 'INSERT'), ('platform_user_signups', 'UPDATE'),
                   ('platform_user_signups', 'DELETE'),
                   ('platform_owner_invites', 'INSERT'), ('platform_owner_invites', 'UPDATE'),
                   ('platform_owner_invites', 'DELETE'),
                   ('platform_admins', 'INSERT'), ('platform_admins', 'UPDATE'),
                   ('platform_admins', 'DELETE'),
                   ('firm_agreements', 'DELETE'),
                   ('firm_agreement_files', 'DELETE'),
                   ('firm_agreement_versions', 'UPDATE'), ('firm_agreement_versions', 'DELETE'),
                   ('intake_signatures', 'UPDATE'), ('intake_signatures', 'DELETE'),
                   ('intake_signature_agreements', 'UPDATE'),
                   ('intake_signature_agreements', 'DELETE')) AS p(tbl, privilege)`);
    expect(rows.filter((r) => r.granted).map((r) => `${r.tbl} ${r.privilege}`)).toEqual([]);
  });

  it('agreements and their files update only the columns the workflow changes', async () => {
    const { rows } = await client.query<{ col: string }>(`
      SELECT table_name || '.' || column_name AS col
      FROM information_schema.column_privileges
      WHERE grantee = 'firmivra_app' AND privilege_type = 'UPDATE'
        AND table_name IN ('firm_agreements', 'firm_agreement_files')
      ORDER BY 1`);
    expect(rows.map((r) => r.col)).toEqual([
      'firm_agreement_files.scan_status',
      'firm_agreement_files.scanned_at',
      'firm_agreements.archived_at',
      'firm_agreements.sort_order',
      'firm_agreements.updated_at',
    ]);
  });

  it('the app role cannot bypass RLS', async () => {
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'firmivra_app'`,
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});
