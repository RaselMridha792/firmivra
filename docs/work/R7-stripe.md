# R7: Stripe payments (Oct 13-14)

**Goal:** Clients pay invoices by card and the invoice turns paid by itself.

**Owner:** cloud thread R16 owns R7 from Oct 9 (docs/work/README.md; brief R16).

**Owned paths (change only these):**
- `apps/api/src/payments/**`
- `packages/types/src/payments/**`, `packages/types/test/payments/**`
- `apps/web/src/mocks/invoices.ts`, and the invoices lines in `apps/web/src/lib/api.ts`
- `apps/web/src/mocks/payments-setup.ts`, the `paymentsSetup` lines in `apps/web/src/lib/api.ts`, `apps/web/src/app/firm/(workspace)/settings/payments/**` and the Payments line in `settings/layout.tsx` (R16 brief)
- `docs/api/invoices.yaml`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- Invoice and payment tables from R0
- Arfan's invoices API (I10) for invoice records

## Steps

- [ ] 1. Stripe test mode keys in .env and AWS Secrets Manager only (never committed)
- [ ] 2. Default until Octavia decides: Firmivra's Stripe account with per-firm metadata; keep a seam for Stripe Connect
- [ ] 3. Checkout session for an invoice (amount from our DB, never from the browser)
- [ ] 4. Webhook endpoint with signature check; idempotent; marks payment and invoice paid; notifies firm and client
- [ ] 5. Refund and failed payment states
- [ ] 6. e2e test with Stripe test cards and the Stripe CLI webhook forwarder
- [ ] 7. Plus I10 (Oct 6): invoice records, lines, totals, send, statuses Pending, Due Soon, Paid, Upcoming, Canceled. Contract by Oct 12 (Fahad F10, Nahid N09)
  - [x] Contract: `api.invoices` and `api.myInvoices(slug)`, mock, `docs/api/invoices.yaml` (Oct 8)
  - [ ] API: the firm and portal routes in the yaml, with its "Rules for the API", e2e and tenant-isolation tests
  - [ ] The daily job that opens SCHEDULED invoices on their day

## Done when

Nahid's Invoices tab pays an invoice in test mode on dev and the firm sees it paid.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Decisions (Oct 8, invoices contract)

- Module `payments` in `packages/types` (the owned path), mock `apps/web/src/mocks/invoices.ts`, `docs/api/invoices.yaml`. Firm routes `/business/invoices...`, portal routes `/portal/{firmSlug}/me/invoices...`, Stripe's `/webhooks/stripe`.
- Stripe Connect as the schema has it (R0, decided by Octavia on Oct 5): every checkout and refund runs on the firm's own connected account; payments need `charges_enabled`. Step 2's "Firmivra's account with per-firm metadata" is replaced by that.
- Money in integer cents with a lower-case ISO currency. The database computes line amounts, subtotal and total; requests never carry them. Limits: 50 lines, $999,999.99 per invoice, quantities above 0 up to 10,000 with 2 decimals.
- Lifecycle: create a DRAFT, `PUT` replaces the whole draft (lines included), `send` makes it OPEN or SCHEDULED (a later `scheduledFor`), `cancel` with a reason the client never sees. Only drafts are edited; a SCHEDULED invoice is canceled and made again (see Open).
- Client statuses come from `myInvoiceStatus()` in `packages/types`, shared by the API and the mock: SCHEDULED is Upcoming; OPEN is Due Soon within 7 days of its due date or past it, else Pending; Paid; Canceled. Drafts and drafts canceled before they were sent never reach the portal; a canceled invoice the client saw (issued, or Upcoming when canceled) stays in their history as Canceled (the API clears `scheduled_for` when it opens an invoice or cancels a draft, and keeps it when it cancels a SCHEDULED one). "Today" is the firm's calendar date.
- Pay Now: `POST .../checkout` with an empty body (any field is 400); the API derives the amount from the database and answers a Stripe Checkout link (`https://`, or `mock:` in mock mode). One open checkout per invoice. PAID only from a verified webhook; a bank debit shows as processing until Stripe settles it.
- Roles: Owner and Admin create, edit, send, cancel and refund; Staff read the invoices of their assigned clients (others 404) and get 403 on every change. Every portal login of the client (primary and household) sees and pays the client's invoices.
- Refunds from Firmivra: `POST .../payments/{paymentId}/refunds` with `amountCents` and an `idempotencyKey` (passed to Stripe), PENDING until Stripe's `charge.refunded` confirms it (one event confirms one refund: the API lists the charge's refunds at Stripe and confirms the oldest not yet confirmed); refunds made in the firm's Stripe dashboard are recorded the same way. A retry with the same key answers the invoice as it is: Stripe keeps the key (the refund's metadata and Stripe's idempotency key), so no schema change. The portal has no refund controls.
- Webhooks (review, Oct 8): `payment_intent.payment_failed` changes nothing (a declined card leaves the Checkout Session open for another card); a payment is FAILED only on `checkout.session.async_payment_failed` or `checkout.session.expired`. Checkout Sessions last 60 minutes (Stripe takes 30 minutes to 24 hours), and `expiresAt` is Stripe's.
- Offline payments (check, cash, bank transfer): not in the contract; no call marks an invoice paid by hand (see Open).
- Error codes: NOT_DRAFT, ZERO_TOTAL, DUE_DATE_PASSED, INVOICE_CLOSED, CLIENT_ARCHIVED, NOT_PAYABLE, PAYMENT_IN_PROGRESS, PAYMENTS_NOT_SET_UP, NOT_REFUNDABLE, REFUND_TOO_LARGE (409) and PAYMENT_PROVIDER_UNAVAILABLE (503), with the words users see in `INVOICE_ERRORS`.
- Audit: every change, checkout started, refund and webhook-driven status change (ids and amounts only); reads are not audited.

