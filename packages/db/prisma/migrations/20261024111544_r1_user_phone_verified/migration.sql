-- r1_user_phone_verified (R1, Oct 24; Rasel's block, R60's "Column request for R1", request 9):
-- users.phone_verified_at, when the person proved they hold users.phone (a code by text, built by
-- R60 on R6's sender); only then is SMS offered. A changed number is no longer verified: the
-- trigger below clears it whenever phone changes, unless the same change sets it (a number
-- verified as it is saved). No verification without a number.
-- Safe on dev: the column has no default (no rewrite); every row is NULL, so the check holds; the
-- trigger fires only on an update of phone. Only users is touched.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone_verified_at" TIMESTAMPTZ(3);

ALTER TABLE users ADD CONSTRAINT users_phone_verified
  CHECK (phone_verified_at IS NULL OR phone IS NOT NULL);

CREATE FUNCTION users_phone_verified_reset() RETURNS trigger
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

CREATE TRIGGER users_phone_verified_reset
  BEFORE UPDATE OF phone ON users
  FOR EACH ROW EXECUTE FUNCTION users_phone_verified_reset();
