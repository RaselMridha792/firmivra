-- r1_reconciliation_zero_tolerance (R1, Oct 26; Rasel's Bookkeeping tap of Oct 26, gap 3): Octavia
-- approved zero reconciliation tolerance. A reconciliation is approved only when its difference
-- (ending minus cleared, already checked) is exactly zero, whatever tolerance_cents says. NOT VALID:
-- reconciliations approved before keep their history; every new approval, and any later change to
-- an approved one, is checked. tolerance_cents and the firm's recon_tolerance_cents stay as columns
-- and no longer decide anything (the API writes 0).

ALTER TABLE bookkeeping_reconciliations ADD CONSTRAINT bookkeeping_reconciliations_zero_difference
  CHECK (status <> 'APPROVED' OR difference_cents = 0) NOT VALID;
