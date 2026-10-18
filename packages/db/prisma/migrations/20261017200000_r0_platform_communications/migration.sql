-- r0_platform_communications (R0, Oct 18, Super Admin schema stage B6): Communications (spec 13).
-- Firmivra's own correspondence with firms' people, sales leads and the team, never a firm's
-- clients: conversations and messages with per-recipient delivery, mentions and read state,
-- template categories (the spec's six ship here) and templates, the image and attachment library,
-- audience segments, and broadcasts with per-channel content and per-recipient results. The
-- database keeps the send lifecycle (drafts and schedules are editable; once dispatch begins the
-- content never changes; only drafts are deleted; a broadcast needs a channel and an audience of
-- at least one) and checks each destination against its channel. Platform data: only the Super
-- Admin team and the platform's jobs reach it. Contract note:
-- docs/work/R0-stage-b6-communications.md.

-- CreateEnum
CREATE TYPE "CommChannel" AS ENUM ('EMAIL', 'SMS', 'INTERNAL', 'IN_APP');

-- CreateEnum
CREATE TYPE "CommContactType" AS ENUM ('FIRM', 'LEAD', 'TEAM');

-- CreateEnum
CREATE TYPE "CommConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CommMessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "CommRecipientKind" AS ENUM ('TO', 'CC', 'BCC');

-- CreateEnum
CREATE TYPE "CommDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CommTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommMediaKind" AS ENUM ('INLINE_IMAGE', 'ATTACHMENT');

-- CreateEnum
CREATE TYPE "CommBroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "comm_conversations" (
    "id" UUID NOT NULL,
    "contact_type" "CommContactType" NOT NULL,
    "linked_business_id" UUID,
    "contact_user_id" UUID,
    "sales_contact_id" UUID,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "subject" TEXT,
    "status" "CommConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_message_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "direction" "CommDirection" NOT NULL,
    "status" "CommMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "template_id" UUID,
    "broadcast_id" UUID,
    "retry_of_message_id" UUID,
    "idempotency_key" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "scheduled_time_zone" TEXT,
    "sender_user_id" UUID,
    "from_address" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_message_recipients" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "kind" "CommRecipientKind" NOT NULL DEFAULT 'TO',
    "contact_type" "CommContactType" NOT NULL,
    "linked_business_id" UUID,
    "contact_user_id" UUID,
    "sales_contact_id" UUID,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "CommDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_message_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_message_mentions" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_message_mentions_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateTable
CREATE TABLE "comm_conversation_reads" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_conversation_reads_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "comm_template_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "system_key" TEXT,
    "position" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_template_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_templates" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "status" "CommTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "merge_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_media" (
    "id" UUID NOT NULL,
    "kind" "CommMediaKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_media_links" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "usage" "CommMediaKind" NOT NULL,
    "template_id" UUID,
    "message_id" UUID,
    "broadcast_channel_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_media_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_segments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "last_count" INTEGER,
    "last_counted_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_broadcasts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CommBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "segment_id" UUID,
    "scheduled_at" TIMESTAMPTZ(3),
    "scheduled_time_zone" TEXT,
    "recipient_count" INTEGER,
    "idempotency_key" TEXT,
    "duplicated_from_id" UUID,
    "send_started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_broadcast_channels" (
    "id" UUID NOT NULL,
    "broadcast_id" UUID NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "CommBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comm_broadcast_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comm_broadcast_recipients" (
    "id" UUID NOT NULL,
    "broadcast_id" UUID NOT NULL,
    "channel" "CommChannel" NOT NULL,
    "contact_type" "CommContactType" NOT NULL,
    "linked_business_id" UUID,
    "contact_user_id" UUID,
    "sales_contact_id" UUID,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "CommDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "message_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comm_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comm_conversations_last_message_at_idx" ON "comm_conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "comm_conversations_assigned_to_user_id_status_idx" ON "comm_conversations"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "comm_conversations_linked_business_id_idx" ON "comm_conversations"("linked_business_id");

-- CreateIndex
CREATE INDEX "comm_conversations_sales_contact_id_idx" ON "comm_conversations"("sales_contact_id");

-- CreateIndex
CREATE INDEX "comm_conversations_contact_user_id_idx" ON "comm_conversations"("contact_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "comm_messages_idempotency_key_key" ON "comm_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "comm_messages_conversation_id_created_at_idx" ON "comm_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "comm_messages_status_scheduled_at_idx" ON "comm_messages"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "comm_messages_broadcast_id_idx" ON "comm_messages"("broadcast_id");

-- CreateIndex
CREATE INDEX "comm_message_recipients_status_idx" ON "comm_message_recipients"("status");

-- CreateIndex
CREATE INDEX "comm_message_recipients_provider_message_id_idx" ON "comm_message_recipients"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "comm_message_recipients_message_id_kind_address_key" ON "comm_message_recipients"("message_id", "kind", "address");

-- CreateIndex
CREATE INDEX "comm_message_mentions_user_id_created_at_idx" ON "comm_message_mentions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "comm_conversation_reads_user_id_idx" ON "comm_conversation_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "comm_template_categories_name_key" ON "comm_template_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "comm_template_categories_system_key_key" ON "comm_template_categories"("system_key");

-- CreateIndex
CREATE UNIQUE INDEX "comm_templates_name_key" ON "comm_templates"("name");

-- CreateIndex
CREATE INDEX "comm_templates_category_id_status_idx" ON "comm_templates"("category_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comm_media_s3_key_key" ON "comm_media"("s3_key");

-- CreateIndex
CREATE INDEX "comm_media_kind_created_at_idx" ON "comm_media"("kind", "created_at");

-- CreateIndex
CREATE INDEX "comm_media_links_media_id_idx" ON "comm_media_links"("media_id");

-- CreateIndex
CREATE INDEX "comm_media_links_template_id_idx" ON "comm_media_links"("template_id");

-- CreateIndex
CREATE INDEX "comm_media_links_message_id_idx" ON "comm_media_links"("message_id");

-- CreateIndex
CREATE INDEX "comm_media_links_broadcast_channel_id_idx" ON "comm_media_links"("broadcast_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "comm_segments_name_key" ON "comm_segments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "comm_broadcasts_idempotency_key_key" ON "comm_broadcasts"("idempotency_key");

-- CreateIndex
CREATE INDEX "comm_broadcasts_status_scheduled_at_idx" ON "comm_broadcasts"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "comm_broadcasts_created_at_idx" ON "comm_broadcasts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "comm_broadcast_channels_broadcast_id_channel_key" ON "comm_broadcast_channels"("broadcast_id", "channel");

-- CreateIndex
CREATE INDEX "comm_broadcast_recipients_broadcast_id_status_idx" ON "comm_broadcast_recipients"("broadcast_id", "status");

-- CreateIndex
CREATE INDEX "comm_broadcast_recipients_provider_message_id_idx" ON "comm_broadcast_recipients"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "comm_broadcast_recipients_broadcast_id_channel_address_key" ON "comm_broadcast_recipients"("broadcast_id", "channel", "address");

-- AddForeignKey
ALTER TABLE "comm_conversations" ADD CONSTRAINT "comm_conversations_linked_business_id_fkey" FOREIGN KEY ("linked_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_conversations" ADD CONSTRAINT "comm_conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "comm_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "comm_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "comm_broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_messages" ADD CONSTRAINT "comm_messages_retry_of_message_id_fkey" FOREIGN KEY ("retry_of_message_id") REFERENCES "comm_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_message_recipients" ADD CONSTRAINT "comm_message_recipients_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "comm_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_message_recipients" ADD CONSTRAINT "comm_message_recipients_linked_business_id_fkey" FOREIGN KEY ("linked_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_message_mentions" ADD CONSTRAINT "comm_message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "comm_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_message_mentions" ADD CONSTRAINT "comm_message_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_conversation_reads" ADD CONSTRAINT "comm_conversation_reads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "comm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_conversation_reads" ADD CONSTRAINT "comm_conversation_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_templates" ADD CONSTRAINT "comm_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "comm_template_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_media_links" ADD CONSTRAINT "comm_media_links_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "comm_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_media_links" ADD CONSTRAINT "comm_media_links_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "comm_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_media_links" ADD CONSTRAINT "comm_media_links_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "comm_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_media_links" ADD CONSTRAINT "comm_media_links_broadcast_channel_id_fkey" FOREIGN KEY ("broadcast_channel_id") REFERENCES "comm_broadcast_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_broadcasts" ADD CONSTRAINT "comm_broadcasts_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "comm_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_broadcasts" ADD CONSTRAINT "comm_broadcasts_duplicated_from_id_fkey" FOREIGN KEY ("duplicated_from_id") REFERENCES "comm_broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_broadcast_channels" ADD CONSTRAINT "comm_broadcast_channels_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "comm_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_broadcast_recipients" ADD CONSTRAINT "comm_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "comm_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comm_broadcast_recipients" ADD CONSTRAINT "comm_broadcast_recipients_linked_business_id_fkey" FOREIGN KEY ("linked_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Values ----------
CREATE FUNCTION comm_email_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT char_length(v) <= 254 AND v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' $$;

CREATE FUNCTION comm_phone_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v ~ '^\+[1-9][0-9]{7,14}$' $$;

-- Merge-field tokens as the API's central list writes them, e.g. firm.name, contact.first_name.
CREATE FUNCTION comm_tokens_ok(tokens text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(tokens) <= 100
               AND NOT EXISTS (SELECT 1 FROM unnest(tokens) t
                               WHERE t IS NULL OR t !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$') $$;

-- A conversation names its contact by type; destinations are well formed.
ALTER TABLE comm_conversations ADD CONSTRAINT comm_conversations_values
  CHECK (platform_text_ok(contact_name, 200)
         AND (contact_email IS NULL OR comm_email_ok(contact_email))
         AND (contact_phone IS NULL OR comm_phone_ok(contact_phone))
         AND (subject IS NULL OR platform_text_ok(subject, 300))
         AND cardinality(tags) <= 30 AND array_position(tags, NULL) IS NULL);

-- Email has a subject when it leaves draft; SMS stays within 1,600 characters; internal notes
-- are internal; the error comes with a failure; a schedule has its time zone.
ALTER TABLE comm_messages ADD CONSTRAINT comm_messages_values
  CHECK ((channel = 'INTERNAL') = (direction = 'INTERNAL')
         AND (subject IS NULL OR (channel = 'EMAIL' AND platform_text_ok(subject, 300)))
         AND (channel <> 'EMAIL' OR direction <> 'OUTBOUND' OR status IN ('DRAFT', 'CANCELLED') OR subject IS NOT NULL)
         AND char_length(body) <= 200000
         AND (channel <> 'SMS' OR char_length(body) <= 1600)
         AND (direction = 'INBOUND') = (status = 'RECEIVED')
         AND (status <> 'SCHEDULED' OR (scheduled_at IS NOT NULL AND app_valid_time_zone(scheduled_time_zone)))
         AND (scheduled_time_zone IS NULL OR scheduled_at IS NOT NULL)
         AND (status IN ('SENT', 'PARTIALLY_SENT', 'RECEIVED')) = (sent_at IS NOT NULL)
         AND (status = 'FAILED') = (failed_at IS NOT NULL)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$')
         AND (error_message IS NULL OR platform_text_ok(error_message, 1000))
         AND (from_address IS NULL OR char_length(from_address) <= 254)
         AND (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 200))
         AND (retry_of_message_id IS NULL OR retry_of_message_id <> id));

ALTER TABLE comm_message_recipients ADD CONSTRAINT comm_message_recipients_values
  CHECK (platform_text_ok(name, 200) AND char_length(address) <= 254
         AND (status IN ('SENT', 'DELIVERED', 'BOUNCED')) = (sent_at IS NOT NULL)
         AND (status = 'DELIVERED') = (delivered_at IS NOT NULL)
         AND (status IN ('FAILED', 'BOUNCED')) = (failed_at IS NOT NULL)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$'));

ALTER TABLE comm_template_categories ADD CONSTRAINT comm_template_categories_values
  CHECK (platform_text_ok(name, 60) AND position >= 0
         AND (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{0,59}$'));

-- Templates are email or SMS; email needs a subject, SMS has none and stays short.
ALTER TABLE comm_templates ADD CONSTRAINT comm_templates_values
  CHECK (platform_text_ok(name, 120) AND channel IN ('EMAIL', 'SMS')
         AND (channel = 'EMAIL') = (subject IS NOT NULL)
         AND (subject IS NULL OR platform_text_ok(subject, 300))
         AND btrim(body) <> '' AND char_length(body) <= 200000
         AND (channel <> 'SMS' OR char_length(body) <= 1600)
         AND comm_tokens_ok(merge_fields));

-- Library files live under the platform's communications prefix; inline images are web images;
-- at most 10 MB.
ALTER TABLE comm_media ADD CONSTRAINT comm_media_values
  CHECK (platform_text_ok(file_name, 255) AND file_name !~ '[/\\]'
         AND content_type ~ '^[a-z]+/[a-z0-9.+-]+$'
         AND (kind <> 'INLINE_IMAGE' OR content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp'))
         AND size_bytes BETWEEN 1 AND 10485760
         AND sha256 ~ '^[0-9a-f]{64}$'
         AND starts_with(s3_key, 'platform/communications/' || id || '/')
         AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE comm_media_links ADD CONSTRAINT comm_media_links_one_owner
  CHECK (num_nonnulls(template_id, message_id, broadcast_channel_id) = 1);

ALTER TABLE comm_segments ADD CONSTRAINT comm_segments_values
  CHECK (platform_text_ok(name, 120) AND (description IS NULL OR platform_text_ok(description, 1000))
         AND jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 16384
         AND (last_count IS NULL OR last_count >= 0) AND (last_count IS NULL) = (last_counted_at IS NULL));

ALTER TABLE comm_broadcasts ADD CONSTRAINT comm_broadcasts_values
  CHECK (platform_text_ok(name, 120)
         AND (status <> 'SCHEDULED' OR (scheduled_at IS NOT NULL AND app_valid_time_zone(scheduled_time_zone)))
         AND (scheduled_time_zone IS NULL OR scheduled_at IS NOT NULL)
         AND (status NOT IN ('SENDING', 'SENT', 'PARTIALLY_SENT') OR (segment_id IS NOT NULL AND recipient_count > 0))
         AND (recipient_count IS NULL OR recipient_count >= 0)
         AND (status IN ('DRAFT', 'SCHEDULED', 'CANCELLED')) = (send_started_at IS NULL)
         AND (status IN ('SENT', 'PARTIALLY_SENT', 'FAILED')) = (finished_at IS NOT NULL)
         AND (error_message IS NULL OR platform_text_ok(error_message, 1000))
         AND (archived_at IS NULL OR status IN ('SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED'))
         AND (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 200))
         AND (duplicated_from_id IS NULL OR duplicated_from_id <> id));

-- A broadcast channel is email, SMS or in-app; email needs its subject.
ALTER TABLE comm_broadcast_channels ADD CONSTRAINT comm_broadcast_channels_values
  CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP')
         AND (channel = 'EMAIL') = (subject IS NOT NULL)
         AND (subject IS NULL OR platform_text_ok(subject, 300))
         AND char_length(body) <= 200000 AND (channel <> 'SMS' OR char_length(body) <= 1600)
         AND status NOT IN ('SCHEDULED', 'CANCELLED')
         AND sent_count >= 0 AND failed_count >= 0);

ALTER TABLE comm_broadcast_recipients ADD CONSTRAINT comm_broadcast_recipients_values
  CHECK (channel IN ('EMAIL', 'SMS', 'IN_APP') AND platform_text_ok(name, 200) AND char_length(address) <= 254
         AND (status IN ('SENT', 'DELIVERED', 'BOUNCED')) = (sent_at IS NOT NULL)
         AND (status = 'DELIVERED') = (delivered_at IS NOT NULL)
         AND (status IN ('FAILED', 'BOUNCED')) = (failed_at IS NOT NULL)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_.]{0,59}$'));

-- ---------- The shipped template categories (spec 13, section 4) ----------
INSERT INTO comm_template_categories (id, name, system_key, position, updated_at) VALUES
  (gen_random_uuid(), 'Sales', 'sales', 0, now()),
  (gen_random_uuid(), 'Onboarding', 'onboarding', 1, now()),
  (gen_random_uuid(), 'Support', 'support', 2, now()),
  (gen_random_uuid(), 'Billing', 'billing', 3, now()),
  (gen_random_uuid(), 'Firm Applications', 'firm_applications', 4, now()),
  (gen_random_uuid(), 'System Notices', 'system_notices', 5, now());

-- ---------- Rules ----------
-- A conversation names its contact by its type when it starts (the links may later be cleared,
-- when that firm or lead is deleted, never repointed). Only the messages trigger moves
-- last_message_at.
CREATE FUNCTION comm_conversations_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.contact_type = 'FIRM' AND NEW.linked_business_id IS NULL)
       OR (NEW.contact_type = 'LEAD' AND NEW.sales_contact_id IS NULL)
       OR (NEW.contact_type = 'TEAM' AND NEW.contact_user_id IS NULL) THEN
      RAISE EXCEPTION 'communications: a % conversation names its contact', NEW.contact_type
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.last_message_at := NULL;
  ELSE
    IF (NEW.id, NEW.contact_type, NEW.contact_user_id, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.contact_type, OLD.contact_user_id, OLD.created_at, OLD.created_by_user_id)
       OR (NEW.linked_business_id IS DISTINCT FROM OLD.linked_business_id AND NEW.linked_business_id IS NOT NULL)
       OR (NEW.sales_contact_id IS DISTINCT FROM OLD.sales_contact_id AND NEW.sales_contact_id IS NOT NULL) THEN
      RAISE EXCEPTION 'communications: a conversation keeps its contact' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.last_message_at IS DISTINCT FROM OLD.last_message_at
       AND coalesce(current_setting('app.comm_touch', true), '') <> 'on' THEN
      RAISE EXCEPTION 'communications: the database keeps a conversation''s last message time'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_conversations_rules BEFORE INSERT OR UPDATE ON comm_conversations
  FOR EACH ROW EXECUTE FUNCTION comm_conversations_rules();

-- Messages. Outbound: DRAFT -> SCHEDULED (and back) -> SENDING -> SENT, PARTIALLY_SENT or FAILED,
-- and SCHEDULED -> CANCELLED. Internal notes are SENT when written; inbound mail and SMS are
-- RECEIVED. The content changes only while DRAFT or SCHEDULED; a final message never changes (a
-- retry is a new message naming the failed one). Only drafts are deleted. The database stamps the
-- sender (the signed-in team member) and the sent and failed times.
CREATE FUNCTION comm_messages_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'communications: only a draft message is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT ((NEW.direction = 'OUTBOUND' AND NEW.status IN ('DRAFT', 'SCHEDULED', 'SENDING'))
            OR (NEW.direction = 'INTERNAL' AND NEW.status = 'SENT')
            OR (NEW.direction = 'INBOUND' AND NEW.status = 'RECEIVED')) THEN
      RAISE EXCEPTION 'communications: a new % message cannot start %', NEW.direction, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'SCHEDULED' AND NEW.scheduled_at < now() - interval '1 minute' THEN
      RAISE EXCEPTION 'communications: a message is scheduled for the future' USING ERRCODE = 'check_violation';
    END IF;
    NEW.sender_user_id := CASE WHEN NEW.direction = 'INBOUND' THEN NULL ELSE app_current_admin_id() END;
    NEW.sent_at := CASE WHEN NEW.status IN ('SENT', 'RECEIVED') THEN now() END;
    NEW.failed_at := NULL;
    NEW.error_code := NULL;
    NEW.error_message := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.conversation_id, NEW.channel, NEW.direction, NEW.sender_user_id, NEW.broadcast_id,
      NEW.retry_of_message_id, NEW.idempotency_key, NEW.from_address, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.conversation_id, OLD.channel, OLD.direction, OLD.sender_user_id, OLD.broadcast_id,
      OLD.retry_of_message_id, OLD.idempotency_key, OLD.from_address, OLD.created_at)
     AND NOT (NEW.broadcast_id IS NULL AND OLD.broadcast_id IS NOT NULL
              AND (NEW.id, NEW.conversation_id, NEW.channel, NEW.direction, NEW.sender_user_id,
                   NEW.retry_of_message_id, NEW.idempotency_key, NEW.from_address, NEW.created_at)
                  IS NOT DISTINCT FROM
                  (OLD.id, OLD.conversation_id, OLD.channel, OLD.direction, OLD.sender_user_id,
                   OLD.retry_of_message_id, OLD.idempotency_key, OLD.from_address, OLD.created_at)) THEN
    RAISE EXCEPTION 'communications: a message keeps its thread, channel, sender and origin'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.subject, NEW.body, NEW.template_id, NEW.scheduled_at, NEW.scheduled_time_zone)
         IS DISTINCT FROM (OLD.subject, OLD.body, OLD.template_id, OLD.scheduled_at, OLD.scheduled_time_zone)
     AND NOT (NEW.template_id IS NULL AND OLD.template_id IS NOT NULL
              AND (NEW.subject, NEW.body, NEW.scheduled_at, NEW.scheduled_time_zone)
                  IS NOT DISTINCT FROM (OLD.subject, OLD.body, OLD.scheduled_at, OLD.scheduled_time_zone)) THEN
    RAISE EXCEPTION 'communications: a % message never changes', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.sent_at := OLD.sent_at;
  NEW.failed_at := OLD.failed_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'SENDING'))
            OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'SENDING', 'CANCELLED'))
            OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'PARTIALLY_SENT', 'FAILED'))) THEN
      RAISE EXCEPTION 'communications: a % message cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('SENT', 'PARTIALLY_SENT') THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'FAILED' THEN NEW.failed_at := now(); END IF;
  END IF;
  IF (NEW.error_code, NEW.error_message) IS DISTINCT FROM (OLD.error_code, OLD.error_message)
     AND NOT (OLD.status = 'SENDING' AND NEW.status IN ('PARTIALLY_SENT', 'FAILED')) THEN
    RAISE EXCEPTION 'communications: an error comes with a failed or partial send' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'SCHEDULED' AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.scheduled_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'communications: a message is scheduled for the future' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_messages_rules BEFORE INSERT OR UPDATE OR DELETE ON comm_messages
  FOR EACH ROW EXECUTE FUNCTION comm_messages_rules();

-- A sent, received or internal message moves its conversation's last message time.
CREATE FUNCTION comm_messages_touch() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.sent_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.sent_at IS NULL) THEN
    PERFORM set_config('app.comm_touch', 'on', true);
    UPDATE comm_conversations SET last_message_at = greatest(coalesce(last_message_at, NEW.sent_at), NEW.sent_at)
    WHERE id = NEW.conversation_id;
    PERFORM set_config('app.comm_touch', '', true);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER comm_messages_touch AFTER INSERT OR UPDATE ON comm_messages
  FOR EACH ROW EXECUTE FUNCTION comm_messages_touch();

-- A delivery result moves forward once: PENDING -> SENT, FAILED or SKIPPED; SENT -> DELIVERED or
-- BOUNCED. A broadcast retry may put a FAILED recipient back to PENDING while the broadcast sends.
-- The database stamps the times.
CREATE FUNCTION comm_delivery_step_ok(old_status "CommDeliveryStatus", new_status "CommDeliveryStatus",
                                      retrying boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT (old_status = 'PENDING' AND new_status IN ('SENT', 'FAILED', 'SKIPPED'))
               OR (old_status = 'SENT' AND new_status IN ('DELIVERED', 'BOUNCED'))
               OR (retrying AND old_status = 'FAILED' AND new_status = 'PENDING') $$;

-- A destination fits its channel: an email address for email (CC and BCC are email only), an
-- E.164 phone number for SMS, a team member for internal and in-app.
CREATE FUNCTION comm_destination_ok(ch "CommChannel", kind "CommRecipientKind", contact "CommContactType",
                                    business uuid, contact_user uuid, lead uuid, address text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT (kind = 'TO' OR ch = 'EMAIL')
               AND CASE ch WHEN 'EMAIL' THEN comm_email_ok(address)
                           WHEN 'SMS' THEN comm_phone_ok(address)
                           ELSE contact_user IS NOT NULL END
               AND CASE contact WHEN 'FIRM' THEN business IS NOT NULL
                                WHEN 'LEAD' THEN lead IS NOT NULL
                                ELSE contact_user IS NOT NULL END $$;

-- Message recipients: added, changed and removed only while the message is a draft or scheduled;
-- then only the delivery result moves.
CREATE FUNCTION comm_message_recipients_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  msg record;
BEGIN
  SELECT status, channel, direction INTO msg FROM comm_messages
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  IF TG_OP = 'DELETE' THEN
    IF FOUND AND msg.status NOT IN ('DRAFT', 'SCHEDULED') THEN
      RAISE EXCEPTION 'communications: a sent message keeps its recipients' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (msg.status IN ('DRAFT', 'SCHEDULED') OR msg.direction IN ('INBOUND', 'INTERNAL')) THEN
      RAISE EXCEPTION 'communications: recipients are added before the message is sent' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT comm_destination_ok(msg.channel, NEW.kind, NEW.contact_type, NEW.linked_business_id,
                               NEW.contact_user_id, NEW.sales_contact_id, NEW.address) THEN
      RAISE EXCEPTION 'communications: the recipient has no valid % destination', msg.channel
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' AND msg.direction = 'OUTBOUND' THEN
      RAISE EXCEPTION 'communications: a recipient starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    NEW.sent_at := CASE WHEN NEW.status IN ('SENT', 'DELIVERED', 'BOUNCED') THEN now() END;
    NEW.delivered_at := CASE WHEN NEW.status = 'DELIVERED' THEN now() END;
    NEW.failed_at := CASE WHEN NEW.status IN ('FAILED', 'BOUNCED') THEN now() END;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.message_id, NEW.kind, NEW.contact_type, NEW.contact_user_id, NEW.name, NEW.address, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.message_id, OLD.kind, OLD.contact_type, OLD.contact_user_id, OLD.name, OLD.address, OLD.created_at)
     OR (NEW.linked_business_id IS DISTINCT FROM OLD.linked_business_id AND NEW.linked_business_id IS NOT NULL)
     OR (NEW.sales_contact_id IS DISTINCT FROM OLD.sales_contact_id AND NEW.sales_contact_id IS NOT NULL) THEN
    IF msg.status NOT IN ('DRAFT', 'SCHEDULED') THEN
      RAISE EXCEPTION 'communications: a sent message keeps its recipients' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT comm_destination_ok(msg.channel, NEW.kind, NEW.contact_type, NEW.linked_business_id,
                               NEW.contact_user_id, NEW.sales_contact_id, NEW.address) THEN
      RAISE EXCEPTION 'communications: the recipient has no valid % destination', msg.channel
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.sent_at := OLD.sent_at;
  NEW.delivered_at := OLD.delivered_at;
  NEW.failed_at := OLD.failed_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT comm_delivery_step_ok(OLD.status, NEW.status, false) THEN
      RAISE EXCEPTION 'communications: a % recipient cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'SENT' THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'DELIVERED' THEN NEW.delivered_at := now(); END IF;
    IF NEW.status IN ('FAILED', 'BOUNCED') THEN NEW.failed_at := now(); END IF;
  ELSIF (NEW.provider_message_id, NEW.error_code) IS DISTINCT FROM (OLD.provider_message_id, OLD.error_code) THEN
    RAISE EXCEPTION 'communications: the provider id and error come with a delivery step'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_message_recipients_rules BEFORE INSERT OR UPDATE OR DELETE ON comm_message_recipients
  FOR EACH ROW EXECUTE FUNCTION comm_message_recipients_rules();

-- Template categories: the shipped keys are the migration's alone.
CREATE FUNCTION comm_template_categories_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.system_key IS NOT NULL THEN
      RAISE EXCEPTION 'communications: only the migration ships a category with a system key'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
  ELSIF (NEW.id, NEW.system_key, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.system_key, OLD.created_at) THEN
    RAISE EXCEPTION 'communications: a category keeps its key' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_template_categories_rules BEFORE INSERT OR UPDATE ON comm_template_categories
  FOR EACH ROW EXECUTE FUNCTION comm_template_categories_rules();

-- Templates: the database stamps who created and last changed one.
CREATE FUNCTION comm_templates_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSIF (NEW.id, NEW.created_at, NEW.created_by_user_id)
        IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'communications: a template keeps its creation' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by_user_id := app_current_admin_id();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_templates_rules BEFORE INSERT OR UPDATE ON comm_templates
  FOR EACH ROW EXECUTE FUNCTION comm_templates_rules();

-- Library files: the upload never changes; the scanner (platform scope) records its result once.
CREATE FUNCTION comm_media_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'communications: a new file waits for its scan' USING ERRCODE = 'check_violation';
    END IF;
    NEW.scanned_at := NULL;
    NEW.uploaded_by_user_id := app_current_admin_id();
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.kind, NEW.file_name, NEW.content_type, NEW.size_bytes, NEW.sha256, NEW.s3_key,
      NEW.uploaded_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.kind, OLD.file_name, OLD.content_type, OLD.size_bytes, OLD.sha256, OLD.s3_key,
      OLD.uploaded_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'communications: an uploaded file never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.scan_status IS DISTINCT FROM OLD.scan_status THEN
    IF OLD.scan_status <> 'PENDING' OR coalesce(app_scope(), '') <> 'platform' THEN
      RAISE EXCEPTION 'communications: only the scanner records a scan, once' USING ERRCODE = 'check_violation';
    END IF;
    NEW.scanned_at := now();
  ELSE
    NEW.scanned_at := OLD.scanned_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_media_rules BEFORE INSERT OR UPDATE ON comm_media
  FOR EACH ROW EXECUTE FUNCTION comm_media_rules();

-- A file is attached or placed inline only while its message or broadcast is editable, as the
-- kind it was uploaded as, and never once a scan found it unsafe.
CREATE FUNCTION comm_media_links_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  r comm_media_links%ROWTYPE;
  owner_status text;
  m record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF r.message_id IS NOT NULL THEN
    SELECT status::text INTO owner_status FROM comm_messages WHERE id = r.message_id;
  ELSIF r.broadcast_channel_id IS NOT NULL THEN
    SELECT b.status::text INTO owner_status FROM comm_broadcast_channels c
    JOIN comm_broadcasts b ON b.id = c.broadcast_id WHERE c.id = r.broadcast_channel_id;
  END IF;
  IF owner_status IS NOT NULL AND owner_status NOT IN ('DRAFT', 'SCHEDULED') THEN
    RAISE EXCEPTION 'communications: a sent message or broadcast keeps its files' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  SELECT kind, scan_status INTO m FROM comm_media WHERE id = NEW.media_id;
  IF m.kind IS DISTINCT FROM NEW.usage OR m.scan_status IN ('INFECTED', 'FAILED') THEN
    RAISE EXCEPTION 'communications: the file is used as uploaded, and only if it is safe'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_media_links_rules BEFORE INSERT OR DELETE ON comm_media_links
  FOR EACH ROW EXECUTE FUNCTION comm_media_links_rules();

CREATE FUNCTION comm_segments_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSIF (NEW.id, NEW.created_at, NEW.created_by_user_id)
        IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
    RAISE EXCEPTION 'communications: a segment keeps its creation' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_count IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.last_count IS DISTINCT FROM OLD.last_count) THEN
    NEW.last_counted_at := now();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.last_counted_at := OLD.last_counted_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_segments_rules BEFORE INSERT OR UPDATE ON comm_segments
  FOR EACH ROW EXECUTE FUNCTION comm_segments_rules();

-- Broadcasts: DRAFT -> SCHEDULED (and back) -> SENDING -> SENT, PARTIALLY_SENT or FAILED;
-- SCHEDULED -> CANCELLED; FAILED -> SENDING (a retry: the first attempt's results stay). A send
-- needs a channel and an audience of at least one. The name, audience and schedule change only
-- while DRAFT or SCHEDULED; a finished broadcast is archived, never deleted (only drafts are).
CREATE FUNCTION comm_broadcasts_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'communications: only a draft broadcast is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'communications: a broadcast starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    NEW.send_started_at := NULL;
    NEW.finished_at := NULL;
    NEW.archived_at := NULL;
    NEW.error_message := NULL;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
    NEW.updated_by_user_id := app_current_admin_id();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.idempotency_key, NEW.created_at, NEW.created_by_user_id)
     IS DISTINCT FROM (OLD.id, OLD.idempotency_key, OLD.created_at, OLD.created_by_user_id)
     OR (NEW.duplicated_from_id IS DISTINCT FROM OLD.duplicated_from_id AND NEW.duplicated_from_id IS NOT NULL) THEN
    RAISE EXCEPTION 'communications: a broadcast keeps its origin' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.name, NEW.segment_id, NEW.scheduled_at, NEW.scheduled_time_zone, NEW.recipient_count)
         IS DISTINCT FROM (OLD.name, OLD.segment_id, OLD.scheduled_at, OLD.scheduled_time_zone, OLD.recipient_count) THEN
    RAISE EXCEPTION 'communications: a % broadcast is not edited', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.send_started_at := OLD.send_started_at;
  NEW.finished_at := OLD.finished_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'SENDING'))
            OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'SENDING', 'CANCELLED'))
            OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'PARTIALLY_SENT', 'FAILED'))
            OR (OLD.status = 'FAILED' AND NEW.status = 'SENDING')) THEN
      RAISE EXCEPTION 'communications: a % broadcast cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'SENDING' THEN
      PERFORM 1 FROM comm_broadcast_channels WHERE broadcast_id = NEW.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'communications: a broadcast sends on at least one channel' USING ERRCODE = 'check_violation';
      END IF;
      NEW.send_started_at := now();
      NEW.finished_at := NULL;
      NEW.error_message := NULL;
    ELSIF NEW.status IN ('SENT', 'PARTIALLY_SENT', 'FAILED') THEN
      NEW.finished_at := now();
    END IF;
  ELSIF NEW.error_message IS DISTINCT FROM OLD.error_message THEN
    RAISE EXCEPTION 'communications: an error comes with the send result' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NULL THEN
      RAISE EXCEPTION 'communications: a broadcast is archived once' USING ERRCODE = 'check_violation';
    END IF;
    NEW.archived_at := now();
  END IF;
  IF NEW.status = 'SCHEDULED' AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.scheduled_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'communications: a broadcast is scheduled for the future' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_by_user_id := coalesce(app_current_admin_id(), OLD.updated_by_user_id);
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_broadcasts_rules BEFORE INSERT OR UPDATE OR DELETE ON comm_broadcasts
  FOR EACH ROW EXECUTE FUNCTION comm_broadcasts_rules();

