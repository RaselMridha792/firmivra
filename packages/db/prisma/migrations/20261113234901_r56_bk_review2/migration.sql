-- R56 (Rasel's approval in R56's window, Nov 14): Octavia's Review 2 schema for Bookkeeping.
-- R01 a reconciliation's discrepancy note (who and when); E01b a Terms package from Services &
-- Pricing (bookkeeping_terms.catalog_service_id; deleting the service clears this column only);
-- N04 a note's type, related record and visibility (internal by default); RP03 the client's P&L
-- source; and R1's handoff, bookkeeping_opening_balances (one per account and date, RLS).
-- Safe on dev: new columns are nullable or have a constant default (catalog only), the new
-- table is empty, and the new checks pass on existing rows (all null or the default).

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "BookkeepingPnlSource" AS ENUM ('ACCOUNTING_SOFTWARE', 'MANUAL');

-- AlterTable
ALTER TABLE "bookkeeping_profiles" ADD COLUMN     "pnl_source" "BookkeepingPnlSource";

-- AlterTable
ALTER TABLE "bookkeeping_reconciliations" ADD COLUMN     "discrepancy_note" TEXT,
ADD COLUMN     "discrepancy_note_at" TIMESTAMPTZ(3),
ADD COLUMN     "discrepancy_note_by" UUID;

-- AlterTable
ALTER TABLE "bookkeeping_terms" ADD COLUMN     "catalog_service_id" UUID;

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "note_type" TEXT,
ADD COLUMN     "related_id" UUID,
ADD COLUMN     "related_kind" TEXT,
ADD COLUMN     "visibility" "NoteVisibility" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "bookkeeping_opening_balances" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookkeeping_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookkeeping_opening_balances_business_id_client_id_idx" ON "bookkeeping_opening_balances"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_opening_balances_business_id_account_id_as_of_key" ON "bookkeeping_opening_balances"("business_id", "account_id", "as_of");

-- CreateIndex
CREATE INDEX "bookkeeping_terms_business_id_catalog_service_id_idx" ON "bookkeeping_terms"("business_id", "catalog_service_id");

-- AddForeignKey
ALTER TABLE "bookkeeping_opening_balances" ADD CONSTRAINT "bookkeeping_opening_balances_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_opening_balances" ADD CONSTRAINT "bookkeeping_opening_balances_business_id_account_id_fkey" FOREIGN KEY ("business_id", "account_id") REFERENCES "bookkeeping_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_opening_balances" ADD CONSTRAINT "bookkeeping_opening_balances_business_id_created_by_user_i_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms" ADD CONSTRAINT "bookkeeping_terms_business_id_catalog_service_id_fkey" FOREIGN KEY ("business_id", "catalog_service_id") REFERENCES "services"("business_id", "id") ON DELETE SET NULL ("catalog_service_id") ON UPDATE CASCADE;

-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON bookkeeping_opening_balances TO firmivra_app;
ALTER TABLE bookkeeping_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_opening_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY bookkeeping_opening_balances_business ON bookkeeping_opening_balances
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- R01: a note of 1 to 2,000 characters, with who wrote it and when, all three or none.
ALTER TABLE bookkeeping_reconciliations ADD CONSTRAINT bookkeeping_reconciliations_discrepancy_note
  CHECK ((discrepancy_note IS NULL) = (discrepancy_note_by IS NULL)
     AND (discrepancy_note IS NULL) = (discrepancy_note_at IS NULL)
     AND (discrepancy_note IS NULL OR char_length(btrim(discrepancy_note)) BETWEEN 1 AND 2000));

-- N04: a short type; a related record as a known kind and an id together, or neither.
ALTER TABLE notes ADD CONSTRAINT notes_type_and_related
  CHECK ((note_type IS NULL OR char_length(btrim(note_type)) BETWEEN 1 AND 40)
     AND (related_kind IS NULL) = (related_id IS NULL)
     AND (related_kind IS NULL OR related_kind IN
          ('task', 'document', 'document_request', 'reconciliation', 'report', 'period',
           'appointment')));

-- Opening balances: the account is one of this client's (its engagement is the client's), and a
-- balance stays with its firm, client and account.
CREATE FUNCTION bookkeeping_opening_balances_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
                           OR NEW.account_id <> OLD.account_id) THEN
    RAISE EXCEPTION 'bookkeeping opening balances: the client and account of a balance cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bookkeeping_accounts a
    JOIN engagements e ON e.business_id = a.business_id AND e.id = a.engagement_id
    WHERE a.business_id = NEW.business_id AND a.id = NEW.account_id AND e.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'bookkeeping opening balances: the account is not this client''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_opening_balances_rules
  BEFORE INSERT OR UPDATE ON bookkeeping_opening_balances
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_opening_balances_rules();
