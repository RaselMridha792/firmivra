-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('PORTAL', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "MessageTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageTemplateScope" AS ENUM ('FIRM', 'PERSONAL');

-- AlterTable
ALTER TABLE "message_threads" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "assigned_user_id" UUID;

-- CreateTable
CREATE TABLE "message_thread_mutes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "muted_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_thread_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_thread_tags" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_thread_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "service_id" UUID,
    "channels" "MessageChannel"[],
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "scope" "MessageTemplateScope" NOT NULL DEFAULT 'FIRM',
    "owner_user_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_thread_mutes_business_id_user_id_idx" ON "message_thread_mutes"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_thread_mutes_thread_id_user_id_key" ON "message_thread_mutes"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "message_thread_tags_business_id_thread_id_idx" ON "message_thread_tags"("business_id", "thread_id");

-- CreateIndex
CREATE INDEX "message_thread_tags_business_id_tag_idx" ON "message_thread_tags"("business_id", "tag");

-- CreateIndex
CREATE INDEX "message_templates_business_id_status_idx" ON "message_templates"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_name_key" ON "message_templates"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_id_key" ON "message_templates"("business_id", "id");

-- CreateIndex
CREATE INDEX "message_threads_business_id_assigned_user_id_idx" ON "message_threads"("business_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "message_threads_business_id_archived_at_idx" ON "message_threads"("business_id", "archived_at");

-- AddForeignKey
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_thread_mutes" ADD CONSTRAINT "message_thread_mutes_business_id_thread_id_fkey" FOREIGN KEY ("business_id", "thread_id") REFERENCES "message_threads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_thread_mutes" ADD CONSTRAINT "message_thread_mutes_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_thread_tags" ADD CONSTRAINT "message_thread_tags_business_id_thread_id_fkey" FOREIGN KEY ("business_id", "thread_id") REFERENCES "message_threads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Messages inbox's thread state (assigned staff, archived), mute, tags and
-- the message templates. One shared conversation dataset: the tabs only filter it.

-- ---------- Grants and RLS: only the firm's own business scope ----------
GRANT SELECT, INSERT, UPDATE ON message_templates TO firmivra_app;
-- Unmuting and removing a tag delete the row; a mute's time can be changed.
GRANT SELECT, INSERT, UPDATE, DELETE ON message_thread_mutes TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON message_thread_tags TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_thread_mutes', 'message_thread_tags', 'message_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE message_thread_tags ADD CONSTRAINT message_thread_tags_tag CHECK (btrim(tag) <> '' AND char_length(tag) <= 40);
-- A tag is on a thread once, whatever its case.
CREATE UNIQUE INDEX message_thread_tags_one ON message_thread_tags (thread_id, lower(tag));

CREATE FUNCTION message_channels_distinct(channels "MessageChannel"[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT cardinality(channels) = (SELECT count(DISTINCT c) FROM unnest(channels) AS u(c))
$$;

ALTER TABLE message_templates
  ADD CONSTRAINT message_templates_name CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT message_templates_text
    CHECK (btrim(body) <> '' AND char_length(body) <= 5000 AND char_length(subject) <= 200
           AND char_length(category) <= 60),
  -- A template fits at least one channel, once each.
  ADD CONSTRAINT message_templates_channels
    CHECK (cardinality(channels) >= 1 AND message_channels_distinct(channels)),
  -- A personal template has its owner; a firm template has none.
  ADD CONSTRAINT message_templates_owner CHECK ((scope = 'PERSONAL') = (owner_user_id IS NOT NULL));

-- ---------- Rules ----------
-- A thread is owned by an active member of the firm.
CREATE FUNCTION message_threads_assignee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.assigned_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id)
     AND NOT EXISTS (SELECT 1 FROM memberships m
                     WHERE m.business_id = NEW.business_id AND m.user_id = NEW.assigned_user_id
                       AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'message threads: a thread is assigned to an active member of the firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER message_threads_assignee
  BEFORE INSERT OR UPDATE OF assigned_user_id ON message_threads
  FOR EACH ROW EXECUTE FUNCTION message_threads_assignee();
