-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunicationSourceKind" AS ENUM ('DUPLICATE', 'RESEND_FAILED', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "AudienceEntryKind" AS ENUM ('SEGMENT', 'CLIENT', 'LEAD', 'EXCLUDE_CLIENT', 'EXCLUDE_LEAD');

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "preview_text" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "from_name" TEXT,
    "reply_to" TEXT,
    "connection_id" UUID,
    "template_id" UUID,
    "template_version" INTEGER,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "scheduled_for" TIMESTAMPTZ(3),
    "timezone" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "idempotency_key" TEXT,
    "source_communication_id" UUID,
    "source_kind" "CommunicationSourceKind",
    "selected_count" INTEGER,
    "auto_excluded_count" INTEGER,
    "manual_excluded_count" INTEGER,
    "final_count" INTEGER,
    "exclusion_counts" JSONB NOT NULL DEFAULT '{}',
    "publish_starts_at" TIMESTAMPTZ(3),
    "publish_ends_at" TIMESTAMPTZ(3),
    "visibility" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_audience_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "kind" "AudienceEntryKind" NOT NULL,
    "segment_id" UUID,
    "client_id" UUID,
    "lead_id" UUID,
    "segment_name" TEXT,
    "criteria_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_audience_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communications_business_id_status_scheduled_for_idx" ON "communications"("business_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "communications_business_id_channel_created_at_idx" ON "communications"("business_id", "channel", "created_at");

-- CreateIndex
CREATE INDEX "communications_business_id_archived_at_idx" ON "communications"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "communications_business_id_id_key" ON "communications"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "communications_business_id_idempotency_key_key" ON "communications"("business_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "communication_audience_entries_business_id_segment_id_idx" ON "communication_audience_entries"("business_id", "segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_audience_entries_communication_id_kind_segmen_key" ON "communication_audience_entries"("communication_id", "kind", "segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_audience_entries_communication_id_kind_client_key" ON "communication_audience_entries"("communication_id", "kind", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_audience_entries_communication_id_kind_lead_i_key" ON "communication_audience_entries"("communication_id", "kind", "lead_id");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "message_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "integration_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_business_id_source_communication_id_fkey" FOREIGN KEY ("business_id", "source_communication_id") REFERENCES "communications"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_audience_entries" ADD CONSTRAINT "communication_audience_entries_business_id_communication_i_fkey" FOREIGN KEY ("business_id", "communication_id") REFERENCES "communications"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_audience_entries" ADD CONSTRAINT "communication_audience_entries_business_id_segment_id_fkey" FOREIGN KEY ("business_id", "segment_id") REFERENCES "communication_segments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_audience_entries" ADD CONSTRAINT "communication_audience_entries_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_audience_entries" ADD CONSTRAINT "communication_audience_entries_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: a campaign is never deleted. Its audience entries change only while it is editable.
GRANT SELECT, INSERT, UPDATE ON communications TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_audience_entries TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['communications', 'communication_audience_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE communications ADD CONSTRAINT communications_values
  CHECK (esign_text_ok(name, 200)
         AND (subject IS NULL OR esign_text_ok(subject, 300))
         AND (preview_text IS NULL OR esign_text_ok(preview_text, 200))
         AND (body = '' OR esign_text_ok(body, 50000))
         AND (from_name IS NULL OR esign_text_ok(from_name, 120))
         AND (reply_to IS NULL OR (reply_to ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length(reply_to) <= 254))
         AND (timezone IS NULL OR timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$')
         AND (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$')
         AND (visibility IS NULL OR esign_text_ok(visibility, 80))
         AND jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 10
         AND jsonb_typeof(exclusion_counts) = 'object'
         AND (template_id IS NULL) = (template_version IS NULL)
         AND (source_communication_id IS NULL) = (source_kind IS NULL)
         AND coalesce(selected_count, 0) >= 0 AND coalesce(final_count, 0) >= 0
         AND coalesce(auto_excluded_count, 0) >= 0 AND coalesce(manual_excluded_count, 0) >= 0);

-- What each channel carries. A text has no subject or reply-to; only an announcement has a window.
ALTER TABLE communications ADD CONSTRAINT communications_channel
  CHECK ((channel <> 'SMS' OR (subject IS NULL AND preview_text IS NULL AND reply_to IS NULL))
         AND (channel = 'ANNOUNCEMENT' OR (publish_starts_at IS NULL AND publish_ends_at IS NULL AND visibility IS NULL))
         AND (publish_ends_at IS NULL OR publish_starts_at IS NULL OR publish_ends_at > publish_starts_at));

-- What each status needs. The audience counts add up: selected = left out by the system + by hand + final.
ALTER TABLE communications ADD CONSTRAINT communications_status
  CHECK ((status <> 'SCHEDULED' OR (scheduled_for IS NOT NULL AND timezone IS NOT NULL))
         AND (status IN ('DRAFT', 'SCHEDULED', 'CANCELLED')
              OR (final_count IS NOT NULL AND started_at IS NOT NULL AND body <> ''
                  AND (channel <> 'EMAIL' OR subject IS NOT NULL)))
         AND (status <> 'SENT' OR sent_at IS NOT NULL)
         AND (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
         AND (num_nulls(selected_count, auto_excluded_count, manual_excluded_count, final_count) IN (0, 4))
         AND (selected_count IS NULL
              OR selected_count = auto_excluded_count + manual_excluded_count + final_count));

ALTER TABLE communication_audience_entries ADD CONSTRAINT communication_audience_entries_kind
  CHECK ((kind = 'SEGMENT' AND num_nonnulls(segment_id) = 1 AND num_nonnulls(client_id, lead_id) = 0)
         OR (kind IN ('CLIENT', 'EXCLUDE_CLIENT') AND client_id IS NOT NULL AND num_nonnulls(segment_id, lead_id) = 0)
         OR (kind IN ('LEAD', 'EXCLUDE_LEAD') AND lead_id IS NOT NULL AND num_nonnulls(segment_id, client_id) = 0));

-- A campaign moves forward only, and once it is out its content is a record: only its name,
-- archive flag, the send progress and the final facts change.
CREATE FUNCTION communications_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  frozen text[] := ARRAY['channel', 'subject', 'preview_text', 'body', 'from_name', 'reply_to',
    'connection_id', 'template_id', 'template_version', 'attachments', 'idempotency_key',
    'source_communication_id', 'source_kind', 'selected_count', 'auto_excluded_count',
    'manual_excluded_count', 'final_count', 'exclusion_counts', 'publish_starts_at',
    'publish_ends_at', 'visibility', 'created_by_user_id'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'SENDING', 'CANCELLED'))
    OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'SENDING', 'CANCELLED'))
    OR (OLD.status = 'SENDING' AND NEW.status IN ('SENT', 'PAUSED', 'FAILED', 'CANCELLED'))
    OR (OLD.status = 'PAUSED' AND NEW.status IN ('SENDING', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'COMMUNICATION_STATUS: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (SELECT jsonb_object_agg(k, to_jsonb(NEW) -> k) FROM unnest(frozen) AS k)
         IS DISTINCT FROM (SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k) FROM unnest(frozen) AS k) THEN
    RAISE EXCEPTION 'COMMUNICATION_SENT: the content of a campaign that went out does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER communications_rules BEFORE UPDATE ON communications
  FOR EACH ROW EXECUTE FUNCTION communications_rules();

-- The audience is picked only while the campaign can still be edited.
CREATE FUNCTION communication_audience_entries_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  row_ communication_audience_entries%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM communications c
                  WHERE c.business_id = row_.business_id AND c.id = row_.communication_id
                    AND c.status IN ('DRAFT', 'SCHEDULED')) THEN
    RAISE EXCEPTION 'COMMUNICATION_SENT: the audience of a campaign that went out does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN row_;
END
$$;
CREATE TRIGGER communication_audience_entries_rules
  BEFORE INSERT OR UPDATE OR DELETE ON communication_audience_entries
  FOR EACH ROW EXECUTE FUNCTION communication_audience_entries_rules();
