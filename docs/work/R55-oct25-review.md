# R55: Octavia's review of Oct 25 (Dashboard K8, C1, C2, C5, D2, D4, D5; Client Sign-ups D)

Source: `docs/specs/review-2026-10-25/CHANGE-LIST.md` (sections A, C, D, F), `dashboard--developer-feedback.md`, `client-signups--developer-instructions.md`, `screenshots/client-signups-expanded-sidebar.png`.

## Invoices & Payments (Octavia's review of Oct 27, section A): IP-F01 to F05, F12, F13

Rasel (Oct 28): R55 takes IP-F01 to F05, F12 and F13. R56 owns F06 to F09, F17 and F20 to F24 (do not touch those files); R60 is on Messages only.

**Found:** the R36 migration already holds every Create Invoice field on `invoices` (`payment_terms`, `notes_to_client`, `internal_note`, `template_id`, `assigned_user_id`, `tax_rate_id`, `email_client`, `allow_tip`, `require_payment_before_due`, `recurring_invoice_id`), plus `payment_settings`, `invoice_tax_rates`, `invoice_templates`, `invoice_attachments` and `recurring_invoices`. The firm invoice API and screens used none of it. No schema change is needed for F02 to F05 or F13.

**Done:** IP-F13 (Settings > Payments: Invoice Defaults, Reminders & Automations, Taxes & Fees; tax rates and templates). A firm that never saved has every option off; the table's own column defaults turn `auto_receipts`, `send_reminders`, `notify_overdue` and `auto_apply_payments` on, so the API writes every field explicitly. A migration flipping those defaults would make the database agree (Rasel's card, not needed for the feature).

**Open:**
- IP-F13 #1209, IP-F01 #1211 and IP-F02 #1216: merged.
- IP-F05 on `rasel/R55-ip-f05-recurring`: Create Invoice's Recurring card. Off keeps a one-time invoice. On: the named frequencies (weekly, biweekly, semi-monthly, monthly, quarterly, semiannual, annual) or Custom, every 1 to 52 weeks, months or years (R1's #1217), and an end rule (never, a date, or after 2 to 120 invoices). A recurring draft keeps a `recurring_invoices` row that waits PAUSED, so nothing is made or sent from a draft. Sending the invoice starts it ACTIVE from the day the invoice opens, as its first period (`invoices.recurring_period_on`). Auto-send and AutoPay are written off (IP-010: recurrence authorizes neither). Turning Recurring off, or canceling the draft, ends the schedule (no DELETE grant). An end before the second invoice is 409 RECURRING_END_TOO_SOON. The period math is shared (`recurringPeriodOn` in packages/types), counted from the start so month ends hold. Nothing generates the later invoices yet: that is IP-F18's job (the Recurring Invoices screen and its daily run; not assigned to R55). "Firm-configured" frequencies have no table; Custom covers them.

Rasel's two approved additions are merged: Custom frequency (#1217, wired in F05) and `payment_settings.custom_term_days` (#1220, Oct 28; dev gets it with Deploy dev run 833).

**Open (Oct 28, late):**
- IP-F05 #1224 (`rasel/R55-ip-f05-recurring`): Recurring card, Custom every 1 to 52 weeks, months or years.
- Firm's own terms #1225 (`rasel/R55-firm-payment-terms`, from main): `PaymentTerm` takes `net_<days>` (1 to 365); Settings > Payments' "Your payment terms" (up to 12; default terms must be offered); Create Invoice offers the standard four plus the firm's list; 409 TERMS_NOT_OFFERED for terms the firm doesn't offer (a draft keeps its own).
- Both #1224 and #1225 add an `InvoiceErrorCode` and an `INVOICE_ERRORS` line in the same spot of `packages/types/src/payments/schemas.ts`, and both touch `invoice-editor.tsx`: whichever merges second needs `origin/main` merged (keep both codes).

