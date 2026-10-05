-- CreateEnum
CREATE TYPE "DocumentDirection" AS ENUM ('CLIENT_TO_FIRM', 'FIRM_TO_CLIENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'NOT_AVAILABLE', 'CANCELLED');

-- AlterTable
ALTER TABLE "engagement_reports" ADD COLUMN     "document_id" UUID;

-- CreateTable
CREATE TABLE "document_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "retention_years" INTEGER DEFAULT 7,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "category_id" UUID,
    "request_id" UUID,
    "direction" "DocumentDirection" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "tax_year" INTEGER,
    "retention_until" DATE,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "due_on" DATE,
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "status_note" TEXT,
    "requested_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_business_id_name_key" ON "document_categories"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_categories_business_id_id_key" ON "document_categories"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_s3_key_key" ON "documents"("s3_key");

-- CreateIndex
CREATE INDEX "documents_business_id_client_id_created_at_idx" ON "documents"("business_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_business_id_request_id_idx" ON "documents"("business_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_business_id_engagement_id_id_key" ON "documents"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE INDEX "document_requests_business_id_client_id_status_idx" ON "document_requests"("business_id", "client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_business_id_engagement_id_id_key" ON "document_requests"("business_id", "engagement_id", "id");

-- AddForeignKey
ALTER TABLE "engagement_reports" ADD CONSTRAINT "engagement_reports_business_id_engagement_id_document_id_fkey" FOREIGN KEY ("business_id", "engagement_id", "document_id") REFERENCES "documents"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "document_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_engagement_id_request_id_fkey" FOREIGN KEY ("business_id", "engagement_id", "request_id") REFERENCES "document_requests"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "document_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 5: row-level security and data rules ====================
-- Document categories, documents (the vault) and document requests.

-- ---------- Grants ----------
-- A category that documents use cannot be deleted (foreign key); archive it instead.
GRANT SELECT, INSERT, UPDATE, DELETE ON document_categories TO firmivra_app;
-- Documents: deletion is limited by the policy below (retention, legal hold, open engagement).
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO firmivra_app;
-- Requests are cancelled, never deleted: they are the record of what was asked.
GRANT SELECT, INSERT, UPDATE ON document_requests TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents           FORCE ROW LEVEL SECURITY;
ALTER TABLE document_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_requests   FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY document_categories_business ON document_categories
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY document_requests_business ON document_requests
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- Documents: all of the current business's rows, but a delete only when there is no legal hold
-- and either retention has ended, or it is a client upload and its engagement is still open
-- (permission matrix: owner and admin after retention; a client their own upload while open).
-- The API still checks the role and that the client deletes only their own upload.
CREATE POLICY documents_select ON documents FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY documents_update ON documents FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (business_id = app_current_business_id()
         AND NOT legal_hold
         AND (retention_until < current_date
              OR (direction = 'CLIENT_TO_FIRM'
                  AND EXISTS (SELECT 1 FROM engagements e
                              WHERE e.id = documents.engagement_id
                                AND e.status IN ('PENDING', 'ACTIVE')))));

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE document_categories ADD CONSTRAINT document_categories_name_not_blank
  CHECK (btrim(name) <> '');
ALTER TABLE document_categories ADD CONSTRAINT document_categories_retention_years
  CHECK (retention_years > 0);

-- The fourth wall in the database too: a document's S3 key lies under its own firm's prefix.
ALTER TABLE documents ADD CONSTRAINT documents_s3_key_firm_prefix
  CHECK (starts_with(s3_key, business_id::text || '/'));
-- Upload limit 10 MB (docs/SYSTEM-DESIGN.md, Security & privacy).
ALTER TABLE documents ADD CONSTRAINT documents_size_10_mb
  CHECK (size_bytes BETWEEN 1 AND 10485760);
ALTER TABLE documents ADD CONSTRAINT documents_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE documents ADD CONSTRAINT documents_file_name_not_blank CHECK (btrim(file_name) <> '');
ALTER TABLE documents ADD CONSTRAINT documents_tax_year CHECK (tax_year BETWEEN 2000 AND 2100);
-- A scan result always comes with its time.
ALTER TABLE documents ADD CONSTRAINT documents_scanned_at
  CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE document_requests ADD CONSTRAINT document_requests_title_not_blank
  CHECK (btrim(title) <> '');
-- "I don't have this" and "marked missing" always carry a reason.
ALTER TABLE document_requests ADD CONSTRAINT document_requests_status_note
  CHECK (status NOT IN ('NOT_AVAILABLE', 'REJECTED') OR coalesce(btrim(status_note), '') <> '');

-- Every new document starts in quarantine; a client uploads only while the engagement is open;
-- the scan result is set once; who uploaded what, where and which file never changes.
CREATE FUNCTION documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
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
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'documents: the file, its engagement and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'documents: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER documents_rules
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_rules();
