-- r0_platform_support (R0, Oct 17, Super Admin schema stage B2): Firmivra's support desk for
-- firms (Support spec). Tickets carry the firm (business_id): the Super Admin team sees all of
-- them; a firm's members see and raise only their own firm's tickets and replies, never the
-- internal notes or their files (Rasel, Oct 17). Attachments live under the firm's S3 prefix.
-- Contract note: docs/work/R0-stage-b2-support.md.

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTicketSource" AS ENUM ('PORTAL', 'EMAIL', 'PHONE', 'INTERNAL', 'WEB_FORM');

-- CreateEnum
CREATE TYPE "SupportAuthorSide" AS ENUM ('STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "SupportActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportSlaMode" AS ENUM ('BUSINESS_HOURS', 'CALENDAR');

-- CreateEnum
CREATE TYPE "SupportEscalationKind" AS ENUM ('SLA_BREACH', 'HIGH_PRIORITY_UNRESOLVED', 'CRITICAL_IMMEDIATE');

-- CreateTable
CREATE TABLE "support_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_priorities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL,
    "response_target_minutes" INTEGER NOT NULL,
    "resolution_target_minutes" INTEGER,
    "business_time" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "business_id" UUID NOT NULL,
    "contact_user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "priority_id" UUID NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "source" "SupportTicketSource" NOT NULL,
    "assigned_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "is_escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalated_at" TIMESTAMPTZ(3),
    "escalated_by_user_id" UUID,
    "escalation_reason" TEXT,
    "first_response_due_at" TIMESTAMPTZ(3),
    "first_responded_at" TIMESTAMPTZ(3),
    "resolution_due_at" TIMESTAMPTZ(3),
    "sla_paused_at" TIMESTAMPTZ(3),
    "sla_paused_seconds" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "reopened_count" INTEGER NOT NULL DEFAULT 0,
    "merged_into_ticket_id" UUID,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_side" "SupportAuthorSide" NOT NULL,
    "body" TEXT NOT NULL,
    "delivery_channel" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "message_id" UUID,
    "note_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_type" "SupportActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_counters" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_number" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "support_ticket_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "opens_at" TIME(0) NOT NULL DEFAULT '09:00:00'::time without time zone,
    "closes_at" TIME(0) NOT NULL DEFAULT '17:00:00'::time without time zone,
    "time_zone" TEXT NOT NULL DEFAULT 'America/New_York',
    "sla_mode" "SupportSlaMode" NOT NULL DEFAULT 'BUSINESS_HOURS',
    "pause_while_waiting" BOOLEAN NOT NULL DEFAULT true,
    "round_robin" BOOLEAN NOT NULL DEFAULT false,
    "last_assigned_user_id" UUID,
    "reassign_after_minutes" INTEGER,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_escalation_rules" (
    "id" UUID NOT NULL,
    "kind" "SupportEscalationKind" NOT NULL,
    "priority_id" UUID,
    "threshold_minutes" INTEGER,
    "notify_user_id" UUID,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_canned_responses" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notification_rules" (
    "id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "notify_assignee" BOOLEAN NOT NULL DEFAULT true,
    "notify_role_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_categories_name_key" ON "support_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "support_priorities_code_key" ON "support_priorities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_idempotency_key_key" ON "support_tickets"("idempotency_key");

-- CreateIndex
CREATE INDEX "support_tickets_business_id_status_idx" ON "support_tickets"("business_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_activity_at_idx" ON "support_tickets"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_user_id_status_idx" ON "support_tickets"("assigned_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_business_id_id_key" ON "support_tickets"("business_id", "id");

-- CreateIndex
CREATE INDEX "support_ticket_messages_business_id_ticket_id_created_at_idx" ON "support_ticket_messages"("business_id", "ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_messages_business_id_id_key" ON "support_ticket_messages"("business_id", "id");

-- CreateIndex
CREATE INDEX "support_ticket_notes_business_id_ticket_id_created_at_idx" ON "support_ticket_notes"("business_id", "ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_notes_business_id_id_key" ON "support_ticket_notes"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_attachments_s3_key_key" ON "support_ticket_attachments"("s3_key");

-- CreateIndex
CREATE INDEX "support_ticket_attachments_business_id_ticket_id_idx" ON "support_ticket_attachments"("business_id", "ticket_id");

-- CreateIndex
CREATE INDEX "support_ticket_events_business_id_ticket_id_created_at_idx" ON "support_ticket_events"("business_id", "ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_holidays_date_key" ON "support_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "support_notification_rules_event_key" ON "support_notification_rules"("event");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_business_id_contact_user_id_fkey" FOREIGN KEY ("business_id", "contact_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "support_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "support_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_merged_into_ticket_id_fkey" FOREIGN KEY ("merged_into_ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_business_id_ticket_id_fkey" FOREIGN KEY ("business_id", "ticket_id") REFERENCES "support_tickets"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_notes" ADD CONSTRAINT "support_ticket_notes_business_id_ticket_id_fkey" FOREIGN KEY ("business_id", "ticket_id") REFERENCES "support_tickets"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_business_id_ticket_id_fkey" FOREIGN KEY ("business_id", "ticket_id") REFERENCES "support_tickets"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_business_id_message_id_fkey" FOREIGN KEY ("business_id", "message_id") REFERENCES "support_ticket_messages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_business_id_note_id_fkey" FOREIGN KEY ("business_id", "note_id") REFERENCES "support_ticket_notes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_business_id_ticket_id_fkey" FOREIGN KEY ("business_id", "ticket_id") REFERENCES "support_tickets"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_escalation_rules" ADD CONSTRAINT "support_escalation_rules_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "support_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_canned_responses" ADD CONSTRAINT "support_canned_responses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "support_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
ALTER TABLE support_categories ADD CONSTRAINT support_categories_values
  CHECK (platform_text_ok(name, 100) AND (description IS NULL OR platform_text_ok(description, 500))
         AND sort_order >= 0);

ALTER TABLE support_priorities ADD CONSTRAINT support_priorities_values
  CHECK (code ~ '^[A-Z][A-Z0-9_]{0,29}$' AND platform_text_ok(name, 60)
         AND (description IS NULL OR platform_text_ok(description, 500))
         AND color ~ '^#[0-9a-fA-F]{6}$'
         AND response_target_minutes > 0
         AND (resolution_target_minutes IS NULL OR resolution_target_minutes >= response_target_minutes)
         AND sort_order >= 0);

-- Resolved and closed carry their time; closed is its own step (a merge closes without
-- resolving); an escalation carries its time and author; a merge points at another ticket.
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_values
  CHECK (platform_text_ok(subject, 200) AND platform_text_ok(description, 10000)
         AND (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
         AND (resolved_by_user_id IS NULL OR resolved_at IS NOT NULL)
         AND (status = 'CLOSED') = (closed_at IS NOT NULL)
         AND (closed_by_user_id IS NULL OR closed_at IS NOT NULL)
         AND is_escalated = (escalated_at IS NOT NULL)
         AND (escalated_by_user_id IS NULL OR is_escalated)
         AND (escalation_reason IS NULL OR (is_escalated AND platform_text_ok(escalation_reason, 1000)))
         AND (merged_into_ticket_id IS NULL OR (status = 'CLOSED' AND merged_into_ticket_id <> id))
         AND sla_paused_seconds >= 0 AND reopened_count >= 0 AND version >= 1
         AND (first_responded_at IS NULL OR first_responded_at >= created_at));

ALTER TABLE support_ticket_messages ADD CONSTRAINT support_ticket_messages_values
  CHECK (platform_text_ok(body, 20000)
         AND (delivery_channel IS NULL OR delivery_channel ~ '^[A-Z][A-Z_]{0,19}$'));

ALTER TABLE support_ticket_notes ADD CONSTRAINT support_ticket_notes_values
  CHECK (platform_text_ok(body, 20000));

ALTER TABLE support_ticket_attachments ADD CONSTRAINT support_ticket_attachments_values
  CHECK (num_nonnulls(message_id, note_id) <= 1
         AND platform_text_ok(file_name, 255) AND char_length(content_type) BETWEEN 3 AND 100
         AND size_bytes BETWEEN 1 AND 10485760 AND sha256 ~ '^[0-9a-f]{64}$'
         AND starts_with(s3_key, 'tenant/' || business_id || '/support/')
         AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)'
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

ALTER TABLE support_ticket_events ADD CONSTRAINT support_ticket_events_values
  CHECK (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'
         AND (actor_type = 'SYSTEM') = (actor_user_id IS NULL)
         AND (old_value IS NULL OR char_length(old_value) <= 500)
         AND (new_value IS NULL OR char_length(new_value) <= 500));

ALTER TABLE support_ticket_counters ADD CONSTRAINT support_ticket_counters_values
  CHECK (id = 1 AND last_number >= 1000);

ALTER TABLE support_settings ADD CONSTRAINT support_settings_values
  CHECK (id = 1 AND cardinality(working_days) BETWEEN 1 AND 7
         AND working_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7] AND closes_at > opens_at
         AND app_valid_time_zone(time_zone)
         AND (reassign_after_minutes IS NULL OR reassign_after_minutes > 0));

ALTER TABLE support_holidays ADD CONSTRAINT support_holidays_values
  CHECK (platform_text_ok(name, 100));

ALTER TABLE support_escalation_rules ADD CONSTRAINT support_escalation_rules_values
  CHECK ((threshold_minutes IS NULL OR threshold_minutes > 0)
         AND (kind <> 'HIGH_PRIORITY_UNRESOLVED' OR (priority_id IS NOT NULL AND threshold_minutes IS NOT NULL))
         AND channels <@ ARRAY['EMAIL', 'IN_APP', 'SMS']);

ALTER TABLE support_canned_responses ADD CONSTRAINT support_canned_responses_values
  CHECK (platform_text_ok(title, 120) AND platform_text_ok(body, 10000));

ALTER TABLE support_notification_rules ADD CONSTRAINT support_notification_rules_values
  CHECK (event ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'
         AND channels <@ ARRAY['EMAIL', 'IN_APP', 'SMS']
         AND cardinality(notify_role_keys) <= 20 AND array_position(notify_role_keys, NULL) IS NULL);

-- ---------- Rules ----------
-- Ticket numbers: platform-wide and in order (#1001, #1002, ...), whichever scope raises the
-- ticket. Only this function, run as the table owner, moves the counter; the app role can only
-- read it.
CREATE FUNCTION support_next_ticket_number() RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $f$ UPDATE support_ticket_counters SET last_number = last_number + 1 WHERE id = 1
         RETURNING last_number $f$;
REVOKE ALL ON FUNCTION support_next_ticket_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION support_next_ticket_number() TO firmivra_app;

-- The database gives the number and stamps the times. What a ticket is (firm, number, source,
-- contact, who raised it, when, the idempotency key) never changes after insert. The contact is
-- a member of the firm: the composite key to memberships checks that whatever the scope.
CREATE FUNCTION support_tickets_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' THEN
      RAISE EXCEPTION 'support tickets: a ticket starts OPEN' USING ERRCODE = 'check_violation';
    END IF;
    NEW.number := support_next_ticket_number();
    NEW.created_at := now();
    NEW.last_activity_at := now();
  ELSIF (NEW.business_id, NEW.number, NEW.source, NEW.created_by_user_id, NEW.created_at,
         NEW.idempotency_key, NEW.contact_user_id)
        IS DISTINCT FROM
        (OLD.business_id, OLD.number, OLD.source, OLD.created_by_user_id, OLD.created_at,
         OLD.idempotency_key, OLD.contact_user_id) THEN
    RAISE EXCEPTION 'support tickets: the firm, number, source, contact and creator never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER support_tickets_rules BEFORE INSERT OR UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_tickets_rules();

-- A file's identity never changes; only the scanner records its result, once.
CREATE FUNCTION support_ticket_attachments_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'support attachments: a new file waits for the scan'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.business_id, NEW.ticket_id, NEW.message_id, NEW.note_id, NEW.uploaded_by_user_id,
      NEW.file_name, NEW.content_type, NEW.size_bytes, NEW.sha256, NEW.s3_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.business_id, OLD.ticket_id, OLD.message_id, OLD.note_id, OLD.uploaded_by_user_id,
      OLD.file_name, OLD.content_type, OLD.size_bytes, OLD.sha256, OLD.s3_key, OLD.created_at)
     OR (OLD.scan_status <> 'PENDING' AND (NEW.scan_status, NEW.scanned_at)
                                         IS DISTINCT FROM (OLD.scan_status, OLD.scanned_at)) THEN
    RAISE EXCEPTION 'support attachments: only the scan result changes, once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER support_ticket_attachments_rules BEFORE INSERT OR UPDATE ON support_ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION support_ticket_attachments_rules();

-- Messages, notes and history rows take the database's time.
CREATE FUNCTION support_stamp_created_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER support_ticket_messages_stamp BEFORE INSERT ON support_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION support_stamp_created_at();
CREATE TRIGGER support_ticket_notes_stamp BEFORE INSERT ON support_ticket_notes
  FOR EACH ROW EXECUTE FUNCTION support_stamp_created_at();
CREATE TRIGGER support_ticket_events_stamp BEFORE INSERT ON support_ticket_events
  FOR EACH ROW EXECUTE FUNCTION support_stamp_created_at();

-- ---------- Grants ----------
-- Messages, notes and history are insert-only (never edited or deleted). Tickets are soft
-- deleted (deleted_at). Categories and priorities stay on old tickets, so they are retired with
-- is_active, never deleted.
GRANT SELECT, INSERT, UPDATE ON support_tickets, support_ticket_attachments,
  support_categories, support_priorities TO firmivra_app;
GRANT SELECT, INSERT ON support_ticket_messages, support_ticket_notes, support_ticket_events
  TO firmivra_app;
-- One row: its key and id = 1 check keep it single.
GRANT SELECT, INSERT, UPDATE ON support_settings TO firmivra_app;
-- The counter is read-only for the app: only support_next_ticket_number() moves it.
GRANT SELECT ON support_ticket_counters TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_holidays, support_escalation_rules,
  support_canned_responses, support_notification_rules TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_categories', 'support_priorities', 'support_tickets',
    'support_ticket_messages', 'support_ticket_notes', 'support_ticket_attachments',
    'support_ticket_events', 'support_settings', 'support_holidays', 'support_escalation_rules',
    'support_canned_responses', 'support_notification_rules', 'support_ticket_counters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's jobs (SLA clock, auto-assignment, email
-- intake: platform scope). Which team member may do which action is the API's permission check
-- (support.* keys in platform_role_permissions).
CREATE FUNCTION app_is_support_staff() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

-- The firm's own scope, for the one firm (its members raise and follow their tickets).
CREATE FUNCTION app_is_ticket_firm(firm uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'business' AND firm = app_current_business_id() $$;

-- The counter holds one number. Anyone may read it (the ticket numbers already show it); the app
-- role has no write grant, so only the owner-run function changes it.
CREATE POLICY support_ticket_counters_all ON support_ticket_counters FOR ALL
  USING (true) WITH CHECK (true);

-- Reference data: the team manages it; a firm reads the categories and priorities it picks from.
CREATE POLICY support_categories_read ON support_categories FOR SELECT
  USING (app_is_support_staff() OR app_scope() = 'business');
CREATE POLICY support_categories_write ON support_categories FOR INSERT
  WITH CHECK (app_is_support_staff());
CREATE POLICY support_categories_update ON support_categories FOR UPDATE
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());
CREATE POLICY support_priorities_read ON support_priorities FOR SELECT
  USING (app_is_support_staff() OR app_scope() = 'business');
CREATE POLICY support_priorities_write ON support_priorities FOR INSERT
  WITH CHECK (app_is_support_staff());
CREATE POLICY support_priorities_update ON support_priorities FOR UPDATE
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_settings', 'support_holidays', 'support_escalation_rules',
    'support_canned_responses', 'support_notification_rules'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_support_staff()) '
                   'WITH CHECK (app_is_support_staff())', t || '_staff', t);
  END LOOP;
END
$$;

-- Tickets: the team sees and changes all; a firm sees its own (not deleted ones) and raises one
-- from the portal for itself, about one of its own members, unassigned.
CREATE POLICY support_tickets_staff ON support_tickets FOR ALL
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());
CREATE POLICY support_tickets_firm_read ON support_tickets FOR SELECT
  USING (app_is_ticket_firm(business_id) AND deleted_at IS NULL);
CREATE POLICY support_tickets_firm_raise ON support_tickets FOR INSERT
  WITH CHECK (app_is_ticket_firm(business_id) AND source = 'PORTAL'
              AND created_by_user_id = app_current_actor_id() AND assigned_user_id IS NULL
              AND NOT is_escalated);

-- Replies: the team writes as STAFF under its own name; a firm member as CUSTOMER under theirs.
CREATE POLICY support_ticket_messages_staff_read ON support_ticket_messages FOR SELECT
  USING (app_is_support_staff());
CREATE POLICY support_ticket_messages_staff_write ON support_ticket_messages FOR INSERT
  WITH CHECK (app_scope() = 'platform'
              OR ((app_is_admin() OR app_is_platform_member()) AND author_side = 'STAFF'
                  AND author_user_id = app_current_admin_id()));
CREATE POLICY support_ticket_messages_firm_read ON support_ticket_messages FOR SELECT
  USING (app_is_ticket_firm(business_id));
CREATE POLICY support_ticket_messages_firm_write ON support_ticket_messages FOR INSERT
  WITH CHECK (app_is_ticket_firm(business_id) AND author_side = 'CUSTOMER'
              AND author_user_id = app_current_actor_id());

-- Internal notes and the history are the team's only; no firm policy exists for them.
CREATE POLICY support_ticket_notes_staff ON support_ticket_notes FOR ALL
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());
CREATE POLICY support_ticket_events_staff ON support_ticket_events FOR ALL
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());

-- Files: the team sees all and adds files; the scanner (platform scope) records the result; a firm
-- sees and adds files on its own tickets' conversation only, never a note's.
CREATE POLICY support_ticket_attachments_staff ON support_ticket_attachments FOR ALL
  USING (app_is_support_staff()) WITH CHECK (app_is_support_staff());
CREATE POLICY support_ticket_attachments_firm_read ON support_ticket_attachments FOR SELECT
  USING (app_is_ticket_firm(business_id) AND note_id IS NULL);
CREATE POLICY support_ticket_attachments_firm_add ON support_ticket_attachments FOR INSERT
  WITH CHECK (app_is_ticket_firm(business_id) AND note_id IS NULL
              AND uploaded_by_user_id = app_current_actor_id());

-- ---------- Defaults (Support spec) ----------
INSERT INTO support_settings (id, updated_at) VALUES (1, now());
INSERT INTO support_ticket_counters (id, last_number) VALUES (1, 1000);

INSERT INTO support_categories (id, name, description, sort_order, updated_at) VALUES
  (gen_random_uuid(), 'Account Access', 'Sign-in, passwords, MFA and user access.', 1, now()),
  (gen_random_uuid(), 'Billing & Payments', 'Subscription charges, invoices and payment methods.', 2, now()),
  (gen_random_uuid(), 'Document Filing', 'Uploading, sharing and organizing documents.', 3, now()),
  (gen_random_uuid(), 'Compliance', 'Regulatory, security and data questions.', 4, now()),
  (gen_random_uuid(), 'Technical Issue', 'Errors, bugs and anything not working as expected.', 5, now()),
  (gen_random_uuid(), 'General Inquiry', 'Questions that fit no other category.', 6, now());

-- Response targets in minutes: 1 hour, 4 hours, 1 business day (8 hours), 2 business days.
INSERT INTO support_priorities (id, code, name, description, color, response_target_minutes,
                                resolution_target_minutes, sort_order, updated_at) VALUES
  (gen_random_uuid(), 'CRITICAL', 'Critical', 'Service down or data at risk.', '#DC2626', 60, 480, 1, now()),
  (gen_random_uuid(), 'HIGH', 'High', 'A key workflow is blocked.', '#EA580C', 240, 960, 2, now()),
  (gen_random_uuid(), 'MEDIUM', 'Medium', 'Something is wrong but there is a workaround.', '#CA8A04', 480, 2400, 3, now()),
  (gen_random_uuid(), 'LOW', 'Low', 'A question or a minor issue.', '#2563EB', 960, 4800, 4, now());

INSERT INTO support_escalation_rules (id, kind, priority_id, threshold_minutes, channels, updated_at)
SELECT gen_random_uuid(), 'SLA_BREACH'::"SupportEscalationKind", NULL::uuid, NULL::int, ARRAY['EMAIL', 'IN_APP'], now()
UNION ALL
SELECT gen_random_uuid(), 'HIGH_PRIORITY_UNRESOLVED'::"SupportEscalationKind", p.id, 480, ARRAY['IN_APP'], now()
  FROM support_priorities p WHERE p.code = 'HIGH'
UNION ALL
SELECT gen_random_uuid(), 'CRITICAL_IMMEDIATE'::"SupportEscalationKind", p.id, NULL, ARRAY['EMAIL', 'IN_APP', 'SMS'], now()
  FROM support_priorities p WHERE p.code = 'CRITICAL';

INSERT INTO support_notification_rules (id, event, notify_assignee, notify_role_keys, channels, updated_at) VALUES
  (gen_random_uuid(), 'ticket.created', false, ARRAY['support.view_all'], ARRAY['IN_APP'], now()),
  (gen_random_uuid(), 'ticket.assigned', true, ARRAY[]::text[], ARRAY['EMAIL', 'IN_APP'], now()),
  (gen_random_uuid(), 'ticket.reassigned', true, ARRAY[]::text[], ARRAY['IN_APP'], now()),
  (gen_random_uuid(), 'ticket.customer_replied', true, ARRAY[]::text[], ARRAY['EMAIL', 'IN_APP'], now()),
  (gen_random_uuid(), 'ticket.escalated', true, ARRAY['support.escalate'], ARRAY['EMAIL', 'IN_APP'], now()),
  (gen_random_uuid(), 'sla.warning', true, ARRAY[]::text[], ARRAY['IN_APP'], now()),
  (gen_random_uuid(), 'sla.breached', true, ARRAY['support.view_all'], ARRAY['EMAIL', 'IN_APP'], now()),
  (gen_random_uuid(), 'ticket.resolved', false, ARRAY[]::text[], ARRAY['IN_APP'], now()),
  (gen_random_uuid(), 'ticket.reopened', true, ARRAY[]::text[], ARRAY['IN_APP'], now()),
  (gen_random_uuid(), 'ticket.closed', false, ARRAY[]::text[], ARRAY['IN_APP'], now());
