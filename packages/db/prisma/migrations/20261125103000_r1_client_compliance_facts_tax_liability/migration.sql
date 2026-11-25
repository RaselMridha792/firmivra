-- AlterTable
ALTER TABLE "client_compliance_facts" ADD COLUMN "prior_year_tax_liability_source" TEXT;
ALTER TABLE "client_compliance_facts" ADD COLUMN "prior_year_tax_liability_as_of" TIMESTAMPTZ(3);
