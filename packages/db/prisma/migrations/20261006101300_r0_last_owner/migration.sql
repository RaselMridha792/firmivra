-- Team rule (Rasel, Oct 6; T03): a firm always keeps at least one active owner. Demoting,
-- deactivating or deleting the last active owner fails with SQLSTATE FV001 and a message that
-- starts "LAST_ACTIVE_OWNER:", which the team API shows as a clear error (DB_ERRORS in
-- packages/db). Make someone else an active owner first.
CREATE FUNCTION memberships_keep_an_owner() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Only an active owner who stops being one (or leaves the firm) matters.
  IF OLD.role <> 'OWNER' OR OLD.status <> 'ACTIVE'
     OR (TG_OP = 'UPDATE' AND NEW.role = 'OWNER' AND NEW.status = 'ACTIVE'
         AND NEW.business_id = OLD.business_id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- One change to a firm's owners at a time, so two owners demoting each other at the same
  -- moment cannot both succeed: the second waits here until the first commits, then its check
  -- below (a new snapshot under READ COMMITTED, the default) sees the first change. An advisory
  -- lock works in every scope; a row lock would depend on what RLS lets this scope see.
  PERFORM pg_advisory_xact_lock(hashtextextended('memberships_keep_an_owner:' || OLD.business_id, 0));

  IF NOT EXISTS (SELECT 1 FROM memberships m
                 WHERE m.business_id = OLD.business_id AND m.id <> OLD.id
                   AND m.role = 'OWNER' AND m.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'LAST_ACTIVE_OWNER: a firm must keep at least one active owner; make someone else an active owner first'
      USING ERRCODE = 'FV001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER memberships_keep_an_owner
  BEFORE UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_keep_an_owner();
