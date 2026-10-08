-- Support access, the database's side (R8, Rasel's Oct 6 rule): a Super Admin reaches a firm's
-- data only through an approved, unexpired, unrevoked grant the firm's owner gave them.
-- app_enter_support_scope(firm) is the one way from admin scope into that firm's business scope:
-- it finds the signed-in admin's live grant, holds it (a revoke waits until this transaction
-- ends), and only then sets the firm's scope for the rest of the transaction, so every business
-- policy applies unchanged. Anything else raises insufficient_privilege.

-- The function runs as the table owner and locks the grant FOR SHARE, which needs an UPDATE
-- policy to pass: this one, for the owner only, on the admin's own grants, and it never lets a
-- row change (WITH CHECK false). The app role has no use of it.
CREATE POLICY support_access_grants_support_lock ON support_access_grants FOR UPDATE TO CURRENT_USER
  USING (app_is_admin() AND admin_user_id = app_current_admin_id())
  WITH CHECK (false);

CREATE FUNCTION app_enter_support_scope(p_business_id uuid)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  admin_id uuid := app_current_admin_id();
  until timestamptz;
BEGIN
  IF p_business_id IS NULL OR NOT app_is_admin() THEN
    RAISE EXCEPTION 'support scope: only a Super Admin, from admin scope, for one firm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT g.expires_at INTO until
    FROM support_access_grants g
   WHERE g.business_id = p_business_id
     AND g.admin_user_id = admin_id
     AND g.granted_by_user_id IS NOT NULL
     AND g.revoked_at IS NULL
     AND g.expires_at > now()
   ORDER BY g.expires_at DESC
   LIMIT 1
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support scope: no approved, unexpired support access to this firm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The firm's own scope for the rest of this transaction; admin scope's rights end here.
  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);
  RETURN until;
END
$$;

REVOKE ALL ON FUNCTION app_enter_support_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enter_support_scope(uuid) TO firmivra_app;
