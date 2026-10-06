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
    expect(app.filter((r) => !r.select || !r.insert).map((r) => r.table)).toEqual([]);
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
                   ('client_tax_status_history', 'UPDATE'),
                   ('client_tax_status_history', 'DELETE'),
                   ('engagements', 'DELETE'),
                   ('engagement_status_history', 'UPDATE'),
                   ('engagement_status_history', 'DELETE'),
                   ('document_requests', 'DELETE'),
                   ('intakes', 'DELETE'), ('intake_submissions', 'DELETE'),
                   ('leads', 'DELETE'),
                   ('notifications', 'DELETE'), ('notification_deliveries', 'DELETE')) AS p(tbl, privilege)`);
    expect(rows.filter((r) => r.granted).map((r) => `${r.tbl} ${r.privilege}`)).toEqual([]);
  });

  it('the app role cannot bypass RLS', async () => {
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'firmivra_app'`,
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});
