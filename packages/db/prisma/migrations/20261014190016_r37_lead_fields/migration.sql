-- R37 (Rasel, Oct 14), Leads: the list, profile and convert screens. A lead gets a number
-- ("LD-10024", given by the database), more contact details, a source, a priority, an owner, a
-- next follow-up, an archive mark and the author of the last change; five more pipeline
-- statuses (contacted, in follow-up, appointment scheduled, qualified, lost); the services it is
-- interested in (lead_services) and its tags, from the clients' tag catalog (lead_tags). Existing
-- leads are numbered in the order they came and are BEGIN_ONLINE. The lead's timeline (lead_activities)
-- is written by
-- the database (new, status change, new owner) and by the API. Not here: a lead without a primary service (Lead.service_id stays required, as the
-- Begin Online code and its rules need it). The new status values are not used by any check,
-- index or policy here (a new value cannot be used in the transaction that adds it).

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('BEGIN_ONLINE', 'WEBSITE_FORM', 'FACEBOOK_AD', 'INSTAGRAM', 'GOOGLE_AD', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "LeadActionType" AS ENUM ('CALL', 'EMAIL', 'APPOINTMENT', 'SEND_DOCUMENTS', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "LeadActivityKind" AS ENUM ('CREATED', 'STATUS_CHANGED', 'FORM_SUBMITTED', 'EMAIL_SENT', 'SMS_SENT', 'CALL', 'MEETING', 'NOTE', 'FOLLOW_UP', 'FOLLOW_UP_COMPLETED', 'APPOINTMENT_SCHEDULED', 'TAG_ADDED', 'ASSIGNED', 'CONVERTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStatus" ADD VALUE 'CONTACTED';
ALTER TYPE "LeadStatus" ADD VALUE 'IN_FOLLOW_UP';
ALTER TYPE "LeadStatus" ADD VALUE 'APPOINTMENT_SCHEDULED';
ALTER TYPE "LeadStatus" ADD VALUE 'QUALIFIED';
ALTER TYPE "LeadStatus" ADD VALUE 'LOST';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "archived_by_user_id" UUID,
ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "best_time_to_contact" TEXT,
ADD COLUMN     "business_name" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "next_action_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_action_note" TEXT,
ADD COLUMN     "next_action_type" "LeadActionType",
ADD COLUMN     "number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "preferred_contact_methods" "ContactMethod"[] DEFAULT ARRAY[]::"ContactMethod"[],
ADD COLUMN     "priority" "LeadPriority",
ADD COLUMN     "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "source_detail" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "updated_by_user_id" UUID;

-- CreateTable
CREATE TABLE "lead_services" (
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_services_pkey" PRIMARY KEY ("lead_id","service_id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("lead_id","tag_id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" "LeadActivityKind" NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "body" TEXT,
    "status" "LeadStatus",
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_services_business_id_service_id_idx" ON "lead_services"("business_id", "service_id");

-- CreateIndex
CREATE INDEX "lead_tags_business_id_tag_id_idx" ON "lead_tags"("business_id", "tag_id");

-- CreateIndex
CREATE INDEX "lead_activities_business_id_lead_id_occurred_at_idx" ON "lead_activities"("business_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_activities_business_id_kind_occurred_at_idx" ON "lead_activities"("business_id", "kind", "occurred_at");

-- CreateIndex
CREATE INDEX "leads_business_id_assigned_user_id_status_idx" ON "leads"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "leads_business_id_source_idx" ON "leads"("business_id", "source");

-- CreateIndex
CREATE INDEX "leads_business_id_next_action_at_idx" ON "leads"("business_id", "next_action_at");

-- CreateIndex
CREATE INDEX "leads_business_id_created_at_idx" ON "leads"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_archived_by_user_id_fkey" FOREIGN KEY ("business_id", "archived_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_services" ADD CONSTRAINT "lead_services_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_services" ADD CONSTRAINT "lead_services_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_business_id_tag_id_fkey" FOREIGN KEY ("business_id", "tag_id") REFERENCES "tags"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_business_id_added_by_user_id_fkey" FOREIGN KEY ("business_id", "added_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_business_id_actor_user_id_fkey" FOREIGN KEY ("business_id", "actor_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Existing leads (local and dev): numbers and source ----------
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE leads l SET number = n.rank + 10000, source = 'BEGIN_ONLINE'
      FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rank
              FROM leads WHERE business_id = firm) n
     WHERE l.id = n.id AND l.business_id = firm;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- The number is unique per firm; created after the numbers were filled in.
CREATE UNIQUE INDEX "leads_business_id_number_key" ON "leads"("business_id", "number");

-- ---------- Grants and RLS ----------
-- A lead's services and tags are added and taken off.
GRANT SELECT, INSERT, DELETE ON lead_services, lead_tags TO firmivra_app;
ALTER TABLE lead_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_services FORCE ROW LEVEL SECURITY;
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_services_business ON lead_services
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY lead_tags_business ON lead_tags
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
CREATE FUNCTION app_array_distinct(a anyarray) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$ SELECT (SELECT count(DISTINCT x) FROM unnest(a) x) = coalesce(cardinality(a), 0) $$;

ALTER TABLE leads ADD CONSTRAINT leads_number_positive CHECK (number >= 0);
ALTER TABLE leads ADD CONSTRAINT leads_r37_text
  CHECK ((business_name IS NULL OR (char_length(btrim(business_name)) >= 1 AND char_length(business_name) <= 200
          AND app_no_hidden_characters(business_name)))
     AND (best_time_to_contact IS NULL OR (char_length(btrim(best_time_to_contact)) >= 1
          AND char_length(best_time_to_contact) <= 100 AND app_no_hidden_characters(best_time_to_contact)))
     AND (source_detail IS NULL OR (char_length(btrim(source_detail)) >= 1 AND char_length(source_detail) <= 200
          AND app_no_hidden_characters(source_detail)))
     AND (next_action_note IS NULL OR (char_length(btrim(next_action_note)) >= 1 AND char_length(next_action_note) <= 1000))
     AND (address_line1 IS NULL OR char_length(address_line1) <= 200)
     AND (address_line2 IS NULL OR char_length(address_line2) <= 200)
     AND (city IS NULL OR char_length(city) <= 100) AND (state IS NULL OR char_length(state) <= 100)
     AND (postal_code IS NULL OR char_length(postal_code) <= 20));
ALTER TABLE leads ADD CONSTRAINT leads_preferred_contact CHECK (app_array_distinct(preferred_contact_methods));
-- A follow-up has a type and a time, and a note only goes with one.
ALTER TABLE leads ADD CONSTRAINT leads_next_action
  CHECK ((next_action_type IS NULL) = (next_action_at IS NULL)
     AND (next_action_note IS NULL OR next_action_type IS NOT NULL));
ALTER TABLE leads ADD CONSTRAINT leads_archived CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL));

-- ---------- Rules ----------
-- The number is the firm's next, given here (a caller's is ignored), from 10001, and never
-- changes; the owner is an active member; a closed lead (converted, declined, lost or expired)
-- has no follow-up.
CREATE FUNCTION leads_r37_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lead-number:' || NEW.business_id::text, 0));
    SELECT coalesce(max(l.number), 10000) + 1 INTO NEW.number
      FROM leads l WHERE l.business_id = NEW.business_id;
  ELSIF NEW.number <> OLD.number THEN
    RAISE EXCEPTION 'leads: the lead number is given by the database and never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.assigned_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id)
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.business_id = NEW.business_id
                     AND m.user_id = NEW.assigned_user_id AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'leads: a lead is assigned to an active member'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('CONVERTED', 'DECLINED', 'LOST', 'EXPIRED') AND NEW.next_action_type IS NOT NULL THEN
    RAISE EXCEPTION 'leads: a closed lead has no follow-up'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER leads_r37_rules
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_r37_rules();

-- A lead's service is a live one of the firm; its tag is a live one (the foreign keys keep both
-- in the firm).
CREATE FUNCTION lead_services_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM services s WHERE s.business_id = NEW.business_id AND s.id = NEW.service_id
             AND s.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'lead services: an archived service cannot be added'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_services_rules BEFORE INSERT ON lead_services
  FOR EACH ROW EXECUTE FUNCTION lead_services_rules();

CREATE FUNCTION lead_tags_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM tags t WHERE t.business_id = NEW.business_id AND t.id = NEW.tag_id
             AND t.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'lead tags: an archived tag cannot be applied'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_tags_rules BEFORE INSERT ON lead_tags
  FOR EACH ROW EXECUTE FUNCTION lead_tags_rules();

-- ---------- The lead's timeline ----------
-- Append-only: the app reads and adds; nothing changes or goes.
GRANT SELECT, INSERT ON lead_activities TO firmivra_app;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities FORCE ROW LEVEL SECURITY;
CREATE POLICY lead_activities_business ON lead_activities
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_text
  CHECK ((summary IS NULL OR (char_length(btrim(summary)) >= 1 AND char_length(summary) <= 200
          AND app_no_hidden_characters(summary)))
     AND (body IS NULL OR (char_length(btrim(body)) >= 1 AND char_length(body) <= 5000))
     AND (kind <> 'NOTE' OR body IS NOT NULL)
     AND (kind = 'STATUS_CHANGED') = (status IS NOT NULL)
     AND jsonb_typeof(metadata) = 'object');

CREATE FUNCTION lead_activities_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.occurred_at > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'lead activities: an activity cannot be set in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lead_activities_rules BEFORE INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION lead_activities_rules();

-- The database writes what it knows: a new lead, every change of status, and a new owner, by the
-- author of that write (updated_by_user_id).
CREATE FUNCTION leads_activity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO lead_activities (id, business_id, lead_id, kind, actor_user_id)
    VALUES (gen_random_uuid(), NEW.business_id, NEW.id, 'CREATED', NEW.updated_by_user_id);
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO lead_activities (id, business_id, lead_id, kind, actor_user_id, status)
    VALUES (gen_random_uuid(), NEW.business_id, NEW.id, 'STATUS_CHANGED', NEW.updated_by_user_id, NEW.status);
  END IF;
  IF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    INSERT INTO lead_activities (id, business_id, lead_id, kind, actor_user_id, metadata)
    VALUES (gen_random_uuid(), NEW.business_id, NEW.id, 'ASSIGNED', NEW.updated_by_user_id,
            jsonb_build_object('assigned', NEW.assigned_user_id IS NOT NULL));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER leads_activity AFTER INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_activity();
