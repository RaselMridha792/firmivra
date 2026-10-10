-- The firm's own record of a Super Admin's support ask (R21, issue #215). The ask runs in admin
-- scope, where the audit log takes only platform rows, and the admin site never opens a plain
-- business scope (R8). So the API calls app_log_support_request(firm, grant) inside the ask's
-- transaction, and the firm's row commits with the ask or not at all.
--
-- The function checks that the caller is a Super Admin in admin scope and that the grant is that
-- admin's own still-pending request for that firm, locked FOR NO KEY UPDATE (the lock-only policy
-- support_access_grants_support_lock lets the owner take it), so a second call for the same
-- request waits and then finds its row. It writes exactly one firm row per request:
-- action support.requested, entity support_access_grant / the grant, actor the admin (the firm's
-- log shows Firmivra Support), no IP or user agent, metadata {} (ids only, no person). For that
-- one insert it switches to the firm's business scope, as app_enter_support_scope does, and then
-- switches back to admin scope, so the rest of the transaction keeps admin scope's rights only.
-- Anything else raises insufficient_privilege; a second row for the same request raises
-- unique_violation.

CREATE FUNCTION app_log_support_request(p_business_id uuid, p_grant_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  admin_id uuid := app_current_admin_id();
BEGIN
  IF p_business_id IS NULL OR p_grant_id IS NULL OR NOT app_is_admin() THEN
    RAISE EXCEPTION 'support request log: only a Super Admin, from admin scope, for one request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1
    FROM support_access_grants g
   WHERE g.id = p_grant_id
     AND g.business_id = p_business_id
     AND g.admin_user_id = admin_id
     AND g.granted_by_user_id IS NULL
     AND g.revoked_at IS NULL
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support request log: no pending support request of yours for this firm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The firm's scope for this one insert only (and the check that it is the first row).
  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);

  PERFORM 1 FROM audit_logs a
   WHERE a.business_id = p_business_id
     AND a.action = 'support.requested'
     AND a.entity_type = 'support_access_grant'
     AND a.entity_id = p_grant_id::text;
  IF FOUND THEN
    RAISE EXCEPTION 'support request log: this request is already in the firm''s log'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id,
                          metadata)
  VALUES (gen_random_uuid(), p_business_id, admin_id, 'support.requested',
          'support_access_grant', p_grant_id::text, '{}'::jsonb);

  -- Back to admin scope for the rest of the transaction.
  PERFORM set_config('app.scope', 'admin', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

REVOKE ALL ON FUNCTION app_log_support_request(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_log_support_request(uuid, uuid) TO firmivra_app;
