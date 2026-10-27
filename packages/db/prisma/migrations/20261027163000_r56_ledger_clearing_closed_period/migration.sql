-- r56_ledger_clearing_closed_period (R56, Oct 27; Rasel's tap of Oct 27, 16:14Z, "Allow clearing a
-- ledger line dated in a closed period?"): an outstanding line from a closed month, such as a
-- cheque that clears later, may be cleared (or uncleared) by a later month's reconciliation. On a
-- line dated in a closed period only cleared_reconciliation_id and cleared_at change, with
-- updated_at, which the app stamps on every update; its amount, date, account, category and every
-- other column stay locked. A closed period's reconciliation is locked with it
-- (r38_bookkeeping_close), so no line joins or leaves one. The function is replaced in place: its
-- trigger, the table's row-level security and the grants are unchanged.

CREATE OR REPLACE FUNCTION bookkeeping_transactions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  other bookkeeping_transactions;
  recon_account uuid;
  clearing_only boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
         WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: a transaction belongs to an engagement with a bookkeeping profile'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.engagement_id, NEW.account_id, NEW.connection_id, NEW.source_transaction_id, NEW.source)
       IS DISTINCT FROM (OLD.engagement_id, OLD.account_id, OLD.connection_id, OLD.source_transaction_id, OLD.source) THEN
      RAISE EXCEPTION 'bookkeeping: a transaction keeps its client, account and source'
        USING ERRCODE = 'check_violation';
    END IF;
    IF bookkeeping_ledger_locked(OLD.business_id, OLD.engagement_id, OLD.transaction_date) THEN
      -- A locked line may only be cleared or uncleared.
      IF to_jsonb(NEW) - ARRAY['cleared_reconciliation_id', 'cleared_at', 'updated_at']
         IS DISTINCT FROM to_jsonb(OLD) - ARRAY['cleared_reconciliation_id', 'cleared_at', 'updated_at'] THEN
        RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
      END IF;
      clearing_only := true;
    END IF;
  END IF;
  IF NOT clearing_only
     AND bookkeeping_ledger_locked(NEW.business_id, NEW.engagement_id, NEW.transaction_date) THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.transfer_pair_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.transfer_pair_id IS DISTINCT FROM OLD.transfer_pair_id
          OR (NEW.amount_cents, NEW.direction) IS DISTINCT FROM (OLD.amount_cents, OLD.direction)) THEN
    SELECT * INTO other FROM bookkeeping_transactions t
    WHERE t.business_id = NEW.business_id AND t.id = NEW.transfer_pair_id;
    IF other.kind <> 'TRANSFER' OR other.amount_cents <> NEW.amount_cents
       OR other.direction = NEW.direction OR other.account_id = NEW.account_id THEN
      RAISE EXCEPTION 'bookkeeping: a transfer''s other side is the same amount the other way on another account'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.cleared_reconciliation_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.cleared_reconciliation_id END) THEN
    -- A closed period's reconciliation keeps its lines: none joins or leaves it.
    IF EXISTS (SELECT 1 FROM bookkeeping_reconciliations r
               JOIN bookkeeping_periods p ON p.business_id = r.business_id AND p.id = r.period_id
               WHERE r.business_id = NEW.business_id AND p.status = 'CLOSED'
                 AND r.id IN (NEW.cleared_reconciliation_id,
                              CASE WHEN TG_OP = 'UPDATE' THEN OLD.cleared_reconciliation_id END)) THEN
      RAISE EXCEPTION 'bookkeeping: the period is closed and locked' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cleared_reconciliation_id IS NOT NULL THEN
      SELECT account_id INTO recon_account FROM bookkeeping_reconciliations r
      WHERE r.business_id = NEW.business_id AND r.id = NEW.cleared_reconciliation_id;
      IF recon_account IS DISTINCT FROM NEW.account_id THEN
        RAISE EXCEPTION 'bookkeeping: a transaction is cleared in its own account''s reconciliation'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.cleared_at := now();
    ELSE
      NEW.cleared_at := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.cleared_at := OLD.cleared_at;
  END IF;
  RETURN NEW;
END
$$;
