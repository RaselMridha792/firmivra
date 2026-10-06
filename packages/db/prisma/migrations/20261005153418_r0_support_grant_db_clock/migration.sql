-- Support access approval: the 72-hour limit is judged by the database clock only (Rasel, Oct 5).
-- The API sends expires_at from its own clock. When that clock ran slightly ahead, an approval
-- for exactly 72 hours failed. Now an expiry up to 1 minute past now() + 72 hours is stored as
-- exactly now() + 72 hours, so a grant still never lasts longer; anything later is refused.
-- Only the approval branch changes; the rest is the function from tighten_grants_users_businesses.
CREATE OR REPLACE FUNCTION support_access_grants_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.granted_by_user_id IS NOT NULL OR NEW.expires_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'support access starts as a request: no approver, expiry or revocation'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.admin_user_id <> OLD.admin_user_id
     OR NEW.reason <> OLD.reason OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'support access: only approval and revocation can change a request'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.granted_by_user_id IS NULL AND NEW.granted_by_user_id IS NOT NULL THEN
    IF app_scope() IS DISTINCT FROM 'business' THEN
      RAISE EXCEPTION 'support access: only the firm can approve' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'support access: a declined or revoked request cannot be approved'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at IS NULL OR NEW.expires_at <= now()
       OR NEW.expires_at > now() + interval '72 hours 1 minute' THEN
      RAISE EXCEPTION 'support access: expires_at is required and at most 72 hours ahead'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The database clock decides: trim the API's slightly-ahead "72 hours" to exactly 72 hours.
    IF NEW.expires_at > now() + interval '72 hours' THEN
      NEW.expires_at := now() + interval '72 hours';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.business_id = NEW.business_id AND m.user_id = NEW.granted_by_user_id
        AND m.role = 'OWNER' AND m.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'support access: only an active owner of the firm can approve'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.granted_by_user_id IS DISTINCT FROM OLD.granted_by_user_id
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'support access: an approval cannot be changed; revoke it and request again'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'support access: a revocation cannot be undone' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