## Decisions (Oct 9, Stripe Connect setup, R16)

- Settings > Payments contract in `packages/types/src/payments/setup.ts` (`api.paymentsSetup`: `get`, `start`, `refresh`): routes `/business/payments/setup`, `POST .../onboarding` (creates the account the first time) and `POST .../onboarding/refresh` (a new link only, after Stripe's `?stripe=refresh`; `409 PAYMENTS_NOT_SET_UP` when nothing was started). Owner and Admin read, the Owner alone connects, Staff 403 on every route (the page is hidden from them); an ACTIVE firm only.
- One new 409 code, `PAYMENTS_ALREADY_SET_UP`, when the account is COMPLETE (the firm manages it in its own Stripe dashboard); the other errors reuse `PAYMENTS_NOT_SET_UP` and `PAYMENT_PROVIDER_UNAVAILABLE`.
- `requirementsDue` and the page's stage come from the stored columns (no requirements column): not finished, or RESTRICTED, means the Owner has something to do; PENDING with details submitted is "In review at Stripe".
- The onboarding link is Stripe's hosted onboarding only (https, host exactly `connect.stripe.com`), or `mock:stripe-onboarding/...` in mock mode.

## Open (Rasel)

- Download on Past Invoices (Octavia's spec: "Download the permitted invoice/receipt PDF", logged): not in the contract. A server-made PDF (a route and a PDF library), Stripe's receipt (needs a `receipt_url` column from R0), or the browser's print of the View page for beta?
- Who may refund: Owner and Admin in the contract. Owner only?
- Staff and invoices: the role table says "Change status, create invoices: Staff if allowed". There is no per-staff permission yet, so Staff only read their clients' invoices. Fine for beta?
- Editing a SCHEDULED invoice: the database allows line changes and SCHEDULED back to DRAFT, but the contract edits drafts only (cancel and make it again). Add an "unschedule" (back to DRAFT) call?
- Invoice numbers `INV-{year}-{4 digits}` per firm, counting on from the highest. Does LVP want its own prefix or to continue its current numbering?
- Due Soon window: 7 days, and past-due invoices also show Due Soon (the spec has no Overdue label; `overdue` is there for styling). Right?
- Stripe Connect onboarding (the firm's Owner connects Stripe): no page in PAGE-MAP and no route in this contract. Where does it go (Settings > Payments?), and is it in beta? Until a firm is connected, `paymentsEnabled` is false and Pay Now is hidden.
- Offline payments: the spec (Invoices tab, section 6) lets an invoice turn Paid when "an authorized canonical payment record is created", but the schema allows only STRIPE payments made SUCCEEDED by a recorded Stripe event, so a client who pays LVP by check leaves the invoice open (Due Soon, Pay Now) or the firm cancels it (Canceled, not Paid). Is recording offline payments in beta? If yes: a schema request to R0 (a MANUAL processor with SUCCEEDED by a member, or a paid-offline flag on the invoice) and a firm route (Owner and Admin, audited, with the method and a note). If no: the yaml already tells F10 not to build it.
- Recurring services (Bookkeeping monthly): invoices are made by hand in this contract. Should the API make the next invoice from `engagements.next_billing_on`?

## Needs from others

- R6 (after its step 7 API): `invoice.sent` (client) and `payment.received` (client and firm) through its helper, opening the invoice.
- R1 or the lead: a firm page for Stripe Connect onboarding in PAGE-MAP if Rasel says yes (see Open), and the Stripe secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) in Secrets Manager and the API's environment (infra, with Rasel's yes).
- Infra (Rasel): the public route `/api/v1/webhooks/stripe` reaches the API through the load balancer (no WAF rule that drops Stripe's posts).

## Progress log

(newest last: date, step, what changed, commit)
- 2026-10-08, step 7 (contract): `packages/types/src/payments/` with `api.invoices` (firm: `list` with `clientId`, status, search and `paymentsEnabled`; `get`; `create`; `update`, the whole draft; `send`; `cancel` with a reason; `refund(id, paymentId, { amountCents, idempotencyKey })`) and `api.myInvoices(slug)` (portal: `list` with view, status, search and section; `get`; `pay`, an empty body answering a Stripe Checkout link). Shapes: `InvoiceListItem`, `Invoice` (lines, amounts, payments with refunds and `refundableCents`), `MyInvoice` (`status`, `section`, `canPay`, `paymentProcessing`), `MyInvoiceDetail`, `CheckoutLink`, `CheckoutReturn`; helpers `myInvoiceStatus()`, `isInvoiceOverdue()`, `lineAmountCents()`, `invoiceTotals()`; `InvoiceErrorCode` and `INVOICE_ERRORS`. Errors in the order the API checks them (415 and 403 ORIGIN_NOT_ALLOWED, 401, the tenant guard, 403 inactive or setup, 403 FORBIDDEN for Staff changes, 400, 404, 409, 503). Tests `packages/types/test/payments/` (both clients: every route, method, body, answer and refusal; amounts and client statuses). Mock `apps/web/src/mocks/invoices.ts` (lazy fixtures on R10's mock clients and services: one invoice of each state for the portal client, Staff see clients 1 and 2 only; one portal mock per firm; `pay` answers a `mock:` link and marks nothing paid; `refund` adds a PENDING refund). `docs/api/invoices.yaml` with the rules for the API (checkout, webhook events, refunds, audit). No apps/api code. Branch `rasel/R7-invoices-contract`.
- 2026-10-08, step 7 (contract, review fixes): `payment_intent.payment_failed` no longer fails a payment (a declined card can be followed by a good one in the same Checkout Session; FAILED only on `checkout.session.async_payment_failed` or `checkout.session.expired`, with an e2e case); refund retries with the same `idempotencyKey` answer the invoice as it is, found through Stripe (no key column), and the mock keeps keys per payment; `charge.refunded` confirms exactly one refund per event (listed from Stripe), never re-linking a confirmed one; `myInvoiceStatus()` keeps an invoice canceled while SCHEDULED as Canceled (`scheduledFor` kept; cleared on a canceled draft), with tests and a mock fixture; Checkout Sessions last 60 minutes with Stripe's `expires_at`; offline payments listed under Open and ruled out in the yaml.
- 2026-10-09, Stripe Connect setup contract (R16 brief step 3): `packages/types/src/payments/setup.ts` with `PaymentsSetup`, `StripeOnboardingLink` (https `connect.stripe.com` only), `StripeOnboardingReturn`, `paymentsSetupStage()`, `PaymentsSetupErrorCode` and `PAYMENTS_SETUP_ERRORS`; `api.paymentsSetup` in `apps/web/src/lib/api.ts`; mock `apps/web/src/mocks/payments-setup.ts` (roles, `start` connects, `mock:` links); the setup routes and rules in `docs/api/invoices.yaml` (and `account.updated` looks up in platform scope, writes in firm scope); tests `packages/types/test/payments/setup.test.ts`. Branch `rasel/R16-stripe-setup-contract`.
