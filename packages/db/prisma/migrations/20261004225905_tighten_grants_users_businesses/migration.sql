-- Tightens three rules from the row_level_security migration (Rasel, Oct 5):
-- 1. Support access: the platform only requests; only an active firm owner approves, for at most 72 hours.
-- 2. Users: only the platform or the person themself can update a user row.
-- 3. Businesses: a firm cannot change its own status or slug; only the platform can.
-- RLS decides which rows each scope can touch; triggers enforce how a row may change.
-- Triggers also run for the table owner and superusers, so seeds and migrations follow the same rules.

-- ---------- 1. Support access grants ----------
DROP POLICY support_access_grants_access ON support_access_grants;
REVOKE DELETE ON support_access_grants FROM firmivra_app;

CREATE POLICY support_access_grants_select ON support_access_grants FOR SELECT
  USING (app_scope() = 'platform' OR business_id = app_current_business_id());
-- The Super Admin side can only create a request: not approved, no expiry, not revoked.
CREATE POLICY support_access_grants_request ON support_access_grants FOR INSERT
  WITH CHECK (app_scope() = 'platform'
              AND granted_by_user_id IS NULL AND expires_at IS NULL AND revoked_at IS NULL);
-- Only the firm decides: approve (owner, see trigger), decline or revoke.
CREATE POLICY support_access_grants_decide ON support_access_grants FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE FUNCTION support_access_grants_rules() RETURNS trigger
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
    IF NEW.expires_at IS NULL OR NEW.expires_at <= now() OR NEW.expires_at > now() + interval '72 hours' THEN
      RAISE EXCEPTION 'support access: expires_at is required and at most 72 hours ahead'
        USING ERRCODE = 'check_violation';
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

CREATE TRIGGER support_access_grants_rules
  BEFORE INSERT OR UPDATE ON support_access_grants
  FOR EACH ROW EXECUTE FUNCTION support_access_grants_rules();

-- ---------- 2. Users ----------
DROP POLICY users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE
  USING (app_scope() = 'platform' OR id = app_current_user_id())
  WITH CHECK (app_scope() = 'platform' OR id = app_current_user_id());

-- A person editing their own row cannot change who they are (identity comes from Cognito).
CREATE FUNCTION users_identity_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() IS DISTINCT FROM 'platform'
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.cognito_sub IS DISTINCT FROM OLD.cognito_sub
          OR NEW.pool IS DISTINCT FROM OLD.pool OR NEW.email IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION 'users: id, cognito_sub, pool and email change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER users_identity_columns
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_identity_columns();

-- ---------- 3. Businesses ----------
CREATE FUNCTION businesses_protected_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() IS DISTINCT FROM 'platform'
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.slug IS DISTINCT FROM OLD.slug) THEN
    RAISE EXCEPTION 'businesses: status and slug change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER businesses_protected_columns
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_protected_columns();
