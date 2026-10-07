-- Lead's review of #52 (Oct 7): close these in the database, so a single API bug can't do damage.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refund_reserved_cents" INTEGER NOT NULL DEFAULT 0;

-- ==================== Firm applications (Super Admin) ====================
-- 1. Any change to the decision (status, reviewer, review time, message) is recorded as the
--    acting admin, at the database's time, so nobody can name another reviewer or backdate it.
-- 2. A state machine: PENDING_REVIEW or INFO_REQUESTED -> INFO_REQUESTED, APPROVED or DECLINED.
--    APPROVED and DECLINED are final, and so is an application once provisioning linked a firm.
-- 3. Entering INFO_REQUESTED or DECLINED needs a new message, not the previous one.
-- The applicant's resubmission (INFO_REQUESTED -> PENDING_REVIEW) and provisioning run in
-- platform scope and are not affected.
CREATE OR REPLACE FUNCTION firm_applications_admin_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  decision_changed boolean;
BEGIN
  IF app_scope() <> 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.legal_name <> OLD.legal_name
     OR NEW.dba_name IS DISTINCT FROM OLD.dba_name OR NEW.contact_name <> OLD.contact_name
     OR NEW.contact_email <> OLD.contact_email OR NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
     OR NEW.data <> OLD.data OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'firm applications: a review changes only the decision, never the application'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  decision_changed := NEW.status <> OLD.status
    OR NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason;
  IF NOT decision_changed THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('APPROVED', 'DECLINED') OR OLD.business_id IS NOT NULL THEN
    RAISE EXCEPTION 'firm applications: a decided or provisioned application is final'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewed_by_user_id IS DISTINCT FROM app_current_admin_id() THEN
    RAISE EXCEPTION 'firm applications: a decision is recorded as the acting admin'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status
     AND NOT (OLD.status IN ('PENDING_REVIEW', 'INFO_REQUESTED')
              AND NEW.status IN ('INFO_REQUESTED', 'APPROVED', 'DECLINED')) THEN
    RAISE EXCEPTION 'firm applications: an application cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('INFO_REQUESTED', 'DECLINED')
     AND (NEW.status <> OLD.status OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
    IF coalesce(btrim(NEW.decision_reason), '') = '' THEN
      RAISE EXCEPTION 'firm applications: requesting info or declining needs a message (decision_reason)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason THEN
      RAISE EXCEPTION 'firm applications: requesting info or declining needs a new message, not the previous one'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- The database's clock, never a time the API sends.
  NEW.reviewed_at := now();
  RETURN NEW;
END
$$;

-- Owners' user rows (Super Admin): whole rows (name, email, phone, plus cognito_sub and pool; the
-- API returns only contact fields), and only for owners who joined their firm and are ACTIVE.
DROP POLICY users_admin_owners ON users;
CREATE POLICY users_admin_owners ON users FOR SELECT
  USING (app_is_admin()
         AND (id = app_current_admin_id()
              OR EXISTS (SELECT 1 FROM memberships m
                         WHERE m.user_id = users.id AND m.role = 'OWNER' AND m.status = 'ACTIVE'
                           AND m.joined_at IS NOT NULL)));

-- ==================== Businesses ====================
-- A portal address: lower-case letters and digits, with single inner hyphens (portal.firmivra.com/{slug}).
ALTER TABLE businesses ADD CONSTRAINT businesses_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 63);

