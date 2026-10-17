-- r0_platform_billing (R0, Oct 17, Super Admin schema stage B3): Firmivra bills firms (Rasel, Oct 17:
-- the billed party is the firm; its billing contact is the 'client' of the spec; documents link
-- to the firm's subscription). Invoices, recurring schedules, estimates, payments, refunds,
-- credit notes and their applications, settings, per-firm billing profiles, document numbers and
-- subscription history. Money is integer cents; totals and the paid, credited and refunded sums
-- are kept by the database. Contract note: docs/work/R0-stage-b3-billing.md.

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PlatformRecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PlatformRecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlatformEstimateStatus" AS ENUM ('DRAFT', 'SENT', 'PENDING', 'APPROVED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PlatformPaymentMethod" AS ENUM ('CARD', 'ACH', 'WIRE', 'CHECK', 'CASH', 'CREDIT_BALANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformRefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlatformCreditNoteStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'PARTIALLY_APPLIED', 'APPLIED', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PlatformBillingDocType" AS ENUM ('INVOICE', 'ESTIMATE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "PlatformSubscriptionChangeKind" AS ENUM ('CREATED', 'UPGRADED', 'DOWNGRADED', 'SEATS_CHANGED', 'CYCLE_CHANGED', 'STATUS_CHANGED', 'RENEWED', 'CANCEL_REQUESTED', 'CANCELED');

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "default_payment_term_days" INTEGER NOT NULL DEFAULT 30,
    "default_tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "estimate_valid_days" INTEGER NOT NULL DEFAULT 30,
    "allow_partial_payments" BOOLEAN NOT NULL DEFAULT true,
    "late_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "late_fee_grace_days" INTEGER NOT NULL DEFAULT 0,
    "reminders" JSONB NOT NULL DEFAULT '{}',
    "templates" JSONB NOT NULL DEFAULT '{}',
    "invoice_footer" TEXT,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_firm_billing_profiles" (
    "business_id" UUID NOT NULL,
    "billing_contact_name" TEXT NOT NULL,
    "billing_contact_email" TEXT NOT NULL,
    "payment_term_days" INTEGER,
    "tax_exempt" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate_bps" INTEGER,
    "auto_pay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_firm_billing_profiles_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "platform_billing_counters" (
    "doc_type" "PlatformBillingDocType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "platform_billing_counters_pkey" PRIMARY KEY ("doc_type")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "business_id" UUID NOT NULL,
    "subscription_id" UUID,
    "recurring_id" UUID,
    "recurring_occurrence" DATE,
    "source_estimate_id" UUID,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "bill_to_name" TEXT NOT NULL,
    "bill_to_email" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "internal_note" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "credited_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "allow_online_payment" BOOLEAN NOT NULL DEFAULT true,
    "sent_at" TIMESTAMPTZ(3),
    "send_error" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoice_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_cents" INTEGER NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_recurring_invoices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "subscription_id" UUID,
    "description" TEXT NOT NULL,
    "frequency" "PlatformRecurringFrequency" NOT NULL,
    "interval_days" INTEGER,
    "line_template" JSONB NOT NULL DEFAULT '[]',
    "amount_cents" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "next_invoice_date" DATE,
    "end_date" DATE,
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "auto_pay" BOOLEAN NOT NULL DEFAULT false,
    "status" "PlatformRecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_estimates" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "business_id" UUID NOT NULL,
    "status" "PlatformEstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE NOT NULL,
    "expiration_date" DATE NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "assigned_user_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_estimate_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "estimate_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_cents" INTEGER NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_estimate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "method" "PlatformPaymentMethod" NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_on" DATE NOT NULL,
    "reference" TEXT,
    "processor_ref" TEXT,
    "failure_reason" TEXT,
    "notes" TEXT,
    "receipt_sent_at" TIMESTAMPTZ(3),
    "recorded_by_user_id" UUID,
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_refunds" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PlatformRefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "internal_note" TEXT,
    "processor_ref" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_credit_notes" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "business_id" UUID NOT NULL,
    "related_invoice_id" UUID,
    "status" "PlatformCreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issue_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "customer_note" TEXT,
    "internal_note" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "applied_cents" INTEGER NOT NULL DEFAULT 0,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_credit_note_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_cents" INTEGER NOT NULL,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_credit_applications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "applied_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payment_events" (
    "id" UUID NOT NULL,
    "processor" TEXT NOT NULL DEFAULT 'stripe',
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_subscription_changes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "kind" "PlatformSubscriptionChangeKind" NOT NULL,
    "from_plan_id" UUID,
    "to_plan_id" UUID,
    "from_status" "PlatformSubscriptionStatus",
    "to_status" "PlatformSubscriptionStatus",
    "from_seats" INTEGER,
    "to_seats" INTEGER,
    "reason" TEXT,
    "effective_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_subscription_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_source_estimate_id_key" ON "platform_invoices"("source_estimate_id");

-- CreateIndex
CREATE INDEX "platform_invoices_business_id_status_idx" ON "platform_invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_date_idx" ON "platform_invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_business_id_id_key" ON "platform_invoices"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_recurring_id_recurring_occurrence_key" ON "platform_invoices"("recurring_id", "recurring_occurrence");

-- CreateIndex
CREATE INDEX "platform_invoice_lines_invoice_id_sort_order_idx" ON "platform_invoice_lines"("invoice_id", "sort_order");

-- CreateIndex
CREATE INDEX "platform_recurring_invoices_status_next_invoice_date_idx" ON "platform_recurring_invoices"("status", "next_invoice_date");

-- CreateIndex
CREATE INDEX "platform_recurring_invoices_business_id_idx" ON "platform_recurring_invoices"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_estimates_number_key" ON "platform_estimates"("number");

-- CreateIndex
CREATE INDEX "platform_estimates_business_id_status_idx" ON "platform_estimates"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_estimates_business_id_id_key" ON "platform_estimates"("business_id", "id");

-- CreateIndex
CREATE INDEX "platform_estimate_lines_estimate_id_sort_order_idx" ON "platform_estimate_lines"("estimate_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_processor_ref_key" ON "platform_payments"("processor_ref");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_idempotency_key_key" ON "platform_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "platform_payments_business_id_invoice_id_idx" ON "platform_payments"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "platform_payments_status_paid_on_idx" ON "platform_payments"("status", "paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payments_business_id_id_key" ON "platform_payments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_refunds_processor_ref_key" ON "platform_refunds"("processor_ref");

-- CreateIndex
CREATE INDEX "platform_refunds_business_id_payment_id_idx" ON "platform_refunds"("business_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_credit_notes_number_key" ON "platform_credit_notes"("number");

-- CreateIndex
CREATE INDEX "platform_credit_notes_business_id_status_idx" ON "platform_credit_notes"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_credit_notes_business_id_id_key" ON "platform_credit_notes"("business_id", "id");

-- CreateIndex
CREATE INDEX "platform_credit_note_lines_credit_note_id_sort_order_idx" ON "platform_credit_note_lines"("credit_note_id", "sort_order");

-- CreateIndex
CREATE INDEX "platform_credit_applications_business_id_invoice_id_idx" ON "platform_credit_applications"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payment_events_processor_event_id_key" ON "platform_payment_events"("processor", "event_id");

-- CreateIndex
CREATE INDEX "platform_subscription_changes_business_id_effective_at_idx" ON "platform_subscription_changes"("business_id", "effective_at");

-- CreateIndex
CREATE INDEX "platform_subscription_changes_kind_effective_at_idx" ON "platform_subscription_changes"("kind", "effective_at");

-- AddForeignKey
ALTER TABLE "platform_firm_billing_profiles" ADD CONSTRAINT "platform_firm_billing_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "platform_firm_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "platform_recurring_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_source_estimate_id_fkey" FOREIGN KEY ("source_estimate_id") REFERENCES "platform_estimates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "platform_invoices"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_recurring_invoices" ADD CONSTRAINT "platform_recurring_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_recurring_invoices" ADD CONSTRAINT "platform_recurring_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "platform_firm_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_estimates" ADD CONSTRAINT "platform_estimates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_estimate_lines" ADD CONSTRAINT "platform_estimate_lines_business_id_estimate_id_fkey" FOREIGN KEY ("business_id", "estimate_id") REFERENCES "platform_estimates"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "platform_invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_refunds" ADD CONSTRAINT "platform_refunds_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "platform_payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_notes" ADD CONSTRAINT "platform_credit_notes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_notes" ADD CONSTRAINT "platform_credit_notes_business_id_related_invoice_id_fkey" FOREIGN KEY ("business_id", "related_invoice_id") REFERENCES "platform_invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_note_lines" ADD CONSTRAINT "platform_credit_note_lines_business_id_credit_note_id_fkey" FOREIGN KEY ("business_id", "credit_note_id") REFERENCES "platform_credit_notes"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_applications" ADD CONSTRAINT "platform_credit_applications_business_id_credit_note_id_fkey" FOREIGN KEY ("business_id", "credit_note_id") REFERENCES "platform_credit_notes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_credit_applications" ADD CONSTRAINT "platform_credit_applications_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "platform_invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_subscription_changes" ADD CONSTRAINT "platform_subscription_changes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "platform_firm_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
ALTER TABLE platform_billing_settings ADD CONSTRAINT platform_billing_settings_values
  CHECK (id = 1 AND currency ~ '^[a-z]{3}$'
         AND default_payment_term_days BETWEEN 0 AND 365
         AND default_tax_rate_bps BETWEEN 0 AND 10000 AND estimate_valid_days BETWEEN 1 AND 365
         AND late_fee_bps BETWEEN 0 AND 10000 AND late_fee_grace_days BETWEEN 0 AND 365
         AND jsonb_typeof(reminders) = 'object' AND jsonb_typeof(templates) = 'object'
         AND (invoice_footer IS NULL OR platform_text_ok(invoice_footer, 1000)));

ALTER TABLE platform_firm_billing_profiles ADD CONSTRAINT platform_firm_billing_profiles_values
  CHECK (platform_text_ok(billing_contact_name, 200)
         AND billing_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
         AND char_length(billing_contact_email) <= 254
         AND (payment_term_days IS NULL OR payment_term_days BETWEEN 0 AND 365)
         AND (tax_rate_bps IS NULL OR tax_rate_bps BETWEEN 0 AND 10000)
         AND (notes IS NULL OR platform_text_ok(notes, 1000)));

ALTER TABLE platform_billing_counters ADD CONSTRAINT platform_billing_counters_values
  CHECK (prefix ~ '^[A-Z]{2,5}-$' AND last_number >= 1000);

-- An invoice: its total is its lines less the discount plus tax; what was paid and credited never
-- passes the total; refunds never pass what was paid. Each state carries its facts.
ALTER TABLE platform_invoices ADD CONSTRAINT platform_invoices_values
  CHECK (currency ~ '^[a-z]{3}$' AND due_date >= invoice_date
         AND (period_end IS NULL OR (period_start IS NOT NULL AND period_end >= period_start))
         AND (recurring_occurrence IS NULL) = (recurring_id IS NULL)
         AND platform_text_ok(bill_to_name, 200)
         AND bill_to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
         AND char_length(bill_to_email) <= 254
         AND (reference IS NULL OR platform_text_ok(reference, 100))
         AND (notes IS NULL OR platform_text_ok(notes, 2000))
         AND (internal_note IS NULL OR platform_text_ok(internal_note, 2000))
         AND (send_error IS NULL OR platform_text_ok(send_error, 500))
         AND discount_cents >= 0 AND subtotal_cents >= 0 AND tax_cents >= 0
         AND discount_cents <= subtotal_cents
         AND total_cents = subtotal_cents - discount_cents + tax_cents
         AND paid_cents >= 0 AND credited_cents >= 0 AND refunded_cents >= 0
         AND paid_cents + credited_cents <= total_cents AND refunded_cents <= paid_cents
         AND (status = 'DRAFT') = (sent_at IS NULL)
         AND (status = 'VOIDED') = (voided_at IS NOT NULL)
         AND (voided_at IS NULL) = (void_reason IS NULL)
         AND (void_reason IS NULL OR platform_text_ok(void_reason, 500))
         AND (status <> 'VOIDED' OR (paid_cents = 0 AND credited_cents = 0))
         AND (status NOT IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
              OR paid_cents + credited_cents = total_cents)
         AND (paid_at IS NULL OR status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')));

ALTER TABLE platform_estimates ADD CONSTRAINT platform_estimates_values
  CHECK (currency ~ '^[a-z]{3}$' AND expiration_date >= issue_date
         AND platform_text_ok(contact_name, 200)
         AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
         AND char_length(contact_email) <= 254
         AND (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{6,14}$')
         AND (reference IS NULL OR platform_text_ok(reference, 100))
         AND (notes IS NULL OR platform_text_ok(notes, 2000))
         AND discount_cents >= 0 AND subtotal_cents >= 0 AND tax_cents >= 0
         AND discount_cents <= subtotal_cents
         AND total_cents = subtotal_cents - discount_cents + tax_cents
         AND (status = 'DRAFT') = (sent_at IS NULL)
         AND (status IN ('APPROVED', 'DECLINED', 'CONVERTED')) = (decided_at IS NOT NULL));

ALTER TABLE platform_credit_notes ADD CONSTRAINT platform_credit_notes_values
  CHECK (currency ~ '^[a-z]{3}$' AND platform_text_ok(reason, 500)
         AND (customer_note IS NULL OR platform_text_ok(customer_note, 2000))
         AND (internal_note IS NULL OR platform_text_ok(internal_note, 2000))
         AND subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents
         AND applied_cents >= 0 AND refunded_cents >= 0
         AND applied_cents + refunded_cents <= total_cents
         AND (status = 'DRAFT') = (issued_at IS NULL)
         AND (status = 'VOIDED') = (voided_at IS NOT NULL)
         AND (voided_at IS NULL) = (void_reason IS NULL)
         AND (void_reason IS NULL OR platform_text_ok(void_reason, 500))
         AND (status <> 'VOIDED' OR (applied_cents = 0 AND refunded_cents = 0)));

ALTER TABLE platform_invoice_lines ADD CONSTRAINT platform_invoice_lines_values
  CHECK (platform_text_ok(description, 500) AND quantity > 0 AND unit_cents >= 0
         AND tax_rate_bps BETWEEN 0 AND 10000 AND sort_order >= 0);
ALTER TABLE platform_estimate_lines ADD CONSTRAINT platform_estimate_lines_values
  CHECK (platform_text_ok(description, 500) AND quantity > 0 AND unit_cents >= 0
         AND tax_rate_bps BETWEEN 0 AND 10000 AND sort_order >= 0);
ALTER TABLE platform_credit_note_lines ADD CONSTRAINT platform_credit_note_lines_values
  CHECK (platform_text_ok(description, 500) AND quantity > 0 AND unit_cents >= 0
         AND tax_rate_bps BETWEEN 0 AND 10000 AND sort_order >= 0);

ALTER TABLE platform_recurring_invoices ADD CONSTRAINT platform_recurring_invoices_values
  CHECK (platform_text_ok(description, 500) AND amount_cents >= 0
         AND (frequency = 'CUSTOM') = (interval_days IS NOT NULL)
         AND (interval_days IS NULL OR interval_days BETWEEN 1 AND 366)
         AND (end_date IS NULL OR end_date >= start_date)
         AND jsonb_typeof(line_template) = 'array' AND jsonb_array_length(line_template) <= 50);

ALTER TABLE platform_payments ADD CONSTRAINT platform_payments_values
  CHECK (amount_cents > 0 AND refunded_cents BETWEEN 0 AND amount_cents
         AND (reference IS NULL OR platform_text_ok(reference, 200))
         AND (notes IS NULL OR platform_text_ok(notes, 1000))
         AND (status = 'FAILED') = (failure_reason IS NOT NULL)
         AND (failure_reason IS NULL OR platform_text_ok(failure_reason, 500))
         AND (refunded_cents = 0 OR status IN ('PARTIALLY_REFUNDED', 'REFUNDED')));

ALTER TABLE platform_refunds ADD CONSTRAINT platform_refunds_values
  CHECK (amount_cents > 0 AND platform_text_ok(reason, 500)
         AND (internal_note IS NULL OR platform_text_ok(internal_note, 1000))
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL));

ALTER TABLE platform_credit_applications ADD CONSTRAINT platform_credit_applications_values
  CHECK (amount_cents > 0);

ALTER TABLE platform_payment_events ADD CONSTRAINT platform_payment_events_values
  CHECK (processor ~ '^[a-z]{2,20}$' AND btrim(event_id) <> '' AND char_length(event_id) <= 255
         AND type ~ '^[a-z][a-z0-9_.]{0,99}$');

ALTER TABLE platform_subscription_changes ADD CONSTRAINT platform_subscription_changes_values
  CHECK ((reason IS NULL OR platform_text_ok(reason, 1000))
         AND (from_seats IS NULL OR from_seats >= 0) AND (to_seats IS NULL OR to_seats >= 0));

-- ---------- Numbers: INV-, EST-, CN-, never reused ----------
CREATE FUNCTION platform_billing_next_number(doc "PlatformBillingDocType") RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $f$ UPDATE platform_billing_counters SET last_number = last_number + 1 WHERE doc_type = doc
         RETURNING prefix || last_number $f$;
REVOKE ALL ON FUNCTION platform_billing_next_number("PlatformBillingDocType") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_billing_next_number("PlatformBillingDocType") TO firmivra_app;

-- ---------- Lines: amounts by the database, changed only while the document is a DRAFT ----------
CREATE FUNCTION platform_billing_line_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  parent_status text;
  row_rec record;
BEGIN
  row_rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'platform_invoice_lines' THEN
    SELECT status::text INTO parent_status FROM platform_invoices WHERE id = row_rec.invoice_id FOR UPDATE;
  ELSIF TG_TABLE_NAME = 'platform_estimate_lines' THEN
    SELECT status::text INTO parent_status FROM platform_estimates WHERE id = row_rec.estimate_id FOR UPDATE;
  ELSE
    SELECT status::text INTO parent_status FROM platform_credit_notes WHERE id = row_rec.credit_note_id FOR UPDATE;
  END IF;
  -- A parent being deleted takes its lines with it (cascade); anything else waits for DRAFT.
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION '%: lines change only while the document is a DRAFT', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.amount_cents := round(NEW.quantity * NEW.unit_cents)::integer;
  NEW.tax_cents := round(NEW.amount_cents * NEW.tax_rate_bps / 10000.0)::integer;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END
$$;

-- After any line change: the document's subtotal and tax from its lines (its own trigger then
-- works out the total from the discount).
CREATE FUNCTION platform_billing_line_totals() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  row_rec record;
BEGIN
  row_rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_TABLE_NAME = 'platform_invoice_lines' THEN
    UPDATE platform_invoices i SET
      subtotal_cents = coalesce((SELECT sum(amount_cents) FROM platform_invoice_lines WHERE invoice_id = i.id), 0),
      tax_cents = coalesce((SELECT sum(tax_cents) FROM platform_invoice_lines WHERE invoice_id = i.id), 0)
    WHERE i.id = row_rec.invoice_id;
  ELSIF TG_TABLE_NAME = 'platform_estimate_lines' THEN
    UPDATE platform_estimates e SET
      subtotal_cents = coalesce((SELECT sum(amount_cents) FROM platform_estimate_lines WHERE estimate_id = e.id), 0),
      tax_cents = coalesce((SELECT sum(tax_cents) FROM platform_estimate_lines WHERE estimate_id = e.id), 0)
    WHERE e.id = row_rec.estimate_id;
  ELSE
    UPDATE platform_credit_notes c SET
      subtotal_cents = coalesce((SELECT sum(amount_cents) FROM platform_credit_note_lines WHERE credit_note_id = c.id), 0),
      tax_cents = coalesce((SELECT sum(tax_cents) FROM platform_credit_note_lines WHERE credit_note_id = c.id), 0)
    WHERE c.id = row_rec.credit_note_id;
  END IF;
  RETURN NULL;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_invoice_lines', 'platform_estimate_lines',
                           'platform_credit_note_lines'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I '
                   'FOR EACH ROW EXECUTE FUNCTION platform_billing_line_rules()', t || '_rules', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
                   'FOR EACH ROW EXECUTE FUNCTION platform_billing_line_totals()', t || '_totals', t);
  END LOOP;
END
$$;

-- ---------- Money on an invoice: kept by the database ----------
-- What was paid (COMPLETED payments, refunded or not), refunded and credited, and the status that
-- follows. Run after every payment, refund and credit application. The marker lets this one
-- update set the money columns, which the invoice's rules refuse to anyone else.
CREATE FUNCTION platform_invoice_recompute(inv uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  paid integer;
  refunded integer;
  credited integer;
  i record;
  next_status "PlatformInvoiceStatus";
BEGIN
  SELECT * INTO i FROM platform_invoices WHERE id = inv FOR UPDATE;
  SELECT coalesce(sum(amount_cents), 0), coalesce(sum(refunded_cents), 0) INTO paid, refunded
    FROM platform_payments
    WHERE invoice_id = inv AND status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED');
  SELECT coalesce(sum(amount_cents), 0) INTO credited
    FROM platform_credit_applications WHERE invoice_id = inv;
  next_status := CASE
    WHEN i.status IN ('DRAFT', 'VOIDED') THEN i.status
    WHEN refunded > 0 AND refunded = paid THEN 'REFUNDED'
    WHEN refunded > 0 THEN 'PARTIALLY_REFUNDED'
    WHEN paid + credited >= i.total_cents AND i.total_cents > 0 THEN 'PAID'
    WHEN paid + credited > 0 THEN 'PARTIALLY_PAID'
    ELSE 'SENT' END;
  PERFORM set_config('app.billing_recompute', inv::text, true);
  UPDATE platform_invoices SET
    paid_cents = paid, refunded_cents = refunded, credited_cents = credited, status = next_status,
    paid_at = CASE WHEN next_status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                   THEN coalesce(paid_at, now()) END
  WHERE id = inv;
  PERFORM set_config('app.billing_recompute', '', true);
END
$$;

CREATE FUNCTION platform_credit_note_recompute(cn uuid) RETURNS void
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  applied integer;
  c record;
BEGIN
  SELECT * INTO c FROM platform_credit_notes WHERE id = cn FOR UPDATE;
  SELECT coalesce(sum(amount_cents), 0) INTO applied FROM platform_credit_applications
    WHERE credit_note_id = cn;
  PERFORM set_config('app.billing_recompute', cn::text, true);
  UPDATE platform_credit_notes SET
    applied_cents = applied,
    status = CASE
      WHEN c.status IN ('DRAFT', 'VOIDED') THEN c.status
      WHEN applied + c.refunded_cents >= c.total_cents AND c.refunded_cents > 0 AND applied = 0 THEN 'REFUNDED'
      WHEN applied + c.refunded_cents >= c.total_cents THEN 'APPLIED'
      WHEN applied > 0 THEN 'PARTIALLY_APPLIED'
      ELSE 'AVAILABLE' END
  WHERE id = cn;
  PERFORM set_config('app.billing_recompute', '', true);
END
$$;

-- ---------- Rules per document ----------
-- Invoices: the database gives the number and the times. After DRAFT what was billed is fixed;
-- the API moves DRAFT -> SENT and voids an invoice that holds no money; the money columns and the
-- paid / refunded statuses come only from platform_invoice_recompute. VOIDED is final.
CREATE FUNCTION platform_invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  by_recompute boolean := coalesce(current_setting('app.billing_recompute', true), '') = NEW.id::text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.paid_cents <> 0 OR NEW.credited_cents <> 0
       OR NEW.refunded_cents <> 0 THEN
      RAISE EXCEPTION 'platform invoices: an invoice starts as an empty DRAFT'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.number := platform_billing_next_number('INVOICE');
    NEW.created_at := now();
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
    RETURN NEW;
  END IF;
  IF (NEW.number, NEW.business_id, NEW.created_by_user_id, NEW.created_at, NEW.currency)
     IS DISTINCT FROM (OLD.number, OLD.business_id, OLD.created_by_user_id, OLD.created_at, OLD.currency) THEN
    RAISE EXCEPTION 'platform invoices: the number, firm and creator never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'platform invoices: a VOIDED invoice never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT'
     AND (NEW.subscription_id, NEW.recurring_id, NEW.recurring_occurrence, NEW.source_estimate_id,
          NEW.invoice_date, NEW.due_date, NEW.period_start, NEW.period_end, NEW.bill_to_name,
          NEW.bill_to_email, NEW.reference, NEW.discount_cents, NEW.subtotal_cents, NEW.tax_cents)
         IS DISTINCT FROM
         (OLD.subscription_id, OLD.recurring_id, OLD.recurring_occurrence, OLD.source_estimate_id,
          OLD.invoice_date, OLD.due_date, OLD.period_start, OLD.period_end, OLD.bill_to_name,
          OLD.bill_to_email, OLD.reference, OLD.discount_cents, OLD.subtotal_cents, OLD.tax_cents) THEN
    RAISE EXCEPTION 'platform invoices: what was billed is fixed once sent' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT by_recompute THEN
    IF (NEW.paid_cents, NEW.credited_cents, NEW.refunded_cents, NEW.paid_at)
       IS DISTINCT FROM (OLD.paid_cents, OLD.credited_cents, OLD.refunded_cents, OLD.paid_at) THEN
      RAISE EXCEPTION 'platform invoices: payments, credits and refunds set the money columns'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SENT')
                OR (OLD.status IN ('DRAFT', 'SENT') AND NEW.status = 'VOIDED')) THEN
      RAISE EXCEPTION 'platform invoices: % cannot become % by hand', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'SENT' AND OLD.status = 'DRAFT' THEN
    NEW.sent_at := now();
  END IF;
  IF NEW.status = 'VOIDED' THEN
    NEW.voided_at := now();
  END IF;
  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_invoices_rules BEFORE INSERT OR UPDATE ON platform_invoices
  FOR EACH ROW EXECUTE FUNCTION platform_invoices_rules();

-- Estimates: numbered by the database; what was quoted is fixed once sent; CONVERTED needs the
-- invoice made from it; CONVERTED and DECLINED are final; only a DRAFT is deleted.
CREATE FUNCTION platform_estimates_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'platform estimates: only a DRAFT is deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'platform estimates: an estimate starts as a DRAFT' USING ERRCODE = 'check_violation';
    END IF;
    NEW.number := platform_billing_next_number('ESTIMATE');
    NEW.created_at := now();
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
    RETURN NEW;
  END IF;
  IF (NEW.number, NEW.business_id, NEW.created_by_user_id, NEW.created_at, NEW.currency)
     IS DISTINCT FROM (OLD.number, OLD.business_id, OLD.created_by_user_id, OLD.created_at, OLD.currency) THEN
    RAISE EXCEPTION 'platform estimates: the number, firm and creator never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('CONVERTED', 'DECLINED') THEN
    RAISE EXCEPTION 'platform estimates: a % estimate never changes', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT'
     AND (NEW.issue_date, NEW.expiration_date, NEW.contact_name, NEW.contact_email,
          NEW.discount_cents, NEW.subtotal_cents, NEW.tax_cents)
         IS DISTINCT FROM
         (OLD.issue_date, OLD.expiration_date, OLD.contact_name, OLD.contact_email,
          OLD.discount_cents, OLD.subtotal_cents, OLD.tax_cents) THEN
    RAISE EXCEPTION 'platform estimates: what was quoted is fixed once sent' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CONVERTED' AND NOT EXISTS (
       SELECT 1 FROM platform_invoices WHERE source_estimate_id = NEW.id) THEN
    RAISE EXCEPTION 'platform estimates: CONVERTED needs the invoice made from it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'DRAFT' AND OLD.status = 'DRAFT' THEN
    NEW.sent_at := now();
  END IF;
  IF NEW.status IN ('APPROVED', 'DECLINED', 'CONVERTED') AND NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status NOT IN ('APPROVED') THEN
    NEW.decided_at := now();
  END IF;
  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_estimates_rules BEFORE INSERT OR UPDATE OR DELETE ON platform_estimates
  FOR EACH ROW EXECUTE FUNCTION platform_estimates_rules();

-- Credit notes: numbered by the database; what was credited is fixed once issued; the API moves
-- DRAFT -> AVAILABLE (issue) and voids one nothing was applied or refunded from; applied and the
-- applied statuses come only from platform_credit_note_recompute. VOIDED is final.
CREATE FUNCTION platform_credit_notes_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  by_recompute boolean := coalesce(current_setting('app.billing_recompute', true), '') = NEW.id::text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.applied_cents <> 0 OR NEW.refunded_cents <> 0 THEN
      RAISE EXCEPTION 'platform credit notes: a credit note starts as an empty DRAFT'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.number := platform_billing_next_number('CREDIT_NOTE');
    NEW.created_at := now();
    NEW.total_cents := NEW.subtotal_cents + NEW.tax_cents;
    RETURN NEW;
  END IF;
  IF (NEW.number, NEW.business_id, NEW.created_by_user_id, NEW.created_at, NEW.currency)
     IS DISTINCT FROM (OLD.number, OLD.business_id, OLD.created_by_user_id, OLD.created_at, OLD.currency) THEN
    RAISE EXCEPTION 'platform credit notes: the number, firm and creator never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'platform credit notes: a VOIDED credit note never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT'
     AND (NEW.related_invoice_id, NEW.issue_date, NEW.reason, NEW.subtotal_cents, NEW.tax_cents)
         IS DISTINCT FROM
         (OLD.related_invoice_id, OLD.issue_date, OLD.reason, OLD.subtotal_cents, OLD.tax_cents) THEN
    RAISE EXCEPTION 'platform credit notes: what was credited is fixed once issued'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT by_recompute THEN
    IF NEW.applied_cents IS DISTINCT FROM OLD.applied_cents THEN
      RAISE EXCEPTION 'platform credit notes: applications set what was applied'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'AVAILABLE')
                OR (OLD.status IN ('DRAFT', 'AVAILABLE') AND NEW.status = 'VOIDED')
                OR (NEW.status = 'REFUNDED' AND NEW.refunded_cents + NEW.applied_cents = NEW.total_cents)) THEN
      RAISE EXCEPTION 'platform credit notes: % cannot become % by hand', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'AVAILABLE' AND OLD.status = 'DRAFT' THEN
    NEW.issued_at := now();
  END IF;
  IF NEW.status = 'VOIDED' THEN
    NEW.voided_at := now();
  END IF;
  NEW.total_cents := NEW.subtotal_cents + NEW.tax_cents;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_credit_notes_rules BEFORE INSERT OR UPDATE ON platform_credit_notes
  FOR EACH ROW EXECUTE FUNCTION platform_credit_notes_rules();

-- Payments: on an invoice that is sent and not void; a COMPLETED payment never takes the invoice
-- past its total. What was paid never changes; PENDING becomes COMPLETED or FAILED; the refunded
-- amount and the refunded statuses come only from the refunds.
CREATE FUNCTION platform_payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  i record;
  by_recompute boolean := coalesce(current_setting('app.billing_recompute', true), '') = NEW.id::text;
BEGIN
  SELECT * INTO i FROM platform_invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF i.status IN ('DRAFT', 'VOIDED') THEN
      RAISE EXCEPTION 'platform payments: only a sent invoice takes payments' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status NOT IN ('PENDING', 'COMPLETED', 'FAILED') OR NEW.refunded_cents <> 0 THEN
      RAISE EXCEPTION 'platform payments: a payment starts PENDING, COMPLETED or FAILED'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
  ELSE
    IF (NEW.invoice_id, NEW.business_id, NEW.amount_cents, NEW.method, NEW.idempotency_key, NEW.created_at)
       IS DISTINCT FROM (OLD.invoice_id, OLD.business_id, OLD.amount_cents, OLD.method, OLD.idempotency_key, OLD.created_at) THEN
      RAISE EXCEPTION 'platform payments: what was paid never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT by_recompute AND (
         NEW.refunded_cents IS DISTINCT FROM OLD.refunded_cents
         OR (NEW.status IS DISTINCT FROM OLD.status
             AND NOT (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED', 'FAILED')))) THEN
      RAISE EXCEPTION 'platform payments: % cannot become % by hand', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'COMPLETED' AND (TG_OP = 'INSERT' OR OLD.status = 'PENDING')
     AND i.paid_cents + i.credited_cents + NEW.amount_cents > i.total_cents THEN
    RAISE EXCEPTION 'platform payments: more than the invoice balance' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_payments_rules BEFORE INSERT OR UPDATE ON platform_payments
  FOR EACH ROW EXECUTE FUNCTION platform_payments_rules();

CREATE FUNCTION platform_payments_after() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_invoice_recompute(NEW.invoice_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER platform_payments_after AFTER INSERT OR UPDATE ON platform_payments
  FOR EACH ROW EXECUTE FUNCTION platform_payments_after();

-- Refunds: on a COMPLETED (or part-refunded) payment, never more than what is left of it; the
-- amount never changes; PENDING becomes COMPLETED or FAILED. A COMPLETED refund updates the
-- payment, which updates the invoice.
CREATE FUNCTION platform_refunds_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  p record;
  held integer;
BEGIN
  SELECT * INTO p FROM platform_payments WHERE id = NEW.payment_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF p.status NOT IN ('COMPLETED', 'PARTIALLY_REFUNDED') THEN
      RAISE EXCEPTION 'platform refunds: only a completed payment is refunded' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'platform refunds: a refund starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(amount_cents), 0) INTO held FROM platform_refunds
      WHERE payment_id = NEW.payment_id AND status <> 'FAILED';
    IF held + NEW.amount_cents > p.amount_cents THEN
      RAISE EXCEPTION 'platform refunds: more than is left of the payment' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  IF (NEW.payment_id, NEW.business_id, NEW.amount_cents, NEW.created_at)
     IS DISTINCT FROM (OLD.payment_id, OLD.business_id, OLD.amount_cents, OLD.created_at) THEN
    RAISE EXCEPTION 'platform refunds: what was refunded never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED', 'FAILED')) THEN
    RAISE EXCEPTION 'platform refunds: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'COMPLETED' AND OLD.status = 'PENDING' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_refunds_rules BEFORE INSERT OR UPDATE ON platform_refunds
  FOR EACH ROW EXECUTE FUNCTION platform_refunds_rules();

CREATE FUNCTION platform_refunds_after() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  done integer;
  p record;
BEGIN
  IF NEW.status <> 'COMPLETED' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO p FROM platform_payments WHERE id = NEW.payment_id;
  SELECT coalesce(sum(amount_cents), 0) INTO done FROM platform_refunds
    WHERE payment_id = NEW.payment_id AND status = 'COMPLETED';
  PERFORM set_config('app.billing_recompute', NEW.payment_id::text, true);
  UPDATE platform_payments SET refunded_cents = done,
    status = (CASE WHEN done >= p.amount_cents THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END)::"PlatformPaymentStatus"
  WHERE id = NEW.payment_id;
  PERFORM set_config('app.billing_recompute', '', true);
  RETURN NULL;
END
$$;
CREATE TRIGGER platform_refunds_after AFTER INSERT OR UPDATE ON platform_refunds
  FOR EACH ROW EXECUTE FUNCTION platform_refunds_after();

-- Credit applications: from an issued credit note with enough left, onto a sent invoice with
-- enough balance, of the same firm (the composite keys); then both documents are recomputed.
CREATE FUNCTION platform_credit_applications_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  c record;
  i record;
BEGIN
  SELECT * INTO c FROM platform_credit_notes WHERE id = NEW.credit_note_id FOR UPDATE;
  SELECT * INTO i FROM platform_invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF c.status NOT IN ('AVAILABLE', 'PARTIALLY_APPLIED') THEN
    RAISE EXCEPTION 'platform credit applications: the credit note is not available'
      USING ERRCODE = 'check_violation';
  END IF;
  IF i.status IN ('DRAFT', 'VOIDED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'platform credit applications: the invoice takes no credit'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_cents > c.total_cents - c.applied_cents - c.refunded_cents THEN
    RAISE EXCEPTION 'platform credit applications: more than the credit note has left'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount_cents > i.total_cents - i.paid_cents - i.credited_cents THEN
    RAISE EXCEPTION 'platform credit applications: more than the invoice balance'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_credit_applications_rules BEFORE INSERT ON platform_credit_applications
  FOR EACH ROW EXECUTE FUNCTION platform_credit_applications_rules();

CREATE FUNCTION platform_credit_applications_after() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM platform_credit_note_recompute(NEW.credit_note_id);
  PERFORM platform_invoice_recompute(NEW.invoice_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER platform_credit_applications_after AFTER INSERT ON platform_credit_applications
  FOR EACH ROW EXECUTE FUNCTION platform_credit_applications_after();

-- History rows take the database's time.
CREATE FUNCTION platform_billing_stamp_created_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_subscription_changes_stamp BEFORE INSERT ON platform_subscription_changes
  FOR EACH ROW EXECUTE FUNCTION platform_billing_stamp_created_at();

-- ---------- Grants ----------
-- Invoices and credit notes are voided, never deleted (numbers are never reused); a DRAFT estimate
-- may be deleted (its rule refuses any other); lines change only while their document is a DRAFT.
-- Applications and subscription history are insert-only. The counters are read-only for the app.
GRANT SELECT, INSERT, UPDATE ON platform_invoices, platform_credit_notes, platform_payments,
  platform_refunds, platform_recurring_invoices, platform_firm_billing_profiles,
  platform_billing_settings, platform_payment_events TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_estimates, platform_invoice_lines,
  platform_estimate_lines, platform_credit_note_lines TO firmivra_app;
GRANT SELECT, INSERT ON platform_credit_applications, platform_subscription_changes TO firmivra_app;
GRANT SELECT ON platform_billing_counters TO firmivra_app;

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_billing_settings', 'platform_firm_billing_profiles',
    'platform_billing_counters', 'platform_invoices', 'platform_invoice_lines',
    'platform_recurring_invoices', 'platform_estimates', 'platform_estimate_lines',
    'platform_payments', 'platform_refunds', 'platform_credit_notes',
    'platform_credit_note_lines', 'platform_credit_applications', 'platform_payment_events',
    'platform_subscription_changes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- The Super Admin team (admin scope) and the platform's jobs (recurring runs, processor webhooks,
-- reminders: platform scope). Which team member may do which action is the API's check
-- (billing.* keys in platform_role_permissions).
CREATE FUNCTION app_is_billing_staff() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member() $$;

CREATE FUNCTION app_is_billed_firm(firm uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_scope() = 'business' AND firm = app_current_business_id() $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform_billing_settings', 'platform_firm_billing_profiles',
    'platform_invoices', 'platform_invoice_lines', 'platform_recurring_invoices',
    'platform_estimates', 'platform_estimate_lines', 'platform_payments', 'platform_refunds',
    'platform_credit_notes', 'platform_credit_note_lines', 'platform_credit_applications',
    'platform_payment_events', 'platform_subscription_changes'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_billing_staff()) '
                   'WITH CHECK (app_is_billing_staff())', t || '_staff', t);
  END LOOP;
END
$$;

-- The counters hold numbers only; anyone may read them, only the owner-run function moves them.
CREATE POLICY platform_billing_counters_all ON platform_billing_counters FOR ALL
  USING (true) WITH CHECK (true);

-- A firm reads what Firmivra billed it once issued (never a draft), with the lines, payments,
-- refunds and credit, and its own subscription history and billing profile. It writes none.
CREATE POLICY platform_invoices_firm_read ON platform_invoices FOR SELECT
  USING (app_is_billed_firm(business_id) AND status <> 'DRAFT');
CREATE POLICY platform_invoice_lines_firm_read ON platform_invoice_lines FOR SELECT
  USING (app_is_billed_firm(business_id)
         AND EXISTS (SELECT 1 FROM platform_invoices i WHERE i.id = invoice_id AND i.status <> 'DRAFT'));
CREATE POLICY platform_estimates_firm_read ON platform_estimates FOR SELECT
  USING (app_is_billed_firm(business_id) AND status <> 'DRAFT');
CREATE POLICY platform_estimate_lines_firm_read ON platform_estimate_lines FOR SELECT
  USING (app_is_billed_firm(business_id)
         AND EXISTS (SELECT 1 FROM platform_estimates e WHERE e.id = estimate_id AND e.status <> 'DRAFT'));
CREATE POLICY platform_credit_notes_firm_read ON platform_credit_notes FOR SELECT
  USING (app_is_billed_firm(business_id) AND status <> 'DRAFT');
CREATE POLICY platform_credit_note_lines_firm_read ON platform_credit_note_lines FOR SELECT
  USING (app_is_billed_firm(business_id)
         AND EXISTS (SELECT 1 FROM platform_credit_notes c WHERE c.id = credit_note_id AND c.status <> 'DRAFT'));
CREATE POLICY platform_payments_firm_read ON platform_payments FOR SELECT
  USING (app_is_billed_firm(business_id));
CREATE POLICY platform_refunds_firm_read ON platform_refunds FOR SELECT
  USING (app_is_billed_firm(business_id));
CREATE POLICY platform_credit_applications_firm_read ON platform_credit_applications FOR SELECT
  USING (app_is_billed_firm(business_id));
CREATE POLICY platform_firm_billing_profiles_firm_read ON platform_firm_billing_profiles FOR SELECT
  USING (app_is_billed_firm(business_id));
CREATE POLICY platform_subscription_changes_firm_read ON platform_subscription_changes FOR SELECT
  USING (app_is_billed_firm(business_id));

-- ---------- Defaults ----------
INSERT INTO platform_billing_settings (id, updated_at, reminders)
  VALUES (1, now(), '{"beforeDueDays": [3], "afterDueDays": [1, 7, 14]}');
INSERT INTO platform_billing_counters (doc_type, prefix, last_number) VALUES
  ('INVOICE', 'INV-', 1000), ('ESTIMATE', 'EST-', 1000), ('CREDIT_NOTE', 'CN-', 1000);
