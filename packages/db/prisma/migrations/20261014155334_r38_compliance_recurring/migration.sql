-- R38 (Rasel, Oct 14), Compliance & Deadlines, part 3: recurring deadline definitions and
-- templates, applicability rules and their decisions (docs/mockups/firm-workspace/compliance/
-- source, Frame 3, and the guide's sections 4, 6 and 11 to 13). A rule says which clients get a
-- library entry's or a recurrence's deadline, or are only suggested it; each decision is recorded
-- with the rule version and the reason, and nothing is generated for a client whose data is
-- missing (NEEDS_REVIEW). A rule's version is raised by the database on every change.

-- CreateEnum
CREATE TYPE "DeadlineFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM', 'AUTHORITY_DEFINED');

-- CreateEnum
CREATE TYPE "ApplicabilityOutcome" AS ENUM ('APPLY', 'SUGGEST');

-- CreateEnum
CREATE TYPE "ApplicabilityDecision" AS ENUM ('SUGGESTED', 'NEEDS_REVIEW', 'CONFIRMED', 'DISMISSED');

-- AlterTable
ALTER TABLE "compliance_deadlines" ADD COLUMN     "recurrence_id" UUID;

-- CreateTable
CREATE TABLE "compliance_recurrences" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeadlineType" NOT NULL,
    "description" TEXT,
    "agency" TEXT,
    "related_form" TEXT,
    "jurisdiction" "JurisdictionLevel",
    "state" TEXT,
    "calendar_entry_id" UUID,
    "frequency" "DeadlineFrequency" NOT NULL,
    "interval" INTEGER,
    "repeat_rule" JSONB NOT NULL DEFAULT '{}',
    "start_on" DATE,
    "end_mode" "RecurrenceEnd" NOT NULL DEFAULT 'NEVER',
    "end_after_count" INTEGER,
    "end_on" DATE,
    "holiday_rule" "HolidayRule" NOT NULL DEFAULT 'NEXT_BUSINESS_DAY',
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "create_task" BOOLEAN NOT NULL DEFAULT false,
    "task_template_id" UUID,
    "assigned_user_id" UUID,
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "remind_client" BOOLEAN NOT NULL DEFAULT false,
    "add_to_tax_calendar" BOOLEAN NOT NULL DEFAULT true,
    "notify_team" BOOLEAN NOT NULL DEFAULT false,
    "reminders" JSONB NOT NULL DEFAULT '[]',
    "send_past_due_notice" BOOLEAN NOT NULL DEFAULT false,
    "escalate_to_manager" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaskSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_recurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_applicability_rules" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "calendar_entry_id" UUID,
    "recurrence_id" UUID,
    "outcome" "ApplicabilityOutcome" NOT NULL DEFAULT 'SUGGEST',
    "entity_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "services" "ServiceKind"[] DEFAULT ARRAY[]::"ServiceKind"[],
    "exclude_statuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prior_year_liability_over_cents" INTEGER,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_applicability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_applicability_records" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "decision" "ApplicabilityDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "deadline_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_applicability_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_recurrences_business_id_status_idx" ON "compliance_recurrences"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_recurrences_business_id_id_key" ON "compliance_recurrences"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_recurrences_business_id_name_is_template_key" ON "compliance_recurrences"("business_id", "name", "is_template");

-- CreateIndex
CREATE INDEX "compliance_applicability_rules_business_id_calendar_entry_i_idx" ON "compliance_applicability_rules"("business_id", "calendar_entry_id");

-- CreateIndex
CREATE INDEX "compliance_applicability_rules_business_id_recurrence_id_idx" ON "compliance_applicability_rules"("business_id", "recurrence_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_applicability_rules_business_id_id_key" ON "compliance_applicability_rules"("business_id", "id");

-- CreateIndex
CREATE INDEX "compliance_applicability_records_business_id_decision_idx" ON "compliance_applicability_records"("business_id", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_applicability_records_business_id_client_id_rule_key" ON "compliance_applicability_records"("business_id", "client_id", "rule_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_applicability_records_business_id_deadline_id_key" ON "compliance_applicability_records"("business_id", "deadline_id");

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_recurrence_id_fkey" FOREIGN KEY ("business_id", "recurrence_id") REFERENCES "compliance_recurrences"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_recurrences" ADD CONSTRAINT "compliance_recurrences_business_id_calendar_entry_id_fkey" FOREIGN KEY ("business_id", "calendar_entry_id") REFERENCES "compliance_calendar_entries"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_recurrences" ADD CONSTRAINT "compliance_recurrences_business_id_task_template_id_fkey" FOREIGN KEY ("business_id", "task_template_id") REFERENCES "task_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_recurrences" ADD CONSTRAINT "compliance_recurrences_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_applicability_rules" ADD CONSTRAINT "compliance_applicability_rules_business_id_calendar_entry__fkey" FOREIGN KEY ("business_id", "calendar_entry_id") REFERENCES "compliance_calendar_entries"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_applicability_rules" ADD CONSTRAINT "compliance_applicability_rules_business_id_recurrence_id_fkey" FOREIGN KEY ("business_id", "recurrence_id") REFERENCES "compliance_recurrences"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_applicability_records" ADD CONSTRAINT "compliance_applicability_records_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_applicability_records" ADD CONSTRAINT "compliance_applicability_records_business_id_rule_id_fkey" FOREIGN KEY ("business_id", "rule_id") REFERENCES "compliance_applicability_rules"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_applicability_records" ADD CONSTRAINT "compliance_applicability_records_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Nothing here is deleted: a recurrence is ended or archived, a rule switched off, a decision kept.
GRANT SELECT, INSERT, UPDATE ON compliance_recurrences, compliance_applicability_rules,
  compliance_applicability_records TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_recurrences', 'compliance_applicability_rules',
    'compliance_applicability_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE compliance_recurrences ADD CONSTRAINT compliance_recurrences_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200 AND char_length(description) <= 2000
         AND (state IS NULL OR state ~ '^[A-Z]{2}$')
         AND (frequency = 'CUSTOM') = (interval IS NOT NULL)
         AND (interval IS NULL OR interval BETWEEN 1 AND 365)
         AND jsonb_typeof(repeat_rule) = 'object'
         AND jsonb_typeof(reminders) = 'array' AND jsonb_array_length(reminders) <= 10
         AND (is_template OR start_on IS NOT NULL)
         AND (create_task OR task_template_id IS NULL)
         AND (NOT remind_client OR client_visible)
         AND (status <> 'PAUSED' OR paused_at IS NOT NULL)
         AND (status NOT IN ('ENDED', 'ARCHIVED') OR ended_at IS NOT NULL));
ALTER TABLE compliance_recurrences ADD CONSTRAINT compliance_recurrences_end
  CHECK ((end_mode = 'NEVER' AND end_after_count IS NULL AND end_on IS NULL)
      OR (end_mode = 'AFTER_COUNT' AND COALESCE(end_after_count BETWEEN 1 AND 1000, false) AND end_on IS NULL)
      OR (end_mode = 'ON_DATE' AND COALESCE(end_on >= start_on, is_template AND end_on IS NOT NULL)
          AND end_after_count IS NULL));

ALTER TABLE compliance_applicability_rules ADD CONSTRAINT compliance_applicability_rules_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200
         -- Exactly one target: a library entry or a recurrence.
         AND (calendar_entry_id IS NULL) <> (recurrence_id IS NULL)
         AND cardinality(entity_types) <= 30 AND cardinality(states) <= 60
         AND cardinality(services) <= 10 AND cardinality(exclude_statuses) <= 20
         AND NOT (array_position(entity_types, NULL) IS NOT NULL
                  OR array_position(states, NULL) IS NOT NULL
                  OR array_position(exclude_statuses, NULL) IS NOT NULL)
         AND (states <@ ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL',
              'IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
              'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
              'WV','WI','WY'])
         AND (prior_year_liability_over_cents IS NULL OR prior_year_liability_over_cents >= 0)
         AND jsonb_typeof(criteria) = 'object' AND version >= 1);

