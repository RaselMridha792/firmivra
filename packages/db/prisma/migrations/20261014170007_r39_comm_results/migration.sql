-- CreateEnum
CREATE TYPE "CommunicationRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED', 'FAILED', 'NOT_SENT');

-- CreateEnum
CREATE TYPE "CommunicationEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED');

-- CreateTable
CREATE TABLE "communication_recipients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "client_id" UUID,
    "lead_id" UUID,
    "status" "CommunicationRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "address_mask" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "failure_code" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "first_opened_at" TIMESTAMPTZ(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "first_clicked_at" TIMESTAMPTZ(3),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "recipient_id" UUID,
    "type" "CommunicationEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "provider_event_id" TEXT,
    "detail_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_recipients_business_id_communication_id_statu_idx" ON "communication_recipients"("business_id", "communication_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipients_business_id_id_key" ON "communication_recipients"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipients_communication_id_client_id_key" ON "communication_recipients"("communication_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_recipients_communication_id_lead_id_key" ON "communication_recipients"("communication_id", "lead_id");

-- CreateIndex
CREATE INDEX "communication_events_business_id_communication_id_occurred__idx" ON "communication_events"("business_id", "communication_id", "occurred_at");

-- CreateIndex
CREATE INDEX "communication_events_business_id_recipient_id_idx" ON "communication_events"("business_id", "recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_events_communication_id_provider_event_id_key" ON "communication_events"("communication_id", "provider_event_id");

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_business_id_communication_id_fkey" FOREIGN KEY ("business_id", "communication_id") REFERENCES "communications"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_business_id_communication_id_fkey" FOREIGN KEY ("business_id", "communication_id") REFERENCES "communications"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_events" ADD CONSTRAINT "communication_events_business_id_recipient_id_fkey" FOREIGN KEY ("business_id", "recipient_id") REFERENCES "communication_recipients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: recipients change only their delivery status and engagement; events are insert-only.
GRANT SELECT, INSERT, UPDATE ON communication_recipients TO firmivra_app;
GRANT SELECT, INSERT ON communication_events TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['communication_recipients', 'communication_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE communication_recipients ADD CONSTRAINT communication_recipients_values
  CHECK (num_nonnulls(client_id, lead_id) = 1
         -- Only a masked address or number is kept, never the full one.
         AND address_mask LIKE '%*%' AND char_length(address_mask) <= 120
         AND (provider_message_id IS NULL OR char_length(provider_message_id) <= 200)
         AND (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (status NOT IN ('FAILED', 'BOUNCED', 'NOT_SENT') OR failure_code IS NOT NULL)
         AND (status <> 'UNSUBSCRIBED' OR unsubscribed_at IS NOT NULL)
         AND open_count >= 0 AND click_count >= 0);

ALTER TABLE communication_events ADD CONSTRAINT communication_events_values
  CHECK ((provider_event_id IS NULL OR char_length(provider_event_id) <= 200)
         AND (detail_code IS NULL OR detail_code ~ '^[a-z][a-z0-9_]{0,59}$'));

-- Recipients are written when sending starts; who they are never changes.
CREATE FUNCTION communication_recipients_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM communications c
                    WHERE c.business_id = NEW.business_id AND c.id = NEW.communication_id
                      AND c.status = 'SENDING') THEN
      RAISE EXCEPTION 'COMMUNICATION_NOT_SENDING: recipients are added when sending starts'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.communication_id, NEW.client_id, NEW.lead_id, NEW.address_mask)
        IS DISTINCT FROM (OLD.communication_id, OLD.client_id, OLD.lead_id, OLD.address_mask) THEN
    RAISE EXCEPTION 'RECIPIENT_FROZEN: who a campaign went to does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER communication_recipients_rules BEFORE INSERT OR UPDATE ON communication_recipients
  FOR EACH ROW EXECUTE FUNCTION communication_recipients_rules();

-- An event belongs to a campaign that is out (or going out), and to one of its own recipients.
CREATE FUNCTION communication_events_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM communications c
                  WHERE c.business_id = NEW.business_id AND c.id = NEW.communication_id
                    AND c.status IN ('SENDING', 'PAUSED', 'SENT', 'FAILED')) THEN
    RAISE EXCEPTION 'COMMUNICATION_NOT_SENT: events belong to a campaign that went out'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.recipient_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM communication_recipients r
        WHERE r.business_id = NEW.business_id AND r.id = NEW.recipient_id
          AND r.communication_id = NEW.communication_id) THEN
    RAISE EXCEPTION 'EVENT_RECIPIENT: the recipient belongs to another campaign'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER communication_events_rules BEFORE INSERT ON communication_events
  FOR EACH ROW EXECUTE FUNCTION communication_events_rules();
