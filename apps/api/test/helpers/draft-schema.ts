import type { PrismaClient } from '@firmivra/db';

/** Test-only contract fixtures, NEVER production migrations. Must use an isolated test DB. */
export async function installDraftSchema(owner: PrismaClient, statements: readonly string[]) {
  const [row] = await owner.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!row || !row.name.endsWith('_test_api'))
    throw new Error('Draft schema fixture requires the isolated API test database');
  for (const statement of statements) await owner.$executeRawUnsafe(statement);
}
export const applicationHistoryFixture = [
  `CREATE TABLE IF NOT EXISTS firm_application_histories (id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES firm_applications(id), from_status text, to_status text NOT NULL, actor_user_id uuid REFERENCES users(id), reason text, created_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE firm_application_histories ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE firm_application_histories FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS fixture_platform ON firm_application_histories`,
  `CREATE POLICY fixture_platform ON firm_application_histories USING (app_scope()='platform') WITH CHECK (app_scope()='platform')`,
  `GRANT SELECT ON firm_application_histories TO firmivra_app`,
  `REVOKE INSERT,UPDATE,DELETE ON firm_application_histories FROM firmivra_app`,
];
