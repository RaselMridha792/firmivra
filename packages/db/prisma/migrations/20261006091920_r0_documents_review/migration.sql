-- AlterTable
ALTER TABLE "engagement_reports" ADD COLUMN     "first_published_at" TIMESTAMPTZ(3);


-- ==================== R0 step 5a: review fixes for PR #22 (lead, Oct 6) ====================
-- 1. Documents live under tenant/<business_id>/ (docs/SYSTEM-DESIGN.md, the deployed IAM policy).
-- 2. s3_key and the upload columns never change after insert.
-- 3. retention_until only moves later; NULL (keep for good) never becomes a date.
-- 4. A report that was ever published is never deleted (first_published_at, never cleared).

-- ---------- 1. S3 prefix ----------
ALTER TABLE documents DROP CONSTRAINT documents_s3_key_firm_prefix;
ALTER TABLE documents ADD CONSTRAINT documents_s3_key_firm_prefix
  CHECK (starts_with(s3_key, 'tenant/' || business_id::text || '/'));

-- ---------- 2 and 3. Document rules ----------
-- Same as in r0_documents, plus: the S3 key and content type are fixed like the rest of the
-- upload (R5 records the scan result on the row and never moves objects), and retention can
-- only be extended. Clearing legal_hold stays allowed (the API limits it to managers and audits
-- it); since retention cannot move earlier, that never unlocks an early delete.
CREATE OR REPLACE FUNCTION documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'documents: a new document starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'CLIENT_TO_FIRM' AND NOT EXISTS (
      SELECT 1 FROM engagements e
      WHERE e.id = NEW.engagement_id AND e.status IN ('PENDING', 'ACTIVE')
    ) THEN
      RAISE EXCEPTION 'documents: a client can upload only to an open engagement'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.engagement_id <> OLD.engagement_id OR NEW.direction <> OLD.direction
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'documents: the file, its S3 key, its engagement and its uploader cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'documents: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Retention only moves later: a date can become a later date or NULL (keep for good), but
  -- NULL never becomes a date and a date never becomes earlier.
  IF (OLD.retention_until IS NULL AND NEW.retention_until IS NOT NULL)
     OR NEW.retention_until < OLD.retention_until THEN
    RAISE EXCEPTION 'documents: retention_until can only move later'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------- 4. Reports that were ever published ----------
-- Record the first publication of reports already published (rows exist on dev since #17).
-- The migration role sees rows only inside a scope (forced RLS), so set each firm's scope in turn.
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
    UPDATE engagement_reports SET first_published_at = published_at
      WHERE status = 'PUBLISHED' AND first_published_at IS NULL;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- The database sets first_published_at on the first publication and never lets it change.
CREATE FUNCTION engagement_reports_first_published() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_published_at IS NOT NULL THEN
    IF NEW.first_published_at IS DISTINCT FROM OLD.first_published_at THEN
      RAISE EXCEPTION 'engagement reports: first_published_at cannot change or be cleared'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'PUBLISHED' THEN
    NEW.first_published_at := NEW.published_at;
  ELSIF NEW.first_published_at IS NOT NULL THEN
    RAISE EXCEPTION 'engagement reports: first_published_at is set by the database on first publication'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER engagement_reports_first_published
  BEFORE INSERT OR UPDATE ON engagement_reports
  FOR EACH ROW EXECUTE FUNCTION engagement_reports_first_published();

-- Only a report that was never published can be deleted.
DROP POLICY engagement_reports_delete_draft ON engagement_reports;
CREATE POLICY engagement_reports_delete_never_published ON engagement_reports FOR DELETE
  USING (business_id = app_current_business_id() AND first_published_at IS NULL);
