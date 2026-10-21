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
    // These are written only by their triggers, running as the table owner. (platform_admins:
    // the app inserts TEAM_MEMBER rows only; see the TEAM_MEMBER test below.)
    const readOnly = [
      'client_tax_status_history',
      'tax_return_history',
      'client_status_history',
      'platform_user_signups',
      'platform_owner_invites',
      // Only support_next_ticket_number() (owner-run) moves the ticket counter.
      'support_ticket_counters',
      // Only platform_billing_next_number() (owner-run) moves the document counters.
      'platform_billing_counters',
      // One row, inserted by its migration; the app only saves it.
      'platform_security_policy',
      // Written only by the owner-run sales_opportunities_history() trigger.
      'sales_stage_history',
      'sales_assignment_history',
      // One row, inserted by its migration; the app only saves it.
      'sales_attention_settings',
      // Sections and retention categories are inserted by their migration; the app only saves them.
      'platform_settings',
      'platform_retention_policies',
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
                   ('tax_return_history', 'INSERT'), ('tax_return_history', 'UPDATE'),
                   ('tax_return_history', 'DELETE'),
                   ('client_status_history', 'INSERT'), ('client_status_history', 'UPDATE'),
                   ('client_status_history', 'DELETE'),
                   ('engagements', 'DELETE'),
                   ('engagement_status_history', 'UPDATE'),
                   ('engagement_status_history', 'DELETE'),
                   ('document_requests', 'DELETE'),
                   ('intakes', 'DELETE'), ('intake_submissions', 'DELETE'),
                   ('leads', 'DELETE'), ('lead_activities', 'UPDATE'), ('lead_activities', 'DELETE'),
                   ('notifications', 'DELETE'), ('notification_deliveries', 'DELETE'),
                   ('appointments', 'DELETE'),
                   ('message_threads', 'DELETE'), ('messages', 'DELETE'),
                   ('message_attachments', 'UPDATE'), ('message_attachments', 'DELETE'),
                   ('client_private_notes', 'UPDATE'), ('client_private_notes', 'DELETE'),
                   ('invoices', 'DELETE'), ('payments', 'DELETE'), ('payment_events', 'DELETE'),
                   ('payment_refunds', 'DELETE'), ('offline_payments', 'DELETE'),
                   ('businesses', 'DELETE'),
                   ('platform_user_signups', 'INSERT'), ('platform_user_signups', 'UPDATE'),
                   ('platform_user_signups', 'DELETE'),
                   ('platform_owner_invites', 'INSERT'), ('platform_owner_invites', 'UPDATE'),
                   ('platform_owner_invites', 'DELETE'),
                   ('platform_admins', 'UPDATE'), ('platform_admins', 'DELETE'),
                   ('firm_agreements', 'DELETE'),
                   ('firm_agreement_files', 'DELETE'),
                   ('firm_agreement_versions', 'UPDATE'), ('firm_agreement_versions', 'DELETE'),
                   ('intake_signatures', 'UPDATE'), ('intake_signatures', 'DELETE'),
                   ('intake_signature_agreements', 'UPDATE'),
                   ('intake_signature_agreements', 'DELETE'),
                   ('security_alerts', 'DELETE'), ('audit_investigation_notes', 'DELETE'),
                   ('platform_security_policy', 'INSERT'),
                   ('platform_security_policy', 'DELETE'),
                   ('sales_pipelines', 'DELETE'), ('sales_opportunities', 'DELETE'),
                   ('sales_follow_ups', 'DELETE'),
                   ('sales_activities', 'UPDATE'), ('sales_activities', 'DELETE'),
                   ('sales_stage_history', 'INSERT'), ('sales_stage_history', 'UPDATE'),
                   ('sales_stage_history', 'DELETE'),
                   ('sales_assignment_history', 'INSERT'), ('sales_assignment_history', 'UPDATE'),
                   ('sales_assignment_history', 'DELETE'),
                   ('sales_attention_settings', 'INSERT'),
                   ('sales_attention_settings', 'DELETE'),
                   ('comm_conversations', 'DELETE'), ('comm_templates', 'DELETE'),
                   ('comm_template_categories', 'DELETE'), ('comm_media', 'DELETE'),
                   ('comm_segments', 'DELETE'), ('comm_broadcast_recipients', 'DELETE'),
                   ('comm_message_mentions', 'UPDATE'), ('comm_message_mentions', 'DELETE'),
                   ('comm_conversation_reads', 'DELETE'),
                   ('platform_settings', 'INSERT'), ('platform_settings', 'DELETE'),
                   ('platform_retention_policies', 'INSERT'), ('platform_retention_policies', 'DELETE'),
                   ('platform_brand_assets', 'DELETE'), ('platform_legal_holds', 'DELETE'),
                   ('platform_retention_runs', 'DELETE'), ('platform_maintenance_windows', 'DELETE'),
                   ('platform_job_controls', 'DELETE'),
                   ('platform_default_sets', 'UPDATE'), ('platform_default_sets', 'DELETE'),
                   ('platform_default_set_applications', 'UPDATE'),
                   ('platform_default_set_applications', 'DELETE'),
                   ('platform_integrations', 'DELETE'), ('platform_integration_runs', 'DELETE'),
                   ('platform_integration_logs', 'UPDATE'), ('platform_integration_logs', 'DELETE'),
                   ('platform_integration_catalog', 'DELETE'), ('platform_api_keys', 'DELETE'),
                   ('platform_webhook_endpoints', 'DELETE'), ('platform_webhook_deliveries', 'DELETE'),
                   ('platform_integration_usage_daily', 'DELETE'),
                   ('platform_feature_usage_daily', 'DELETE'),
                   ('platform_firm_metrics_daily', 'DELETE'),
                   ('bookkeeping_transactions', 'DELETE'), ('bookkeeping_refunds', 'DELETE'),
                   ('bookkeeping_settlements', 'DELETE'), ('bookkeeping_report_versions', 'DELETE'),
                   ('bookkeeping_terms', 'DELETE'), ('bookkeeping_terms_events', 'UPDATE'),
                   ('bookkeeping_terms_events', 'DELETE'),
                   ('client_compliance_facts', 'DELETE'),
                   ('client_sales_tax_registrations', 'DELETE')) AS p(tbl, privilege)`);
    expect(rows.filter((r) => r.granted).map((r) => `${r.tbl} ${r.privilege}`)).toEqual([]);
  });

  it('lets the app insert TEAM_MEMBER platform_admins rows only, in platform scope', async () => {
    // r0_platform_admins_team_insert: INSERT is granted for Team invitations, and a restrictive
    // policy for the app role allows TEAM_MEMBER rows in platform scope only. Super Admins are
    // added by ops or the seed (the owner); UPDATE and DELETE stay revoked (the limits above).
    const { rows } = await client.query<{
      permissive: string;
      cmd: string;
      roles: string[];
      check: string;
    }>(`
      SELECT permissive, cmd, roles::text[] AS roles, with_check AS check
      FROM pg_policies
      WHERE tablename = 'platform_admins' AND policyname = 'platform_admins_app_insert_team_member'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      permissive: 'RESTRICTIVE',
      cmd: 'INSERT',
      roles: ['firmivra_app'],
    });
    expect(rows[0]?.check).toContain(`'TEAM_MEMBER'`);
    expect(rows[0]?.check).toContain(`'platform'`);
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
