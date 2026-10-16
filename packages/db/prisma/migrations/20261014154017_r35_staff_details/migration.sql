-- r35_staff_details (R35, Rasel Oct 14): what Create/Edit Staff and Staff Account Access &
-- Security keep about a member: employment and assignment details, and sign-in rules and security
-- notices. One row per member in each table. Every new table is a firm table: business_id,
-- same-firm foreign keys, RLS enabled and forced with the business policy.

-- CreateEnum
CREATE TYPE "StaffEmploymentType" AS ENUM ('W2', 'FORM_1099', 'FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'SEASONAL', 'INTERN', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffAccessLevel" AS ENUM ('STANDARD_USER', 'MANAGER', 'ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "StaffAuthMethod" AS ENUM ('AUTHENTICATOR_APP', 'SMS', 'EMAIL', 'BACKUP_CODES');

-- CreateEnum
CREATE TYPE "StaffAccessLocation" AS ENUM ('ANYWHERE', 'ALLOWED_IPS', 'ALLOWED_COUNTRIES');

-- CreateTable
CREATE TABLE "staff_profiles" (
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "employment_type" "StaffEmploymentType",
    "work_schedule" TEXT,
    "office" TEXT,
    "hire_date" DATE,
    "end_date" DATE,
    "supervisor_membership_id" UUID,
    "time_zone" TEXT,
    "employee_id" TEXT,
    "primary_specialty" TEXT,
    "service_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_workload" INTEGER,
    "accepts_new_clients" BOOLEAN NOT NULL DEFAULT true,
    "access_level" "StaffAccessLevel" NOT NULL DEFAULT 'STANDARD_USER',
    "access_starts_on" DATE,
    "notes" TEXT,
    "notes_updated_at" TIMESTAMPTZ(3),
    "notes_updated_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("business_id","membership_id")
);

-- CreateTable
CREATE TABLE "staff_security_settings" (
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "require_password_change" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "allowed_auth_methods" "StaffAuthMethod"[] DEFAULT ARRAY['AUTHENTICATOR_APP', 'BACKUP_CODES']::"StaffAuthMethod"[],
    "access_location" "StaffAccessLocation" NOT NULL DEFAULT 'ANYWHERE',
    "allowed_ips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restrict_devices" BOOLEAN NOT NULL DEFAULT false,
    "auto_logout_minutes" INTEGER,
    "disable_on" DATE,
    "max_concurrent_sessions" INTEGER NOT NULL DEFAULT 1,
    "sign_out_other_sessions" BOOLEAN NOT NULL DEFAULT false,
    "allow_trusted_devices" BOOLEAN NOT NULL DEFAULT false,
    "recovery_email" TEXT,
    "recovery_email_verified_at" TIMESTAMPTZ(3),
    "notify_new_device_login" BOOLEAN NOT NULL DEFAULT true,
    "notify_failed_logins" BOOLEAN NOT NULL DEFAULT true,
    "notify_password_changes" BOOLEAN NOT NULL DEFAULT true,
    "notify_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "notify_lockouts" BOOLEAN NOT NULL DEFAULT true,
    "locked_at" TIMESTAMPTZ(3),
    "locked_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_security_settings_pkey" PRIMARY KEY ("business_id","membership_id")
);

-- CreateIndex
CREATE INDEX "staff_profiles_business_id_supervisor_membership_id_idx" ON "staff_profiles"("business_id", "supervisor_membership_id");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_business_id_supervisor_membership_id_fkey" FOREIGN KEY ("business_id", "supervisor_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_business_id_notes_updated_by_membership_id_fkey" FOREIGN KEY ("business_id", "notes_updated_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_security_settings" ADD CONSTRAINT "staff_security_settings_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE ON staff_profiles, staff_security_settings TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_profiles', 'staff_security_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;
-- ---------- Shape ----------
-- A short one-line text: something in it, no control characters.
CREATE FUNCTION staff_line_ok(v text, max integer) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v IS NULL OR (v ~ '[^[:space:]]' AND char_length(v) <= max AND v !~ '[\x01-\x1F\x7F-\x9F]') $$;
-- IP addresses or networks, as the database reads them.
CREATE FUNCTION staff_ips_ok(items text[]) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE
  AS $$
BEGIN
  PERFORM i::inet FROM unnest(items) AS u(i);
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END
$$;
-- Two-letter country codes, upper case.
CREATE FUNCTION staff_countries_ok(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT coalesce(bool_and(c ~ '^[A-Z]{2}$'), true) FROM unnest(items) AS u(c) $$;
-- A list holds each value once, in one dimension.
CREATE FUNCTION staff_list_ok(items anyarray) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT items IS NOT NULL AND (cardinality(items) = 0 OR array_ndims(items) = 1)
               AND cardinality(items) = (SELECT count(DISTINCT i) FROM unnest(items) AS u(i)) $$;

-- Profile: a member supervises someone else; the end is after the start; the time zone is a
-- name like America/New_York (the API checks it against the zone list).
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_rules
  CHECK (supervisor_membership_id IS DISTINCT FROM membership_id
         AND (end_date IS NULL OR hire_date IS NULL OR end_date >= hire_date)
         AND (time_zone IS NULL OR time_zone ~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2})$')
         AND (max_workload IS NULL OR max_workload BETWEEN 1 AND 10000)
         AND (notes_updated_at IS NULL) = (notes_updated_by_membership_id IS NULL)
         AND (notes IS NULL OR (char_length(notes) <= 500
              AND notes !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'))
         AND staff_line_ok(work_schedule, 80) AND staff_line_ok(office, 100)
         AND staff_line_ok(employee_id, 40));
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_codes
  CHECK ((primary_specialty IS NULL OR primary_specialty ~ '^[A-Z][A-Z0-9_]*$'
          AND char_length(primary_specialty) <= 40)
         AND staff_list_ok(service_areas) AND cardinality(service_areas) <= 20
         AND codes_ok(service_areas));
CREATE UNIQUE INDEX staff_profiles_business_id_employee_id_key
  ON staff_profiles (business_id, lower(btrim(employee_id))) WHERE employee_id IS NOT NULL;

-- Security: bounded values, and the location rule matches its list.
ALTER TABLE staff_security_settings ADD CONSTRAINT staff_security_settings_rules
  CHECK ((auto_logout_minutes IS NULL OR auto_logout_minutes BETWEEN 5 AND 480)
         AND max_concurrent_sessions BETWEEN 1 AND 10
         AND cardinality(allowed_auth_methods) >= 1 AND staff_list_ok(allowed_auth_methods)
         AND staff_list_ok(allowed_ips) AND cardinality(allowed_ips) <= 20
         AND staff_ips_ok(allowed_ips)
         AND staff_list_ok(allowed_countries) AND cardinality(allowed_countries) <= 50
         AND staff_countries_ok(allowed_countries)
         AND (access_location = 'ALLOWED_IPS') = (cardinality(allowed_ips) > 0)
         AND (access_location = 'ALLOWED_COUNTRIES') = (cardinality(allowed_countries) > 0)
         AND (locked_reason IS NULL OR locked_at IS NOT NULL)
         AND staff_line_ok(locked_reason, 200)
         AND (recovery_email IS NULL OR (char_length(recovery_email) <= 254
              AND recovery_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
         AND (recovery_email_verified_at IS NULL OR recovery_email IS NOT NULL));
