-- Lead's review of #48 (Oct 7): close these in the database, so a single API bug can't do damage.

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- 1. Stripe accounts: written only in platform scope ----------
-- Onboarding (after Stripe's accounts.create returns the acct_ id) and the account.updated
-- webhook run in platform scope. A firm reads its own row but can never claim an acct_ id or
-- switch charges on, so no firm can route another account's webhooks to itself.
DROP POLICY stripe_accounts_insert ON stripe_accounts;
DROP POLICY stripe_accounts_update ON stripe_accounts;
CREATE POLICY stripe_accounts_insert ON stripe_accounts FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY stripe_accounts_update ON stripe_accounts FOR UPDATE
  USING (app_scope() = 'platform')
  WITH CHECK (app_scope() = 'platform');

-- ---------- 2 and 3. Payments: status by event type; set-once fields ----------
-- SUCCEEDED needs a success event (payment_intent.succeeded or checkout.session.completed) and
-- REFUNDED a refund event (charge.refunded), each about this payment and from its account.
-- paid_at, refunded_at and failure_code never change once set; failure_code only on FAILED.
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
    IF NEW.status = 'REFUNDED'
       AND NOT EXISTS (SELECT 1 FROM payment_events e
                       WHERE e.payment_id = NEW.id AND e.account_id = NEW.account_id
                         AND e.type = 'charge.refunded') THEN
      RAISE EXCEPTION 'payments: REFUNDED needs a recorded refund event for this payment'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

ALTER TABLE payments ADD CONSTRAINT payments_failure_code
  CHECK (failure_code IS NULL OR (status = 'FAILED' AND failure_code ~ '^[a-z0-9_]{1,64}$'));
-- Stripe ids: a lower-case prefix, an underscore, then letters, digits or underscores (cs_..., pi_...).
ALTER TABLE payments ADD CONSTRAINT payments_processor_ref_format
  CHECK (processor_ref ~ '^[a-z]+_[A-Za-z0-9_]+$' AND char_length(processor_ref) <= 255);
ALTER TABLE payment_events ADD CONSTRAINT payment_events_event_id_format
  CHECK (processor_event_id ~ '^[a-z]+_[A-Za-z0-9_]+$' AND char_length(processor_event_id) <= 255);

-- ---------- 3. Invoices: a paid or canceled invoice is frozen; cancel_reason only when canceled;
--               an invoice is issued only with something to pay ----------
CREATE OR REPLACE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.subtotal_cents <> 0 OR NEW.issued_at IS NOT NULL
       OR NEW.paid_at IS NOT NULL OR NEW.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoices: a new invoice starts as an empty DRAFT; add lines, then issue it'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'invoices: the client of an invoice cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Final means every field: amounts, dates, number, reason, author.
  IF OLD.status IN ('PAID', 'CANCELED')
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'invoices: a paid or canceled invoice is final'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only the invoice_lines trigger (one level down) moves the subtotal.
  IF NEW.subtotal_cents <> OLD.subtotal_cents AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'invoices: the subtotal is kept by the database from the lines'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.number <> OLD.number OR NEW.currency <> OLD.currency
          OR NEW.discount_cents <> OLD.discount_cents
          OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id) THEN
    RAISE EXCEPTION 'invoices: an issued invoice keeps its number, client, engagement and amounts'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'OPEN' AND NEW.status IN ('PAID', 'CANCELED'))) THEN
      RAISE EXCEPTION 'invoices: an invoice cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nothing to pay means nothing to issue: an empty or fully discounted invoice is canceled.
    IF NEW.status = 'OPEN' AND NEW.subtotal_cents - NEW.discount_cents <= 0 THEN
      RAISE EXCEPTION 'invoices: an invoice is issued only with an amount to pay'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PAID' THEN
      SELECT coalesce(sum(p.amount_cents), 0) INTO paid_cents
        FROM payments p WHERE p.invoice_id = NEW.id AND p.status = 'SUCCEEDED';
      IF paid_cents < NEW.subtotal_cents - NEW.discount_cents THEN
        RAISE EXCEPTION 'invoices: PAID needs succeeded payments covering the total'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
  RETURN NEW;
END
$$;

ALTER TABLE invoices ADD CONSTRAINT invoices_cancel_reason
  CHECK (cancel_reason IS NULL
         OR (status = 'CANCELED' AND btrim(cancel_reason) <> '' AND char_length(cancel_reason) <= 500));

-- ---------- Content: sizes (screens render Markdown bodies with raw HTML off) ----------
ALTER TABLE content_items ADD CONSTRAINT content_items_lengths
  CHECK (char_length(title) <= 200 AND char_length(body) <= 20000
         AND char_length(description) <= 1000
         AND btrim(category) <> '' AND char_length(category) <= 100);
