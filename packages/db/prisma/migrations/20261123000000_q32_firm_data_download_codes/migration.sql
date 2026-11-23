-- Q32 (SA-FRM-F07/F08): the verified owner enters a one-time email code before the closed firm's
-- download-only access. The previous migration creates the table and its grant relation; this
-- migration limits it to platform scope and enforces the code lifecycle. Codes are never deleted.

GRANT SELECT, INSERT, UPDATE ON firm_data_download_codes TO firmivra_app;
ALTER TABLE firm_data_download_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_data_download_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_data_download_codes_platform ON firm_data_download_codes
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
CREATE POLICY firm_data_download_codes_admin_read ON firm_data_download_codes
  FOR SELECT USING (app_is_admin());

ALTER TABLE firm_data_download_codes ADD CONSTRAINT firm_data_download_codes_shape
  CHECK (code_hash ~ '^[0-9a-f]{64}$'
     AND attempts >= 0
     AND expires_at > created_at AND expires_at <= created_at + interval '10 minutes'
     AND (consumed_at IS NULL OR consumed_at >= created_at));

CREATE FUNCTION firm_data_download_codes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  grant_starts timestamptz;
  grant_expires timestamptz;
  grant_revoked timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attempts <> 0 OR NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'firm data download codes: a new code has no attempts and is not used'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT g.starts_at, g.expires_at, g.revoked_at
      INTO grant_starts, grant_expires, grant_revoked
      FROM firm_data_download_grants g WHERE g.id = NEW.grant_id;
    IF NOT FOUND OR grant_revoked IS NOT NULL OR grant_starts > now() OR grant_expires <= now() THEN
      RAISE EXCEPTION 'firm data download codes: a code needs an active download grant'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '11 minutes' THEN
      RAISE EXCEPTION 'firm data download codes: expires_at must be within 10 minutes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at > now() + interval '10 minutes' THEN
      NEW.expires_at := now() + interval '10 minutes';
    END IF;
    IF NEW.expires_at > grant_expires THEN
      NEW.expires_at := grant_expires;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'firm data download codes: a used code cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.grant_id, NEW.code_hash, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.grant_id, OLD.code_hash, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'firm data download codes: only attempts and consumed_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1) THEN
    RAISE EXCEPTION 'firm data download codes: attempts only go up by one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.consumed_at IS NOT NULL THEN
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION 'firm data download codes: an expired code cannot be used'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT g.starts_at, g.expires_at, g.revoked_at
      INTO grant_starts, grant_expires, grant_revoked
      FROM firm_data_download_grants g WHERE g.id = OLD.grant_id;
    IF NOT FOUND OR grant_revoked IS NOT NULL OR grant_starts > now() OR grant_expires <= now() THEN
      RAISE EXCEPTION 'firm data download codes: the download grant is no longer active'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM firm_data_download_codes c
               WHERE c.grant_id = OLD.grant_id AND c.id <> OLD.id
                 AND (c.created_at, c.id) > (OLD.created_at, OLD.id)) THEN
      RAISE EXCEPTION 'firm data download codes: only the newest code can be used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.consumed_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_data_download_codes_rules
  BEFORE INSERT OR UPDATE ON firm_data_download_codes
  FOR EACH ROW EXECUTE FUNCTION firm_data_download_codes_rules();
