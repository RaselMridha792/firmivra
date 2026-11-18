-- r1_intake_template_restore (R1, Intake Forms Review 2 24c-i; the lead's approval of Nov 17
-- under Rasel's delegation, one db-only PR merged on its own): Restore for an archived form or
-- template. Only the archived -> live direction is relaxed:
--   - an archived template may come back (archived_at back to NULL), never re-dated;
--   - the update that restores it can't make it the service's default (it comes back as an
--     ordinary template; intake_templates_default_live still refuses an archived default);
--   - everything else stays: its firm, service and maker never change. Sent forms keep their own
--     version, so nothing they point at changes.
CREATE OR REPLACE FUNCTION intake_templates_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.service_id <> OLD.service_id
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'intake templates: the service and maker of a template cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL
     AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'intake templates: an archived template keeps its archive time; restore it instead'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NEW.service_default THEN
    RAISE EXCEPTION 'intake templates: a restored template comes back as an ordinary template, not the default'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
