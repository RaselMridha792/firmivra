-- CreateEnum
CREATE TYPE "StripeOnboardingStatus" AS ENUM ('PENDING', 'RESTRICTED', 'COMPLETE');

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "account_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "account_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "stripe_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "onboarding_status" "StripeOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "details_submitted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stripe_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_accounts_business_id_key" ON "stripe_accounts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_accounts_account_id_key" ON "stripe_accounts"("account_id");

-- AddForeignKey
ALTER TABLE "stripe_accounts" ADD CONSTRAINT "stripe_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 10: Stripe Connect (Octavia, Oct 5) ====================
-- Each firm is paid into its own Stripe connected account; Firmivra's account is the platform.
-- A payment runs only on the firm's account, and a webhook event is accepted only from it, so an
-- event can mark an invoice paid only for the firm whose account sent it.

-- ---------- Grants and RLS ----------
GRANT SELECT, INSERT, UPDATE ON stripe_accounts TO firmivra_app;
ALTER TABLE stripe_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_accounts FORCE ROW LEVEL SECURITY;

-- The firm sees and keeps its own row. Platform scope can read every row: payment setup status
-- is business metadata, and the webhook uses it to find which firm an acct_ id belongs to before
-- it opens that firm's business scope.
CREATE POLICY stripe_accounts_select ON stripe_accounts FOR SELECT
  USING (app_scope() = 'platform' OR business_id = app_current_business_id());
CREATE POLICY stripe_accounts_insert ON stripe_accounts FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY stripe_accounts_update ON stripe_accounts FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules ----------
ALTER TABLE stripe_accounts ADD CONSTRAINT stripe_accounts_account_id CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');
ALTER TABLE stripe_accounts ADD CONSTRAINT stripe_accounts_complete
  CHECK (onboarding_status <> 'COMPLETE' OR (charges_enabled AND payouts_enabled));
ALTER TABLE payments ADD CONSTRAINT payments_account_id CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');
ALTER TABLE payment_events ADD CONSTRAINT payment_events_account_id CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');

-- The firm and its account id never change once connected (reconnecting is a support task).
CREATE FUNCTION stripe_accounts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.account_id <> OLD.account_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'stripe accounts: the connected account of a firm cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER stripe_accounts_rules
  BEFORE UPDATE ON stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION stripe_accounts_rules();

-- ---------- Payments: only on the firm's own account, with charges enabled ----------
-- Same as r0_billing, plus the account checks.
CREATE OR REPLACE FUNCTION payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.paid_at IS NOT NULL OR NEW.refunded_at IS NOT NULL THEN
      RAISE EXCEPTION 'payments: a payment starts PENDING' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices i
                   WHERE i.id = NEW.invoice_id AND i.status = 'OPEN' AND i.currency = NEW.currency) THEN
      RAISE EXCEPTION 'payments: only an open invoice can be paid, in its own currency'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stripe_accounts a
                   WHERE a.business_id = NEW.business_id AND a.account_id = NEW.account_id
                     AND a.charges_enabled) THEN
      RAISE EXCEPTION 'payments: a payment runs only on the firm''s own connected account, with charges enabled'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.invoice_id <> OLD.invoice_id
     OR NEW.amount_cents <> OLD.amount_cents OR NEW.currency <> OLD.currency
     OR NEW.processor <> OLD.processor OR NEW.processor_ref <> OLD.processor_ref
     OR NEW.account_id <> OLD.account_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'payments: the invoice, amount, account and processor reference cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
         OR (OLD.status = 'SUCCEEDED' AND NEW.status = 'REFUNDED')) THEN
      RAISE EXCEPTION 'payments: a payment cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Money moves only on a recorded event about this payment, from the same connected account.
    IF NEW.status IN ('SUCCEEDED', 'REFUNDED')
       AND NOT EXISTS (SELECT 1 FROM payment_events e
                       WHERE e.payment_id = NEW.id AND e.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'payments: % needs a recorded processor event for this payment', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ---------- Webhook events: only from the firm's own account; a payment of that account ----------
CREATE OR REPLACE FUNCTION payment_events_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM stripe_accounts a
                   WHERE a.business_id = NEW.business_id AND a.account_id = NEW.account_id) THEN
      RAISE EXCEPTION 'payment events: the event must come from the firm''s own connected account'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.processor <> OLD.processor
     OR NEW.processor_event_id <> OLD.processor_event_id OR NEW.type <> OLD.type
     OR NEW.account_id <> OLD.account_id OR NEW.received_at <> OLD.received_at
     OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
     OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
    RAISE EXCEPTION 'payment events: an event is recorded once; only its payment and processed time are set, once'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.payment_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.payment_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM payments p
                     WHERE p.id = NEW.payment_id AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'payment events: the payment must have run on the account that sent the event'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER payment_events_rules ON payment_events;
CREATE TRIGGER payment_events_rules
  BEFORE INSERT OR UPDATE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION payment_events_rules();
