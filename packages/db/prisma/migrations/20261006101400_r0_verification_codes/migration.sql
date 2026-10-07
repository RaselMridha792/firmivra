-- Portal sign-up verification codes (R3 request, Rasel approved Oct 6). Step 3 is merged, so this
-- is a follow-up migration in the open PR, timestamped right after the step 2 follow-ups.

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('EMAIL', 'PHONE');

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "target" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_codes_client_account_id_channel_created_at_idx" ON "verification_codes"("client_account_id", "channel", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS ----------
-- Codes stay as a record: used or expired, never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON verification_codes TO firmivra_app;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes FORCE ROW LEVEL SECURITY;
-- Sign-up runs in the firm's business scope (the firm comes from the portal route).
CREATE POLICY verification_codes_business ON verification_codes
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_code_hash_sha256
  CHECK (code_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_attempts_not_negative
  CHECK (attempts >= 0);
-- A code goes to one exact address: a lower-case email, or an E.164 phone number.
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_target
  CHECK (CASE channel
           WHEN 'EMAIL' THEN target = lower(target) AND target ~ '^[^@\s]+@[^@\s]+$'
           ELSE target ~ '^\+[1-9][0-9]{6,14}$'
         END);
ALTER TABLE verification_codes ADD CONSTRAINT verification_codes_expiry_15_minutes
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes');

-- The database clock decides. created_at is now() (the API reads it for the 45-second resend gap);
-- expires_at must be within 15 minutes, and up to 1 minute over (a slightly fast API clock) is
-- trimmed to exactly 15 minutes. After insert only attempts (+1 at a time) and consumed_at (once)
-- change. A code is consumed only before it expires and only if it is the newest code for that
-- account and channel; consumed_at is then the database's now(). A used code never changes again.
CREATE FUNCTION verification_codes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attempts <> 0 OR NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'verification codes: a new code has no attempts and is not used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '16 minutes' THEN
      RAISE EXCEPTION 'verification codes: expires_at must be within 15 minutes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at > now() + interval '15 minutes' THEN
      NEW.expires_at := now() + interval '15 minutes';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'verification codes: a used code cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.client_account_id <> OLD.client_account_id OR NEW.channel <> OLD.channel
     OR NEW.target <> OLD.target OR NEW.code_hash <> OLD.code_hash
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'verification codes: only attempts and consumed_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1) THEN
    RAISE EXCEPTION 'verification codes: attempts only go up by one' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.consumed_at IS NOT NULL THEN
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION 'verification codes: an expired code cannot be used'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM verification_codes v
               WHERE v.client_account_id = OLD.client_account_id AND v.channel = OLD.channel
                 AND v.id <> OLD.id
                 AND (v.created_at, v.id) > (OLD.created_at, OLD.id)) THEN
      RAISE EXCEPTION 'verification codes: only the newest code can be used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.consumed_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER verification_codes_rules
  BEFORE INSERT OR UPDATE ON verification_codes
  FOR EACH ROW EXECUTE FUNCTION verification_codes_rules();
