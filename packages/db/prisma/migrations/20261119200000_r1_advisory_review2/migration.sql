-- r1_advisory_review2 (R1, Business Advisory Review Two; Rasel's approval of Nov 19 in R1's
-- window, one db-only PR merged on its own). Additive only: one new enum, four new empty tables
-- and one unique index on advisory_action_items (business_id, id), whose id is already unique.
-- No existing row is read or rewritten.
--   A-X02 (B16) advisory_industries: the firm's own industry choices (archived, never deleted).
--         No rows here: until a firm's first change, the API offers the built-in list.
--   A-X10 (B28) advisory_resources: the firm's own resources and its edited copies of built-in
--         ones (catalog_key), each with at most one https link or one uploaded file;
--         advisory_resource_files: those files under tenant/<firm>/advisory-resources/, fixed,
--         scan result set once.
--   A-X11 (B30) advisory_action_item_notes: progress notes on an action item, each with the
--         item's status, its author and the database's time. Insert-only.

-- CreateEnum
CREATE TYPE "AdvisoryResourceKind" AS ENUM ('PDF', 'CHECKLIST', 'GUIDE', 'TEMPLATE', 'VIDEO', 'LINK');

-- CreateTable
CREATE TABLE "advisory_industries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_resources" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "catalog_key" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" "AdvisoryResourceKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "url" TEXT,
    "file_id" UUID,
    "client_facing" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_resource_files" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisory_resource_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_action_item_notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "action_item_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "AdvisoryActionStatus" NOT NULL,
    "author_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisory_action_item_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisory_industries_business_id_sort_order_idx" ON "advisory_industries"("business_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_industries_business_id_id_key" ON "advisory_industries"("business_id", "id");

-- CreateIndex
CREATE INDEX "advisory_resources_business_id_archived_at_idx" ON "advisory_resources"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_resources_business_id_id_key" ON "advisory_resources"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_resources_business_id_catalog_key_key" ON "advisory_resources"("business_id", "catalog_key");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_resources_business_id_file_id_key" ON "advisory_resources"("business_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_resource_files_s3_key_key" ON "advisory_resource_files"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_resource_files_business_id_id_key" ON "advisory_resource_files"("business_id", "id");

-- CreateIndex
CREATE INDEX "advisory_action_item_notes_business_id_action_item_id_creat_idx" ON "advisory_action_item_notes"("business_id", "action_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_action_item_notes_business_id_id_key" ON "advisory_action_item_notes"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_action_items_business_id_id_key" ON "advisory_action_items"("business_id", "id");

-- AddForeignKey
ALTER TABLE "advisory_industries" ADD CONSTRAINT "advisory_industries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_industries" ADD CONSTRAINT "advisory_industries_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resources" ADD CONSTRAINT "advisory_resources_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resources" ADD CONSTRAINT "advisory_resources_business_id_file_id_fkey" FOREIGN KEY ("business_id", "file_id") REFERENCES "advisory_resource_files"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resources" ADD CONSTRAINT "advisory_resources_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resources" ADD CONSTRAINT "advisory_resources_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resource_files" ADD CONSTRAINT "advisory_resource_files_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_resource_files" ADD CONSTRAINT "advisory_resource_files_business_id_uploaded_by_user_id_fkey" FOREIGN KEY ("business_id", "uploaded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_item_notes" ADD CONSTRAINT "advisory_action_item_notes_business_id_action_item_id_fkey" FOREIGN KEY ("business_id", "action_item_id") REFERENCES "advisory_action_items"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_item_notes" ADD CONSTRAINT "advisory_action_item_notes_business_id_author_user_id_fkey" FOREIGN KEY ("business_id", "author_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------
-- Every row is its firm's (forced, so the table owner is checked too). Industries and resources
-- are archived, never deleted (no DELETE). A resource file changes only in its scan result; a
-- progress note is insert-only.
GRANT SELECT, INSERT, UPDATE ON advisory_industries, advisory_resources TO firmivra_app;
GRANT SELECT, INSERT ON advisory_resource_files, advisory_action_item_notes TO firmivra_app;
GRANT UPDATE (scan_status, scanned_at) ON advisory_resource_files TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_industries', 'advisory_resources', 'advisory_resource_files',
                           'advisory_action_item_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- A-X02: industries ----------
-- A name is one line of 1 to 80 characters; positions are small. Names are unique among the
-- firm's live industries, ignoring case (an archived name may be added again).
ALTER TABLE advisory_industries ADD CONSTRAINT advisory_industries_name
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND app_no_hidden_characters(name));
ALTER TABLE advisory_industries ADD CONSTRAINT advisory_industries_sort_order
  CHECK (sort_order BETWEEN 0 AND 999);
CREATE UNIQUE INDEX advisory_industries_live_name ON advisory_industries (business_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

-- ---------- A-X10: resources ----------
-- The words: a title and a category on one line each, the summary sent with it (lines allowed,
-- up to 1,000 characters, as action items' details), and a built-in key in the catalog's shape.
ALTER TABLE advisory_resources ADD CONSTRAINT advisory_resources_words
  CHECK ((catalog_key IS NULL OR catalog_key ~ '^[a-z][a-z0-9-]{1,79}$')
     AND char_length(btrim(title)) BETWEEN 1 AND 200 AND app_no_hidden_characters(title)
     AND char_length(btrim(category)) BETWEEN 1 AND 100 AND app_no_hidden_characters(category)
     AND esign_text_ok(summary, 1000));
-- A link is https with a host and no user name, has no spaces, quotes or angle brackets, and is
-- at most 2,000 characters.
ALTER TABLE advisory_resources ADD CONSTRAINT advisory_resources_url
  CHECK (url IS NULL OR (char_length(url) <= 2000
         AND url ~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
         AND url !~ '["''<>\\`]'
         AND app_no_hidden_characters(url)));
-- At most one link or one file; a link or a video is a link.
ALTER TABLE advisory_resources ADD CONSTRAINT advisory_resources_source
  CHECK (num_nonnulls(url, file_id) <= 1 AND (kind NOT IN ('LINK', 'VIDEO') OR url IS NOT NULL));

-- Which built-in resource a row edits, who made it and when stay as they were. A file the scan
-- refused is never linked (a file still being scanned may be; the API offers it only once
-- CLEAN). A file that is not found is left to the foreign key.
CREATE FUNCTION advisory_resources_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.catalog_key IS DISTINCT FROM OLD.catalog_key
                           OR NEW.created_by_user_id <> OLD.created_by_user_id
                           OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'advisory resources: the built-in key, the creator and the creation time are fixed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.file_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.file_id IS DISTINCT FROM OLD.file_id)
     AND EXISTS (SELECT 1 FROM advisory_resource_files f
                 WHERE f.business_id = NEW.business_id AND f.id = NEW.file_id
                   AND f.scan_status IN ('INFECTED', 'FAILED')) THEN
    RAISE EXCEPTION 'advisory resources: a file the scan refused cannot be linked'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_resources_rules
  BEFORE INSERT OR UPDATE ON advisory_resources
  FOR EACH ROW EXECUTE FUNCTION advisory_resources_rules();

-- A file: a name of 1 to 255 characters, 1 byte to 25 MB, a plain media type, a SHA-256, its key
-- under the firm's advisory-resources prefix (the scan router's prefix) in plain characters with
-- no "." or ".." part, and a scan time exactly once scanned.
ALTER TABLE advisory_resource_files
  ADD CONSTRAINT advisory_resource_files_values
    CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255 AND app_no_hidden_characters(file_name)
           AND size_bytes BETWEEN 1 AND 26214400
           AND content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' AND char_length(content_type) <= 100
           AND sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT advisory_resource_files_key
    CHECK (starts_with(s3_key, 'tenant/' || business_id::text || '/advisory-resources/')
           AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'),
  ADD CONSTRAINT advisory_resource_files_scan CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL));

-- A file starts unscanned, is kept, never changes but for its scan result, which is set once at
-- the database's time.
CREATE FUNCTION advisory_resource_files_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' OR NEW.scanned_at IS NOT NULL THEN
      RAISE EXCEPTION 'advisory resource files: a new file starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'advisory resource files: a file is kept, never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['scan_status', 'scanned_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['scan_status', 'scanned_at'])
     OR (OLD.scan_status <> 'PENDING'
         AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at)) THEN
    RAISE EXCEPTION 'advisory resource files: the file is fixed and its scan result is set once'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.scan_status = 'PENDING' AND NEW.scan_status <> 'PENDING' THEN
    NEW.scanned_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_resource_files_rules
  BEFORE INSERT OR UPDATE OR DELETE ON advisory_resource_files
  FOR EACH ROW EXECUTE FUNCTION advisory_resource_files_rules();

-- ---------- A-X11: progress notes ----------
-- A note has words: up to 2,000 characters, lines allowed, no hidden characters (as action
-- items' details).
ALTER TABLE advisory_action_item_notes ADD CONSTRAINT advisory_action_item_notes_body
  CHECK (esign_text_ok(body, 2000));

-- A note records the status its item has, at the database's time. The item is held FOR SHARE, so
-- a status change still being written is waited for and the note is checked against it. An item
-- that is not found is left to the foreign key.
CREATE FUNCTION advisory_action_item_notes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  item_status "AdvisoryActionStatus";
BEGIN
  SELECT i.status INTO item_status FROM advisory_action_items i
   WHERE i.business_id = NEW.business_id AND i.id = NEW.action_item_id
   FOR SHARE;
  IF FOUND AND NEW.status IS DISTINCT FROM item_status THEN
    RAISE EXCEPTION 'advisory action item notes: a note records the status its item has'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_action_item_notes_rules
  BEFORE INSERT ON advisory_action_item_notes
  FOR EACH ROW EXECUTE FUNCTION advisory_action_item_notes_rules();
