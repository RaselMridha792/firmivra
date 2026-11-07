# Super Admin review (Oct 31): Subscriptions change list

Source: "Subscriptions Developer Feedback" (Review One, Oct 31, 2026, 16:12 to 16:21 UTC) against the Subscriptions Developer Package (8 pages). Eight seed subscriptions were inspected; nothing was saved. Her codes are kept (R1, C1, Y1 ...).

## Summary

1. F items: 4 (SA-SUB-R1 to R4). Y items: 20 (C1 to C7, Y1 to Y13). GREEN: 16 checks (G1 to G16), not items. Keep them working and re-test them at Review 2.
2. Her priority 1: real seat usage (R1), revenue eligibility (R2), trial status (R3), payment recovery data (R4). Priority 2: the date, search and suspension clarifications (C1 to C7). Priority 3: the lifecycle, financial, permission, notification and audit tests (Y1 to Y13).
3. Sample check from her review: MRR shows $2,411 (four Active rows $2,183 plus the $228 Past Due row). Under the guide's rule it should be $2,183 MRR and $26,196 ARR.
4. Plan names and prices change with the v72 catalog (SA-SAL-F01). Subscription fixtures for Review 2 use the new plans (dummy data set E).
5. Schema: none confirmed. R4 depends on the attempt data built in SA-BIL-A2a. To check: a suspension kind (C4).
6. Role checks: financial, status and entitlement actions are checked on the server (Y10).
7. Shared: one MRR query used here, in Reports (SA-RPT-R3) and anywhere else MRR appears; the `packages/ui` date-range control (C2).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/subscriptions/`. API: `apps/api/src/admin-subscriptions/`. DB: `PlatformFirmSubscription` (status TRIAL, ACTIVE, PAST_DUE, SUSPENDED, NON_RENEWING, EXPIRED, CANCELLED; `seats_included`, `seats_purchased`, `auto_renew`, `trial_ends_at`, `suspended_reason`, `price_cents_override`), `PlatformSubscriptionChange`, `PlatformPlan`.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-SUB-R1 | R1 (source pages 2 to 3) | List Seats Used and Usage; detail Usage; Manage Seats | All eight rows show a dash and "Not counted yet". | Count used seats = active staff logins of the firm. Show used / allowed (included + purchased), the percentage, and warning states: amber at 80 percent, red at 100 percent, "Over limit" above it. Pending invitations shown separately ("+2 invited"), not counted. Same numbers in list, detail and Manage Seats. | No (count of active memberships). | Seed: firms below, at and over their seat limit (set E). |
| SA-SUB-R2 | R2 (source page 1) | MRR and ARR cards; Paying (MRR) filter | Past Due $228 row is counted; MRR $2,411, ARR $28,932. | MRR counts only paid, active subscriptions: ACTIVE and NON_RENEWING (paid through the period). Exclude TRIAL, PAST_DUE, SUSPENDED, EXPIRED, CANCELLED. Annual plans count at price / 12; a negotiated price overrides the plan price; an active discount reduces it. ARR = MRR x 12. The card and the Paying (MRR) filter use the same rule. | No. | Shared: one MRR query with SA-RPT-R3. Seed: set E with an expected-values sheet. |
| SA-SUB-R3 | R3 (source pages 5, 7 to 8) | Bluebird row and detail | Trial ended Oct 29, 0 days left, still "Trial" on Oct 31. | A daily job moves a trial past `trial_ends_at` without a successful conversion to EXPIRED (status exists), with a history row; a converted trial becomes ACTIVE. Never show "Trial" after the end date. Fix the Bluebird seed to a consistent state. | No (EXPIRED exists). | Seed: trials active, ending tomorrow, expired, converted. |
| SA-SUB-R4 | R4 (source pages 3, 5) | Pinecrest (Past Due) Overview and Billing | Shows $0 due, no invoice, no payment, no next retry or grace. | Past Due detail shows amount due, the failed payment (date, reason), attempt number, next retry date and grace end, linking to the invoice and the All Payment Issues row. Data comes from SA-BIL-A2a. Fix the Pinecrest seed to carry a failed invoice and attempts. | Via SA-BIL-A2a (attempt data). | Seed: coherent Past Due fixture. |

## B. Y items: clarifications (her C1 to C7)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SUB-C1 | C1 | Disabled add-ons (AI Tools, SMS Package, Extra Storage); Additional Location not on Team Pro | Default: keep them disabled with "Not available yet" and re-test when each is built. Plan eligibility follows the v72 catalog (SA-SAL-F01); a plan-specific restriction is not a defect. |
| SA-SUB-C2 | C2 | Reversed dates silently reset to Oct 1 to 31 | Default: build it with the shared date-range control: inline error "End date is before start date", entered values kept, nothing applied until valid. Test inclusive ends. |
| SA-SUB-C3 | C3 (source page 2) | What the date range filters | Default: the range drives the KPI reporting period only. Add a "Filter table by" selector (Start date, Renewal date, Next billing date) next to it so the table filters by the chosen subscription date. |
| SA-SUB-C4 | C4 | Meridian: "Administrative suspension" with reason "Payment failed three times", empty history | Default: two suspension kinds, Nonpayment (set by the retry flow) and Administrative (manual, with a reason). Fix the Meridian seed so kind, reason and history agree. Schema to check: a kind field or a reason code next to `suspended_reason`. |
| SA-SUB-C5 | C5 | Table "Not renewing" vs detail Auto-Renew ON (disabled) | Default: the table column shows what will happen ("Renews Nov 13", "Not renewing", "Suspended, no renewal"); the detail shows the stored preference separately as "Auto-renew preference: On", with a hint while suspended. |
| SA-SUB-C6 | C6 | Email and domain search | Default: search matches the firm owner's login email and the billing contact email and domain. Seed a subscription with a known contact email for the test. |
| SA-SUB-C7 | C7 | Discount base ($228 to $208.10 = 10 percent of the $199 base) | Default: keep percentage discounts on the base plan only, and say so in the preview ("10% off base plan $199.00"). Round to cents per invoice. |

## C. Y items: Review 2 tests (her Y1 to Y13)

Fixtures are dummy data set E in CHANGE-LIST.md; delivery disabled except to the controlled QA recipient; Stripe test mode.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SUB-Y1 | Y1 | Isolated fixtures | Prove payment, email and access isolation first; keep the existing seed rows. |
| SA-SUB-Y2 | Y2 | Direct Auto-Renew switch | The switch opens the controlled workflow (client-request confirmation, source, reason, paid-through date, notification, audit); never an instant change. |
| SA-SUB-Y3 | Y3 | Period-end cancel and reversal | Access kept to the exact end date; reversal needs confirmation and history; renewal never re-enables by itself. |
| SA-SUB-Y4 | Y4 | Payment lifecycle | Failed charge to Past Due, retries per SA-BIL-A2a, unresolved to Suspended (Nonpayment), paid to Active. A failed payment never cancels or closes. |
| SA-SUB-Y5 | Y5 | Reactivation | Suspended fixtures of both kinds; settled payment or resolved reason plus confirmation before Active; actor, time, reason, notice recorded. |
| SA-SUB-Y6 | Y6 | Trial lifecycle | 14-day enrollment, expiry (R3), extension, conversion success and failure; never Active after a failed conversion. |
| SA-SUB-Y7 | Y7 | Financial saves | Plan, seat, add-on, discount, credit and billing-date changes with proration, confirmation and audit, on fixtures. |
| SA-SUB-Y8 | Y8 | Errors and refresh | Invalid input, duplicate submit, failed save; cards, row, detail and history update together; no double charge. |
| SA-SUB-Y9 | Y9 | Notifications | Trial, conversion, failure, recovery, suspension, plan and renewal notices to the controlled QA recipient only. |
| SA-SUB-Y10 | Y10 | Roles and audit | Permitted and restricted test logins (set L); server checks on financial, status, entitlement and high-risk actions; audit old and new values, reason, money impact. |
| SA-SUB-Y11 | Y11 | Privacy and support access | Exports and linked records use non-private fixtures; support access needs restricted permission, banner, expiry and audit. |
| SA-SUB-Y12 | Y12 | Remaining menu paths | Payment method, payment link, invoice resend, conversion, closure safeguards and the other unexecuted actions, each on a fixture. Bulk selection is not bulk-action acceptance. |
| SA-SUB-Y13 | Y13 | Data coverage | At least 17 subscriptions (three pages at 8), churn with known cancellations, seat limits, renewals, payments and credits; canonical email and domain search. |

## D. Schema needs

None confirmed. R4 uses the attempt data from SA-BIL-A2a. To check: a suspension kind (C4).

## E. Role and permission notes

No role change. Server checks for financial, status, entitlement and support-access actions (Y10, Y11), proven with the role test logins.
