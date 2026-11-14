-- R1 (Rasel's approval in R1's window, Nov 13: his invoice-archive decision; the lead's queue).
-- invoices_rules, replaced in place: a paid or canceled invoice stays final in every field but
-- archived_at, so it can be archived and restored (IP-F10) while its amounts, payments, number,
-- dates and status never change. Everything else in the function is as r36_invoice_core left it.
-- No row changes; safe on dev.

CREATE OR REPLACE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
  reopening boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.subtotal_cents <> 0 OR NEW.taxable_subtotal_cents <> 0
       OR NEW.tax_cents <> 0 OR NEW.issued_at IS NOT NULL
       OR NEW.paid_at IS NOT NULL OR NEW.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoices: a new invoice starts as an empty DRAFT; add lines, then issue it'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM invoices_check_new_rate(NEW.business_id, NEW.tax_rate_id);
    NEW.tax_rate_bps := invoices_tax_rate_bps(NEW.business_id, NEW.tax_rate_id);
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'invoices: the client of an invoice cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only offline_payments_reopen (one level down) takes a PAID invoice back to OPEN.
  reopening := OLD.status = 'PAID' AND NEW.status = 'OPEN' AND NEW.paid_at IS NULL
    AND pg_trigger_depth() >= 2
    AND (to_jsonb(NEW) - ARRAY['status', 'paid_at', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['status', 'paid_at', 'updated_at']);
  -- Final means every field: amounts, dates, number, reason, author. Archiving (archived_at) is
  -- the one change a final invoice takes: it hides it from the lists and changes nothing else.
  IF OLD.status IN ('PAID', 'CANCELED') AND NOT reopening
     AND (to_jsonb(NEW) - ARRAY['updated_at', 'archived_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at', 'archived_at']) THEN
    RAISE EXCEPTION 'invoices: a paid or canceled invoice is final'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only the invoice_lines trigger (one level down) moves the subtotal.
  IF (NEW.subtotal_cents <> OLD.subtotal_cents
      OR NEW.taxable_subtotal_cents <> OLD.taxable_subtotal_cents) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'invoices: the subtotal is kept by the database from the lines'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.number <> OLD.number OR NEW.currency <> OLD.currency
          OR NEW.discount_cents <> OLD.discount_cents
          OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
          OR NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id
          OR NEW.discount_type <> OLD.discount_type
          OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent) THEN
    RAISE EXCEPTION 'invoices: an issued invoice keeps its number, client, engagement and amounts'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tax: the rate is copied while the invoice is still being written, then it is the rate on the
  -- taxable lines after the discount's share of them. Nobody sets the tax itself.
  IF OLD.status IN ('DRAFT', 'SCHEDULED') THEN
    IF NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id THEN
      PERFORM invoices_check_new_rate(NEW.business_id, NEW.tax_rate_id);
    END IF;
    NEW.tax_rate_bps := invoices_tax_rate_bps(NEW.business_id, NEW.tax_rate_id);
  END IF;
  IF NEW.subtotal_cents > 0 THEN
    NEW.tax_cents := greatest(0, round(
      (NEW.taxable_subtotal_cents::numeric * (NEW.subtotal_cents - NEW.discount_cents) * NEW.tax_rate_bps)
      / (NEW.subtotal_cents::numeric * 10000)))::integer;
  ELSE
    NEW.tax_cents := 0;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'OPEN' AND NEW.status IN ('PAID', 'CANCELED'))
         OR reopening) THEN
      RAISE EXCEPTION 'invoices: an invoice cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF reopening
       AND (app_invoice_paid_cents(NEW.id) >= NEW.total_cents
            OR NOT EXISTS (SELECT 1 FROM offline_payments o
                           WHERE o.business_id = NEW.business_id AND o.invoice_id = NEW.id
                             AND o.voided_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'invoices: a paid invoice reopens only when a voided offline payment leaves it uncovered'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Money is never left on a canceled invoice: the firm voids its offline payments and refunds
    -- its Stripe payments first (a SUCCEEDED payment, even partly refunded, still holds money; a
    -- REFUNDED one doesn't).
    IF NEW.status = 'CANCELED'
       AND (EXISTS (SELECT 1 FROM offline_payments o
                    WHERE o.business_id = NEW.business_id AND o.invoice_id = NEW.id
                      AND o.voided_at IS NULL)
            OR EXISTS (SELECT 1 FROM payments p
                       WHERE p.business_id = NEW.business_id AND p.invoice_id = NEW.id
                         AND p.status = 'SUCCEEDED')) THEN
      RAISE EXCEPTION 'invoices: it holds money; void its offline payments and refund its Stripe payments before canceling it'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nothing to pay means nothing to issue: an empty or fully discounted invoice is canceled.
    IF NEW.status = 'OPEN' AND NEW.subtotal_cents - NEW.discount_cents <= 0 THEN
      RAISE EXCEPTION 'invoices: an invoice is issued only with an amount to pay'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PAID' THEN
      paid_cents := app_invoice_paid_cents(NEW.id);
      IF paid_cents < NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents THEN
        RAISE EXCEPTION 'invoices: PAID needs Stripe and offline payments covering the total'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
  RETURN NEW;
END
$$;

