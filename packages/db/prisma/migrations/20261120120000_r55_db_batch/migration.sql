-- R55 db batch (Rasel's yes, Nov 20): seven additive changes, all safe on existing rows.
--   1. M20: outbound_messages.timezone (nullable; null is the firm's own zone).
--   2. M22: a PORTAL message may have an empty body (files only). No row is updated.
--   3. Tips: a payment's refunds may add up to the payment plus its tip.
--   4. IP-041: stripe_accounts.ach_payments_active.
--   5. IP-041: payment_settings.accept_ach defaults to false, and existing rows are reset once.
--      ACH was never offered, so the reset changes no behaviour.
--   6. IP-041: a refund is confirmed by a charge.refunded or a refund.updated event.
--   7. Leads R2 9: LeadContactKind gains ADDRESS, WEBSITE and OTHER.
--   8. Intake 1: a submit needs no signature when the firm's Require Signature switch is off
--      (Rasel's yes, Nov 20); with it on, nothing changes.

-- 1. M20 ---------------------------------------------------------------------------------------
ALTER TABLE "outbound_messages" ADD COLUMN "timezone" TEXT;
ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_timezone
    CHECK (timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 64);

-- 2. M22 ---------------------------------------------------------------------------------------
-- Text on every channel but PORTAL (a portal message may go with files alone; the API still needs
-- a text or a file to send or schedule).
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_text;
ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_text
    CHECK ((btrim(body) <> '' OR channel = 'PORTAL') AND char_length(body) <= 10000
           AND char_length(subject) <= 200
           AND (channel <> 'SMS' OR char_length(body) <= 1600));

-- 3. and 6. Refunds ----------------------------------------------------------------------------
-- The reserved cents may reach the payment plus its tip (the tip is refundable with the payment).
ALTER TABLE payments DROP CONSTRAINT payments_refund_reserved;
ALTER TABLE payments ADD CONSTRAINT payments_refund_reserved
  CHECK (refund_reserved_cents BETWEEN 0 AND amount_cents + tip_cents);

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
    SELECT p.status, p.amount_cents, p.tip_cents, p.account_id, p.currency, p.refund_reserved_cents INTO pay
      FROM payments p WHERE p.id = NEW.payment_id FOR UPDATE;
    IF NOT FOUND OR pay.status NOT IN ('SUCCEEDED', 'REFUNDED') THEN
      RAISE EXCEPTION 'refunds: only a succeeded payment can be refunded'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.account_id <> pay.account_id OR NEW.currency <> pay.currency THEN
      RAISE EXCEPTION 'refunds: a refund is in the payment''s own account and currency'
        USING ERRCODE = 'check_violation';
    END IF;
    IF pay.refund_reserved_cents + NEW.amount_cents > pay.amount_cents + pay.tip_cents THEN
      RAISE EXCEPTION 'refunds: a payment''s refunds cannot add up to more than the payment and its tip'
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
      -- A write, not only a lock: under REPEATABLE READ a second confirmation at the same time
      -- then fails to serialize (the webhook retries) instead of settling on its old snapshot.
      UPDATE payments SET updated_at = updated_at WHERE id = NEW.payment_id;
      IF NEW.status = 'FAILED' THEN
        UPDATE payments SET refund_reserved_cents = refund_reserved_cents - NEW.amount_cents
         WHERE id = NEW.payment_id;
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'SUCCEEDED' AND (TG_OP = 'INSERT' OR OLD.status <> 'SUCCEEDED') THEN
    -- charge.refunded (a card) or refund.updated (a bank debit's refund, final days later).
    IF NOT EXISTS (SELECT 1 FROM payment_events e
                   WHERE e.id = NEW.event_id AND e.payment_id = NEW.payment_id
                     AND e.account_id = NEW.account_id
                     AND e.type IN ('charge.refunded', 'refund.updated')) THEN
      RAISE EXCEPTION 'refunds: SUCCEEDED needs the charge.refunded or refund.updated event of this payment, from its account'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.refunded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'refunds: refunded_at cannot be in the future' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- A payment is REFUNDED once confirmed refunds cover it and its tip (a payment with no tip: as
-- before).
CREATE OR REPLACE FUNCTION payment_refunds_settle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = 'SUCCEEDED' THEN
    UPDATE payments p SET status = 'REFUNDED', refunded_at = NEW.refunded_at
     WHERE p.id = NEW.payment_id AND p.status = 'SUCCEEDED'
       AND (SELECT sum(r.amount_cents) FROM payment_refunds r
             WHERE r.payment_id = NEW.payment_id AND r.status = 'SUCCEEDED')
           >= p.amount_cents + p.tip_cents;
  END IF;
  RETURN NULL;
END
$$;

-- 4. IP-041 ------------------------------------------------------------------------------------
ALTER TABLE "stripe_accounts" ADD COLUMN "ach_payments_active" BOOLEAN NOT NULL DEFAULT false;

-- 5. IP-041 ------------------------------------------------------------------------------------
ALTER TABLE "payment_settings" ALTER COLUMN "accept_ach" SET DEFAULT false;
-- Existing rows were made with the old default (true) and nobody chose it: ACH was never offered
-- (the API forced it off), so this changes no behaviour. Each firm in its own scope (forced RLS,
-- as in r0_review_fixes).
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE payment_settings SET accept_ach = false WHERE business_id = firm AND accept_ach;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- 7. Leads R2 9 --------------------------------------------------------------------------------
ALTER TYPE "LeadContactKind" ADD VALUE 'ADDRESS';
ALTER TYPE "LeadContactKind" ADD VALUE 'WEBSITE';
ALTER TYPE "LeadContactKind" ADD VALUE 'OTHER';

-- The shape check names the new kinds as text: a new enum value cannot be used in the transaction
-- that adds it. An address or other detail is up to 300 characters, a website up to 2048.
ALTER TABLE lead_contact_points DROP CONSTRAINT lead_contact_points_shape;
ALTER TABLE lead_contact_points ADD CONSTRAINT lead_contact_points_shape
  CHECK (((kind = 'EMAIL' AND value = lower(value) AND char_length(value) <= 254
           AND value ~ '^[^@[:space:]]+@[^@[:space:]]+$')
          OR (kind = 'PHONE' AND char_length(btrim(value)) BETWEEN 1 AND 40)
          OR (kind::text IN ('ADDRESS', 'OTHER') AND char_length(btrim(value)) BETWEEN 1 AND 300)
          OR (kind::text = 'WEBSITE' AND char_length(btrim(value)) BETWEEN 1 AND 2048))
     AND (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 40)
     AND position >= 0);

-- 8. Intake 1 ----------------------------------------------------------------------------------
-- As r0_intake_agreements, except the signature check (see the note inside).
CREATE OR REPLACE FUNCTION intake_submissions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  last_version int;
  open_drafts int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'intake submissions: a new version starts as a draft; sign it, then submit'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT coalesce(max(s.version), 0), count(*) FILTER (WHERE s.submitted_at IS NULL)
      INTO last_version, open_drafts
      FROM intake_submissions s WHERE s.intake_id = NEW.intake_id;
    IF open_drafts > 0 THEN
      RAISE EXCEPTION 'intake submissions: an intake has one draft at a time'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.version <> last_version + 1 THEN
      RAISE EXCEPTION 'intake submissions: the next version must be %', last_version + 1
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'intake submissions: a submitted version is locked; start the next version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.intake_id <> OLD.intake_id
     OR NEW.version <> OLD.version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'intake submissions: the intake and version cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.answers IS DISTINCT FROM OLD.answers
     AND EXISTS (SELECT 1 FROM intake_signatures g WHERE g.submission_id = OLD.id) THEN
    RAISE EXCEPTION 'intake submissions: signed answers cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.submitted_at IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.submitted_at := now();
  -- R55 (Intake 1): with the firm's Require Signature switch off and no signature given, the
  -- submit needs none. A firm with the switch on (or no settings row: on) still needs it, and a
  -- signature that is given is always checked as before.
  IF (coalesce((SELECT s.require_signature FROM intake_settings s
                WHERE s.business_id = NEW.business_id), true)
      OR EXISTS (SELECT 1 FROM intake_signatures g0 WHERE g0.submission_id = NEW.id))
     AND NOT EXISTS (
       SELECT 1 FROM intake_signatures g
       WHERE g.submission_id = NEW.id
         -- Signed in this transaction (signed_at is now(), stored to the millisecond).
         AND g.signed_at = now()::timestamptz(3)
         AND g.printed_name = NEW.signer_name
         AND g.signed_at = NEW.signed_at
         AND g.ip IS NOT DISTINCT FROM NEW.signer_ip
         AND g.user_agent IS NOT DISTINCT FROM NEW.signer_user_agent
         AND EXISTS (
           SELECT 1 FROM intake_signature_agreements ga
           JOIN firm_agreement_versions v ON v.id = ga.agreement_version_id
           JOIN firm_agreements a ON a.id = v.agreement_id
           WHERE ga.signature_id = g.id AND a.scope = 'ALL_INTAKES')
         -- Every published, unarchived agreement of the form's service is signed too.
         AND NOT EXISTS (
           SELECT 1 FROM intakes i
           JOIN intake_forms f ON f.id = i.form_id
           JOIN firm_agreements a ON a.service_id = f.service_id
           WHERE i.id = NEW.intake_id AND a.scope = 'SERVICE' AND a.archived_at IS NULL
             AND EXISTS (SELECT 1 FROM firm_agreement_versions v WHERE v.agreement_id = a.id)
             AND NOT EXISTS (
               SELECT 1 FROM intake_signature_agreements ga
               JOIN firm_agreement_versions v ON v.id = ga.agreement_version_id
               WHERE ga.signature_id = g.id AND v.agreement_id = a.id))) THEN
    RAISE EXCEPTION 'intake submissions: submitting needs the signature from this transaction (with the firm-wide and the service''s agreements) matching signer_name, signed_at, IP and browser'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
