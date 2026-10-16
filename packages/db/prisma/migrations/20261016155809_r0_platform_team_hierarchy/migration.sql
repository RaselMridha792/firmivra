-- r0_platform_team_hierarchy (Oct 16, Rasel's PART 1): Firmivra's own internal org chart
-- (Octavia's hierarchy/permissions and team developer instructions) and the firm-facing plan
-- ladder (pricing doc). platform_admins is untouched: app_is_admin() keeps meaning exactly what
-- it means today (a SUPER_ADMIN row). Every new team member below the CEO gets a platform_admins
-- row with role TEAM_MEMBER (added in the previous migration, its own transaction), which
-- app_is_admin() already excludes, so adding a member never grants admin-scope rights by
-- accident. A trigger below ties the two together: a SUPER_ADMIN row's member must be CEO-level,
-- and a CEO-level member's admin row must be SUPER_ADMIN. Letting TEAM_MEMBER sign in to the
-- admin console (the API and its guards) is a later PR.
--
-- One audit trail (Rasel's change B): hierarchy and subscription actions write to the existing
-- audit_logs table (business_id null for team actions, set for a firm's subscription), with old
-- value, new value, reason, effective date and approver in metadata. No new audit table.

-- CreateEnum
CREATE TYPE "PlatformRoleLevel" AS ENUM ('CEO', 'CHIEF_OFFICER', 'VP_DIRECTOR', 'MANAGER', 'LEAD_SUPERVISOR', 'INDIVIDUAL_CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "PlatformScopeType" AS ENUM ('COMPANY', 'DEPARTMENT', 'DIVISION', 'TEAM', 'DIRECT_REPORTS', 'OWN_RECORDS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlatformPermissionState" AS ENUM ('ALLOW', 'DENY', 'INHERIT');

-- CreateEnum
CREATE TYPE "PlatformMemberStatus" AS ENUM ('PENDING_INVITATION', 'PENDING_APPROVAL', 'PENDING_DEPARTMENT_HEAD_APPROVAL', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PlatformBillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PlatformSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'NON_RENEWING', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "platform_departments" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_role_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" "PlatformRoleLevel" NOT NULL,
    "department_id" UUID NOT NULL,
    "default_reports_to_role_id" UUID,
    "default_scope_type" "PlatformScopeType" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_role_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_role_permissions" (
    "role_definition_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "state" "PlatformPermissionState" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_role_permissions_pkey" PRIMARY KEY ("role_definition_id","permission_key")
);

-- CreateTable
CREATE TABLE "platform_members" (
    "user_id" UUID NOT NULL,
    "role_definition_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "reports_to_user_id" UUID,
    "scope_type" "PlatformScopeType" NOT NULL,
    "scope_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "PlatformMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "intended_role_definition_id" UUID,
    "invited_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_members_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "platform_member_permission_overrides" (
    "id" UUID NOT NULL,
    "platform_member_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "state" "PlatformPermissionState" NOT NULL,
    "reason" TEXT,
    "granted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_member_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_price_cents" INTEGER NOT NULL,
    "billing_cycle" "PlatformBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "included_seats" INTEGER NOT NULL,
    "max_seats" INTEGER,
    "overage_price_cents_per_seat" INTEGER,
    "included_locations" INTEGER NOT NULL DEFAULT 1,
    "overage_price_cents_per_location" INTEGER,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_plan_features" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_firm_subscriptions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "PlatformSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "billing_cycle" "PlatformBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "seats_included" INTEGER NOT NULL,
    "seats_purchased" INTEGER NOT NULL DEFAULT 0,
    "locations_included" INTEGER NOT NULL DEFAULT 1,
    "locations_purchased" INTEGER NOT NULL DEFAULT 0,
    "price_cents_override" INTEGER,
    "trial_started_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "next_billing_date" TIMESTAMPTZ(3),
    "paid_through_date" TIMESTAMPTZ(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "cancel_requested_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "cancel_request_source" TEXT,
    "suspended_at" TIMESTAMPTZ(3),
    "suspended_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_firm_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_departments_code_key" ON "platform_departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_role_definitions_code_key" ON "platform_role_definitions"("code");

-- CreateIndex
CREATE INDEX "platform_role_definitions_department_id_idx" ON "platform_role_definitions"("department_id");

-- CreateIndex
CREATE INDEX "platform_members_department_id_idx" ON "platform_members"("department_id");

-- CreateIndex
CREATE INDEX "platform_members_role_definition_id_idx" ON "platform_members"("role_definition_id");

-- CreateIndex
CREATE INDEX "platform_members_reports_to_user_id_idx" ON "platform_members"("reports_to_user_id");

-- CreateIndex
CREATE INDEX "platform_members_status_idx" ON "platform_members"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_member_permission_overrides_platform_member_id_per_key" ON "platform_member_permission_overrides"("platform_member_id", "permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_plans_code_key" ON "platform_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_plan_features_plan_id_feature_key_key" ON "platform_plan_features"("plan_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_firm_subscriptions_business_id_key" ON "platform_firm_subscriptions"("business_id");

-- AddForeignKey
ALTER TABLE "platform_role_definitions" ADD CONSTRAINT "platform_role_definitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "platform_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_definitions" ADD CONSTRAINT "platform_role_definitions_default_reports_to_role_id_fkey" FOREIGN KEY ("default_reports_to_role_id") REFERENCES "platform_role_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_role_definition_id_fkey" FOREIGN KEY ("role_definition_id") REFERENCES "platform_role_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_role_definition_id_fkey" FOREIGN KEY ("role_definition_id") REFERENCES "platform_role_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_intended_role_definition_id_fkey" FOREIGN KEY ("intended_role_definition_id") REFERENCES "platform_role_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "platform_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_reports_to_user_id_fkey" FOREIGN KEY ("reports_to_user_id") REFERENCES "platform_members"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_member_permission_overrides" ADD CONSTRAINT "platform_member_permission_overrides_platform_member_id_fkey" FOREIGN KEY ("platform_member_id") REFERENCES "platform_members"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_plan_features" ADD CONSTRAINT "platform_plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_firm_subscriptions" ADD CONSTRAINT "platform_firm_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_firm_subscriptions" ADD CONSTRAINT "platform_firm_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Shape ----------
-- Text with something visible in it (not only blanks), up to `max` characters, as esign_text_ok
-- (r0_esign): tabs and CRLF stay allowed (descriptions are multi-line), every other control,
-- line-separator, filler and invisible character is refused.
CREATE FUNCTION platform_text_ok(v text, max integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v ~ '[^[:space:]\xA0  -‏  ⠀　︀-️]'
               AND char_length(v) <= max
               AND v !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xAD͏؜ᅟᅠ឴឵᠎​ -‮⁠-⁤⁦-⁯ㅤ﻿ﾠ￹-￻\U000E0000-\U000E007F]' $$;

ALTER TABLE platform_departments ADD CONSTRAINT platform_departments_values
  CHECK (code ~ '^[A-Z][A-Z0-9_]{0,49}$' AND platform_text_ok(name, 120)
         AND (description IS NULL OR platform_text_ok(description, 1000)));

ALTER TABLE platform_role_definitions ADD CONSTRAINT platform_role_definitions_values
  CHECK (code ~ '^[A-Z][A-Z0-9_]{0,89}$' AND platform_text_ok(title, 150)
         AND (description IS NULL OR platform_text_ok(description, 1000))
         AND default_reports_to_role_id <> id);

ALTER TABLE platform_role_permissions ADD CONSTRAINT platform_role_permissions_values
  CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');

ALTER TABLE platform_members ADD CONSTRAINT platform_members_values
  CHECK (reports_to_user_id <> user_id
         AND cardinality(scope_ids) <= 200 AND array_position(scope_ids, NULL) IS NULL
         AND (status = 'PENDING_DEPARTMENT_HEAD_APPROVAL') = (intended_role_definition_id IS NOT NULL));

ALTER TABLE platform_member_permission_overrides ADD CONSTRAINT platform_member_permission_overrides_values
  CHECK (permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
         AND (reason IS NULL OR platform_text_ok(reason, 500)));

ALTER TABLE platform_plans ADD CONSTRAINT platform_plans_values
  CHECK (code ~ '^[A-Z][A-Z0-9_]{0,49}$' AND platform_text_ok(name, 120)
         AND base_price_cents >= 0 AND included_seats >= 1
         AND (max_seats IS NULL OR max_seats >= included_seats)
         AND (overage_price_cents_per_seat IS NULL OR overage_price_cents_per_seat >= 0)
         AND included_locations >= 1
         AND (overage_price_cents_per_location IS NULL OR overage_price_cents_per_location >= 0)
         AND display_order >= 0);

ALTER TABLE platform_plan_features ADD CONSTRAINT platform_plan_features_values
  CHECK (feature_key ~ '^[a-z][a-z0-9_]*$' AND platform_text_ok(label, 200));

-- Status-consistency only (stage A): the full lifecycle/grace-period state machine (subscriptions
-- doc, section 7) is the Billing module's job, not this migration's.
ALTER TABLE platform_firm_subscriptions ADD CONSTRAINT platform_firm_subscriptions_values
  CHECK (seats_included >= 0 AND seats_purchased >= 0
         AND locations_included >= 0 AND locations_purchased >= 0
         AND (price_cents_override IS NULL OR price_cents_override >= 0)
         AND (cancel_requested_at IS NULL) = (cancel_reason IS NULL)
         AND (cancel_requested_at IS NULL) = (cancel_request_source IS NULL)
         AND (suspended_at IS NULL) = (suspended_reason IS NULL)
         AND (closed_at IS NULL) = (closed_reason IS NULL)
         AND (cancel_reason IS NULL OR platform_text_ok(cancel_reason, 1000))
         AND (cancel_request_source IS NULL OR platform_text_ok(cancel_request_source, 200))
         AND (suspended_reason IS NULL OR platform_text_ok(suspended_reason, 1000))
         AND (closed_reason IS NULL OR platform_text_ok(closed_reason, 1000)));

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_departments, platform_role_definitions,
  platform_role_permissions, platform_members, platform_member_permission_overrides
  TO firmivra_app;
-- Plans are reference data (no DELETE: subscriptions reference them; retire with is_active).
-- Subscriptions are never hard-deleted either (soft lifecycle, master guide section 7).
GRANT SELECT, INSERT, UPDATE ON platform_plans, platform_plan_features, platform_firm_subscriptions
  TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_departments', 'platform_role_definitions',
    'platform_role_permissions', 'platform_members', 'platform_member_permission_overrides',
    'platform_plans', 'platform_plan_features', 'platform_firm_subscriptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- True for any ACTIVE row of the org chart, any level (app_is_admin() stays CEO-equivalent only:
-- full admin-scope rights). Reads platform_members through that table's own self-row policy
-- below, so this never recurses into itself.
CREATE FUNCTION app_is_platform_member() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_current_admin_id() IS NOT NULL
               AND EXISTS (SELECT 1 FROM platform_members m
                           WHERE m.user_id = app_current_admin_id() AND m.status = 'ACTIVE') $$;

-- The role and department catalog: reference data, readable by the whole platform team (not
-- sensitive); changed only by the CEO (app_is_admin()) until the Team API's own ceiling checks
-- land (a later PR).
CREATE POLICY platform_departments_read ON platform_departments FOR SELECT
  USING (app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_departments_admin_write ON platform_departments FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY platform_departments_admin_update ON platform_departments FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY platform_departments_admin_delete ON platform_departments FOR DELETE
  USING (app_is_admin());

CREATE POLICY platform_role_definitions_read ON platform_role_definitions FOR SELECT
  USING (app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_role_definitions_admin_write ON platform_role_definitions FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY platform_role_definitions_admin_update ON platform_role_definitions FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY platform_role_definitions_admin_delete ON platform_role_definitions FOR DELETE
  USING (app_is_admin());

CREATE POLICY platform_role_permissions_read ON platform_role_permissions FOR SELECT
  USING (app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_role_permissions_admin_write ON platform_role_permissions FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- The org chart itself: the CEO sees and changes everyone; anyone else (once the Team API signs
-- them in, a later PR) sees only their own row. No self-write: changing your own role/department/
-- scope is an admin (or, later, a ceiling-checked API) action, never a self-service one.
CREATE POLICY platform_members_admin_all ON platform_members FOR ALL
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY platform_members_self_read ON platform_members FOR SELECT
  USING (user_id = app_current_admin_id());

-- Sensitive: admin only, until the ceiling-checked API decides what a member may see of their
-- own overrides.
CREATE POLICY platform_member_permission_overrides_admin_all ON platform_member_permission_overrides
  FOR ALL USING (app_is_admin()) WITH CHECK (app_is_admin());

-- Plans: the ladder is not a secret. Any signed-in firm (staff or client) and the whole platform
-- team may read it; only the CEO changes prices and features.
CREATE POLICY platform_plans_read ON platform_plans FOR SELECT
  USING (app_is_admin() OR app_is_platform_member() OR app_scope() = 'business');
CREATE POLICY platform_plans_admin_write ON platform_plans FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY platform_plans_admin_update ON platform_plans FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

CREATE POLICY platform_plan_features_read ON platform_plan_features FOR SELECT
  USING (app_is_admin() OR app_is_platform_member() OR app_scope() = 'business');
CREATE POLICY platform_plan_features_admin_write ON platform_plan_features FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY platform_plan_features_admin_update ON platform_plan_features FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

-- Subscriptions: admin reads and writes every firm's row. A firm reads only its own, for
-- entitlement checks and its Settings page (Rasel's change C) -- never writes it.
CREATE POLICY platform_firm_subscriptions_admin_read ON platform_firm_subscriptions FOR SELECT
  USING (app_is_admin());
CREATE POLICY platform_firm_subscriptions_admin_write ON platform_firm_subscriptions FOR INSERT
  WITH CHECK (app_is_admin());
CREATE POLICY platform_firm_subscriptions_admin_update ON platform_firm_subscriptions FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY platform_firm_subscriptions_business_read ON platform_firm_subscriptions FOR SELECT
  USING (business_id = app_current_business_id());

-- ---------- The CEO / TEAM_MEMBER correspondence (Rasel's change A) ----------
-- A SUPER_ADMIN row may only belong to a CEO-level member, or have no member row yet (so mapping
-- the migration's own INSERTs below can run in either order); a CEO-level member's admin row must
-- be SUPER_ADMIN (the other direction: a true CEO always has full admin-scope rights). Every other
-- level must be TEAM_MEMBER, which app_is_admin() already excludes.
CREATE FUNCTION platform_members_ceo_role_check() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  admin_role "PlatformRole";
  member_level "PlatformRoleLevel";
BEGIN
  SELECT role INTO admin_role FROM platform_admins WHERE user_id = NEW.user_id;
  IF admin_role IS NULL THEN
    RAISE EXCEPTION 'platform members: % is not a platform_admins row', NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  SELECT level INTO member_level FROM platform_role_definitions WHERE id = NEW.role_definition_id;
  IF member_level = 'CEO' AND admin_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'platform members: a CEO-level member must be a SUPER_ADMIN'
      USING ERRCODE = 'check_violation';
  END IF;
  IF member_level <> 'CEO' AND admin_role = 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'platform members: a SUPER_ADMIN admin row may only belong to a CEO-level member'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER platform_members_ceo_role_check
  BEFORE INSERT OR UPDATE ON platform_members
  FOR EACH ROW EXECUTE FUNCTION platform_members_ceo_role_check();
