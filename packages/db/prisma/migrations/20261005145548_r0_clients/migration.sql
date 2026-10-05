-- CreateEnum
CREATE TYPE "ClientPortalRole" AS ENUM ('PRIMARY', 'SPOUSE', 'AUTHORIZED');

-- AlterEnum
ALTER TYPE "ClientAccountStatus" ADD VALUE 'INVITED';

-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "client_id" UUID,
ADD COLUMN     "decline_reason" TEXT,
ADD COLUMN     "declined_at" TIMESTAMPTZ(3),
ADD COLUMN     "declined_by_user_id" UUID,
ADD COLUMN     "portal_role" "ClientPortalRole" NOT NULL DEFAULT 'PRIMARY';

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "account_type" "ClientAccountType" NOT NULL DEFAULT 'INDIVIDUAL',
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "assigned_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profiles" (
    "client_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "first_name" TEXT,
    "middle_name" TEXT,
    "last_name" TEXT,
    "preferred_name" TEXT,
    "business_name" TEXT,
    "entity_type" TEXT,
    "dob_enc" BYTEA,
    "ssn_enc" BYTEA,
    "ssn_last4" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("client_id")
);

-- CreateTable
CREATE TABLE "client_tax_statuses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "tax_status_id" UUID NOT NULL,
    "client_note" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_tax_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tax_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "tax_status_id" UUID NOT NULL,
    "client_note" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tax_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_business_id_display_name_idx" ON "clients"("business_id", "display_name");

-- CreateIndex
CREATE INDEX "clients_business_id_email_idx" ON "clients"("business_id", "email");

-- CreateIndex
CREATE INDEX "clients_business_id_assigned_user_id_idx" ON "clients"("business_id", "assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_business_id_id_key" ON "clients"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_business_id_client_id_key" ON "client_profiles"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "client_tax_statuses_business_id_tax_status_id_idx" ON "client_tax_statuses"("business_id", "tax_status_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_tax_statuses_business_id_client_id_tax_year_key" ON "client_tax_statuses"("business_id", "client_id", "tax_year");

-- CreateIndex
CREATE INDEX "client_tax_status_history_business_id_client_id_tax_year_ch_idx" ON "client_tax_status_history"("business_id", "client_id", "tax_year", "changed_at");

-- CreateIndex
CREATE INDEX "client_accounts_business_id_client_id_idx" ON "client_accounts"("business_id", "client_id");

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tax_statuses" ADD CONSTRAINT "client_tax_statuses_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tax_statuses" ADD CONSTRAINT "client_tax_statuses_business_id_tax_status_id_fkey" FOREIGN KEY ("business_id", "tax_status_id") REFERENCES "tax_statuses"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tax_status_history" ADD CONSTRAINT "client_tax_status_history_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tax_status_history" ADD CONSTRAINT "client_tax_status_history_business_id_tax_status_id_fkey" FOREIGN KEY ("business_id", "tax_status_id") REFERENCES "tax_statuses"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 3: row-level security and data rules ====================
-- Clients, client profiles, client tax status per year and its history.

-- ---------- Grants ----------
-- Client records are kept for retention (tax: 7 years): archived, never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON clients, client_profiles, client_tax_statuses TO firmivra_app;
-- History is written by the trigger below (as the app role) and never changed.
GRANT SELECT, INSERT ON client_tax_status_history TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE clients                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                   FORCE ROW LEVEL SECURITY;
ALTER TABLE client_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_profiles           FORCE ROW LEVEL SECURITY;
ALTER TABLE client_tax_statuses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tax_statuses       FORCE ROW LEVEL SECURITY;
ALTER TABLE client_tax_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tax_status_history FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY clients_business ON clients
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY client_profiles_business ON client_profiles
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY client_tax_statuses_business ON client_tax_statuses
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY client_tax_status_history_business ON client_tax_status_history
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE clients ADD CONSTRAINT clients_email_lowercase CHECK (email = lower(email));
ALTER TABLE clients ADD CONSTRAINT clients_display_name_not_blank CHECK (btrim(display_name) <> '');
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_ssn_last4
  CHECK (ssn_last4 ~ '^[0-9]{4}$');
ALTER TABLE client_tax_statuses ADD CONSTRAINT client_tax_statuses_tax_year
  CHECK (tax_year BETWEEN 2000 AND 2100);

-- Every change of a client's tax status (or of the note shown to the client) gets a history row.
-- The client and year of a row never change, and an archived tax status cannot be assigned.
CREATE FUNCTION client_tax_statuses_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
       OR NEW.tax_year <> OLD.tax_year THEN
      RAISE EXCEPTION 'client tax status: the client and tax year of a row cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tax_status_id = OLD.tax_status_id AND NEW.client_note IS NOT DISTINCT FROM OLD.client_note THEN
      RETURN NEW;
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.tax_status_id <> OLD.tax_status_id)
     AND EXISTS (SELECT 1 FROM tax_statuses t
                 WHERE t.id = NEW.tax_status_id AND t.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'client tax status: an archived tax status cannot be assigned'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO client_tax_status_history
    (business_id, client_id, tax_year, tax_status_id, client_note, changed_by_user_id)
  VALUES
    (NEW.business_id, NEW.client_id, NEW.tax_year, NEW.tax_status_id, NEW.client_note, NEW.updated_by_user_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER client_tax_statuses_history
  AFTER INSERT OR UPDATE ON client_tax_statuses
  FOR EACH ROW EXECUTE FUNCTION client_tax_statuses_history();
