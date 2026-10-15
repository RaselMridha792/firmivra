-- R37 (Rasel, Oct 14), Intake Forms: templates. A service can have several reusable forms
-- (Form Templates screen); their versions are the intake_forms rows, now numbered per template.
-- Every existing service form gets its default template here, and the database gives a new form
-- the service's default template when it names none, so today's API keeps working unchanged.

-- DropIndex
DROP INDEX "intake_forms_business_id_service_id_version_key";

-- AlterTable
ALTER TABLE "intake_forms" ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "intake_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_default" BOOLEAN NOT NULL DEFAULT false,
    "internal_notes" TEXT,
    "default_assigned_user_id" UUID,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intake_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_templates_business_id_service_id_archived_at_idx" ON "intake_templates"("business_id", "service_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_templates_business_id_id_key" ON "intake_templates"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_templates_business_id_id_service_id_key" ON "intake_templates"("business_id", "id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_business_id_template_id_version_key" ON "intake_forms"("business_id", "template_id", "version");

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_business_id_template_id_service_id_fkey" FOREIGN KEY ("business_id", "template_id", "service_id") REFERENCES "intake_templates"("business_id", "id", "service_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_templates" ADD CONSTRAINT "intake_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_templates" ADD CONSTRAINT "intake_templates_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_templates" ADD CONSTRAINT "intake_templates_business_id_default_assigned_user_id_fkey" FOREIGN KEY ("business_id", "default_assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_templates" ADD CONSTRAINT "intake_templates_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Existing forms (local and dev): one default template per service with forms ----------
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    INSERT INTO intake_templates (id, business_id, service_id, service_default, updated_at)
      SELECT gen_random_uuid(), firm, f.service_id, true, now()
        FROM (SELECT DISTINCT service_id FROM intake_forms WHERE business_id = firm) f;
    UPDATE intake_forms f SET template_id = t.id
      FROM intake_templates t
     WHERE f.business_id = firm AND t.business_id = firm AND t.service_id = f.service_id;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- ---------- Grants and RLS ----------
-- Templates are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON intake_templates TO firmivra_app;
ALTER TABLE intake_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_templates_business ON intake_templates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- One live default per service.
CREATE UNIQUE INDEX intake_templates_live_default ON intake_templates (business_id, service_id)
  WHERE service_default AND archived_at IS NULL;
ALTER TABLE intake_templates ADD CONSTRAINT intake_templates_internal_notes
  CHECK (internal_notes IS NULL
     OR (char_length(btrim(internal_notes)) >= 1 AND char_length(internal_notes) <= 500));
-- A default is a live template.
ALTER TABLE intake_templates ADD CONSTRAINT intake_templates_default_live
  CHECK (NOT service_default OR archived_at IS NULL);

-- ---------- Rules ----------
-- A template stays with its firm, service and maker; it is archived once, for good.
CREATE FUNCTION intake_templates_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.service_id <> OLD.service_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'intake templates: the service and maker of a template cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'intake templates: an archived template stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_templates_rules
  BEFORE UPDATE ON intake_templates
  FOR EACH ROW EXECUTE FUNCTION intake_templates_rules();

-- A new form without a template gets the service's default template (made here when the service
-- has none), under a per-service lock so two first forms make one template. A form is added to
-- a live template only, and its template never changes after its first publish.
CREATE FUNCTION intake_forms_template() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  archived timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.template_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(
        hashtextextended('intake-template:' || NEW.business_id::text || NEW.service_id::text, 0));
      SELECT t.id INTO NEW.template_id FROM intake_templates t
        WHERE t.business_id = NEW.business_id AND t.service_id = NEW.service_id
          AND t.service_default AND t.archived_at IS NULL;
      IF NEW.template_id IS NULL THEN
        INSERT INTO intake_templates (id, business_id, service_id, service_default, updated_at)
          VALUES (gen_random_uuid(), NEW.business_id, NEW.service_id, true, now())
          RETURNING id INTO NEW.template_id;
      END IF;
    ELSE
      SELECT t.archived_at INTO archived FROM intake_templates t
        WHERE t.business_id = NEW.business_id AND t.id = NEW.template_id;
      IF archived IS NOT NULL THEN
        RAISE EXCEPTION 'intake forms: an archived template takes no new version'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.template_id IS DISTINCT FROM OLD.template_id AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'intake forms: the template of a published version cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_forms_template
  BEFORE INSERT OR UPDATE ON intake_forms
  FOR EACH ROW EXECUTE FUNCTION intake_forms_template();
