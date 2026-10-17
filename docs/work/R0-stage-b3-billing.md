# Super Admin stage B3: Billing (contract note)

Migration `20261017170000_r0_platform_billing`, 15 tables. For the API session building the Super
Admin Billing pages (Dashboard, Invoices, Recurring, Estimates, Payments, Credit Notes, Settings),
and the firm's own "Billing & Subscriptions" read view later.

**Decided (Rasel, Oct 17):**
- Firmivra bills **firms**. The spec's "client" is the firm's billing contact
  (`platform_firm_billing_profiles`).
- Documents link to the firm's subscription. Super Admin never sees a firm's end clients.
- Where Octavia's docs disagree, the sensible reading is taken and noted here.

**Money:** integer cents, `usd`. Tax is per line in basis points (`tax_rate_bps`, 825 = 8.25%).

## Tables

| Table | Key columns |
| --- | --- |
| `platform_invoices` | `number` (`INV-1001`, by the database), `business_id`, `subscription_id`, `recurring_id` + `recurring_occurrence` (unique: one invoice per occurrence), `source_estimate_id` (unique), `status`, `invoice_date`, `due_date`, `period_start`/`end`, `bill_to_name`/`email`, `reference`, `notes`, `internal_note`, `discount_cents`, `subtotal_cents`, `tax_cents`, `total_cents`, `paid_cents`, `credited_cents`, `refunded_cents`, `allow_online_payment`, `sent_at`, `send_error`, `paid_at`, `voided_at`, `void_reason` |
| `platform_invoice_lines` | `description`, `quantity` (decimal), `unit_cents`, `tax_rate_bps`, `amount_cents` and `tax_cents` (by the database), `sort_order` |
| `platform_recurring_invoices` | `business_id`, `subscription_id`, `description`, `frequency` (`WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`, `CUSTOM` + `interval_days`), `line_template` (JSON lines), `amount_cents`, `start_date`, `next_invoice_date`, `end_date`, `auto_send`, `auto_pay`, `status` (`ACTIVE`, `PAUSED`, `CANCELED`) |
| `platform_estimates` | `number` (`EST-1001`), `business_id`, `status` (`DRAFT`, `SENT`, `PENDING`, `APPROVED`, `DECLINED`, `EXPIRED`, `CONVERTED`), `issue_date`, `expiration_date`, `contact_name`/`email`/`phone`, `reference`, `notes`, totals like an invoice, `assigned_user_id`, `sent_at`, `decided_at` |
| `platform_estimate_lines` | like invoice lines |
| `platform_payments` | `business_id`, `invoice_id`, `amount_cents`, `refunded_cents` (by the database), `method` (`CARD`, `ACH`, `WIRE`, `CHECK`, `CASH`, `CREDIT_BALANCE`, `OTHER`), `status` (`PENDING`, `COMPLETED`, `FAILED`, `PARTIALLY_REFUNDED`, `REFUNDED`), `paid_on`, `reference`, `processor_ref` (unique), `failure_reason`, `receipt_sent_at`, `idempotency_key` (unique) |
| `platform_refunds` | `payment_id`, `amount_cents`, `status` (`PENDING`, `COMPLETED`, `FAILED`), `reason`, `internal_note`, `processor_ref`, `completed_at` |
| `platform_credit_notes` | `number` (`CN-1001`), `business_id`, `related_invoice_id`, `status` (`DRAFT`, `AVAILABLE`, `PARTIALLY_APPLIED`, `APPLIED`, `REFUNDED`, `VOIDED`), `issue_date`, `reason`, `customer_note`, `internal_note`, `subtotal_cents`, `tax_cents`, `total_cents`, `applied_cents` (by the database), `refunded_cents`, `issued_at`, `voided_at`, `void_reason` |
| `platform_credit_note_lines` | like invoice lines |
| `platform_credit_applications` | `credit_note_id`, `invoice_id`, `amount_cents`, `applied_by_user_id`. Insert-only |
| `platform_firm_billing_profiles` | one per firm: `billing_contact_name`/`email`, `payment_term_days`, `tax_exempt`, `tax_rate_bps`, `auto_pay`, `notes` (the firm overrides) |
| `platform_billing_settings` | one row: `currency`, `default_payment_term_days`, `default_tax_rate_bps`, `estimate_valid_days`, `allow_partial_payments`, `late_fee_bps`, `late_fee_grace_days`, `reminders` (JSON), `templates` (JSON), `invoice_footer` |
| `platform_billing_counters` | the last number per document type; read-only for the app |
| `platform_payment_events` | a processor webhook recorded once (`processor` + `event_id` unique) |
| `platform_subscription_changes` | a firm subscription's history, insert-only: `kind` (`CREATED`, `UPGRADED`, `DOWNGRADED`, `SEATS_CHANGED`, `CYCLE_CHANGED`, `STATUS_CHANGED`, `RENEWED`, `CANCEL_REQUESTED`, `CANCELED`), from/to plan, status and seats, `reason`, `effective_at`. The API writes one on every subscription change. Reports' upgrades and downgrades read it |

**Overdue** is not stored. It is an issued invoice (`SENT` or `PARTIALLY_PAID`) past `due_date`
with a balance. **Balance** = `total_cents - paid_cents - credited_cents`. A refund never makes
money owed again (the same rule as the firm-level billing).

## What the database does, and what the API does

