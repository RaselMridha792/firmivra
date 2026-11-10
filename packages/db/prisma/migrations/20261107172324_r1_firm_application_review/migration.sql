-- R1 (Rasel's approval in R1's window, Nov 7; Oct 31 Super Admin review, FIRM-APPLICATIONS.md
-- section D). SA-APP-F02: a reviewer opening an application moves it to In Review (the history
-- trigger records who and when). SA-APP-F03: firm_application_info_requests (reason, who, when,
-- the link token's hash, expiry, OPEN / RESPONDED / SUPERSEDED). SA-APP-F04: the applicant's
-- firm_application_responses on the same application, and their scanned files. SA-APP-F06:
-- firm_applications.assigned_reviewer_user_id. The "applications.review" platform permission is a
-- key no role holds by default, so no rows. Platform data: platform scope reads and writes
-- (the applicant's link), admins read, and reviewers write requests. No backfill.
-- Safe on dev: new tables are empty; one nullable column; the trigger is replaced in place.
-- CreateEnum
CREATE TYPE "FirmApplicationInfoRequestStatus" AS ENUM ('OPEN', 'RESPONDED', 'SUPERSEDED');

-- AlterEnum
-- (IN_REVIEW: added by r1_firm_application_in_review.)

-- AlterTable
ALTER TABLE "firm_applications" ADD COLUMN     "assigned_reviewer_user_id" UUID;

-- CreateTable
CREATE TABLE "firm_application_info_requests" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "FirmApplicationInfoRequestStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "firm_application_info_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_application_responses" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "text" TEXT,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_application_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_application_response_files" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_application_response_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_application_info_requests_token_hash_key" ON "firm_application_info_requests"("token_hash");

-- CreateIndex
CREATE INDEX "firm_application_info_requests_application_id_requested_at_idx" ON "firm_application_info_requests"("application_id", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "firm_application_info_requests_application_id_id_key" ON "firm_application_info_requests"("application_id", "id");

-- CreateIndex
CREATE INDEX "firm_application_responses_application_id_submitted_at_idx" ON "firm_application_responses"("application_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "firm_application_responses_application_id_id_key" ON "firm_application_responses"("application_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_application_response_files_s3_key_key" ON "firm_application_response_files"("s3_key");

-- CreateIndex
CREATE INDEX "firm_application_response_files_application_id_response_id_idx" ON "firm_application_response_files"("application_id", "response_id");

-- CreateIndex
CREATE INDEX "firm_applications_assigned_reviewer_user_id_idx" ON "firm_applications"("assigned_reviewer_user_id");

-- AddForeignKey
ALTER TABLE "firm_applications" ADD CONSTRAINT "firm_applications_assigned_reviewer_user_id_fkey" FOREIGN KEY ("assigned_reviewer_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_application_info_requests" ADD CONSTRAINT "firm_application_info_requests_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "firm_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_application_info_requests" ADD CONSTRAINT "firm_application_info_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_application_responses" ADD CONSTRAINT "firm_application_responses_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "firm_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_application_responses" ADD CONSTRAINT "firm_application_responses_application_id_request_id_fkey" FOREIGN KEY ("application_id", "request_id") REFERENCES "firm_application_info_requests"("application_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_application_response_files" ADD CONSTRAINT "firm_application_response_files_application_id_response_id_fkey" FOREIGN KEY ("application_id", "response_id") REFERENCES "firm_application_responses"("application_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- The review rules: In Review and its transitions ----------
CREATE OR REPLACE FUNCTION firm_applications_admin_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  decision_changed boolean;
BEGIN
  IF app_scope() <> 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.legal_name <> OLD.legal_name
     OR NEW.dba_name IS DISTINCT FROM OLD.dba_name OR NEW.contact_name <> OLD.contact_name
     OR NEW.contact_email <> OLD.contact_email OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
     OR NEW.data <> OLD.data OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'firm applications: a review changes only the decision, never the application'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  decision_changed := NEW.status <> OLD.status
    OR NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason;
  IF NOT decision_changed THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('APPROVED', 'DECLINED') OR OLD.business_id IS NOT NULL THEN
    RAISE EXCEPTION 'firm applications: a decided or provisioned application is final'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewed_by_user_id IS DISTINCT FROM app_current_admin_id() THEN
    RAISE EXCEPTION 'firm applications: a decision is recorded as the acting admin'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Pending opens to In Review (or is decided directly); In Review asks for information or is
  -- decided; an answered request goes back to In Review. Nothing returns to Pending.
  IF NEW.status <> OLD.status
     AND NOT ((OLD.status = 'PENDING_REVIEW'
               AND NEW.status IN ('IN_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'DECLINED'))
              OR (OLD.status = 'IN_REVIEW'
                  AND NEW.status IN ('INFO_REQUESTED', 'APPROVED', 'DECLINED'))
              OR (OLD.status = 'INFO_REQUESTED'
                  AND NEW.status IN ('IN_REVIEW', 'APPROVED', 'DECLINED'))) THEN
    RAISE EXCEPTION 'firm applications: an application cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('INFO_REQUESTED', 'DECLINED')
     AND (NEW.status <> OLD.status OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    IF coalesce(btrim(NEW.decision_reason), '') = '' THEN
      RAISE EXCEPTION 'firm applications: requesting info or declining needs a message (decision_reason)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'firm applications: requesting info or declining needs a new message, not the previous one'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The database's clock, never a time the API sends.
  NEW.reviewed_at := now();
  RETURN NEW;
END
$$;


-- ---------- Access ----------
-- Never deleted. The applicant's link writes in platform scope; reviewers (admin scope) read all
-- three and write requests (a repeat request supersedes the open one).
GRANT SELECT, INSERT, UPDATE ON firm_application_info_requests, firm_application_responses,
  firm_application_response_files TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firm_application_info_requests', 'firm_application_responses',
    'firm_application_response_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (app_scope() = ''platform'')'
                   ' WITH CHECK (app_scope() = ''platform'')', t || '_platform', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_admin())', t || '_admin_read', t);
  END LOOP;
END
$$;
CREATE POLICY firm_application_info_requests_admin_insert ON firm_application_info_requests
  FOR INSERT WITH CHECK (app_is_admin());
CREATE POLICY firm_application_info_requests_admin_update ON firm_application_info_requests
  FOR UPDATE USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ---------- Data rules Prisma cannot express ----------
-- A request: what is needed, the token's hash (never the token), a link that expires, and closed
-- exactly when it is no longer open; at most one open request per application.
ALTER TABLE firm_application_info_requests ADD CONSTRAINT firm_application_info_requests_shape
  CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000
     AND token_hash ~ '^[0-9a-f]{64}$'
     AND expires_at > requested_at
     AND (status = 'OPEN') = (closed_at IS NULL));
CREATE UNIQUE INDEX firm_application_info_requests_one_open
  ON firm_application_info_requests (application_id) WHERE status = 'OPEN';
-- A request keeps its application, reason, requester and token; it only closes, once.
CREATE FUNCTION firm_application_info_requests_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.application_id, NEW.reason, NEW.requested_by_user_id, NEW.requested_at,
      NEW.token_hash, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.application_id, OLD.reason, OLD.requested_by_user_id, OLD.requested_at,
      OLD.token_hash, OLD.expires_at)
     OR (OLD.status <> 'OPEN' AND (NEW.status, NEW.closed_at) IS DISTINCT FROM (OLD.status, OLD.closed_at)) THEN
    RAISE EXCEPTION 'firm application info requests: a request only closes, once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_application_info_requests_rules
  BEFORE UPDATE ON firm_application_info_requests
  FOR EACH ROW EXECUTE FUNCTION firm_application_info_requests_rules();

-- A response: text, files or both (the files come after the row), up to 5000 characters of text.
ALTER TABLE firm_application_responses ADD CONSTRAINT firm_application_responses_shape
  CHECK (text IS NULL OR char_length(btrim(text)) BETWEEN 1 AND 5000);
-- Responses and their files are never changed, except a file's scan result.
CREATE FUNCTION firm_application_responses_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'firm application responses: a response never changes'
    USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER firm_application_responses_frozen
  BEFORE UPDATE ON firm_application_responses
  FOR EACH ROW EXECUTE FUNCTION firm_application_responses_frozen();

-- A file: under its own application's and response's folder, PDF, JPG or PNG, up to 10 MB.
ALTER TABLE firm_application_response_files ADD CONSTRAINT firm_application_response_files_shape
  CHECK (starts_with(s3_key, 'tenant/' || application_id || '/applications/' || response_id || '/')
     AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'
     AND char_length(btrim(file_name)) BETWEEN 1 AND 255
     AND content_type IN ('application/pdf', 'image/jpeg', 'image/png')
     AND size_bytes BETWEEN 1 AND 10485760);
CREATE FUNCTION firm_application_response_files_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.application_id, NEW.response_id, NEW.s3_key, NEW.file_name, NEW.content_type,
      NEW.size_bytes, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.application_id, OLD.response_id, OLD.s3_key, OLD.file_name, OLD.content_type,
      OLD.size_bytes, OLD.created_at) THEN
    RAISE EXCEPTION 'firm application response files: only the scan result changes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_application_response_files_rules
  BEFORE UPDATE ON firm_application_response_files
  FOR EACH ROW EXECUTE FUNCTION firm_application_response_files_rules();
