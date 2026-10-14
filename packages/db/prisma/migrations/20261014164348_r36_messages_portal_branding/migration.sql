-- CreateEnum
CREATE TYPE "OutboundMessageKind" AS ENUM ('DIRECT', 'BULK');

-- CreateEnum
CREATE TYPE "OutboundMessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PARTIAL', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MessageAudience" AS ENUM ('CLIENTS', 'LEADS', 'BOTH');

-- CreateEnum
CREATE TYPE "OutboundRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutboundExclusion" AS ENUM ('NO_CONTACT', 'NO_CONSENT', 'NO_PORTAL_ACCESS', 'PROVIDER_UNAVAILABLE', 'SUPPRESSED', 'NOT_PERMITTED', 'MANUALLY_EXCLUDED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "PortalModule" AS ENUM ('TAX_RETURNS', 'DOCUMENTS', 'INVOICES_PAYMENTS', 'APPOINTMENTS', 'INTAKE_FORMS', 'TASKS_REQUESTS', 'MESSAGES', 'REPORTS');

-- CreateEnum
CREATE TYPE "BrandTheme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SidebarStyle" AS ENUM ('SOLID', 'GRADIENT');

-- CreateEnum
CREATE TYPE "SidebarPosition" AS ENUM ('LEFT', 'RIGHT');

-- CreateEnum
CREATE TYPE "DateFormat" AS ENUM ('MDY', 'DMY', 'YMD');

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "background_color" TEXT,
ADD COLUMN     "branding_published_at" TIMESTAMPTZ(3),
ADD COLUMN     "branding_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'usd',
ADD COLUMN     "date_format" "DateFormat" NOT NULL DEFAULT 'MDY',
ADD COLUMN     "favicon_key" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-US',
ADD COLUMN     "login_background_key" TEXT,
ADD COLUMN     "login_message" TEXT,
ADD COLUMN     "rounded_corners" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "secondary_color" TEXT,
ADD COLUMN     "show_logo_text" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sidebar_position" "SidebarPosition" NOT NULL DEFAULT 'LEFT',
ADD COLUMN     "sidebar_style" "SidebarStyle" NOT NULL DEFAULT 'SOLID',
ADD COLUMN     "support_email" TEXT,
ADD COLUMN     "theme" "BrandTheme" NOT NULL DEFAULT 'LIGHT';

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "OutboundMessageKind" NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "status" "OutboundMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "template_id" UUID,
    "scheduled_for" TIMESTAMPTZ(3),
    "related_entity_type" TEXT,
    "related_entity_id" UUID,
    "assigned_user_id" UUID,
    "request_read_receipt" BOOLEAN NOT NULL DEFAULT false,
    "add_to_timeline" BOOLEAN NOT NULL DEFAULT true,
    "send_copy_to_sender" BOOLEAN NOT NULL DEFAULT false,
    "notify_on_complete" BOOLEAN NOT NULL DEFAULT false,
    "add_to_communication_log" BOOLEAN NOT NULL DEFAULT false,
    "audience" "MessageAudience",
    "audience_filters" JSONB,
    "total_count" INTEGER,
    "can_receive_count" INTEGER,
    "cannot_receive_count" INTEGER,
    "high_volume_confirmed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_message_recipients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "outbound_message_id" UUID NOT NULL,
    "client_id" UUID,
    "lead_id" UUID,
    "channel" "MessageChannel" NOT NULL,
    "status" "OutboundRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "exclusion" "OutboundExclusion",
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "message_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbound_message_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_message_files" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "outbound_message_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_message_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_module_visibility" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID,
    "module" "PortalModule" NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_module_visibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_locks" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "locked_by_user_id" UUID NOT NULL,
    "reason" TEXT,
    "locked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_activity" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "client_account_id" UUID,
    "type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "actor_kind" "InvoiceActorKind" NOT NULL DEFAULT 'CLIENT',
    "actor_user_id" UUID,
    "ip" INET,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_recent_clients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "last_viewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_recent_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_brand_profiles" (
    "business_id" UUID NOT NULL,
    "email_logo_key" TEXT,
    "email_from_name" TEXT,
    "reply_to_email" TEXT,
    "email_header" TEXT,
    "email_footer" TEXT,
    "email_disclaimer" TEXT,
    "portal_logo_key" TEXT,
    "portal_brand_color" TEXT,
    "portal_accent_color" TEXT,
    "letterhead_header" TEXT,
    "letterhead_footer" TEXT,
    "document_footer" TEXT,
    "signature_block" TEXT,
    "legal_text" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_brand_profiles_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "business_brand_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_brand_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_messages_business_id_status_scheduled_for_idx" ON "outbound_messages"("business_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outbound_messages_business_id_created_at_idx" ON "outbound_messages"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_business_id_id_key" ON "outbound_messages"("business_id", "id");

-- CreateIndex
CREATE INDEX "outbound_message_recipients_business_id_outbound_message_id_idx" ON "outbound_message_recipients"("business_id", "outbound_message_id", "status");

-- CreateIndex
CREATE INDEX "outbound_message_recipients_business_id_client_id_idx" ON "outbound_message_recipients"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "outbound_message_recipients_business_id_lead_id_idx" ON "outbound_message_recipients"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_message_files_s3_key_key" ON "outbound_message_files"("s3_key");

-- CreateIndex
CREATE INDEX "outbound_message_files_business_id_outbound_message_id_idx" ON "outbound_message_files"("business_id", "outbound_message_id");

-- CreateIndex
CREATE INDEX "portal_module_visibility_business_id_client_id_idx" ON "portal_module_visibility"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_locks_business_id_client_id_key" ON "client_portal_locks"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "client_portal_activity_business_id_client_id_occurred_at_idx" ON "client_portal_activity"("business_id", "client_id", "occurred_at");

-- CreateIndex
CREATE INDEX "portal_recent_clients_business_id_user_id_last_viewed_at_idx" ON "portal_recent_clients"("business_id", "user_id", "last_viewed_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_recent_clients_business_id_user_id_client_id_key" ON "portal_recent_clients"("business_id", "user_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_brand_versions_business_id_version_key" ON "business_brand_versions"("business_id", "version");

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_recipients" ADD CONSTRAINT "outbound_message_recipients_business_id_outbound_message_i_fkey" FOREIGN KEY ("business_id", "outbound_message_id") REFERENCES "outbound_messages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_recipients" ADD CONSTRAINT "outbound_message_recipients_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_recipients" ADD CONSTRAINT "outbound_message_recipients_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_recipients" ADD CONSTRAINT "outbound_message_recipients_business_id_message_id_fkey" FOREIGN KEY ("business_id", "message_id") REFERENCES "messages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_files" ADD CONSTRAINT "outbound_message_files_business_id_outbound_message_id_fkey" FOREIGN KEY ("business_id", "outbound_message_id") REFERENCES "outbound_messages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message_files" ADD CONSTRAINT "outbound_message_files_business_id_uploaded_by_user_id_fkey" FOREIGN KEY ("business_id", "uploaded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_module_visibility" ADD CONSTRAINT "portal_module_visibility_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_module_visibility" ADD CONSTRAINT "portal_module_visibility_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_module_visibility" ADD CONSTRAINT "portal_module_visibility_business_id_changed_by_user_id_fkey" FOREIGN KEY ("business_id", "changed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_locks" ADD CONSTRAINT "client_portal_locks_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_locks" ADD CONSTRAINT "client_portal_locks_business_id_locked_by_user_id_fkey" FOREIGN KEY ("business_id", "locked_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_activity" ADD CONSTRAINT "client_portal_activity_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_activity" ADD CONSTRAINT "client_portal_activity_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_activity" ADD CONSTRAINT "client_portal_activity_business_id_actor_user_id_fkey" FOREIGN KEY ("business_id", "actor_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_recent_clients" ADD CONSTRAINT "portal_recent_clients_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_recent_clients" ADD CONSTRAINT "portal_recent_clients_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_brand_profiles" ADD CONSTRAINT "business_brand_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_brand_profiles" ADD CONSTRAINT "business_brand_profiles_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_brand_versions" ADD CONSTRAINT "business_brand_versions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_brand_versions" ADD CONSTRAINT "business_brand_versions_business_id_published_by_user_id_fkey" FOREIGN KEY ("business_id", "published_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14), part 1 of 2: New Message and Send Bulk Message: the composed message or campaign, and
-- one row per recipient and channel with its outcome (the idempotency and the retry state). The
-- database keeps the safeguards that must not depend on the screen: the status path, content that
-- is fixed once sending, a confirmation above the firm's bulk threshold, opt-outs and a recipient
-- that is never sent to twice.

-- ---------- Grants and RLS: only the firm's own business scope; canceled, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON outbound_messages, outbound_message_recipients TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbound_messages', 'outbound_message_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_text
    CHECK (btrim(body) <> '' AND char_length(body) <= 10000 AND char_length(subject) <= 200
           AND (channel <> 'SMS' OR char_length(body) <= 1600)),
  -- Email has its subject once the message is more than a draft.
  ADD CONSTRAINT outbound_messages_subject
    CHECK (status = 'DRAFT' OR channel <> 'EMAIL' OR btrim(coalesce(subject, '')) <> ''),
  ADD CONSTRAINT outbound_messages_related
    CHECK ((related_entity_type IS NULL) = (related_entity_id IS NULL)
           AND (related_entity_type IS NULL OR related_entity_type ~ '^[a-z_]{1,40}$')),
  ADD CONSTRAINT outbound_messages_scheduled CHECK (status <> 'SCHEDULED' OR scheduled_for IS NOT NULL),
  -- A bulk message has its audience and filters; a direct one has neither.
  ADD CONSTRAINT outbound_messages_audience
    CHECK ((kind = 'BULK') = (audience IS NOT NULL)
           AND (kind = 'BULK' OR audience_filters IS NULL)
           AND (audience_filters IS NULL
                OR (jsonb_typeof(audience_filters) = 'object' AND pg_column_size(audience_filters) <= 8192))),
  ADD CONSTRAINT outbound_messages_counts
    CHECK ((total_count IS NULL) = (can_receive_count IS NULL)
           AND (total_count IS NULL) = (cannot_receive_count IS NULL)
           AND (total_count IS NULL
                OR (total_count >= 0 AND can_receive_count >= 0 AND cannot_receive_count >= 0
                    AND can_receive_count + cannot_receive_count = total_count))),
  ADD CONSTRAINT outbound_messages_completed
    CHECK ((status IN ('SENT', 'PARTIAL', 'FAILED')) = (completed_at IS NOT NULL)),
  ADD CONSTRAINT outbound_messages_canceled CHECK ((status = 'CANCELED') = (canceled_at IS NOT NULL));

ALTER TABLE outbound_message_recipients
  -- A client's or a lead's, never both and never neither.
  ADD CONSTRAINT outbound_recipients_contact CHECK (num_nonnulls(client_id, lead_id) = 1),
  ADD CONSTRAINT outbound_recipients_skipped CHECK ((status = 'SKIPPED') = (exclusion IS NOT NULL)),
  ADD CONSTRAINT outbound_recipients_times
    CHECK ((status IN ('SENT', 'DELIVERED', 'READ')) = (sent_at IS NOT NULL)
           AND (status IN ('DELIVERED', 'READ')) = (delivered_at IS NOT NULL)
           AND (status = 'READ') = (read_at IS NOT NULL)),
  ADD CONSTRAINT outbound_recipients_attempts CHECK (attempts >= 0),
  ADD CONSTRAINT outbound_recipients_error CHECK (last_error IS NULL OR last_error ~ '^[a-z0-9_.-]{1,64}$'),
  ADD CONSTRAINT outbound_recipients_provider_id
    CHECK (provider_message_id IS NULL OR (btrim(provider_message_id) <> '' AND char_length(provider_message_id) <= 200));
-- One row per recipient and channel in a message.
CREATE UNIQUE INDEX outbound_recipients_one_client ON outbound_message_recipients (outbound_message_id, client_id, channel) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX outbound_recipients_one_lead ON outbound_message_recipients (outbound_message_id, lead_id, channel) WHERE lead_id IS NOT NULL;

-- ---------- Rules ----------
CREATE FUNCTION outbound_messages_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  threshold integer;
  sent integer;
  failed integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT', 'SCHEDULED') THEN
      RAISE EXCEPTION 'outbound messages: a message starts as a draft or scheduled' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.kind <> OLD.kind
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'outbound messages: the kind and the author never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SENT', 'PARTIAL', 'FAILED', 'CANCELED')
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'outbound messages: a finished message is final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SENDING'
     AND (NEW.channel <> OLD.channel OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.body <> OLD.body
          OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
          OR NEW.audience_filters IS DISTINCT FROM OLD.audience_filters OR NEW.total_count IS DISTINCT FROM OLD.total_count
          OR NEW.can_receive_count IS DISTINCT FROM OLD.can_receive_count) THEN
    RAISE EXCEPTION 'outbound messages: a message that is sending no longer changes' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'SENDING', 'CANCELED'))
         OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'SENDING', 'CANCELED'))
         OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'PARTIAL', 'FAILED'))) THEN
      RAISE EXCEPTION 'outbound messages: a message cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'SENDING' AND NEW.kind = 'BULK' THEN
      SELECT s.bulk_confirm_threshold INTO threshold FROM message_settings s WHERE s.business_id = NEW.business_id;
      IF coalesce(NEW.total_count, 0) > coalesce(threshold, 100) AND NEW.high_volume_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'outbound messages: a bulk send above the firm''s threshold needs its confirmation first'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.status IN ('SENT', 'PARTIAL', 'FAILED') THEN
      SELECT count(*) FILTER (WHERE r.status IN ('SENT', 'DELIVERED', 'READ')),
             count(*) FILTER (WHERE r.status = 'FAILED')
        INTO sent, failed
        FROM outbound_message_recipients r WHERE r.business_id = NEW.business_id AND r.outbound_message_id = NEW.id;
      IF EXISTS (SELECT 1 FROM outbound_message_recipients r
                 WHERE r.business_id = NEW.business_id AND r.outbound_message_id = NEW.id AND r.status = 'QUEUED') THEN
        RAISE EXCEPTION 'outbound messages: it is not finished while a recipient is still queued' USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.status = 'SENT' AND failed > 0) OR (NEW.status = 'FAILED' AND sent > 0)
         OR (NEW.status = 'PARTIAL' AND (failed = 0 OR sent = 0)) THEN
        RAISE EXCEPTION 'outbound messages: the outcome must match the recipients'' (sent, partial or failed)'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER outbound_messages_rules
  BEFORE INSERT OR UPDATE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION outbound_messages_rules();

