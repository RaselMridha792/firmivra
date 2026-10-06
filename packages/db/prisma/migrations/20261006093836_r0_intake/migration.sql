-- CreateEnum
CREATE TYPE "IntakeFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('SENT', 'IN_PROGRESS', 'SUBMITTED', 'NEEDS_CORRECTION', 'UNDER_REVIEW', 'COMPLETED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CONVERTED', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "lead_upload_id" UUID;

-- CreateTable
CREATE TABLE "intake_forms" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL DEFAULT '{}',
    "agreement_text" TEXT,
    "status" "IntakeFormStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intake_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intakes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "engagement_id" UUID,
    "lead_id" UUID,
    "status" "IntakeStatus" NOT NULL DEFAULT 'SENT',
    "due_on" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_submissions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "intake_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_user_id" UUID,
    "signer_name" TEXT,
    "signed_at" TIMESTAMPTZ(3),
    "signer_ip" INET,
    "signer_user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intake_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'DRAFT',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "resume_token_hash" TEXT,
    "resume_expires_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "client_id" UUID,
    "engagement_id" UUID,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_uploads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_business_id_service_id_version_key" ON "intake_forms"("business_id", "service_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_business_id_id_key" ON "intake_forms"("business_id", "id");

-- CreateIndex
CREATE INDEX "intakes_business_id_engagement_id_idx" ON "intakes"("business_id", "engagement_id");

-- CreateIndex
CREATE INDEX "intakes_business_id_lead_id_idx" ON "intakes"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "intakes_business_id_id_key" ON "intakes"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_submissions_business_id_intake_id_version_key" ON "intake_submissions"("business_id", "intake_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "leads_resume_token_hash_key" ON "leads"("resume_token_hash");

-- CreateIndex
CREATE INDEX "leads_business_id_status_created_at_idx" ON "leads"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_business_id_email_idx" ON "leads"("business_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "leads_business_id_id_key" ON "leads"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_uploads_s3_key_key" ON "lead_uploads"("s3_key");

-- CreateIndex
CREATE INDEX "lead_uploads_business_id_lead_id_idx" ON "lead_uploads"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_uploads_business_id_id_key" ON "lead_uploads"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_business_id_lead_upload_id_key" ON "documents"("business_id", "lead_upload_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_lead_upload_id_fkey" FOREIGN KEY ("business_id", "lead_upload_id") REFERENCES "lead_uploads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_form_id_fkey" FOREIGN KEY ("business_id", "form_id") REFERENCES "intake_forms"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_submissions" ADD CONSTRAINT "intake_submissions_business_id_intake_id_fkey" FOREIGN KEY ("business_id", "intake_id") REFERENCES "intakes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_uploads" ADD CONSTRAINT "lead_uploads_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 6: row-level security and data rules ====================
-- Intake forms (versioned definitions), intakes and their submitted versions, Begin Online
-- leads and their uploads, and documents carried over from lead uploads.

-- ---------- Grants ----------
-- Forms: only a draft that was never published can be deleted (policy below).
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_forms TO firmivra_app;
-- Intakes, their versions and leads are records: archived, declined or expired, never deleted.
GRANT SELECT, INSERT, UPDATE ON intakes, intake_submissions, leads TO firmivra_app;
-- Lead uploads: deleted only while the lead is still a draft (policy below).
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_uploads TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE intake_forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms       FORCE ROW LEVEL SECURITY;
ALTER TABLE intakes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE intakes            FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads              FORCE ROW LEVEL SECURITY;
ALTER TABLE lead_uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_uploads       FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
-- Begin Online runs signed out, but the firm comes from the site's route (its slug), so the API
-- still works in that firm's business scope.
CREATE POLICY intakes_business ON intakes
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY intake_submissions_business ON intake_submissions
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY leads_business ON leads
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY intake_forms_select ON intake_forms FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY intake_forms_insert ON intake_forms FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY intake_forms_update ON intake_forms FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY intake_forms_delete_draft ON intake_forms FOR DELETE
  USING (business_id = app_current_business_id() AND status = 'DRAFT');

CREATE POLICY lead_uploads_select ON lead_uploads FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY lead_uploads_insert ON lead_uploads FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY lead_uploads_update ON lead_uploads FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY lead_uploads_delete_draft ON lead_uploads FOR DELETE
  USING (business_id = app_current_business_id()
         AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_uploads.lead_id AND l.status = 'DRAFT'));

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_version_positive CHECK (version > 0);
ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_title_not_blank CHECK (btrim(title) <> '');
-- Published and retired forms carry their publication time; a draft has none.
ALTER TABLE intake_forms ADD CONSTRAINT intake_forms_published_at
  CHECK ((status = 'DRAFT') = (published_at IS NULL));

