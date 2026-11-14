-- R55 (Rasel's approval in R55's window, Nov 14: items a to m of the Review Two schema request).
-- Leads: a) tasks.lead_id, a lead's task (a client or a lead, never both); b) lead_uploads.uploaded_by_user_id,
-- a file staff add to an open lead (Rasel's choice over documents.lead_id: documents need a client
-- and an engagement), carried over INTERNAL at conversion; c) leads.date_of_birth; d)
-- lead_contact_points, a lead's other phones and emails. Intake Forms: e) and f)
-- intake_templates.portal_published and share_token_hash (the public link and embed, hashed); g) six
-- retention minimums on intake_settings; m) the final reminder no longer has to come after the first
-- (it counts back from the expiry). Documents: h) document_settings.max_file_size_mb; l) a firm
-- file's client visibility (direction INTERNAL or FIRM_TO_CLIENT) can change. Appointments: i)
-- confirmation messages; j) a reminder's own note; k) where the client instructions show.
-- Safe on dev: one new empty table; every ADD COLUMN is nullable or has a constant default (catalog
-- only); the new checks pass on existing rows; no backfill.

-- CreateEnum
CREATE TYPE "LeadContactKind" AS ENUM ('EMAIL', 'PHONE');

-- AlterTable
ALTER TABLE "appointment_reminders" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "confirmation_message" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "confirmation_message" TEXT,
ADD COLUMN     "instructions_in_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "instructions_in_portal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "instructions_in_sms" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "document_settings" ADD COLUMN     "max_file_size_mb" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "intake_settings" ADD COLUMN     "retention_years_client_documents" INTEGER,
ADD COLUMN     "retention_years_firm_documents" INTEGER,
ADD COLUMN     "retention_years_intake_submissions" INTEGER,
ADD COLUMN     "retention_years_portal_messages" INTEGER,
ADD COLUMN     "retention_years_system_emails" INTEGER,
ADD COLUMN     "retention_years_tax_return_documents" INTEGER;

-- AlterTable
ALTER TABLE "intake_templates" ADD COLUMN     "portal_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "share_token_hash" TEXT;

-- AlterTable
ALTER TABLE "lead_uploads" ADD COLUMN     "uploaded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "date_of_birth" DATE;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "lead_id" UUID;

-- CreateTable
CREATE TABLE "lead_contact_points" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" "LeadContactKind" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_contact_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_contact_points_business_id_lead_id_idx" ON "lead_contact_points"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_templates_share_token_hash_key" ON "intake_templates"("share_token_hash");

-- CreateIndex
CREATE INDEX "tasks_business_id_lead_id_idx" ON "tasks"("business_id", "lead_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_uploads" ADD CONSTRAINT "lead_uploads_business_id_uploaded_by_user_id_fkey" FOREIGN KEY ("business_id", "uploaded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contact_points" ADD CONSTRAINT "lead_contact_points_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_contact_points TO firmivra_app;
ALTER TABLE lead_contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_contact_points FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_contact_points_business ON lead_contact_points
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- a) A task is a client's or a lead's, never both. A lead's task has no client and so no
-- engagement (its foreign key carries client_id); a clientless draft keeps its own rule.
ALTER TABLE tasks ADD CONSTRAINT tasks_client_or_lead
  CHECK (client_id IS NULL OR lead_id IS NULL);
ALTER TABLE tasks DROP CONSTRAINT tasks_client_unless_draft;
ALTER TABLE tasks ADD CONSTRAINT tasks_client_unless_draft
  CHECK (client_id IS NOT NULL
         OR (lead_id IS NOT NULL AND engagement_id IS NULL)
         OR (status = 'DRAFT' AND created_by_user_id IS NOT NULL AND engagement_id IS NULL));

-- c) A date of birth from this century or the last.
ALTER TABLE leads ADD CONSTRAINT leads_date_of_birth
  CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- d) An email (lower case, one @, up to 254) or a phone number (up to 40); a short label; each
-- once per lead (letter case ignored); its lead never changes.
ALTER TABLE lead_contact_points ADD CONSTRAINT lead_contact_points_shape
  CHECK (((kind = 'EMAIL' AND value = lower(value) AND char_length(value) <= 254
           AND value ~ '^[^@[:space:]]+@[^@[:space:]]+$')
          OR (kind = 'PHONE' AND char_length(btrim(value)) BETWEEN 1 AND 40))
     AND (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 40)
     AND position >= 0);
CREATE UNIQUE INDEX lead_contact_points_once
  ON lead_contact_points (business_id, lead_id, kind, lower(value));
CREATE FUNCTION lead_contact_points_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id THEN
    RAISE EXCEPTION 'lead contact points: the lead of a contact point cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_contact_points_rules
  BEFORE UPDATE ON lead_contact_points
  FOR EACH ROW EXECUTE FUNCTION lead_contact_points_rules();