-- A broadcast's channels: content added, changed and removed only while the broadcast is editable;
-- then only the dispatcher's status and counts move (DRAFT -> SENDING -> SENT, PARTIALLY_SENT or
-- FAILED; FAILED -> SENDING on a retry).
CREATE FUNCTION comm_broadcast_channels_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  b_status "CommBroadcastStatus";
BEGIN
  SELECT status INTO b_status FROM comm_broadcasts
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.broadcast_id ELSE NEW.broadcast_id END;
  IF TG_OP = 'DELETE' THEN
    IF b_status IS NOT NULL AND b_status NOT IN ('DRAFT', 'SCHEDULED') THEN
      RAISE EXCEPTION 'communications: a sent broadcast keeps its channels' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF b_status NOT IN ('DRAFT', 'SCHEDULED') OR NEW.status <> 'DRAFT' OR NEW.sent_count <> 0 OR NEW.failed_count <> 0 THEN
      RAISE EXCEPTION 'communications: a channel is added to a draft or scheduled broadcast, as a draft'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.broadcast_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.broadcast_id, OLD.created_at)
     OR ((NEW.channel, NEW.subject, NEW.body) IS DISTINCT FROM (OLD.channel, OLD.subject, OLD.body)
         AND b_status NOT IN ('DRAFT', 'SCHEDULED')) THEN
    RAISE EXCEPTION 'communications: a sent broadcast''s content never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SENDING')
              OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'PARTIALLY_SENT', 'FAILED'))
              OR (OLD.status = 'FAILED' AND NEW.status = 'SENDING')) THEN
    RAISE EXCEPTION 'communications: a % channel cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_broadcast_channels_rules BEFORE INSERT OR UPDATE OR DELETE ON comm_broadcast_channels
  FOR EACH ROW EXECUTE FUNCTION comm_broadcast_channels_rules();

