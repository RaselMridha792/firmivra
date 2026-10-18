-- r0_platform_system_settings (R0, Oct 18, Super Admin schema stage B7): System Settings (spec 19).
-- Typed settings sections (General, Branding & Appearance, Email & Notifications) with versioned
-- saves; secret references, never secret values; versioned brand assets; feature flags with
-- per-firm overrides and an emergency off; retention policies by category with floors, legal holds
-- (a held firm cannot be deleted) and retention runs; maintenance windows; background job controls;
-- versioned default sets for new firms and users. The migration ships the sections, the retention
-- categories and version 1 of the defaults. Platform data: only the Super Admin team and the
-- platform's own services reach it. Contract note: docs/work/R0-stage-b7-system-settings.md.

-- CreateEnum
CREATE TYPE "PlatformBrandAssetKind" AS ENUM ('LOGO', 'LOGO_DARK', 'FAVICON', 'APP_ICON', 'LOGIN_BACKGROUND');

-- CreateEnum
CREATE TYPE "PlatformFeatureState" AS ENUM ('ON', 'OFF');

-- CreateEnum
CREATE TYPE "PlatformRetentionDisposition" AS ENUM ('DELETE', 'ANONYMIZE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "PlatformRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlatformMaintenanceStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlatformDefaultSetKind" AS ENUM ('FIRM', 'USER');

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_secret_refs" (
    "key" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "hint" TEXT,
    "rotated_at" TIMESTAMPTZ(3),
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_secret_refs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_brand_assets" (
    "id" UUID NOT NULL,
    "kind" "PlatformBrandAssetKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_brand_current" (
    "kind" "PlatformBrandAssetKind" NOT NULL,
    "asset_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_brand_current_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "platform_features" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_state" "PlatformFeatureState" NOT NULL DEFAULT 'OFF',
    "emergency_disabled" BOOLEAN NOT NULL DEFAULT false,
    "depends_on" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_features_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_feature_overrides" (
    "feature_key" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "state" "PlatformFeatureState" NOT NULL,
    "reason" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_feature_overrides_pkey" PRIMARY KEY ("feature_key","business_id")
);

-- CreateTable
CREATE TABLE "platform_retention_policies" (
    "category" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "disposition" "PlatformRetentionDisposition" NOT NULL,
    "archive_after_days" INTEGER,
    "minimum_days" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_retention_policies_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "platform_legal_holds" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "held_business_id" UUID,
    "record_type" TEXT,
    "record_id" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),
    "released_by_user_id" UUID,
    "release_reason" TEXT,

    CONSTRAINT "platform_legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_retention_runs" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "status" "PlatformRunStatus" NOT NULL DEFAULT 'QUEUED',
    "policy_version" INTEGER NOT NULL,
    "eligible_count" INTEGER,
    "affected_count" INTEGER,
    "held_count" INTEGER,
    "error_code" TEXT,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_retention_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_maintenance_windows" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "PlatformMaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "admin_bypass" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_job_controls" (
    "job_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paused_reason" TEXT,
    "last_run_at" TIMESTAMPTZ(3),
    "last_status" "PlatformRunStatus",
    "last_error" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_job_controls_pkey" PRIMARY KEY ("job_key")
);

