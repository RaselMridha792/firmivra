-- CreateEnum
CREATE TYPE "ClientLinkRole" AS ENUM ('OWNER', 'RESPONSIBLE_PARTY', 'SPOUSE', 'FAMILY', 'PARTNER', 'RELATED_BUSINESS', 'OTHER');

-- AlterTable
ALTER TABLE "engagements" ADD COLUMN     "paused_at" TIMESTAMPTZ(3),
ADD COLUMN     "paused_by_user_id" UUID,
ADD COLUMN     "paused_reason" TEXT;

-- CreateTable
CREATE TABLE "client_links" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "linked_client_id" UUID NOT NULL,
    "role" "ClientLinkRole" NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_links_business_id_client_id_idx" ON "client_links"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "client_links_business_id_linked_client_id_idx" ON "client_links"("business_id", "linked_client_id");

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_business_id_paused_by_user_id_fkey" FOREIGN KEY ("business_id", "paused_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_business_id_linked_client_id_fkey" FOREIGN KEY ("business_id", "linked_client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Clients Review 2 (G9): a link's role and note can change; taking a link off deletes its row
-- (the API audits it).
GRANT SELECT, INSERT, UPDATE, DELETE ON client_links TO firmivra_app;
ALTER TABLE client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_links FORCE ROW LEVEL SECURITY;
CREATE POLICY client_links_business ON client_links
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- Never a client linked to itself, and one link per pair, whichever side added it.
ALTER TABLE client_links ADD CONSTRAINT client_links_not_self CHECK (client_id <> linked_client_id);
CREATE UNIQUE INDEX client_links_pair ON client_links
  (business_id, LEAST(client_id, linked_client_id), GREATEST(client_id, linked_client_id));
ALTER TABLE client_links ADD CONSTRAINT client_links_note
  CHECK (note IS NULL OR (char_length(btrim(note)) >= 1 AND char_length(note) <= 200
         AND app_no_hidden_characters(note)));

-- Clients Review 2 (G8): the generic service pause. When, why and by whom are set together or
-- not at all; the reason has words and at most 200 characters.
ALTER TABLE engagements ADD CONSTRAINT engagements_paused_together
  CHECK ((paused_at IS NULL) = (paused_reason IS NULL)
         AND (paused_at IS NULL) = (paused_by_user_id IS NULL));
ALTER TABLE engagements ADD CONSTRAINT engagements_paused_reason
  CHECK (paused_reason IS NULL OR (char_length(btrim(paused_reason)) >= 1
         AND char_length(paused_reason) <= 200 AND app_no_hidden_characters(paused_reason)));
