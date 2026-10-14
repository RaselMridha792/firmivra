-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('FINANCIAL', 'CLIENT', 'TAX', 'BOOKKEEPING', 'PAYROLL', 'LEADS', 'COMMUNICATIONS', 'TEAM_PRODUCTIVITY', 'ADVISORY');

-- CreateEnum
CREATE TYPE "ReportVisibility" AS ENUM ('PRIVATE', 'SELECTED', 'COMPANY');

-- CreateEnum
CREATE TYPE "ReportDateRule" AS ENUM ('FIXED', 'ROLLING');

-- CreateEnum
CREATE TYPE "RevenueBasis" AS ENUM ('COLLECTED', 'INVOICED');

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "data_source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filters" JSONB NOT NULL DEFAULT '[]',
    "group_by" TEXT,
    "sort_by" TEXT,
    "sort_descending" BOOLEAN NOT NULL DEFAULT false,
    "show_totals" BOOLEAN NOT NULL DEFAULT false,
    "show_percentage" BOOLEAN NOT NULL DEFAULT false,
    "include_comparison" BOOLEAN NOT NULL DEFAULT false,
    "compare_to" TEXT,
    "date_rule" "ReportDateRule" NOT NULL DEFAULT 'ROLLING',
    "date_preset" TEXT,
    "date_from" DATE,
    "date_to" DATE,
    "chart_type" TEXT NOT NULL DEFAULT 'auto',
    "show_data_labels" BOOLEAN NOT NULL DEFAULT false,
    "include_tax_revenue" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "ReportVisibility" NOT NULL DEFAULT 'PRIVATE',
    "shared_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_shares" (
    "business_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_shares_pkey" PRIMARY KEY ("definition_id","user_id")
);

-- CreateTable
CREATE TABLE "report_favorites" (
    "business_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_favorites_pkey" PRIMARY KEY ("definition_id","user_id")
);

-- CreateTable
CREATE TABLE "report_settings" (
    "business_id" UUID NOT NULL,
    "revenue_basis" "RevenueBasis" NOT NULL DEFAULT 'COLLECTED',
    "include_tax_default" BOOLEAN NOT NULL DEFAULT false,
    "default_date_preset" TEXT NOT NULL DEFAULT 'this_year',
    "stale_after_minutes" INTEGER NOT NULL DEFAULT 60,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "report_definitions_business_id_category_idx" ON "report_definitions"("business_id", "category");

-- CreateIndex
CREATE INDEX "report_definitions_business_id_owner_user_id_idx" ON "report_definitions"("business_id", "owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_business_id_id_key" ON "report_definitions"("business_id", "id");

-- CreateIndex
CREATE INDEX "report_shares_business_id_user_id_idx" ON "report_shares"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "report_favorites_business_id_user_id_idx" ON "report_favorites"("business_id", "user_id");

-- AddForeignKey
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_business_id_definition_id_fkey" FOREIGN KEY ("business_id", "definition_id") REFERENCES "report_definitions"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_favorites" ADD CONSTRAINT "report_favorites_business_id_definition_id_fkey" FOREIGN KEY ("business_id", "definition_id") REFERENCES "report_definitions"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grants: a saved report is archived, never deleted; shares and favourites come and go.
GRANT SELECT, INSERT, UPDATE ON report_definitions, report_settings TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON report_shares, report_favorites TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_definitions', 'report_shares', 'report_favorites', 'report_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE report_definitions ADD CONSTRAINT report_definitions_values
  CHECK (esign_text_ok(name, 200) AND (description IS NULL OR esign_text_ok(description, 1000))
         AND data_source ~ '^[a-z][a-z0-9_]{0,59}$'
         AND cardinality(columns) <= 60 AND array_position(columns, NULL) IS NULL
         -- Field names are plain identifiers, and none names a secret or a sensitive identifier.
         AND array_to_string(columns, ',') ~ '^([a-z][a-z0-9_.]{0,79}(,|$))*$'
         AND array_to_string(columns, ',') !~* '(ssn|social|password|passwd|token|secret|bank_account|routing|account_number)'
         AND jsonb_typeof(filters) = 'array' AND pg_column_size(filters) <= 20000
         AND (group_by IS NULL OR group_by ~ '^[a-z][a-z0-9_.]{0,79}$')
         AND (sort_by IS NULL OR sort_by ~ '^[a-z][a-z0-9_.]{0,79}$')
         AND (compare_to IS NULL OR compare_to IN ('previous_period', 'same_period_last_year'))
         AND (include_comparison = false OR compare_to IS NOT NULL)
         AND chart_type IN ('auto', 'column', 'bar', 'line', 'area', 'donut', 'table', 'kpi')
         AND ((date_rule = 'FIXED' AND date_from IS NOT NULL AND date_to IS NOT NULL
               AND date_from <= date_to AND date_preset IS NULL)
              OR (date_rule = 'ROLLING' AND coalesce(date_preset ~ '^[a-z][a-z0-9_]{0,39}$', false)
                  AND date_from IS NULL AND date_to IS NULL))
         AND shared_roles <@ ARRAY['OWNER', 'ADMIN', 'STAFF']
         AND (visibility = 'SELECTED' OR cardinality(shared_roles) = 0));

ALTER TABLE report_settings ADD CONSTRAINT report_settings_values
  CHECK (default_date_preset ~ '^[a-z][a-z0-9_]{0,39}$' AND stale_after_minutes BETWEEN 1 AND 10080);

-- A report is shared only with people who work at the firm.
CREATE FUNCTION report_shares_member() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.business_id = NEW.business_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'REPORT_SHARE_MEMBER: the person is not a member of this firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_shares_member BEFORE INSERT ON report_shares
  FOR EACH ROW EXECUTE FUNCTION report_shares_member();
