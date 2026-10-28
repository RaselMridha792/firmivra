-- r1_message_thread_lead (R1, Oct 28; Rasel's tap of Oct 28 10:59:10Z): a conversation with a lead,
-- for the Messages Leads tab (MSG-F03, docs/specs/review-2026-10-27/CHANGE-LIST.md section C; R60's
-- "Needs from others"). Today a lead's email or text from Leads is one-way and no thread holds it.
-- A thread now belongs to exactly one client or one lead, fixed for its life; a lead's threads stay
-- on the lead when it converts (its history is reachable through leads.client_id). A lead thread
-- has no engagement, no client-side messages (messages_rules needs the client's portal login) and
-- no vault attachments (documents belong to clients). Same RLS as before: message_threads already
-- has forced RLS per firm, and the portal reads only its own client's threads. No backfill.


-- AlterTable
ALTER TABLE "message_threads" ADD COLUMN     "lead_id" UUID,
ALTER COLUMN "client_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "message_threads_business_id_lead_id_last_message_at_idx" ON "message_threads"("business_id", "lead_id", "last_message_at");

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Data rules Prisma cannot express ----------

-- Exactly one of a client or a lead; a lead thread is about no engagement.
ALTER TABLE message_threads ADD CONSTRAINT message_threads_client_or_lead
  CHECK (num_nonnulls(client_id, lead_id) = 1 AND (lead_id IS NULL OR engagement_id IS NULL));

-- The client or lead and the engagement of a thread are fixed. IS DISTINCT FROM, since client_id
-- may now be empty (with <> a change from or to empty would pass).
CREATE OR REPLACE FUNCTION message_threads_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_message_at IS NOT NULL THEN
      RAISE EXCEPTION 'message threads: last_message_at is set by the database'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'message threads: the client or lead and the engagement of a thread cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only the messages trigger (one level down) moves last_message_at.
  IF NEW.last_message_at IS DISTINCT FROM OLD.last_message_at AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'message threads: last_message_at is set by the database'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Outbound recipients: unchanged but for the last rule (the message a delivery links).
CREATE OR REPLACE FUNCTION outbound_recipients_rules() RETURNS trigger
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
  -- Bulk sends respect an opt-out (or a bounce, invalid address or complaint) on email and text, always.
  -- The consent record is R39's communication_consents.
  IF parent.kind = 'BULK' AND NEW.status IN ('QUEUED', 'SENT') AND NEW.channel IN ('EMAIL', 'SMS')
     AND EXISTS (SELECT 1 FROM communication_consents c
                 WHERE c.business_id = NEW.business_id AND c.status <> 'OPTED_IN' AND c.channel::text = NEW.channel::text
                   AND (c.client_id = NEW.client_id OR c.lead_id = NEW.lead_id)) THEN
    RAISE EXCEPTION 'outbound recipients: this contact opted out of this channel' USING ERRCODE = 'check_violation';
  END IF;
  -- A portal delivery links the conversation message it made, in this client's own thread; an email or
  -- text to a lead links the copy it wrote in that lead's own thread (r1_message_thread_lead).
  IF NEW.message_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM messages m JOIN message_threads t ON t.id = m.thread_id
        WHERE m.business_id = NEW.business_id AND m.id = NEW.message_id
          AND ((NEW.channel = 'PORTAL' AND t.client_id = NEW.client_id)
               OR (NEW.channel IN ('EMAIL', 'SMS') AND t.lead_id = NEW.lead_id))) THEN
    RAISE EXCEPTION 'outbound recipients: the message must be in this client''s own thread on the portal, or this lead''s own thread'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
