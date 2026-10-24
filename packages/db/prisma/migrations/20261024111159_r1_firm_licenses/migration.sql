-- r1_firm_licenses (R1, Oct 24; Rasel's block, R60's "Column request for R1", request 7): Company
-- Profile's professional licensing. firm_licenses holds a firm's licenses, one row each (a firm
-- may hold several). The firm reads its own; only a Super Admin (admin scope) or the platform scope
-- writes them, when Firmivra applies an approved Request Change, so a firm can never mark its own
-- license verified. No row is deleted: a license ends as EXPIRED, SUSPENDED or REVOKED.
-- Safe on dev: a new table, empty; its foreign keys take only short locks on businesses and on
-- platform_admins (written only when the team changes), and nothing else is altered.

-- CreateEnum
CREATE TYPE "FirmLicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateTable
CREATE TABLE "firm_licenses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "regulatory_body" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "expires_on" DATE,
    "status" "FirmLicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "firm_licenses_business_id_idx" ON "firm_licenses"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_licenses_business_id_id_key" ON "firm_licenses"("business_id", "id");

-- AddForeignKey
ALTER TABLE "firm_licenses" ADD CONSTRAINT "firm_licenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_licenses" ADD CONSTRAINT "firm_licenses_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS, policies ----------
-- The firm reads its own rows (Company Profile); the admin and platform scopes read and write
-- every firm's. No DELETE: a license is ended by its status.
GRANT SELECT, INSERT, UPDATE ON firm_licenses TO firmivra_app;
ALTER TABLE firm_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_licenses FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_licenses_read ON firm_licenses FOR SELECT
  USING (business_id = app_current_business_id() OR app_is_admin() OR app_scope() = 'platform');
CREATE POLICY firm_licenses_insert ON firm_licenses FOR INSERT
  WITH CHECK (app_is_admin() OR app_scope() = 'platform');
CREATE POLICY firm_licenses_update ON firm_licenses FOR UPDATE
  USING (app_is_admin() OR app_scope() = 'platform')
  WITH CHECK (app_is_admin() OR app_scope() = 'platform');

-- ---------- Shape ----------
-- Each text trimmed, something visible, no control characters (staff_line_ok, r35_staff_details):
-- regulatory body 1 to 120 characters, license type 1 to 80, license number 1 to 60. Verified by
-- and verified at come together.
ALTER TABLE firm_licenses ADD CONSTRAINT firm_licenses_values
  CHECK (regulatory_body = btrim(regulatory_body) AND staff_line_ok(regulatory_body, 120)
         AND license_type = btrim(license_type) AND staff_line_ok(license_type, 80)
         AND license_number = btrim(license_number) AND staff_line_ok(license_number, 60)
         AND (verified_by_user_id IS NULL) = (verified_at IS NULL));
