-- R1 (Rasel's card "Approve all four", Oct 29 11:19:57Z, third of four; Octavia's Automations
-- review AU-F31 and AU-F32): Manual Event Confirmation. One row per external event occurrence a
-- member reported by hand: what (module, event code, record), the occurrence (the engine's
-- automation_runs.source_event_key, unique per firm, so one confirmation per occurrence and no
-- bulk), who and when, the reference of the known outcome and optional evidence. Provider evidence
-- for the same occurrence may come later and is set once; the occurrence key is the same, so
-- completed actions never run again (automation_runs is unique per rule and key). The manual part
-- never changes and a row is never deleted (no DELETE grant). No backfill: a new table.
-- Safe on dev: a new table; the foreign keys take short locks on businesses, clients, memberships
-- and documents, which nothing here waits on.
-- CreateTable
CREATE TABLE "automation_event_confirmations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "source_module" "AutomationModule" NOT NULL,
    "event_code" TEXT NOT NULL,
    "record_kind" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "client_id" UUID,
    "confirmed_by_user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "note" TEXT,
    "evidence_document_id" UUID,
    "provider_verified_at" TIMESTAMPTZ(3),
    "provider_code" TEXT,
    "provider_reference" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_event_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_event_confirmations_business_id_record_kind_reco_idx" ON "automation_event_confirmations"("business_id", "record_kind", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_event_confirmations_business_id_id_key" ON "automation_event_confirmations"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_event_confirmations_business_id_occurrence_key_key" ON "automation_event_confirmations"("business_id", "occurrence_key");

-- AddForeignKey
ALTER TABLE "automation_event_confirmations" ADD CONSTRAINT "automation_event_confirmations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_event_confirmations" ADD CONSTRAINT "automation_event_confirmations_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_event_confirmations" ADD CONSTRAINT "automation_event_confirmations_business_id_confirmed_by_us_fkey" FOREIGN KEY ("business_id", "confirmed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_event_confirmations" ADD CONSTRAINT "automation_event_confirmations_business_id_evidence_docume_fkey" FOREIGN KEY ("business_id", "evidence_document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Access ----------
-- Read, add, and add the provider evidence: never deleted.
GRANT SELECT, INSERT, UPDATE ON automation_event_confirmations TO firmivra_app;
ALTER TABLE automation_event_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_event_confirmations FORCE ROW LEVEL SECURITY;
CREATE POLICY automation_event_confirmations_business ON automation_event_confirmations
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- The occurrence is the engine's key for this event code and record:
-- "<event code>:<record id>:<occurrence>", with an occurrence (a record id is 36 characters).
ALTER TABLE automation_event_confirmations ADD CONSTRAINT automation_event_confirmations_shape
  CHECK (char_length(event_code) BETWEEN 1 AND 100 AND btrim(event_code) = event_code
     AND char_length(record_kind) BETWEEN 1 AND 50
     AND char_length(occurrence_key) <= 300
     AND starts_with(occurrence_key, event_code || ':' || record_id::text || ':')
     AND char_length(occurrence_key) > char_length(event_code) + 38
     AND (reference IS NULL OR char_length(btrim(reference)) BETWEEN 1 AND 200)
     AND (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500));
-- Provider evidence comes whole: when, from which integration, and its reference.
ALTER TABLE automation_event_confirmations ADD CONSTRAINT automation_event_confirmations_provider
  CHECK ((provider_verified_at IS NULL) = (provider_code IS NULL)
     AND (provider_verified_at IS NULL) = (provider_reference IS NULL)
     AND (provider_code IS NULL OR char_length(provider_code) BETWEEN 1 AND 100)
     AND (provider_reference IS NULL OR char_length(btrim(provider_reference)) BETWEEN 1 AND 200));

-- The manual confirmation never changes; the provider evidence is added once, then kept.
CREATE FUNCTION automation_event_confirmations_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.business_id, NEW.source_module, NEW.event_code, NEW.record_kind, NEW.record_id,
      NEW.occurrence_key, NEW.client_id, NEW.confirmed_by_user_id, NEW.confirmed_at,
      NEW.reference, NEW.note, NEW.evidence_document_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.business_id, OLD.source_module, OLD.event_code, OLD.record_kind, OLD.record_id,
      OLD.occurrence_key, OLD.client_id, OLD.confirmed_by_user_id, OLD.confirmed_at,
      OLD.reference, OLD.note, OLD.evidence_document_id, OLD.created_at) THEN
    RAISE EXCEPTION 'automation event confirmations: a manual confirmation never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.provider_verified_at IS NOT NULL
     AND (NEW.provider_verified_at, NEW.provider_code, NEW.provider_reference)
         IS DISTINCT FROM (OLD.provider_verified_at, OLD.provider_code, OLD.provider_reference) THEN
    RAISE EXCEPTION 'automation event confirmations: provider evidence is set once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER automation_event_confirmations_rules
  BEFORE UPDATE ON automation_event_confirmations
  FOR EACH ROW EXECUTE FUNCTION automation_event_confirmations_rules();
