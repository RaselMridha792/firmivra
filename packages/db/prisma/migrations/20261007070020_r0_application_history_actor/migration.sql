-- Firm application history (Rasel, Oct 6): every row records who made the change and the reason
-- or message that went with it, from this update only.
-- - changed_by_user_id: the acting Super Admin in admin scope (db.forAdmin), taken from the scope,
--   not from the row. NULL in platform scope: the applicant's submission or provisioning.
--   Before, a later platform change was credited to whoever last reviewed.
-- - reason: decision_reason when this update sets it, or when the decision is INFO_REQUESTED or
--   DECLINED (which now need a message). Before, an approval repeated an older info request's text.
-- - A new message on the same status (a second info request) is also a history row.
-- R4: in admin scope, set status, reviewedByUserId (the acting admin), reviewedAt and
-- decisionReason (the message to the applicant) in one update. See docs/work/R0-schema.md.

CREATE OR REPLACE FUNCTION firm_applications_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  message_changed boolean :=
    TG_OP = 'INSERT' OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status
     OR (message_changed AND NEW.decision_reason IS NOT NULL) THEN
    INSERT INTO firm_application_status_history
      (application_id, from_status, to_status, changed_by_user_id, reason)
    VALUES
      (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
       app_current_admin_id(),
       CASE WHEN message_changed OR NEW.status IN ('INFO_REQUESTED', 'DECLINED')
            THEN NEW.decision_reason END);
  END IF;
  RETURN NULL;
END
$$;

-- A review changes only the decision: status, notes, reason and who reviewed when. The applicant's
-- details and the link to the provisioned firm (set by provisioning, in platform scope) stay.
-- Requesting info or declining needs a message for the applicant.
CREATE OR REPLACE FUNCTION firm_applications_admin_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'admin' THEN
    IF NEW.id <> OLD.id OR NEW.legal_name <> OLD.legal_name
       OR NEW.dba_name IS DISTINCT FROM OLD.dba_name OR NEW.contact_name <> OLD.contact_name
       OR NEW.contact_email <> OLD.contact_email OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
       OR NEW.data <> OLD.data OR NEW.business_id IS DISTINCT FROM OLD.business_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'firm applications: a review changes only the decision, never the application'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> OLD.status
       AND (NEW.reviewed_by_user_id IS DISTINCT FROM app_current_admin_id() OR NEW.reviewed_at IS NULL) THEN
      RAISE EXCEPTION 'firm applications: a decision is recorded as the acting admin, with reviewed_at'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('INFO_REQUESTED', 'DECLINED')
       AND (NEW.status <> OLD.status OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason)
       AND coalesce(btrim(NEW.decision_reason), '') = '' THEN
      RAISE EXCEPTION 'firm applications: requesting info or declining needs a message (decision_reason)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
