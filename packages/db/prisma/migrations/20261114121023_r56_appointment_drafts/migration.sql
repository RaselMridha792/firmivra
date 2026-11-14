-- Appointments Review 2, Save as Draft (Rasel's approval through the lead, Nov 14): the Schedule
-- Appointment form saved before it is booked. One member's own (the API scopes each read and
-- write to its author); RLS keeps it in its firm. Safe on dev: a new, empty table.

-- CreateTable
CREATE TABLE "appointment_drafts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_drafts_business_id_created_by_user_id_updated_a_idx" ON "appointment_drafts"("business_id", "created_by_user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_drafts_business_id_id_key" ON "appointment_drafts"("business_id", "id");

-- AddForeignKey
ALTER TABLE "appointment_drafts" ADD CONSTRAINT "appointment_drafts_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_drafts TO firmivra_app;
ALTER TABLE appointment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_drafts_business ON appointment_drafts
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- The form so far: a JSON object of at most 64 KB.
ALTER TABLE appointment_drafts ADD CONSTRAINT appointment_drafts_data
  CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 65536);
