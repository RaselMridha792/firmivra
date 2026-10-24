-- r1_admin_apply_profile_change (R1, Oct 24; Rasel's card at 15:35 UTC, from R56's draft in
-- docs/work/R56-super-admin-api.md on rasel/R56-admin-apply-profile-change): the Super Admin
-- applies an approved Request Change (a firm's support ticket, R60's Company Profile) to an ACTIVE
-- firm: its legal name, and its EIN sealed by the API with the firm's key. Admin scope cannot do
-- it directly: businesses_protected_columns lets admin scope change only status and slug, and
-- business_settings is written only in the firm's scope, which admin routes never open. So this
-- definer function does exactly these two writes, after its checks:
-- - only a Super Admin, from admin scope (not firm scope, not a support session);
-- - the ticket is this firm's, and the firm is ACTIVE (locked for the change);
-- - something to apply, the EIN sealed with its last 4 digits (never the EIN itself), a legal
--   name of 1 to 200 visible characters;
-- - p_fields names exactly what is applied, from {legalName, ein}, so the audit row holds field
--   names only and never a value.
-- The firm's own audit log gets one row here; the API writes the platform's. Licensing
-- (firm_licenses) is written by the API in admin scope, whose policies allow it.
-- Changes from R56's draft (R1's review): the admin-scope check, ACTIVE only (Rasel's card;
-- R56's draft also allowed SUSPENDED), the field-name check, the legal name's length and control
-- characters. Safe on dev: a new function only; nothing is altered.

CREATE FUNCTION app_admin_apply_profile_change(
  p_business_id uuid,
  p_ticket_id uuid,
  p_legal_name text,
  p_ein_enc bytea,
  p_ein_last4 text,
  p_fields text[]
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  admin_id uuid := app_current_admin_id();
  wanted text[] := ARRAY[]::text[];
BEGIN
  IF app_scope() IS DISTINCT FROM 'admin' OR NOT app_is_admin()
     OR p_business_id IS NULL OR p_ticket_id IS NULL THEN
    RAISE EXCEPTION 'apply profile change: only a Super Admin, from admin scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_legal_name IS NOT NULL THEN
    wanted := wanted || 'legalName'::text;
  END IF;
  IF p_ein_enc IS NOT NULL THEN
    wanted := wanted || 'ein'::text;
  END IF;
  IF cardinality(wanted) = 0
     OR (p_ein_enc IS NULL) <> (p_ein_last4 IS NULL)
     OR (p_ein_last4 IS NOT NULL AND p_ein_last4 !~ '^[0-9]{4}$')
     OR (p_ein_enc IS NOT NULL AND octet_length(p_ein_enc) = 0)
     OR (p_legal_name IS NOT NULL
         AND (char_length(btrim(p_legal_name)) NOT BETWEEN 1 AND 200
              OR p_legal_name ~ '[[:cntrl:]]'))
     -- The audit row's field names: exactly what is applied, each once.
     OR p_fields IS NULL OR cardinality(p_fields) <> cardinality(wanted)
     OR NOT (p_fields @> wanted AND wanted @> p_fields) THEN
    RAISE EXCEPTION 'apply profile change: nothing valid to apply'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM support_tickets t
   WHERE t.id = p_ticket_id AND t.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply profile change: no such ticket for this firm'
      USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM businesses b
   WHERE b.id = p_business_id AND b.status = 'ACTIVE'
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply profile change: only for an ACTIVE firm'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The legal name changes only in platform scope (businesses_protected_columns).
  IF p_legal_name IS NOT NULL THEN
    PERFORM set_config('app.scope', 'platform', true);
    UPDATE businesses SET legal_name = btrim(p_legal_name) WHERE id = p_business_id;
  END IF;

  -- The firm's scope for its settings row and its audit row only.
  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);
  IF p_ein_enc IS NOT NULL THEN
    UPDATE business_settings SET ein_enc = p_ein_enc, ein_last4 = p_ein_last4
     WHERE business_id = p_business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'apply profile change: the firm has no settings row'
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id,
                          metadata)
  VALUES (gen_random_uuid(), p_business_id, admin_id, 'settings.profile_change_applied',
          'support_ticket', p_ticket_id::text, jsonb_build_object('fields', to_jsonb(wanted)));

  -- Back to admin scope for the rest of the caller's transaction.
  PERFORM set_config('app.scope', 'admin', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

REVOKE ALL ON FUNCTION app_admin_apply_profile_change(uuid, uuid, text, bytea, text, text[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_admin_apply_profile_change(uuid, uuid, text, bytea, text, text[])
  TO firmivra_app;
