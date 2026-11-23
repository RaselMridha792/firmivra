-- CreateTable
CREATE TABLE "firm_data_download_codes" (
    "id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_data_download_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "firm_data_download_codes_grant_id_created_at_idx" ON "firm_data_download_codes"("grant_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "firm_data_download_codes" ADD CONSTRAINT "firm_data_download_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "firm_data_download_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
