-- AlterTable
ALTER TABLE "document_requests" ADD COLUMN     "tax_return_id" UUID,
ADD COLUMN     "tax_year" INTEGER;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_business_id_client_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "client_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Shape (Tax Returns Review 2, F10) ----------
-- A request made from a return names both; its year is a tax year; the return is the same
-- client's (the composite key above). RLS is unchanged: the table's business policy covers them.
ALTER TABLE document_requests ADD CONSTRAINT document_requests_tax_return
  CHECK (
    (tax_year IS NULL OR tax_year BETWEEN 2000 AND 2100)
    AND (tax_return_id IS NULL OR tax_year IS NOT NULL)
  );
CREATE INDEX document_requests_tax_return_idx ON document_requests (business_id, tax_return_id)
  WHERE tax_return_id IS NOT NULL;
