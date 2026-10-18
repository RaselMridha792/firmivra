-- r0_bookkeeping_ledger (R0, Oct 18, stage C1): the Bookkeeping API's schema request (#718), from
-- the Bookkeeping developer instructions. A client's chart-of-accounts categories and its
-- transactions (categorize, split, transfer, match, exclude, receipt); refunds and chargebacks and
-- settlements or payouts as distinct events with source linkage and bank-deposit matching; report
-- versions (what was generated and sent); and the engagement terms (six tabs), versioned and never
-- overwritten once in force. Firm data: every row stays on one client's bookkeeping engagement
-- (composite keys); a closed period locks its transactions. Adds engagement-scoped keys to
-- bookkeeping_accounts and bookkeeping_connections and a (business_id, id) key to
-- bookkeeping_reconciliations. Contract note: docs/work/R0-stage-c1-bookkeeping.md.

-- CreateEnum
CREATE TYPE "BookkeepingCategoryType" AS ENUM ('INCOME', 'COST_OF_GOODS', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY', 'OTHER');

-- CreateEnum
CREATE TYPE "BookkeepingTxnDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BookkeepingTxnKind" AS ENUM ('STANDARD', 'TRANSFER', 'PAYMENT', 'REFUND', 'CHARGEBACK', 'FEE', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BookkeepingTxnStatus" AS ENUM ('UNCATEGORIZED', 'CATEGORIZED', 'MATCHED', 'EXCLUDED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "BookkeepingTxnSource" AS ENUM ('SYNC', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "BookkeepingRefundKind" AS ENUM ('REFUND_RECEIVED', 'REFUND_ISSUED', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "BookkeepingRefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "BookkeepingDisputeStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "BookkeepingNetSource" AS ENUM ('SOURCE', 'CALCULATED');

-- CreateEnum
CREATE TYPE "BookkeepingSettlementStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "BookkeepingDeliveryStatus" AS ENUM ('NOT_SENT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BookkeepingTermsStatus" AS ENUM ('DRAFT', 'SENT', 'ACTIVE', 'SUPERSEDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BookkeepingRenewalType" AS ENUM ('AUTO', 'MANUAL', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "BookkeepingBillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "BookkeepingBillingTiming" AS ENUM ('ADVANCE', 'ARREARS');

-- CreateEnum
CREATE TYPE "BookkeepingPaymentTerms" AS ENUM ('DUE_ON_RECEIPT', 'NET_7', 'NET_15', 'NET_30', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BookkeepingTermsEventKind" AS ENUM ('CREATED', 'SENT', 'SIGNED', 'ACTIVATED', 'SUPERSEDED', 'PACKAGE_CHANGED', 'PRICING_CHANGED', 'SCOPE_CHANGED', 'RENEWAL_CHANGED', 'PRICE_CHANGE_NOTICE', 'TERMINATION_NOTICE', 'TERMINATED', 'RENEWED', 'NOTE');

-- CreateTable
CREATE TABLE "bookkeeping_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "connection_id" UUID,
    "source_category_id" TEXT,
    "name" TEXT NOT NULL,
    "type" "BookkeepingCategoryType" NOT NULL,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_transactions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "connection_id" UUID,
    "source_transaction_id" TEXT,
    "transaction_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "direction" "BookkeepingTxnDirection" NOT NULL,
    "kind" "BookkeepingTxnKind" NOT NULL DEFAULT 'STANDARD',
    "status" "BookkeepingTxnStatus" NOT NULL DEFAULT 'UNCATEGORIZED',
    "category_id" UUID,
    "class_label" TEXT,
    "location_label" TEXT,
    "transfer_pair_id" UUID,
    "matched_to_id" UUID,
    "excluded_reason" TEXT,
    "duplicate_of_id" UUID,
    "receipt_document_id" UUID,
    "cleared_reconciliation_id" UUID,
    "cleared_at" TIMESTAMPTZ(3),
    "source" "BookkeepingTxnSource" NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_transaction_splits" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "memo" TEXT,
    "class_label" TEXT,
    "location_label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_transaction_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_refunds" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "kind" "BookkeepingRefundKind" NOT NULL,
    "processor" TEXT,
    "source_refund_id" TEXT,
    "original_transaction_id" UUID,
    "transaction_id" UUID,
    "refund_date" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT,
    "method" TEXT,
    "status" "BookkeepingRefundStatus" NOT NULL DEFAULT 'PENDING',
    "dispute_status" "BookkeepingDisputeStatus",
    "resolution" TEXT,
    "category_id" UUID,
    "settlement_id" UUID,
    "include_in_report" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_settlements" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "connection_id" UUID,
    "processor" TEXT NOT NULL,
    "source_settlement_id" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "payout_date" DATE NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "refunds_cents" INTEGER NOT NULL DEFAULT 0,
    "chargebacks_cents" INTEGER NOT NULL DEFAULT 0,
    "fees_cents" INTEGER NOT NULL DEFAULT 0,
    "adjustments_cents" INTEGER NOT NULL DEFAULT 0,
    "net_payout_cents" INTEGER NOT NULL,
    "net_source" "BookkeepingNetSource" NOT NULL DEFAULT 'SOURCE',
    "deposit_transaction_id" UUID,
    "status" "BookkeepingSettlementStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_at" TIMESTAMPTZ(3),
    "matched_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_settlement_items" (
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookkeeping_settlement_items_pkey" PRIMARY KEY ("settlement_id","transaction_id")
);

-- CreateTable
CREATE TABLE "bookkeeping_report_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "document_id" UUID,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_user_id" UUID,
    "delivery_status" "BookkeepingDeliveryStatus" NOT NULL DEFAULT 'NOT_SENT',
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_user_id" UUID,
    "delivery_error" TEXT,

    CONSTRAINT "bookkeeping_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_terms" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BookkeepingTermsStatus" NOT NULL DEFAULT 'DRAFT',
    "package_name" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "renewal_type" "BookkeepingRenewalType" NOT NULL DEFAULT 'AUTO',
    "renewal_date" DATE,
    "notice_days" INTEGER,
    "billing_frequency" "BookkeepingBillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "billing_timing" "BookkeepingBillingTiming" NOT NULL DEFAULT 'ADVANCE',
    "payment_terms" "BookkeepingPaymentTerms" NOT NULL DEFAULT 'DUE_ON_RECEIPT',
    "payment_terms_days" INTEGER,
    "preferred_payment_method" TEXT,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "monthly_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "setup_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "additional_billing" JSONB NOT NULL DEFAULT '[]',
    "late_fee_rule" JSONB,
    "discounts" JSONB NOT NULL DEFAULT '[]',
    "included_services" JSONB NOT NULL DEFAULT '[]',
    "excluded_services" JSONB NOT NULL DEFAULT '[]',
    "add_ons" JSONB NOT NULL DEFAULT '[]',
    "deliverables" JSONB NOT NULL DEFAULT '[]',
    "client_responsibilities" JSONB NOT NULL DEFAULT '[]',
    "firm_responsibilities" JSONB NOT NULL DEFAULT '[]',
    "effective_from" DATE NOT NULL,
    "internal_notes" TEXT,
    "agreement_document_id" UUID,
    "signed_agreement_document_id" UUID,
    "esign_request_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "superseded_at" TIMESTAMPTZ(3),
    "terminated_at" TIMESTAMPTZ(3),
    "termination_reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_terms_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "terms_id" UUID NOT NULL,
    "kind" "BookkeepingTermsEventKind" NOT NULL,
    "effective_date" DATE,
    "notice_sent_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookkeeping_terms_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_categories_business_id_id_key" ON "bookkeeping_categories"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_categories_business_id_engagement_id_id_key" ON "bookkeeping_categories"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_categories_business_id_engagement_id_name_key" ON "bookkeeping_categories"("business_id", "engagement_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_categories_business_id_connection_id_source_cat_key" ON "bookkeeping_categories"("business_id", "connection_id", "source_category_id");

-- CreateIndex
CREATE INDEX "bookkeeping_transactions_business_id_engagement_id_transact_idx" ON "bookkeeping_transactions"("business_id", "engagement_id", "transaction_date");

-- CreateIndex
CREATE INDEX "bookkeeping_transactions_business_id_engagement_id_status_idx" ON "bookkeeping_transactions"("business_id", "engagement_id", "status");

-- CreateIndex
CREATE INDEX "bookkeeping_transactions_business_id_account_id_transaction_idx" ON "bookkeeping_transactions"("business_id", "account_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_transactions_business_id_id_key" ON "bookkeeping_transactions"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_transactions_business_id_engagement_id_id_key" ON "bookkeeping_transactions"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_transactions_business_id_connection_id_source_t_key" ON "bookkeeping_transactions"("business_id", "connection_id", "source_transaction_id");

-- CreateIndex
CREATE INDEX "bookkeeping_transaction_splits_business_id_transaction_id_idx" ON "bookkeeping_transaction_splits"("business_id", "transaction_id");

-- CreateIndex
CREATE INDEX "bookkeeping_refunds_business_id_engagement_id_refund_date_idx" ON "bookkeeping_refunds"("business_id", "engagement_id", "refund_date");

-- CreateIndex
CREATE INDEX "bookkeeping_refunds_business_id_engagement_id_status_idx" ON "bookkeeping_refunds"("business_id", "engagement_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_refunds_business_id_id_key" ON "bookkeeping_refunds"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_refunds_business_id_engagement_id_processor_sou_key" ON "bookkeeping_refunds"("business_id", "engagement_id", "processor", "source_refund_id");

-- CreateIndex
CREATE INDEX "bookkeeping_settlements_business_id_engagement_id_payout_da_idx" ON "bookkeeping_settlements"("business_id", "engagement_id", "payout_date");

-- CreateIndex
CREATE INDEX "bookkeeping_settlements_business_id_engagement_id_status_idx" ON "bookkeeping_settlements"("business_id", "engagement_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_settlements_business_id_id_key" ON "bookkeeping_settlements"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_settlements_business_id_engagement_id_id_key" ON "bookkeeping_settlements"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_settlements_business_id_engagement_id_processor_key" ON "bookkeeping_settlements"("business_id", "engagement_id", "processor", "source_settlement_id");

-- CreateIndex
CREATE INDEX "bookkeeping_settlement_items_business_id_transaction_id_idx" ON "bookkeeping_settlement_items"("business_id", "transaction_id");

-- CreateIndex
CREATE INDEX "bookkeeping_report_versions_business_id_engagement_id_gener_idx" ON "bookkeeping_report_versions"("business_id", "engagement_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_report_versions_business_id_report_id_version_key" ON "bookkeeping_report_versions"("business_id", "report_id", "version");

-- CreateIndex
CREATE INDEX "bookkeeping_terms_business_id_engagement_id_status_idx" ON "bookkeeping_terms"("business_id", "engagement_id", "status");

-- CreateIndex
CREATE INDEX "bookkeeping_terms_business_id_renewal_date_idx" ON "bookkeeping_terms"("business_id", "renewal_date");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_terms_business_id_id_key" ON "bookkeeping_terms"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_terms_business_id_engagement_id_version_key" ON "bookkeeping_terms"("business_id", "engagement_id", "version");

-- CreateIndex
CREATE INDEX "bookkeeping_terms_events_business_id_terms_id_created_at_idx" ON "bookkeeping_terms_events"("business_id", "terms_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_accounts_business_id_engagement_id_id_key" ON "bookkeeping_accounts"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_connections_business_id_engagement_id_id_key" ON "bookkeeping_connections"("business_id", "engagement_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_reconciliations_business_id_id_key" ON "bookkeeping_reconciliations"("business_id", "id");

-- AddForeignKey
ALTER TABLE "bookkeeping_categories" ADD CONSTRAINT "bookkeeping_categories_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_categories" ADD CONSTRAINT "bookkeeping_categories_business_id_engagement_id_connectio_fkey" FOREIGN KEY ("business_id", "engagement_id", "connection_id") REFERENCES "bookkeeping_connections"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_categories" ADD CONSTRAINT "bookkeeping_categories_business_id_engagement_id_parent_id_fkey" FOREIGN KEY ("business_id", "engagement_id", "parent_id") REFERENCES "bookkeeping_categories"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_account_fkey" FOREIGN KEY ("business_id", "engagement_id", "account_id") REFERENCES "bookkeeping_accounts"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_connect_fkey" FOREIGN KEY ("business_id", "engagement_id", "connection_id") REFERENCES "bookkeeping_connections"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_categor_fkey" FOREIGN KEY ("business_id", "engagement_id", "category_id") REFERENCES "bookkeeping_categories"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_transfe_fkey" FOREIGN KEY ("business_id", "engagement_id", "transfer_pair_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_matched_fkey" FOREIGN KEY ("business_id", "engagement_id", "matched_to_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_duplica_fkey" FOREIGN KEY ("business_id", "engagement_id", "duplicate_of_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_engagement_id_receipt_fkey" FOREIGN KEY ("business_id", "engagement_id", "receipt_document_id") REFERENCES "documents"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transactions" ADD CONSTRAINT "bookkeeping_transactions_business_id_cleared_reconciliatio_fkey" FOREIGN KEY ("business_id", "cleared_reconciliation_id") REFERENCES "bookkeeping_reconciliations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transaction_splits" ADD CONSTRAINT "bookkeeping_transaction_splits_business_id_engagement_id_t_fkey" FOREIGN KEY ("business_id", "engagement_id", "transaction_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_transaction_splits" ADD CONSTRAINT "bookkeeping_transaction_splits_business_id_engagement_id_c_fkey" FOREIGN KEY ("business_id", "engagement_id", "category_id") REFERENCES "bookkeeping_categories"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_refunds" ADD CONSTRAINT "bookkeeping_refunds_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_refunds" ADD CONSTRAINT "bookkeeping_refunds_business_id_engagement_id_original_tra_fkey" FOREIGN KEY ("business_id", "engagement_id", "original_transaction_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_refunds" ADD CONSTRAINT "bookkeeping_refunds_business_id_engagement_id_transaction__fkey" FOREIGN KEY ("business_id", "engagement_id", "transaction_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_refunds" ADD CONSTRAINT "bookkeeping_refunds_business_id_engagement_id_category_id_fkey" FOREIGN KEY ("business_id", "engagement_id", "category_id") REFERENCES "bookkeeping_categories"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_refunds" ADD CONSTRAINT "bookkeeping_refunds_business_id_engagement_id_settlement_i_fkey" FOREIGN KEY ("business_id", "engagement_id", "settlement_id") REFERENCES "bookkeeping_settlements"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_settlements" ADD CONSTRAINT "bookkeeping_settlements_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_settlements" ADD CONSTRAINT "bookkeeping_settlements_business_id_engagement_id_connecti_fkey" FOREIGN KEY ("business_id", "engagement_id", "connection_id") REFERENCES "bookkeeping_connections"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_settlements" ADD CONSTRAINT "bookkeeping_settlements_business_id_engagement_id_deposit__fkey" FOREIGN KEY ("business_id", "engagement_id", "deposit_transaction_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_settlement_items" ADD CONSTRAINT "bookkeeping_settlement_items_business_id_engagement_id_set_fkey" FOREIGN KEY ("business_id", "engagement_id", "settlement_id") REFERENCES "bookkeeping_settlements"("business_id", "engagement_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_settlement_items" ADD CONSTRAINT "bookkeeping_settlement_items_business_id_engagement_id_tra_fkey" FOREIGN KEY ("business_id", "engagement_id", "transaction_id") REFERENCES "bookkeeping_transactions"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_report_versions" ADD CONSTRAINT "bookkeeping_report_versions_business_id_report_id_fkey" FOREIGN KEY ("business_id", "report_id") REFERENCES "bookkeeping_reports"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_report_versions" ADD CONSTRAINT "bookkeeping_report_versions_business_id_engagement_id_docu_fkey" FOREIGN KEY ("business_id", "engagement_id", "document_id") REFERENCES "documents"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms" ADD CONSTRAINT "bookkeeping_terms_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms" ADD CONSTRAINT "bookkeeping_terms_business_id_engagement_id_agreement_docu_fkey" FOREIGN KEY ("business_id", "engagement_id", "agreement_document_id") REFERENCES "documents"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms" ADD CONSTRAINT "bookkeeping_terms_business_id_engagement_id_signed_agreeme_fkey" FOREIGN KEY ("business_id", "engagement_id", "signed_agreement_document_id") REFERENCES "documents"("business_id", "engagement_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms" ADD CONSTRAINT "bookkeeping_terms_business_id_esign_request_id_fkey" FOREIGN KEY ("business_id", "esign_request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_terms_events" ADD CONSTRAINT "bookkeeping_terms_events_business_id_terms_id_fkey" FOREIGN KEY ("business_id", "terms_id") REFERENCES "bookkeeping_terms"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS, policy ----------
-- Transactions, refunds, settlements, report versions and terms are a record (never deleted;
-- exclude, void, supersede or terminate instead); a split's parts and a settlement's items are
-- rearranged while unlocked; the terms history is append-only.
GRANT SELECT, INSERT, UPDATE ON bookkeeping_categories, bookkeeping_transactions, bookkeeping_refunds,
  bookkeeping_settlements, bookkeeping_report_versions, bookkeeping_terms TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookkeeping_transaction_splits TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON bookkeeping_settlement_items TO firmivra_app;
GRANT SELECT, INSERT ON bookkeeping_terms_events TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookkeeping_categories', 'bookkeeping_transactions',
    'bookkeeping_transaction_splits', 'bookkeeping_refunds', 'bookkeeping_settlements',
    'bookkeeping_settlement_items', 'bookkeeping_report_versions', 'bookkeeping_terms',
    'bookkeeping_terms_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE bookkeeping_categories ADD CONSTRAINT bookkeeping_categories_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120
         AND (source_category_id IS NULL OR (connection_id IS NOT NULL AND char_length(source_category_id) <= 100))
         AND (parent_id IS NULL OR parent_id <> id));

-- A transaction's amount is positive (the direction says which way); its status matches what was
-- done to it: excluded with a reason, matched to another, uncategorized without a category.
ALTER TABLE bookkeeping_transactions ADD CONSTRAINT bookkeeping_transactions_shape
  CHECK (btrim(description) <> '' AND char_length(description) <= 500
         AND (payee IS NULL OR char_length(payee) <= 200)
         AND amount_cents > 0
         AND (class_label IS NULL OR char_length(class_label) <= 100)
         AND (location_label IS NULL OR char_length(location_label) <= 100)
         AND (source_transaction_id IS NULL OR (connection_id IS NOT NULL AND char_length(source_transaction_id) <= 200))
         AND (status = 'EXCLUDED') = (excluded_reason IS NOT NULL)
         AND (excluded_reason IS NULL OR (btrim(excluded_reason) <> '' AND char_length(excluded_reason) <= 500))
         AND (status <> 'MATCHED' OR matched_to_id IS NOT NULL)
         AND (status <> 'UNCATEGORIZED' OR category_id IS NULL)
         AND (transfer_pair_id IS NULL OR (kind = 'TRANSFER' AND transfer_pair_id <> id))
         AND (matched_to_id IS NULL OR matched_to_id <> id)
         AND (duplicate_of_id IS NULL OR duplicate_of_id <> id)
         AND (cleared_reconciliation_id IS NULL) = (cleared_at IS NULL));

ALTER TABLE bookkeeping_transaction_splits ADD CONSTRAINT bookkeeping_transaction_splits_shape
  CHECK (amount_cents > 0 AND (memo IS NULL OR char_length(memo) <= 500)
         AND (class_label IS NULL OR char_length(class_label) <= 100)
         AND (location_label IS NULL OR char_length(location_label) <= 100));

-- A chargeback has its dispute status, and only a chargeback does.
ALTER TABLE bookkeeping_refunds ADD CONSTRAINT bookkeeping_refunds_shape
  CHECK (amount_cents > 0
         AND (kind = 'CHARGEBACK') = (dispute_status IS NOT NULL)
         AND (processor IS NULL OR processor ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (source_refund_id IS NULL OR (processor IS NOT NULL AND char_length(source_refund_id) <= 200))
         AND (reason IS NULL OR char_length(reason) <= 500) AND (method IS NULL OR char_length(method) <= 60)
         AND (resolution IS NULL OR char_length(resolution) <= 1000)
         AND (original_transaction_id IS NULL OR transaction_id IS NULL OR original_transaction_id <> transaction_id));

-- The parts are kept apart; a calculated net is gross minus refunds, chargebacks and fees plus
-- adjustments; a matched settlement names its deposit.
ALTER TABLE bookkeeping_settlements ADD CONSTRAINT bookkeeping_settlements_shape
  CHECK (processor ~ '^[a-z][a-z0-9_]{0,59}$'
         AND (source_settlement_id IS NULL OR char_length(source_settlement_id) <= 200)
         AND period_end >= period_start AND payout_date >= period_start
         AND gross_cents >= 0 AND refunds_cents >= 0 AND chargebacks_cents >= 0 AND fees_cents >= 0
         AND (net_source <> 'CALCULATED'
              OR net_payout_cents = gross_cents - refunds_cents - chargebacks_cents - fees_cents + adjustments_cents)
         AND (status IN ('MATCHED', 'PARTIALLY_MATCHED')) = (deposit_transaction_id IS NOT NULL)
         AND (status <> 'MATCHED' OR matched_at IS NOT NULL)
         AND (matched_by_user_id IS NULL OR matched_at IS NOT NULL)
         AND (note IS NULL OR char_length(note) <= 1000));

ALTER TABLE bookkeeping_report_versions ADD CONSTRAINT bookkeeping_report_versions_shape
  CHECK (version >= 1
         AND jsonb_typeof(parameters) = 'object' AND octet_length(parameters::text) <= 16384
         AND jsonb_typeof(summary) = 'object' AND octet_length(summary::text) <= 16384
         AND (delivery_status <> 'SENT' OR sent_at IS NOT NULL)
         AND (delivery_status = 'FAILED') = (delivery_error IS NOT NULL)
         AND (delivery_error IS NULL OR char_length(delivery_error) <= 500));

ALTER TABLE bookkeeping_terms ADD CONSTRAINT bookkeeping_terms_shape
  CHECK (version >= 1 AND (end_date IS NULL OR end_date >= start_date)
         AND (package_name IS NULL OR char_length(package_name) <= 120)
         AND (renewal_type <> 'FIXED_TERM' OR end_date IS NOT NULL)
         AND (notice_days IS NULL OR notice_days BETWEEN 0 AND 365)
         AND (payment_terms = 'CUSTOM') = (payment_terms_days IS NOT NULL)
         AND (payment_terms_days IS NULL OR payment_terms_days BETWEEN 1 AND 365)
         AND (preferred_payment_method IS NULL OR char_length(preferred_payment_method) <= 60)
         AND monthly_fee_cents >= 0 AND setup_fee_cents >= 0
         AND jsonb_typeof(additional_billing) = 'array' AND jsonb_typeof(discounts) = 'array'
         AND (late_fee_rule IS NULL OR jsonb_typeof(late_fee_rule) = 'object')
         AND jsonb_typeof(included_services) = 'array' AND jsonb_typeof(excluded_services) = 'array'
         AND jsonb_typeof(add_ons) = 'array' AND jsonb_typeof(deliverables) = 'array'
         AND jsonb_typeof(client_responsibilities) = 'array' AND jsonb_typeof(firm_responsibilities) = 'array'
         AND octet_length(included_services::text) + octet_length(excluded_services::text)
             + octet_length(add_ons::text) + octet_length(deliverables::text)
             + octet_length(client_responsibilities::text) + octet_length(firm_responsibilities::text)
             + octet_length(additional_billing::text) + octet_length(discounts::text) <= 65536
         AND (internal_notes IS NULL OR char_length(internal_notes) <= 5000)
         AND (status NOT IN ('SENT', 'ACTIVE', 'SUPERSEDED') OR sent_at IS NOT NULL OR activated_at IS NOT NULL)
         AND (status NOT IN ('ACTIVE', 'SUPERSEDED') OR activated_at IS NOT NULL)
         AND (status = 'SUPERSEDED') = (superseded_at IS NOT NULL)
         AND (status = 'TERMINATED') = (terminated_at IS NOT NULL)
         AND (status <> 'TERMINATED' OR btrim(coalesce(termination_reason, '')) <> '')
         AND (termination_reason IS NULL OR char_length(termination_reason) <= 1000)
         AND (signed_at IS NULL OR signed_agreement_document_id IS NOT NULL OR esign_request_id IS NOT NULL));

ALTER TABLE bookkeeping_terms_events ADD CONSTRAINT bookkeeping_terms_events_shape
  CHECK ((reason IS NULL OR char_length(reason) <= 1000)
         AND jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 8192);

-- ---------- The ledger rules ----------
-- A closed period locks the transactions dated inside it (reopen the period first).
CREATE FUNCTION bookkeeping_ledger_locked(p_business uuid, p_engagement uuid, p_day date) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM bookkeeping_periods p
                       WHERE p.business_id = p_business AND p.engagement_id = p_engagement
                         AND p.status = 'CLOSED' AND p_day BETWEEN p.period_start AND p.period_end) $$;

-- Transactions: on a bookkeeping client; never in a closed period; a transfer's other side is the
-- same amount the other way on another account; a cleared transaction is the reconciled account's.
-- The database stamps the clearing time.
CREATE FUNCTION bookkeeping_transactions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  other bookkeeping_transactions;
  recon_account uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
         WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: a transaction belongs to an engagement with a bookkeeping profile'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.engagement_id, NEW.account_id, NEW.connection_id, NEW.source_transaction_id, NEW.source)
       IS DISTINCT FROM (OLD.engagement_id, OLD.account_id, OLD.connection_id, OLD.source_transaction_id, OLD.source) THEN
      RAISE EXCEPTION 'bookkeeping: a transaction keeps its client, account and source'
        USING ERRCODE = 'check_violation';
    END IF;
    IF bookkeeping_ledger_locked(OLD.business_id, OLD.engagement_id, OLD.transaction_date) THEN
      RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF bookkeeping_ledger_locked(NEW.business_id, NEW.engagement_id, NEW.transaction_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transfer_pair_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.transfer_pair_id IS DISTINCT FROM OLD.transfer_pair_id
          OR (NEW.amount_cents, NEW.direction) IS DISTINCT FROM (OLD.amount_cents, OLD.direction)) THEN
    SELECT * INTO other FROM bookkeeping_transactions t
    WHERE t.business_id = NEW.business_id AND t.id = NEW.transfer_pair_id;
    IF other.kind <> 'TRANSFER' OR other.amount_cents <> NEW.amount_cents
       OR other.direction = NEW.direction OR other.account_id = NEW.account_id THEN
      RAISE EXCEPTION 'bookkeeping: a transfer''s other side is the same amount the other way on another account'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.cleared_reconciliation_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.cleared_reconciliation_id END) THEN
    IF NEW.cleared_reconciliation_id IS NOT NULL THEN
      SELECT account_id INTO recon_account FROM bookkeeping_reconciliations r
      WHERE r.business_id = NEW.business_id AND r.id = NEW.cleared_reconciliation_id;
      IF recon_account IS DISTINCT FROM NEW.account_id THEN
        RAISE EXCEPTION 'bookkeeping: a transaction is cleared in its own account''s reconciliation'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cleared_at := now();
    ELSE
      NEW.cleared_at := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.cleared_at := OLD.cleared_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_transactions_rules BEFORE INSERT OR UPDATE ON bookkeeping_transactions
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_transactions_rules();

-- A split's parts are changed only while its transaction is unlocked, and a split transaction has
-- no category of its own.
CREATE FUNCTION bookkeeping_transaction_splits_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r bookkeeping_transaction_splits;
  txn bookkeeping_transactions;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT * INTO txn FROM bookkeeping_transactions t WHERE t.business_id = r.business_id AND t.id = r.transaction_id;
  IF TG_OP = 'UPDATE' AND NEW.transaction_id <> OLD.transaction_id THEN
    RAISE EXCEPTION 'bookkeeping: a split part stays on its transaction' USING ERRCODE = 'check_violation';
  END IF;
  IF FOUND AND bookkeeping_ledger_locked(txn.business_id, txn.engagement_id, txn.transaction_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_transaction_splits_rules BEFORE INSERT OR UPDATE OR DELETE ON bookkeeping_transaction_splits
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_transaction_splits_rules();

-- At commit: a split transaction's parts add up to its amount and it has no category of its own;
-- a categorized transaction has a category, parts, or (a transfer) its other side; a transfer's
-- sides name each other.
CREATE FUNCTION bookkeeping_transaction_consistent(p_business uuid, p_id uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  txn bookkeeping_transactions;
  parts bigint;
  total bigint;
BEGIN
  SELECT * INTO txn FROM bookkeeping_transactions t WHERE t.business_id = p_business AND t.id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), coalesce(sum(amount_cents), 0) INTO parts, total
  FROM bookkeeping_transaction_splits s WHERE s.business_id = p_business AND s.transaction_id = p_id;
  IF parts > 0 AND (total <> txn.amount_cents OR txn.category_id IS NOT NULL) THEN
    RAISE EXCEPTION 'bookkeeping: a split transaction''s parts add up to its amount, with no category of its own'
      USING ERRCODE = 'check_violation';
  END IF;
  IF txn.status = 'CATEGORIZED' AND txn.category_id IS NULL AND parts = 0 AND txn.transfer_pair_id IS NULL THEN
    RAISE EXCEPTION 'bookkeeping: a categorized transaction has a category, split parts or a transfer side'
      USING ERRCODE = 'check_violation';
  END IF;
  IF txn.transfer_pair_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookkeeping_transactions o
       WHERE o.business_id = p_business AND o.id = txn.transfer_pair_id AND o.transfer_pair_id = p_id) THEN
    RAISE EXCEPTION 'bookkeeping: a transfer''s two sides name each other' USING ERRCODE = 'check_violation';
  END IF;
END
$$;

CREATE FUNCTION bookkeeping_transactions_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM bookkeeping_transaction_consistent(NEW.business_id, NEW.id);
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER bookkeeping_transactions_check AFTER INSERT OR UPDATE ON bookkeeping_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bookkeeping_transactions_check();

CREATE FUNCTION bookkeeping_transaction_splits_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bookkeeping_transaction_consistent(OLD.business_id, OLD.transaction_id);
  ELSE
    PERFORM bookkeeping_transaction_consistent(NEW.business_id, NEW.transaction_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER bookkeeping_transaction_splits_check AFTER INSERT OR UPDATE OR DELETE ON bookkeeping_transaction_splits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bookkeeping_transaction_splits_check();

-- Settlements: the matched deposit is money in; the database stamps when it was matched.
CREATE FUNCTION bookkeeping_settlements_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  dir "BookkeepingTxnDirection";
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.engagement_id, NEW.processor, NEW.source_settlement_id)
                          IS DISTINCT FROM (OLD.engagement_id, OLD.processor, OLD.source_settlement_id) THEN
    RAISE EXCEPTION 'bookkeeping: a settlement keeps its client and source' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deposit_transaction_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.deposit_transaction_id IS DISTINCT FROM OLD.deposit_transaction_id) THEN
    SELECT direction INTO dir FROM bookkeeping_transactions t
    WHERE t.business_id = NEW.business_id AND t.id = NEW.deposit_transaction_id;
    IF dir IS DISTINCT FROM 'CREDIT' THEN
      RAISE EXCEPTION 'bookkeeping: a settlement is matched to a deposit (money in)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'MATCHED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'MATCHED') THEN
    NEW.matched_at := now();
  ELSIF NEW.status <> 'MATCHED' THEN
    NEW.matched_at := NULL;
    NEW.matched_by_user_id := NULL;
  ELSE
    NEW.matched_at := OLD.matched_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_settlements_rules BEFORE INSERT OR UPDATE ON bookkeeping_settlements
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_settlements_rules();

-- Report versions: on the report's own client, numbered per report by the database; what was
-- generated never changes; only the delivery moves (the database stamps when it was sent).
CREATE FUNCTION bookkeeping_report_versions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  report_engagement uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT engagement_id INTO report_engagement FROM bookkeeping_reports r
    WHERE r.business_id = NEW.business_id AND r.id = NEW.report_id;
    IF report_engagement IS DISTINCT FROM NEW.engagement_id THEN
      RAISE EXCEPTION 'bookkeeping: a report version is on its report''s client' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('bookkeeping_report_versions:' || NEW.report_id));
    SELECT coalesce(max(version), 0) + 1 INTO NEW.version FROM bookkeeping_report_versions v
    WHERE v.business_id = NEW.business_id AND v.report_id = NEW.report_id;
    NEW.generated_at := now();
    IF NEW.delivery_status <> 'NOT_SENT' THEN
      RAISE EXCEPTION 'bookkeeping: a new report version is not sent yet' USING ERRCODE = 'check_violation';
    END IF;
    NEW.sent_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.engagement_id, NEW.report_id, NEW.version, NEW.parameters, NEW.summary, NEW.document_id,
      NEW.generated_at, NEW.generated_by_user_id)
     IS DISTINCT FROM
     (OLD.id, OLD.engagement_id, OLD.report_id, OLD.version, OLD.parameters, OLD.summary, OLD.document_id,
      OLD.generated_at, OLD.generated_by_user_id) THEN
    RAISE EXCEPTION 'bookkeeping: a generated report version never changes; generate a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.delivery_status = 'SENT' AND OLD.delivery_status IS DISTINCT FROM 'SENT' THEN
    NEW.sent_at := now();
  ELSIF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status AND OLD.delivery_status = 'SENT' THEN
    RAISE EXCEPTION 'bookkeeping: a sent report version stays sent' USING ERRCODE = 'check_violation';
  ELSE
    NEW.sent_at := OLD.sent_at;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_report_versions_rules BEFORE INSERT OR UPDATE ON bookkeeping_report_versions
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_report_versions_rules();

-- Terms: numbered per client by the database; a new version starts as a draft. Only a draft is
-- edited (a sent one goes back to draft to change). DRAFT -> SENT -> ACTIVE (or DRAFT -> ACTIVE),
-- SENT -> DRAFT, ACTIVE -> TERMINATED (with a reason); a version becoming ACTIVE supersedes the
-- one before it, so one version is in force at a time. Once ACTIVE the terms never change; signing
-- details and the internal notes still may, until superseded or terminated. The database stamps
-- the times.
CREATE FUNCTION bookkeeping_terms_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
         WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: terms belong to an engagement with a bookkeeping profile'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'bookkeeping: new terms start as a draft' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('bookkeeping_terms:' || NEW.engagement_id));
    SELECT coalesce(max(version), 0) + 1 INTO NEW.version FROM bookkeeping_terms t
    WHERE t.business_id = NEW.business_id AND t.engagement_id = NEW.engagement_id;
    NEW.sent_at := NULL; NEW.signed_at := NULL; NEW.activated_at := NULL;
    NEW.superseded_at := NULL; NEW.terminated_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.engagement_id, NEW.version, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.engagement_id, OLD.version, OLD.created_at) THEN
    RAISE EXCEPTION 'bookkeeping: terms keep their client and version' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'TERMINATED') THEN
    RAISE EXCEPTION 'bookkeeping: % terms never change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT'
     AND (NEW.package_name, NEW.start_date, NEW.end_date, NEW.renewal_type, NEW.renewal_date, NEW.notice_days,
          NEW.billing_frequency, NEW.billing_timing, NEW.payment_terms, NEW.payment_terms_days,
          NEW.preferred_payment_method, NEW.autopay, NEW.monthly_fee_cents, NEW.setup_fee_cents,
          NEW.additional_billing, NEW.late_fee_rule, NEW.discounts, NEW.included_services, NEW.excluded_services,
          NEW.add_ons, NEW.deliverables, NEW.client_responsibilities, NEW.firm_responsibilities,
          NEW.effective_from, NEW.agreement_document_id)
         IS DISTINCT FROM
         (OLD.package_name, OLD.start_date, OLD.end_date, OLD.renewal_type, OLD.renewal_date, OLD.notice_days,
          OLD.billing_frequency, OLD.billing_timing, OLD.payment_terms, OLD.payment_terms_days,
          OLD.preferred_payment_method, OLD.autopay, OLD.monthly_fee_cents, OLD.setup_fee_cents,
          OLD.additional_billing, OLD.late_fee_rule, OLD.discounts, OLD.included_services, OLD.excluded_services,
          OLD.add_ons, OLD.deliverables, OLD.client_responsibilities, OLD.firm_responsibilities,
          OLD.effective_from, OLD.agreement_document_id) THEN
    RAISE EXCEPTION 'bookkeeping: only draft terms are edited; create a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.sent_at := OLD.sent_at;
  NEW.activated_at := OLD.activated_at;
  NEW.superseded_at := OLD.superseded_at;
  NEW.terminated_at := OLD.terminated_at;
  IF NEW.signed_at IS DISTINCT FROM OLD.signed_at THEN
    NEW.signed_at := CASE WHEN NEW.signed_at IS NULL THEN NULL ELSE now() END;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SENT', 'ACTIVE'))
            OR (OLD.status = 'SENT' AND NEW.status IN ('DRAFT', 'ACTIVE'))
            OR (OLD.status = 'ACTIVE' AND NEW.status IN ('SUPERSEDED', 'TERMINATED'))) THEN
      RAISE EXCEPTION 'bookkeeping: % terms cannot become %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'SENT' THEN NEW.sent_at := now(); END IF;
    IF NEW.status = 'ACTIVE' THEN
      NEW.activated_at := now();
      UPDATE bookkeeping_terms SET status = 'SUPERSEDED'
      WHERE business_id = NEW.business_id AND engagement_id = NEW.engagement_id AND status = 'ACTIVE' AND id <> NEW.id;
    END IF;
    IF NEW.status = 'SUPERSEDED' THEN NEW.superseded_at := now(); END IF;
    IF NEW.status = 'TERMINATED' THEN NEW.terminated_at := now(); END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_terms_rules BEFORE INSERT OR UPDATE ON bookkeeping_terms
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_terms_rules();

CREATE FUNCTION bookkeeping_terms_events_stamp() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF current_user = 'firmivra_app' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_terms_events_stamp BEFORE INSERT ON bookkeeping_terms_events
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_terms_events_stamp();