-- CreateTable
CREATE TABLE "platform_default_sets" (
    "id" UUID NOT NULL,
    "kind" "PlatformDefaultSetKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_default_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_default_set_applications" (
    "business_id" UUID NOT NULL,
    "default_set_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_default_set_applications_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_brand_assets_s3_key_key" ON "platform_brand_assets"("s3_key");

-- CreateIndex
CREATE INDEX "platform_brand_assets_kind_created_at_idx" ON "platform_brand_assets"("kind", "created_at");

-- CreateIndex
CREATE INDEX "platform_feature_overrides_business_id_idx" ON "platform_feature_overrides"("business_id");

-- CreateIndex
CREATE INDEX "platform_legal_holds_held_business_id_idx" ON "platform_legal_holds"("held_business_id");

-- CreateIndex
CREATE INDEX "platform_legal_holds_category_idx" ON "platform_legal_holds"("category");

-- CreateIndex
CREATE INDEX "platform_retention_runs_category_created_at_idx" ON "platform_retention_runs"("category", "created_at");

-- CreateIndex
CREATE INDEX "platform_retention_runs_status_idx" ON "platform_retention_runs"("status");

-- CreateIndex
CREATE INDEX "platform_maintenance_windows_status_starts_at_idx" ON "platform_maintenance_windows"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_default_sets_kind_version_key" ON "platform_default_sets"("kind", "version");

-- CreateIndex
CREATE INDEX "platform_default_set_applications_default_set_id_idx" ON "platform_default_set_applications"("default_set_id");

-- AddForeignKey
ALTER TABLE "platform_brand_current" ADD CONSTRAINT "platform_brand_current_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "platform_brand_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_feature_overrides" ADD CONSTRAINT "platform_feature_overrides_feature_key_fkey" FOREIGN KEY ("feature_key") REFERENCES "platform_features"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_feature_overrides" ADD CONSTRAINT "platform_feature_overrides_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_legal_holds" ADD CONSTRAINT "platform_legal_holds_held_business_id_fkey" FOREIGN KEY ("held_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_retention_runs" ADD CONSTRAINT "platform_retention_runs_category_fkey" FOREIGN KEY ("category") REFERENCES "platform_retention_policies"("category") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_default_set_applications" ADD CONSTRAINT "platform_default_set_applications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_default_set_applications" ADD CONSTRAINT "platform_default_set_applications_default_set_id_fkey" FOREIGN KEY ("default_set_id") REFERENCES "platform_default_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
CREATE FUNCTION platform_email_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT char_length(v) <= 254 AND v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' $$;

-- A whole number within bounds at a JSON key (its own helper, so this stage stands alone).
CREATE FUNCTION settings_json_int_ok(obj jsonb, key text, lo integer, hi integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT CASE WHEN jsonb_typeof(obj -> key) = 'number'
                    THEN (obj ->> key)::numeric BETWEEN lo AND hi
                         AND (obj ->> key)::numeric = trunc((obj ->> key)::numeric)
                    ELSE false END $$;

-- Each section's floors (the API's zod schema owns the rest of its shape): a platform name and a
-- valid time zone and currency; colours as #RRGGBB or unset (unset uses the design tokens); sane
-- retry limits, and valid sender addresses once set.
CREATE FUNCTION platform_setting_ok(k text, v jsonb) RETURNS boolean
  LANGUAGE plpgsql STABLE
  AS $$
BEGIN
  IF jsonb_typeof(v) <> 'object' OR octet_length(v::text) > 32768 THEN
    RETURN false;
  END IF;
  CASE k
    WHEN 'general' THEN
      RETURN jsonb_typeof(v -> 'platformName') = 'string' AND platform_text_ok(v ->> 'platformName', 100)
        AND app_valid_time_zone(v ->> 'defaultTimeZone')
        AND coalesce(v ->> 'defaultLocale', '') ~ '^[a-z]{2}(-[A-Z]{2})?$'
        AND coalesce(v ->> 'defaultCurrency', '') ~ '^[A-Z]{3}$'
        AND (v ->> 'supportEmail' IS NULL OR platform_email_ok(v ->> 'supportEmail'));
    WHEN 'branding' THEN
      RETURN (v ->> 'primaryAccent' IS NULL OR v ->> 'primaryAccent' ~ '^#[0-9A-Fa-f]{6}$')
        AND (v ->> 'secondaryAccent' IS NULL OR v ->> 'secondaryAccent' ~ '^#[0-9A-Fa-f]{6}$')
        AND coalesce(v ->> 'appearance', '') IN ('LIGHT', 'DARK', 'SYSTEM');
    WHEN 'email_notifications' THEN
      RETURN (v ->> 'fromEmail' IS NULL OR platform_email_ok(v ->> 'fromEmail'))
        AND (v ->> 'replyTo' IS NULL OR platform_email_ok(v ->> 'replyTo'))
        AND jsonb_typeof(v -> 'channels') = 'object'
        AND settings_json_int_ok(v, 'maxRetries', 0, 10)
        AND settings_json_int_ok(v, 'retryBackoffMinutes', 1, 1440);
    ELSE
      RETURN false;
  END CASE;
END
$$;

ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_values
  CHECK (platform_setting_ok(key, value) AND version >= 1);

-- A secret is referenced, never stored: an AWS Secrets Manager ARN, or local:<name> in development.
ALTER TABLE platform_secret_refs ADD CONSTRAINT platform_secret_refs_values
  CHECK (key ~ '^[a-z][a-z0-9_.]{0,99}$'
         AND char_length(reference) <= 600
         AND reference ~ '^(arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+|local:[a-z0-9_.-]{1,100})$'
         AND (hint IS NULL OR hint ~ '^[A-Za-z0-9*._-]{1,8}$'));

-- Brand assets: raster formats only (no SVG: it can carry script), at most 5 MB, under the
-- platform's branding prefix, scanned once.
ALTER TABLE platform_brand_assets ADD CONSTRAINT platform_brand_assets_values
  CHECK (platform_text_ok(file_name, 255) AND file_name !~ '[/\\]'
         AND (CASE kind
                WHEN 'FAVICON' THEN content_type IN ('image/png', 'image/x-icon', 'image/vnd.microsoft.icon')
                WHEN 'APP_ICON' THEN content_type = 'image/png'
                WHEN 'LOGIN_BACKGROUND' THEN content_type IN ('image/jpeg', 'image/png', 'image/webp')
                ELSE content_type IN ('image/png', 'image/webp') END)
         AND size_bytes BETWEEN 1 AND 5242880
         AND (width IS NULL OR width BETWEEN 1 AND 8192) AND (height IS NULL OR height BETWEEN 1 AND 8192)
         AND sha256 ~ '^[0-9a-f]{64}$'
         AND starts_with(s3_key, 'platform/branding/' || id || '/')
         AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE platform_features ADD CONSTRAINT platform_features_values
  CHECK (key ~ '^[a-z][a-z0-9_.]{0,79}$' AND platform_text_ok(name, 100)
         AND (description IS NULL OR platform_text_ok(description, 1000))
         AND cardinality(depends_on) <= 20 AND array_position(depends_on, NULL) IS NULL
         AND array_position(depends_on, key) IS NULL);

ALTER TABLE platform_feature_overrides ADD CONSTRAINT platform_feature_overrides_values
  CHECK (reason IS NULL OR platform_text_ok(reason, 1000));

ALTER TABLE platform_retention_policies ADD CONSTRAINT platform_retention_policies_values
  CHECK (category ~ '^[a-z][a-z0-9_]{0,59}$' AND minimum_days >= 0
         AND retention_days BETWEEN minimum_days AND 36500
         AND (archive_after_days IS NULL OR archive_after_days BETWEEN 1 AND retention_days)
         AND version >= 1);

-- A hold covers exactly one thing: a category, a firm, or a record (a released hold whose firm was
-- deleted covers nothing any more). A release has its reason.
ALTER TABLE platform_legal_holds ADD CONSTRAINT platform_legal_holds_values
  CHECK (platform_text_ok(name, 120) AND platform_text_ok(reason, 2000)
         AND (num_nonnulls(category, held_business_id, record_id) = 1
              OR (released_at IS NOT NULL AND num_nonnulls(category, held_business_id, record_id) = 0))
         AND (record_type IS NULL) = (record_id IS NULL)
         AND (record_type IS NULL OR record_type ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (record_id IS NULL OR (btrim(record_id) <> '' AND char_length(record_id) <= 100))
         AND (category IS NULL OR category ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (released_at IS NULL) = (release_reason IS NULL)
         AND (release_reason IS NULL OR platform_text_ok(release_reason, 2000))
         AND (released_by_user_id IS NULL OR released_at IS NOT NULL));

ALTER TABLE platform_retention_runs ADD CONSTRAINT platform_retention_runs_values
  CHECK (policy_version >= 1
         AND (eligible_count IS NULL OR eligible_count >= 0) AND (affected_count IS NULL OR affected_count >= 0)
         AND (held_count IS NULL OR held_count >= 0)
         AND (NOT dry_run OR coalesce(affected_count, 0) = 0)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (CASE status
                WHEN 'QUEUED' THEN started_at IS NULL AND finished_at IS NULL
                WHEN 'RUNNING' THEN started_at IS NOT NULL AND finished_at IS NULL
                WHEN 'COMPLETED' THEN finished_at IS NOT NULL AND eligible_count IS NOT NULL AND error_code IS NULL
                WHEN 'FAILED' THEN finished_at IS NOT NULL AND error_code IS NOT NULL
                ELSE started_at IS NULL AND finished_at IS NOT NULL END));

ALTER TABLE platform_maintenance_windows ADD CONSTRAINT platform_maintenance_windows_values
  CHECK (platform_text_ok(title, 120) AND platform_text_ok(message, 2000) AND ends_at > starts_at
         AND (CASE status
                WHEN 'SCHEDULED' THEN started_at IS NULL AND ended_at IS NULL
                WHEN 'ACTIVE' THEN started_at IS NOT NULL AND ended_at IS NULL
                WHEN 'COMPLETED' THEN started_at IS NOT NULL AND ended_at IS NOT NULL
                ELSE started_at IS NULL END));

ALTER TABLE platform_job_controls ADD CONSTRAINT platform_job_controls_values
  CHECK (job_key ~ '^[a-z][a-z0-9_.]{0,79}$' AND platform_text_ok(name, 120)
         AND (paused_reason IS NULL OR (NOT enabled AND platform_text_ok(paused_reason, 500)))
         AND (last_error IS NULL OR platform_text_ok(last_error, 1000))
         AND (last_status IS NULL OR last_run_at IS NOT NULL));

ALTER TABLE platform_default_sets ADD CONSTRAINT platform_default_sets_values
  CHECK (version >= 1 AND jsonb_typeof(values) = 'object' AND octet_length(values::text) <= 32768
         AND (note IS NULL OR platform_text_ok(note, 500)));

-- ---------- What ships ----------
-- Sender, support and colour values start unset: the API shows "not configured" until an admin
-- saves them (unset colours use the packages/ui design tokens).
INSERT INTO platform_settings (key, value, updated_at) VALUES
  ('general', '{"platformName": "Firmivra", "defaultTimeZone": "America/New_York", "defaultLocale": "en-US", "defaultCurrency": "USD", "dateFormat": "MM/DD/YYYY", "supportEmail": null, "supportPhone": null}', now()),
  ('branding', '{"primaryAccent": null, "secondaryAccent": null, "appearance": "SYSTEM", "allowUserAppearance": true}', now()),
  ('email_notifications', '{"fromName": "Firmivra", "fromEmail": null, "replyTo": null, "channels": {"email": true, "sms": true, "inApp": true, "push": false}, "maxRetries": 3, "retryBackoffMinutes": 5, "dailyCapPerRecipient": 50}', now());

-- Retention by category, with the floor the app cannot go below. Audit retention is the security
-- policy's (B4). Billing documents are kept 7 years (tax records).
INSERT INTO platform_retention_policies (category, retention_days, disposition, archive_after_days, minimum_days, updated_at) VALUES
  ('communications', 1095, 'DELETE', 365, 365, now()),
  ('support_tickets', 2555, 'DELETE', 730, 1095, now()),
  ('platform_notifications', 365, 'DELETE', NULL, 90, now()),
  ('export_files', 7, 'DELETE', NULL, 1, now()),
  ('declined_firm_applications', 730, 'DELETE', NULL, 365, now()),
  ('lost_sales_records', 1095, 'ANONYMIZE', NULL, 180, now()),
  ('platform_billing', 2555, 'ARCHIVE', 730, 2555, now());

-- Version 1 of the defaults for new firms and new users (regional values unset inherit the
-- platform's General settings).
INSERT INTO platform_default_sets (id, kind, version, values, note) VALUES
  (gen_random_uuid(), 'FIRM', 1, '{"regional": {"timeZone": null, "locale": null}, "notifications": {"email": true, "sms": false, "inApp": true}, "features": {}}', 'Shipped defaults'),
  (gen_random_uuid(), 'USER', 1, '{"regional": {"timeZone": null, "locale": null}, "notifications": {"email": true, "sms": false, "inApp": true}, "appearance": null}', 'Shipped defaults');

-- ---------- Rules ----------
-- Settings sections: every save is a new version; the database stamps who and when.
CREATE FUNCTION platform_settings_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'system settings: a section keeps its key' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_settings_rules BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION platform_settings_rules();

-- Secret references: a new reference is a rotation; the database stamps it.
CREATE FUNCTION platform_secret_refs_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'system settings: a secret reference keeps its key' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.reference IS DISTINCT FROM OLD.reference THEN
    NEW.rotated_at := now();
  ELSE
    NEW.rotated_at := OLD.rotated_at;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_secret_refs_rules BEFORE INSERT OR UPDATE ON platform_secret_refs
  FOR EACH ROW EXECUTE FUNCTION platform_secret_refs_rules();

-- Brand assets: the upload never changes; the scanner (platform scope) records its result once.
CREATE FUNCTION platform_brand_assets_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'system settings: a new asset waits for its scan' USING ERRCODE = 'check_violation';
    END IF;
    NEW.scanned_at := NULL;
    NEW.uploaded_by_user_id := app_current_admin_id();
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.kind, NEW.file_name, NEW.content_type, NEW.size_bytes, NEW.width, NEW.height,
      NEW.sha256, NEW.s3_key, NEW.uploaded_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.kind, OLD.file_name, OLD.content_type, OLD.size_bytes, OLD.width, OLD.height,
      OLD.sha256, OLD.s3_key, OLD.uploaded_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'system settings: an uploaded asset never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scan_status IS DISTINCT FROM OLD.scan_status THEN
    IF OLD.scan_status <> 'PENDING' OR coalesce(app_scope(), '') <> 'platform' THEN
      RAISE EXCEPTION 'system settings: only the scanner records a scan, once' USING ERRCODE = 'check_violation';
    END IF;
    NEW.scanned_at := now();
  ELSE
    NEW.scanned_at := OLD.scanned_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_brand_assets_rules BEFORE INSERT OR UPDATE ON platform_brand_assets
  FOR EACH ROW EXECUTE FUNCTION platform_brand_assets_rules();

-- The asset in use for a kind is a clean asset of that kind.
CREATE FUNCTION platform_brand_current_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  a record;
BEGIN
  SELECT kind, scan_status INTO a FROM platform_brand_assets WHERE id = NEW.asset_id;
  IF a.kind IS DISTINCT FROM NEW.kind OR a.scan_status IS DISTINCT FROM 'CLEAN' THEN
    RAISE EXCEPTION 'system settings: the % in use is a clean % asset', NEW.kind, NEW.kind
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_brand_current_rules BEFORE INSERT OR UPDATE ON platform_brand_current
  FOR EACH ROW EXECUTE FUNCTION platform_brand_current_rules();

-- Features: a stable key; dependencies are existing features; a feature others depend on stays.
CREATE FUNCTION platform_features_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  missing text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM platform_features WHERE OLD.key = ANY (depends_on) LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'system settings: other features depend on %', OLD.key USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.key, NEW.created_at) IS DISTINCT FROM (OLD.key, OLD.created_at) THEN
    RAISE EXCEPTION 'system settings: a feature keeps its key' USING ERRCODE = 'check_violation';
  END IF;
  SELECT d INTO missing FROM unnest(NEW.depends_on) d
  WHERE NOT EXISTS (SELECT 1 FROM platform_features f WHERE f.key = d) LIMIT 1;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'system settings: % depends on an unknown feature %', NEW.key, missing
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_features_rules BEFORE INSERT OR UPDATE OR DELETE ON platform_features
  FOR EACH ROW EXECUTE FUNCTION platform_features_rules();

CREATE FUNCTION platform_feature_overrides_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF (NEW.feature_key, NEW.business_id, NEW.created_at)
        IS DISTINCT FROM (OLD.feature_key, OLD.business_id, OLD.created_at) THEN
    RAISE EXCEPTION 'system settings: an override stays on its feature and firm' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_feature_overrides_rules BEFORE INSERT OR UPDATE ON platform_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION platform_feature_overrides_rules();

-- Retention policies: the category and its floor are the migration's. A change to what is kept is
-- a new version that applies from its effective time (never in the past).
CREATE FUNCTION platform_retention_policies_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF (NEW.category, NEW.minimum_days) IS DISTINCT FROM (OLD.category, OLD.minimum_days) THEN
    RAISE EXCEPTION 'system settings: a retention category and its floor are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.retention_days, NEW.disposition, NEW.archive_after_days, NEW.effective_from)
     IS DISTINCT FROM (OLD.retention_days, OLD.disposition, OLD.archive_after_days, OLD.effective_from) THEN
    NEW.version := OLD.version + 1;
    NEW.effective_from := greatest(NEW.effective_from, now());
  ELSE
    NEW.version := OLD.version;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_retention_policies_rules BEFORE UPDATE ON platform_retention_policies
  FOR EACH ROW EXECUTE FUNCTION platform_retention_policies_rules();

-- Legal holds: placed by a team member; released once, with a reason; the database stamps both. A
-- firm under an active hold is not deleted (its deletion clears the link, which this refuses); a
-- released hold lets the link clear and stays on record.
CREATE FUNCTION platform_legal_holds_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.released_at IS NOT NULL OR NEW.release_reason IS NOT NULL THEN
      RAISE EXCEPTION 'system settings: a new hold is in force' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.released_by_user_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.held_business_id IS NULL AND OLD.held_business_id IS NOT NULL
     AND (NEW.id, NEW.name, NEW.reason, NEW.category, NEW.record_type, NEW.record_id, NEW.created_at,
          NEW.created_by_user_id, NEW.released_at, NEW.released_by_user_id, NEW.release_reason)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.name, OLD.reason, OLD.category, OLD.record_type, OLD.record_id, OLD.created_at,
          OLD.created_by_user_id, OLD.released_at, OLD.released_by_user_id, OLD.release_reason) THEN
    IF OLD.released_at IS NULL THEN
      RAISE EXCEPTION 'system settings: the firm is under a legal hold (%); release it first', OLD.name
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.name, NEW.reason, NEW.category, NEW.held_business_id, NEW.record_type, NEW.record_id,
      NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.name, OLD.reason, OLD.category, OLD.held_business_id, OLD.record_type, OLD.record_id,
      OLD.created_at, OLD.created_by_user_id)
     OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
    RAISE EXCEPTION 'system settings: a hold is only released, once' USING ERRCODE = 'check_violation';
  END IF;
  NEW.released_at := now();
  NEW.released_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_legal_holds_rules BEFORE INSERT OR UPDATE ON platform_legal_holds
  FOR EACH ROW EXECUTE FUNCTION platform_legal_holds_rules();

-- Retention runs: queued (by a team member or the scheduler) against the policy's current version;
-- QUEUED -> RUNNING -> COMPLETED or FAILED, moved by the worker (platform scope); a queued run can
-- be cancelled. What was asked never changes.
CREATE FUNCTION platform_retention_runs_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' THEN
      RAISE EXCEPTION 'system settings: a run starts QUEUED' USING ERRCODE = 'check_violation';
    END IF;
    SELECT version INTO NEW.policy_version FROM platform_retention_policies WHERE category = NEW.category;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'system settings: no retention policy for %', NEW.category
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.requested_by_user_id := app_current_admin_id();
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.category, NEW.dry_run, NEW.policy_version, NEW.requested_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.category, OLD.dry_run, OLD.policy_version, OLD.requested_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'system settings: a run''s request never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'system settings: a % run never changes', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.started_at := OLD.started_at;
  NEW.finished_at := OLD.finished_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'QUEUED' AND NEW.status = 'CANCELLED' THEN
      NEW.finished_at := now();
    ELSIF coalesce(app_scope(), '') <> 'platform'
          OR NOT ((OLD.status = 'QUEUED' AND NEW.status IN ('RUNNING', 'FAILED'))
                  OR (OLD.status = 'RUNNING' AND NEW.status IN ('COMPLETED', 'FAILED'))) THEN
      RAISE EXCEPTION 'system settings: a % run cannot become % here', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    ELSIF NEW.status = 'RUNNING' THEN
      NEW.started_at := now();
    ELSE
      NEW.finished_at := now();
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_retention_runs_rules BEFORE INSERT OR UPDATE ON platform_retention_runs
  FOR EACH ROW EXECUTE FUNCTION platform_retention_runs_rules();

-- Maintenance windows: SCHEDULED (editable) -> ACTIVE -> COMPLETED, or SCHEDULED -> CANCELLED.
-- While active, only the notice and the end time change. The database stamps the actual start and
-- end.
CREATE FUNCTION platform_maintenance_windows_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SCHEDULED' OR NEW.started_at IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'system settings: a window starts SCHEDULED' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.updated_by_user_id := app_current_admin_id();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.created_at, NEW.created_by_user_id) IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'system settings: a window keeps its creation' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'system settings: a % window never changes', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACTIVE' AND (NEW.title, NEW.starts_at, NEW.admin_bypass)
                               IS DISTINCT FROM (OLD.title, OLD.starts_at, OLD.admin_bypass) THEN
    RAISE EXCEPTION 'system settings: an active window changes only its notice and end' USING ERRCODE = 'check_violation';
  END IF;
  NEW.started_at := OLD.started_at;
  NEW.ended_at := OLD.ended_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'SCHEDULED' AND NEW.status IN ('ACTIVE', 'CANCELLED'))
            OR (OLD.status = 'ACTIVE' AND NEW.status = 'COMPLETED')) THEN
      RAISE EXCEPTION 'system settings: a % window cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'ACTIVE' THEN NEW.started_at := now(); END IF;
    IF NEW.status = 'COMPLETED' THEN NEW.ended_at := now(); END IF;
  END IF;
  NEW.updated_by_user_id := coalesce(app_current_admin_id(), OLD.updated_by_user_id);
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_maintenance_windows_rules BEFORE INSERT OR UPDATE ON platform_maintenance_windows
  FOR EACH ROW EXECUTE FUNCTION platform_maintenance_windows_rules();

-- Job controls: the platform registers jobs and records their runs; a team member only pauses
-- (with a reason) or resumes one.
CREATE FUNCTION platform_job_controls_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(app_scope(), '') <> 'platform' THEN
      RAISE EXCEPTION 'system settings: only the platform registers a job' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.job_key, NEW.created_at) IS DISTINCT FROM (OLD.job_key, OLD.created_at) THEN
    RAISE EXCEPTION 'system settings: a job keeps its key' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(app_scope(), '') <> 'platform'
     AND (NEW.name, NEW.last_run_at, NEW.last_status, NEW.last_error)
         IS DISTINCT FROM (OLD.name, OLD.last_run_at, OLD.last_status, OLD.last_error) THEN
    RAISE EXCEPTION 'system settings: a team member only pauses or resumes a job' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.enabled, NEW.paused_reason) IS DISTINCT FROM (OLD.enabled, OLD.paused_reason) THEN
    NEW.updated_by_user_id := app_current_admin_id();
  ELSE
    NEW.updated_by_user_id := OLD.updated_by_user_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_job_controls_rules BEFORE INSERT OR UPDATE ON platform_job_controls
  FOR EACH ROW EXECUTE FUNCTION platform_job_controls_rules();