ALTER TABLE intakes ADD CONSTRAINT intakes_engagement_or_lead
  CHECK (num_nonnulls(engagement_id, lead_id) >= 1);

ALTER TABLE intake_submissions ADD CONSTRAINT intake_submissions_version_positive
  CHECK (version > 0);
-- A signature is a name and a time; IP and browser are recorded only with a signature.
ALTER TABLE intake_submissions ADD CONSTRAINT intake_submissions_signature
  CHECK ((signed_at IS NULL) = (signer_name IS NULL)
         AND (signed_at IS NOT NULL OR (signer_ip IS NULL AND signer_user_agent IS NULL))
         AND coalesce(btrim(signer_name), 'x') <> '');

ALTER TABLE leads ADD CONSTRAINT leads_email_lowercase CHECK (email = lower(email));
ALTER TABLE leads ADD CONSTRAINT leads_names_not_blank
  CHECK (btrim(first_name) <> '' AND btrim(last_name) <> '');
ALTER TABLE leads ADD CONSTRAINT leads_resume_token_hash_sha256
  CHECK (resume_token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE leads ADD CONSTRAINT leads_resume_link
  CHECK ((resume_token_hash IS NULL) = (resume_expires_at IS NULL));
-- A converted lead names its client and engagement, and only a converted lead does.
ALTER TABLE leads ADD CONSTRAINT leads_converted
  CHECK ((client_id IS NULL) = (engagement_id IS NULL)
         AND (status = 'CONVERTED') = (engagement_id IS NOT NULL));
ALTER TABLE leads ADD CONSTRAINT leads_submitted_at
  CHECK (status IN ('DRAFT', 'EXPIRED') OR submitted_at IS NOT NULL);
ALTER TABLE leads ADD CONSTRAINT leads_decline_reason
  CHECK (status <> 'DECLINED' OR coalesce(btrim(decline_reason), '') <> '');

ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_s3_key_firm_prefix
  CHECK (starts_with(s3_key, 'tenant/' || business_id::text || '/'));
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_size_10_mb
  CHECK (size_bytes BETWEEN 1 AND 10485760);
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_names_not_blank
  CHECK (btrim(file_name) <> '' AND btrim(slot) <> '');
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_scanned_at
  CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL));

-- ---------- Intake forms: a published version never changes ----------
CREATE FUNCTION intake_forms_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.service_id <> OLD.service_id
       OR NEW.version <> OLD.version OR NEW.title <> OLD.title OR NEW.definition <> OLD.definition
       OR NEW.agreement_text IS DISTINCT FROM OLD.agreement_text
       OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'intake forms: a published version cannot change; publish a new version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED') THEN
      RAISE EXCEPTION 'intake forms: a published version can only be retired'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_forms_rules
  BEFORE UPDATE ON intake_forms
  FOR EACH ROW EXECUTE FUNCTION intake_forms_rules();

-- ---------- Intakes: a published form of the right service; lead fixed, engagement set once ----------
CREATE FUNCTION intakes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  form_service uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT f.service_id INTO form_service FROM intake_forms f
      WHERE f.id = NEW.form_id AND f.status = 'PUBLISHED';
    IF form_service IS NULL THEN
      RAISE EXCEPTION 'intakes: the form must be a published version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.engagement_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM engagements e WHERE e.id = NEW.engagement_id AND e.service_id = form_service))
       OR (NEW.lead_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM leads l WHERE l.id = NEW.lead_id AND l.service_id = form_service)) THEN
      RAISE EXCEPTION 'intakes: the form must be for the service of the engagement or lead'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.form_id <> OLD.form_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'intakes: the form and lead of an intake cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id THEN
    -- Only a lead's intake gets an engagement, once: the one its lead was converted into.
    IF OLD.engagement_id IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM leads l
         WHERE l.id = OLD.lead_id AND l.status = 'CONVERTED' AND l.engagement_id = NEW.engagement_id) THEN
      RAISE EXCEPTION 'intakes: the engagement is set once, from the converted lead'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intakes_rules
  BEFORE INSERT OR UPDATE ON intakes
  FOR EACH ROW EXECUTE FUNCTION intakes_rules();

