-- CreateEnum
CREATE TYPE "PayrollWorkerType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "PayrollWorkerStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE', 'PENDING_SETUP');

-- CreateEnum
CREATE TYPE "PayrollPayType" AS ENUM ('HOURLY', 'SALARY', 'COMMISSION');

-- CreateTable
CREATE TABLE "payroll_workers" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "external_id" TEXT,
    "display_name" TEXT NOT NULL,
    "worker_type" "PayrollWorkerType" NOT NULL,
    "status" "PayrollWorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "pay_type" "PayrollPayType",
    "rate_cents" INTEGER,
    "department" TEXT,
    "job_title" TEXT,
    "started_on" DATE,
    "direct_deposit_ready" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_synced_at" TIMESTAMPTZ(3),
    "last_change_at" TIMESTAMPTZ(3),
    "last_change_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_workers_business_id_payroll_client_id_status_idx" ON "payroll_workers"("business_id", "payroll_client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_workers_business_id_id_key" ON "payroll_workers"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_workers_payroll_client_id_external_id_key" ON "payroll_workers"("payroll_client_id", "external_id");

-- AddForeignKey
ALTER TABLE "payroll_workers" ADD CONSTRAINT "payroll_workers_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: workers are made inactive, never deleted.
GRANT SELECT, INSERT, UPDATE ON payroll_workers TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_workers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE payroll_workers ADD CONSTRAINT payroll_workers_values
  CHECK (esign_text_ok(display_name, 200)
         AND (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 100)
         AND (rate_cents IS NULL OR (rate_cents >= 0 AND pay_type IS NOT NULL))
         AND (department IS NULL OR esign_text_ok(department, 100))
         AND (job_title IS NULL OR esign_text_ok(job_title, 100))
         AND source IN ('provider', 'import', 'manual')
         AND (last_change_note IS NULL OR esign_text_ok(last_change_note, 300)));