-- R56 (Services & Pricing S12, Client Portal SP-1; decided Nov 19): a package's optional Booking
-- type, one of the same firm's appointment types. The composite key keeps it to the package's own
-- firm; RESTRICT, since an appointment type is archived, never deleted. No data changes: every
-- existing package starts with none, so its page keeps the sign-in and contact path.

-- AlterTable
ALTER TABLE "service_packages" ADD COLUMN     "appointment_type_id" UUID;

-- CreateIndex
CREATE INDEX "service_packages_business_id_appointment_type_id_idx" ON "service_packages"("business_id", "appointment_type_id");

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_business_id_appointment_type_id_fkey" FOREIGN KEY ("business_id", "appointment_type_id") REFERENCES "appointment_types"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
