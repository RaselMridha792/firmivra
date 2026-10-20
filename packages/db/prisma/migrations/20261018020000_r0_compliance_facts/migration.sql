-- r0_compliance_facts (R0, Oct 18, stage C2): the Compliance API's follow-ups (#719). Structured
-- client facts for applicability (fiscal year end, tax classification, elections, payroll
-- employer and deposit schedule, sales tax registration, prior-year liability; unset means
-- unknown), the client's sales tax registrations by state and frequency, a holiday table by
-- jurisdiction (platform reference data; ships the 2026 and 2027 US federal holidays as observed
-- and DC Emancipation Day), and the firm's deadline-to-task due-date sync setting. Contract note:
-- docs/work/R0-stage-c2-compliance.md.

-- CreateEnum
CREATE TYPE "ComplianceTaxClassification" AS ENUM ('INDIVIDUAL', 'SOLE_PROPRIETOR', 'DISREGARDED_ENTITY', 'PARTNERSHIP', 'S_CORPORATION', 'C_CORPORATION', 'TRUST', 'ESTATE', 'NONPROFIT', 'OTHER');

-- CreateEnum
CREATE TYPE "CompliancePayrollDepositSchedule" AS ENUM ('MONTHLY', 'SEMIWEEKLY', 'NEXT_DAY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ComplianceFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ComplianceTaskDueSync" AS ENUM ('NONE', 'MATCH_DEADLINE', 'LEAD_DAYS');

-- AlterTable
ALTER TABLE "compliance_settings" ADD COLUMN     "task_due_date_sync" "ComplianceTaskDueSync" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "task_due_lead_days" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "client_compliance_facts" (
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "fiscal_year_end_month" INTEGER,
    "fiscal_year_end_day" INTEGER,
    "tax_classification" "ComplianceTaxClassification",
    "elections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_payroll_employer" BOOLEAN,
    "payroll_deposit_schedule" "CompliancePayrollDepositSchedule",
    "payroll_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_sales_tax_registered" BOOLEAN,
    "prior_year_tax_liability_cents" INTEGER,
    "prior_year_tax_year" INTEGER,
    "notes" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "verified_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_compliance_facts_pkey" PRIMARY KEY ("business_id","client_id")
);

-- CreateTable
CREATE TABLE "client_sales_tax_registrations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "frequency" "ComplianceFilingFrequency" NOT NULL,
    "account_last4" TEXT,
    "registered_on" DATE,
    "closed_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_sales_tax_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_holidays" (
    "jurisdiction" TEXT NOT NULL,
    "holiday_on" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_holidays_pkey" PRIMARY KEY ("jurisdiction","holiday_on")
);

-- CreateIndex
CREATE INDEX "client_compliance_facts_business_id_tax_classification_idx" ON "client_compliance_facts"("business_id", "tax_classification");

-- CreateIndex
CREATE INDEX "client_sales_tax_registrations_business_id_client_id_idx" ON "client_sales_tax_registrations"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "client_sales_tax_registrations_business_id_state_idx" ON "client_sales_tax_registrations"("business_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "client_sales_tax_registrations_business_id_id_key" ON "client_sales_tax_registrations"("business_id", "id");

-- CreateIndex
CREATE INDEX "compliance_holidays_holiday_on_idx" ON "compliance_holidays"("holiday_on");

-- AddForeignKey
ALTER TABLE "client_compliance_facts" ADD CONSTRAINT "client_compliance_facts_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_sales_tax_registrations" ADD CONSTRAINT "client_sales_tax_registrations_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS, policy ----------
GRANT SELECT, INSERT, UPDATE ON client_compliance_facts, client_sales_tax_registrations TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_holidays TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_compliance_facts', 'client_sales_tax_registrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Holidays are reference data: every scope reads them (a firm's deadline engine moves its dates);
-- only the Super Admin team (admin scope) or the platform maintains them.
ALTER TABLE compliance_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_holidays_read ON compliance_holidays FOR SELECT USING (true);
CREATE POLICY compliance_holidays_insert ON compliance_holidays FOR INSERT
  WITH CHECK (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY compliance_holidays_update ON compliance_holidays FOR UPDATE
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member())
  WITH CHECK (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY compliance_holidays_delete ON compliance_holidays FOR DELETE
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());

-- ---------- Shape ----------
-- A fiscal year end is a real calendar day (month and day together); state codes are two
-- letters; the prior-year liability comes with its year.
ALTER TABLE client_compliance_facts ADD CONSTRAINT client_compliance_facts_shape
  CHECK ((fiscal_year_end_month IS NULL) = (fiscal_year_end_day IS NULL)
         AND (fiscal_year_end_month IS NULL OR (fiscal_year_end_month BETWEEN 1 AND 12
              AND fiscal_year_end_day BETWEEN 1 AND
                  (CASE fiscal_year_end_month WHEN 2 THEN 29 WHEN 4 THEN 30 WHEN 6 THEN 30
                                              WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END)))
         AND cardinality(elections) <= 30 AND array_position(elections, NULL) IS NULL
         AND array_to_string(elections, ',') ~ '^([a-z][a-z0-9_]{0,59}(,[a-z][a-z0-9_]{0,59})*)?$'
         AND cardinality(payroll_states) <= 60 AND array_position(payroll_states, NULL) IS NULL
         AND array_to_string(payroll_states, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
         AND (payroll_deposit_schedule IS NULL OR is_payroll_employer IS NOT FALSE)
         AND (prior_year_tax_liability_cents IS NULL) = (prior_year_tax_year IS NULL)
         AND (prior_year_tax_liability_cents IS NULL OR prior_year_tax_liability_cents >= 0)
         AND (prior_year_tax_year IS NULL OR prior_year_tax_year BETWEEN 1990 AND 2100)
         AND (notes IS NULL OR char_length(notes) <= 2000)
         AND (verified_by_user_id IS NULL OR verified_at IS NOT NULL));

ALTER TABLE client_sales_tax_registrations ADD CONSTRAINT client_sales_tax_registrations_shape
  CHECK (state ~ '^[A-Z]{2}$' AND (account_last4 IS NULL OR account_last4 ~ '^[A-Za-z0-9]{1,4}$')
         AND (closed_on IS NULL OR registered_on IS NULL OR closed_on >= registered_on));

ALTER TABLE compliance_holidays ADD CONSTRAINT compliance_holidays_shape
  CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$' AND btrim(name) <> '' AND char_length(name) <= 120
         AND (source IS NULL OR char_length(source) <= 200));

ALTER TABLE compliance_settings ADD CONSTRAINT compliance_settings_task_due_sync
  CHECK (task_due_lead_days BETWEEN 0 AND 365 AND (task_due_date_sync = 'LEAD_DAYS' OR task_due_lead_days = 0));

-- ---------- Rules ----------
-- One open registration per client and state; a registration keeps its client and state.
CREATE FUNCTION client_sales_tax_registrations_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.client_id, NEW.state) IS DISTINCT FROM (OLD.client_id, OLD.state) THEN
    RAISE EXCEPTION 'compliance: a sales tax registration keeps its client and state'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.closed_on IS NULL AND EXISTS (SELECT 1 FROM client_sales_tax_registrations r
       WHERE r.business_id = NEW.business_id AND r.client_id = NEW.client_id AND r.state = NEW.state
         AND r.closed_on IS NULL AND r.id <> NEW.id) THEN
    RAISE EXCEPTION 'compliance: the client already has an open % sales tax registration', NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_sales_tax_registrations_rules BEFORE INSERT OR UPDATE ON client_sales_tax_registrations
  FOR EACH ROW EXECUTE FUNCTION client_sales_tax_registrations_rules();

-- Facts keep their client; the database stamps when they were verified.
CREATE FUNCTION client_compliance_facts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'compliance: facts keep their client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.verified_at IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.verified_at END) THEN
    NEW.verified_at := CASE WHEN NEW.verified_at IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER client_compliance_facts_rules BEFORE INSERT OR UPDATE ON client_compliance_facts
  FOR EACH ROW EXECUTE FUNCTION client_compliance_facts_rules();

-- ---------- The holidays that ship ----------
-- US federal holidays (5 U.S.C. 6103) as observed: a Saturday holiday is observed on the Friday
-- before, a Sunday holiday on the Monday after. DC Emancipation Day (D.C. Code 1-612.02) is a
-- legal holiday in the District, which moves federal tax due dates (IRC 7503), so federal tax
-- deadlines use US and US-DC together.
INSERT INTO compliance_holidays (jurisdiction, holiday_on, name, source) VALUES
  ('US', '2026-01-01', 'New Year''s Day', '5 U.S.C. 6103'),
  ('US', '2026-01-19', 'Birthday of Martin Luther King, Jr.', '5 U.S.C. 6103'),
  ('US', '2026-02-16', 'Washington''s Birthday', '5 U.S.C. 6103'),
  ('US', '2026-05-25', 'Memorial Day', '5 U.S.C. 6103'),
  ('US', '2026-06-19', 'Juneteenth National Independence Day', '5 U.S.C. 6103'),
  ('US', '2026-07-03', 'Independence Day (observed)', '5 U.S.C. 6103'),
  ('US', '2026-09-07', 'Labor Day', '5 U.S.C. 6103'),
  ('US', '2026-10-12', 'Columbus Day', '5 U.S.C. 6103'),
  ('US', '2026-11-11', 'Veterans Day', '5 U.S.C. 6103'),
  ('US', '2026-11-26', 'Thanksgiving Day', '5 U.S.C. 6103'),
  ('US', '2026-12-25', 'Christmas Day', '5 U.S.C. 6103'),
  ('US', '2027-01-01', 'New Year''s Day', '5 U.S.C. 6103'),
  ('US', '2027-01-18', 'Birthday of Martin Luther King, Jr.', '5 U.S.C. 6103'),
  ('US', '2027-02-15', 'Washington''s Birthday', '5 U.S.C. 6103'),
  ('US', '2027-05-31', 'Memorial Day', '5 U.S.C. 6103'),
  ('US', '2027-06-18', 'Juneteenth National Independence Day (observed)', '5 U.S.C. 6103'),
  ('US', '2027-07-05', 'Independence Day (observed)', '5 U.S.C. 6103'),
  ('US', '2027-09-06', 'Labor Day', '5 U.S.C. 6103'),
  ('US', '2027-10-11', 'Columbus Day', '5 U.S.C. 6103'),
  ('US', '2027-11-11', 'Veterans Day', '5 U.S.C. 6103'),
  ('US', '2027-11-25', 'Thanksgiving Day', '5 U.S.C. 6103'),
  ('US', '2027-12-24', 'Christmas Day (observed)', '5 U.S.C. 6103'),
  ('US', '2027-12-31', 'New Year''s Day 2028 (observed)', '5 U.S.C. 6103'),
  ('US-DC', '2026-04-16', 'DC Emancipation Day', 'D.C. Code 1-612.02'),
  ('US-DC', '2027-04-16', 'DC Emancipation Day', 'D.C. Code 1-612.02');
