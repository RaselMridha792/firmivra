-- One rule for who may change which column of businesses, now that both parts exist:
-- r0_admin_scope (Super Admin: status and slug only) and #46's r0_firm_setup_rules (the firm's
-- Finish: PENDING_SETUP to ACTIVE once setup is done; legal name locked). r0_admin_scope replaces
-- the function, so this restates the whole rule after it.
-- - platform scope (provisioning): any column.
-- - admin scope (Super Admin): only status and slug; nothing else on the row.
-- - the firm (business scope): name and the other firm-owned fields. Never id, slug, legal name,
--   KMS key, business type or pack. Status only by Finish, from PENDING_SETUP to ACTIVE, once
--   business_settings.setup_completed_at is set.
CREATE OR REPLACE FUNCTION businesses_protected_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'platform' THEN
    RETURN NEW;
  END IF;
  IF app_scope() = 'admin' THEN
    IF NEW.id <> OLD.id OR NEW.name <> OLD.name OR NEW.legal_name IS DISTINCT FROM OLD.legal_name
       OR NEW.terms_url IS DISTINCT FROM OLD.terms_url OR NEW.privacy_url IS DISTINCT FROM OLD.privacy_url
       OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
       OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack <> OLD.pack
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'businesses: Super Admin changes only status and slug'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.legal_name IS DISTINCT FROM OLD.legal_name THEN
    RAISE EXCEPTION 'businesses: slug and legal name change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
     OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack IS DISTINCT FROM OLD.pack THEN
    RAISE EXCEPTION 'businesses: the KMS key, business type and pack change only in platform scope'
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
