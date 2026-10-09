-- Support scope fixes (the #123 review, after it merged): app_enter_support_scope(firm) opened
-- the firm's full read-write scope, locked the grant FOR SHARE (support transactions could keep
-- entering ahead of a waiting revoke), checked expiry against the transaction's start, waited for
-- locks without limit and wrote no audit rows. Nothing calls it yet, so it is replaced by:
-- app_enter_support_scope(firm, view, ip, user_agent, request_id), which finds the signed-in
-- admin's live grant, holds it FOR NO KEY UPDATE (a revoke waits until this transaction ends, and
-- a support transaction that starts while a revoke waits queues behind it), writes the
-- platform's and the firm's audit rows, sets the firm's scope for the rest of the transaction and
-- makes the transaction read-only (R8: support views are read-only), so nothing in the firm can
-- change, not even a grant approved in the owner's name. Anything else raises
-- insufficient_privilege. The wall is the grant check plus read-only: the app role can still set
-- any scope itself (the API, not the database, keeps the admin site out of plain business
-- scopes; see the db README). Call it first in a read-write transaction (it locks a row and
-- writes the audit rows) and read in the same transaction afterwards. The lock-only policy
-- support_access_grants_support_lock (owner only, WITH CHECK false) covers FOR NO KEY UPDATE too.

DROP FUNCTION app_enter_support_scope(uuid);

CREATE FUNCTION app_enter_support_scope(
  p_business_id uuid,
  p_view text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  -- Behind a revoke or another support transaction, give up rather than hold a connection.
  SET lock_timeout = '2s'
  AS $$
DECLARE
  admin_id uuid := app_current_admin_id();
  grant_id uuid;
  until timestamptz;
BEGIN
  IF p_business_id IS NULL OR NOT app_is_admin() THEN
    RAISE EXCEPTION 'support scope: only a Super Admin, from admin scope, for one firm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_view IS NULL OR p_view !~ '^[a-z][a-z_]{0,39}$' THEN
    RAISE EXCEPTION 'support scope: name the support view (lower case, at most 40 characters)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- FOR NO KEY UPDATE, not FOR SHARE: share lockers could keep entering ahead of a waiting
  -- revoke. clock_timestamp(): the transaction may have started before the grant expired.
  SELECT g.id, g.expires_at INTO grant_id, until
    FROM support_access_grants g
   WHERE g.business_id = p_business_id
     AND g.admin_user_id = admin_id
     AND g.granted_by_user_id IS NOT NULL
     AND g.revoked_at IS NULL
     AND g.expires_at > clock_timestamp()
   ORDER BY g.expires_at DESC
   LIMIT 1
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support scope: no approved, unexpired support access to this firm'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The platform's row, still in admin scope: the person, the view and the request.
  INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id,
                          metadata, ip, user_agent, request_id)
  VALUES (gen_random_uuid(), NULL, admin_id, 'support.viewed', 'support_access_grant',
          grant_id::text, jsonb_build_object('businessId', p_business_id, 'view', p_view),
          left(p_ip, 64), left(p_user_agent, 512), left(p_request_id, 128));

  -- The firm's own scope for the rest of this transaction; admin scope's rights end here, and
  -- nothing set before the call (an actor, a user, an invite) carries into the firm.
  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);
  PERFORM set_config('app.current_admin_id', '', true);
  PERFORM set_config('app.current_actor_id', '', true);
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.invite_token_hash', '', true);

  -- The firm's row. The actor is the Super Admin, whom the firm's log shows only as Firmivra
  -- Support; no IP or user agent of theirs goes into the firm's log.
  INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id,
                          metadata, request_id)
  VALUES (gen_random_uuid(), p_business_id, admin_id, 'support.viewed', 'support_access_grant',
          grant_id::text, jsonb_build_object('view', p_view), left(p_request_id, 128));

  -- Read-only from here to the end of the transaction; nothing can turn it back.
  PERFORM set_config('transaction_read_only', 'on', true);
  RETURN until;
END
$$;

REVOKE ALL ON FUNCTION app_enter_support_scope(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enter_support_scope(uuid, text, text, text, text) TO firmivra_app;

-- platform_admins by its schema, so no table of the caller's search path stands in for it.
CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_current_admin_id() IS NOT NULL
               AND EXISTS (SELECT 1 FROM public.platform_admins pa
                           WHERE pa.user_id = app_current_admin_id() AND pa.role = 'SUPER_ADMIN') $$;
