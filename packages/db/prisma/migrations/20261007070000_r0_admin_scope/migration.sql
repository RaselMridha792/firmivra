-- CreateEnum
CREATE TYPE "IndustryPack" AS ENUM ('TAX_ACCOUNTING');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "business_type" TEXT,
ADD COLUMN     "kms_key_id" TEXT,
ADD COLUMN     "pack" "IndustryPack" NOT NULL DEFAULT 'TAX_ACCOUNTING';

-- CreateTable
CREATE TABLE "firm_application_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "from_status" "FirmApplicationStatus",
    "to_status" "FirmApplicationStatus" NOT NULL,
    "changed_by_user_id" UUID,
    "reason" TEXT,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "firm_application_status_history_application_id_changed_at_idx" ON "firm_application_status_history"("application_id", "changed_at");

-- AddForeignKey
ALTER TABLE "firm_application_status_history" ADD CONSTRAINT "firm_application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "firm_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 11: Super Admin scope (Rasel, Oct 6) ====================
-- db.forAdmin(adminUserId) narrows Super Admin pages to what they need: firm applications and
-- their history, firms' status and slug, support grant requests, firm owners' contact, platform
-- audit events. It never reaches firm data (clients, documents, engagements, messages, invoices,
-- a firm's audit log) and never updates users. Firm data stays behind an approved support grant
-- in firm scope. forPlatform() is unchanged and stays for identity work.

-- ---------- Admin scope helpers ----------
CREATE OR REPLACE FUNCTION app_current_admin_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN app_scope() = 'admin'
                    THEN NULLIF(current_setting('app.current_admin_id', true), '')::uuid END $$;

-- True only in admin scope for a Super Admin (role SUPER_ADMIN, as RolesGuard checks, so a
-- future platform role never gets these rights by accident). Reads platform_admins through the
-- admin-scope policy below, which has no subquery, so no policy ever recurses.
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_current_admin_id() IS NOT NULL
               AND EXISTS (SELECT 1 FROM platform_admins pa
                           WHERE pa.user_id = app_current_admin_id() AND pa.role = 'SUPER_ADMIN') $$;

-- ---------- What admin scope can read and change ----------
-- Platform admins: the list of admin ids and roles. Readable in admin scope without the admin
-- check (that check reads this table), so a wrong admin id sees only this list, nothing else.
CREATE POLICY platform_admins_admin_read ON platform_admins FOR SELECT
  USING (app_scope() = 'admin');

-- Firm applications: read and review (the trigger below limits what a review may change).
CREATE POLICY firm_applications_admin_read ON firm_applications FOR SELECT
  USING (app_is_admin());
CREATE POLICY firm_applications_admin_review ON firm_applications FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- Firms: the list, and only status and slug can change (trigger below).
CREATE POLICY businesses_admin_read ON businesses FOR SELECT
  USING (app_is_admin());
CREATE POLICY businesses_admin_update ON businesses FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- Firm owners' contact: OWNER memberships, and those owners' user rows (name, email, phone),
-- plus the admin's own user row. No other staff, no clients.
CREATE POLICY memberships_admin_owners ON memberships FOR SELECT
  USING (app_is_admin() AND role = 'OWNER');
CREATE POLICY users_admin_owners ON users FOR SELECT
  USING (app_is_admin()
         AND (id = app_current_admin_id()
              OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.role = 'OWNER')));

-- Support access: read every request and grant; create a request only as itself. Approval stays
-- with the firm's owner in firm scope (support_access_grants_rules).
CREATE POLICY support_access_grants_admin_read ON support_access_grants FOR SELECT
  USING (app_is_admin());
CREATE POLICY support_access_grants_admin_request ON support_access_grants FOR INSERT
  WITH CHECK (app_is_admin() AND admin_user_id = app_current_admin_id()
              AND granted_by_user_id IS NULL AND expires_at IS NULL AND revoked_at IS NULL);

-- Audit log: platform events only (business_id NULL), written as the acting admin.
CREATE POLICY audit_logs_admin_read ON audit_logs FOR SELECT
  USING (app_is_admin() AND business_id IS NULL);
CREATE POLICY audit_logs_admin_insert ON audit_logs FOR INSERT
  WITH CHECK (app_is_admin() AND business_id IS NULL AND actor_user_id = app_current_admin_id());

-- ---------- Firm application status history ----------
GRANT SELECT, INSERT ON firm_application_status_history TO firmivra_app;
ALTER TABLE firm_application_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_application_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_application_status_history_read ON firm_application_status_history FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin());
-- Written only by the trigger on firm_applications, never directly.
CREATE POLICY firm_application_status_history_write ON firm_application_status_history FOR INSERT
  WITH CHECK (pg_trigger_depth() > 0 AND (app_scope() = 'platform' OR app_is_admin()));

CREATE FUNCTION firm_applications_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status THEN
    INSERT INTO firm_application_status_history
      (application_id, from_status, to_status, changed_by_user_id, reason)
    VALUES
      (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
       NEW.reviewed_by_user_id, NEW.decision_reason);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER firm_applications_history
  AFTER INSERT OR UPDATE ON firm_applications
  FOR EACH ROW EXECUTE FUNCTION firm_applications_history();

-- A review changes only the decision: status, notes, reason and who reviewed when. The applicant's
-- details and the link to the provisioned firm (set by provisioning, in platform scope) stay.
CREATE FUNCTION firm_applications_admin_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'admin' THEN
    IF NEW.id <> OLD.id OR NEW.legal_name <> OLD.legal_name
       OR NEW.dba_name IS DISTINCT FROM OLD.dba_name OR NEW.contact_name <> OLD.contact_name
       OR NEW.contact_email <> OLD.contact_email OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
       OR NEW.data <> OLD.data OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'firm applications: a review changes only the decision, never the application'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> OLD.status
       AND (NEW.reviewed_by_user_id IS DISTINCT FROM app_current_admin_id() OR NEW.reviewed_at IS NULL) THEN
      RAISE EXCEPTION 'firm applications: a decision is recorded as the acting admin, with reviewed_at'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_applications_admin_rules
  BEFORE UPDATE ON firm_applications
  FOR EACH ROW EXECUTE FUNCTION firm_applications_admin_rules();

-- ---------- Businesses: who may change which platform field ----------
-- Replaces the rule from tighten_grants_users_businesses. Platform scope (provisioning) may
-- change any of them; admin scope only status and slug, and nothing else on the row; a firm
-- none of them.
CREATE OR REPLACE FUNCTION businesses_protected_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'platform' THEN
    RETURN NEW;
  END IF;
  IF app_scope() = 'admin' THEN
    IF NEW.id <> OLD.id OR NEW.name <> OLD.name OR NEW.legal_name IS DISTINCT FROM OLD.legal_name
       OR NEW.terms_url IS DISTINCT FROM OLD.terms_url OR NEW.privacy_url IS DISTINCT FROM OLD.privacy_url
       OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
       OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack <> OLD.pack
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'businesses: Super Admin changes only status and slug'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
     OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack IS DISTINCT FROM OLD.pack THEN
    RAISE EXCEPTION 'businesses: status, slug, KMS key, business type and pack change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE businesses ADD CONSTRAINT businesses_kms_key_id_not_blank CHECK (btrim(kms_key_id) <> '');
