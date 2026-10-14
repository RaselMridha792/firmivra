-- R37 (Rasel, Oct 14), Documents: request types (templates) with their items, kept per firm or
-- per member ("My saved lists"), and document versions (a replacement of a document: the next
-- version of the same client, engagement and direction; the old one is superseded once the
-- replacement is CLEAN). A request already points at its type (template_id, added with
-- requests); this adds the type and the foreign key.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "replaces_id" UUID,
ADD COLUMN     "superseded_at" TIMESTAMPTZ(3),
ADD COLUMN     "version_no" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "document_request_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_request_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_template_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "category_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_request_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_request_templates_business_id_id_key" ON "document_request_templates"("business_id", "id");

-- CreateIndex
CREATE INDEX "document_request_template_items_business_id_template_id_sor_idx" ON "document_request_template_items"("business_id", "template_id", "sort_order");

-- CreateIndex
CREATE INDEX "document_request_packets_business_id_template_id_idx" ON "document_request_packets"("business_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_business_id_replaces_id_key" ON "documents"("business_id", "replaces_id");

-- AddForeignKey
ALTER TABLE "document_request_packets" ADD CONSTRAINT "document_request_packets_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "document_request_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_templates" ADD CONSTRAINT "document_request_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_templates" ADD CONSTRAINT "document_request_templates_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_template_items" ADD CONSTRAINT "document_request_template_items_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "document_request_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_template_items" ADD CONSTRAINT "document_request_template_items_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "document_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Types are archived, never deleted; a type's items are replaced when it is edited.
GRANT SELECT, INSERT, UPDATE ON document_request_templates TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_request_template_items TO firmivra_app;
ALTER TABLE document_request_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE document_request_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_template_items FORCE ROW LEVEL SECURITY;
CREATE POLICY document_request_templates_business ON document_request_templates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY document_request_template_items_business ON document_request_template_items
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE document_request_templates ADD CONSTRAINT document_request_templates_text
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 100 AND app_no_hidden_characters(name)
     AND (description IS NULL OR (char_length(btrim(description)) >= 1
          AND char_length(description) <= 300 AND app_no_hidden_characters(description))));
-- A name is unique among a member's live lists, and among the firm's own live types.
CREATE UNIQUE INDEX document_request_templates_live_name ON document_request_templates
  (business_id, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE archived_at IS NULL;
ALTER TABLE document_request_template_items ADD CONSTRAINT document_request_template_items_text
  CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200 AND app_no_hidden_characters(title)
     AND (description IS NULL OR (char_length(btrim(description)) >= 1
          AND char_length(description) <= 1000)));

ALTER TABLE documents ADD CONSTRAINT documents_version
  CHECK (version_no >= 1 AND (replaces_id IS NULL) = (version_no = 1));

-- ---------- Rules ----------
-- A type stays with its firm and owner; archived once, for good.
CREATE FUNCTION document_request_templates_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'request types: the firm and owner of a type cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'request types: an archived type stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_request_templates_rules
  BEFORE UPDATE ON document_request_templates
  FOR EACH ROW EXECUTE FUNCTION document_request_templates_rules();

-- Versions: a replacement is of the same client, engagement and direction and numbered after the
-- old one (set on insert only); superseded_at is set once, and only while a CLEAN replacement
-- exists. Beside documents_r37_rules (folders) and documents_rules (the file).
CREATE FUNCTION documents_r37_versions() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  old_doc documents%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.replaces_id IS NOT NULL THEN
      SELECT * INTO old_doc FROM documents d
        WHERE d.business_id = NEW.business_id AND d.id = NEW.replaces_id;
      IF NOT FOUND OR old_doc.client_id <> NEW.client_id
         OR old_doc.engagement_id <> NEW.engagement_id OR old_doc.direction <> NEW.direction THEN
        RAISE EXCEPTION 'documents: a replacement is of the same client, engagement and direction'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.version_no := old_doc.version_no + 1;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.replaces_id IS DISTINCT FROM OLD.replaces_id OR NEW.version_no <> OLD.version_no THEN
    RAISE EXCEPTION 'documents: what a document replaces is set when it is made'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.superseded_at IS DISTINCT FROM OLD.superseded_at AND (OLD.superseded_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM documents r WHERE r.business_id = NEW.business_id
                      AND r.replaces_id = NEW.id AND r.scan_status = 'CLEAN')) THEN
    RAISE EXCEPTION 'documents: superseded_at is set once, when a clean replacement exists'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER documents_r37_versions
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_r37_versions();

-- When a replacement is CLEAN (on insert, or when its scan result arrives) the old one is
-- superseded, in the same transaction.
CREATE FUNCTION documents_r37_supersede() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.replaces_id IS NOT NULL AND NEW.scan_status = 'CLEAN' THEN
    UPDATE documents SET superseded_at = now()
      WHERE business_id = NEW.business_id AND id = NEW.replaces_id AND superseded_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER documents_r37_supersede
  AFTER INSERT OR UPDATE OF scan_status ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_r37_supersede();
