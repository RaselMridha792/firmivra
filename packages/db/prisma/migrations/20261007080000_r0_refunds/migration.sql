-- Refunds (Rasel, Oct 7; the lead's review of #48): one row per Stripe refund, the only record of
-- refunds. A refund counts once Stripe's charge.refunded event confirms it (SUCCEEDED, linked to
-- that event), which also records refunds a firm makes in its own Stripe dashboard. A payment's
-- refunds never add up to more than the payment. The database sets the payment REFUNDED when
-- confirmed refunds cover all of it; partial refunds leave it SUCCEEDED. The invoice stays PAID.

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "processor" "PaymentProcessor" NOT NULL DEFAULT 'STRIPE',
    "processor_refund_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "event_id" UUID,
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_refunds_business_id_payment_id_idx" ON "payment_refunds"("business_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_refunds_processor_processor_refund_id_key" ON "payment_refunds"("processor", "processor_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_business_id_id_key" ON "payment_events"("business_id", "id");

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_business_id_event_id_fkey" FOREIGN KEY ("business_id", "event_id") REFERENCES "payment_events"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS: financial records, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON payment_refunds TO firmivra_app;
ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_refunds_business ON payment_refunds
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules ----------
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_amount_positive CHECK (amount_cents > 0);
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_currency CHECK (currency ~ '^[a-z]{3}$');
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_account_id
  CHECK (account_id ~ '^acct_[A-Za-z0-9]+$');
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_refund_id_format
  CHECK (processor_refund_id ~ '^[a-z]+_[A-Za-z0-9_]+$' AND char_length(processor_refund_id) <= 255);
-- Confirmed means: linked to its refund event, with the time it was refunded.
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_confirmed
  CHECK ((status = 'SUCCEEDED') = (event_id IS NOT NULL AND refunded_at IS NOT NULL));

-- A refund belongs to a succeeded payment, in its account and currency; refunds that are not
-- FAILED never add up to more than the payment (the payment row is locked, so two refunds at once
-- cannot both pass). PENDING -> SUCCEEDED (with a charge.refunded event of this payment, from its
-- account) or FAILED; SUCCEEDED and FAILED are final.
CREATE FUNCTION payment_refunds_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  pay record;
  reserved bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'FAILED' THEN
      RAISE EXCEPTION 'refunds: a refund starts PENDING, or SUCCEEDED when its event confirms it'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT p.status, p.amount_cents, p.account_id, p.currency INTO pay
      FROM payments p WHERE p.id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR pay.status NOT IN ('SUCCEEDED', 'REFUNDED') THEN
      RAISE EXCEPTION 'refunds: only a succeeded payment can be refunded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.account_id <> pay.account_id OR NEW.currency <> pay.currency THEN
      RAISE EXCEPTION 'refunds: a refund is in the payment''s own account and currency'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(sum(r.amount_cents), 0) INTO reserved
      FROM payment_refunds r WHERE r.payment_id = NEW.payment_id AND r.status <> 'FAILED';
    IF reserved + NEW.amount_cents > pay.amount_cents THEN
      RAISE EXCEPTION 'refunds: a payment''s refunds cannot add up to more than the payment'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.payment_id <> OLD.payment_id
       OR NEW.processor <> OLD.processor OR NEW.processor_refund_id <> OLD.processor_refund_id
       OR NEW.account_id <> OLD.account_id OR NEW.amount_cents <> OLD.amount_cents
       OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'refunds: the payment, refund id, account and amount cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING'
       AND (NEW.status <> OLD.status OR NEW.event_id IS DISTINCT FROM OLD.event_id
            OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at) THEN
      RAISE EXCEPTION 'refunds: a succeeded or failed refund is final'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'SUCCEEDED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SUCCEEDED')
     AND NOT EXISTS (SELECT 1 FROM payment_events e
                     WHERE e.id = NEW.event_id AND e.payment_id = NEW.payment_id
                       AND e.account_id = NEW.account_id AND e.type = 'charge.refunded') THEN
    RAISE EXCEPTION 'refunds: SUCCEEDED needs the charge.refunded event of this payment, from its account'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payment_refunds_rules
  BEFORE INSERT OR UPDATE ON payment_refunds
  FOR EACH ROW EXECUTE FUNCTION payment_refunds_rules();

-- When confirmed refunds cover the whole payment, the database marks it REFUNDED (once).
CREATE FUNCTION payment_refunds_settle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = 'SUCCEEDED' THEN
    UPDATE payments p SET status = 'REFUNDED', refunded_at = NEW.refunded_at
     WHERE p.id = NEW.payment_id AND p.status = 'SUCCEEDED'
       AND (SELECT sum(r.amount_cents) FROM payment_refunds r
             WHERE r.payment_id = NEW.payment_id AND r.status = 'SUCCEEDED') >= p.amount_cents;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER payment_refunds_settle
  AFTER INSERT OR UPDATE ON payment_refunds
  FOR EACH ROW EXECUTE FUNCTION payment_refunds_settle();

-- ---------- Payments: REFUNDED comes only from the refund rows ----------
-- As r0_billing_review, except REFUNDED: the app can no longer set it; only payment_refunds_settle
-- (one trigger level down) does, from confirmed refunds.
CREATE OR REPLACE FUNCTION payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.paid_at IS NOT NULL OR NEW.refunded_at IS NOT NULL
       OR NEW.failure_code IS NOT NULL THEN
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
  IF (OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at)
     OR (OLD.refunded_at IS NOT NULL AND NEW.refunded_at IS DISTINCT FROM OLD.refunded_at)
     OR (OLD.failure_code IS NOT NULL AND NEW.failure_code IS DISTINCT FROM OLD.failure_code) THEN
    RAISE EXCEPTION 'payments: paid_at, refunded_at and failure_code are set once'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('SUCCEEDED', 'FAILED'))
         OR (OLD.status = 'SUCCEEDED' AND NEW.status = 'REFUNDED')) THEN
      RAISE EXCEPTION 'payments: a payment cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Money moves only on a recorded event of the right type about this payment, from its account.
    IF NEW.status = 'SUCCEEDED'
       AND NOT EXISTS (SELECT 1 FROM payment_events e
                       WHERE e.payment_id = NEW.id AND e.account_id = NEW.account_id
                         AND e.type IN ('payment_intent.succeeded', 'checkout.session.completed')) THEN
      RAISE EXCEPTION 'payments: SUCCEEDED needs a recorded success event for this payment'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'REFUNDED' AND pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'payments: REFUNDED is set by the database when confirmed refunds cover the payment'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
