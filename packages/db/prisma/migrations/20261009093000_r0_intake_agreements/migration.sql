-- Intake agreements and signature evidence (R14 for R0; Rasel's decision 3, Oct 8; issue #132).
-- Each firm keeps versioned agreements (Markdown shown in the form, plus a PDF original). Before a
-- Begin Online or portal intake submits, the signer ticks the required acknowledgments and signs;
-- the evidence pins each agreement version and its SHA-256 values, the database's time, IP and
-- user agent. Setting intake_submissions.submitted_at now needs that evidence.

-- CreateEnum
CREATE TYPE "AgreementScope" AS ENUM ('ALL_INTAKES', 'SERVICE');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('TYPED', 'DRAWN', 'UPLOADED');

-- CreateTable
CREATE TABLE "firm_agreements" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "scope" "AgreementScope" NOT NULL,
    "service_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_agreement_files" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'application/pdf',
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_agreement_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_agreement_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "body_sha256" TEXT NOT NULL DEFAULT '',
    "acknowledgments" JSONB NOT NULL DEFAULT '[]',
    "pdf_file_id" UUID,
    "pdf_sha256" TEXT,
    "effective_date" DATE,
    "published_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_signatures" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "intake_id" UUID NOT NULL,
    "lead_id" UUID,
    "client_account_id" UUID,
    "printed_name" TEXT NOT NULL,
    "signature_text" TEXT NOT NULL,
    "signature_method" "SignatureMethod" NOT NULL DEFAULT 'TYPED',
    "signer_title" TEXT,
    "signer_email" TEXT,
    "acknowledgments" JSONB NOT NULL DEFAULT '[]',
    "terms_document_id" UUID,
    "privacy_document_id" UUID,
    "answers_sha256" TEXT NOT NULL,
    "evidence_sha256" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_signature_agreements" (
    "business_id" UUID NOT NULL,
    "signature_id" UUID NOT NULL,
    "agreement_version_id" UUID NOT NULL,
    "body_sha256" TEXT NOT NULL,
    "pdf_sha256" TEXT,

    CONSTRAINT "intake_signature_agreements_pkey" PRIMARY KEY ("signature_id","agreement_version_id")
);

