/** Isolated test fixture only. Rasel owns the real migration. */
export const externalLinksSchema = [
  `CREATE TABLE IF NOT EXISTS external_links(id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),section text NOT NULL,title text NOT NULL,description text NOT NULL,url text NOT NULL,source text NOT NULL,icon_key text,sort_order int NOT NULL CHECK(sort_order>=0),active boolean NOT NULL,audience text NOT NULL CHECK(audience IN ('BUSINESS','ALL')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS external_links_directory ON external_links(business_id,active,section,sort_order,id)`,
  `ALTER TABLE external_links ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE external_links FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS fixture_firm ON external_links`,
  `CREATE POLICY fixture_firm ON external_links USING(app_scope()='business' AND business_id=app_current_business_id()) WITH CHECK(app_scope()='business' AND business_id=app_current_business_id())`,
  `GRANT SELECT,INSERT,UPDATE ON external_links TO firmivra_app`,
  `REVOKE DELETE ON external_links FROM firmivra_app`,
];
