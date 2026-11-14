-- R55, Leads Review Two additions (Octavia, Nov 8), approved by the lead under Rasel's delegation
-- (Nov 14): R2 15 duplicates and safe merge (a) leads.merged_into_lead_id, merged_at,
-- merged_by_user_id; (b) lead_duplicate_dismissals. R2 17 ownership and routing rules (c)
-- lead_assignment_rules; (d) lead_routing_settings; (e) leads.assigned_by_rule_id. R2 19 reusable
-- follow-up sequences (f) lead_sequence_templates; (g) lead_sequence_steps; (h) lead_sequence_runs;
-- (i) lead_follow_ups.sequence_run_id, assigned_user_id, mode. Nothing is merged, routed or sent
-- automatically by the database: these keep what the API decided and refuse what breaks the rules.
-- Rules and templates are archived, never deleted (a lead names its rule, a run its template), so
-- their foreign keys restrict.
-- Safe on dev: new empty tables; every ADD COLUMN is nullable; the new checks pass on existing rows
-- (all null); no backfill.

-- CreateEnum
CREATE TYPE "LeadStepMode" AS ENUM ('REMINDER', 'OUTREACH');

-- CreateEnum
CREATE TYPE "LeadStepOwner" AS ENUM ('LEAD_OWNER', 'APPLIER');

-- AlterTable
ALTER TABLE "lead_follow_ups" ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "mode" "LeadStepMode",
ADD COLUMN     "sequence_run_id" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "assigned_by_rule_id" UUID,
ADD COLUMN     "merged_at" TIMESTAMPTZ(3),
ADD COLUMN     "merged_by_user_id" UUID,
ADD COLUMN     "merged_into_lead_id" UUID;

