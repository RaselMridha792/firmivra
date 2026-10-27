-- r1_bookkeeping_close_lock (R1, Oct 26; Rasel's Bookkeeping tap of Oct 26, gap 1): a closed period
-- now also locks the refunds and chargebacks dated inside it, the settlements paid out inside it
-- and those settlements' items, as r0_bookkeeping_ledger already locks transactions and splits
-- (reopen the period first). A settlement belongs to the period of its payout date (the deposit
-- day), not its batch dates. One exception: a chargeback's dispute outcome (dispute_status and
-- resolution) arrives after the fact and may still be recorded. Triggers only; no column changes.

-- Refunds and chargebacks: locked by their own date.
CREATE FUNCTION bookkeeping_refunds_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND bookkeeping_ledger_locked(OLD.business_id, OLD.engagement_id, OLD.refund_date) THEN
    IF to_jsonb(NEW) - ARRAY['dispute_status', 'resolution', 'updated_at']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['dispute_status', 'resolution', 'updated_at'] THEN
      RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF bookkeeping_ledger_locked(NEW.business_id, NEW.engagement_id, NEW.refund_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_refunds_lock BEFORE INSERT OR UPDATE ON bookkeeping_refunds
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_refunds_lock();

-- Settlements: locked by their payout date (runs before bookkeeping_settlements_rules).
CREATE FUNCTION bookkeeping_settlements_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND bookkeeping_ledger_locked(OLD.business_id, OLD.engagement_id, OLD.payout_date))
     OR bookkeeping_ledger_locked(NEW.business_id, NEW.engagement_id, NEW.payout_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_settlements_lock BEFORE INSERT OR UPDATE ON bookkeeping_settlements
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_settlements_lock();

-- A settlement's items are added or removed only while the settlement is unlocked.
CREATE FUNCTION bookkeeping_settlement_items_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r bookkeeping_settlement_items;
  s bookkeeping_settlements;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT * INTO s FROM bookkeeping_settlements x WHERE x.business_id = r.business_id AND x.id = r.settlement_id;
  IF FOUND AND bookkeeping_ledger_locked(s.business_id, s.engagement_id, s.payout_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER bookkeeping_settlement_items_lock BEFORE INSERT OR UPDATE OR DELETE ON bookkeeping_settlement_items
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_settlement_items_lock();
