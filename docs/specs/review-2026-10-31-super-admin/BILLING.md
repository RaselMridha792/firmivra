# Super Admin review (Oct 31): Billing change list

Source: "Billing Developer Feedback" (Review One, Oct 31, 2026, about 16:23 to 16:27 UTC) against the Billing Developer Instructions (Oct 14, 14 pages), plus the Revenue and All Payment Issues additions approved during the Dashboard review the same day. Her codes are kept (R1, C1, A1, Y1 ...). Rows she did not number are ours: sub-items of her A1 and A2 get a letter (A2a), and her "Remaining safe checks" rows are S1 to S8.

Scope rule from her review and the Dashboard decision: Super Admin Billing is about Firmivra's subscription payments BY firms. A tenant firm's invoices to its own clients belong to the firm workspace, not here.

## Summary

1. F items: 12 (R1, R2, C3, A1, A2, A2a to A2g). Y items: 29 (C1, C2, A1a, A2h to A2k, S1 to S8, Y1 to Y14). GREEN: 13 checks (G1 to G13) plus 9 settings-tab observations, not items. Keep them working and re-test them at Review 2.
2. Her priority 1: resolve issuer scope (R1), repair template tokens (R2), build Revenue (A1) and All Payment Issues (A2). Priority 2: session-blocked checks, CRM dependency, then populated fixtures for the lifecycle tests.
3. Default for her open scope question (R1, C2): platform billing. Firmivra is the issuer, the selected firm is the customer. This matches the Dashboard decision and keeps tenant client records out of Super Admin. Show it at Review 2.
4. Retry policy (A2a): the original attempt plus three retries, three days apart, four attempts in total, then contact the firm. This supersedes the earlier three-attempt reading.
5. Schema: yes for payment attempts and next-retry data (A2a) and for platform disputes with notes and evidence (A2, A2f). To check: whether platform documents carry a client reference that R1 should drop.
6. Role checks: Retry Payment, Suspend and Cancel, and Accept or Challenge Dispute are Billing-role actions with server checks (A2a, A2e, A2f); the 12-action permission matrix in Billing Settings must be enforced on the server (Y11).
7. Shared: one revenue query for Dashboard Monthly Revenue and the Revenue tab (A1, SA-DSH-F05); one issue-count query for the Dashboard row and the issues list (A2, SA-DSH-F08); one Suspend, Close and Cancel server action shared with Firms (A2e, SA-FRM-F03 and F04); the `packages/ui` date-range control (A1).
8. No item authorizes a real charge, retry, email, evidence upload, dispute response or account change. QA uses Stripe test mode, delivery-disabled fixtures and the controlled QA recipient.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/billing/`. API: `apps/api/src/admin-billing/`. DB: `PlatformInvoice`, `PlatformPayment` (`failure_reason`), `PlatformPaymentEvent` (provider webhook events), `PlatformRefund`, `PlatformCreditNote`, `PlatformEstimate`, `PlatformRecurringInvoice`, `PlatformBillingSettings`, `PlatformFirmBillingProfile`. No dispute or retry-attempt model exists.

## A. Corrections and scope

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-BIL-R1 | R1 (source sections 3, 7.5, 17.5) | Invoice create, embedded and full-size preview | With the Demo firm and its client selected, the issuer is still Firmivra; the same with Harborline. The source asks for selected-firm branding. | Default scope: platform billing. Issuer = Firmivra (logo, contact, terms, tax, payment details from Billing Settings). Bill-to = the selected firm and its billing contact (`PlatformFirmBillingProfile`). Remove the tenant-client picker from Super Admin invoice, estimate and credit-note forms, and fix the labels "Client #0" and "Firm (Firm)" to show the firm name and billing contact. Update the guide note to match. Re-test preview, generated PDF and delivery. | To check: whether platform documents store a client reference that should be dropped. | Role: no tenant client data in Super Admin. Seed: invoices for 3 firms (set D). |
| SA-BIL-R2 | R2 | Billing Settings > Templates; invoice and estimate preview | Saved templates use double-brace tokens; the helper lists different single-brace names; preview leaves raw number, contact and date tokens and shows "{$250.00}". | One token syntax for saved defaults, parser and helper. Migrate stored templates to it. Missing values get a defined fallback (empty with no stray braces). Test every one of the six template families, the preview, the generated document and the delivered message separately. | No (data migration of stored templates). | None. |
| SA-BIL-C3 | C3 (source section 14.3) | Credit note > "Keep available" OFF | Text says leftover credit "will be marked refunded or closed". | Say exactly what happens: "Remaining credit will be closed. To return money, issue a refund." A refund is recorded only through the refund flow and only after processor confirmation; closing credit never records a refund. | No. | None. |

## B. Approved additions: Revenue

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-BIL-A1 | A1; Dashboard "Billing Revenue dependency" | New tab Billing > Revenue | Tab absent. | New Revenue tab, separate from Recurring and All Payment Issues. Entry from Dashboard Monthly Revenue: current month, both recurring and one-time selected. Type filter (One-time, Recurring, both). Period: month picker, Last month, custom start and end. "Compare to last month" is a separate toggle that shows both periods side by side, not a replacement of the current one. Dashboard tile and this tab use one query and show the same total. Basis: A1a. | No (read query). | Shared: revenue query with SA-DSH-F05; date-range control. Seed: payments this month and last month, both types (set D). |

## C. Approved additions: All Payment Issues

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-BIL-A2 | A2; Dashboard "One issues tab", "Three filters", "Shared count" | New tab Billing > All Payment Issues | Tab absent. | ONE new tab with three filters: Overdue / Past Due, Failed Payments, Disputes. No separate Disputes tab. Firm subscription payments only, never tenant client invoices. Each row has an action menu for its type (A2b, A2c, A2f). Dashboard "Payment issues" count = this list's total, one query (counting rule A2h). | Yes: platform dispute record (provider id, firm, payment, amount, reason, status, response deadline). | Shared: count query with SA-DSH-F08. Seed: issues of each type (set D). |
| SA-BIL-A2a | "Retry cadence"; Dashboard "Approved policy" | Retry engine; signup terms | Not present. | Original attempt plus three retries, each three days apart: four attempts in total. After the fourth fails, flag the row "Contact firm" and create a follow-up for Billing staff. Show amount due, attempt number and next retry date. Add the policy to the signup terms text. No unlimited manual retries (A2i). | Yes: attempt history (attempt number, time, result, failure reason) and next-retry time per invoice. | Role: Billing role. Seed: one invoice at attempt 2 of 4, one exhausted at 4 of 4. |
| SA-BIL-A2b | "Overdue action"; Dashboard "Overdue Retry Payment" | Overdue row menu | Not present. | Put Retry Payment in the same Overdue / Past Due action menu, under the A2a cap. | No. | Role: Billing role. |
| SA-BIL-A2c | "Failed Payment actions" | Failed Payments row menu | Not present. | Exactly seven actions: Retry Payment; Send Payment Failure Email; Request Updated Payment Method; View Failure Reason; View Attempt History; View Invoice; Contact Firm. | No (uses A2a data). | Role: Billing role for Retry and the emails. |
| SA-BIL-A2d | "Failure email"; Dashboard "One email" | Send Payment Failure Email; Billing Settings > Templates | Not present. | ONE failed-payment email with two buttons: "Update payment method" and "Pay now" (existing method). No second email or template. Button behavior after a method update: A2k. | No. | Shared: template family from R2. |
| SA-BIL-A2e | "Account controls"; Dashboard "Manual suspension and cancellation" | Next to the firm's action menu | Not present. | Manual Suspend Account and Cancel Account, each with its own confirmation and a required reason. Never automatic: a dispute does not suspend, a resolution does not cancel. Cancel after a dispute only if the firm no longer wants service. History and audit with actor, time and reason. | No. | Role: Billing role, server check. Shared: one server action with SA-FRM-F03 and F04; confirm-with-reason dialog. |
| SA-BIL-A2f | "Dispute actions"; Dashboard "Disputes actions" | Disputes row menu | Not present. | View Dispute; View Payment / Invoice; Contact Firm; Add Notes; Upload Evidence; Open in Stripe; Accept Dispute and Challenge Dispute (authorized admins only, with confirmation). | Yes: dispute notes and evidence files (with the A2 record). | Role: Accept and Challenge restricted. Seed: one open dispute in Stripe test mode. |
| SA-BIL-A2g | "Dispute history"; Dashboard "Response deadline", "State and submission", "Resolution record" | Dispute detail | Not present. | Show the provider response deadline; a negotiation with the firm never moves it. Sync dispute status from the provider. Keep contact messages and resolution notes with the dispute. Mark it closed only on provider-confirmed status, never on a verbal agreement. | No (with the A2 record). | None. |

## D. Y items: decisions

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-BIL-C1 | C1 (source section 11.1) | Estimate "Add New Client" waits for Leads/CRM | Default: under the platform-billing scope (R1) the customer is a firm, so the Estimate picker lists firms. New prospects come from Sales / Leads CRM (reviewed in a later pass). Keep the control disabled with an explanation until then; never build a Billing-only client page. |
| SA-BIL-C2 | C2 | Canonical payer, customer, tenant firm and issuer | Default: payer and customer = the tenant firm (its billing profile); issuer = Firmivra. Built under R1. |
| SA-BIL-A1a | "Revenue basis"; Dashboard "Calculation decisions" | Gross or net, refunds, date basis | Default: collected payments, gross, by payment date in America/New_York. Refunds are shown as their own line for the same period and are not netted from the headline. Label it "Collected (gross)". One-time vs recurring follows the invoice source (subscription or recurring schedule = recurring). Not MRR. |
| SA-BIL-A2h | "Issue counting"; Dashboard "Shared count" | Overlapping issue types | Default: one issue per invoice. An invoice that is both overdue and failed counts once, under the first match of Disputed, Failed, Overdue. Filter counts may overlap; the total and the Dashboard count are distinct invoices. |
| SA-BIL-A2i | "Retry decisions"; Dashboard "Unresolved" and "Proposed safeguards" | Manual vs automatic, stop rules | Default: manual retries count toward the same four-attempt cap. Stop when paid, disputed or the subscription is canceled. After the firm updates its payment method, the next scheduled retry runs at once (it does not add an attempt). One retry at a time per invoice (lock), no double charge. Stripe Smart Retries off for these subscriptions. Every attempt audited. |
| SA-BIL-A2j | "Other overdue actions" | Eight actions with weaker approval | Default: build the read or message-only ones now (View Invoice, Send Reminder, Resend Invoice, View Payment History, Contact Firm). Hold the money or state changers (Extend Due Date, Apply Credit, Record Verified Payment) until confirmed at Review 2. |
| SA-BIL-A2k | "Email decision"; Dashboard "Request retry intent" | Button count and "request retry" | Default: two buttons only. Updating the payment method triggers the immediate retry from A2i, so the owner's "request a retry" intent is covered without a third button. |

## E. Y items: remaining safe checks (her table, numbered by us)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-BIL-S1 | "Session interruption" | Session ended at Sign In during the last preview | Default: check it against the 30-minute admin idle timeout (Audit & Security policy) before calling it a Billing defect. Restore a session and finish the live checks. No code change unless reproduced. |
| SA-BIL-S2 | "Form exit and issuer" | Second Harborline form; issuer after client selection | Re-test after R1: unsaved form discarded, overview restored, issuer correct with a firm selected. |
| SA-BIL-S3 | "Invoice previews" | Due-date and negative-rate blur validation, currency and terms preview, recurring option in the shared drawer | Test with unsaved forms; fix only failures. |
| SA-BIL-S4 | "Filters and navigation" | Date ranges, search combinations, sort, active sidebar state on every Billing screen | Test with the populated fixtures (set D). |
| SA-BIL-S5 | "Visual and accessibility" | Responsive, keyboard, focus | Test at phone, tablet and desktop widths with keyboard only. |
| SA-BIL-S6 | "Clear Filters scope" | Advanced Clear Filters keeps Search, Status and Issue date | Default: rename the advanced button "Clear advanced filters"; add "Clear all" that resets everything. |
| SA-BIL-S7 | "Reports and sidebar" | View Reports opens general `/reports`; Automations missing from the sidebar | Default: View Reports opens `/reports` on the Revenue tab. Automations is a firm-workspace module, not a Super Admin one: no sidebar change. |
| SA-BIL-S8 | "Online pay terminology" | "Allow online payment" shown as AutoPay | Default: the invoice and recurring checkbox reads "Allow online payment (pay by link)". "AutoPay" is used only for saved-method automatic charges in Settings. |

## F. Y items: Review 2 tests (her Y1 to Y14)

All run in Stripe test mode with delivery disabled except to the controlled QA recipient. Fixtures are dummy data set D in CHANGE-LIST.md.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-BIL-Y1 | Y1 | Isolation before creating records | Stripe test keys, email sink, isolated QA firms; record the proof in the PR. |
| SA-BIL-Y2 | Y2 | Invoice lifecycle (draft to void, payment, credit, refund links) | Seed invoices in every status; deactivated firm cannot create new documents but keeps history. |
| SA-BIL-Y3 | Y3 | Estimate lifecycle and conversion | Seed estimates (draft, sent, accepted, expired, converted); conversion uses the invoice form; no duplicate conversion. |
| SA-BIL-Y4 | Y4 | Recurring create, edit, pause, cancel; one invoice per occurrence | Seed active, paused and canceled schedules; run the scheduler with a fake clock. |
| SA-BIL-Y5 | Y5 | Partial, full and over-payments; receipts | Seed one invoice per case; Payment Details links to Invoice Details and the shared receipt viewer. |
| SA-BIL-Y6 | Y6 | Full and partial refunds | Seed refundable payments; success shown only after processor confirmation; Partially Refunded kept. |
| SA-BIL-Y7 | Y7 | Credit notes: issue, apply, refund remainder, void | Seed credits; check original = applied + refunded + available. |
| SA-BIL-Y8 | Y8 | Generated documents for several firms, currencies, taxes, terms | Seed USD and CAD firms; check issuer per R1 on PDFs and delivered copies. |
| SA-BIL-Y9 | Y9 | Server validation and totals | API tests for negative amounts, bad dates, missing lines, rounding, tax, discount, fee and currency precision. |
| SA-BIL-Y10 | Y10 | Number collisions and links | Tests: no reused numbers after void; estimate, schedule, payment, credit and refund links kept. |
| SA-BIL-Y11 | Y11 | Roles and audit | Use the Billing staff and Support test logins (set L); every action in the 12-row matrix checked on the server; audit actor, time, firm, record, before and after, amount, reason. |
| SA-BIL-Y12 | Y12 | Settings persistence, errors, retries | Test each settings tab save and reset in the dev sandbox; a send failure never discards the saved record; duplicate submits blocked. |
| SA-BIL-Y13 | Y13 | Populated UI | Records in every status for totals, filters, search, paging, sorting, kept query state and empty, loading, error states. |
| SA-BIL-Y14 | Y14 | Approved additions end to end | After A1a and A2h to A2k: Revenue parity with the Dashboard, issue filters and counts, attempt history, failure email, controlled retries, Suspend and Cancel, dispute deadline and audit. |

## G. Schema needs (each needs Rasel's tap before any `packages/db` change)

- A2a: payment attempt history and next-retry time for platform invoices.
- A2 and A2f: a platform dispute table with notes and evidence files.
- R1, to check: any client reference on platform invoices, estimates or credit notes.
- A1 is a read query; R2 is a data migration of stored templates, not a schema change.

## H. Role and permission notes

No new role. Billing-role actions checked on the server: Retry Payment (A2a to A2c), Suspend and Cancel (A2e), Accept and Challenge Dispute (A2f). The Billing Settings permission matrix (Owner/Super Admin, Admin, Billing Staff, Support; 12 actions) must be enforced on the server and proven with test logins (Y11).
