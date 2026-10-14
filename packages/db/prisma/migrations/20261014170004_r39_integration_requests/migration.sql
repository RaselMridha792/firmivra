-- CreateEnum
CREATE TYPE "IntegrationRequestStatus" AS ENUM ('NEW', 'REVIEWING', 'PLANNED', 'IN_DEVELOPMENT', 'AVAILABLE', 'DECLINED');

-- CreateTable
CREATE TABLE "integration_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "provider_name" TEXT NOT NULL,
    "website_url" TEXT,
    "category" TEXT,
    "connect_to" TEXT NOT NULL,
    "business_reason" TEXT,
    "status" "IntegrationRequestStatus" NOT NULL DEFAULT 'NEW',
    "internal_note" TEXT,
    "status_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_requests_business_id_created_at_idx" ON "integration_requests"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_requests_status_created_at_idx" ON "integration_requests"("status", "created_at");


-- Grants: a firm can add a request but not change it (Super Admin reviews it).
GRANT SELECT, INSERT, UPDATE ON integration_requests TO firmivra_app;

-- Requests: the firm reads and adds its own; Super Admin (admin scope) reads all and reviews.
ALTER TABLE integration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_requests_select ON integration_requests FOR SELECT
  USING (business_id = app_current_business_id() OR app_is_admin());
CREATE POLICY integration_requests_insert ON integration_requests FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY integration_requests_review ON integration_requests FOR UPDATE
  USING (app_is_admin()) WITH CHECK (app_is_admin());

ALTER TABLE integration_requests ADD CONSTRAINT integration_requests_values
  CHECK (esign_text_ok(provider_name, 120) AND esign_text_ok(connect_to, 1000)
         AND (website_url IS NULL OR website_url ~ '^https?://[^\s]{1,255}$')
         AND (category IS NULL OR esign_text_ok(category, 80))
         AND (business_reason IS NULL OR esign_text_ok(business_reason, 1000))
         AND (internal_note IS NULL OR esign_text_ok(internal_note, 2000)));

-- A review changes only the status and the internal note; the time of a status change is the database's.
CREATE FUNCTION integration_requests_review() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'internal_note' - 'status_changed_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'internal_note' - 'status_changed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'REQUEST_FROZEN: only the status and the internal note change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := clock_timestamp();
  ELSE
    NEW.status_changed_at := OLD.status_changed_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER integration_requests_review BEFORE UPDATE ON integration_requests
  FOR EACH ROW EXECUTE FUNCTION integration_requests_review();

