# T04 tax status configuration

Locked writes recheck the active Business and current manager membership. Suspending a firm
after request authentication prevents create/rename/order/archive, with no partial changes.

Five routes use the existing TaxStatus table and shared Zod contracts. OWNER/ADMIN manage
definitions; STAFF can read the ordered list. Names are trimmed and unique case-insensitively
within the firm. All mutations lock the Business row and recheck current management permission.

Reorder requires exactly every active own-firm id, once each. Foreign ids return 404;
incomplete/stale/archived permutations return 409; the entire order changes in one transaction.
Definitions archive instead of being deleted. Rename/archive never rewrites client assignments
or the database-maintained append-only ClientTaxStatusHistory. No payment state is involved.

Tests exercise every endpoint/role/firm boundary, safe input, real client-history references,
archived filtering, case conflicts and ordering invariants. No schema migration is required.
