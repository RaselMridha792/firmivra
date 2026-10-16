-- R37 (Rasel, Oct 14), Documents: the library, details, review and sharing-ready columns on
-- documents (folder, description, tags, review status and reviewer, validity date, the upload's
-- notify choice, archive, trash) and the folder tree (document_folders). Document
-- types stay in document_categories. documents_rules (the file never changes, scan result set
-- once) is not touched: the new rules are in their own triggers. Sharing a document with a
-- client after upload is a grant (next migration), not a change of direction.

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('NEEDS_REVIEW', 'IN_REVIEW', 'VERIFIED', 'REPLACEMENT_REQUESTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DocumentFolderScope" AS ENUM ('CLIENT', 'FIRM');

-- CreateEnum
CREATE TYPE "FolderColor" AS ENUM ('BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'PINK', 'PURPLE', 'GRAY');

-- CreateEnum
CREATE TYPE "FolderClientAccess" AS ENUM ('NONE', 'VIEW', 'VIEW_UPLOAD');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "expires_on" DATE,
ADD COLUMN     "folder_id" UUID,
ADD COLUMN     "notify_client" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_status" "DocumentReviewStatus",
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_user_id" UUID,
ADD COLUMN     "reviewer_user_id" UUID,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "trashed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "document_folders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" UUID,
    "scope" "DocumentFolderScope" NOT NULL DEFAULT 'CLIENT',
    "color" "FolderColor" NOT NULL DEFAULT 'BLUE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "require_expiry_date" BOOLEAN NOT NULL DEFAULT false,
    "remind_before_expiry" BOOLEAN NOT NULL DEFAULT false,
    "allow_client_uploads" BOOLEAN NOT NULL DEFAULT false,
    "notify_staff_on_upload" BOOLEAN NOT NULL DEFAULT false,
    "default_client_access" "FolderClientAccess" NOT NULL DEFAULT 'NONE',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_folders_business_id_parent_id_sort_order_idx" ON "document_folders"("business_id", "parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "document_folders_business_id_id_key" ON "document_folders"("business_id", "id");

-- CreateIndex
CREATE INDEX "documents_business_id_created_at_idx" ON "documents"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "documents_business_id_folder_id_idx" ON "documents"("business_id", "folder_id");

-- CreateIndex
CREATE INDEX "documents_business_id_review_status_idx" ON "documents"("business_id", "review_status");

-- CreateIndex
CREATE INDEX "documents_business_id_reviewer_user_id_idx" ON "documents"("business_id", "reviewer_user_id");

-- CreateIndex
CREATE INDEX "documents_business_id_category_id_idx" ON "documents"("business_id", "category_id");

-- CreateIndex
CREATE INDEX "documents_business_id_client_id_sha256_idx" ON "documents"("business_id", "client_id", "sha256");

-- CreateIndex
CREATE INDEX "documents_business_id_expires_on_idx" ON "documents"("business_id", "expires_on");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_folder_id_fkey" FOREIGN KEY ("business_id", "folder_id") REFERENCES "document_folders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_reviewer_user_id_fkey" FOREIGN KEY ("business_id", "reviewer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_reviewed_by_user_id_fkey" FOREIGN KEY ("business_id", "reviewed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_business_id_parent_id_fkey" FOREIGN KEY ("business_id", "parent_id") REFERENCES "document_folders"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- A folder is deleted only while empty (the foreign keys from documents and subfolders refuse
-- otherwise); documents keep their grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON document_folders TO firmivra_app;
ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY document_folders_business ON document_folders
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- Tags: at most 20, each 1 to 40 characters on one line, none twice ignoring case.
CREATE FUNCTION documents_tags_ok(tags text[]) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT tags IS NOT NULL
     AND coalesce(cardinality(tags), 0) <= 20
     AND NOT EXISTS (SELECT 1 FROM unnest(tags) t
                      WHERE t IS NULL OR char_length(btrim(t)) < 1 OR char_length(t) > 40
                         OR NOT app_no_hidden_characters(t))
     AND (SELECT count(DISTINCT lower(btrim(t))) FROM unnest(tags) t) = coalesce(cardinality(tags), 0)
$$;

ALTER TABLE documents ADD CONSTRAINT documents_description
  CHECK (description IS NULL
     OR (char_length(btrim(description)) >= 1 AND char_length(description) <= 500
         AND app_no_hidden_characters(description)));
ALTER TABLE documents ADD CONSTRAINT documents_tags CHECK (documents_tags_ok(tags));
-- Verified or completed means someone did it, at some time; the other states have neither.
ALTER TABLE documents ADD CONSTRAINT documents_review
  CHECK (coalesce(review_status IN ('VERIFIED', 'COMPLETED'), false) = (reviewed_at IS NOT NULL)
     AND (reviewed_at IS NULL) = (reviewed_by_user_id IS NULL));
ALTER TABLE documents ADD CONSTRAINT documents_notify_client
  CHECK (NOT notify_client OR direction = 'FIRM_TO_CLIENT');
ALTER TABLE documents ADD CONSTRAINT documents_archive_or_trash
  CHECK (archived_at IS NULL OR trashed_at IS NULL);

ALTER TABLE document_folders ADD CONSTRAINT document_folders_name
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 80 AND app_no_hidden_characters(name));
ALTER TABLE document_folders ADD CONSTRAINT document_folders_description
  CHECK (description IS NULL
     OR (char_length(btrim(description)) >= 1 AND char_length(description) <= 500
         AND app_no_hidden_characters(description)));