**Next, in order (one PR each; no further schema needed):**
1. **IP-F03** (done Oct 29 on `rasel/R55-ip-f03-f04`, stacked on #1224 and #1225; merge `origin/main` after they merge):
   - Assigned Staff (`assigned_user_id`: an ACTIVE member, 404 otherwise); Invoice Template (`template_id`: a live template, a draft keeps its own); Tax (`tax_rate_id`: a live rate, a draft keeps one archived since; `invoice_lines.taxable` per line). The database computes the tax; `invoiceTaxCents` mirrors it exactly (BigInt), and the summary, preview, firm detail and portal detail show "Tax (name rate)".
   - Attachments (`documentIds`, up to 10, `invoice_attachments`): the client's shared, clean files, not trashed or archived (404; 409 ATTACHMENT_NOT_SHAREABLE for internal or unchecked). Left out keeps the draft's; [] removes them. Read back only while still shareable. The drop zone uploads into the client's Documents (shared) under the invoice's service.
   - A recurring draft's schedule copies the rate, staff, template and taxable lines.
   - Isolation: the invoice cases map `taxRateId`, `assignedUserId`, `templateId` and `documentIds`.
2. **IP-F04** (done Oct 29 on local branch `rasel/R55-ip-f04-options`, stacked on #1230; no PR until a slot frees). Rasel's defaults (Oct 29), all reversible:
   - **Email** (`email_client`): Create Invoice's "Send email notification to client" starts unchecked. Off, the invoice opens in the client's portal with its bell item and no email copy (`InvoiceNotices` reads the invoice's choice for `invoice.sent`, on Send and on the scheduled open). A recurring draft's schedule gets `delivery` PORTAL (EMAIL_AND_PORTAL when on). Left out of the API body: kept on update, and on create the column's default (on), so older callers and R56's tests still email; the form always sends it. With it off, IP-F07's Sent never shows (no email is dispatched).
   - **Allow tip** (`allow_tip`): shown only while Settings > Payments' Tipping is on; stored only. Pay Now still charges the balance due; the tip joins the Stripe charge in a later PR once Stripe test mode is verified. The client's portal shows nothing about tips yet.
   - **Require payment before due date** (`require_payment_before_due`): shown only while that setting is on. The client's invoice shows "Please pay before the due date, {date}." while it can be paid; Pay Now stays where it is. No blocking, no extra email.
   - Tip or before-due turned on while the setting is off is 409 OPTION_NOT_ENABLED; a draft keeps one it already has.
   - Not wired: the mockup's "Include attached files with invoice" (`include_attachments`); choosing files (IP-F03) already is that choice. Rasel's word if the box should show.
3. **IP-F12**:
   - Record Payment's Deposit To: `deposit_accounts` and `offline_payments.deposit_account_id` already exist, with no schema change;
   - Send Receipt once, after success only (`RECEIPT_SENT` invoice events dedupe it), and manual Send/Resend;
   - Automatic Receipts is F13's `autoReceipts`.
   - R56's open PRs touch `record-payment.tsx` and the offline payments service: merge `origin/main` first.

**Schema for Rasel's card:** none needed. Optional: flip `payment_settings`' column defaults (`auto_receipts`, `send_reminders`, `notify_overdue`, `auto_apply_payments`) to false so the database agrees with "nothing on by default"; the API already writes every field.
## Handoff (Oct 25, late; for the next R55)

Read first: `CLAUDE.md`, `docs/work/README.md`, this file, and Octavia's `docs/specs/review-2026-10-25/CHANGE-LIST.md` (A and D), `client-signups--developer-instructions.md` and `screenshots/client-signups-expanded-sidebar.png`.

### Open PRs

| PR | Branch | What |
| --- | --- | --- |
| #1154 | `rasel/R55-dashboard-help` | D2: Help & Support's in-app message (`POST /business/support/messages`, a Portal ticket in the Super Admin queue, idempotent by `requestId`, audited), Call Firmivra on the company phone, four verified common questions; no live chat (none exists). |
| #1156 | `rasel/R55-pipeline-drilldown` | C5: each pipeline stage opens its list filtered to what it counts, on the lists' definitions (R60's #1147). New Lead in the period, Intake not finished now (`/intake-forms?tab=open`, new list view), In Progress by workflow status now, Accepted in the period (the stage renamed from Completed). An e2e proves each stage equals its list's total. |

Merged this round: #1141 (checkout test gate), #1143 (schema requests), #1146 (C1, C2, K8).

### Next, in order

1. **Client Sign-ups screen (D1, no schema)**, its own PR when a slot frees:
   - today's API (`apps/api/src/client-auth/client-sign-ups.*`) lists Waiting and Declined only, oldest first, with no counts or search. Extend it: an Approved tab, tenant-wide counts per tab, search (name or email), Date submitted sort (newest first, stable id tie-break), filters (date range, potential-match status), server paging, first page after a filter change;
   - the screen to the image: Clients group in the sidebar with Sign-ups active; the header card **Client self-sign-up approval** (radios read-only until the setting exists, "Manage settings", "Authorized admins only"); the Checks column (Potential match amber / No match found green, text not colour only) from today's `existingClient` candidate until `match_status` lands; the Resolve Existing Account panel (actions disabled with the plain reason until the flow exists); the activity list (submitted, email verified, decisions); the client view preview (Sign In, Reset Password, Contact Firm only); Back with restored tab, search, filters, page and scroll (B01 to B04); states and accessibility from spec section 10.
2. **D5**: after R60's K5 (merged in #1147) and R1's `dashboard_card_templates` migration.
3. **Client Sign-ups flow (D2 to D4)**: after R1's migrations merge. Read R1's PR first. R1 added rules beyond Request 2: no DELETE on card templates; verifications append-only; a null `client_account_id` only for `POLICY_CHANGE` operations; existing accounts stay `match_status` UNCHECKED, which means nothing to review. The defaults are in CHANGE-LIST.md D3. Report F01 to F14, S01 to S16 and B01 to B04 as Pass, Fail or Blocked with evidence.

### Decided this round

- The pipeline's Intake and In Progress are open now; only Leads and Accepted follow the widget's period. The intake list filters its dates at UTC midnight, so a period-bound Intake would not reconcile.
- Help shows Firmivra's company phone (`lib/company.ts`, confirmed by Octavia) with no hours. The platform's support phone and the support desk's hours are Super Admin settings that the firm scope cannot read (the `platform_settings` policy). Showing them needs a read path: Rasel's word, or a database view (R1).

## Schema requests for Rasel's tap (R0 drafts the migration; R55 does not touch `packages/db`)

### Request 1: Dashboard D4 (Settings service-card templates)

One new table, firm-scoped (RLS on `business_id`, like every firm table):

`dashboard_card_templates`
| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid (uuid7) | primary key |
| `business_id` | uuid | FK `businesses`, RLS |
| `slot` | smallint | 1 to 6; unique with `business_id` |
| `service_id` | uuid null | FK `(business_id, id)` on `services`, restrict |
| `metric` | enum `DashboardCardMetric` (`ACTIVE_ENGAGEMENTS`, `ENGAGEMENTS_IN_STATUS`, `COMPLETED_IN_PERIOD`) | not null |
| `status_key` | text null | the engagement or tax status the metric counts; null for `ACTIVE_ENGAGEMENTS` |
| `label` | text | 1 to 40 characters, trimmed |
| `enabled` | boolean | default true |
| `version` | int | default 1, for stale-edit refusal |
| `created_by_user_id`, `updated_by_user_id` | uuid | FK membership |
| `created_at`, `updated_at` | timestamptz | |

Fixed cards are not rows (Total Clients, New Leads, Outstanding Invoices). The tax outcome card defaults to Accepted Returns (D5) when no row overrides it, and a row can never put a non-tax metric under a tax label (the API checks the label against the metric).

### Request 2: Client Sign-ups (D2 to D4), one request

Today the request is the `client_accounts` row (`PENDING_APPROVAL`, `ACTIVE`, `DECLINED`). There is no approval mode, version, match flag, verification or operation record. All new tables are firm-scoped (RLS on `business_id`, FK `(business_id, client_account_id)` to `client_accounts`, restrict).

1. **Approval mode with version**, on `business_settings`:
   - `client_signup_mode` enum `ClientSignupMode` (`MANUAL`, `AUTOMATIC`), not null, default `MANUAL`;
   - `client_signup_policy_version` int, not null, default 1 (raised by each change; a PATCH sends the version it read);
   - `client_signup_policy_changed_at` timestamptz null, `client_signup_policy_changed_by_user_id` uuid null (FK membership).
2. **Request version and potential-match flag**, on `client_accounts`:
   - `version` int, not null, default 1 (each decision or resolution raises it; stale writes are 409);
   - `match_status` enum `SignupMatchStatus` (`UNCHECKED`, `NO_MATCH`, `POTENTIAL_MATCH`, `NOT_A_MATCH`, `LINKED`, `RESTORED`), not null, default `UNCHECKED`, separate from `status`;
   - `match_checked_at` timestamptz null;
   - `decision_policy_version` int null (the policy version an approval or decline used), `decided_automatically` boolean, not null, default false.
3. **Match review**: `client_signup_match_candidates`
   - `id`, `business_id`, `client_account_id`, `candidate_client_id` (FK `clients`, restrict);
   - `matched_on` text[] (`email`, `phone`, `name_and_birth_date`, ...: field names, never values);
   - `resolution` enum `SignupCandidateResolution` (`OPEN`, `NOT_A_MATCH`, `VERIFIED`), default `OPEN`;
   - `reviewed_by_user_id` uuid null (FK membership), `reviewed_at` timestamptz null, `rationale` text null (at most 500);
   - `created_at`, `updated_at`; unique `(business_id, client_account_id, candidate_client_id)`.
4. **Verification record**: `client_signup_verifications`
   - `id`, `business_id`, `client_account_id`, `candidate_client_id`;
   - `contact_ref` enum `SignupContactRef` (`CLIENT_PHONE`, `CLIENT_EMAIL`, `CLIENT_CONTACT`): which contact **on the canonical record** was called, never the value or a sign-up contact;
   - `call_outcome` enum (`REACHED`, `NOT_REACHED`);
   - `identity_result` enum (`VERIFIED`, `NOT_VERIFIED`);
   - `permission_scope` enum (`RESTORE_ACCESS`, `LINK_RECORD`, `BOTH`) null, `permission_recorded_at` timestamptz null;
   - `actor_user_id` (FK membership), `created_at`. Append-only (no update or delete grant). No evidence, recordings or passwords.
5. **Resolution and operation records**: `client_signup_operations`
   - `id`, `business_id`, `client_account_id`;
   - `kind` enum `SignupOperationKind` (`APPROVE`, `DECLINE`, `LINK_EXISTING`, `RESTORE_ACCESS`, `NOT_A_MATCH`, `KEEP_PENDING`, `INVITE_DELIVERY`, `RECOVERY_DELIVERY`, `POLICY_CHANGE`);
   - `idempotency_key` text, `request_hash` text (a hash of the payload, to refuse key reuse with other data);
   - `status` enum (`COMMITTED`, `PENDING`, `SUCCEEDED`, `FAILED`);
   - `result` jsonb (client id, state, version: no tokens or identity evidence), `attempts` int default 0, `last_error_code` text null, `correlation_id` uuid;
   - `actor_user_id` uuid null (null for an automatic decision), `created_at`, `updated_at`;
   - unique `(business_id, idempotency_key)`; unique `(business_id, client_account_id, kind)` where `kind` in (`INVITE_DELIVERY`, `RECOVERY_DELIVERY`), so a delivery is never dispatched twice.

Audit stays in `audit_logs` (every action, old and new state, correlation id). Grants: the app role may insert and select every new table, update `client_signup_match_candidates` and `client_signup_operations`, and never delete.

## What is built without schema (this round)

- Dashboard: see "Dashboard" below.
- Sign-ups screen (D1): list, tenant-wide counts per tab, search, Date submitted sort (newest first by default), filters, Back with restored context, states and accessibility. The Checks column reads the existing email-link candidate (`existingClient`) until `match_status` lands.

## Dashboard (K8, C1, C2, C5, D2, D5)

- Periods are the firm's (business settings time zone). Month, quarter and year mean to date; Last Month and Last Year mean the full period; Custom is validated (start on or before end, end not after today).
- Comparisons use the equivalent elapsed period before: yesterday, last week to the same weekday, last month to the same day, the quarter before to the same elapsed day, last year to the same day. Last Month and Last Year compare with the full period before, and Custom with the same number of days just before.
- D5 depends on K5 (R60: Accepted Returns) and on Request 1 (D4).