-- ---------- Intake submissions: one draft at a time, then locked ----------
CREATE FUNCTION intake_submissions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  last_version int;
  open_drafts int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(max(s.version), 0), count(*) FILTER (WHERE s.submitted_at IS NULL)
      INTO last_version, open_drafts
      FROM intake_submissions s WHERE s.intake_id = NEW.intake_id;
    IF open_drafts > 0 THEN
      RAISE EXCEPTION 'intake submissions: an intake has one draft at a time'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.version <> last_version + 1 THEN
      RAISE EXCEPTION 'intake submissions: the next version must be %', last_version + 1
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'intake submissions: a submitted version is locked; start the next version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.intake_id <> OLD.intake_id
     OR NEW.version <> OLD.version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'intake submissions: the intake and version cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_submissions_rules
  BEFORE INSERT OR UPDATE ON intake_submissions
  FOR EACH ROW EXECUTE FUNCTION intake_submissions_rules();

-- ---------- Leads: resume link at most 30 days; conversion set once and final ----------
CREATE FUNCTION leads_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Judged by the database clock, with 1 minute of slack for the API clock.
  IF NEW.resume_expires_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.resume_token_hash IS DISTINCT FROM OLD.resume_token_hash
          OR NEW.resume_expires_at IS DISTINCT FROM OLD.resume_expires_at)
     AND NEW.resume_expires_at > now() + interval '30 days 1 minute' THEN
    RAISE EXCEPTION 'leads: a resume link lasts at most 30 days'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.service_id <> OLD.service_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'leads: the service of a lead cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'CONVERTED' AND (NEW.status <> OLD.status
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id) THEN
      RAISE EXCEPTION 'leads: a converted lead stays converted to its client and engagement'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- The new engagement is for the service the visitor asked for.
  IF NEW.engagement_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id)
     AND NOT EXISTS (SELECT 1 FROM engagements e
                     WHERE e.id = NEW.engagement_id AND e.service_id = NEW.service_id) THEN
    RAISE EXCEPTION 'leads: the engagement must be for the service of the lead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER leads_rules
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_rules();

-- ---------- Lead uploads: same file rules as documents, only while the lead is a draft ----------
CREATE FUNCTION lead_uploads_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'lead uploads: a new upload starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = NEW.lead_id AND l.status = 'DRAFT') THEN
      RAISE EXCEPTION 'lead uploads: files can be added only while the lead is a draft'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'lead uploads: the file, its S3 key and its lead cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'lead uploads: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER lead_uploads_rules
  BEFORE INSERT OR UPDATE ON lead_uploads
  FOR EACH ROW EXECUTE FUNCTION lead_uploads_rules();

-- ---------- Documents carried over from a lead upload ----------
-- Same as r0_documents_review, plus: a document made from a lead upload must be that upload
-- (same S3 key, file and scan result) for the engagement its lead was converted into; it is the
-- only kind of document that may start already scanned. lead_upload_id never changes.
CREATE OR REPLACE FUNCTION documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lead_upload_id IS NOT NULL THEN
      IF NEW.direction <> 'CLIENT_TO_FIRM' OR NOT EXISTS (
        SELECT 1 FROM lead_uploads u JOIN leads l ON l.id = u.lead_id
        WHERE u.id = NEW.lead_upload_id
          AND u.s3_key = NEW.s3_key AND u.sha256 = NEW.sha256 AND u.size_bytes = NEW.size_bytes
          AND u.content_type = NEW.content_type
          AND u.scan_status = NEW.scan_status AND u.scanned_at IS NOT DISTINCT FROM NEW.scanned_at
          AND l.status = 'CONVERTED' AND l.engagement_id = NEW.engagement_id
      ) THEN
        RAISE EXCEPTION 'documents: a carried-over upload must match its lead upload and the converted engagement'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'documents: a new document starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'CLIENT_TO_FIRM' AND NOT EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = NEW.engagement_id AND e.status IN ('PENDING', 'ACTIVE')
    ) THEN
      RAISE EXCEPTION 'documents: a client can upload only to an open engagement'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id <> OLD.engagement_id OR NEW.direction <> OLD.direction
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.lead_upload_id IS DISTINCT FROM OLD.lead_upload_id
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'documents: the file, its S3 key, its engagement and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'documents: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.retention_until IS NULL AND NEW.retention_until IS NOT NULL)
     OR NEW.retention_until < OLD.retention_until THEN
    RAISE EXCEPTION 'documents: retention_until can only move later'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