-- CreateIndex
CREATE INDEX "firm_agreements_business_id_service_id_idx" ON "firm_agreements"("business_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreements_business_id_id_key" ON "firm_agreements"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreement_files_s3_key_key" ON "firm_agreement_files"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreement_files_business_id_id_key" ON "firm_agreement_files"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreement_files_business_id_id_sha256_key" ON "firm_agreement_files"("business_id", "id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreement_versions_business_id_agreement_id_version_key" ON "firm_agreement_versions"("business_id", "agreement_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "firm_agreement_versions_business_id_id_key" ON "firm_agreement_versions"("business_id", "id");

-- CreateIndex
CREATE INDEX "intake_signatures_business_id_intake_id_idx" ON "intake_signatures"("business_id", "intake_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_signatures_business_id_submission_id_key" ON "intake_signatures"("business_id", "submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_signatures_business_id_id_key" ON "intake_signatures"("business_id", "id");

-- CreateIndex
CREATE INDEX "intake_signature_agreements_business_id_agreement_version_i_idx" ON "intake_signature_agreements"("business_id", "agreement_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_submissions_business_id_id_key" ON "intake_submissions"("business_id", "id");

-- AddForeignKey
ALTER TABLE "firm_agreements" ADD CONSTRAINT "firm_agreements_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_agreements" ADD CONSTRAINT "firm_agreements_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_agreement_files" ADD CONSTRAINT "firm_agreement_files_business_id_uploaded_by_user_id_fkey" FOREIGN KEY ("business_id", "uploaded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_agreement_versions" ADD CONSTRAINT "firm_agreement_versions_business_id_agreement_id_fkey" FOREIGN KEY ("business_id", "agreement_id") REFERENCES "firm_agreements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_agreement_versions" ADD CONSTRAINT "firm_agreement_versions_business_id_pdf_file_id_pdf_sha256_fkey" FOREIGN KEY ("business_id", "pdf_file_id", "pdf_sha256") REFERENCES "firm_agreement_files"("business_id", "id", "sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_agreement_versions" ADD CONSTRAINT "firm_agreement_versions_business_id_published_by_user_id_fkey" FOREIGN KEY ("business_id", "published_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_submission_id_fkey" FOREIGN KEY ("business_id", "submission_id") REFERENCES "intake_submissions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_intake_id_fkey" FOREIGN KEY ("business_id", "intake_id") REFERENCES "intakes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_terms_document_id_fkey" FOREIGN KEY ("business_id", "terms_document_id") REFERENCES "firm_legal_documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signatures" ADD CONSTRAINT "intake_signatures_business_id_privacy_document_id_fkey" FOREIGN KEY ("business_id", "privacy_document_id") REFERENCES "firm_legal_documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signature_agreements" ADD CONSTRAINT "intake_signature_agreements_business_id_signature_id_fkey" FOREIGN KEY ("business_id", "signature_id") REFERENCES "intake_signatures"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_signature_agreements" ADD CONSTRAINT "intake_signature_agreements_business_id_agreement_version__fkey" FOREIGN KEY ("business_id", "agreement_version_id") REFERENCES "firm_agreement_versions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ==================== Row-level security and data rules ====================

-- ---------- Grants ----------
-- Agreements: archived (once) and re-ordered, never deleted.
GRANT SELECT, INSERT ON firm_agreements TO firmivra_app;
GRANT UPDATE (sort_order, archived_at, updated_at) ON firm_agreements TO firmivra_app;
-- PDF originals: only the scan result is ever written after insert; never deleted.
GRANT SELECT, INSERT ON firm_agreement_files TO firmivra_app;
GRANT UPDATE (scan_status, scanned_at) ON firm_agreement_files TO firmivra_app;
-- Versions and signature evidence are insert-only.
GRANT SELECT, INSERT ON firm_agreement_versions, intake_signatures, intake_signature_agreements
  TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE firm_agreements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_agreements             FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_agreement_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_agreement_files        FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_agreement_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_agreement_versions     FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_signatures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_signatures           FORCE ROW LEVEL SECURITY;
ALTER TABLE intake_signature_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_signature_agreements FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
-- Begin Online signs signed out, in the firm's business scope (the firm comes from the route).
CREATE POLICY firm_agreements_business ON firm_agreements
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY firm_agreement_files_business ON firm_agreement_files
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY firm_agreement_versions_business ON firm_agreement_versions
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY intake_signatures_business ON intake_signatures
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY intake_signature_agreements_business ON intake_signature_agreements
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE firm_agreements ADD CONSTRAINT firm_agreements_service_scope
  CHECK ((scope = 'SERVICE') = (service_id IS NOT NULL));
ALTER TABLE firm_agreements ADD CONSTRAINT firm_agreements_sort_order CHECK (sort_order >= 0);
-- One firm-wide agreement per firm (an archived one may be replaced). SQL only: Prisma cannot
-- express a partial index, and its diff leaves it alone.
CREATE UNIQUE INDEX firm_agreements_one_firm_wide
  ON firm_agreements (business_id) WHERE scope = 'ALL_INTAKES' AND archived_at IS NULL;

ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_s3_key_prefix
  CHECK (starts_with(s3_key, 'tenant/' || business_id::text || '/agreements/'));
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_pdf
  CHECK (content_type = 'application/pdf');
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_size_10_mb
  CHECK (size_bytes BETWEEN 1 AND 10485760);
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_sha256
  CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_name
  CHECK (btrim(file_name) <> '' AND char_length(file_name) <= 255);
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_scanned_at
  CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_version_positive
  CHECK (version > 0);
ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_title
  CHECK (btrim(title) <> '' AND char_length(title) <= 200);
ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_body
  CHECK (btrim(body_markdown) <> '' AND char_length(body_markdown) <= 100000);
ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_body_sha256
  CHECK (body_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_pdf
  CHECK ((pdf_file_id IS NULL) = (pdf_sha256 IS NULL));

ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_lead_or_client
  CHECK (num_nonnulls(lead_id, client_account_id) = 1);
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_names
  CHECK (btrim(printed_name) <> '' AND char_length(printed_name) <= 200
         AND btrim(signature_text) <> '' AND char_length(signature_text) <= 200);
-- No hidden characters in a signed name (packages/types esign/capture.ts): C0 and C1 controls,
-- the soft hyphen, zero-width and bidi marks, line and paragraph separators, word joiners and
-- invisible operators, bidi isolates and the byte order mark.
CREATE FUNCTION app_no_hidden_characters(value text) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT value IS NULL
      OR value !~ '[\x01-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]'
$$;

-- The comparison form of a signed name: NFC, runs of whitespace as one space, trimmed, lower case.
CREATE FUNCTION app_signature_name_key(value text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT lower(btrim(regexp_replace(normalize(value, NFC), '\s+', ' ', 'g')))
$$;

ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_visible_names
  CHECK (app_no_hidden_characters(printed_name) AND app_no_hidden_characters(signature_text)
         AND app_no_hidden_characters(signer_title));
-- A typed signature is the printed name, typed again.
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_typed_matches
  CHECK (signature_method <> 'TYPED'
         OR app_signature_name_key(signature_text) = app_signature_name_key(printed_name));
-- Intake signing is typed until Firm Sign's signature pad; that migration relaxes this.
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_typed
  CHECK (signature_method = 'TYPED');
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_title
  CHECK (signer_title IS NULL OR (btrim(signer_title) <> '' AND char_length(signer_title) <= 100));
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_email
  CHECK (signer_email IS NULL OR (signer_email = lower(signer_email)
         AND char_length(signer_email) <= 320 AND signer_email LIKE '_%@_%'));
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_legal
  CHECK ((terms_document_id IS NULL) = (privacy_document_id IS NULL));
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_hashes
  CHECK (answers_sha256 ~ '^[0-9a-f]{64}$' AND evidence_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_user_agent
  CHECK (user_agent IS NULL OR char_length(user_agent) <= 512);
ALTER TABLE intake_signatures ADD CONSTRAINT intake_signatures_acknowledgments_array
  CHECK (jsonb_typeof(acknowledgments) = 'array');

ALTER TABLE intake_signature_agreements ADD CONSTRAINT intake_signature_agreements_hashes
  CHECK (body_sha256 ~ '^[0-9a-f]{64}$' AND (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$'));

COMMENT ON COLUMN intake_forms.agreement_text IS
  'Deprecated (r0_intake_agreements): no longer written; the agreement comes from firm_agreements. Drop after delivery.';

-- ---------- Insert-only tables: no UPDATE or DELETE for any role ----------
CREATE FUNCTION app_insert_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '%: rows are insert-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$$;

CREATE TRIGGER firm_agreement_versions_insert_only
  BEFORE UPDATE OR DELETE ON firm_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION app_insert_only();
CREATE TRIGGER intake_signatures_insert_only
  BEFORE UPDATE OR DELETE ON intake_signatures
  FOR EACH ROW EXECUTE FUNCTION app_insert_only();
CREATE TRIGGER intake_signature_agreements_insert_only
  BEFORE UPDATE OR DELETE ON intake_signature_agreements
  FOR EACH ROW EXECUTE FUNCTION app_insert_only();

-- ---------- Agreements: only the order and the archive time change; archived once ----------
CREATE FUNCTION firm_agreements_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'firm agreements: a new agreement is not archived'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'firm agreements: an agreement is archived, never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.scope <> OLD.scope
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'firm agreements: only the order and the archive time can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'firm agreements: an archived agreement stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The database's time, whatever the caller sent.
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_agreements_rules
  BEFORE INSERT OR UPDATE OR DELETE ON firm_agreements
  FOR EACH ROW EXECUTE FUNCTION firm_agreements_rules();

-- ---------- PDF originals: start unscanned; file fixed; scan result set once ----------
CREATE FUNCTION firm_agreement_files_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'firm agreement files: a new file starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'firm agreement files: a file is kept, never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.file_name <> OLD.file_name
     OR NEW.content_type <> OLD.content_type OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.sha256 <> OLD.sha256 OR NEW.s3_key <> OLD.s3_key
     OR NEW.uploaded_by_user_id <> OLD.uploaded_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'firm agreement files: the file, its S3 key and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'firm agreement files: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The database's time, whatever the caller sent.
  IF OLD.scan_status = 'PENDING' AND NEW.scan_status <> 'PENDING' THEN
    NEW.scanned_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_agreement_files_rules
  BEFORE INSERT OR UPDATE OR DELETE ON firm_agreement_files
  FOR EACH ROW EXECUTE FUNCTION firm_agreement_files_rules();

-- ---------- Acknowledgments: [{key, label, text, required}], 0 to 8, unique keys ----------
CREATE FUNCTION app_valid_acknowledgments(acks jsonb) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT jsonb_typeof(acks) = 'array'
     AND jsonb_array_length(acks) <= 8
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(acks) a
       WHERE jsonb_typeof(a) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(a)) <> 4
          OR jsonb_typeof(a -> 'key') IS DISTINCT FROM 'string'
          OR NOT (a ->> 'key') ~ '^[a-z][a-z0-9_]{1,39}$'
          OR jsonb_typeof(a -> 'label') IS DISTINCT FROM 'string'
          OR btrim(a ->> 'label') = '' OR char_length(a ->> 'label') > 120
          OR jsonb_typeof(a -> 'text') IS DISTINCT FROM 'string'
          OR btrim(a ->> 'text') = '' OR char_length(a ->> 'text') > 2000
          OR jsonb_typeof(a -> 'required') IS DISTINCT FROM 'boolean')
     AND (SELECT count(DISTINCT a ->> 'key') FROM jsonb_array_elements(acks) a)
         = jsonb_array_length(acks)
$$;

ALTER TABLE firm_agreement_versions ADD CONSTRAINT firm_agreement_versions_acknowledgments
  CHECK (app_valid_acknowledgments(acknowledgments));

-- ---------- Versions: numbered in order, hashed by the database, CLEAN PDF only ----------
CREATE FUNCTION firm_agreement_versions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  series firm_agreements%ROWTYPE;
  last_version int;
BEGIN
  -- FOR SHARE: an archive that runs at the same time waits, then sees this version.
  SELECT * INTO series FROM firm_agreements a WHERE a.id = NEW.agreement_id FOR SHARE;
  IF series.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'firm agreement versions: the agreement is archived'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(max(v.version), 0) INTO last_version
    FROM firm_agreement_versions v WHERE v.agreement_id = NEW.agreement_id;
  IF NEW.version <> last_version + 1 THEN
    RAISE EXCEPTION 'firm agreement versions: the next version must be %', last_version + 1
      USING ERRCODE = 'check_violation';
  END IF;
  IF series.scope = 'ALL_INTAKES' AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(NEW.acknowledgments) a
       WHERE a -> 'required' = 'true'::jsonb) THEN
    RAISE EXCEPTION 'firm agreement versions: the firm-wide agreement needs a required acknowledgment'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.pdf_file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM firm_agreement_files f
       WHERE f.id = NEW.pdf_file_id AND f.scan_status = 'CLEAN') THEN
    RAISE EXCEPTION 'firm agreement versions: the PDF original must be scanned CLEAN'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The database owns the hash of the text the client reads.
  NEW.body_sha256 := encode(sha256(convert_to(NEW.body_markdown, 'UTF8')), 'hex');
  NEW.published_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_agreement_versions_rules
  BEFORE INSERT ON firm_agreement_versions
  FOR EACH ROW EXECUTE FUNCTION firm_agreement_versions_rules();

-- ---------- Intake signatures: on a draft of that intake, by its lead or client ----------
CREATE FUNCTION intake_signatures_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  sub intake_submissions%ROWTYPE;
BEGIN
  -- FOR UPDATE: the draft can't be submitted or changed by another transaction meanwhile.
  SELECT * INTO sub FROM intake_submissions s WHERE s.id = NEW.submission_id FOR UPDATE;
  IF sub.id IS NULL OR sub.intake_id <> NEW.intake_id OR sub.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'intake signatures: only a draft version of this intake can be signed'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The database owns the hash of what is signed; the answers are frozen from here on.
  NEW.answers_sha256 := encode(sha256(convert_to(sub.answers::text, 'UTF8')), 'hex');
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM intakes i WHERE i.id = NEW.intake_id AND i.lead_id = NEW.lead_id) THEN
    RAISE EXCEPTION 'intake signatures: the lead must be the intake''s lead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.client_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM intakes i
       JOIN engagements e ON e.id = i.engagement_id
       JOIN client_accounts ca ON ca.client_id = e.client_id
       WHERE i.id = NEW.intake_id AND ca.id = NEW.client_account_id
         AND ca.status = 'ACTIVE' AND ca.user_id = app_current_actor_id()) THEN
    RAISE EXCEPTION 'intake signatures: the signer must be the signed-in, active login of the engagement''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.terms_document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM firm_legal_documents d WHERE d.id = NEW.terms_document_id AND d.kind = 'TERMS'))
     OR (NEW.privacy_document_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM firm_legal_documents d WHERE d.id = NEW.privacy_document_id AND d.kind = 'PRIVACY')) THEN
    RAISE EXCEPTION 'intake signatures: terms_document_id and privacy_document_id must be the firm''s Terms and Privacy'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The database's time (the transaction's), so the submit can copy the same value.
  NEW.signed_at := now();
  NEW.created_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_signatures_rules
  BEFORE INSERT ON intake_signatures
  FOR EACH ROW EXECUTE FUNCTION intake_signatures_rules();

-- ---------- Signed versions: current, of the intake's service, hashes and ticks match ----------
CREATE FUNCTION intake_signature_agreements_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  sig intake_signatures%ROWTYPE;
  ver firm_agreement_versions%ROWTYPE;
  series firm_agreements%ROWTYPE;
BEGIN
  SELECT * INTO sig FROM intake_signatures s WHERE s.id = NEW.signature_id;
  SELECT * INTO ver FROM firm_agreement_versions v WHERE v.id = NEW.agreement_version_id;
  SELECT * INTO series FROM firm_agreements a WHERE a.id = ver.agreement_id;
  IF sig.id IS NULL OR ver.id IS NULL THEN
    RAISE EXCEPTION 'intake signature agreements: unknown signature or agreement version'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- FOR SHARE: a submit that runs at the same time waits, then sees this row.
  IF NOT EXISTS (SELECT 1 FROM intake_submissions s
                 WHERE s.id = sig.submission_id AND s.submitted_at IS NULL FOR SHARE) THEN
    RAISE EXCEPTION 'intake signature agreements: the submission is already submitted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF series.archived_at IS NOT NULL OR EXISTS (
       SELECT 1 FROM firm_agreement_versions v
       WHERE v.agreement_id = ver.agreement_id AND v.version > ver.version) THEN
    RAISE EXCEPTION 'intake signature agreements: only the current version of an unarchived agreement can be signed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF series.scope = 'SERVICE' AND NOT EXISTS (
       SELECT 1 FROM intakes i JOIN intake_forms f ON f.id = i.form_id
       WHERE i.id = sig.intake_id AND f.service_id = series.service_id) THEN
    RAISE EXCEPTION 'intake signature agreements: a service agreement must be for the intake''s service'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.body_sha256 <> ver.body_sha256 OR NEW.pdf_sha256 IS DISTINCT FROM ver.pdf_sha256 THEN
    RAISE EXCEPTION 'intake signature agreements: the hashes must be the version''s'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Every required acknowledgment of the version was shown with its exact words and ticked.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(ver.acknowledgments) r
       WHERE r -> 'required' = 'true'::jsonb
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(sig.acknowledgments) a
           WHERE a ->> 'agreementVersionId' = ver.id::text
             AND a ->> 'key' = r ->> 'key'
             AND a ->> 'label' = r ->> 'label'
             AND a ->> 'text' = r ->> 'text'
             AND a -> 'checked' = 'true'::jsonb)) THEN
    RAISE EXCEPTION 'intake signature agreements: every required acknowledgment must be ticked'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_signature_agreements_rules
  BEFORE INSERT ON intake_signature_agreements
  FOR EACH ROW EXECUTE FUNCTION intake_signature_agreements_rules();