-- Default sets: each save is the next version for its kind (the database numbers it); versions
-- never change.
CREATE FUNCTION platform_default_sets_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('platform_default_sets:' || NEW.kind));
  SELECT coalesce(max(version), 0) + 1 INTO NEW.version FROM platform_default_sets WHERE kind = NEW.kind;
  NEW.created_at := now();
  NEW.created_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_default_sets_rules BEFORE INSERT ON platform_default_sets
  FOR EACH ROW EXECUTE FUNCTION platform_default_sets_rules();

-- A firm is provisioned with firm defaults, once.
CREATE FUNCTION platform_default_set_applications_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM 1 FROM platform_default_sets WHERE id = NEW.default_set_id AND kind = 'FIRM';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'system settings: a firm is provisioned with firm defaults' USING ERRCODE = 'check_violation';
  END IF;
  NEW.applied_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_default_set_applications_rules BEFORE INSERT ON platform_default_set_applications
  FOR EACH ROW EXECUTE FUNCTION platform_default_set_applications_rules();

-- ---------- Grants ----------
-- Sections, retention policies and job controls are inserted by the migration or the platform and
-- only updated by the team; holds are released, never deleted; default sets and assets are
-- insert-only versions.
GRANT SELECT, UPDATE ON platform_settings, platform_retention_policies TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_secret_refs, platform_brand_current, platform_features,
  platform_feature_overrides TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON platform_brand_assets, platform_legal_holds, platform_retention_runs,
  platform_maintenance_windows, platform_job_controls TO firmivra_app;
