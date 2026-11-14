-- r1_membership_phone (R1, Nov 14; Dashboard Review 2 R2 NEW2, the lead's design under Rasel's
-- packages/db delegation until Nov 17): a firm's own number for each member. An employee no longer
-- changes their number; the firm's Owner sets it in Edit Staff. users.phone is the person's own
-- number across every firm, so a firm never writes it: this firm's number lives on the membership,
-- under the firm's usual RLS (memberships_business), and never needs platform scope.
-- - memberships.phone: E.164 (a plus, then 7 to 15 digits, the first not 0), or NULL.
-- - memberships.phone_verified_at: when the member proved they hold it (a code by text). No
--   verification without a number, and the trigger below clears it whenever the number changes,
--   unless the same change sets it, as users_phone_verified_reset does for users.phone.
-- This firm's texts go to the membership's number once verified, else to users.phone (the API).
-- Safe on dev: two new nullable columns with no default (no rewrite); every row is NULL, so both
-- checks hold; the trigger fires only on an update of phone. Only memberships is touched.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phone_verified_at" TIMESTAMPTZ(3);

ALTER TABLE memberships ADD CONSTRAINT memberships_phone_format
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE memberships ADD CONSTRAINT memberships_phone_verified
  CHECK (phone_verified_at IS NULL OR phone IS NOT NULL);

CREATE FUNCTION memberships_phone_verified_reset() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone
     AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at THEN
    NEW.phone_verified_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER memberships_phone_verified_reset
  BEFORE UPDATE OF phone ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_phone_verified_reset();
