-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "InvoiceEventType" AS ENUM ('CREATED', 'SENT', 'RESENT', 'VIEWED', 'REMINDER_SENT', 'OVERDUE_REMINDER_SENT', 'RECEIPT_SENT', 'PAYMENT_LINK_COPIED', 'NOTE', 'ACTIVITY_LOGGED', 'FOLLOW_UP_SCHEDULED', 'ARCHIVED', 'UNARCHIVED');

-- CreateEnum
CREATE TYPE "InvoiceActorKind" AS ENUM ('STAFF', 'CLIENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "payment_settings" (
    "business_id" UUID NOT NULL,
    "accept_card" BOOLEAN NOT NULL DEFAULT true,
    "accept_ach" BOOLEAN NOT NULL DEFAULT true,
    "accept_manual" BOOLEAN NOT NULL DEFAULT true,
    "auto_receipts" BOOLEAN NOT NULL DEFAULT true,
    "send_reminders" BOOLEAN NOT NULL DEFAULT true,
    "notify_overdue" BOOLEAN NOT NULL DEFAULT true,
    "auto_apply_payments" BOOLEAN NOT NULL DEFAULT true,
    "invoice_prefix" TEXT NOT NULL DEFAULT 'INV-',
    "default_terms" TEXT NOT NULL DEFAULT 'net_14',
    "default_memo" TEXT,
    "due_soon_days" INTEGER NOT NULL DEFAULT 14,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "overdue_reminder_days" INTEGER NOT NULL DEFAULT 7,
    "retry_attempts" INTEGER NOT NULL DEFAULT 3,
    "retry_interval_days" INTEGER NOT NULL DEFAULT 3,
    "late_fee_enabled" BOOLEAN NOT NULL DEFAULT false,
    "late_fee_type" "LateFeeType",
    "late_fee_percent" DECIMAL(5,2),
    "late_fee_cents" INTEGER,
    "tipping_enabled" BOOLEAN NOT NULL DEFAULT false,
    "require_payment_before_due" BOOLEAN NOT NULL DEFAULT false,
    "portal_payments_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "invoice_tracking" (
    "invoice_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "first_viewed_at" TIMESTAMPTZ(3),
    "last_viewed_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMPTZ(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "last_overdue_reminder_at" TIMESTAMPTZ(3),
    "autopay_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_autopay_attempt_at" TIMESTAMPTZ(3),
    "autopay_failure_code" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_tracking_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateTable
CREATE TABLE "invoice_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "type" "InvoiceEventType" NOT NULL,
    "actor_kind" "InvoiceActorKind" NOT NULL DEFAULT 'STAFF',
    "actor_user_id" UUID,
    "body" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_tracking_business_id_archived_at_idx" ON "invoice_tracking"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tracking_business_id_invoice_id_key" ON "invoice_tracking"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_events_business_id_invoice_id_created_at_idx" ON "invoice_events"("business_id", "invoice_id", "created_at");

-- AddForeignKey
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tracking" ADD CONSTRAINT "invoice_tracking_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tracking" ADD CONSTRAINT "invoice_tracking_business_id_archived_by_user_id_fkey" FOREIGN KEY ("business_id", "archived_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_business_id_actor_user_id_fkey" FOREIGN KEY ("business_id", "actor_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Payment Settings screen (one row per firm; the defaults are the column
-- defaults), what happens around an invoice that is not its money (views, reminders, AutoPay
-- retries, archiving) and the invoice's activity timeline.

-- ---------- Grants and RLS: only the firm's own business scope ----------
GRANT SELECT, INSERT, UPDATE ON payment_settings, invoice_tracking TO firmivra_app;
GRANT SELECT, INSERT ON invoice_events TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_settings', 'invoice_tracking', 'invoice_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE payment_settings
  ADD CONSTRAINT payment_settings_invoice_prefix CHECK (invoice_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  ADD CONSTRAINT payment_settings_default_terms CHECK (default_terms ~ '^[a-z0-9_]{1,30}$'),
  ADD CONSTRAINT payment_settings_default_memo CHECK (char_length(default_memo) <= 500),
  ADD CONSTRAINT payment_settings_days
    CHECK (due_soon_days BETWEEN 1 AND 90 AND reminder_days_before BETWEEN 0 AND 60
           AND overdue_reminder_days BETWEEN 0 AND 90 AND retry_attempts BETWEEN 0 AND 10
           AND retry_interval_days BETWEEN 1 AND 14),
  -- A late fee is a percentage or a fixed amount, never both; switched on, it needs one.
  ADD CONSTRAINT payment_settings_late_fee
    CHECK (coalesce(late_fee_type = 'PERCENT', false) = (late_fee_percent IS NOT NULL)
           AND coalesce(late_fee_type = 'FIXED', false) = (late_fee_cents IS NOT NULL)
           AND (late_fee_percent IS NULL OR late_fee_percent > 0 AND late_fee_percent <= 100)
           AND (late_fee_cents IS NULL OR late_fee_cents > 0)
           AND (NOT late_fee_enabled OR late_fee_type IS NOT NULL));

ALTER TABLE invoice_tracking
  ADD CONSTRAINT invoice_tracking_counts
    CHECK (view_count >= 0 AND reminder_count >= 0 AND autopay_attempts >= 0),
  ADD CONSTRAINT invoice_tracking_views
    CHECK ((view_count > 0) = (first_viewed_at IS NOT NULL)
           AND (first_viewed_at IS NULL) = (last_viewed_at IS NULL)
           AND (first_viewed_at IS NULL OR last_viewed_at >= first_viewed_at)),
  ADD CONSTRAINT invoice_tracking_archived CHECK ((archived_at IS NULL) = (archived_by_user_id IS NULL)),
  ADD CONSTRAINT invoice_tracking_failure_code
    CHECK (autopay_failure_code IS NULL OR autopay_failure_code ~ '^[a-z0-9_.-]{1,64}$');

ALTER TABLE invoice_events
  ADD CONSTRAINT invoice_events_body CHECK (char_length(body) <= 2000),
  ADD CONSTRAINT invoice_events_text
    CHECK (type NOT IN ('NOTE', 'ACTIVITY_LOGGED') OR btrim(coalesce(body, '')) <> ''),
  -- Staff events name the staff member; client and system events never do.
  ADD CONSTRAINT invoice_events_actor CHECK ((actor_kind = 'STAFF') = (actor_user_id IS NOT NULL));