**The database:**
- **Numbers and times:** gives `INV-`, `EST-` and `CN-` numbers (never reused, even after a void),
  and stamps `sent_at`, `voided_at`, `paid_at`, `issued_at`, `decided_at` and `completed_at`.
- **Amounts and totals:** line `amount_cents` = quantity x unit (rounded), `tax_cents` = amount x
  rate. A document's subtotal and tax come from its lines, and total = subtotal - discount + tax
  (a credit note's total is subtotal + tax).
- **Drafts:** lines change only while their document is a `DRAFT`. After that, what was billed,
  quoted or credited is fixed.
- **Money and money statuses:** an invoice's `paid_cents`, `refunded_cents` and `credited_cents`
  come from its payments, refunds and credit applications, and so do the statuses that follow
  (`PARTIALLY_PAID`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`). The same goes for a credit
  note's `applied_cents` and its applied statuses. Nobody sets these by hand.
- **Limits:**
  - a payment only on a sent, not-void invoice, and a COMPLETED payment never past the balance
  - a refund only on a completed payment, never past what is left of it
  - credit only from an `AVAILABLE` or `PARTIALLY_APPLIED` note, never past what it has left or
    what the invoice owes
- **Allowed by hand:**
  - invoice: `DRAFT` -> `SENT`; `DRAFT` or `SENT` -> `VOIDED` (only with no money on it); `VOIDED`
    is final
  - credit note: `DRAFT` -> `AVAILABLE` (issue); `DRAFT` or `AVAILABLE` -> `VOIDED` (nothing used);
    `REFUNDED` once fully refunded
  - estimate: any move except out of `CONVERTED` or `DECLINED`. `CONVERTED` needs the invoice made
    from it (`source_estimate_id`). Only a `DRAFT` estimate is deleted
  - payment: `PENDING` -> `COMPLETED` or `FAILED`. Refund: `PENDING` -> `COMPLETED` or `FAILED`
    (a COMPLETED refund updates the payment, which updates the invoice)

**The API:**
- writes `platform_subscription_changes` on every subscription change
- creates invoices from recurring schedules (one per `recurring_occurrence`)
- sends documents and records `send_error`
- talks to Stripe (record `platform_payment_events` first, skip duplicates)
- writes `audit_logs` for sends, voids, payments, refunds and credits
- checks the `billing.*` permission keys

## Who can do what (RLS)

- **Super Admin team** (admin scope) and **platform jobs** (recurring runs, webhooks, reminders):
  everything. Which member may do what is the API's `billing.*` check.
- **A firm** (business scope) **reads**:
  - its own invoices, estimates and credit notes once issued (never a draft), with their lines
  - its payments, refunds and credit applications
  - its billing profile and its subscription history

  It writes none of them, and never sees settings, counters, recurring schedules or processor
  events.

## Endpoints the screens need (all under `/api/v1/admin/billing`)

- `GET /summary`: dashboard cards (outstanding, overdue, collected this month, credits) and the
  charts
- **Invoices:**
  - `GET` and `POST /invoices`; `GET` and `PATCH /invoices/:id` (draft only)
  - `POST /invoices/:id/send`, `/duplicate`, `/void`
  - `POST /invoices/:id/payments` (record), `/credit-applications`; `GET /invoices/:id/pdf`
  - `POST /invoices/preview` (totals before saving)
- **Recurring:** `GET` and `POST /recurring`; `PATCH /recurring/:id`;
  `POST /recurring/:id/pause`, `/resume`, `/cancel`
- **Estimates:** `GET` and `POST /estimates`; `GET`, `PATCH` and `DELETE /estimates/:id` (draft
  only); `POST /estimates/:id/send`, `/duplicate`, `/approve`, `/decline`, `/convert` (makes the
  invoice, then `CONVERTED`)
- **Payments:** `GET /payments`; `GET /payments/:id`; `POST /payments/:id/refunds`;
  `GET /payments/:id/receipt`, `POST /payments/:id/receipt/send`
- **Credit notes:** `GET` and `POST /credit-notes`; `GET` and `PATCH /credit-notes/:id` (draft
  only); `POST /credit-notes/:id/issue`, `/apply`, `/refund`, `/void`, `/send`;
  `GET /credit-notes/:id/pdf`
- **Settings:** `GET` and `PATCH /settings`; `GET` and `PUT /firms/:businessId/billing-profile`
- **Firm side, later:** `GET /api/v1/business/billing/invoices` (and `/:id`), `/credit-notes`,
  `/subscription/history`

**Where the docs disagreed:**
- Who is billed: decided above.
- Estimate statuses "Sent" vs "Pending": both are kept. "Pending" = awaiting the firm's answer
  after a reminder.
- Invoice type and payment method lists were not given. Payment methods are the enum above, and
  invoice type isn't modelled (the subscription link and recurring schedule cover it).
- Attachments on invoices are left for later (the spec marks them optional).

## Seed

LVP gets:
- a billing profile
- **INV-1001:** $257, paid by card, $20 refunded (`PARTIALLY_REFUNDED`)
- **INV-1002:** $199, with $50 credit from **CN-1001** applied (`PARTIALLY_PAID`)
- **EST-1001:** a $5,988 Business-plan quote (`SENT`)
- a monthly recurring schedule
- a processor event

The migration inserts the settings row and the counters. The test setup keeps those two tables
(they hold migration-inserted rows): see `MIGRATION_REFERENCE_TABLES` in `src/testing.ts`.
