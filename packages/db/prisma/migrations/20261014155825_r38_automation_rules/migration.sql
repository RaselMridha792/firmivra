-- R38 (Rasel, Oct 14), Automations, part 1 (docs/mockups/firm-workspace/automations/source):
-- the Rules table, the five-step Create Rule builder and the templates. A rule is an identity
-- and a switch; what it does is saved as immutable versions (trigger, conditions, ordered
-- actions, settings), so a run can always show the exact configuration it used. Versions are
-- insert-only. A rule is ACTIVE only with a version; a draft never runs.

-- CreateEnum
CREATE TYPE "AutomationModule" AS ENUM ('CLIENTS', 'LEADS', 'APPOINTMENTS', 'INTAKE_FORMS', 'DOCUMENTS', 'TAX_RETURNS', 'BOOKKEEPING', 'PAYROLL', 'TAX_PLANNING', 'BUSINESS_ADVISORY', 'INVOICES_PAYMENTS', 'COMMUNICATIONS', 'TASKS', 'COMPLIANCE_DEADLINES', 'STAFF_MANAGEMENT', 'INTEGRATIONS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationTiming" AS ENUM ('IMMEDIATE', 'BEFORE', 'AFTER', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "OffsetUnit" AS ENUM ('MINUTE', 'HOUR', 'DAY');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('ALL', 'ANY');

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "AutomationModule" NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_user_id" UUID,
    "current_version_id" UUID,
    "expires_on" DATE,
    "last_run_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rule_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "trigger_module" "AutomationModule" NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "timing" "AutomationTiming" NOT NULL DEFAULT 'IMMEDIATE',
    "offset_value" INTEGER,
    "offset_unit" "OffsetUnit",
    "match_mode" "MatchMode" NOT NULL DEFAULT 'ALL',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "AutomationModule" NOT NULL,
    "definition" JSONB NOT NULL,
    "required_integrations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_rules_business_id_status_idx" ON "automation_rules"("business_id", "status");

-- CreateIndex
CREATE INDEX "automation_rules_business_id_category_idx" ON "automation_rules"("business_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_business_id_id_key" ON "automation_rules"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_business_id_current_version_id_key" ON "automation_rules"("business_id", "current_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rule_versions_business_id_id_key" ON "automation_rule_versions"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rule_versions_business_id_rule_id_version_key" ON "automation_rule_versions"("business_id", "rule_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "automation_templates_business_id_name_key" ON "automation_templates"("business_id", "name");

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_business_id_current_version_id_fkey" FOREIGN KEY ("business_id", "current_version_id") REFERENCES "automation_rule_versions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rule_versions" ADD CONSTRAINT "automation_rule_versions_business_id_rule_id_fkey" FOREIGN KEY ("business_id", "rule_id") REFERENCES "automation_rules"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Versions are insert-only; rules and templates are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON automation_rules, automation_templates TO firmivra_app;
GRANT SELECT, INSERT ON automation_rule_versions TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_rules', 'automation_rule_versions',
    'automation_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape of a rule's pieces ----------
-- How many of an array's elements have the given string keys (lax mode: a missing key is no match).
CREATE FUNCTION automation_items_ok(items jsonb, min_items integer, max_items integer, keys text[])
  RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT jsonb_typeof(items) = 'array'
       AND jsonb_array_length(items) BETWEEN min_items AND max_items
       AND jsonb_array_length(jsonb_path_query_array(items,
             ('$[*] ? (' || (SELECT string_agg('@.' || k || '.type() == "string"', ' && ')
                               FROM unnest(keys) AS k) || ')')::jsonpath))
           = jsonb_array_length(items)
  $$;

ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND char_length(description) <= 1000
         AND (status <> 'ACTIVE' OR current_version_id IS NOT NULL)
         AND (status = 'ARCHIVED') = (archived_at IS NOT NULL));
-- Two live rules never share a name.
CREATE UNIQUE INDEX automation_rules_live_name ON automation_rules (business_id, lower(name))
  WHERE archived_at IS NULL;

ALTER TABLE automation_rule_versions ADD CONSTRAINT automation_rule_versions_shape
  CHECK (version >= 1
         AND trigger_event ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND char_length(trigger_event) <= 80
         -- Timing: an immediate or scheduled rule has no offset; before and after have both parts.
         AND ((timing IN ('IMMEDIATE', 'SCHEDULED')) = (offset_value IS NULL))
         AND ((offset_value IS NULL) = (offset_unit IS NULL))
         AND (offset_value IS NULL OR offset_value BETWEEN 0 AND 100000)
         AND automation_items_ok(conditions, 0, 20, ARRAY['field', 'operator'])
         AND automation_items_ok(actions, 1, 20, ARRAY['id', 'type'])
         AND jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 4000
         AND pg_column_size(actions) <= 60000 AND pg_column_size(conditions) <= 20000);

ALTER TABLE automation_templates ADD CONSTRAINT automation_templates_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND char_length(description) <= 1000
         AND jsonb_typeof(definition) = 'object' AND pg_column_size(definition) <= 80000
         AND cardinality(required_integrations) <= 20
         AND array_position(required_integrations, NULL) IS NULL);

-- ---------- The current version is one of the rule's own ----------
CREATE FUNCTION automation_rules_current_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM automation_rule_versions v
                  WHERE v.business_id = NEW.business_id AND v.id = NEW.current_version_id
                    AND v.rule_id = NEW.id) THEN
    RAISE EXCEPTION 'automation rules: the current version must be one of the rule''s own versions'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER automation_rules_current_version
  BEFORE INSERT OR UPDATE OF current_version_id ON automation_rules
  FOR EACH ROW WHEN (NEW.current_version_id IS NOT NULL)
  EXECUTE FUNCTION automation_rules_current_version();