-- b) A staff file is in the 'staff' slot; staff add one to an open lead (not a draft, an expired
-- or converted lead, nor an archived one) and may remove it until the lead is converted. The
-- lead's own Begin Online files keep every rule they had.
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_staff_slot
  CHECK (uploaded_by_user_id IS NULL OR slot = 'staff');
CREATE OR REPLACE FUNCTION lead_uploads_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'lead uploads: a new upload starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.uploaded_by_user_id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = NEW.lead_id AND l.status = 'DRAFT') THEN
        RAISE EXCEPTION 'lead uploads: files can be added only while the lead is a draft'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = NEW.lead_id AND l.archived_at IS NULL
        AND l.status NOT IN ('DRAFT', 'EXPIRED', 'CONVERTED')
    ) THEN
      RAISE EXCEPTION 'lead uploads: staff add files to an open lead only'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'lead uploads: the file, its S3 key and its lead cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'lead uploads: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- Only the lead's own (Begin Online) files need its unexpired draft.
CREATE OR REPLACE FUNCTION lead_uploads_unexpired_draft() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.uploaded_by_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM leads l
    WHERE l.id = NEW.lead_id AND l.status = 'DRAFT' AND l.draft_expires_at > now()
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead uploads: only an unexpired draft takes files'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE POLICY lead_uploads_delete_staff ON lead_uploads FOR DELETE
  USING (business_id = app_current_business_id() AND uploaded_by_user_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM leads l
                     WHERE l.id = lead_uploads.lead_id AND l.status <> 'CONVERTED'));

-- e, f) The public link's token is a SHA-256 (hex); an archived form has no live link.
ALTER TABLE intake_templates ADD CONSTRAINT intake_templates_share_token
  CHECK ((share_token_hash IS NULL OR share_token_hash ~ '^[0-9a-f]{64}$')
     AND (share_token_hash IS NULL OR archived_at IS NULL));

-- g) Each category's minimum, 1 to 30 years.
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_retention_years
  CHECK ((retention_years_client_documents IS NULL OR retention_years_client_documents BETWEEN 1 AND 30)
     AND (retention_years_firm_documents IS NULL OR retention_years_firm_documents BETWEEN 1 AND 30)
     AND (retention_years_intake_submissions IS NULL OR retention_years_intake_submissions BETWEEN 1 AND 30)
     AND (retention_years_portal_messages IS NULL OR retention_years_portal_messages BETWEEN 1 AND 30)
     AND (retention_years_system_emails IS NULL OR retention_years_system_emails BETWEEN 1 AND 30)
     AND (retention_years_tax_return_documents IS NULL OR retention_years_tax_return_documents BETWEEN 1 AND 30));

-- m) The final reminder counts back from the expiry now (Intake 10c): it no longer has to come
-- after the first; 5 minutes to 60 days. Every other range stays as it was.
ALTER TABLE intake_settings DROP CONSTRAINT intake_settings_ranges;
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_ranges
  CHECK ((((default_expiry_days >= 1) AND (default_expiry_days <= 365)) AND ((first_reminder_days >= 1) AND (first_reminder_days <= 30)) AND (final_reminder_days > first_reminder_days) AND (final_reminder_days <= 60) AND ((expiry_alert_hours >= 1) AND (expiry_alert_hours <= 168)) AND ((max_file_size_mb >= 1) AND (max_file_size_mb <= 100))
         AND first_reminder_minutes BETWEEN 5 AND 43200
         AND final_reminder_minutes BETWEEN 5 AND 86400));

-- h) The regular documents' size choices.
ALTER TABLE document_settings ADD CONSTRAINT document_settings_max_file_size_mb
  CHECK (max_file_size_mb IN (5, 10, 20, 30, 50, 100));

-- i, j) Client-facing words within limits.
ALTER TABLE appointments ADD CONSTRAINT appointments_confirmation_message
  CHECK (confirmation_message IS NULL OR char_length(btrim(confirmation_message)) BETWEEN 1 AND 2000);
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_confirmation_message
  CHECK (confirmation_message IS NULL OR char_length(btrim(confirmation_message)) BETWEEN 1 AND 2000);
ALTER TABLE appointment_reminders ADD CONSTRAINT appointment_reminders_note
  CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500);

