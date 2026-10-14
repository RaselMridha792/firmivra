-- R37 (Rasel, Oct 14), Documents: document requests as the screens show them. A request (packet)
-- has a title, due date, message, delivery and reminder choices, an assignee and a checklist;
-- each checklist item is the existing document_requests row (packet_id), so accept, reject and
-- "I don't have this" are unchanged. Existing single requests stay as they are (packet_id empty).

-- CreateEnum
CREATE TYPE "DocumentRequestRecipient" AS ENUM ('CLIENT', 'MEMBER');

-- CreateEnum
CREATE TYPE "DocumentRequestPacketStatus" AS ENUM ('DRAFT', 'OPEN', 'SUBMITTED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "document_requests" ADD COLUMN     "packet_id" UUID,
ADD COLUMN     "required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "document_request_packets" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "recipient_kind" "DocumentRequestRecipient" NOT NULL DEFAULT 'CLIENT',
    "recipient_user_id" UUID,
    "template_id" UUID,
    "title" TEXT NOT NULL,
    "due_on" DATE,
    "status" "DocumentRequestPacketStatus" NOT NULL DEFAULT 'DRAFT',
    "message_subject" TEXT,
    "message_body" TEXT,
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_portal" BOOLEAN NOT NULL DEFAULT true,
    "notify_sms" BOOLEAN NOT NULL DEFAULT false,
    "reminder_days_before" INTEGER,
    "allow_multiple_files" BOOLEAN NOT NULL DEFAULT true,
    "allow_client_comments" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(3),
    "assigned_user_id" UUID,
    "requested_by_user_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_request_packets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_request_packets_business_id_status_due_on_idx" ON "document_request_packets"("business_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "document_request_packets_business_id_client_id_idx" ON "document_request_packets"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "document_request_packets_business_id_assigned_user_id_statu_idx" ON "document_request_packets"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "document_request_packets_business_id_created_at_idx" ON "document_request_packets"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_request_packets_business_id_number_key" ON "document_request_packets"("business_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "document_request_packets_business_id_engagement_id_id_key" ON "document_request_packets"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_request_packets_business_id_id_key" ON "document_request_packets"("business_id", "id");

-- CreateIndex
CREATE INDEX "document_requests_business_id_packet_id_sort_order_idx" ON "document_requests"("business_id", "packet_id", "sort_order");

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_business_id_engagement_id_packet_id_fkey" FOREIGN KEY ("business_id", "engagement_id", "packet_id") REFERENCES "document_request_packets"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_packets" ADD CONSTRAINT "document_request_packets_business_id_client_id_engagement__fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_packets" ADD CONSTRAINT "document_request_packets_business_id_recipient_user_id_fkey" FOREIGN KEY ("business_id", "recipient_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_packets" ADD CONSTRAINT "document_request_packets_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_packets" ADD CONSTRAINT "document_request_packets_business_id_requested_by_user_id_fkey" FOREIGN KEY ("business_id", "requested_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Requests are cancelled, never deleted.
GRANT SELECT, INSERT, UPDATE ON document_request_packets TO firmivra_app;
ALTER TABLE document_request_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_request_packets FORCE ROW LEVEL SECURITY;
CREATE POLICY document_request_packets_business ON document_request_packets
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_text
  CHECK (char_length(btrim(title)) >= 1 AND char_length(title) <= 200 AND app_no_hidden_characters(title)
     AND (message_subject IS NULL OR (char_length(btrim(message_subject)) >= 1
          AND char_length(message_subject) <= 200 AND app_no_hidden_characters(message_subject)))
     AND (message_body IS NULL OR (char_length(btrim(message_body)) >= 1
          AND char_length(message_body) <= 1000)));
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_recipient
  CHECK ((recipient_kind = 'MEMBER') = (recipient_user_id IS NOT NULL));
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_reminder
  CHECK (reminder_days_before IS NULL OR reminder_days_before BETWEEN 1 AND 30);
-- Sent means it has a due date and a message; the closing facts match the status.
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_sent
  CHECK ((status NOT IN ('OPEN', 'SUBMITTED', 'COMPLETED')
          OR (sent_at IS NOT NULL AND due_on IS NOT NULL AND message_subject IS NOT NULL
              AND message_body IS NOT NULL))
     AND (status <> 'DRAFT' OR sent_at IS NULL)
     AND ((status = 'COMPLETED') = (completed_at IS NOT NULL))
     AND ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
     AND (status NOT IN ('SUBMITTED') OR submitted_at IS NOT NULL));
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_expiry
  CHECK (expires_at IS NULL OR due_on IS NULL OR (expires_at AT TIME ZONE 'UTC')::date > due_on);
ALTER TABLE document_request_packets ADD CONSTRAINT document_request_packets_number
  CHECK (number >= 0);

-- ---------- Rules ----------
-- The database gives the number (the next of the firm, in order, under a per-firm lock) and the
-- time of each step; a request moves forward only, is frozen when sent (except the due date,
-- assignee, reminder, expiry and the closing facts) and its firm, client and engagement never
-- change.
CREATE FUNCTION document_request_packets_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('request-packet:' || NEW.business_id::text, 0));
    SELECT coalesce(max(p.number), 0) + 1 INTO NEW.number
      FROM document_request_packets p WHERE p.business_id = NEW.business_id;
    NEW.sent_at := CASE WHEN NEW.status = 'DRAFT' THEN NULL ELSE now() END;
    NEW.submitted_at := NULL;
    NEW.completed_at := CASE WHEN NEW.status = 'COMPLETED' THEN now() END;
    NEW.cancelled_at := CASE WHEN NEW.status = 'CANCELLED' THEN now() END;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id <> OLD.engagement_id OR NEW.number <> OLD.number
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'document requests: the firm, client, engagement and number of a request cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('OPEN', 'CANCELLED'))
    OR (OLD.status = 'OPEN' AND NEW.status IN ('SUBMITTED', 'COMPLETED', 'CANCELLED'))
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('OPEN', 'COMPLETED', 'CANCELLED'))) THEN
    RAISE EXCEPTION 'document requests: a request cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.recipient_kind <> OLD.recipient_kind
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.title <> OLD.title
     OR NEW.message_subject IS DISTINCT FROM OLD.message_subject
     OR NEW.message_body IS DISTINCT FROM OLD.message_body
     OR NEW.notify_email <> OLD.notify_email OR NEW.notify_portal <> OLD.notify_portal
     OR NEW.notify_sms <> OLD.notify_sms
     OR NEW.allow_multiple_files <> OLD.allow_multiple_files
     OR NEW.allow_client_comments <> OLD.allow_client_comments
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id) THEN
    RAISE EXCEPTION 'document requests: a sent request keeps its title, message, recipient and delivery'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.sent_at := OLD.sent_at;
  NEW.submitted_at := OLD.submitted_at;
  NEW.completed_at := OLD.completed_at;
  NEW.cancelled_at := OLD.cancelled_at;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'OPEN' THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'SUBMITTED' THEN NEW.submitted_at := now(); END IF;
    IF NEW.status = 'COMPLETED' THEN NEW.completed_at := now(); END IF;
    IF NEW.status = 'CANCELLED' THEN NEW.cancelled_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_request_packets_rules
  BEFORE INSERT OR UPDATE ON document_request_packets
  FOR EACH ROW EXECUTE FUNCTION document_request_packets_rules();

-- Items: put in, taken out or changed (title, instructions, category, required, order) only
-- while their request is a DRAFT. Everything else about an item (its status, the client's
-- upload) is unaffected.
CREATE FUNCTION document_requests_packet_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  p uuid;
  packet_status "DocumentRequestPacketStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.packet_id IS NOT DISTINCT FROM OLD.packet_id
     AND NEW.title = OLD.title AND NEW.instructions IS NOT DISTINCT FROM OLD.instructions
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
     AND NEW.required = OLD.required AND NEW.sort_order = OLD.sort_order THEN
    RETURN NEW;
  END IF;
  FOR p IN SELECT unnest(ARRAY[NEW.packet_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.packet_id END])
  LOOP
    IF p IS NOT NULL THEN
      SELECT k.status INTO packet_status FROM document_request_packets k
        WHERE k.business_id = NEW.business_id AND k.id = p;
      IF packet_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'document requests: the items of a request change only while it is a draft'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_requests_packet_rules
  BEFORE INSERT OR UPDATE ON document_requests
  FOR EACH ROW EXECUTE FUNCTION document_requests_packet_rules();