GRANT SELECT, INSERT ON platform_default_sets, platform_default_set_applications TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_settings', 'platform_secret_refs', 'platform_brand_assets',
    'platform_brand_current', 'platform_features', 'platform_feature_overrides',
    'platform_retention_policies', 'platform_legal_holds', 'platform_retention_runs',
    'platform_maintenance_windows', 'platform_job_controls', 'platform_default_sets',
    'platform_default_set_applications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's own services (sign-in, mail, flags,
-- retention and maintenance jobs: platform scope) read everything. The team writes, with the API's
-- system_settings.* checks per page. Secret references and retention policies are written only by
-- a SUPER_ADMIN (elevated, spec 19). No firm scope reaches any table.
CREATE FUNCTION app_is_settings_team() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_settings', 'platform_brand_assets', 'platform_brand_current',
    'platform_features', 'platform_feature_overrides', 'platform_legal_holds', 'platform_retention_runs',
    'platform_maintenance_windows', 'platform_job_controls', 'platform_default_sets',
    'platform_default_set_applications'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_settings_team()) '
                   'WITH CHECK (app_is_settings_team())', t || '_team', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['platform_secret_refs', 'platform_retention_policies'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_settings_team())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app_is_admin())', t || '_admin_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (app_is_admin()) WITH CHECK (app_is_admin())',
                   t || '_admin_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (app_is_admin())', t || '_admin_delete', t);
  END LOOP;
END
$$;