CREATE FUNCTION outbound_recipients_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent outbound_messages%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM outbound_messages m WHERE m.business_id = NEW.business_id AND m.id = NEW.outbound_message_id;
  IF TG_OP = 'INSERT' THEN
    IF parent.status NOT IN ('DRAFT', 'SCHEDULED') OR NEW.channel <> parent.channel
       OR NEW.status NOT IN ('QUEUED', 'SKIPPED') OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'outbound recipients: added while the message is a draft or scheduled, on its channel, queued or skipped'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.outbound_message_id <> OLD.outbound_message_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
       OR NEW.channel <> OLD.channel OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'outbound recipients: who and which message never change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.attempts < OLD.attempts THEN
      RAISE EXCEPTION 'outbound recipients: attempts only go up' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'QUEUED' AND NEW.status IN ('SENT', 'FAILED', 'SKIPPED'))
         OR (OLD.status = 'FAILED' AND NEW.status IN ('QUEUED', 'SKIPPED'))
         OR (OLD.status = 'SENT' AND NEW.status IN ('DELIVERED', 'READ'))
         OR (OLD.status = 'DELIVERED' AND NEW.status = 'READ')) THEN
      RAISE EXCEPTION 'outbound recipients: a recipient cannot go from % to % (never sent twice)', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
      RAISE EXCEPTION 'outbound recipients: the time it was sent is set once' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Bulk sends respect an opt-out on email and text, always.
  IF parent.kind = 'BULK' AND NEW.status IN ('QUEUED', 'SENT') AND NEW.channel IN ('EMAIL', 'SMS')
     AND EXISTS (SELECT 1 FROM contact_consents c
                 WHERE c.business_id = NEW.business_id AND c.status = 'OPTED_OUT' AND c.channel::text = NEW.channel::text
                   AND (c.client_id = NEW.client_id OR c.lead_id = NEW.lead_id)) THEN
    RAISE EXCEPTION 'outbound recipients: this contact opted out of this channel' USING ERRCODE = 'check_violation';
  END IF;
  -- A portal delivery links the conversation message it made, in this client's own thread.
  IF NEW.message_id IS NOT NULL AND NOT (NEW.channel = 'PORTAL' AND EXISTS (
       SELECT 1 FROM messages m JOIN message_threads t ON t.id = m.thread_id
        WHERE m.business_id = NEW.business_id AND m.id = NEW.message_id AND t.client_id = NEW.client_id)) THEN
    RAISE EXCEPTION 'outbound recipients: the message must be in this client''s own thread, on the portal'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER outbound_recipients_rules
  BEFORE INSERT OR UPDATE ON outbound_message_recipients
  FOR EACH ROW EXECUTE FUNCTION outbound_recipients_rules();


