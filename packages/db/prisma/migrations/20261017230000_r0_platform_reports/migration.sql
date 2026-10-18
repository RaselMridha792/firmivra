-- r0_platform_reports (R0, Oct 18, Super Admin schema stage B9): Reports & Analytics (spec 16).
-- Saved custom reports (their configuration, never the data: they run against current data) and
-- two daily rollups the platform's job writes: each firm's feature use and each firm's activity
-- counts, so the cross-firm dashboards and the Firm Report Detail never read firm tables in admin
-- scope. Exports go through B1's platform_export_jobs (module REPORTS). Contract note:
-- docs/work/R0-stage-b9-reports.md.

-- CreateEnum
CREATE TYPE "PlatformReportType" AS ENUM ('FIRMS', 'USERS', 'SUBSCRIPTIONS_REVENUE', 'SUPPORT', 'FEATURE_USAGE', 'ACTIVITY_LOG');

-- CreateTable
CREATE TABLE "platform_saved_reports" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "report_type" "PlatformReportType" NOT NULL,
    "fields" TEXT[],
    "filters" JSONB NOT NULL DEFAULT '{}',
    "date_range" JSONB NOT NULL,
    "sort" JSONB NOT NULL DEFAULT '[]',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "duplicated_from_id" UUID,
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_feature_usage_daily" (
    "day" DATE NOT NULL,
    "business_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "events" INTEGER NOT NULL DEFAULT 0,
    "active_users" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_feature_usage_daily_pkey" PRIMARY KEY ("day","business_id","feature")
);

-- CreateTable
CREATE TABLE "platform_firm_metrics_daily" (
    "day" DATE NOT NULL,
    "business_id" UUID NOT NULL,
    "total_users" INTEGER NOT NULL DEFAULT 0,
    "active_users" INTEGER NOT NULL DEFAULT 0,
    "new_users" INTEGER NOT NULL DEFAULT 0,
    "logins" INTEGER NOT NULL DEFAULT 0,
    "total_clients" INTEGER NOT NULL DEFAULT 0,
    "documents_created" INTEGER NOT NULL DEFAULT 0,
    "documents_completed" INTEGER NOT NULL DEFAULT 0,
    "active_documents" INTEGER NOT NULL DEFAULT 0,
    "leads_created" INTEGER NOT NULL DEFAULT 0,
    "esign_sent" INTEGER NOT NULL DEFAULT 0,
    "esign_completed" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_firm_metrics_daily_pkey" PRIMARY KEY ("day","business_id")
);

-- CreateIndex
CREATE INDEX "platform_saved_reports_shared_idx" ON "platform_saved_reports"("shared");

-- CreateIndex
CREATE UNIQUE INDEX "platform_saved_reports_owner_user_id_name_key" ON "platform_saved_reports"("owner_user_id", "name");

-- CreateIndex
CREATE INDEX "platform_feature_usage_daily_feature_day_idx" ON "platform_feature_usage_daily"("feature", "day");

-- CreateIndex
CREATE INDEX "platform_feature_usage_daily_business_id_day_idx" ON "platform_feature_usage_daily"("business_id", "day");

-- CreateIndex
CREATE INDEX "platform_firm_metrics_daily_business_id_day_idx" ON "platform_firm_metrics_daily"("business_id", "day");

-- AddForeignKey
ALTER TABLE "platform_saved_reports" ADD CONSTRAINT "platform_saved_reports_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_saved_reports" ADD CONSTRAINT "platform_saved_reports_duplicated_from_id_fkey" FOREIGN KEY ("duplicated_from_id") REFERENCES "platform_saved_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_feature_usage_daily" ADD CONSTRAINT "platform_feature_usage_daily_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_firm_metrics_daily" ADD CONSTRAINT "platform_firm_metrics_daily_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
-- A saved report: a name, up to 100 columns by key, and JSON filters, date range and sort of
-- bounded size; a custom date range has a from on or before its to.
ALTER TABLE platform_saved_reports ADD CONSTRAINT platform_saved_reports_values
  CHECK (platform_text_ok(name, 120) AND (description IS NULL OR platform_text_ok(description, 1000))
         AND cardinality(fields) BETWEEN 1 AND 100
         AND array_position(fields, NULL) IS NULL
         AND array_to_string(fields, ',') ~ '^[a-z][a-z0-9_.]{0,79}(,[a-z][a-z0-9_.]{0,79})*$'
         AND jsonb_typeof(filters) = 'object' AND octet_length(filters::text) <= 16384
         AND jsonb_typeof(date_range) = 'object' AND octet_length(date_range::text) <= 1024
         AND (date_range ? 'preset' OR (date_range ? 'from' AND date_range ? 'to'
                                        AND (date_range ->> 'from') <= (date_range ->> 'to')))
         AND jsonb_typeof(sort) = 'array' AND octet_length(sort::text) <= 4096
         AND (duplicated_from_id IS NULL OR duplicated_from_id <> id));