-- CreateTable
CREATE TABLE "lead_duplicate_dismissals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "other_lead_id" UUID NOT NULL,
    "dismissed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignment_rules" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sources" "LeadSource"[] DEFAULT ARRAY[]::"LeadSource"[],
    "service_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "priorities" "LeadPriority"[] DEFAULT ARRAY[]::"LeadPriority"[],
    "assignee_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_assignment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_routing_settings" (
    "business_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fallback_user_id" UUID,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_routing_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "lead_sequence_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_sequence_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sequence_steps" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "offset_days" INTEGER NOT NULL,
    "at_time" TIME(0),
    "action_type" "LeadActionType" NOT NULL,
    "mode" "LeadStepMode" NOT NULL DEFAULT 'REMINDER',
    "owner" "LeadStepOwner" NOT NULL DEFAULT 'LEAD_OWNER',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sequence_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "applied_by_user_id" UUID,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(3),
    "stop_reason" TEXT,

    CONSTRAINT "lead_sequence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_duplicate_dismissals_business_id_lead_id_idx" ON "lead_duplicate_dismissals"("business_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_duplicate_dismissals_business_id_other_lead_id_idx" ON "lead_duplicate_dismissals"("business_id", "other_lead_id");

-- CreateIndex
CREATE INDEX "lead_assignment_rules_business_id_position_idx" ON "lead_assignment_rules"("business_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lead_assignment_rules_business_id_id_key" ON "lead_assignment_rules"("business_id", "id");

-- CreateIndex
CREATE INDEX "lead_sequence_templates_business_id_archived_at_idx" ON "lead_sequence_templates"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sequence_templates_business_id_id_key" ON "lead_sequence_templates"("business_id", "id");

-- CreateIndex
CREATE INDEX "lead_sequence_steps_business_id_template_id_idx" ON "lead_sequence_steps"("business_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sequence_steps_template_id_position_key" ON "lead_sequence_steps"("template_id", "position");

-- CreateIndex
CREATE INDEX "lead_sequence_runs_business_id_lead_id_idx" ON "lead_sequence_runs"("business_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_sequence_runs_business_id_template_id_idx" ON "lead_sequence_runs"("business_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sequence_runs_business_id_id_key" ON "lead_sequence_runs"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sequence_runs_business_id_lead_id_id_key" ON "lead_sequence_runs"("business_id", "lead_id", "id");

-- CreateIndex
CREATE INDEX "leads_business_id_merged_into_lead_id_idx" ON "leads"("business_id", "merged_into_lead_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_merged_into_lead_id_fkey" FOREIGN KEY ("business_id", "merged_into_lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_merged_by_user_id_fkey" FOREIGN KEY ("business_id", "merged_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_assigned_by_rule_id_fkey" FOREIGN KEY ("business_id", "assigned_by_rule_id") REFERENCES "lead_assignment_rules"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_business_id_lead_id_sequence_run_id_fkey" FOREIGN KEY ("business_id", "lead_id", "sequence_run_id") REFERENCES "lead_sequence_runs"("business_id", "lead_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_duplicate_dismissals" ADD CONSTRAINT "lead_duplicate_dismissals_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_duplicate_dismissals" ADD CONSTRAINT "lead_duplicate_dismissals_business_id_other_lead_id_fkey" FOREIGN KEY ("business_id", "other_lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_duplicate_dismissals" ADD CONSTRAINT "lead_duplicate_dismissals_business_id_dismissed_by_user_id_fkey" FOREIGN KEY ("business_id", "dismissed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_business_id_assignee_user_id_fkey" FOREIGN KEY ("business_id", "assignee_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignment_rules" ADD CONSTRAINT "lead_assignment_rules_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_routing_settings" ADD CONSTRAINT "lead_routing_settings_business_id_fallback_user_id_fkey" FOREIGN KEY ("business_id", "fallback_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_routing_settings" ADD CONSTRAINT "lead_routing_settings_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sequence_templates" ADD CONSTRAINT "lead_sequence_templates_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sequence_steps" ADD CONSTRAINT "lead_sequence_steps_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "lead_sequence_templates"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sequence_runs" ADD CONSTRAINT "lead_sequence_runs_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sequence_runs" ADD CONSTRAINT "lead_sequence_runs_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "lead_sequence_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sequence_runs" ADD CONSTRAINT "lead_sequence_runs_business_id_applied_by_user_id_fkey" FOREIGN KEY ("business_id", "applied_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Access ----------
-- Dismissals are kept (no DELETE); rules, settings, templates and runs change but are never deleted;
-- a template's steps are replaced as a whole when it is edited.
GRANT SELECT, INSERT ON lead_duplicate_dismissals TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON lead_assignment_rules TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON lead_routing_settings TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON lead_sequence_templates TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_sequence_steps TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON lead_sequence_runs TO firmivra_app;

ALTER TABLE lead_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_duplicate_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_duplicate_dismissals_business ON lead_duplicate_dismissals
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_assignment_rules_business ON lead_assignment_rules
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_routing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_routing_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_routing_settings_business ON lead_routing_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_sequence_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sequence_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_sequence_templates_business ON lead_sequence_templates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sequence_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_sequence_steps_business ON lead_sequence_steps
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_sequence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sequence_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_sequence_runs_business ON lead_sequence_runs
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- a) A merge: all three columns or none; never into itself; the merged lead is archived (it stays,
-- traceable, and its records show on the kept lead).
ALTER TABLE leads ADD CONSTRAINT leads_merge_shape
  CHECK ((merged_into_lead_id IS NULL) = (merged_at IS NULL)
     AND (merged_at IS NULL) = (merged_by_user_id IS NULL)
     AND (merged_into_lead_id IS NULL OR (merged_into_lead_id <> id AND archived_at IS NOT NULL)));
-- A new lead is not merged; a merge is final (never changed or undone); only an open lead (not a
-- draft, expired or converted one) is merged, into an open lead of the firm that is neither
-- merged, archived nor converted.
CREATE FUNCTION leads_merge_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target leads%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.merged_into_lead_id IS NOT NULL OR NEW.merged_at IS NOT NULL THEN
      RAISE EXCEPTION 'leads: a new lead is not merged'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.merged_into_lead_id IS NOT NULL THEN
    IF NEW.merged_into_lead_id IS DISTINCT FROM OLD.merged_into_lead_id
       OR NEW.merged_at IS DISTINCT FROM OLD.merged_at
       OR NEW.merged_by_user_id IS DISTINCT FROM OLD.merged_by_user_id THEN
      RAISE EXCEPTION 'leads: a merge is final'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.merged_into_lead_id IS NOT NULL THEN
    IF OLD.status IN ('DRAFT', 'EXPIRED', 'CONVERTED') THEN
      RAISE EXCEPTION 'leads: only an open lead is merged'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO target FROM leads l WHERE l.id = NEW.merged_into_lead_id FOR SHARE;
    IF target.id IS NULL OR target.business_id <> NEW.business_id
       OR target.merged_into_lead_id IS NOT NULL OR target.archived_at IS NOT NULL
       OR target.status IN ('DRAFT', 'EXPIRED', 'CONVERTED') THEN
      RAISE EXCEPTION 'leads: a lead is merged into an open lead that is not merged itself'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER leads_merge_rules
  BEFORE INSERT OR UPDATE OF merged_into_lead_id, merged_at, merged_by_user_id ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_merge_rules();

-- b) "Not a duplicate": two different leads, each pair once in either order.
ALTER TABLE lead_duplicate_dismissals ADD CONSTRAINT lead_duplicate_dismissals_two_leads
  CHECK (lead_id <> other_lead_id);
CREATE UNIQUE INDEX lead_duplicate_dismissals_pair ON lead_duplicate_dismissals
  (business_id, least(lead_id, other_lead_id), greatest(lead_id, other_lead_id));

-- c) A rule: a name, a place in the order, its lists (empty matches any value, never null).
ALTER TABLE lead_assignment_rules ADD CONSTRAINT lead_assignment_rules_shape
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND app_no_hidden_characters(name)
     AND position >= 0
     AND sources IS NOT NULL AND service_ids IS NOT NULL AND priorities IS NOT NULL
     AND cardinality(sources) <= 20 AND cardinality(service_ids) <= 50
     AND cardinality(priorities) <= 10 AND array_position(service_ids, NULL) IS NULL);

-- e) A rule names the owner it gave; a lead without an owner names no rule.
ALTER TABLE leads ADD CONSTRAINT leads_assigned_by_rule
  CHECK (assigned_by_rule_id IS NULL OR assigned_user_id IS NOT NULL);

-- f) A template: a name unique among the firm's live ones, a short description.
ALTER TABLE lead_sequence_templates ADD CONSTRAINT lead_sequence_templates_shape
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND app_no_hidden_characters(name)
     AND (description IS NULL OR char_length(description) <= 500));
CREATE UNIQUE INDEX lead_sequence_templates_live_name ON lead_sequence_templates
  (business_id, lower(btrim(name))) WHERE archived_at IS NULL;

-- g) At most 20 steps (positions 0 to 19, each once), up to a year after the sequence is applied.
ALTER TABLE lead_sequence_steps ADD CONSTRAINT lead_sequence_steps_shape
  CHECK (position BETWEEN 0 AND 19 AND offset_days BETWEEN 0 AND 365
     AND (note IS NULL OR char_length(note) <= 500));

-- h) One open run of a template per lead; a reason only for a stopped run.
CREATE UNIQUE INDEX lead_sequence_runs_open ON lead_sequence_runs (business_id, lead_id, template_id)
  WHERE stopped_at IS NULL;
ALTER TABLE lead_sequence_runs ADD CONSTRAINT lead_sequence_runs_stop
  CHECK (stop_reason IS NULL OR (stopped_at IS NOT NULL AND char_length(stop_reason) <= 200));
-- A run starts from a live template on an open lead; its lead, template and start never change,
-- and a stopped run stays stopped.
CREATE FUNCTION lead_sequence_runs_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stopped_at IS NOT NULL THEN
      RAISE EXCEPTION 'lead sequence runs: a run starts open'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM lead_sequence_templates t
                   WHERE t.id = NEW.template_id AND t.archived_at IS NULL) THEN
      RAISE EXCEPTION 'lead sequence runs: an archived template is not applied'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM leads l
                   WHERE l.id = NEW.lead_id AND l.archived_at IS NULL
                     AND l.status NOT IN ('DRAFT', 'EXPIRED', 'CONVERTED')) THEN
      RAISE EXCEPTION 'lead sequence runs: a sequence is applied to an open lead only'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id
     OR NEW.template_id <> OLD.template_id OR NEW.applied_at <> OLD.applied_at
     OR NEW.applied_by_user_id IS DISTINCT FROM OLD.applied_by_user_id THEN
    RAISE EXCEPTION 'lead sequence runs: a run''s lead, template and start never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stopped_at IS NOT NULL
     AND (NEW.stopped_at IS DISTINCT FROM OLD.stopped_at
          OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason) THEN
    RAISE EXCEPTION 'lead sequence runs: a stopped run stays stopped'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_sequence_runs_rules
  BEFORE INSERT OR UPDATE ON lead_sequence_runs
  FOR EACH ROW EXECUTE FUNCTION lead_sequence_runs_rules();

-- i) A step a sequence made says whether it is a reminder or outreach.
ALTER TABLE lead_follow_ups ADD CONSTRAINT lead_follow_ups_sequence_mode
  CHECK (sequence_run_id IS NULL OR mode IS NOT NULL);
