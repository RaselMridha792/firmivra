-- r1_staff_phone_codes (R1, Oct 25; Rasel's tap of Oct 24 22:53 UTC, R60's "Column request for
-- R1", request 13): the codes sent to verify a staff member's phone, so the API can check a code
-- and count wrong tries before it sets users.phone_verified_at (request 9). Like the clients'
-- verification_codes, which this does not change: only the code's HMAC is stored, the database
-- clock sets created_at and the 15-minute expiry, attempts only go up, and only the newest
-- unexpired code for that member can be used, once. Never deleted by the app.
-- Safe on dev: a new table only; nothing else changes.

-- CreateTable
CREATE TABLE "staff_phone_codes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_phone_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_phone_codes_user_id_created_at_idx" ON "staff_phone_codes"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "staff_phone_codes" ADD CONSTRAINT "staff_phone_codes_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS ----------
-- Codes stay as a record: used or expired, never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON staff_phone_codes TO firmivra_app;
ALTER TABLE staff_phone_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_phone_codes FORCE ROW LEVEL SECURITY;
-- The member's own firm: the API sends and checks in that firm's business scope.
CREATE POLICY staff_phone_codes_business ON staff_phone_codes
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE staff_phone_codes ADD CONSTRAINT staff_phone_codes_code_hash_sha256
  CHECK (code_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE staff_phone_codes ADD CONSTRAINT staff_phone_codes_attempts_not_negative
  CHECK (attempts >= 0);
-- A code goes to one exact E.164 phone number.
ALTER TABLE staff_phone_codes ADD CONSTRAINT staff_phone_codes_target_e164
  CHECK (target ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE staff_phone_codes ADD CONSTRAINT staff_phone_codes_expiry_15_minutes
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes');

-- The database clock decides. created_at is now() (the API reads it for the one-minute resend
-- gap); expires_at must be within 15 minutes, and up to 1 minute over (a slightly fast API clock)
-- is trimmed to exactly 15 minutes. After insert only attempts (+1 at a time) and consumed_at
-- (once) change. A code is consumed only before it expires and only if it is the newest code for
-- that member in that firm; consumed_at is then the database's now(). A used code never changes.
CREATE FUNCTION staff_phone_codes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attempts <> 0 OR NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'staff phone codes: a new code has no attempts and is not used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '16 minutes' THEN
      RAISE EXCEPTION 'staff phone codes: expires_at must be within 15 minutes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at > now() + interval '15 minutes' THEN
      NEW.expires_at := now() + interval '15 minutes';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'staff phone codes: a used code cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.user_id <> OLD.user_id
     OR NEW.target <> OLD.target OR NEW.code_hash <> OLD.code_hash
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'staff phone codes: only attempts and consumed_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1) THEN
    RAISE EXCEPTION 'staff phone codes: attempts only go up by one' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.consumed_at IS NOT NULL THEN
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION 'staff phone codes: an expired code cannot be used'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM staff_phone_codes c
               WHERE c.business_id = OLD.business_id AND c.user_id = OLD.user_id
                 AND c.id <> OLD.id
                 AND (c.created_at, c.id) > (OLD.created_at, OLD.id)) THEN
      RAISE EXCEPTION 'staff phone codes: only the newest code can be used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.consumed_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER staff_phone_codes_rules
  BEFORE INSERT OR UPDATE ON staff_phone_codes
  FOR EACH ROW EXECUTE FUNCTION staff_phone_codes_rules();
