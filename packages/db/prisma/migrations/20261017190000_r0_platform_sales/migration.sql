-- r0_platform_sales (R0, Oct 17, Super Admin schema stage B5): the Sales Pipeline (spec 17).
-- Firmivra selling to prospective firms. One dataset behind the board, the list, the KPIs and the
-- analytics: contacts (one master person record), opportunities in a pipeline's stages, and their
-- stage and assignment history (written by the database), activity, follow-ups, notes and tags.
-- The database keeps the lifecycle rules: a lost record needs a reason, Under Contract and Closed
-- follow the linked transaction (no double entry), a stage's required fields, and a stage holding
-- records can't be deleted or change type. The migration ships the default pipeline with the
-- approved lifecycle and the attention settings. Platform data: only the Super Admin team and the
-- platform's jobs reach it. Contract note: docs/work/R0-stage-b5-sales.md.

-- CreateEnum
CREATE TYPE "SalesStageType" AS ENUM ('ACTIVE', 'CONVERTED', 'TRANSACTION_SYNCED', 'CLOSED', 'LOST');

-- CreateEnum
CREATE TYPE "SalesLeadSource" AS ENUM ('WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'PAID_ADVERTISING', 'ORGANIC_SEARCH', 'EVENT', 'PARTNER', 'MANUAL_ENTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesLostReason" AS ENUM ('NOT_A_FIT', 'BUDGET', 'NO_RESPONSE', 'CHOSE_COMPETITOR', 'TIMING', 'DUPLICATE', 'INVALID_LEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesTransactionStatus" AS ENUM ('OPEN', 'UNDER_CONTRACT', 'CLOSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SalesChangeSource" AS ENUM ('MANUAL', 'AUTOMATION', 'TRANSACTION', 'IMPORT');

-- CreateEnum
CREATE TYPE "SalesFollowUpKind" AS ENUM ('FOLLOW_UP', 'CALL', 'DEMO', 'CONSULTATION', 'MEETING');

-- CreateEnum
CREATE TYPE "SalesFollowUpStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesActivityKind" AS ENUM ('CALL', 'EMAIL', 'SMS', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesActivityDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SalesActivityOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'LEFT_MESSAGE', 'REPLIED', 'NO_REPLY', 'BOUNCED', 'COMPLETED');

-- CreateTable
CREATE TABLE "sales_pipelines" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "terminated_return_stage_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_pipeline_stages" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system_key" TEXT,
    "stage_type" "SalesStageType" NOT NULL,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "required_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "on_enter_actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "on_exit_actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contacts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "email_normalized" TEXT,
    "phone_normalized" TEXT,
    "company_name" TEXT,
    "job_title" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_opportunities" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "company_name" TEXT,
    "source" "SalesLeadSource" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "plan_id" UUID,
    "value_cents" INTEGER,
    "assigned_to_user_id" UUID,
    "lost_reason" "SalesLostReason",
    "lost_note" TEXT,
    "lost_at" TIMESTAMPTZ(3),
    "converted_at" TIMESTAMPTZ(3),
    "stage_entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firm_application_id" UUID,
    "linked_business_id" UUID,
    "transaction_kind" TEXT,
    "transaction_id" UUID,
    "transaction_status" "SalesTransactionStatus",
    "transaction_synced_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_opportunity_tags" (
    "opportunity_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_opportunity_tags_pkey" PRIMARY KEY ("opportunity_id","tag_id")
);

-- CreateTable
CREATE TABLE "sales_stage_history" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID,
    "from_stage_name" TEXT,
    "to_stage_name" TEXT NOT NULL,
    "to_stage_type" "SalesStageType" NOT NULL,
    "actor_user_id" UUID,
    "source" "SalesChangeSource" NOT NULL,
    "lost_reason" "SalesLostReason",
    "lost_note" TEXT,
    "transaction_status" "SalesTransactionStatus",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_assignment_history" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "actor_user_id" UUID,
    "source" "SalesChangeSource" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_activities" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "kind" "SalesActivityKind" NOT NULL,
    "direction" "SalesActivityDirection" NOT NULL,
    "outcome" "SalesActivityOutcome",
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT,
    "actor_user_id" UUID,
    "follow_up_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_follow_ups" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "kind" "SalesFollowUpKind" NOT NULL,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "location" TEXT,
    "status" "SalesFollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assigned_to_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_notes" (
    "id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_attention_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "no_contact_hours" INTEGER NOT NULL DEFAULT 24,
    "follow_up_due_hours" INTEGER NOT NULL DEFAULT 24,
    "no_response_attempts" INTEGER NOT NULL DEFAULT 3,
    "no_activity_days" INTEGER NOT NULL DEFAULT 14,
    "owner_required" BOOLEAN NOT NULL DEFAULT true,
    "lost_other_note_required" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_attention_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipelines_name_key" ON "sales_pipelines"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipelines_system_key_key" ON "sales_pipelines"("system_key");

-- CreateIndex
CREATE INDEX "sales_pipeline_stages_pipeline_id_position_idx" ON "sales_pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipeline_stages_pipeline_id_id_key" ON "sales_pipeline_stages"("pipeline_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipeline_stages_pipeline_id_name_key" ON "sales_pipeline_stages"("pipeline_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_pipeline_stages_pipeline_id_system_key_key" ON "sales_pipeline_stages"("pipeline_id", "system_key");

-- CreateIndex
CREATE INDEX "sales_contacts_email_normalized_idx" ON "sales_contacts"("email_normalized");

-- CreateIndex
CREATE INDEX "sales_contacts_phone_normalized_idx" ON "sales_contacts"("phone_normalized");

-- CreateIndex
CREATE INDEX "sales_contacts_company_name_idx" ON "sales_contacts"("company_name");

-- CreateIndex
CREATE INDEX "sales_opportunities_pipeline_id_stage_id_idx" ON "sales_opportunities"("pipeline_id", "stage_id");

-- CreateIndex
CREATE INDEX "sales_opportunities_assigned_to_user_id_idx" ON "sales_opportunities"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "sales_opportunities_contact_id_idx" ON "sales_opportunities"("contact_id");

-- CreateIndex
CREATE INDEX "sales_opportunities_source_idx" ON "sales_opportunities"("source");

-- CreateIndex
CREATE INDEX "sales_opportunities_created_at_idx" ON "sales_opportunities"("created_at");

-- CreateIndex
CREATE INDEX "sales_opportunities_transaction_kind_transaction_id_idx" ON "sales_opportunities"("transaction_kind", "transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_tags_name_key" ON "sales_tags"("name");

-- CreateIndex
CREATE INDEX "sales_opportunity_tags_tag_id_idx" ON "sales_opportunity_tags"("tag_id");

-- CreateIndex
CREATE INDEX "sales_stage_history_opportunity_id_created_at_idx" ON "sales_stage_history"("opportunity_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_stage_history_to_stage_id_created_at_idx" ON "sales_stage_history"("to_stage_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_stage_history_created_at_idx" ON "sales_stage_history"("created_at");

-- CreateIndex
CREATE INDEX "sales_assignment_history_opportunity_id_created_at_idx" ON "sales_assignment_history"("opportunity_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_activities_opportunity_id_occurred_at_idx" ON "sales_activities"("opportunity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "sales_activities_occurred_at_idx" ON "sales_activities"("occurred_at");

-- CreateIndex
CREATE INDEX "sales_follow_ups_opportunity_id_due_at_idx" ON "sales_follow_ups"("opportunity_id", "due_at");

-- CreateIndex
CREATE INDEX "sales_follow_ups_status_due_at_idx" ON "sales_follow_ups"("status", "due_at");

-- CreateIndex
CREATE INDEX "sales_follow_ups_assigned_to_user_id_status_due_at_idx" ON "sales_follow_ups"("assigned_to_user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "sales_notes_opportunity_id_created_at_idx" ON "sales_notes"("opportunity_id", "created_at");

-- AddForeignKey
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_id_terminated_return_stage_id_fkey" FOREIGN KEY ("id", "terminated_return_stage_id") REFERENCES "sales_pipeline_stages"("pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_pipeline_stages" ADD CONSTRAINT "sales_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "sales_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "sales_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_pipeline_id_stage_id_fkey" FOREIGN KEY ("pipeline_id", "stage_id") REFERENCES "sales_pipeline_stages"("pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_firm_application_id_fkey" FOREIGN KEY ("firm_application_id") REFERENCES "firm_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_linked_business_id_fkey" FOREIGN KEY ("linked_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunity_tags" ADD CONSTRAINT "sales_opportunity_tags_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunity_tags" ADD CONSTRAINT "sales_opportunity_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "sales_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "sales_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "sales_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_assignment_history" ADD CONSTRAINT "sales_assignment_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "sales_follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_follow_ups" ADD CONSTRAINT "sales_follow_ups_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_follow_ups" ADD CONSTRAINT "sales_follow_ups_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_notes" ADD CONSTRAINT "sales_notes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Values ----------
-- A list of lowercase keys (stage automation actions), each up to 60 characters, at most 20.
CREATE FUNCTION sales_keys_ok(keys text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(keys) <= 20
               AND NOT EXISTS (SELECT 1 FROM unnest(keys) k
                               WHERE k IS NULL OR k !~ '^[a-z][a-z0-9_.]{0,59}$') $$;

ALTER TABLE sales_pipelines ADD CONSTRAINT sales_pipelines_values
  CHECK (platform_text_ok(name, 100) AND (description IS NULL OR platform_text_ok(description, 1000))
         AND (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{0,59}$'));

ALTER TABLE sales_pipeline_stages ADD CONSTRAINT sales_pipeline_stages_values
  CHECK (platform_text_ok(name, 60) AND position >= 0
         AND (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{0,59}$')
         AND required_fields <@ ARRAY['value', 'assignee', 'plan', 'transaction', 'lost_note']
         AND array_position(required_fields, NULL) IS NULL
         AND sales_keys_ok(on_enter_actions) AND sales_keys_ok(on_exit_actions));

ALTER TABLE sales_contacts ADD CONSTRAINT sales_contacts_values
  CHECK (platform_text_ok(name, 200)
         AND (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
         AND (phone IS NULL OR (char_length(phone) <= 40 AND phone ~ '[0-9]' AND phone ~ '^[0-9+(). x-]+$'))
         AND (company_name IS NULL OR platform_text_ok(company_name, 200))
         AND (job_title IS NULL OR platform_text_ok(job_title, 120)));

-- The linked transaction is all or nothing; lost details come only with the lost time.
ALTER TABLE sales_opportunities ADD CONSTRAINT sales_opportunities_values
  CHECK (platform_text_ok(title, 200) AND (company_name IS NULL OR platform_text_ok(company_name, 200))
         AND (value_cents IS NULL OR value_cents >= 0)
         AND (lost_note IS NULL OR platform_text_ok(lost_note, 2000))
         AND (lost_reason IS NULL) = (lost_at IS NULL)
         AND (lost_note IS NULL OR lost_reason IS NOT NULL)
         AND (transaction_kind IS NULL OR transaction_kind ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (transaction_kind IS NULL) = (transaction_id IS NULL)
         AND (transaction_id IS NULL) = (transaction_status IS NULL)
         AND (transaction_synced_at IS NULL OR transaction_status IS NOT NULL));

ALTER TABLE sales_tags ADD CONSTRAINT sales_tags_values
  CHECK (platform_text_ok(name, 50) AND (color_key IS NULL OR color_key ~ '^[a-z][a-z0-9-]{0,39}$'));

ALTER TABLE sales_activities ADD CONSTRAINT sales_activities_values
  CHECK (summary IS NULL OR platform_text_ok(summary, 2000));

ALTER TABLE sales_follow_ups ADD CONSTRAINT sales_follow_ups_values
  CHECK (platform_text_ok(title, 200) AND (location IS NULL OR platform_text_ok(location, 200))
         AND (ends_at IS NULL OR ends_at > due_at)
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL)
         AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL));

ALTER TABLE sales_notes ADD CONSTRAINT sales_notes_values
  CHECK (platform_text_ok(body, 10000));

ALTER TABLE sales_attention_settings ADD CONSTRAINT sales_attention_settings_values
  CHECK (id = 1 AND no_contact_hours BETWEEN 1 AND 720 AND follow_up_due_hours BETWEEN 1 AND 168
         AND no_response_attempts BETWEEN 1 AND 20 AND no_activity_days BETWEEN 1 AND 365);

-- ---------- The default pipeline and settings ----------
-- Firmivra's approved lifecycle (spec 17, section 4), with the side exit. A terminated
-- transaction returns a record to Active Client.
DO $$
DECLARE
  p uuid := gen_random_uuid();
  ret uuid;
BEGIN
  INSERT INTO sales_pipelines (id, name, description, system_key, updated_at)
  VALUES (p, 'Firmivra Sales Pipeline',
          'From first inquiry to an active firm on Firmivra, under contract and closed.',
          'firmivra_default', now());
  INSERT INTO sales_pipeline_stages (id, pipeline_id, name, system_key, stage_type, position, required_fields, updated_at)
  VALUES
    (gen_random_uuid(), p, 'New Lead', 'new_lead', 'ACTIVE', 0, '{}', now()),
    (gen_random_uuid(), p, 'Attempted Contact', 'attempted_contact', 'ACTIVE', 1, '{}', now()),
    (gen_random_uuid(), p, 'Contacted', 'contacted', 'ACTIVE', 2, '{}', now()),
    (gen_random_uuid(), p, 'Qualified', 'qualified', 'ACTIVE', 3, '{}', now()),
    (gen_random_uuid(), p, 'Appointment Set', 'appointment_set', 'ACTIVE', 4, '{}', now()),
    (gen_random_uuid(), p, 'Nurturing', 'nurturing', 'ACTIVE', 5, '{}', now()),
    (gen_random_uuid(), p, 'Active Client', 'active_client', 'CONVERTED', 6, '{}', now()),
    (gen_random_uuid(), p, 'Under Contract', 'under_contract', 'TRANSACTION_SYNCED', 7, '{transaction}', now()),
    (gen_random_uuid(), p, 'Closed / Past Client', 'closed_past_client', 'CLOSED', 8, '{}', now()),
    (gen_random_uuid(), p, 'Unqualified / Lost', 'unqualified_lost', 'LOST', 9, '{}', now());
  SELECT id INTO ret FROM sales_pipeline_stages WHERE pipeline_id = p AND system_key = 'active_client';
  UPDATE sales_pipelines SET terminated_return_stage_id = ret WHERE id = p;
  INSERT INTO sales_attention_settings (id, updated_at) VALUES (1, now());
END
$$;

-- ---------- Rules ----------
-- Who moved it: a transaction-local setting the API sets for an automation or an import
-- (set_config('app.sales_change_source', 'AUTOMATION', true)); a person otherwise.
CREATE FUNCTION sales_change_source() RETURNS "SalesChangeSource"
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.sales_change_source', true), ''), 'MANUAL')::"SalesChangeSource" $$;

-- A pipeline's shipped key is the migration's alone. A terminated transaction returns a record to
-- an active or converted stage of the same pipeline (the composite key keeps it in the pipeline).
CREATE FUNCTION sales_pipelines_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  return_type "SalesStageType";
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'sales pipelines: only the migration ships a pipeline with a system key'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSIF (NEW.id, NEW.system_key, NEW.created_at, NEW.created_by_user_id)
        IS DISTINCT FROM (OLD.id, OLD.system_key, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'sales pipelines: id, system key and creation never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.terminated_return_stage_id IS NOT NULL THEN
    SELECT stage_type INTO return_type FROM sales_pipeline_stages
    WHERE id = NEW.terminated_return_stage_id;
    IF return_type NOT IN ('ACTIVE', 'CONVERTED') THEN
      RAISE EXCEPTION 'sales pipelines: a terminated transaction returns to an active or converted stage'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_pipelines_rules BEFORE INSERT OR UPDATE ON sales_pipelines
  FOR EACH ROW EXECUTE FUNCTION sales_pipelines_rules();

-- Stages: the shipped stages keep their key and type and are never deleted (rename, reorder and
-- deactivate are fine). A stage holding records never changes type (move them first); deleting
-- one is refused by the foreign key.
CREATE FUNCTION sales_pipeline_stages_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'sales stages: a shipped stage is deactivated, never deleted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'sales stages: only the migration ships a stage with a system key'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
  ELSE
    IF (NEW.id, NEW.pipeline_id, NEW.system_key, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.pipeline_id, OLD.system_key, OLD.created_at) THEN
      RAISE EXCEPTION 'sales stages: a stage stays in its pipeline with its key'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.stage_type IS DISTINCT FROM OLD.stage_type THEN
      IF OLD.system_key IS NOT NULL THEN
        RAISE EXCEPTION 'sales stages: a shipped stage keeps its type' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM 1 FROM sales_opportunities WHERE stage_id = OLD.id LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'sales stages: move the records out before changing the stage type'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_pipeline_stages_rules BEFORE INSERT OR UPDATE OR DELETE ON sales_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION sales_pipeline_stages_rules();

-- Contacts: the database trims the email and phone and keeps their normalized forms (lowercase
-- email, phone digits) for the duplicate check.
CREATE FUNCTION sales_contacts_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSIF (NEW.id, NEW.created_at, NEW.created_by_user_id)
        IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'sales contacts: id and creation never change' USING ERRCODE = 'check_violation';
  END IF;
  NEW.email := nullif(btrim(NEW.email), '');
  NEW.phone := nullif(btrim(NEW.phone), '');
  NEW.email_normalized := lower(NEW.email);
  NEW.phone_normalized := nullif(regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g'), '');
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_contacts_rules BEFORE INSERT OR UPDATE ON sales_contacts
  FOR EACH ROW EXECUTE FUNCTION sales_contacts_rules();

-- Opportunities. The database owns the stage timestamps, the conversion and lost times and the
-- sync time. When the linked transaction's status changes, the record follows it: Under Contract
-- to the pipeline's transaction-synced stage, Closed to its closed stage, Terminated (from Under
-- Contract) back to the pipeline's return stage. While the transaction is under contract or
-- closed, the stage stays with it (no double entry). Entering a lost stage needs a reason (and a
-- note for OTHER, when the settings ask); leaving one clears them (the history keeps them).
-- Entering a stage needs its required fields; an inactive stage takes no new records.
CREATE FUNCTION sales_opportunities_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  st record;
  old_type "SalesStageType";
  target uuid;
  moved boolean;
  f text;
  note_required boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.converted_at := NULL;
    NEW.lost_at := NULL;
    NEW.transaction_synced_at := NULL;
  ELSE
    IF (NEW.id, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'sales opportunities: id and creation never change' USING ERRCODE = 'check_violation';
    END IF;
    NEW.converted_at := OLD.converted_at;
    NEW.lost_at := OLD.lost_at;
    NEW.stage_entered_at := OLD.stage_entered_at;
    NEW.transaction_synced_at := OLD.transaction_synced_at;
    SELECT stage_type INTO old_type FROM sales_pipeline_stages WHERE id = OLD.stage_id;
  END IF;

  -- The transaction sync.
  IF NEW.transaction_status IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.transaction_status END) THEN
    IF TG_OP = 'UPDATE' AND OLD.transaction_status = 'UNDER_CONTRACT' AND NEW.transaction_status IS NULL THEN
      RAISE EXCEPTION 'sales opportunities: a transaction under contract is not unlinked; terminate or close it'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.transaction_synced_at := CASE WHEN NEW.transaction_status IS NULL THEN NULL ELSE now() END;
    target := NULL;
    IF NEW.transaction_status IN ('UNDER_CONTRACT', 'CLOSED') THEN
      SELECT s.id INTO target FROM sales_pipeline_stages s
      WHERE s.pipeline_id = NEW.pipeline_id AND s.is_active
        AND s.stage_type = (CASE NEW.transaction_status WHEN 'UNDER_CONTRACT' THEN 'TRANSACTION_SYNCED'
                                                        ELSE 'CLOSED' END)::"SalesStageType"
      ORDER BY s.position, s.id LIMIT 1;
      IF target IS NULL THEN
        RAISE EXCEPTION 'sales opportunities: the pipeline has no active stage for a % transaction',
          NEW.transaction_status USING ERRCODE = 'check_violation';
      END IF;
      NEW.stage_id := target;
    ELSIF NEW.transaction_status = 'TERMINATED' AND old_type = 'TRANSACTION_SYNCED' THEN
      SELECT coalesce(p.terminated_return_stage_id,
                      (SELECT s.id FROM sales_pipeline_stages s
                       WHERE s.pipeline_id = p.id AND s.is_active AND s.stage_type = 'CONVERTED'
                       ORDER BY s.position, s.id LIMIT 1))
        INTO target FROM sales_pipelines p WHERE p.id = NEW.pipeline_id;
      IF target IS NULL THEN
        RAISE EXCEPTION 'sales opportunities: the pipeline has no stage to return a terminated record to'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.stage_id := target;
    END IF;
  END IF;

  SELECT * INTO st FROM sales_pipeline_stages WHERE id = NEW.stage_id AND pipeline_id = NEW.pipeline_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales opportunities: the stage is not in the pipeline' USING ERRCODE = 'foreign_key_violation';
  END IF;
  moved := TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id;

  IF moved THEN
    IF NOT st.is_active THEN
      RAISE EXCEPTION 'sales opportunities: the stage % is inactive', st.name USING ERRCODE = 'check_violation';
    END IF;
    NEW.stage_entered_at := now();
    FOREACH f IN ARRAY st.required_fields LOOP
      IF (f = 'value' AND NEW.value_cents IS NULL) OR (f = 'assignee' AND NEW.assigned_to_user_id IS NULL)
         OR (f = 'plan' AND NEW.plan_id IS NULL) OR (f = 'transaction' AND NEW.transaction_id IS NULL)
         OR (f = 'lost_note' AND NEW.lost_note IS NULL) THEN
        RAISE EXCEPTION 'sales opportunities: the stage % needs %', st.name, f USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  IF st.stage_type = 'LOST' THEN
    IF NEW.lost_reason IS NULL THEN
      RAISE EXCEPTION 'sales opportunities: a lost record needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    SELECT lost_other_note_required INTO note_required FROM sales_attention_settings WHERE id = 1;
    IF NEW.lost_reason = 'OTHER' AND coalesce(note_required, true) AND NEW.lost_note IS NULL THEN
      RAISE EXCEPTION 'sales opportunities: a lost reason of OTHER needs a note' USING ERRCODE = 'check_violation';
    END IF;
    IF moved OR NEW.lost_at IS NULL THEN
      NEW.lost_at := now();
    END IF;
  ELSIF moved AND old_type = 'LOST' THEN
    NEW.lost_reason := NULL;
    NEW.lost_note := NULL;
    NEW.lost_at := NULL;
  ELSIF NEW.lost_reason IS NOT NULL OR NEW.lost_note IS NOT NULL THEN
    RAISE EXCEPTION 'sales opportunities: a lost reason comes with a lost stage' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.transaction_status = 'UNDER_CONTRACT' AND st.stage_type <> 'TRANSACTION_SYNCED'
     OR NEW.transaction_status = 'CLOSED' AND st.stage_type <> 'CLOSED' THEN
    RAISE EXCEPTION 'sales opportunities: the stage follows the % transaction', NEW.transaction_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF st.stage_type = 'TRANSACTION_SYNCED' AND NEW.transaction_status IS DISTINCT FROM 'UNDER_CONTRACT' THEN
    RAISE EXCEPTION 'sales opportunities: Under Contract follows a transaction under contract'
      USING ERRCODE = 'check_violation';
  END IF;
  IF st.stage_type IN ('CONVERTED', 'TRANSACTION_SYNCED', 'CLOSED') AND NEW.converted_at IS NULL THEN
    NEW.converted_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_opportunities_rules BEFORE INSERT OR UPDATE ON sales_opportunities
  FOR EACH ROW EXECUTE FUNCTION sales_opportunities_rules();

-- The history the app never writes: every stage change (with the names at the time) and every
-- owner change, with the actor (the signed-in team member; nobody for the platform) and the
-- source (a transaction status change is TRANSACTION). Runs as the owner: the app role has no
-- insert grant on the history tables.
CREATE FUNCTION sales_opportunities_history() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  src "SalesChangeSource" := sales_change_source();
  to_st record;
  from_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.transaction_status IS DISTINCT FROM OLD.transaction_status
     AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    src := 'TRANSACTION';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT name, stage_type INTO to_st FROM sales_pipeline_stages WHERE id = NEW.stage_id;
    IF TG_OP = 'UPDATE' THEN
      SELECT name INTO from_name FROM sales_pipeline_stages WHERE id = OLD.stage_id;
    END IF;
    INSERT INTO sales_stage_history (id, opportunity_id, from_stage_id, to_stage_id, from_stage_name,
      to_stage_name, to_stage_type, actor_user_id, source, lost_reason, lost_note, transaction_status)
    VALUES (gen_random_uuid(), NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END, NEW.stage_id,
      from_name, to_st.name, to_st.stage_type, app_current_admin_id(), src, NEW.lost_reason, NEW.lost_note,
      NEW.transaction_status);
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.assigned_to_user_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id) THEN
    INSERT INTO sales_assignment_history (id, opportunity_id, from_user_id, to_user_id, actor_user_id, source)
    VALUES (gen_random_uuid(), NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.assigned_to_user_id END,
      NEW.assigned_to_user_id, app_current_admin_id(), sales_change_source());
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER sales_opportunities_history AFTER INSERT OR UPDATE ON sales_opportunities
  FOR EACH ROW EXECUTE FUNCTION sales_opportunities_history();
REVOKE ALL ON FUNCTION sales_opportunities_history() FROM PUBLIC;

-- Activity is logged once, by the signed-in team member, never in the future, and a linked
-- follow-up is the same record's.
CREATE FUNCTION sales_activities_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'sales activities: an activity cannot have happened in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.follow_up_id IS NOT NULL THEN
    PERFORM 1 FROM sales_follow_ups WHERE id = NEW.follow_up_id AND opportunity_id = NEW.opportunity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sales activities: the follow-up belongs to another record'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.actor_user_id := app_current_admin_id();
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_activities_rules BEFORE INSERT ON sales_activities
  FOR EACH ROW EXECUTE FUNCTION sales_activities_rules();

-- Follow-ups: scheduled, then completed or cancelled (final; the database stamps the time).
-- Rescheduling and edits happen while scheduled; the assignee may be cleared when that admin is
-- removed.
CREATE FUNCTION sales_follow_ups_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'SCHEDULED' THEN
      RAISE EXCEPTION 'sales follow-ups: a follow-up starts SCHEDULED' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.opportunity_id, NEW.created_at, NEW.created_by_user_id, NEW.completed_at, NEW.cancelled_at)
     IS DISTINCT FROM (OLD.id, OLD.opportunity_id, OLD.created_at, OLD.created_by_user_id, OLD.completed_at, OLD.cancelled_at) THEN
    RAISE EXCEPTION 'sales follow-ups: the record, creation and the database''s stamps never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'SCHEDULED' THEN
    IF (NEW.status, NEW.kind, NEW.title, NEW.due_at, NEW.ends_at, NEW.location)
       IS DISTINCT FROM (OLD.status, OLD.kind, OLD.title, OLD.due_at, OLD.ends_at, OLD.location)
       OR (NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id AND NEW.assigned_to_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'sales follow-ups: a % follow-up never changes', OLD.status USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'COMPLETED' THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'CANCELLED' THEN
    NEW.cancelled_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_follow_ups_rules BEFORE INSERT OR UPDATE ON sales_follow_ups
  FOR EACH ROW EXECUTE FUNCTION sales_follow_ups_rules();

-- Notes: the text changes, nothing else; the database stamps the times.
CREATE FUNCTION sales_notes_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF (NEW.id, NEW.opportunity_id, NEW.author_user_id, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.opportunity_id, OLD.author_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'sales notes: only the text of a note changes' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_notes_rules BEFORE INSERT OR UPDATE ON sales_notes
  FOR EACH ROW EXECUTE FUNCTION sales_notes_rules();

CREATE FUNCTION sales_attention_settings_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_attention_settings_rules BEFORE UPDATE ON sales_attention_settings
  FOR EACH ROW EXECUTE FUNCTION sales_attention_settings_rules();

-- ---------- Grants ----------
-- Opportunities, pipelines and follow-ups are kept (deactivate, lose or cancel instead); the
-- history is the database's to write; activity is insert-only.
GRANT SELECT, INSERT, UPDATE ON sales_pipelines, sales_opportunities, sales_follow_ups TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_pipeline_stages, sales_contacts, sales_tags, sales_notes
  TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON sales_opportunity_tags TO firmivra_app;
GRANT SELECT, INSERT ON sales_activities TO firmivra_app;
GRANT SELECT ON sales_stage_history, sales_assignment_history TO firmivra_app;
GRANT SELECT, UPDATE ON sales_attention_settings TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_pipelines', 'sales_pipeline_stages', 'sales_contacts',
    'sales_opportunities', 'sales_tags', 'sales_opportunity_tags', 'sales_stage_history',
    'sales_assignment_history', 'sales_activities', 'sales_follow_ups', 'sales_notes',
    'sales_attention_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's jobs (imports, the transaction sync,
-- attention: platform scope). Which records a team member sees and changes (their own, their
-- team's, everyone's) is the API's check: platform_members.scope_type and the sales.* keys. No
-- firm scope reaches any sales table.
CREATE FUNCTION app_is_sales_team() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_pipelines', 'sales_pipeline_stages', 'sales_contacts',
    'sales_opportunities', 'sales_tags', 'sales_opportunity_tags', 'sales_activities',
    'sales_follow_ups', 'sales_attention_settings'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_sales_team()) '
                   'WITH CHECK (app_is_sales_team())', t || '_team', t);
  END LOOP;
END
$$;

-- History: the team reads it; only the owner-run trigger writes it (the app has no insert grant).
CREATE POLICY sales_stage_history_read ON sales_stage_history FOR SELECT USING (app_is_sales_team());
CREATE POLICY sales_stage_history_write ON sales_stage_history FOR INSERT WITH CHECK (true);
CREATE POLICY sales_assignment_history_read ON sales_assignment_history FOR SELECT
  USING (app_is_sales_team());
CREATE POLICY sales_assignment_history_write ON sales_assignment_history FOR INSERT WITH CHECK (true);

-- Notes: the team reads them; a team member writes, edits and deletes only their own.
CREATE POLICY sales_notes_read ON sales_notes FOR SELECT USING (app_is_sales_team());
CREATE POLICY sales_notes_write ON sales_notes FOR INSERT
  WITH CHECK (author_user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()));
CREATE POLICY sales_notes_edit ON sales_notes FOR UPDATE
  USING (author_user_id = app_current_admin_id()) WITH CHECK (author_user_id = app_current_admin_id());
CREATE POLICY sales_notes_delete ON sales_notes FOR DELETE
  USING (author_user_id = app_current_admin_id());