-- The combined rule from r0_business_rules_combined, plus status transitions for the Super
-- Admin: CLOSED is final; back to PENDING_SETUP only from SUSPENDED (a firm suspended before it
-- finished setup); otherwise between ACTIVE, SUSPENDED and CLOSED.
CREATE OR REPLACE FUNCTION businesses_protected_columns() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() = 'platform' THEN
    RETURN NEW;
  END IF;
  IF app_scope() = 'admin' THEN
    IF NEW.id <> OLD.id OR NEW.name <> OLD.name OR NEW.legal_name IS DISTINCT FROM OLD.legal_name
       OR NEW.terms_url IS DISTINCT FROM OLD.terms_url OR NEW.privacy_url IS DISTINCT FROM OLD.privacy_url
       OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
       OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack <> OLD.pack
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'businesses: Super Admin changes only status and slug'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> OLD.status
       AND (OLD.status = 'CLOSED'
            OR (NEW.status = 'PENDING_SETUP' AND OLD.status <> 'SUSPENDED')) THEN
      RAISE EXCEPTION 'businesses: a firm cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.legal_name IS DISTINCT FROM OLD.legal_name THEN
    RAISE EXCEPTION 'businesses: slug and legal name change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
     OR NEW.business_type IS DISTINCT FROM OLD.business_type OR NEW.pack IS DISTINCT FROM OLD.pack THEN
    RAISE EXCEPTION 'businesses: the KMS key, business type and pack change only in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (app_scope() = 'business' AND OLD.status = 'PENDING_SETUP' AND NEW.status = 'ACTIVE'
              AND EXISTS (SELECT 1 FROM business_settings s
                          WHERE s.business_id = NEW.id AND s.setup_completed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'businesses: status changes only in platform scope, except Finish (Pending Setup to Active once setup is done)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

-- ==================== Refunds ====================
-- 6. One Stripe event confirms one refund (Stripe sends one charge.refunded per refund).
CREATE UNIQUE INDEX payment_refunds_one_per_event ON payment_refunds (event_id)
  WHERE event_id IS NOT NULL;

-- Nits: an event and a refund time only on SUCCEEDED; Stripe refund ids (re_, or pyr_ for some
-- payment methods).
ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_confirmed;
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_confirmed
  CHECK ((status = 'SUCCEEDED') = (event_id IS NOT NULL)
         AND (status = 'SUCCEEDED') = (refunded_at IS NOT NULL));
ALTER TABLE payment_refunds DROP CONSTRAINT payment_refunds_refund_id_format;
ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_refund_id_format
  CHECK (processor_refund_id ~ '^(re|pyr)_[A-Za-z0-9]+$' AND char_length(processor_refund_id) <= 255);

-- 8. Refunds never exceed the payment, under any isolation level: the payment row keeps the
--    cents of its refunds that are not FAILED (CHECK below). Two refunds at once both update that
--    row, so the second waits and sees the first (READ COMMITTED) or fails to serialize (REPEATABLE
--    READ). The refund rows stay the record; this is only the guard.
UPDATE payments p SET refund_reserved_cents = coalesce(
  (SELECT sum(r.amount_cents) FROM payment_refunds r
    WHERE r.payment_id = p.id AND r.status <> 'FAILED'), 0);
ALTER TABLE payments ADD CONSTRAINT payments_refund_reserved
  CHECK (refund_reserved_cents BETWEEN 0 AND amount_cents);

-- 7. A refund becoming SUCCEEDED locks its payment, so two confirmations at once settle in turn
--    and the second sees the first (the payment then becomes REFUNDED). Refund times are never
--    in the future (one minute of slack for the clocks).
CREATE OR REPLACE FUNCTION payment_refunds_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  pay record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'FAILED' THEN
      RAISE EXCEPTION 'refunds: a refund starts PENDING, or SUCCEEDED when its event confirms it'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT p.status, p.amount_cents, p.account_id, p.currency, p.refund_reserved_cents INTO pay
      FROM payments p WHERE p.id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR pay.status NOT IN ('SUCCEEDED', 'REFUNDED') THEN
      RAISE EXCEPTION 'refunds: only a succeeded payment can be refunded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.account_id <> pay.account_id OR NEW.currency <> pay.currency THEN
      RAISE EXCEPTION 'refunds: a refund is in the payment''s own account and currency'
        USING ERRCODE = 'check_violation';
    END IF;
    IF pay.refund_reserved_cents + NEW.amount_cents > pay.amount_cents THEN
      RAISE EXCEPTION 'refunds: a payment''s refunds cannot add up to more than the payment'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE payments SET refund_reserved_cents = refund_reserved_cents + NEW.amount_cents
     WHERE id = NEW.payment_id;
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
    IF NEW.status <> OLD.status THEN
      PERFORM 1 FROM payments p WHERE p.id = NEW.payment_id FOR UPDATE;
      IF NEW.status = 'FAILED' THEN
        UPDATE payments SET refund_reserved_cents = refund_reserved_cents - NEW.amount_cents
         WHERE id = NEW.payment_id;
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'SUCCEEDED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SUCCEEDED') THEN
    IF NOT EXISTS (SELECT 1 FROM payment_events e
                   WHERE e.id = NEW.event_id AND e.payment_id = NEW.payment_id
                     AND e.account_id = NEW.account_id AND e.type = 'charge.refunded') THEN
      RAISE EXCEPTION 'refunds: SUCCEEDED needs the charge.refunded event of this payment, from its account'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.refunded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'refunds: refunded_at cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Payments: as r0_refunds, plus refund_reserved_cents, kept only by the refund triggers.
CREATE OR REPLACE FUNCTION payments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.paid_at IS NOT NULL OR NEW.refunded_at IS NOT NULL
       OR NEW.failure_code IS NOT NULL OR NEW.refund_reserved_cents <> 0 THEN
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
  IF NEW.refund_reserved_cents <> OLD.refund_reserved_cents AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'payments: refund_reserved_cents is kept by the database from the refunds'
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
