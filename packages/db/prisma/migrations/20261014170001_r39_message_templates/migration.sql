-- CreateEnum
CREATE TYPE "MessageTemplateKind" AS ENUM ('EMAIL', 'SMS', 'PORTAL_MESSAGE', 'DOCUMENT_REQUEST', 'INTAKE_ORGANIZER', 'ENGAGEMENT_AGREEMENT', 'INVOICE_PAYMENT', 'APPOINTMENT', 'TASK', 'TAX_WORKFLOW', 'BOOKKEEPING', 'PAYROLL', 'LEAD_FOLLOW_UP', 'CAMPAIGN', 'LETTER_NOTICE', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageTemplateAccess" AS ENUM ('PRIVATE', 'TEAM', 'SELECTED');

-- CreateTable
CREATE TABLE "template_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "MessageTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "template_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "MessageTemplateKind" NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT,
    "preview_text" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "access" "MessageTemplateAccess" NOT NULL DEFAULT 'TEAM',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "include_in_automations" BOOLEAN NOT NULL DEFAULT false,
    "starter_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "saved_by_user_id" UUID NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_categories_business_id_kind_name_key" ON "template_categories"("business_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "template_categories_business_id_id_key" ON "template_categories"("business_id", "id");

-- CreateIndex
CREATE INDEX "message_templates_business_id_kind_status_idx" ON "message_templates"("business_id", "kind", "status");

-- CreateIndex
CREATE INDEX "message_templates_business_id_category_id_idx" ON "message_templates"("business_id", "category_id");

-- CreateIndex
CREATE INDEX "message_templates_business_id_owner_user_id_idx" ON "message_templates"("business_id", "owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_id_key" ON "message_templates"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_starter_key_key" ON "message_templates"("business_id", "starter_key");

-- CreateIndex
CREATE UNIQUE INDEX "message_template_versions_business_id_template_id_version_key" ON "message_template_versions"("business_id", "template_id", "version");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "template_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_template_versions" ADD CONSTRAINT "message_template_versions_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: versions are insert-only; categories and templates are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON template_categories, message_templates TO firmivra_app;
GRANT SELECT, INSERT ON message_template_versions TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['template_categories', 'message_templates', 'message_template_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape. esign_text_ok (r0_esign) is the shared "visible text, no control characters" check.
-- At most 20 tags, none empty, none longer than 40 characters, none twice (any case).
CREATE FUNCTION message_tags_ok(tags text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(tags) <= 20 AND array_position(tags, NULL) IS NULL
               AND (SELECT count(*) = count(DISTINCT lower(t)) AND coalesce(bool_and(esign_text_ok(t, 40)), true)
                      FROM unnest(tags) AS u(t)) $$;

ALTER TABLE template_categories ADD CONSTRAINT template_categories_values
  CHECK (esign_text_ok(name, 100) AND (description IS NULL OR esign_text_ok(description, 500)));

ALTER TABLE message_templates ADD CONSTRAINT message_templates_values
  CHECK (esign_text_ok(name, 200)
         AND (description IS NULL OR esign_text_ok(description, 500))
         AND (subject IS NULL OR esign_text_ok(subject, 300))
         AND (preview_text IS NULL OR esign_text_ok(preview_text, 200))
         AND esign_text_ok(body, 50000) AND message_tags_ok(tags) AND version >= 1
         AND (starter_key IS NULL OR starter_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$')
         AND (status = 'ARCHIVED') = (archived_at IS NOT NULL));

ALTER TABLE message_template_versions ADD CONSTRAINT message_template_versions_values
  CHECK (version >= 1 AND esign_text_ok(name, 200) AND esign_text_ok(body, 50000)
         AND (subject IS NULL OR esign_text_ok(subject, 300)));

-- A template's category is one of its own kind, and its version number only moves forward.
CREATE FUNCTION message_templates_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM template_categories c
        WHERE c.business_id = NEW.business_id AND c.id = NEW.category_id AND c.kind = NEW.kind) THEN
    RAISE EXCEPTION 'TEMPLATE_CATEGORY_KIND: the category belongs to another template kind'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version < OLD.version THEN
    RAISE EXCEPTION 'TEMPLATE_VERSION: the version number only moves forward'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER message_templates_guard BEFORE INSERT OR UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION message_templates_guard();