-- ---------- Intake submissions: submitting needs the signature evidence ----------
-- Same as r0_intake, plus: a version is never inserted already submitted; once signed, its
-- answers are frozen; and setting submitted_at needs this version's intake_signatures row, made
-- in the same transaction, covering the firm-wide agreement and every current agreement of the
-- form's service, whose name, time, IP and browser equal the summary columns. submitted_at is the
-- database's time.
CREATE OR REPLACE FUNCTION intake_submissions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  last_version int;
  open_drafts int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'intake submissions: a new version starts as a draft; sign it, then submit'
        USING ERRCODE = 'check_violation';
    END IF;
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
  IF NEW.answers IS DISTINCT FROM OLD.answers
     AND EXISTS (SELECT 1 FROM intake_signatures g WHERE g.submission_id = OLD.id) THEN
    RAISE EXCEPTION 'intake submissions: signed answers cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.submitted_at IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.submitted_at := now();
  IF NOT EXISTS (
       SELECT 1 FROM intake_signatures g
       WHERE g.submission_id = NEW.id
         -- Signed in this transaction (signed_at is now(), stored to the millisecond).
         AND g.signed_at = now()::timestamptz(3)
         AND g.printed_name = NEW.signer_name
         AND g.signed_at = NEW.signed_at
         AND g.ip IS NOT DISTINCT FROM NEW.signer_ip
         AND g.user_agent IS NOT DISTINCT FROM NEW.signer_user_agent
         AND EXISTS (
           SELECT 1 FROM intake_signature_agreements ga
           JOIN firm_agreement_versions v ON v.id = ga.agreement_version_id
           JOIN firm_agreements a ON a.id = v.agreement_id
           WHERE ga.signature_id = g.id AND a.scope = 'ALL_INTAKES')
         -- Every published, unarchived agreement of the form's service is signed too.
         AND NOT EXISTS (
           SELECT 1 FROM intakes i
           JOIN intake_forms f ON f.id = i.form_id
           JOIN firm_agreements a ON a.service_id = f.service_id
           WHERE i.id = NEW.intake_id AND a.scope = 'SERVICE' AND a.archived_at IS NULL
             AND EXISTS (SELECT 1 FROM firm_agreement_versions v WHERE v.agreement_id = a.id)
             AND NOT EXISTS (
               SELECT 1 FROM intake_signature_agreements ga
               JOIN firm_agreement_versions v ON v.id = ga.agreement_version_id
               WHERE ga.signature_id = g.id AND v.agreement_id = a.id))) THEN
    RAISE EXCEPTION 'intake submissions: submitting needs the signature from this transaction (with the firm-wide and the service''s agreements) matching signer_name, signed_at, IP and browser'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
