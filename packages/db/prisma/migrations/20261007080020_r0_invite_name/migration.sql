-- From the lead's review of #41 (Rasel, Oct 7): an invite keeps the name the inviter typed, and
-- until the person joins, the firm sees only that, never the person's user row. Otherwise a firm
-- could learn the name a person uses at another firm (staff users are shared across firms).
-- - invites.name and invites.email: what the inviter typed (staff invites need both; the team
--   page shows them for invited members). One line, length-limited, email lower-case.
-- - memberships.joined_at: set by the database the first time a membership is ACTIVE; never
--   changes. Deactivating an invite before it was accepted does not count as joining.
-- - users_select: in business scope, a staff member's user row is readable only once they joined.

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "joined_at" TIMESTAMPTZ(3);

ALTER TABLE invites ADD CONSTRAINT invites_name
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND name !~ '[[:cntrl:]]');
ALTER TABLE invites ADD CONSTRAINT invites_email
  CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND char_length(email) <= 254);

-- Existing rows (local and dev): members who are or were active joined when they were added.
UPDATE memberships SET joined_at = created_at WHERE status <> 'INVITED';

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

-- A new staff invite carries the typed name and email (client invites point at a client record,
-- which has its own name).
CREATE FUNCTION invites_typed_details() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.membership_id IS NOT NULL AND (NEW.name IS NULL OR NEW.email IS NULL) THEN
    RAISE EXCEPTION 'invites: a staff invite needs the name and email the inviter typed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invites_typed_details
  BEFORE INSERT ON invites
  FOR EACH ROW EXECUTE FUNCTION invites_typed_details();

-- Staff users are shared across firms: a firm reads a member's user row only once they joined.
-- Client users are one per firm, so a firm's client logins stay readable.
DROP POLICY users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (app_scope() = 'platform'
         OR id = app_current_user_id()
         OR (app_scope() = 'business'
             AND (EXISTS (SELECT 1 FROM memberships m
                          WHERE m.user_id = users.id AND m.joined_at IS NOT NULL)
                  OR EXISTS (SELECT 1 FROM client_accounts c WHERE c.user_id = users.id))));