-- The firm's own folders take no client uploads and give clients no default access.
ALTER TABLE document_folders ADD CONSTRAINT document_folders_firm_scope
  CHECK (scope = 'CLIENT' OR (NOT allow_client_uploads AND default_client_access = 'NONE'));
-- Names are unique among live folders of one parent (the top level counts as one parent).
CREATE UNIQUE INDEX document_folders_live_name ON document_folders
  (business_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE archived_at IS NULL;

-- ---------- Rules ----------
-- Folders: the tree has no cycle and at most 5 levels, a child has its parent's scope and a live
-- parent, and the scope and firm never change; archived once, for good.
CREATE FUNCTION document_folders_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_scope "DocumentFolderScope";
  parent_archived timestamptz;
  depth int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.scope <> OLD.scope
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'document folders: the scope of a folder cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'document folders: an archived folder stays archived'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.parent_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    SELECT f.scope, f.archived_at INTO parent_scope, parent_archived FROM document_folders f
      WHERE f.business_id = NEW.business_id AND f.id = NEW.parent_id;
    IF parent_scope IS DISTINCT FROM NEW.scope OR parent_archived IS NOT NULL THEN
      RAISE EXCEPTION 'document folders: a subfolder has the scope of a live parent'
        USING ERRCODE = 'check_violation';
    END IF;
    WITH RECURSIVE up AS (
      SELECT f.id, f.parent_id, 1 AS n FROM document_folders f
        WHERE f.business_id = NEW.business_id AND f.id = NEW.parent_id
      UNION ALL
      SELECT f.id, f.parent_id, up.n + 1 FROM document_folders f
        JOIN up ON f.id = up.parent_id AND f.business_id = NEW.business_id
       WHERE up.n < 10)
    SELECT max(n) INTO depth FROM up;
    IF depth >= 5 OR EXISTS (
         WITH RECURSIVE up AS (
           SELECT f.id, f.parent_id, 1 AS n FROM document_folders f
             WHERE f.business_id = NEW.business_id AND f.id = NEW.parent_id
           UNION ALL
           SELECT f.id, f.parent_id, up.n + 1 FROM document_folders f
             JOIN up ON f.id = up.parent_id AND f.business_id = NEW.business_id
            WHERE up.n < 10)
         SELECT 1 FROM up WHERE up.id = NEW.id) THEN
      RAISE EXCEPTION 'document folders: at most 5 levels, and a folder is not inside itself'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_folders_rules
  BEFORE INSERT OR UPDATE ON document_folders
  FOR EACH ROW EXECUTE FUNCTION document_folders_rules();

-- Documents: a document goes into a live folder, and a firm folder takes only INTERNAL documents.
CREATE FUNCTION documents_r37_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  folder_scope "DocumentFolderScope";
  folder_archived timestamptz;
BEGIN
  IF NEW.folder_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.folder_id IS DISTINCT FROM OLD.folder_id) THEN
    SELECT f.scope, f.archived_at INTO folder_scope, folder_archived FROM document_folders f
      WHERE f.business_id = NEW.business_id AND f.id = NEW.folder_id;
    IF folder_archived IS NOT NULL THEN
      RAISE EXCEPTION 'documents: an archived folder takes no documents'
        USING ERRCODE = 'check_violation';
    END IF;
    IF folder_scope = 'FIRM' AND NEW.direction <> 'INTERNAL' THEN
      RAISE EXCEPTION 'documents: a firm folder takes internal documents only'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER documents_r37_rules
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_r37_rules();
