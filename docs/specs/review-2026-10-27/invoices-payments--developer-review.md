# Invoices and Payments: developer review (Octavia, walkthrough of Oct 26)

Source: Firmivra_Invoices_and_Payments_Developer_Review.docx, converted to text with its table rows kept. The change list is `CHANGE-LIST.md`. IP-001 to IP-070 refer to the findings in this guide. Every success in it is user-reported and narrow.

| Status | Area or check | Result and developer action | Prerequisite or boundary |
| Firmivra Invoices and Payments Developer Review |
| INFO | Scope and decision | First walkthrough completed 26 October 2026 • Findings IP-001–070

Proceed with the corrections and approved enhancements below. No material safe, unblocked check needs to prolong this first walkthrough. This is not full functional acceptance: missing routes, configuration, representative data and authorized integration tests still prevent end-to-end verification. No changes have been implemented by this review. | All IP-001–070 findings; all 12 source sections. |
| INFO | Evidence boundary | All successes and observed failures are user-reported, not independently executed or verified. Tests used dummy clients; the reported Send click used the user’s own email and produced Scheduled only. Manual payment records do not prove processor movement. No dispatch, email delivery, gateway charge, settlement, payout or refund success is claimed.

Baseline: eight pasted source messages covering all 12 guide sections, verbally confirmed complete by the user; the original uploaded Word file was inaccessible. Mockup comparison was waived. Later decisions below supersede older alternatives. Finding IDs provide traceability without reproducing the original guide. | User-reported evidence, not independent test execution. |
| GREEN
PASS | Legend | Green = user-reported successful check, only to the scope stated. Presence/navigation success is not a full workflow pass. | Read every limitation in the result and boundary columns. |
| RED
REQUIRED | Legend | Red = developer correction, fix or user-approved addition. “Approved enhancement” is distinguished from original-source omissions. Red does not mean changes are implemented. | Implementation then authorized retest. |
| YELLOW
PENDING | Legend | Yellow = blocked or unverified checks, developer confirmation, or optional recommendations. Each is labeled explicitly; recommendations are not approved scope. | Do not treat pending work as failure, success or permission to activate/send/charge. |
| User reported successful checks to preserve |
| GREEN
PASS | Navigation and display | Navigation and display — Matching title/subtitle; four top actions visible; Create Invoice and Settings > Payments open; View Payments opens and View Client Profile reaches the correct client. Quick Links Create Invoice, Record Payment and Invoice Templates route correctly. Reports landing → Financial Report → Back to Reports works. These are navigation/presence checks, not complete workflow passes. [001–004, 029, 041, 052, 059] | Destination/presence only; missing actions are red below. |
| GREEN
PASS | Invoice workflow | Invoice work — Manual items, multiple items and percentage/fixed discounts worked within the reported examples. Save Draft produced a visible draft and invoice number; Edit Draft worked. Invoice/send/due dates were distinct selectable fields. Duplicate copied information with due/send dates cleared, as accepted. Cancel prompted for a reason and canceled the duplicate. Future Send produced Scheduled. Unique numbering, unchanged original and durable persistence remain unverified. [006–007, 009, 011–014, 020–024] | Unique ID, original unchanged, reload persistence and actual send remain unverified. |
| GREEN
PASS | Manual payments | Payments — Manual recording changed an overdue invoice to Paid. Invoice context was prefilled and client locked; a partial payment previewed remaining balance and saved with Partially Paid and correct reported paid/outstanding amounts. Conditional references worked, including a $40 record with transaction ID 1234567. Negative input was blocked without a save. Inline receipt showed correct client, invoice, amount, date and balance. Void required a reason, restored balance to $140 and retained an entry labeled Canceled; full audit is not confirmed. [028, 033–035, 037, 039, 064] | No processor movement or delivery proof; full audit pending. |
| GREEN
PASS | Dashboard and forms | Dashboard and forms — Five original KPIs are present; Invoice Activity responds to Last Year/This Year; report Custom dates accept input. Invoice summary shows subtotal, discount, total, paid and balance. Numerical reconciliation is not established by these checks. [045–047, 053, 066] | Presence/UI response/input only; no numerical reconciliation. |
| GREEN
PASS | Arithmetic example | Reported inputs were 1 × $100 and 1 × $150; the first line amount and 10% discount worked. Expected arithmetic is $250 subtotal − $25 discount = $225 before tax/fees, not a read-back of the final displayed total. Both discount types later worked by report. Rounding, taxes, all totals and permanent-catalog effects remain unverified. [007, 009, 011] | Expected $225 is not a read-back of the displayed final total. |
| GREEN
PASS | Search and filters
IP-031 | Search by client and invoice number; service, client, status and date filters worked by user report except Sent. | Sent investigation and event history remain pending; see required state design. |
| Create Invoice corrections and approved additions |
| RED
REQUIRED | Catalog access and line details  IP 005 008 069 | Before: the selected client reportedly restricts service choices, and line details are typed manually. After: expose all available, permitted firm Services & Pricing offerings for any client and populate selected catalog details. Preserve category filtering and optional assigned-service highlighting without hiding other eligible offerings. Keep one permanent catalog; route missing permanent offerings/prices to Services & Pricing. Preserve one-time custom items without creating permanent services. Compare against the actual catalog before attributing a technical cause. Subservice behavior remains blocked until configured, available services/subservices exist; it is not independently proven missing. | Actual permitted catalog comparison; configured available services/subservices for subservice retest. |
| RED
REQUIRED | Preview notes and payment terms  IP 015 to 019 | Before: Preview Invoice, payment terms, Notes to Client and Internal Note are absent. After: provide a client-facing preview without status change; Due on Receipt, Net 7/14/30 and firm-configured terms; separate client-visible and firm-only notes. Internal notes must never enter client PDF, email or portal. Verify preview amounts and output confidentiality. Existing branding/logo capability remains unverified, not a confirmed missing implementation. | Implemented fields and preview; firm template/logo; output privacy checks. |
| RED
REQUIRED | Staff attachments templates and summary  IP 065 to 068 | Before: permitted attachment control, Assigned Staff and Invoice Template selector are absent; tax/fees summary line is absent. After: add permitted file attachment in appropriate Create/Edit flow, responsible permitted firm staff, and firm-configured template selection. Display/calculate applicable configured taxes/fees, never a forced or hard-coded rate. Retest upload validation/linkage, staff permissions/persistence, line-item tax treatment and full totals. Approved expanded access: create/manage templates from both Invoices & Payments and Settings through one canonical library, with firm branding applied through it. Existing Templates navigation is not a configuration/output pass. | Permitted staff/files/templates; applicable firm tax/fee configuration. |
| RED
REQUIRED | Conditional invoice settings  IP 070 | Before: email notification, tipping and payment-before-due options are explicitly confirmed absent. After: add email-notification control and conditional tipping/payment-before-due options only where firm-enabled/configured and supported. Verify firm-setting inheritance, eligibility and output. Do not switch on notifications, tips, fees or payment requirements by default. | Firm enablement/configuration and supported payment rules. |
| RED
REQUIRED | Recurring creation option  IP 010 | Approved enhancement, not an original Create Invoice omission: add recurring on/off and frequency linked to the canonical recurring schedule workflow. Support requested weekly, biweekly, monthly, semiannual, annual and custom; preserve source semi-monthly, quarterly and firm-configured options. Semiannual is every six months; semi-monthly is twice monthly. Off retains a one-time invoice. Validate dates, end rule and linkage; recurrence does not itself authorize auto-send or client/gateway-authorized AutoPay. | Canonical recurrence workflow; no auto-send or AutoPay activation authorized. |
| Invoice states and contextual actions |
| RED
REQUIRED | Final due rules and separate Sent state  IP 025 031 to 032 045 | Before: due-today invoice shows Due Soon; Sent filter is empty despite the user’s belief invoices were dispatched. After: use Due Soon 7–2 days before due date, Due Tomorrow 1 day before, Due Today on the due date, and Overdue starting next midnight after 23:59:59 in firm timezone. Apply to open balances, excluding Paid/Canceled. Behavior earlier than seven days and other lifecycle combinations must not be invented. Add approved Due Today card/tab. These precise rules replace the original firm-defined window and all earlier 7–1/7–5 alternatives. | Open balances; firm timezone boundary fixtures. Approved precise due rules and Due Today addition. |
| RED
REQUIRED | Independent Sent state
IP-031–032 | Maintain an independent actual-dispatch Sent tag plus due/payment tag. Sent filter includes dispatched invoices even after Paid or Overdue; Scheduled is excluded until dispatch. Paid may display alone. Investigate actual send history rather than treating a Send click or Scheduled state as dispatch or delivery. Search by client/invoice and service, client, status and date filters passed by report except Sent. Preserve one shared invoice table across status filters. | Actual dispatch history, not Scheduled state or assumed email delivery. |
| RED
REQUIRED | Eligible edits and accessible badges  IP 023 027 | Before: Scheduled offers Duplicate/Cancel but no editing; Draft and Canceled share a badge color. After: allow Edit/Correct for eligible unpaid invoices, including Scheduled, within permissions and field restrictions. Extend Due Soon due dates and reschedule send dates on the same invoice ID. Sent-unpaid corrections require a reason/audit record and preserved history; do not unlock protected paid fields. Use distinct accessible badge colors plus readable text, not color alone. | Eligible unpaid invoice, role permissions, protected fields and audit checks. |
| RED
REQUIRED | Restore eligible row actions and reminder entry  IP 003 026 030 | Before: reviewed Due Soon/Scheduled/Canceled menus contain 7/6/5 actions respectively; Paid shows View Invoice, Duplicate, View Payments, View Client Profile and Send Message. These are presence observations, not proof of function. Preview Invoice, Download PDF, Add Note, Log Activity, Create Task, Schedule Follow-Up and View Client Portal are missing from reviewed menus. Add eligible access and the missing top Send Reminder entry. Invoice PDF access is a correction now, superseding the earlier not-located state; it is separate from report PDF export failure. | Status/payment/provider/permission eligibility. Invoice PDF differs from report export failure. |
| YELLOW
UNTESTED | Conditional source actions
IP-026 030 | Evaluate other source actions conditionally: Send/Resend, secure Copy Payment Link, standard/overdue reminders, Send Receipt, controlled Mark as Paid, Issue Refund, Void, Archive and elevated Delete. Gate every action by status, payment state, supported gateway and permissions; no identical-menu requirement. Mark as Paid needs confirmation/audit note; void/archive retain history; deletion needs elevated permission, confirmation and retention checks. | Source-action eligibility review, not confirmed missing implementation. Requires appropriate statuses, roles and provider capabilities. |
| RED
APPROVED | Full and partial refund clarification
IP-030 | Full and partial refunds are approved clarification, bounded by provider support, permissions and refundable amount, with preserved history. None has a processor execution pass. | Approved conditional requirement; no processor execution pass. Supported provider, permissions and refundable amount required. |
| RED
REQUIRED | Exact origin and invoice client context  IP 052 060 063 | Before: Reports/Templates lack Back to exact origin; Send Message opens general Messages and requires client re-selection. After: all off-module routes return to the exact originating context, retaining saved information, selected client/invoice, filters and applicable draft state without data loss. Preserve working general Reports navigation. Send Message opens/starts the correct invoice-client conversation with invoice context and origin return; it must not auto-send. Test each round trip; no message was sent. | Originating invoice/client/filters/draft fixtures. No message automatically sent. |
| Payment recording and firm settings |
| RED
REQUIRED | Receiving classification and receipts  IP 036 038 | Before: Deposit To and Send Receipt checkbox are absent. After: add permitted firm-configured account/bookkeeping category selection, save it with the payment and show it in details/history and recent payments. This is classification, not a transfer control. Add optional Send Receipt on Record Payment, configurable Automatic Receipts in Settings and permitted manual Send/Resend for completed/recorded payments. Trigger only after success; prevent duplicate sends across repeated events and overlapping automatic/manual options. No default-on instruction or delivery pass exists. Inline preview already satisfies preview presence; do not require a second button. | Configured destination; successful-payment receipt gating; separately authorized delivery tests. |
| RED
REQUIRED | Expose canonical firm billing settings  IP 041 to 044 | Before: Settings > Payments opens and Stripe/Square/PayPal cards are present, but inspected payment/payout controls are locked; Invoice Defaults, Reminders & Automations and Taxes & Fees are not visible. After: expose those sections, reusing canonical configuration if already stored elsewhere. Cover numbering prefix, terms/due date, memo, branding/template; reminders/overdue/receipts, auto-apply and supported retries; applicable configured taxes, late fees and optional tipping/payment-before-due. Do not duplicate settings stores or hard-code rules. | Reuse canonical firm settings; do not duplicate stores. |
| YELLOW
BLOCKED | Locked controls and settings
IP-041–042 | Explain each locked control’s unmet connection/setup/permission prerequisite and permit authorized firms to choose supported payment methods. Credit/debit appeared ON while ACH and PayPal Checkout were grayed; neither this nor provider-card presence proves connectivity. Do not automatically activate all methods/providers. General preferences, portal payments, Connected/Not Connected/Needs Attention status, Save Changes validation and Reset to Default confirmation behavior remain untested. | Identify connection/setup/permission prerequisite. Clear enablement guidance is required; no blanket backend defect established. |
| GREEN
PASS | Provider managed design
IP-043 | Accepted design: payout information and Manage Bank Account route users to Stripe Dashboard. No duplicate local bank editor is required. Instant Payout is conditional on Stripe-confirmed eligible debit cards/bank accounts. Navigation/information acceptance is not verified banking configuration, eligibility, transfer or end-to-end account-management behavior. | Information/design acceptance only, not banking configuration or funds movement. |
| YELLOW
CONFIRM | Firm owned collections
IP-061 | Developer confirmation required: each firm connects its own Stripe account and payout bank for its clients’ collections, separate from Firmivra platform Stripe for SaaS subscriptions. Verify tenant ownership, onboarding/routing and isolation of accounts, payments, payouts and credentials. This is an explicit architecture requirement, not an independently proven defect. No account connection or payout change is authorized by the review. | Developer architecture evidence and controlled multi-tenant test; no connection/payout change authorization. |
| RED
REQUIRED | Recurring and related tools access  IP 040 062 | Before: no Recurring Invoices route; no visible Client Statement, Payment Link Generator or View All Payments entry. After: expose appropriate required access, checking existing pages before assuming backend absence. Downstream behavior is blocked by missing access, not individually proven absent. Preserve actual Quick Links names: Create Invoice, Record Payment, Invoice Templates, Services & Pricing, Payment Reports. Payment Reports routes to general Reports; do not rename it Payment Records or infer report correctness. | Expose routes after checking existing pages; downstream functions blocked, not proven absent. |
| YELLOW
BLOCKED | Recurring downstream checks
IP-040 | Once recurring access exists, verify cards/tabs/table, schedule creation, generated invoices, upcoming sends, pause/resume with history, end/archive, canonical defaults/timezone and supported retry rules. Auto-send is configurable; AutoPay requires supported gateway plus client authorization. Send Now remains permission-gated. No schedule activation is authorized here. | Accessible route, canonical schedule/defaults, provider support/client authorization where needed. |
| Charts and reporting corrections |
| YELLOW
BLOCKED | Payment Status comparison
IP-047 | Payment Status All Invoices/This Year are identical because all test data is current-year; distinguishing them is blocked on prior-year data, not a defect. | Prior-year eligible test records to distinguish All Invoices from This Year. |
| RED
DIAGNOSE | Payment Methods no data
IP-050 | Payment Methods shows a gray dash/no data despite visible recorded payments; refresh was suggested but not confirmed. Diagnose date/filter/status/query scope and reconcile eligible completed/recorded nonvoid manual and gateway payments without assuming every ledger record qualifies. | Eligible nonvoid manual/gateway records, actual date/filter/status scope; cause unknown. |
| RED
APPROVED | Chart enhancements
IP-048–051 | Approved enhancements: Payment Status custom date range combined with status filter—Draft, Scheduled, actual-dispatch Sent, Partially Paid, Paid, Due Soon, Due Tomorrow, Due Today, Overdue, Canceled and All/reset. Invoice Activity gets January–December, This Year, Last Year and Custom Date Range; this latest request supersedes the earlier withdrawal. Acceptance clarification: label month year (default current year), validate start/end and apply firm timezone. Payment Methods gets Card/Cash/ACH dropdown. These controls are not original-source omissions or implemented/tested changes. | Implemented controls; representative dates/statuses/methods and firm timezone. |
| YELLOW
OPTIONAL | Method dropdown recommendation
IP-051 | Recommendation only: retain All and configured Check/Other when used. | Approval needed beyond explicit Card/Cash/ACH request; include actual relevant configured methods if adopted. |
| RED
DIAGNOSE | Empty Financial Report
IP-054 | Before: Total Payments/Total Amount, Revenue Summary Over Time (January–October) and By Group stay empty despite test payments, including after clearing filters and selecting current year. After: identify eligible records by date/status/scope, diagnose the discrepancy and reconcile totals/groups. Root cause remains unknown. | Reproduce cleared filters/current year; eligible payments and known query scope. |
| YELLOW
OPTIONAL | Group By recommendation
IP-054 | Recommendation only: replace ambiguous By Group with explicit Group By options such as service/client/method. | Not user-approved scope; decide before implementation. |
| RED
FIX | Financial Report PDF
IP-056 | Report PDF export was attempted: approximate error “Some details need fixing/check highlighted fields,” no highlighted field and no download. Fix valid populated and legitimate empty-state PDF exports; invalid inputs must be precisely highlighted/focused with actionable explanation and preserved input. Backend/export errors must not falsely blame validation. Other export formats are untested. Verify the spoken “XLR” label rather than silently certifying Excel output. | Populated/legitimate empty/invalid report fixtures. Other formats untested; verify “XLR” label. |
| RED
FIX | Saved Report retrieval
IP-057 | Before: Save Report named Invoice Review Test produced a success message, but no Saved Reports retrieval route was found on Reports landing. After: expose a saved-report list/Open action, checking canonical existing storage; verify configuration persistence and reopening across return/reload. A toast is not proof the report persisted. | Canonical saved storage and named Invoice Review Test; reopen/reload test. Toast alone is not persistence. |
| YELLOW
UNTESTED | Schedule dialog
IP-058 | Schedule dialog was inspected, not activated: name, frequency/day/time/date, lookback, PDF/XLSX/CSV, recipients/extra emails and in-app option; Schedule Report/Cancel only. User was told to cancel, but cancellation is unconfirmed; do not infer schedule creation, cancellation, execution or delivery. | No activation or delivery pass. Actual cancellation unconfirmed. |
| RED
REQUIRED | Schedule timezone display
IP-058 | Show effective firm timezone near the scheduled time and verify actual semantics; wrong backend timezone is not established. | Clarified display requirement; verify actual scheduling semantics separately. |
| YELLOW
OPTIONAL | Inactive schedule recommendation
IP-058 | Save Inactive/Draft is an optional recommendation, not mandatory approved scope. | Optional recommendation, not an original-guide requirement or approved mandatory omission. |
| YELLOW
UNTESTED | Report controls
IP-053 055 | Report presets cover Today, 7/30 days, this/last month, quarter and year, plus Custom; Custom accepts dates. Comparison None/Previous Period/Same Period Last Year, New/Active/Inactive client type, service and More Filters are present; possible Paid Date label is unconfirmed. Export CSV/“XLR”/PDF, Print, Save, Schedule, quick dates, Auto/Column/Line/Area and comparison/data-label toggles were visible. Filter combinations, comparisons, rendering/output, persistence and non-PDF exports remain unverified. [053, 055] | Control presence does not prove filtering, comparison, export or persistence. Custom date input pass is green above. |
| Developer verification and exact retest prerequisites |
| YELLOW
PENDING | Retest approach | Implement and demonstrate corrections before asking the user to repeat known failures. Do not repeat established reference, cancel or void checks merely to refill the checklist. Remaining acceptance work needs the prerequisites below; no whole module is passed. | No whole module is accepted; do not repeat narrow established passes unnecessarily. |
| YELLOW
UNTESTED | Configured catalog and invoice outputs | Verify full catalog availability for multiple clients, custom-item non-persistence to catalog, numbering uniqueness/permissions, required client/dates, date/terms relationships, rounding/tax treatment and every summary amount. Check draft/edit/duplicate reload persistence, new duplicate ID and unchanged original; verify client-visible output and internal-note exclusion across preview, invoice PDF, email and portal. Branding needs live evidence plus developer confirmation. [005–021, 065–070] | Prerequisites: available permitted services/subservices, a firm template/logo, staff, attachment rules, enabled payment methods and applicable tax/fee/terms settings; implemented missing controls. |
| YELLOW
UNTESTED | Representative payment and time boundary data | Reconcile KPIs/charts/reports/ledger against the same eligible nonvoid records; exercise combined filters and dates. Verify Due Soon 7/2 days, Due Tomorrow 1, Due Today and next-midnight transitions; distinguish scheduling, dispatch and later payment states. Test report exports with populated/empty/invalid cases and saved report reopening. [025, 031–032, 045–057] | Prerequisites: authorized test invoices/payments across current/prior years, methods, eligible statuses and timezone boundaries; implemented charts/reports and routes. |
| YELLOW
UNTESTED | Validation history and permission evidence | Check server-side zero/negative/overpayment and required-field rules, payment date editing, full selected-invoice/payment summaries and recent-payment date/amount/method/reference/destination/note/recorder. Verify void reason/actor/timestamp and history, adjustments/refunds, restricted edits and controlled Mark as Paid. Confirm Canceled versus source Voided semantics rather than equating them from labels. [022, 026–039, 064] | Prerequisites: controlled test fixtures, distinct owner/staff/client roles, audit access and retention policy. |
| YELLOW
UNTESTED | Routes recurring configuration and external execution | Verify schedule lifecycle/history, statement balances/date range, secure invoice or permitted standalone payment links, and complete ledger/refund fields. Diagnose locked controls using explicit prerequisite messaging. Save/reset and optional settings require authorized test configuration. Actual sends, receipts/resends, reminders, recurring runs, refunds, processor movement and payouts require separate authorization and controlled recipients/accounts; presence or manual records cannot substitute. [003, 010, 030, 038, 040–044, 058, 062] | Prerequisites: restored Recurring/Statement/Payment Link/View All Payments routes; canonical recurrence/template defaults; authorized connected provider and eligible test payment method/client authorization where needed. |
| YELLOW
UNTESTED | Security isolation notifications and visual consistency | Verify own-firm collection routing versus platform SaaS billing; owner/staff assignment access, client-only portal data, tenant isolation, secure tokenization and no full card credentials/secrets in storage/logs. Audit create/edit/send/view where supported, payment/reminder/refund/status/void/archive/delete with actor/time. Test configured sent/reminder/overdue/payment/receipt/refund/failed-payment/recurring notifications only with authorization. Check consistent sidebar/active state, approved blue/navy UI, dark readable text, soft card separation and no hard-coded services/prices/staff/gateways/templates/reminders/tax rules. These were not established by an owner walkthrough. [061; source sections 1, 10, 12] | Prerequisites: developer integration/log evidence and a controlled multi-tenant, multi-role test environment. |
| All twelve source sections covered |
| YELLOW
COVERAGE | 1  Workspace sidebar | Full consistency inventory untested; verify common sidebar and active state. | Unverified or waived as stated; no defect inferred solely from lack of testing. |
| YELLOW
COVERAGE | 2  Main page | Header/actions/KPIs and narrow chart response reviewed; reminder, due card, chart corrections/enhancements; reconciliation pending. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 3  Status tabs | Search/filters narrowly successful except Sent; final due boundaries and independent dispatch state govern retest. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 4  Create Invoice | Manual entry/discount/draft/edit/date/duplicate narrow passes; catalog, output and missing fields/settings require correction; setup-dependent checks remain. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 5  Record Payment | Context, partial amounts/status, references, negative input, inline preview and retained void narrow passes; destination/receipt fixes; validation/audit/delivery pending. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 6  Recurring Invoices | Required entry absent; all downstream schedule features blocked, not separately proven absent. Creation toggle is an enhancement. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 7  Payment Settings | Navigation and provider-managed Stripe design accepted; firm billing sections missing; locks need prerequisite clarity; configuration/integration untested. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 8  Row actions | Status-specific presence, duplicate/cancel/profile/payments reviewed; eligible actions, editing and message context corrections; protected actions untested. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 9  Related billing tools | Three missing tool routes; template route passes only. Reports no-data/PDF/retrieval/origin fixes; outputs and schedule execution pending. | Mixed outcomes: consult individual green/red/yellow rows. Not a whole-section pass. |
| YELLOW
COVERAGE | 10  Security and audit | Developer/role/tenant/tokenization/notification evidence required. Retained canceled payment is not a complete audit pass. | Unverified or waived as stated; no defect inferred solely from lack of testing. |
| YELLOW
COVERAGE | 11  Visual references | User waived mockup comparison; images were not independently inspected. No defect inferred. | Unverified or waived as stated; no defect inferred solely from lack of testing. |
| YELLOW
COVERAGE | 12  Final developer notes | Canonical catalog/templates/settings and provider gating preserved; broad visual consistency/no-hard-coding checks unverified. | Unverified or waived as stated; no defect inferred solely from lack of testing. |
| INFO | Handoff boundary | This package documents requested work and bounded evidence only. It does not implement changes, authorize activation or financial/email actions, certify release readiness, or send anything to a developer. Retest owners should record actual results against each grouped correction and prerequisite before claiming acceptance. | Same review content reformatted into color-coded tables; no original-guide appendix. |