-- R36 part 2: attachments of an outbound message, the Client portal tab (module visibility, lock,
-- activity, recent clients) and Company Profile and Branding (settings columns, brand profile, brand
-- versions).

-- ---------- Grants and RLS: only the firm's own business scope ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_message_files, portal_module_visibility, client_portal_locks,
  portal_recent_clients TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON business_brand_profiles TO firmivra_app;
-- Insert-only: the activity feed and the published brand versions.
GRANT SELECT, INSERT ON client_portal_activity, business_brand_versions TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbound_message_files', 'portal_module_visibility', 'client_portal_locks',
    'client_portal_activity', 'portal_recent_clients', 'business_brand_profiles', 'business_brand_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE outbound_message_files
  ADD CONSTRAINT outbound_message_files_values
    CHECK (btrim(file_name) <> '' AND char_length(file_name) <= 200 AND size_bytes BETWEEN 1 AND 26214400
           AND content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' AND char_length(content_type) <= 100
           AND sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT outbound_message_files_key CHECK (s3_key LIKE 'tenant/' || business_id::text || '/messages/%'),
  ADD CONSTRAINT outbound_message_files_scan CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL));

-- The firm's default (no client) and a client's own override: one row per module in each.
CREATE UNIQUE INDEX portal_module_visibility_default ON portal_module_visibility (business_id, module) WHERE client_id IS NULL;
CREATE UNIQUE INDEX portal_module_visibility_client ON portal_module_visibility (business_id, client_id, module) WHERE client_id IS NOT NULL;

