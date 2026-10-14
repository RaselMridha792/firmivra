-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('EMAIL', 'SMS', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "SegmentType" AS ENUM ('DYNAMIC', 'STATIC');

-- CreateEnum
CREATE TYPE "SegmentAudience" AS ENUM ('CLIENTS', 'LEADS', 'BOTH');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT', 'BOUNCED', 'INVALID', 'COMPLAINED');

-- CreateTable
CREATE TABLE "communication_segments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "SegmentType" NOT NULL,
    "audience" "SegmentAudience" NOT NULL DEFAULT 'CLIENTS',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "criteria_summary" TEXT,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "last_refreshed_at" TIMESTAMPTZ(3),
    "owner_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_segment_members" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "client_id" UUID,
    "lead_id" UUID,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_segment_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_consents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID,
    "lead_id" UUID,
    "channel" "CommunicationChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "source_communication_id" UUID,
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_segments_business_id_type_idx" ON "communication_segments"("business_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "communication_segments_business_id_id_key" ON "communication_segments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_segments_business_id_name_key" ON "communication_segments"("business_id", "name");

-- CreateIndex
CREATE INDEX "communication_segment_members_business_id_client_id_idx" ON "communication_segment_members"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "communication_segment_members_business_id_lead_id_idx" ON "communication_segment_members"("business_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_segment_members_segment_id_client_id_key" ON "communication_segment_members"("segment_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_segment_members_segment_id_lead_id_key" ON "communication_segment_members"("segment_id", "lead_id");

-- CreateIndex
CREATE INDEX "communication_consents_business_id_channel_status_idx" ON "communication_consents"("business_id", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "communication_consents_business_id_client_id_channel_key" ON "communication_consents"("business_id", "client_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "communication_consents_business_id_lead_id_channel_key" ON "communication_consents"("business_id", "lead_id", "channel");

-- AddForeignKey
ALTER TABLE "communication_segment_members" ADD CONSTRAINT "communication_segment_members_business_id_segment_id_fkey" FOREIGN KEY ("business_id", "segment_id") REFERENCES "communication_segments"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_segment_members" ADD CONSTRAINT "communication_segment_members_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_segment_members" ADD CONSTRAINT "communication_segment_members_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: segments are archived and consents are updated, never deleted; list members come and go.
GRANT SELECT, INSERT, UPDATE ON communication_segments, communication_consents TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON communication_segment_members TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['communication_segments', 'communication_segment_members', 'communication_consents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE communication_segments ADD CONSTRAINT communication_segments_values
  CHECK (esign_text_ok(name, 120) AND (description IS NULL OR esign_text_ok(description, 500))
         AND (criteria_summary IS NULL OR esign_text_ok(criteria_summary, 500))
         AND jsonb_typeof(criteria) = 'object' AND pg_column_size(criteria) <= 20000
         AND member_count >= 0);

-- A member is exactly one client or one lead.
ALTER TABLE communication_segment_members ADD CONSTRAINT communication_segment_members_one
  CHECK (num_nonnulls(client_id, lead_id) = 1);
ALTER TABLE communication_consents ADD CONSTRAINT communication_consents_values
  CHECK (num_nonnulls(client_id, lead_id) = 1 AND channel <> 'ANNOUNCEMENT'
         AND source ~ '^[a-z][a-z0-9_]{0,39}$');

-- Only a STATIC list holds saved members, and a client or lead only joins a list for its audience.
CREATE FUNCTION communication_segment_members_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  seg communication_segments%ROWTYPE;
BEGIN
  SELECT * INTO seg FROM communication_segments s
   WHERE s.business_id = NEW.business_id AND s.id = NEW.segment_id;
  IF seg.type <> 'STATIC' THEN
    RAISE EXCEPTION 'SEGMENT_NOT_STATIC: only a static list holds saved members'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.client_id IS NOT NULL AND seg.audience = 'LEADS')
     OR (NEW.lead_id IS NOT NULL AND seg.audience = 'CLIENTS') THEN
    RAISE EXCEPTION 'SEGMENT_AUDIENCE: the list is for % only', seg.audience
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER communication_segment_members_guard BEFORE INSERT ON communication_segment_members
  FOR EACH ROW EXECUTE FUNCTION communication_segment_members_guard();
