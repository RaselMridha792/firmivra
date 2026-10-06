-- T02 (lead's settings API, Rasel's yes, Oct 7): the setup wizard's Finish and the locked legal
-- name are enforced in the database, so the API never needs platform scope in a firm request.
-- (a) A firm may change its own status only from PENDING_SETUP to ACTIVE, and only once its
--     setup is finished (business_settings.setup_completed_at set). Every other status change,
--     and every slug change, stays platform-only.
-- (b) legal_name is locked for the firm, like slug (PROJECT-DRAFT: "legal name locked").
-- (c) business_settings.setup_completed_at is one-way: once set, it never changes or clears.
CREATE OR REPLACE FUNCTION businesses_protected_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'platform' THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.legal_name IS DISTINCT FROM OLD.legal_name THEN
    RAISE EXCEPTION 'businesses: slug and legal name change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (app_scope() = 'business' AND OLD.status = 'PENDING_SETUP' AND NEW.status = 'ACTIVE'
              AND EXISTS (SELECT 1 FROM business_settings s
                          WHERE s.business_id = NEW.id AND s.setup_completed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'businesses: status changes only in platform scope, except Finish (Pending Setup to Active once setup is done)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION business_settings_setup_done_once() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.setup_completed_at IS NOT NULL
     AND NEW.setup_completed_at IS DISTINCT FROM OLD.setup_completed_at THEN
    RAISE EXCEPTION 'business settings: setup_completed_at is set once and never changes or clears'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER business_settings_setup_done_once
  BEFORE UPDATE ON business_settings
  FOR EACH ROW EXECUTE FUNCTION business_settings_setup_done_once();
