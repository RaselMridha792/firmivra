-- Lead's review of #32 (Oct 7), tax returns and client profiles.
-- 1. Delete gap: the delete policy read the current status, so a FILED, ACCEPTED, REJECTED or
--    COMPLETED return could be set back to IN_PROGRESS and then deleted, leaving no record. Now
--    the database stamps first_filed_at the first time a return leaves IN_PROGRESS (like
--    engagement_reports.first_published_at): the app can't set, change or clear it, and only a
--    return that was never filed can be deleted.
-- 2. client_profiles.additional_info can't be blank (like referral_source).
-- Not added: a unique index per client, year, filing type, quarter and form. An amended return is
-- its own row (form 1040-X), and the firm may need two rows for one form in rare cases.

-- AlterTable
ALTER TABLE "tax_returns" ADD COLUMN     "first_filed_at" TIMESTAMPTZ(3);

DROP POLICY tax_returns_delete ON tax_returns;
CREATE POLICY tax_returns_delete ON tax_returns FOR DELETE
  USING (business_id = app_current_business_id() AND status = 'IN_PROGRESS'
         AND first_filed_at IS NULL);

CREATE OR REPLACE FUNCTION tax_returns_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.first_filed_at IS NOT NULL THEN
    RAISE EXCEPTION 'tax returns: first_filed_at is set by the database'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id THEN
      RAISE EXCEPTION 'tax returns: a return cannot change client' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.first_filed_at IS DISTINCT FROM OLD.first_filed_at THEN
      RAISE EXCEPTION 'tax returns: first_filed_at cannot change or be cleared'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status <> 'IN_PROGRESS' AND NEW.first_filed_at IS NULL THEN
    NEW.first_filed_at := now();
  END IF;
  IF NEW.document_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.document_id IS DISTINCT FROM OLD.document_id)
     AND NOT EXISTS (SELECT 1 FROM documents d
                     WHERE d.business_id = NEW.business_id AND d.id = NEW.document_id
                       AND d.client_id = NEW.client_id AND d.direction <> 'INTERNAL') THEN
    RAISE EXCEPTION 'tax returns: the return document must be one of this client''s documents, not an internal one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.filed_on > current_date + 1 THEN
    RAISE EXCEPTION 'tax returns: filed_on cannot be in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE client_profiles DROP CONSTRAINT client_profiles_additional_info;
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_additional_info
  CHECK (btrim(additional_info) <> '' AND char_length(additional_info) <= 2000);
