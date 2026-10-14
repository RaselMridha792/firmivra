-- R37 (Rasel, Oct 14), Intake Forms: what the send, list, detail and settings screens need.
-- Intakes get their send setup (channel, subject, message, dates, assignee, reminders), the
-- database-kept facts (sent_at, completed_at, last_activity_at, the per-firm reference number),
-- a DRAFT status, and the secure link of a lead recipient. intake_settings holds the firm's
-- settings page. No API yet: existing writes keep working (every new column is optional).
-- The new enum value DRAFT is not used by any CHECK, index or policy here (a new value cannot
-- be used in the transaction that adds it); its rules are in trigger bodies, which run later.

-- CreateEnum
CREATE TYPE "IntakeDelivery" AS ENUM ('EMAIL', 'SMS', 'PORTAL');

-- AlterEnum
ALTER TYPE "IntakeStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "intakes" ADD COLUMN     "access_token_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "access_token_hash" TEXT,
ADD COLUMN     "allow_save_resume" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "completed_by_user_id" UUID,
ADD COLUMN     "delivery_channel" "IntakeDelivery",
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "message_body" TEXT,
ADD COLUMN     "message_subject" TEXT,
ADD COLUMN     "reference_number" INTEGER,
ADD COLUMN     "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "intake_settings" (
    "business_id" UUID NOT NULL,
    "default_expiry_days" INTEGER NOT NULL DEFAULT 14,
    "allow_save_resume" BOOLEAN NOT NULL DEFAULT true,
    "require_signature" BOOLEAN NOT NULL DEFAULT true,
    "auto_submission_id" BOOLEAN NOT NULL DEFAULT false,
    "default_owner_user_id" UUID,
    "show_progress_bar" BOOLEAN NOT NULL DEFAULT true,
    "thank_you_message" TEXT,
    "redirect_after_completion" BOOLEAN NOT NULL DEFAULT false,
    "redirect_url" TEXT,
    "send_client_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "notify_assigned_staff" BOOLEAN NOT NULL DEFAULT true,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "first_reminder_days" INTEGER NOT NULL DEFAULT 3,
    "final_reminder_days" INTEGER NOT NULL DEFAULT 7,
    "expiry_alert_hours" INTEGER NOT NULL DEFAULT 24,
    "auto_create_client" BOOLEAN NOT NULL DEFAULT false,
    "auto_create_follow_up_task" BOOLEAN NOT NULL DEFAULT false,
    "route_by_service" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_owner_user_id" UUID,
    "use_firm_branding" BOOLEAN NOT NULL DEFAULT true,
    "accepted_file_types" TEXT[] DEFAULT ARRAY['application/pdf', 'image/jpeg', 'image/png']::TEXT[],
    "max_file_size_mb" INTEGER NOT NULL DEFAULT 10,
    "consent_required" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intake_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "audit_logs_business_id_entity_type_entity_id_created_at_idx" ON "audit_logs"("business_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intakes_access_token_hash_key" ON "intakes"("access_token_hash");

-- CreateIndex
CREATE INDEX "intakes_business_id_status_sent_at_idx" ON "intakes"("business_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "intakes_business_id_assigned_user_id_status_idx" ON "intakes"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "intakes_business_id_form_id_idx" ON "intakes"("business_id", "form_id");

-- CreateIndex
CREATE INDEX "intakes_business_id_last_activity_at_idx" ON "intakes"("business_id", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "intakes_business_id_reference_number_key" ON "intakes"("business_id", "reference_number");

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_completed_by_user_id_fkey" FOREIGN KEY ("business_id", "completed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_settings" ADD CONSTRAINT "intake_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_settings" ADD CONSTRAINT "intake_settings_business_id_default_owner_user_id_fkey" FOREIGN KEY ("business_id", "default_owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_settings" ADD CONSTRAINT "intake_settings_business_id_follow_up_owner_user_id_fkey" FOREIGN KEY ("business_id", "follow_up_owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Existing intakes (local and dev), before the rules ----------
-- Every intake so far was sent when it was made. Each firm in its own scope (forced RLS).
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
    UPDATE intakes
       SET sent_at = created_at,
           last_activity_at = updated_at,
           completed_at = CASE WHEN status = 'COMPLETED' THEN updated_at END
     WHERE business_id = firm;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- ---------- Grants and RLS ----------
-- Intakes stay records, drafts included: an unwanted draft is ARCHIVED, never deleted.
GRANT SELECT, INSERT, UPDATE ON intake_settings TO firmivra_app;

ALTER TABLE intake_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_settings_business ON intake_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE intakes ADD CONSTRAINT intakes_expiry_after_sent
  CHECK (expires_at IS NULL OR sent_at IS NULL OR expires_at > sent_at);
ALTER TABLE intakes ADD CONSTRAINT intakes_expiry_after_due
  CHECK (expires_at IS NULL OR due_on IS NULL OR (expires_at AT TIME ZONE 'UTC')::date >= due_on);
ALTER TABLE intakes ADD CONSTRAINT intakes_message_length
  CHECK ((message_subject IS NULL OR (char_length(btrim(message_subject)) >= 1 AND char_length(message_subject) <= 200))
     AND (message_body IS NULL OR (char_length(btrim(message_body)) >= 1 AND char_length(message_body) <= 500)));
ALTER TABLE intakes ADD CONSTRAINT intakes_portal_for_clients
  CHECK (delivery_channel IS DISTINCT FROM 'PORTAL' OR lead_id IS NULL);
-- A lead recipient's secure link: SHA-256 hex and its expiry together, never past the intake's own.
ALTER TABLE intakes ADD CONSTRAINT intakes_access_token
  CHECK ((access_token_hash IS NULL) = (access_token_expires_at IS NULL)
     AND (access_token_hash IS NULL OR (lead_id IS NOT NULL AND access_token_hash ~ '^[0-9a-f]{64}$'))
     AND (access_token_expires_at IS NULL OR expires_at IS NULL OR access_token_expires_at <= expires_at));
ALTER TABLE intakes ADD CONSTRAINT intakes_reference_positive
  CHECK (reference_number IS NULL OR reference_number > 0);

ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_ranges
  CHECK (default_expiry_days BETWEEN 1 AND 365
     AND first_reminder_days BETWEEN 1 AND 30
     AND final_reminder_days > first_reminder_days AND final_reminder_days <= 60
     AND expiry_alert_hours BETWEEN 1 AND 168
     AND max_file_size_mb BETWEEN 1 AND 10);
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_thank_you
  CHECK (thank_you_message IS NULL
     OR (char_length(btrim(thank_you_message)) >= 1 AND char_length(thank_you_message) <= 200
         AND app_no_hidden_characters(thank_you_message)));
-- https only, no spaces; required while the redirect is on.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_redirect
  CHECK ((redirect_url IS NULL OR (redirect_url ~ '^https://[^[:space:]]+$' AND char_length(redirect_url) <= 500))
     AND (NOT redirect_after_completion OR redirect_url IS NOT NULL));
-- The platform's upload types (packages/types UPLOAD_LIMITS), at least one.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_file_types
  CHECK (accepted_file_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
     AND cardinality(accepted_file_types) >= 1);

-- ---------- Rules the database keeps ----------
-- sent_at: the first send, set here (never by a caller), once. A DRAFT has none (nor does one
-- that is archived unsent) and a sent
-- intake never goes back to DRAFT. completed_at follows COMPLETED. last_activity_at moves forward
-- on every change. reference_number: the next number of the firm when its settings turn
-- "auto-generate submission ID" on, under a per-firm lock; never changed once given.
CREATE FUNCTION intakes_send_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  numbered boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'DRAFT' THEN
      NEW.sent_at := NULL;
    ELSE
      NEW.sent_at := now();
    END IF;
    NEW.reference_number := NULL;
    SELECT s.auto_submission_id INTO numbered FROM intake_settings s
      WHERE s.business_id = NEW.business_id;
    IF coalesce(numbered, false) THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('intake-ref:' || NEW.business_id::text, 0));
      SELECT coalesce(max(i.reference_number), 0) + 1 INTO NEW.reference_number
        FROM intakes i WHERE i.business_id = NEW.business_id;
    END IF;
  ELSE
    IF OLD.status <> 'DRAFT' AND NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'intakes: an intake that was sent cannot go back to draft'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'ARCHIVED') THEN
      NEW.sent_at := now();
    ELSIF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
      RAISE EXCEPTION 'intakes: sent_at is set by the database, once'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reference_number IS DISTINCT FROM OLD.reference_number THEN
      RAISE EXCEPTION 'intakes: the reference number is given by the database and never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.last_activity_at := greatest(NEW.last_activity_at, OLD.last_activity_at, now());
  END IF;

  IF NEW.status = 'COMPLETED' THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'COMPLETED' THEN
      NEW.completed_at := now();
    ELSE
      NEW.completed_at := OLD.completed_at;
    END IF;
  ELSE
    NEW.completed_at := NULL;
    NEW.completed_by_user_id := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intakes_send_rules
  BEFORE INSERT OR UPDATE ON intakes
  FOR EACH ROW EXECUTE FUNCTION intakes_send_rules();
