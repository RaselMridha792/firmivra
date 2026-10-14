-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- CreateTable
CREATE TABLE "message_settings" (
    "business_id" UUID NOT NULL,
    "portal_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sender_name" TEXT,
    "signature" TEXT,
    "notify_unread" BOOLEAN NOT NULL DEFAULT true,
    "notify_assignment" BOOLEAN NOT NULL DEFAULT true,
    "notify_reply" BOOLEAN NOT NULL DEFAULT true,
    "notify_failure" BOOLEAN NOT NULL DEFAULT true,
    "notify_bulk_complete" BOOLEAN NOT NULL DEFAULT true,
    "default_assignee_user_id" UUID,
    "read_receipts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "retention_months" INTEGER,
    "attachment_max_mb" INTEGER NOT NULL DEFAULT 10,
    "allowed_attachment_types" TEXT[] DEFAULT ARRAY['pdf', 'doc', 'docx', 'jpg', 'png']::TEXT[],
    "quiet_hours_start" TIME(0),
    "quiet_hours_end" TIME(0),
    "bulk_confirm_threshold" INTEGER NOT NULL DEFAULT 100,
    "bulk_requires_manager" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "message_signatures" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID,
    "lead_id" UUID,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_signatures_business_id_user_id_key" ON "message_signatures"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "contact_consents_business_id_channel_status_idx" ON "contact_consents"("business_id", "channel", "status");

-- AddForeignKey
ALTER TABLE "message_settings" ADD CONSTRAINT "message_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_settings" ADD CONSTRAINT "message_settings_business_id_default_assignee_user_id_fkey" FOREIGN KEY ("business_id", "default_assignee_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_settings" ADD CONSTRAINT "message_settings_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_signatures" ADD CONSTRAINT "message_signatures_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_business_id_recorded_by_user_id_fkey" FOREIGN KEY ("business_id", "recorded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Messages settings (one row per firm), each member's own signature, and
-- whether a client or a lead may be messaged by email or text (consent and opt-outs).

-- ---------- Grants and RLS: only the firm's own business scope ----------
GRANT SELECT, INSERT, UPDATE ON message_settings, message_signatures, contact_consents TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_settings', 'message_signatures', 'contact_consents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE message_settings
  ADD CONSTRAINT message_settings_text CHECK (char_length(sender_name) <= 100 AND char_length(signature) <= 1000),
  ADD CONSTRAINT message_settings_retention CHECK (retention_months BETWEEN 1 AND 240),
  ADD CONSTRAINT message_settings_attachments
    CHECK (attachment_max_mb BETWEEN 1 AND 25
           AND allowed_attachment_types <@ ARRAY['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'csv', 'txt']::text[]),
  ADD CONSTRAINT message_settings_quiet_hours CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
  ADD CONSTRAINT message_settings_bulk CHECK (bulk_confirm_threshold BETWEEN 1 AND 100000);

ALTER TABLE message_signatures
  ADD CONSTRAINT message_signatures_body CHECK (btrim(body) <> '' AND char_length(body) <= 1000);

ALTER TABLE contact_consents
  -- A client's or a lead's, never both and never neither.
  ADD CONSTRAINT contact_consents_contact CHECK (num_nonnulls(client_id, lead_id) = 1),
  ADD CONSTRAINT contact_consents_source CHECK (source ~ '^[a-z_]{1,40}$');
CREATE UNIQUE INDEX contact_consents_one_per_client ON contact_consents (client_id, channel) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX contact_consents_one_per_lead ON contact_consents (lead_id, channel) WHERE lead_id IS NOT NULL;
