-- R1 (Rasel's approval in R1's window, Nov 7: the schema batch; shapes as the lead specified them).
-- MSG-F16 client_timeline_entries (insert-only); L8 lead_follow_ups (issue #1051) with a backfill
-- from each lead's next_action_*; A9 appointment_types.required_intake_template_id and
-- intakes.appointment_id; PAY-3 payment_settings.default_card_processor and ach_processor;
-- SM12 staff_draft_attachments; SEC-6 memberships.is_security_admin and the firm's MFA requirement
-- with its documented exception; RP-F18 report_definitions.show_legend.
-- Safe on dev: new tables are empty; the ADD COLUMNs are nullable or have a constant default
-- (catalog only); the new checks pass on existing rows (defaults); the backfill reads leads once.

-- CreateEnum
CREATE TYPE "ClientTimelineKind" AS ENUM ('MESSAGE', 'EMAIL', 'SMS', 'NOTE', 'CALL', 'MEETING', 'DOCUMENT', 'TASK', 'INVOICE', 'OTHER');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "is_security_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "intakes" ADD COLUMN     "appointment_id" UUID;

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "required_intake_template_id" UUID;

-- AlterTable
ALTER TABLE "payment_settings" ADD COLUMN     "ach_processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "default_card_processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE';

-- AlterTable
ALTER TABLE "report_definitions" ADD COLUMN     "show_legend" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "staff_security_defaults" ADD COLUMN     "mfa_exception_approved_by_user_id" UUID,
ADD COLUMN     "mfa_exception_at" TIMESTAMPTZ(3),
ADD COLUMN     "mfa_exception_note" TEXT,
ADD COLUMN     "mfa_required" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "client_timeline_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" "ClientTimelineKind" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "action_type" "LeadActionType" NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "done_at" TIMESTAMPTZ(3),
    "outcome" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_draft_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "staff_draft_id" UUID NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "document_type" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_draft_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_timeline_entries_business_id_client_id_occurred_at_idx" ON "client_timeline_entries"("business_id", "client_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "lead_follow_ups_business_id_lead_id_done_at_due_at_idx" ON "lead_follow_ups"("business_id", "lead_id", "done_at", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_draft_attachments_s3_key_key" ON "staff_draft_attachments"("s3_key");

-- CreateIndex
CREATE INDEX "staff_draft_attachments_business_id_staff_draft_id_idx" ON "staff_draft_attachments"("business_id", "staff_draft_id");

-- CreateIndex
CREATE INDEX "intakes_business_id_appointment_id_idx" ON "intakes"("business_id", "appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_drafts_business_id_id_key" ON "staff_drafts"("business_id", "id");

-- AddForeignKey
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_business_id_appointment_id_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_business_id_required_intake_template_id_fkey" FOREIGN KEY ("business_id", "required_intake_template_id") REFERENCES "intake_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_security_defaults" ADD CONSTRAINT "staff_security_defaults_business_id_mfa_exception_approved_fkey" FOREIGN KEY ("business_id", "mfa_exception_approved_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_timeline_entries" ADD CONSTRAINT "client_timeline_entries_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_timeline_entries" ADD CONSTRAINT "client_timeline_entries_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_draft_attachments" ADD CONSTRAINT "staff_draft_attachments_business_id_staff_draft_id_fkey" FOREIGN KEY ("business_id", "staff_draft_id") REFERENCES "staff_drafts"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_draft_attachments" ADD CONSTRAINT "staff_draft_attachments_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Access ----------
-- The timeline is insert-only; follow-ups and draft files are edited and removed.
GRANT SELECT, INSERT ON client_timeline_entries TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_follow_ups, staff_draft_attachments TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_timeline_entries', 'lead_follow_ups', 'staff_draft_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Data rules Prisma cannot express ----------
-- MSG-F16: a source code, a title and a short summary; one entry per source record.
ALTER TABLE client_timeline_entries ADD CONSTRAINT client_timeline_entries_shape
  CHECK (source_type ~ '^[a-z][a-z0-9_]{0,49}$'
     AND char_length(btrim(title)) BETWEEN 1 AND 200
     AND (summary IS NULL OR char_length(btrim(summary)) BETWEEN 1 AND 500));
CREATE UNIQUE INDEX client_timeline_entries_one_per_source
  ON client_timeline_entries (business_id, source_type, source_id) WHERE source_id IS NOT NULL;

-- L8: short texts; an outcome only once the follow-up is done.
ALTER TABLE lead_follow_ups ADD CONSTRAINT lead_follow_ups_shape
  CHECK ((note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500)
     AND (outcome IS NULL OR char_length(btrim(outcome)) BETWEEN 1 AND 500)
     AND (outcome IS NULL OR done_at IS NOT NULL));
-- A follow-up stays with its firm and lead.
CREATE FUNCTION lead_follow_ups_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id THEN
    RAISE EXCEPTION 'lead follow-ups: the lead of a follow-up cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_follow_ups_rules
  BEFORE UPDATE ON lead_follow_ups
  FOR EACH ROW EXECUTE FUNCTION lead_follow_ups_rules();

-- SM12: the file under its own draft's folder, and its details within limits.
ALTER TABLE staff_draft_attachments ADD CONSTRAINT staff_draft_attachments_shape
  CHECK (starts_with(s3_key, 'tenant/' || business_id || '/staff-drafts/' || staff_draft_id || '/')
     AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'
     AND char_length(btrim(file_name)) BETWEEN 1 AND 255
     AND char_length(btrim(content_type)) BETWEEN 1 AND 100
     AND size_bytes > 0
     AND char_length(btrim(document_type)) BETWEEN 1 AND 100);

-- SEC-6: MFA may be off only with a documented, approved exception (no unrestricted off switch).
ALTER TABLE staff_security_defaults ADD CONSTRAINT staff_security_defaults_mfa_exception
  CHECK ((mfa_required
          OR (mfa_exception_note IS NOT NULL AND mfa_exception_approved_by_user_id IS NOT NULL
              AND mfa_exception_at IS NOT NULL))
     AND (mfa_exception_note IS NULL OR char_length(btrim(mfa_exception_note)) BETWEEN 1 AND 1000));

-- ---------- Backfill (L8) ----------
-- A lead's present follow-up becomes its first row, so it shows in the new list. Firm by firm,
-- in each firm's scope (row-level security is forced).
DO $migration$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    INSERT INTO lead_follow_ups (id, business_id, lead_id, action_type, due_at, note, updated_at)
    SELECT gen_random_uuid(), l.business_id, l.id, l.next_action_type, l.next_action_at,
           nullif(left(btrim(l.next_action_note), 500), ''), now()
      FROM leads l
     WHERE l.business_id = firm
       AND l.next_action_type IS NOT NULL AND l.next_action_at IS NOT NULL;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$migration$;