ALTER TABLE compliance_applicability_records ADD CONSTRAINT compliance_applicability_records_shape
  CHECK (btrim(reason) <> '' AND char_length(reason) <= 500 AND rule_version >= 1
         -- Confirming makes the deadline; dismissing and confirming are someone's decision.
         AND (decision = 'CONFIRMED') = (deadline_id IS NOT NULL)
         AND ((decision IN ('CONFIRMED', 'DISMISSED')) = (decided_at IS NOT NULL)));

-- ---------- Rules ----------
-- The database raises a rule's version whenever it changes, whatever the caller sent.
CREATE FUNCTION compliance_applicability_rules_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.name, NEW.calendar_entry_id, NEW.recurrence_id, NEW.outcome, NEW.entity_types,
      NEW.states, NEW.services, NEW.exclude_statuses, NEW.prior_year_liability_over_cents,
      NEW.criteria, NEW.active)
     IS DISTINCT FROM (OLD.name, OLD.calendar_entry_id, OLD.recurrence_id, OLD.outcome,
      OLD.entity_types, OLD.states, OLD.services, OLD.exclude_statuses,
      OLD.prior_year_liability_over_cents, OLD.criteria, OLD.active) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compliance_applicability_rules_version BEFORE UPDATE ON compliance_applicability_rules
  FOR EACH ROW EXECUTE FUNCTION compliance_applicability_rules_version();

-- ---------- A decision is of one client's deadline; a template makes none ----------
CREATE FUNCTION compliance_applicability_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'compliance_deadlines' THEN
    IF EXISTS (SELECT 1 FROM compliance_recurrences r
                WHERE r.business_id = NEW.business_id AND r.id = NEW.recurrence_id AND r.is_template) THEN
      RAISE EXCEPTION 'compliance deadlines: a template makes no deadlines'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' AND (NEW.client_id <> OLD.client_id OR NEW.rule_id <> OLD.rule_id
                             OR NEW.due_on <> OLD.due_on) THEN
      RAISE EXCEPTION 'compliance applicability: a decision keeps its client, rule and date'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.deadline_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM compliance_deadlines d
          WHERE d.business_id = NEW.business_id AND d.id = NEW.deadline_id
            AND d.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'compliance applicability: the deadline must be the client''s'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compliance_deadlines_no_template BEFORE INSERT OR UPDATE OF recurrence_id ON compliance_deadlines
  FOR EACH ROW WHEN (NEW.recurrence_id IS NOT NULL) EXECUTE FUNCTION compliance_applicability_rules();
CREATE TRIGGER compliance_applicability_records_rules
  BEFORE INSERT OR UPDATE ON compliance_applicability_records
  FOR EACH ROW EXECUTE FUNCTION compliance_applicability_rules();
