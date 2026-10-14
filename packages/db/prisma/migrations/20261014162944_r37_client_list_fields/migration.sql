-- R37 (Rasel, Oct 14), Clients: the list (filters, cards, sorting) and the 360 header need a
-- client number ("CL-10024"), a status, a priority, a source, a client-since date and a
-- last-activity time on the client, and a history of status changes. The database gives each
-- client the firm's next number (from 10001, in order), keeps last_activity_at moving forward
-- (documents, requests, appointments and tax returns touch it; the API adds messages, invoices,
-- payments, notes and tasks, which belong to other modules), and records every status change.
-- Existing clients are numbered in the order they were made and are ACTIVE (INACTIVE when
-- archived). Tags and the contact opt-ins are the next migration.

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('NEW', 'PENDING_DOCUMENTS', 'IN_PROGRESS', 'ACTIVE', 'ON_HOLD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ClientPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "client_number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "client_since" DATE,
ADD COLUMN     "last_activity_at" TIMESTAMPTZ(3),
ADD COLUMN     "priority" "ClientPriority",
ADD COLUMN     "source" TEXT,
ADD COLUMN     "source_detail" TEXT,
ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "updated_by_user_id" UUID;

-- CreateTable
CREATE TABLE "client_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "ClientStatus" NOT NULL,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "client_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_status_history_business_id_client_id_seq_idx" ON "client_status_history"("business_id", "client_id", "seq");

-- CreateIndex
CREATE INDEX "client_status_history_business_id_changed_at_idx" ON "client_status_history"("business_id", "changed_at");

-- CreateIndex
CREATE INDEX "clients_business_id_status_idx" ON "clients"("business_id", "status");

-- CreateIndex
CREATE INDEX "clients_business_id_last_activity_at_idx" ON "clients"("business_id", "last_activity_at" DESC);

-- CreateIndex
CREATE INDEX "clients_business_id_source_idx" ON "clients"("business_id", "source");

-- CreateIndex
CREATE INDEX "clients_business_id_priority_idx" ON "clients"("business_id", "priority");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_status_history" ADD CONSTRAINT "client_status_history_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Existing clients (local and dev): numbers, status ----------
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
    UPDATE clients c SET client_number = n.rank + 10000
      FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rank
              FROM clients WHERE business_id = firm) n
     WHERE c.id = n.id AND c.business_id = firm;
    UPDATE clients
       SET status = CASE WHEN archived_at IS NULL THEN 'ACTIVE' ELSE 'INACTIVE' END::"ClientStatus"
     WHERE business_id = firm;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- The number is unique per firm; created after the numbers were filled in.
CREATE UNIQUE INDEX "clients_business_id_client_number_key" ON "clients"("business_id", "client_number");

-- ---------- Grants and RLS ----------
-- The app reads the history; the trigger below writes it (as the table owner).
GRANT SELECT ON client_status_history TO firmivra_app;
ALTER TABLE client_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY client_status_history_business ON client_status_history
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE clients ADD CONSTRAINT clients_number_positive CHECK (client_number >= 0);
ALTER TABLE clients ADD CONSTRAINT clients_source_text
  CHECK ((source IS NULL OR (char_length(btrim(source)) >= 1 AND char_length(source) <= 50
          AND app_no_hidden_characters(source)))
     AND (source_detail IS NULL OR (char_length(btrim(source_detail)) >= 1
          AND char_length(source_detail) <= 200 AND app_no_hidden_characters(source_detail))));

-- ---------- Rules ----------
-- The number is the firm's next, given here (a caller's is ignored) and never changed; the date
-- "client since" is not in the future; last_activity_at only moves forward.
CREATE FUNCTION clients_r37_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('client-number:' || NEW.business_id::text, 0));
    SELECT coalesce(max(c.client_number), 10000) + 1 INTO NEW.client_number
      FROM clients c WHERE c.business_id = NEW.business_id;
  ELSE
    IF NEW.client_number <> OLD.client_number THEN
      RAISE EXCEPTION 'clients: the client number is given by the database and never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.last_activity_at IS NOT NULL
       AND (NEW.last_activity_at IS NULL OR NEW.last_activity_at < OLD.last_activity_at) THEN
      NEW.last_activity_at := OLD.last_activity_at;
    END IF;
  END IF;
  IF NEW.client_since > current_date + 1 THEN
    RAISE EXCEPTION 'clients: client_since cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER clients_r37_rules
  BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_r37_rules();

-- A history row for a new client and for every change of status, by the author of that write
-- (updated_by_user_id). Written as the table owner (the app only reads).
CREATE FUNCTION clients_status_history() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;
  INSERT INTO client_status_history (business_id, client_id, status, changed_by_user_id)
  VALUES (NEW.business_id, NEW.id, NEW.status, NEW.updated_by_user_id);
  RETURN NULL;
END
$$;

CREATE TRIGGER clients_status_history
  AFTER INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_status_history();

-- Documents, requests, appointments and tax returns of a client touch its last activity. (Messages,
-- invoices, payments, notes and tasks belong to other modules: the API sets it for those.)
CREATE FUNCTION clients_touch_activity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE clients SET last_activity_at = clock_timestamp()
   WHERE business_id = NEW.business_id AND id = NEW.client_id
     AND (last_activity_at IS NULL OR last_activity_at < clock_timestamp());
  RETURN NULL;
END
$$;

CREATE TRIGGER documents_client_activity AFTER INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION clients_touch_activity();
CREATE TRIGGER document_requests_client_activity AFTER INSERT OR UPDATE OF status ON document_requests
  FOR EACH ROW EXECUTE FUNCTION clients_touch_activity();
CREATE TRIGGER appointments_client_activity AFTER INSERT OR UPDATE OF status, starts_at ON appointments
  FOR EACH ROW EXECUTE FUNCTION clients_touch_activity();
CREATE TRIGGER tax_returns_client_activity AFTER INSERT OR UPDATE OF workflow_status ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION clients_touch_activity();
