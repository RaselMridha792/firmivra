-- Step 2 follow-up (Rasel via R2/R3, Oct 6): which Terms and Privacy versions each client
-- accepted, and when. Portal sign-up writes one row for each, with the new client account.

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptances_business_id_client_account_id_idx" ON "legal_acceptances"("business_id", "client_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptances_client_account_id_legal_document_id_key" ON "legal_acceptances"("client_account_id", "legal_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_legal_documents_business_id_id_key" ON "firm_legal_documents"("business_id", "id");

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_business_id_legal_document_id_fkey" FOREIGN KEY ("business_id", "legal_document_id") REFERENCES "firm_legal_documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Row-level security ----------
-- Insert-only: an acceptance is a record and never changes.
GRANT SELECT, INSERT ON legal_acceptances TO firmivra_app;
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;

CREATE POLICY legal_acceptances_business_read ON legal_acceptances FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY legal_acceptances_business_insert ON legal_acceptances FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
-- The client sees their own acceptances in user scope (/me), through their portal login.
CREATE POLICY legal_acceptances_own ON legal_acceptances FOR SELECT
  USING (EXISTS (SELECT 1 FROM client_accounts c
                 WHERE c.id = legal_acceptances.client_account_id AND c.user_id = app_current_user_id()));
