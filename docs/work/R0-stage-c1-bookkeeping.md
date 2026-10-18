# Stage C1: the bookkeeping ledger (contract note)

Migration `20261018010000_r0_bookkeeping_ledger`. It answers the Bookkeeping API's schema request
(#718), from the Bookkeeping developer instructions ("Fresh" version, sections 3 to 13). This note
is for the session that extends the Bookkeeping API with:
- the client workspace's Transactions tab, with refunds and settlements
- report versions
- the Terms page

It is firm data, under the usual firm policy (`business_id = app_current_business_id()`). Every row
stays on **one client's bookkeeping engagement**: composite keys `(business_id, engagement_id, …)`
refuse an account, category, transaction or document of another client. Each new table needs an
engagement with a bookkeeping profile.

Existing tables gain keys only: `bookkeeping_accounts` and `bookkeeping_connections` get
`(business_id, engagement_id, id)`, and `bookkeeping_reconciliations` gets `(business_id, id)`.

## Tables

| Table | What it holds |
| --- | --- |
| `bookkeeping_categories` | the client's chart-of-accounts categories: name, type, parent; synced (with the provider's id) or by hand; deactivated, never deleted |
| `bookkeeping_transactions` | the grid; see below |
| `bookkeeping_transaction_splits` | a split transaction's parts: category, amount, memo, class or location |
| `bookkeeping_refunds` | refunds received, refunds issued and chargebacks; see below |
| `bookkeeping_settlements` | a processor's payout batch; see below |
| `bookkeeping_settlement_items` | the payments, refunds and fees a settlement included (the drill-down) |
| `bookkeeping_report_versions` | each generated version of a `bookkeeping_reports` row: parameters, headline figures, the file, delivery |
| `bookkeeping_terms` | a version of the client's engagement terms; see below |
| `bookkeeping_terms_events` | the History tab, append-only |

**`bookkeeping_transactions`** columns:
- account, date, description, payee
- **amount** (positive) and **direction** (`DEBIT`: money out of a bank account or a card charge;
  `CREDIT`: money in, or a card payment or refund)
- **kind**: `STANDARD`, `TRANSFER`, `PAYMENT`, `REFUND`, `CHARGEBACK`, `FEE`, `PAYOUT`,
  `ADJUSTMENT`
- **status**: `UNCATEGORIZED`, `CATEGORIZED`, `MATCHED`, `EXCLUDED`, `NEEDS_REVIEW`
- category, class, location
- the transfer's other side, the transaction it was matched to, a possible duplicate, the receipt
  document, the reconciliation it was cleared in
- **source**: `SYNC`, `IMPORT` or `MANUAL`, with the source id

**`bookkeeping_refunds`** columns:
- kind: `REFUND_RECEIVED` (link the original expense; not ordinary income), `REFUND_ISSUED` (link
  the original sale), `CHARGEBACK` (with its dispute status)
- processor, source id, the original transaction and the refund's own transaction
- amount, reason, method, status, resolution
- the category its accounting treatment maps to, the settlement that carried it, whether it is in
  the report

**`bookkeeping_settlements`** columns:
- processor and source id, period, payout date
- **gross, refunds, chargebacks, fees and adjustments kept apart**, and the net (from the source,
  or calculated)
- the matched bank deposit, and status (`UNMATCHED`, `PARTIALLY_MATCHED`, `MATCHED`,
  `NEEDS_REVIEW`)

**`bookkeeping_terms`** holds the six tabs:
- **Terms:** package name (a snapshot from Services & Pricing), start and end, renewal type
  (`AUTO`, `MANUAL`, `FIXED_TERM`), renewal date, notice days, effective date, internal notes
- **Service Details:** included and excluded services, add-ons, deliverables, client and firm
  responsibilities (JSON arrays)
- **Billing & Payments:** frequency, advance or arrears, payment terms (`DUE_ON_RECEIPT`, `NET_7`,
  `NET_15`, `NET_30`, `CUSTOM` with days), preferred method, autopay, monthly and setup fee,
  additional billing, late-fee rule, discounts. The payment schedule and history come from the
  canonical Invoices & Payments for the engagement; there is no copy here.
- **Engagement Documents:** the generated agreement, the signed copy, the e-signature request,
  signed time
- **Renewal & Notices:** the renewal fields above, plus price-change and termination notices as
  events
