-- Row-level security for Firmivra.
--
-- Every query from the API runs as the non-owner role firmivra_app inside one of three scopes,
-- set per transaction by packages/db (forBusiness, forUser, forPlatform):
--   app.scope = 'business'  + app.current_business_id  -> one firm's data
--   app.scope = 'user'      + app.current_user_id      -> the signed-in person's own rows (/me)
--   app.scope = 'platform'                              -> Super Admin platform tables
-- With no scope set, every policy is false: the app sees nothing.
-- Tables are FORCE'd, so the table owner is checked too (it only skips RLS as a superuser).

-- ---------- Scope helpers ----------
-- NULLIF: after a transaction-local set_config, the setting reads as '' on that connection.
CREATE OR REPLACE FUNCTION app_scope() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.scope', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_business_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN app_scope() = 'business'
                    THEN NULLIF(current_setting('app.current_business_id', true), '')::uuid END $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN app_scope() = 'user'
                    THEN NULLIF(current_setting('app.current_user_id', true), '')::uuid END $$;

-- ---------- App role ----------
-- Locally docker/postgres/init creates it with a password. Elsewhere it is created here without
-- login; the deploy sets its password from Secrets Manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'firmivra_app') THEN
    CREATE ROLE firmivra_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  businesses, users, memberships, client_accounts, platform_admins, support_access_grants, firm_applications
  TO firmivra_app;
-- Audit log is append-only for the app.
GRANT SELECT, INSERT ON audit_logs TO firmivra_app;

-- ---------- Enable and force RLS on every table ----------
ALTER TABLE businesses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses            FORCE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships           FORCE ROW LEVEL SECURITY;
ALTER TABLE client_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_accounts       FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_admins       ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins       FORCE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_applications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_applications     FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY memberships_business ON memberships
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
-- A signed-in staff user can list their own memberships across firms (firm picker on /me).
CREATE POLICY memberships_own ON memberships FOR SELECT
  USING (user_id = app_current_user_id());

CREATE POLICY client_accounts_business ON client_accounts
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY client_accounts_own ON client_accounts FOR SELECT
  USING (user_id = app_current_user_id());

-- Grants are shared by the firm (owner approves) and the platform (Super Admin requests).
CREATE POLICY support_access_grants_access ON support_access_grants
  USING (app_scope() = 'platform' OR business_id = app_current_business_id())
  WITH CHECK (app_scope() = 'platform' OR business_id = app_current_business_id());

-- Firm events only for that firm; platform events (business_id NULL) only in platform scope.
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (business_id = app_current_business_id()
         OR (app_scope() = 'platform' AND business_id IS NULL));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (app_scope() = 'platform' OR business_id = app_current_business_id());

-- ---------- Businesses ----------
-- Platform sees all firms (metadata); a firm sees itself; a user sees the firms they belong to.
CREATE POLICY businesses_select ON businesses FOR SELECT
  USING (app_scope() = 'platform'
         OR id = app_current_business_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = businesses.id AND m.user_id = app_current_user_id())
         OR EXISTS (SELECT 1 FROM client_accounts c WHERE c.business_id = businesses.id AND c.user_id = app_current_user_id()));
CREATE POLICY businesses_insert ON businesses FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY businesses_update ON businesses FOR UPDATE
  USING (app_scope() = 'platform' OR id = app_current_business_id())
  WITH CHECK (app_scope() = 'platform' OR id = app_current_business_id());
CREATE POLICY businesses_delete ON businesses FOR DELETE
  USING (app_scope() = 'platform');

-- ---------- Users (identities, shared across firms) ----------
-- A firm sees only users linked to it (the subqueries are themselves limited by RLS).
CREATE POLICY users_select ON users FOR SELECT
  USING (app_scope() = 'platform'
         OR id = app_current_user_id()
         OR (app_scope() = 'business'
             AND (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)
                  OR EXISTS (SELECT 1 FROM client_accounts c WHERE c.user_id = users.id))));
-- New identities are created in platform scope (sign-up, invite, approval), then linked to a firm.
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY users_update ON users FOR UPDATE
  USING (app_scope() = 'platform'
         OR id = app_current_user_id()
         OR (app_scope() = 'business'
             AND (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id)
                  OR EXISTS (SELECT 1 FROM client_accounts c WHERE c.user_id = users.id))));
CREATE POLICY users_delete ON users FOR DELETE
  USING (app_scope() = 'platform');

-- ---------- Platform-only tables ----------
CREATE POLICY platform_admins_access ON platform_admins
  USING (app_scope() = 'platform' OR user_id = app_current_user_id())
  WITH CHECK (app_scope() = 'platform');

CREATE POLICY firm_applications_access ON firm_applications
  USING (app_scope() = 'platform')
  WITH CHECK (app_scope() = 'platform');

-- ---------- Data rules Prisma cannot express ----------
-- Emails are stored lower-case so (business_id, email) lookups are exact.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_email_lowercase CHECK (email = lower(email));
