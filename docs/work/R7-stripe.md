# R7: Stripe payments (Oct 13-14)

**Goal:** Clients pay invoices by card and the invoice turns paid by itself.

**Owned paths (change only these):**
- `apps/api/src/payments/**`
- `packages/types/src/payments/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- Invoice and payment tables from R0
- Ibrahim's invoices API (I10) for invoice records

## Steps

- [ ] 1. Stripe test mode keys in .env and AWS Secrets Manager only (never committed)
- [ ] 2. Default until Octavia decides: Firmivra's Stripe account with per-firm metadata; keep a seam for Stripe Connect
- [ ] 3. Checkout session for an invoice (amount from our DB, never from the browser)
- [ ] 4. Webhook endpoint with signature check; idempotent; marks payment and invoice paid; notifies firm and client
- [ ] 5. Refund and failed payment states
- [ ] 6. e2e test with Stripe test cards and the Stripe CLI webhook forwarder
- [ ] 7. Plus I10 (Oct 6): invoice records, lines, totals, send, statuses Pending, Due Soon, Paid, Upcoming, Canceled. Contract by Oct 12 (Fahad F10, Nahid N09)

## Done when

Nahid's Invoices tab pays an invoice in test mode on dev and the firm sees it paid.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