ALTER TABLE platform_feature_usage_daily ADD CONSTRAINT platform_feature_usage_daily_values
  CHECK (feature ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND events >= 0 AND active_users >= 0);

ALTER TABLE platform_firm_metrics_daily ADD CONSTRAINT platform_firm_metrics_daily_values
  CHECK (total_users >= 0 AND active_users BETWEEN 0 AND total_users AND new_users >= 0 AND logins >= 0
         AND total_clients >= 0 AND documents_created >= 0 AND documents_completed >= 0
         AND active_documents >= 0 AND leads_created >= 0 AND esign_sent >= 0 AND esign_completed >= 0);

-- ---------- Rules ----------
-- A saved report belongs to the team member who saved it (the RLS policy); the owner never changes.
-- Only the run time moves when someone else runs a shared report.
CREATE FUNCTION platform_saved_reports_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.last_run_at := NULL;
  ELSIF (NEW.id, NEW.owner_user_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.owner_user_id, OLD.created_at)
        OR (NEW.duplicated_from_id IS DISTINCT FROM OLD.duplicated_from_id AND NEW.duplicated_from_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reports: a saved report keeps its owner' USING ERRCODE = 'check_violation';
  ELSIF NEW.last_run_at IS DISTINCT FROM OLD.last_run_at THEN
    NEW.last_run_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_saved_reports_rules BEFORE INSERT OR UPDATE ON platform_saved_reports
  FOR EACH ROW EXECUTE FUNCTION platform_saved_reports_rules();

CREATE FUNCTION platform_rollup_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.computed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_feature_usage_daily_stamp BEFORE INSERT OR UPDATE ON platform_feature_usage_daily
  FOR EACH ROW EXECUTE FUNCTION platform_rollup_stamp();
CREATE TRIGGER platform_firm_metrics_daily_stamp BEFORE INSERT OR UPDATE ON platform_firm_metrics_daily
  FOR EACH ROW EXECUTE FUNCTION platform_rollup_stamp();

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_saved_reports TO firmivra_app;
-- The rollups are rewritten by their job (upsert), never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON platform_feature_usage_daily, platform_firm_metrics_daily TO firmivra_app;

-- ---------- Row-level security ----------
ALTER TABLE platform_saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_saved_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_feature_usage_daily FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_firm_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_firm_metrics_daily FORCE ROW LEVEL SECURITY;

-- Saved reports: a team member reads their own and the shared ones; writes, edits and deletes only
-- their own; anyone on the team may record a run of a shared one (last_run_at).
CREATE POLICY platform_saved_reports_read ON platform_saved_reports FOR SELECT
  USING ((app_is_admin() OR app_is_platform_member()) AND (owner_user_id = app_current_admin_id() OR shared));
CREATE POLICY platform_saved_reports_write ON platform_saved_reports FOR INSERT
  WITH CHECK (owner_user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()));
CREATE POLICY platform_saved_reports_edit ON platform_saved_reports FOR UPDATE
  USING ((app_is_admin() OR app_is_platform_member()) AND (owner_user_id = app_current_admin_id() OR shared))
  WITH CHECK ((app_is_admin() OR app_is_platform_member()) AND (owner_user_id = app_current_admin_id() OR shared));
CREATE POLICY platform_saved_reports_delete ON platform_saved_reports FOR DELETE
  USING (owner_user_id = app_current_admin_id());

-- A shared report is edited only by its owner; others may only record a run.
CREATE FUNCTION platform_saved_reports_owner_edits() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF OLD.owner_user_id IS DISTINCT FROM app_current_admin_id()
     AND (NEW.name, NEW.description, NEW.report_type, NEW.fields, NEW.filters, NEW.date_range, NEW.sort, NEW.shared)
         IS DISTINCT FROM
         (OLD.name, OLD.description, OLD.report_type, OLD.fields, OLD.filters, OLD.date_range, OLD.sort, OLD.shared) THEN
    RAISE EXCEPTION 'reports: only its owner edits a saved report' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_saved_reports_owner_edits BEFORE UPDATE ON platform_saved_reports
  FOR EACH ROW EXECUTE FUNCTION platform_saved_reports_owner_edits();

-- The rollups: the team reads them; only the platform's daily job writes them. No firm scope reaches
-- them (a firm's own reports read its own tables).
CREATE POLICY platform_feature_usage_daily_read ON platform_feature_usage_daily FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_feature_usage_daily_insert ON platform_feature_usage_daily FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY platform_feature_usage_daily_update ON platform_feature_usage_daily FOR UPDATE
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
CREATE POLICY platform_firm_metrics_daily_read ON platform_firm_metrics_daily FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_firm_metrics_daily_insert ON platform_firm_metrics_daily FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY platform_firm_metrics_daily_update ON platform_firm_metrics_daily FOR UPDATE
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
