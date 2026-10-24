-- r1_intake_staff_settings (R1, Oct 24; Rasel's block, R60's "Column request for R1" in
-- docs/work/R60-intake.md): Intake Form Settings I7 (more emails for the staff "form submitted"
-- email), I8 (the reminders in minutes), I9 (the expiration alert in minutes, null for no alert),
-- I12 (the data retention period in years) on intake_settings, and Staff Management SM3: the
-- firm's saved job titles (staff_job_titles) and the security settings new staff accounts start
-- from (staff_security_defaults). R60 builds the API and screens on them. The old day and hour
-- columns stay until R60's API reads the new ones; a later migration drops them.
-- Safe on dev: the new columns have constant defaults (no rewrite); the new tables are empty
-- until the backfill below, which runs per firm because RLS is forced and the migration role does
-- not bypass it on RDS; every saved value converts into the new ranges.

-- AlterTable
ALTER TABLE "intake_settings" ADD COLUMN     "data_retention_years" INTEGER,
ADD COLUMN     "expiry_alert_minutes" INTEGER DEFAULT 1440,
ADD COLUMN     "final_reminder_minutes" INTEGER NOT NULL DEFAULT 10080,
ADD COLUMN     "first_reminder_minutes" INTEGER NOT NULL DEFAULT 4320,
ADD COLUMN     "notify_additional_emails" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "staff_job_titles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_security_defaults" (
    "business_id" UUID NOT NULL,
    "allowed_auth_methods" "StaffAuthMethod"[] DEFAULT ARRAY['AUTHENTICATOR_APP', 'BACKUP_CODES']::"StaffAuthMethod"[],
    "access_location" "StaffAccessLocation" NOT NULL DEFAULT 'ANYWHERE',
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrict_devices" BOOLEAN NOT NULL DEFAULT false,
    "auto_logout_minutes" INTEGER,
    "max_concurrent_sessions" INTEGER NOT NULL DEFAULT 1,
    "sign_out_other_sessions" BOOLEAN NOT NULL DEFAULT false,
    "allow_trusted_devices" BOOLEAN NOT NULL DEFAULT false,
    "notify_new_device_login" BOOLEAN NOT NULL DEFAULT true,
    "notify_failed_logins" BOOLEAN NOT NULL DEFAULT true,
    "notify_password_changes" BOOLEAN NOT NULL DEFAULT true,
    "notify_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "notify_lockouts" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_security_defaults_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "staff_job_titles_business_id_idx" ON "staff_job_titles"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_job_titles_business_id_id_key" ON "staff_job_titles"("business_id", "id");

-- AddForeignKey
ALTER TABLE "staff_job_titles" ADD CONSTRAINT "staff_job_titles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_job_titles" ADD CONSTRAINT "staff_job_titles_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_security_defaults" ADD CONSTRAINT "staff_security_defaults_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_security_defaults" ADD CONSTRAINT "staff_security_defaults_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS, policy (the new firm tables) ----------
-- Job titles are archived, never deleted; the defaults row is kept and changed.
GRANT SELECT, INSERT, UPDATE ON staff_job_titles, staff_security_defaults TO firmivra_app;

ALTER TABLE staff_job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_job_titles FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_job_titles_business ON staff_job_titles
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE staff_security_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_security_defaults FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_security_defaults_business ON staff_security_defaults
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- I7, I8, I9, I12: intake settings ----------
-- Every existing row keeps its saved reminders and alert, now also in minutes. Each firm in its own
-- scope: under forced RLS an owner role that doesn't bypass it (RDS) would see no rows.
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE intake_settings
       SET first_reminder_minutes = first_reminder_days * 1440,
           final_reminder_minutes = final_reminder_days * 1440,
           expiry_alert_minutes = expiry_alert_hours * 60
     WHERE business_id = firm;
    -- SM3: the firm's saved job titles start as the distinct titles its staff records carry
    -- (the first spelling of each, ignoring case; a title longer than 80 stays on its record).
    INSERT INTO staff_job_titles (id, business_id, name, created_at, updated_at)
    SELECT gen_random_uuid(), firm, t.name, now(), now()
      FROM (SELECT DISTINCT ON (lower(btrim(m.job_title))) btrim(m.job_title) AS name
              FROM memberships m
             WHERE m.business_id = firm AND char_length(btrim(m.job_title)) BETWEEN 1 AND 80
             ORDER BY lower(btrim(m.job_title)), m.created_at) t;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- The reminders in minutes: 5 minutes to 30 days, the final after the first and at most 60 days.
-- The old day and hour columns keep their rules until R60's API reads minutes and a later
-- migration drops them.
ALTER TABLE intake_settings DROP CONSTRAINT intake_settings_ranges;
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_ranges
  CHECK ((((default_expiry_days >= 1) AND (default_expiry_days <= 365)) AND ((first_reminder_days >= 1) AND (first_reminder_days <= 30)) AND (final_reminder_days > first_reminder_days) AND (final_reminder_days <= 60) AND ((expiry_alert_hours >= 1) AND (expiry_alert_hours <= 168)) AND ((max_file_size_mb >= 1) AND (max_file_size_mb <= 100))
         AND first_reminder_minutes BETWEEN 5 AND 43200
         AND final_reminder_minutes > first_reminder_minutes AND final_reminder_minutes <= 86400));
-- Null means no alert.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_expiry_alert_minutes
  CHECK (expiry_alert_minutes IS NULL OR expiry_alert_minutes BETWEEN 30 AND 10080);
-- Null means not set. Saving it deletes nothing; no job reads it yet.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_data_retention_years
  CHECK (data_retention_years IS NULL OR data_retention_years BETWEEN 1 AND 100);
-- The API keeps each one a valid, lower-case, unique email.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_notify_additional_emails
  CHECK (notify_additional_emails IS NOT NULL AND cardinality(notify_additional_emails) <= 10);

-- ---------- SM3: saved job titles ----------
ALTER TABLE staff_job_titles ADD CONSTRAINT staff_job_titles_name
  CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80);
CREATE UNIQUE INDEX staff_job_titles_active_name_key ON staff_job_titles (business_id, lower(name))
  WHERE archived_at IS NULL;

-- ---------- SM3: staff security defaults for new accounts ----------
-- The same rules as staff_security_settings (r35_staff_details), without the per-account parts.
ALTER TABLE staff_security_defaults ADD CONSTRAINT staff_security_defaults_rules
  CHECK (allowed_auth_methods IS NOT NULL AND allowed_ips IS NOT NULL
         AND allowed_countries IS NOT NULL
         AND (auto_logout_minutes IS NULL OR auto_logout_minutes BETWEEN 5 AND 480)
         AND max_concurrent_sessions BETWEEN 1 AND 10
         AND cardinality(allowed_auth_methods) >= 1 AND staff_list_ok(allowed_auth_methods)
         AND staff_list_ok(allowed_ips) AND cardinality(allowed_ips) <= 20
         AND staff_ips_ok(allowed_ips)
         AND staff_list_ok(allowed_countries) AND cardinality(allowed_countries) <= 50
         AND staff_countries_ok(allowed_countries)
         AND (access_location = 'ALLOWED_IPS') = (cardinality(allowed_ips) > 0)
         AND (access_location = 'ALLOWED_COUNTRIES') = (cardinality(allowed_countries) > 0));
