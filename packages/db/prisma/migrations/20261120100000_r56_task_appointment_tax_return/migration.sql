-- R56, Tax Returns Review Two F03 and F06 (lead's decision, Nov 20; Rasel approved this db change in
-- R56's window): a task and an appointment can name the exact tax return they are about.
--   tasks.tax_return_id, appointments.tax_return_id: nullable, one of the firm's own returns
--   (composite same-firm foreign key). Create Task and Schedule from a return set it, with or
--   without the return's service, so two returns on one service are told apart and a return with
--   no service can be linked at all. The API checks that the return is the record's client's.
-- Deleting a return only clears the link (SET NULL on tax_return_id alone); the task or appointment
-- stays. No backfill: existing rows keep NULL and their service link as before. Additive only (a
-- nullable column needs no table rewrite); policies and grants are table-wide and cover the new
-- columns, so RLS is unchanged.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "tax_return_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "tax_return_id" UUID;

-- CreateIndex
CREATE INDEX "appointments_business_id_tax_return_id_idx" ON "appointments"("business_id", "tax_return_id");

-- CreateIndex
CREATE INDEX "tasks_business_id_tax_return_id_idx" ON "tasks"("business_id", "tax_return_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE SET NULL ("tax_return_id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE SET NULL ("tax_return_id") ON UPDATE CASCADE;
