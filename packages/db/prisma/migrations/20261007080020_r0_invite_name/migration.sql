-- From the lead's review of #41 (Rasel, Oct 7): an invite keeps the name the inviter typed, and
-- until the person joins, the firm sees only that, never the person's user row. Otherwise a firm
-- could learn the name a person uses at another firm (staff users are shared across firms).
-- - invites.name and invites.email: what the inviter typed (staff invites need both; the team
--   page shows them for invited members). One line, length-limited, email lower-case.
-- - memberships.joined_at: set by the database the first time a membership is ACTIVE; never
--   changes. Deactivating an invite before it was accepted does not count as joining.
-- Staged (R2's #41 merged first): this adds the columns and joined_at. A follow-up migration then
-- requires the typed name and email on staff invites and hides an invited person's user row from
-- the firm until they join, once R2's invite code writes and shows the typed details.

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "joined_at" TIMESTAMPTZ(3);

ALTER TABLE invites ADD CONSTRAINT invites_name
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND name !~ '[[:cntrl:]]');
ALTER TABLE invites ADD CONSTRAINT invites_email
  CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length(email) <= 254);

-- Existing rows (local and dev): ACTIVE members joined when they were added. A DEACTIVATED one
-- joined only if one of its invites was accepted, or if it never had an invite (added directly,
-- as owners at provisioning); one deactivated while still invited never joined.
UPDATE memberships m SET joined_at = m.created_at
 WHERE m.status = 'ACTIVE'
    OR (m.status = 'DEACTIVATED'
        AND (EXISTS (SELECT 1 FROM invites i WHERE i.membership_id = m.id AND i.accepted_at IS NOT NULL)
             OR NOT EXISTS (SELECT 1 FROM invites i WHERE i.membership_id = m.id)));

CREATE FUNCTION memberships_joined_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.joined_at IS NOT NULL THEN
    RAISE EXCEPTION 'memberships: joined_at is set by the database' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'memberships: joined_at is set by the database and never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.joined_at IS NULL THEN
    NEW.joined_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER memberships_joined_at
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_joined_at();