ALTER TABLE client_portal_locks ADD CONSTRAINT client_portal_locks_reason CHECK (char_length(reason) <= 200);

ALTER TABLE client_portal_activity
  ADD CONSTRAINT client_portal_activity_type CHECK (type ~ '^[a-z_]+(\.[a-z_]+)*$' AND char_length(type) <= 60),
  ADD CONSTRAINT client_portal_activity_entity
    CHECK ((entity_type IS NULL) = (entity_id IS NULL) AND (entity_type IS NULL OR entity_type ~ '^[a-z_]{1,40}$')),
  ADD CONSTRAINT client_portal_activity_actor CHECK ((actor_kind = 'STAFF') = (actor_user_id IS NOT NULL));

ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_secondary_color CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_settings_background_color CHECK (background_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_settings_brand_keys
    CHECK ((favicon_key IS NULL OR favicon_key LIKE 'tenant/' || business_id::text || '/%')
           AND (login_background_key IS NULL OR login_background_key LIKE 'tenant/' || business_id::text || '/%')),
  ADD CONSTRAINT business_settings_login_message CHECK (char_length(login_message) <= 200),
  ADD CONSTRAINT business_settings_support_email
    CHECK (support_email = lower(support_email) AND support_email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length(support_email) <= 254),
  ADD CONSTRAINT business_settings_industry CHECK (char_length(industry) <= 80),
  ADD CONSTRAINT business_settings_format
    CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$' AND currency ~ '^[a-z]{3}$' AND branding_version >= 1);

ALTER TABLE business_brand_profiles
  ADD CONSTRAINT business_brand_profiles_text
    CHECK (char_length(email_from_name) <= 100 AND char_length(email_header) <= 500
           AND char_length(email_footer) <= 1000 AND char_length(email_disclaimer) <= 1000
           AND char_length(letterhead_header) <= 500 AND char_length(letterhead_footer) <= 500
           AND char_length(document_footer) <= 1000 AND char_length(signature_block) <= 1000
           AND char_length(legal_text) <= 2000),
  ADD CONSTRAINT business_brand_profiles_colors
    CHECK (portal_brand_color ~ '^#[0-9A-Fa-f]{6}$' AND portal_accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_brand_profiles_keys
    CHECK ((email_logo_key IS NULL OR email_logo_key LIKE 'tenant/' || business_id::text || '/%')
           AND (portal_logo_key IS NULL OR portal_logo_key LIKE 'tenant/' || business_id::text || '/%')),
  ADD CONSTRAINT business_brand_profiles_reply_to
    CHECK (reply_to_email = lower(reply_to_email) AND reply_to_email ~ '^[^@[:space:]]+@[^@[:space:]]+$');

ALTER TABLE business_brand_versions
  ADD CONSTRAINT business_brand_versions_values
    CHECK (version >= 1 AND jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 32768);

-- ---------- Rules ----------
-- A file joins an outbound message only while it can still change, starts unscanned, is fixed, and
-- its scan result is set once.
CREATE FUNCTION outbound_message_files_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.outbound_message_id ELSE NEW.outbound_message_id END;
BEGIN
  IF TG_OP <> 'UPDATE' AND NOT EXISTS (SELECT 1 FROM outbound_messages m
                                       WHERE m.id = target AND m.status IN ('DRAFT', 'SCHEDULED')) THEN
    RAISE EXCEPTION 'outbound files: files change only while the message is a draft or scheduled'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'outbound files: a file starts unscanned' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['scan_status', 'scanned_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['scan_status', 'scanned_at'])
     OR (OLD.scan_status <> 'PENDING' AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at)) THEN
    RAISE EXCEPTION 'outbound files: the file is fixed and its scan result is set once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER outbound_message_files_rules
  BEFORE INSERT OR UPDATE OR DELETE ON outbound_message_files
  FOR EACH ROW EXECUTE FUNCTION outbound_message_files_rules();

-- An activity row's login belongs to its client.
CREATE FUNCTION client_portal_activity_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.client_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM client_accounts a WHERE a.business_id = NEW.business_id AND a.id = NEW.client_account_id
                                         AND a.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'portal activity: the login must belong to this client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_portal_activity_rules
  BEFORE INSERT ON client_portal_activity
  FOR EACH ROW EXECUTE FUNCTION client_portal_activity_rules();

-- Brand versions are numbered 1, 2, 3 per firm, in order.
CREATE FUNCTION business_brand_versions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM business_brand_versions v WHERE v.business_id = NEW.business_id) THEN
    RAISE EXCEPTION 'brand versions: the next version is the highest plus one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER business_brand_versions_rules
  BEFORE INSERT ON business_brand_versions
  FOR EACH ROW EXECUTE FUNCTION business_brand_versions_rules();
