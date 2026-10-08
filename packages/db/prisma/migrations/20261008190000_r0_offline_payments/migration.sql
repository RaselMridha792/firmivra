-- Offline payments (Rasel, Oct 8, q28 h): an Owner or Admin records a check or cash payment on an
-- invoice. A separate table, so no Stripe table, rule, CHECK, index or enum changes. A payment is
-- recorded by an active Owner or Admin acting as themselves, on an OPEN invoice, in its currency,
-- never above the balance due. It never changes and is never deleted: a mistake is voided once,
-- with a reason. One formula, app_invoice_paid_cents, counts the money (SUCCEEDED Stripe payments
-- plus live offline payments) for the PAID gate, the cap and the reopen. A void that leaves a PAID
-- invoice uncovered reopens it (PAID -> OPEN); an invoice with live offline money can't be canceled.

-- CreateEnum
CREATE TYPE "OfflinePaymentMethod" AS ENUM ('CHECK', 'CASH');

-- CreateTable
CREATE TABLE "offline_payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "method" "OfflinePaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reference" TEXT,
    "received_on" DATE NOT NULL,
    "note" TEXT,
    "idempotency_key" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offline_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offline_payments_business_id_invoice_id_idx" ON "offline_payments"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "offline_payments_business_id_id_key" ON "offline_payments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "offline_payments_business_id_idempotency_key_key" ON "offline_payments"("business_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_business_id_recorded_by_user_id_fkey" FOREIGN KEY ("business_id", "recorded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_business_id_voided_by_user_id_fkey" FOREIGN KEY ("business_id", "voided_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS: only the firm's own business scope; never deleted ----------
GRANT SELECT, INSERT, UPDATE ON offline_payments TO firmivra_app;
ALTER TABLE offline_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY offline_payments_business ON offline_payments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- The reference is a check number or receipt number, never a bank account (letters, digits and
-- hyphens, at most 20). A void sets all three fields, with a reason (stated as NOT NULL: a CHECK
-- passes on NULL).
ALTER TABLE offline_payments
  ADD CONSTRAINT offline_payments_amount_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT offline_payments_currency CHECK (currency ~ '^[a-z]{3}$'),
  ADD CONSTRAINT offline_payments_reference
    CHECK (reference IS NULL OR reference ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,19}$'),
  ADD CONSTRAINT offline_payments_check_number CHECK (method <> 'CHECK' OR reference IS NOT NULL),
  ADD CONSTRAINT offline_payments_received_on CHECK (received_on >= DATE '2000-01-01'),
  ADD CONSTRAINT offline_payments_note
    CHECK (note IS NULL OR (btrim(note) <> '' AND char_length(note) <= 500)),
  ADD CONSTRAINT offline_payments_void
    CHECK ((voided_at IS NULL AND voided_by_user_id IS NULL AND void_reason IS NULL)
        OR (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND void_reason IS NOT NULL
            AND btrim(void_reason) <> '' AND char_length(void_reason) <= 500));

-- One live record of a check number per invoice (any case). It can be recorded again after a void,
-- or on another invoice. Retries are caught by the unique (business_id, idempotency_key).
CREATE UNIQUE INDEX offline_payments_one_live_check
  ON offline_payments (business_id, invoice_id, upper(reference))
  WHERE method = 'CHECK' AND voided_at IS NULL;

-- ---------- The money that counts toward an invoice ----------
-- SUCCEEDED Stripe payments (a partly refunded one counts in full, a REFUNDED one not: today's
-- PAID gate) plus offline payments that are not voided. The one formula behind the PAID gate, the
-- over-balance cap and the reopen. Runs under the caller's RLS (another firm's invoice counts 0).
CREATE FUNCTION app_invoice_paid_cents(p_invoice_id uuid) RETURNS bigint
  LANGUAGE sql STABLE
  AS $$
  SELECT (SELECT coalesce(sum(p.amount_cents), 0) FROM payments p
           WHERE p.invoice_id = p_invoice_id AND p.status = 'SUCCEEDED')
       + (SELECT coalesce(sum(o.amount_cents), 0) FROM offline_payments o
           WHERE o.invoice_id = p_invoice_id AND o.voided_at IS NULL) $$;
REVOKE ALL ON FUNCTION app_invoice_paid_cents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_invoice_paid_cents(uuid) TO firmivra_app;

-- ---------- The recorder or voider: the acting person, an active Owner or Admin ----------
-- The column must be the session's actor (the API can't name someone else) and the actor must
-- hold an ACTIVE OWNER or ADMIN membership of this firm. FOR SHARE: a demotion or deactivation
-- committing at the same moment waits for this transaction, or this one sees it and fails (a
-- foreign key's FOR KEY SHARE would not block a role change). Refuses Staff, invited and
-- deactivated members, client logins, sessions with no actor and support scope (no actor).
CREATE FUNCTION app_require_firm_manager(p_business_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app_current_actor_id() THEN
    RAISE EXCEPTION 'NOT_FIRM_MANAGER: only the acting Owner or Admin records or voids an offline payment'
      USING ERRCODE = 'FV002';
  END IF;
  PERFORM 1 FROM memberships m
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id
     AND m.role IN ('OWNER', 'ADMIN') AND m.status = 'ACTIVE'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FIRM_MANAGER: only an active Owner or Admin records or voids an offline payment'
      USING ERRCODE = 'FV002';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION app_require_firm_manager(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_require_firm_manager(uuid, uuid) TO firmivra_app;

-- ---------- Offline payments: recorded on an open invoice within the balance; then only voided ----------
-- Before counting, the trigger writes the invoice row (a no-op update, not just a lock: under
-- REPEATABLE READ only a real update makes a concurrent writer fail to serialize). So recordings,
-- voids, PAID and cancel on one invoice take turns, and the cap holds at any isolation level.
-- recorded_at and voided_at come from the database clock.
CREATE FUNCTION offline_payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  inv_status "InvoiceStatus";
  inv_currency text;
  inv_total integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.voided_at IS NOT NULL OR NEW.voided_by_user_id IS NOT NULL
       OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'offline payments: a payment is recorded first, then voided'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM app_require_firm_manager(NEW.business_id, NEW.recorded_by_user_id);
    -- The server's date, with a day of slack for time zones; the API checks the firm's own date.
    IF NEW.received_on > current_date + 1 THEN
      RAISE EXCEPTION 'offline payments: the money cannot be received in the future'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.recorded_at := now();
    UPDATE invoices i SET updated_at = i.updated_at
     WHERE i.business_id = NEW.business_id AND i.id = NEW.invoice_id
     RETURNING i.status, i.currency, i.total_cents INTO inv_status, inv_currency, inv_total;
    IF NOT FOUND OR inv_status <> 'OPEN' OR inv_currency <> NEW.currency THEN
      RAISE EXCEPTION 'offline payments: only an open invoice takes a payment, in its own currency'
        USING ERRCODE = 'check_violation';
    END IF;
    -- A fresh snapshot after the wait above: it counts a payment another transaction just committed.
    IF app_invoice_paid_cents(NEW.invoice_id) + NEW.amount_cents > inv_total THEN
      RAISE EXCEPTION 'OVER_BALANCE: an offline payment cannot be more than the balance due'
        USING ERRCODE = 'FV003';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'offline payments: a voided payment is final'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Every column but the void is frozen, including columns added later.
  IF (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by_user_id', 'void_reason', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by_user_id', 'void_reason', 'updated_at']) THEN
    RAISE EXCEPTION 'offline payments: a recorded payment never changes; void it and record it again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.voided_at IS NULL AND NEW.voided_by_user_id IS NULL AND NEW.void_reason IS NULL THEN
    RETURN NEW;
  END IF;

  -- The void (the CHECK then requires the reason).
  PERFORM app_require_firm_manager(NEW.business_id, NEW.voided_by_user_id);
  NEW.voided_at := now();
  UPDATE invoices i SET updated_at = i.updated_at
   WHERE i.business_id = NEW.business_id AND i.id = NEW.invoice_id
   RETURNING i.status INTO inv_status;
  -- A CANCELED invoice holds no live offline money (cancel waits for the voids).
  IF NOT FOUND OR inv_status NOT IN ('OPEN', 'PAID') THEN
    RAISE EXCEPTION 'offline payments: only a payment on an open or paid invoice is voided'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER offline_payments_rules
  BEFORE INSERT OR UPDATE ON offline_payments
  FOR EACH ROW EXECUTE FUNCTION offline_payments_rules();

-- A void that leaves a PAID invoice uncovered reopens it in the same statement: PAID -> OPEN,
-- paid_at cleared; issued_at, number and lines kept. It updates invoices only, never payments, so
-- the payment triggers' one-level-down gates (REFUNDED, the refund reserve) are never reached.
CREATE FUNCTION offline_payments_reopen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE invoices i SET status = 'OPEN', paid_at = NULL, updated_at = now()
   WHERE i.business_id = NEW.business_id AND i.id = NEW.invoice_id AND i.status = 'PAID'
     AND app_invoice_paid_cents(i.id) < i.total_cents;
  RETURN NULL;
END
$$;

CREATE TRIGGER offline_payments_reopen
  AFTER UPDATE ON offline_payments
  FOR EACH ROW WHEN (OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL)
  EXECUTE FUNCTION offline_payments_reopen();

-- ---------- Invoices: the review version (20261007064925), plus offline money ----------
-- Changes: the PAID gate counts app_invoice_paid_cents; an invoice with live offline payments is
-- not canceled; and PAID -> OPEN ("reopening") is allowed only one trigger level down, changing
-- only status and paid_at, when a voided offline payment leaves the invoice uncovered.
-- The only triggers that write invoices one level down are invoice_lines_total (the subtotal,
-- never on a PAID invoice), offline_payments_rules (a no-op write) and offline_payments_reopen.
-- No other trigger may change an invoice's status: it would pass as a reopen.
CREATE OR REPLACE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
  reopening boolean;
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
  -- Only offline_payments_reopen (one level down) takes a PAID invoice back to OPEN.
  reopening := OLD.status = 'PAID' AND NEW.status = 'OPEN' AND NEW.paid_at IS NULL
    AND pg_trigger_depth() >= 2
    AND (to_jsonb(NEW) - ARRAY['status', 'paid_at', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['status', 'paid_at', 'updated_at']);
  -- Final means every field: amounts, dates, number, reason, author.
  IF OLD.status IN ('PAID', 'CANCELED') AND NOT reopening
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
    -- Money is never left on a canceled invoice: the firm voids it first, with a reason.
    IF NEW.status = 'CANCELED'
       AND EXISTS (SELECT 1 FROM offline_payments o
                   WHERE o.business_id = NEW.business_id AND o.invoice_id = NEW.id
                     AND o.voided_at IS NULL) THEN
      RAISE EXCEPTION 'invoices: void its offline payments before canceling it'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nothing to pay means nothing to issue: an empty or fully discounted invoice is canceled.
    IF NEW.status = 'OPEN' AND NEW.subtotal_cents - NEW.discount_cents <= 0 THEN
      RAISE EXCEPTION 'invoices: an invoice is issued only with an amount to pay'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PAID' THEN
      paid_cents := app_invoice_paid_cents(NEW.id);
      IF paid_cents < NEW.subtotal_cents - NEW.discount_cents THEN
        RAISE EXCEPTION 'invoices: PAID needs succeeded or offline payments covering the total'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
  RETURN NEW;
END
$$;