- **History:** `bookkeeping_terms_events`

## What the database guarantees

**Transactions**
- The amount is positive.
- `EXCLUDED` needs a reason, `MATCHED` names its match, and `UNCATEGORIZED` has no category.
- A transaction keeps its client, account, connection and source id. Source financial facts stay
  authoritative; there is never a second copy.
- Never deleted: a duplicate is flagged with `duplicate_of_id`, never silently removed (spec 15).

**Closed periods**
- A closed `bookkeeping_periods` row locks every transaction dated inside it, and its split parts.
  Nothing is added, changed or moved in or out until the period is reopened.

**Checked at commit** (constraint triggers, deferred)
- A split transaction's parts add up to its amount, and it has no category of its own.
- A `CATEGORIZED` transaction has a category, split parts, or (a transfer) its other side.
- A transfer's two sides name each other.

So write a split (the transaction plus its parts), or both sides of a transfer, in one
transaction: `withScope`.

**Transfers and clearing**
- A transfer's other side is the same amount, the other way, on another account of the same
  client.
- A cleared transaction is cleared in its own account's reconciliation, and the database stamps
  `cleared_at`.

**Refunds**
- A chargeback has its dispute status (`OPEN`, `WON`, `LOST`, `ACCEPTED`), and only a chargeback
  does.

**Settlements**
- A calculated net is gross − refunds − chargebacks − fees + adjustments.
- A matched or partly matched settlement names its deposit, which must be money in (`CREDIT`). The
  database stamps `matched_at`.
- A settlement keeps its client and source.

**Report versions**
- On the report's own client, and numbered per report by the database (`version` is ignored on
  insert).
- What was generated (parameters, summary, file) never changes; to change it, generate a new
  version.
- Delivery moves `NOT_SENT` → `SENT` (stamped) or `FAILED` (with an error); a sent version stays
  sent.

**Terms**
- Numbered per client by the database, and a new version starts as a `DRAFT`.
- Lifecycle: `DRAFT` → `SENT` → `ACTIVE`, or `DRAFT` → `ACTIVE` directly; a sent version can go
  back to `DRAFT` to be edited.
- **Only a draft is edited.** Once a version is in force, a change is a new version. Making a
  version `ACTIVE` supersedes the one before it, so one version is in force at a time ("never
  overwrite prior signed terms").
- Signing details and internal notes may still change while the version is in force.
- `TERMINATED` needs a reason. Superseded and terminated versions never change.
- The database stamps sent, activated, superseded, terminated and signed times.
- **Terms events** are append-only. Write one for each change, notice and termination (`kind`,
  effective date, notice sent, reason, ids and old and new values in `details`).

## Endpoints the screens need

All under `/api/v1/business/bookkeeping/clients/:engagementId`.
- **Transactions:**
  - `GET /transactions` (date, account, category, amount, status, kind, source, payee; paging)
  - `PATCH /transactions/:id` (categorize, class or location, exclude, receipt)
  - `PUT /transactions/:id/splits`
  - `POST /transactions/transfer` (both ids)
  - `POST /transactions/:id/match`
  - `POST /transactions/bulk` (categorize or update the eligible ones)
- **Refunds:** `GET`/`POST`/`PATCH /refunds`, and `GET /refunds/report`.
- **Settlements:** `GET`/`PATCH /settlements`, `POST /settlements/:id/match-deposit`,
  `GET /settlements/:id/items`, `GET /settlements/report`.
- **Report versions:** `POST /reports/:id/versions` (generate), `POST .../send`, and the version
  history.
- **Terms:**
  - `GET /terms` (the version in force and the drafts), `POST /terms` (a new draft)
  - `PATCH /terms/:id` (draft only)
  - `POST .../send`, `.../activate`, `.../terminate`, `.../agreement` (generate, upload signed,
    e-sign)
  - `GET .../history`

**Audit** (spec 15, the audit row): every categorization, split, transfer, match, exclude, refund
or settlement link, report send and terms change writes `audit_logs` with ids, old and new values
and counts only.

## Not in this stage

- The sync worker and provider adapters that fill transactions, categories, refunds and
  settlements (the API or R1).
- Seeded settlement items: they need a processor connection's own payments, refunds and fees.
  `seed.test.ts` lists the table as known-empty, with the reason.