-- A broadcast's recipients are resolved when it sends, on one of its channels; then only the
-- delivery result moves (a retry may put a failed one back to PENDING), and the copy kept in the
-- recipient's conversation is linked once.
CREATE FUNCTION comm_broadcast_recipients_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  b_status "CommBroadcastStatus";
BEGIN
  SELECT status INTO b_status FROM comm_broadcasts WHERE id = NEW.broadcast_id;
  IF TG_OP = 'INSERT' THEN
    IF b_status <> 'SENDING' THEN
      RAISE EXCEPTION 'communications: recipients are resolved when the broadcast sends'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM comm_broadcast_channels WHERE broadcast_id = NEW.broadcast_id AND channel = NEW.channel;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'communications: the broadcast does not send on %', NEW.channel USING ERRCODE = 'check_violation';
    END IF;
    IF NOT comm_destination_ok(NEW.channel, 'TO', NEW.contact_type, NEW.linked_business_id,
                               NEW.contact_user_id, NEW.sales_contact_id, NEW.address)
       OR NEW.status <> 'PENDING' OR NEW.message_id IS NOT NULL THEN
      RAISE EXCEPTION 'communications: a broadcast recipient starts PENDING with a valid % destination', NEW.channel
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.sent_at := NULL;
    NEW.delivered_at := NULL;
    NEW.failed_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.broadcast_id, NEW.channel, NEW.contact_type, NEW.contact_user_id, NEW.name, NEW.address, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.broadcast_id, OLD.channel, OLD.contact_type, OLD.contact_user_id, OLD.name, OLD.address, OLD.created_at)
     OR (NEW.linked_business_id IS DISTINCT FROM OLD.linked_business_id AND NEW.linked_business_id IS NOT NULL)
     OR (NEW.sales_contact_id IS DISTINCT FROM OLD.sales_contact_id AND NEW.sales_contact_id IS NOT NULL)
     OR (NEW.message_id IS DISTINCT FROM OLD.message_id AND OLD.message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'communications: a broadcast recipient never changes; only its result moves'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.sent_at := OLD.sent_at;
  NEW.delivered_at := OLD.delivered_at;
  NEW.failed_at := OLD.failed_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT comm_delivery_step_ok(OLD.status, NEW.status, b_status = 'SENDING') THEN
      RAISE EXCEPTION 'communications: a % recipient cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PENDING' THEN
      NEW.failed_at := NULL;
      NEW.error_code := NULL;
    END IF;
    IF NEW.status = 'SENT' THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'DELIVERED' THEN NEW.delivered_at := now(); END IF;
    IF NEW.status IN ('FAILED', 'BOUNCED') THEN NEW.failed_at := now(); END IF;
  ELSIF (NEW.provider_message_id, NEW.error_code) IS DISTINCT FROM (OLD.provider_message_id, OLD.error_code) THEN
    RAISE EXCEPTION 'communications: the provider id and error come with a delivery step'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_broadcast_recipients_rules BEFORE INSERT OR UPDATE ON comm_broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION comm_broadcast_recipients_rules();

-- Read state: a team member marks their own conversations read, now.
CREATE FUNCTION comm_conversation_reads_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.conversation_id, NEW.user_id) IS DISTINCT FROM (OLD.conversation_id, OLD.user_id) THEN
    RAISE EXCEPTION 'communications: a read mark stays on its conversation' USING ERRCODE = 'check_violation';
  END IF;
  NEW.last_read_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER comm_conversation_reads_rules BEFORE INSERT OR UPDATE ON comm_conversation_reads
  FOR EACH ROW EXECUTE FUNCTION comm_conversation_reads_rules();

