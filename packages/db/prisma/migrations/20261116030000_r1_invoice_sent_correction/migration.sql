-- R1, Invoices Review 2 I-N06 (approved by the lead, firmivra-lead-a1, Nov 16, under Rasel's
-- packages/db delegation until Nov 17): a sent invoice with no money on it can be corrected on
-- the same number: its lines, discount, tax rate and engagement. One helper decides it for both
-- triggers: the invoice is OPEN (shown Sent or Overdue) with no Stripe payment that did not fail
-- (pending, succeeded, refunded: a refund needs a payment) and no offline payment left unvoided.
-- Firm invoices have no credits or retainers yet; when they come, this helper is the one place
-- to add them. The number, currency, client and business never change once issued; PAID and
-- CANCELED stay final; DRAFT and SCHEDULED behave as before. No row changes; safe on dev.

-- ---------- The shared check ----------
CREATE FUNCTION app_invoice_correctable(p_invoice_id uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
  SELECT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p_invoice_id AND i.status = 'OPEN')
     AND NOT EXISTS (SELECT 1 FROM payments p
                      WHERE p.invoice_id = p_invoice_id AND p.status <> 'FAILED')
     AND NOT EXISTS (SELECT 1 FROM offline_payments o
                      WHERE o.invoice_id = p_invoice_id AND o.voided_at IS NULL) $$;
REVOKE ALL ON FUNCTION app_invoice_correctable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invoice_correctable(uuid) TO firmivra_app;

-- ---------- Invoices: as r1_invoice_archive_final, plus the correction ----------
CREATE OR REPLACE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
  reopening boolean;
  correcting boolean;
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
  -- I-N06: a sent invoice (OPEN: Sent or Overdue) with no money on it is being corrected.
  correcting := OLD.status = 'OPEN' AND NEW.status = 'OPEN' AND app_invoice_correctable(OLD.id);
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
  -- The number and currency never change once issued; the amounts and the engagement only while
  -- a sent invoice with no money on it is corrected (I-N06).
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.number <> OLD.number OR NEW.currency <> OLD.currency
          OR (NOT correcting
              AND (NEW.discount_cents <> OLD.discount_cents
                   OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
                   OR NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id
                   OR NEW.discount_type <> OLD.discount_type
                   OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent))) THEN
    RAISE EXCEPTION 'invoices: an issued invoice keeps its number, client, engagement and amounts'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tax: the rate is copied while the invoice is still being written (or corrected, I-N06), then
  -- it is the rate on the taxable lines after the discount's share of them. Nobody sets the tax.
  IF OLD.status IN ('DRAFT', 'SCHEDULED') OR correcting THEN
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


-- ---------- Invoice lines: a draft's or scheduled invoice's, or a sent one being corrected ----------
CREATE OR REPLACE FUNCTION invoice_lines_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.invoice_id <> OLD.invoice_id OR NEW.business_id <> OLD.business_id) THEN
    RAISE EXCEPTION 'invoice lines: a line stays on its invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices i
                 WHERE i.id = target AND i.status IN ('DRAFT', 'SCHEDULED'))
     AND NOT app_invoice_correctable(target) THEN
    RAISE EXCEPTION 'invoice lines: lines change only while the invoice is a draft or scheduled, or sent with nothing paid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.amount_cents := round(NEW.quantity * NEW.unit_amount_cents);
  RETURN NEW;
END
$$;
