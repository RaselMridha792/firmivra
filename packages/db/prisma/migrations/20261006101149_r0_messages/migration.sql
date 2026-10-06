-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('FIRM_TO_CLIENT', 'CLIENT_TO_FIRM');

-- CreateTable
CREATE TABLE "message_threads" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "subject" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "replies_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_message_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_private_notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_private_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_note_reminders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "remind_at" TIMESTAMPTZ(3) NOT NULL,
    "reminded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_note_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_threads_business_id_client_id_last_message_at_idx" ON "message_threads"("business_id", "client_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_threads_business_id_id_key" ON "message_threads"("business_id", "id");

-- CreateIndex
CREATE INDEX "messages_business_id_thread_id_created_at_idx" ON "messages"("business_id", "thread_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_business_id_id_key" ON "messages"("business_id", "id");

-- CreateIndex
CREATE INDEX "message_attachments_business_id_document_id_idx" ON "message_attachments"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_business_id_message_id_document_id_key" ON "message_attachments"("business_id", "message_id", "document_id");

-- CreateIndex
CREATE INDEX "client_private_notes_business_id_user_id_created_at_idx" ON "client_private_notes"("business_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_private_notes_business_id_id_key" ON "client_private_notes"("business_id", "id");

-- CreateIndex
CREATE INDEX "client_note_reminders_business_id_remind_at_idx" ON "client_note_reminders"("business_id", "remind_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_note_reminders_business_id_note_id_key" ON "client_note_reminders"("business_id", "note_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_business_id_user_id_key" ON "client_accounts"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_business_id_id_key" ON "documents"("business_id", "id");

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_thread_id_fkey" FOREIGN KEY ("business_id", "thread_id") REFERENCES "message_threads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_business_id_message_id_fkey" FOREIGN KEY ("business_id", "message_id") REFERENCES "messages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_private_notes" ADD CONSTRAINT "client_private_notes_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "client_accounts"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_note_reminders" ADD CONSTRAINT "client_note_reminders_business_id_note_id_fkey" FOREIGN KEY ("business_id", "note_id") REFERENCES "client_private_notes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 9: row-level security and data rules ====================
-- Message threads, messages and attachments; the client's private notes and their reminders.

-- ---------- Actor ----------
-- Who is acting inside business scope, set by db.forBusiness(businessId, { actorUserId }).
-- Only rows private to one person use it; with no actor set it is NULL and those rows are hidden.
CREATE OR REPLACE FUNCTION app_current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN app_scope() = 'business'
                    THEN NULLIF(current_setting('app.current_actor_id', true), '')::uuid END $$;

-- ---------- Grants ----------
-- Threads and messages are the canonical history: never deleted.
GRANT SELECT, INSERT, UPDATE ON message_threads, messages TO firmivra_app;
GRANT SELECT, INSERT ON message_attachments TO firmivra_app;
-- A note is never edited or deleted: each save adds a version.
GRANT SELECT, INSERT ON client_private_notes TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_note_reminders TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE message_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_threads       FORCE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              FORCE ROW LEVEL SECURITY;
ALTER TABLE message_attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments   FORCE ROW LEVEL SECURITY;
ALTER TABLE client_private_notes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_private_notes  FORCE ROW LEVEL SECURITY;
ALTER TABLE client_note_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_note_reminders FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY message_threads_business ON message_threads
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY messages_business ON messages
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY message_attachments_business ON message_attachments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- Reminders hold only a date, so the reminder sender (no actor) can find the due ones.
CREATE POLICY client_note_reminders_business ON client_note_reminders
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- A client's notes: only that client login, acting for itself, ever sees or writes them.
-- Staff sessions (another actor, or none) see nothing, whatever the API asks for.
CREATE POLICY client_private_notes_owner ON client_private_notes
  USING (business_id = app_current_business_id() AND user_id = app_current_actor_id())
  WITH CHECK (business_id = app_current_business_id() AND user_id = app_current_actor_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE message_threads ADD CONSTRAINT message_threads_subject
  CHECK (btrim(subject) <> '' AND length(subject) <= 200);
ALTER TABLE message_threads ADD CONSTRAINT message_threads_related_record
  CHECK ((entity_type IS NULL) = (entity_id IS NULL) AND entity_type ~ '^[a-z][a-z_]*$');

ALTER TABLE messages ADD CONSTRAINT messages_body_length
  CHECK (btrim(body) <> '' AND length(body) <= 10000);

ALTER TABLE client_private_notes ADD CONSTRAINT client_private_notes_body_length
  CHECK (btrim(body) <> '' AND length(body) <= 5000);

-- ---------- Threads: client and engagement fixed; last_message_at kept by the database ----------
CREATE FUNCTION message_threads_rules() RETURNS trigger
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

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'message threads: the client and engagement of a thread cannot change'
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

CREATE TRIGGER message_threads_rules
  BEFORE INSERT OR UPDATE ON message_threads
  FOR EACH ROW EXECUTE FUNCTION message_threads_rules();

-- ---------- Messages: the right sender for the direction; then only read_at changes ----------
CREATE FUNCTION messages_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.thread_id <> OLD.thread_id
       OR NEW.sender_user_id <> OLD.sender_user_id OR NEW.direction <> OLD.direction
       OR NEW.body <> OLD.body OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'messages: a message cannot change, only its read state'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.read_at IS NOT NULL THEN
    RAISE EXCEPTION 'messages: a new message starts unread' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.direction = 'FIRM_TO_CLIENT' THEN
    IF NOT EXISTS (SELECT 1 FROM memberships m
                   WHERE m.business_id = NEW.business_id AND m.user_id = NEW.sender_user_id
                     AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'messages: the firm side must be an active member of the firm'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- A client writes only in their own client's threads, and only while replies are open.
    IF NOT EXISTS (SELECT 1 FROM message_threads t
                   JOIN client_accounts c ON c.client_id = t.client_id AND c.business_id = t.business_id
                   WHERE t.id = NEW.thread_id AND c.user_id = NEW.sender_user_id
                     AND c.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'messages: the client side must be an active portal login of this thread''s client'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM message_threads t WHERE t.id = NEW.thread_id AND NOT t.replies_enabled) THEN
      RAISE EXCEPTION 'messages: replies are closed on this thread' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER messages_rules
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_rules();

CREATE FUNCTION messages_touch_thread() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE message_threads SET last_message_at = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER messages_touch_thread
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_touch_thread();

-- ---------- Attachments: a document of the thread's client ----------
CREATE FUNCTION message_attachments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM messages m
                 JOIN message_threads t ON t.id = m.thread_id
                 JOIN documents d ON d.id = NEW.document_id
                 WHERE m.id = NEW.message_id AND d.client_id = t.client_id) THEN
    RAISE EXCEPTION 'message attachments: the document must belong to the thread''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER message_attachments_rules
  BEFORE INSERT ON message_attachments
  FOR EACH ROW EXECUTE FUNCTION message_attachments_rules();

-- ---------- Note reminders: made by the note's owner; a new date re-arms the reminder ----------
CREATE FUNCTION client_note_reminders_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The note is visible only to its owner acting for itself (policy above).
    IF NOT EXISTS (SELECT 1 FROM client_private_notes n
                   WHERE n.id = NEW.note_id AND n.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'note reminders: only the note''s owner can set its reminder'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reminded_at IS NOT NULL THEN
      RAISE EXCEPTION 'note reminders: a new reminder has not been sent yet'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.note_id <> OLD.note_id
     OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'note reminders: the note and its owner cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.remind_at <> OLD.remind_at THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER client_note_reminders_rules
  BEFORE INSERT OR UPDATE ON client_note_reminders
  FOR EACH ROW EXECUTE FUNCTION client_note_reminders_rules();