-- ---------- Grants ----------
-- Conversations, templates, categories, files and segments are kept (close, archive or deactivate
-- instead); only drafts of messages and broadcasts are deleted (their triggers check); mentions are
-- insert-only.
GRANT SELECT, INSERT, UPDATE ON comm_conversations, comm_templates, comm_template_categories,
  comm_media, comm_segments, comm_broadcast_recipients, comm_conversation_reads TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON comm_messages, comm_message_recipients, comm_broadcasts,
  comm_broadcast_channels TO firmivra_app;
GRANT SELECT, INSERT ON comm_message_mentions TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON comm_media_links TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comm_conversations', 'comm_messages', 'comm_message_recipients',
    'comm_message_mentions', 'comm_conversation_reads', 'comm_template_categories', 'comm_templates',
    'comm_media', 'comm_media_links', 'comm_segments', 'comm_broadcasts', 'comm_broadcast_channels',
    'comm_broadcast_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's jobs (the dispatcher, inbound mail and
-- SMS, the scanner: platform scope). Which team member may send, broadcast or manage templates is
-- the API's check (communications.* keys). No firm scope reaches any table.
CREATE FUNCTION app_is_comm_team() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comm_conversations', 'comm_messages', 'comm_message_recipients',
    'comm_message_mentions', 'comm_template_categories', 'comm_templates', 'comm_media',
    'comm_media_links', 'comm_segments', 'comm_broadcasts', 'comm_broadcast_channels',
    'comm_broadcast_recipients'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_comm_team()) '
                   'WITH CHECK (app_is_comm_team())', t || '_team', t);
  END LOOP;
END
$$;

-- Read state is each team member's own.
CREATE POLICY comm_conversation_reads_own ON comm_conversation_reads FOR ALL
  USING (user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()))
  WITH CHECK (user_id = app_current_admin_id() AND (app_is_admin() OR app_is_platform_member()));
