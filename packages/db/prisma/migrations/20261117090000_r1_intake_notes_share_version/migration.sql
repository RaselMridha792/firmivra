-- r1_intake_notes_share_version (R1, Intake Forms Review 2; the lead's approval of Nov 17 under
-- Rasel's delegation, one db-only PR merged on its own):
--   1. P4-16: a form's share link can be rotated. intake_templates.share_link_version is mixed into
--      the link token's HMAC; Rotate adds 1, so the old link stops at once (share_token_hash takes
--      the new token's hash) and a new link is made. 0 for every form today: today's links stay.
--   2. 24b-i: the firm's notes on an assigned form (an intake). Staff only: never shown to the
--      client, never in an email or a log; every row is its firm's (RLS, forced).

-- AlterTable
ALTER TABLE "intake_templates" ADD COLUMN     "share_link_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "intake_form_notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "intake_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "intake_form_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_form_notes_business_id_intake_id_created_at_idx" ON "intake_form_notes"("business_id", "intake_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "intake_form_notes_business_id_id_key" ON "intake_form_notes"("business_id", "id");

-- AddForeignKey
ALTER TABLE "intake_form_notes" ADD CONSTRAINT "intake_form_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_form_notes" ADD CONSTRAINT "intake_form_notes_business_id_intake_id_fkey" FOREIGN KEY ("business_id", "intake_id") REFERENCES "intakes"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_form_notes" ADD CONSTRAINT "intake_form_notes_business_id_author_user_id_fkey" FOREIGN KEY ("business_id", "author_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------
-- Every note is its firm's; the client roles get no grant at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_form_notes TO firmivra_app;
ALTER TABLE intake_form_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_form_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_form_notes_business ON intake_form_notes
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- A note has words: 1 to 2000 characters, no hidden characters.
ALTER TABLE intake_form_notes ADD CONSTRAINT intake_form_notes_body
  CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 2000
         AND app_no_hidden_characters(body));
-- A link generation is never negative.
ALTER TABLE intake_templates ADD CONSTRAINT intake_templates_share_link_version
  CHECK (share_link_version >= 0);
