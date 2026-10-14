-- r35_staff_pay_drafts (R35, Rasel Oct 14): pay details and saved Create Staff drafts. Both are
-- firm tables: business_id, same-firm foreign keys, RLS enabled and forced with the business
-- policy. Pay details also need the acting Owner or Admin, in the database.

-- CreateEnum
CREATE TYPE "StaffPayType" AS ENUM ('SALARY', 'HOURLY', 'COMMISSION', 'PER_PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "StaffPayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'ANNUALLY');

-- CreateTable
CREATE TABLE "staff_compensation" (
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "pay_type" "StaffPayType",
    "rate_cents" BIGINT,
    "pay_frequency" "StaffPayFrequency",
    "commission" TEXT,
    "payroll_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_compensation_pkey" PRIMARY KEY ("business_id","membership_id")
);

-- CreateTable
CREATE TABLE "staff_drafts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_drafts_business_id_updated_at_idx" ON "staff_drafts"("business_id", "updated_at");

-- AddForeignKey
ALTER TABLE "staff_compensation" ADD CONSTRAINT "staff_compensation_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_drafts" ADD CONSTRAINT "staff_drafts_business_id_created_by_membership_id_fkey" FOREIGN KEY ("business_id", "created_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE ON staff_compensation TO firmivra_app;
-- A draft is deleted when it becomes a staff member or is discarded.
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_drafts TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
ALTER TABLE staff_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_drafts_business ON staff_drafts USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- Pay details: this firm's rows, and only for the session's actor when they are an ACTIVE Owner
-- or Admin of the firm. No actor (a job, support scope, a client login) sees nothing and writes
-- nothing. The membership lookup runs under the firm policy, like the caller's own query.
ALTER TABLE staff_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_compensation FORCE ROW LEVEL SECURITY;
CREATE FUNCTION app_actor_is_firm_manager() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.business_id = app_current_business_id()
                    AND m.user_id = app_current_actor_id()
                    AND m.role IN ('OWNER', 'ADMIN') AND m.status = 'ACTIVE')
$$;
CREATE POLICY staff_compensation_business ON staff_compensation
  USING (business_id = app_current_business_id() AND app_actor_is_firm_manager())
  WITH CHECK (business_id = app_current_business_id() AND app_actor_is_firm_manager());

-- ---------- Shape ----------
-- Pay: a plain amount in range; short texts.
ALTER TABLE staff_compensation ADD CONSTRAINT staff_compensation_rules
  CHECK ((rate_cents IS NULL OR rate_cents BETWEEN 0 AND 10000000000)
         AND staff_line_ok(commission, 200) AND staff_line_ok(payroll_id, 40));

-- Drafts: a form step, an object of at most 20,000 characters, and no secret-looking keys at
-- any depth: a key ending in password, passcode, token, secret or ssn (a password or token
-- typed into a draft would sit in the database in clear). `requirePasswordChange` is fine.
ALTER TABLE staff_drafts ADD CONSTRAINT staff_drafts_rules
  CHECK (step BETWEEN 1 AND 4 AND jsonb_typeof(data) = 'object'
         AND char_length(data::text) <= 20000
         AND NOT jsonb_path_exists(data,
           '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(password|passcode|token|secret|ssn)$" flag "i")'));