-- l) A firm file's client visibility changes (documents_rules, from r0_esign's, two changes: the
-- direction rule, and a carried-over staff file arrives INTERNAL); a firm folder still takes
-- internal files only, when the direction changes too.
CREATE OR REPLACE FUNCTION documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.esign_request_id IS NOT NULL THEN
      -- Held FOR SHARE until commit: the request cannot be completed twice or its documents set
      -- by another transaction meanwhile.
      PERFORM 1 FROM esign_requests r WHERE r.id = NEW.esign_request_id FOR SHARE;
      IF NEW.direction <> 'FIRM_TO_CLIENT' OR NEW.content_type <> 'application/pdf'
         OR NEW.scan_status <> 'CLEAN' OR NEW.scanned_at IS NULL OR NOT NEW.legal_hold
         OR NEW.retention_until IS NOT NULL OR NEW.lead_upload_id IS NOT NULL
         OR NEW.intake_id IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM esign_requests r
           WHERE r.id = NEW.esign_request_id AND r.status = 'COMPLETED'
             AND r.client_id = NEW.client_id AND r.engagement_id = NEW.engagement_id
             AND ((starts_with(NEW.s3_key, 'tenant/' || r.business_id || '/esign/' || r.id || '/final/')
                   AND NEW.sha256 = r.final_sha256 AND r.final_document_id IS NULL)
               OR (starts_with(NEW.s3_key, 'tenant/' || r.business_id || '/esign/' || r.id || '/certificate/')
                   AND NEW.sha256 = r.certificate_sha256 AND r.certificate_document_id IS NULL))) THEN
        RAISE EXCEPTION 'documents: a Firm Sign copy is the completed request''s own final PDF or certificate, filed CLEAN under legal hold'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.lead_upload_id IS NOT NULL THEN
      -- R55: the lead's own file arrives as the client's (CLIENT_TO_FIRM); a file staff added to
      -- the lead arrives firm-only (INTERNAL), to be shared on purpose.
      IF NOT EXISTS (
        SELECT 1 FROM lead_uploads u JOIN leads l ON l.id = u.lead_id
        WHERE u.id = NEW.lead_upload_id
          AND NEW.direction = CASE WHEN u.uploaded_by_user_id IS NULL
                                   THEN 'CLIENT_TO_FIRM'::"DocumentDirection"
                                   ELSE 'INTERNAL'::"DocumentDirection" END
          AND u.s3_key = NEW.s3_key AND u.sha256 = NEW.sha256 AND u.size_bytes = NEW.size_bytes
          AND u.content_type = NEW.content_type
          AND u.scan_status = NEW.scan_status AND u.scanned_at IS NOT DISTINCT FROM NEW.scanned_at
          AND l.status = 'CONVERTED' AND l.engagement_id = NEW.engagement_id
      ) THEN
        RAISE EXCEPTION 'documents: a carried-over upload must match its lead upload and the converted engagement'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'documents: a new document starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'CLIENT_TO_FIRM' AND NOT EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = NEW.engagement_id AND e.status IN ('PENDING', 'ACTIVE')
    ) THEN
      RAISE EXCEPTION 'documents: a client can upload only to an open engagement'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id <> OLD.engagement_id
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.lead_upload_id IS DISTINCT FROM OLD.lead_upload_id
     OR NEW.esign_request_id IS DISTINCT FROM OLD.esign_request_id
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'documents: the file, its S3 key, its engagement and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  -- R55 (Rasel, Nov 14; Clients C2-052): a firm file's client visibility changes, both ways
  -- (INTERNAL and FIRM_TO_CLIENT), never a client's upload or a Firm Sign copy; and a file is not
  -- hidden while a client share of it is still open (revoke the share first).
  IF NEW.direction <> OLD.direction THEN
    IF NOT (OLD.direction IN ('INTERNAL', 'FIRM_TO_CLIENT')
            AND NEW.direction IN ('INTERNAL', 'FIRM_TO_CLIENT'))
       OR NEW.esign_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'documents: the direction cannot change, except a firm file''s client visibility'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'INTERNAL' AND EXISTS (
      SELECT 1 FROM document_shares s
      WHERE s.business_id = NEW.business_id AND s.document_id = NEW.id
        AND s.recipient_kind = 'CLIENT' AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > now())
    ) THEN
      RAISE EXCEPTION 'documents: revoke the client''s share before hiding the file from the client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'documents: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.retention_until IS NULL AND NEW.retention_until IS NOT NULL)
     OR NEW.retention_until < OLD.retention_until THEN
    RAISE EXCEPTION 'documents: retention_until can only move later'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION documents_r37_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  folder_scope "DocumentFolderScope";
  folder_archived timestamptz;
BEGIN
  IF NEW.folder_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.folder_id IS DISTINCT FROM OLD.folder_id) THEN
    SELECT f.scope, f.archived_at INTO folder_scope, folder_archived FROM document_folders f
      WHERE f.business_id = NEW.business_id AND f.id = NEW.folder_id;
    IF folder_archived IS NOT NULL THEN
      RAISE EXCEPTION 'documents: an archived folder takes no documents'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.folder_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.folder_id IS DISTINCT FROM OLD.folder_id
          OR NEW.direction <> OLD.direction) THEN
    SELECT f.scope INTO folder_scope FROM document_folders f
      WHERE f.business_id = NEW.business_id AND f.id = NEW.folder_id;
    IF folder_scope = 'FIRM' AND NEW.direction <> 'INTERNAL' THEN
      RAISE EXCEPTION 'documents: a firm folder takes internal documents only'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
