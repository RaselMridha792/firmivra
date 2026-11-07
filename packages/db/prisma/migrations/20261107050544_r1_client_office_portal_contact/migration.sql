-- R1 (Rasel's approval in R1's window, Nov 7: Locations, PRT-1 and PRT-3 of the client portal
-- guide). PRT-1: a client's local office. The person picks one of the firm's active locations at
-- registration (client_accounts.selected_office_id); the client record holds the assigned office
-- (clients.office_id), taken from that choice on approval, and staff may reassign it. PRT-3: the
-- firm's Contact Information switches (client_portal_settings, one row per firm; no row means the
-- defaults): show the corporate office, show the client's local office, and which contact methods
-- the portal offers. No backfill: existing rows keep NULL offices, and no firm has a settings row.
-- Safe on dev: the ADD COLUMNs are nullable with no default (catalog only); the index and the
-- foreign keys read clients and client_accounts once; the new table is empty.

-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "selected_office_id" UUID;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "office_id" UUID;

-- CreateTable
CREATE TABLE "client_portal_settings" (
    "business_id" UUID NOT NULL,
    "show_corporate_office" BOOLEAN NOT NULL DEFAULT true,
    "show_local_office" BOOLEAN NOT NULL DEFAULT true,
    "allow_phone" BOOLEAN NOT NULL DEFAULT true,
    "allow_sms" BOOLEAN NOT NULL DEFAULT false,
    "allow_email" BOOLEAN NOT NULL DEFAULT true,
    "allow_secure_message" BOOLEAN NOT NULL DEFAULT true,
    "allow_appointment_link" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_portal_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "clients_business_id_office_id_idx" ON "clients"("business_id", "office_id");

-- AddForeignKey
ALTER TABLE "client_accounts" ADD CONSTRAINT "client_accounts_business_id_selected_office_id_fkey" FOREIGN KEY ("business_id", "selected_office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE ON client_portal_settings TO firmivra_app;
ALTER TABLE client_portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_portal_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY client_portal_settings_business ON client_portal_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- An office is chosen or assigned only while it is an active, unarchived location. Later
-- deactivation keeps the choice (the location guide: deactivating hides it for new choices only).
CREATE FUNCTION app_office_assignable(p_business uuid, p_office uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM firm_offices o
                        WHERE o.business_id = p_business AND o.id = p_office
                          AND o.status = 'ACTIVE' AND o.archived_at IS NULL) $$;

CREATE FUNCTION clients_office_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.office_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.office_id IS DISTINCT FROM OLD.office_id)
     AND NOT app_office_assignable(NEW.business_id, NEW.office_id) THEN
    RAISE EXCEPTION 'clients: an office is assigned only while it is an active location'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER clients_office_rules
  BEFORE INSERT OR UPDATE OF office_id ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_office_rules();

CREATE FUNCTION client_accounts_office_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.selected_office_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.selected_office_id IS DISTINCT FROM OLD.selected_office_id)
     AND NOT app_office_assignable(NEW.business_id, NEW.selected_office_id) THEN
    RAISE EXCEPTION 'client accounts: an office is chosen only while it is an active location'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_accounts_office_rules
  BEFORE INSERT OR UPDATE OF selected_office_id ON client_accounts
  FOR EACH ROW EXECUTE FUNCTION client_accounts_office_rules();
