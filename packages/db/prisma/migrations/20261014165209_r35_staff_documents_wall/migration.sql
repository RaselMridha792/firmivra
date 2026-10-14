-- r35_staff_documents_wall (R35, Rasel Oct 14): staff documents (W-4, direct deposit, licenses)
-- get the same wall as pay: only the session's acting Owner or Admin reads or changes a row
-- (app_actor_is_firm_manager(), from r35_staff_pay_drafts), on top of the firm policy.
-- One narrow exception for the document scanner, which has no actor: it sees only rows still
-- PENDING in its firm (or scanned within the last five minutes: PostgreSQL checks the updated row
-- against the read policy too, so the scanner must still see the row it just scanned), and may
-- change only scan_status and scanned_at. It cannot insert, delete, read an older scanned row or
-- change any other column (staff_documents_rules). It must update with updateMany: update()
-- would read the row back, which is not allowed after the minutes are up.

DROP POLICY staff_documents_business ON staff_documents;

CREATE POLICY staff_documents_manager ON staff_documents
  USING (business_id = app_current_business_id() AND app_actor_is_firm_manager())
  WITH CHECK (business_id = app_current_business_id() AND app_actor_is_firm_manager());

-- The scanner: no actor. SELECT and UPDATE only, on PENDING rows of the firm in scope.
CREATE POLICY staff_documents_scanner_select ON staff_documents FOR SELECT
  USING (business_id = app_current_business_id() AND app_current_actor_id() IS NULL
         AND (scan_status = 'PENDING'
              OR scanned_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'));
CREATE POLICY staff_documents_scanner_update ON staff_documents FOR UPDATE
  USING (business_id = app_current_business_id() AND app_current_actor_id() IS NULL
         AND scan_status = 'PENDING')
  WITH CHECK (business_id = app_current_business_id() AND app_current_actor_id() IS NULL);

-- Same rules as before, plus: without an actor only the scan result can change.
CREATE OR REPLACE FUNCTION staff_documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  changed text[] := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
BEGIN
  IF NOT changed <@ ARRAY['type', 'archived_at', 'scan_status', 'scanned_at'] THEN
    RAISE EXCEPTION 'staff_documents: only type, archived_at and the scan result can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF app_current_actor_id() IS NULL AND NOT changed <@ ARRAY['scan_status', 'scanned_at'] THEN
    RAISE EXCEPTION 'staff_documents: without an acting Owner or Admin only the scan result can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF changed && ARRAY['scan_status', 'scanned_at'] AND OLD.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'staff_documents: a scan result cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'staff_documents: an archived document stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
