# Octavia's reviews of Invoices & Payments and Messages (Oct 27): change list

Sources, in this folder: `invoices-payments--developer-review.md` (findings IP-001 to IP-070, walkthrough of Oct 26) and `messages--developer-review.md` (findings MSG-001 to MSG-082, Oct 27). Both are narrow user-reported checks, not full acceptance. Green rows below are kept as they are; red rows are the work.

Rules for every item: match her design and wording, no placeholder or debug text, one canonical source for services, templates, settings and contacts (no second copy), tenant-scoped, audited, and a test for each fix. Where a row says "check first", look at what main already has before building.

Reuse the shared pieces from the Oct 26 list instead of building them again: `OriginLink` and the Back bar (SH1), the shared `ActionMenu` (SH2), in-place Request/Upload (SH3), prefilled Create Task (SH4), Messages client scope and `NewMessageDialog` (SH5), prefilled Schedule Appointment (SH6).

## Decisions taken for her (reversible; show at review, never ask her)

- D1. Payment Methods chart dropdown: All, Card, Cash, ACH, plus Check and Other when the firm uses them (her recommendation, adopted).
- D2. Financial Report "By Group" is renamed "Group By" with Service, Client, Payment Method (her recommendation, adopted).
- D3. Report schedule keeps Save Inactive out of scope (optional only).
- D4. Invoice Template library is one canonical library, reachable from Invoices & Payments and from Settings, with the firm's branding.
- D5. Recurring on Create Invoice links to the existing recurring schedule workflow; turning it on never turns on auto-send or AutoPay.
- D6. Messages Documents tab stays as an extra view; conversation list stays newest first.
- D7. No inline Edit in the Messages contact panel: Open Client is the route, with Back to the same thread.
- D8. A potential "Read" label is shown only for channels that report it; nothing is invented.
- D9. Nothing in either module sends, charges, calls or books anything on its own; tests use controlled recipients only.

## A. Invoices & Payments (IP-F01 to IP-F27)

### A1. Create Invoice

| ID | Source | Change | Check first |
| --- | --- | --- | --- |
| IP-F01 | IP-005, 008, 069 | Service choices show every permitted firm Services & Pricing offering for any client, not only the client's assigned ones; picking one fills the line's details and price. Keep category filter; highlight assigned services without hiding others. One-time custom items stay possible and never create a permanent service. Missing offerings are added in Services & Pricing. | Compare with the actual catalog before blaming a cause. Subservices need configured services to retest. |
| IP-F02 | IP-015 to 019 | Add Preview Invoice (client-facing, no status change), payment terms (Due on Receipt, Net 7, Net 14, Net 30, firm-configured terms), Notes to Client and an Internal Note. The internal note never appears in the client PDF, email or portal. | Branding and logo are unverified, not known missing. |
| IP-F03 | IP-065 to 068 | Add a file attachment control, Assigned Staff (permitted staff), an Invoice Template selector, and a taxes and fees line in the summary from the firm's configured taxes and fees (never a fixed rate). | Upload validation and linkage, staff permissions, tax treatment per line. |
| IP-F04 | IP-070 | Add the email-notification control and the tipping and payment-before-due options, each only where the firm enabled it in Settings. Nothing is on by default. | Firm setting inheritance. |
| IP-F05 | IP-010 | Recurring on/off with frequency: weekly, biweekly, semi-monthly (twice a month), monthly, quarterly, semiannual (every six months), annual, custom, plus firm-configured options. Off keeps a one-time invoice. Validate dates and end rule. | Uses the canonical recurring schedule (IP-F18). |

### A2. States and row actions

| ID | Source | Change |
| --- | --- | --- |
| IP-F06 | IP-025, 031, 032, 045 | Due rules in the firm's timezone, on open balances only (not Paid or Canceled): Due Soon 7 to 2 days before the due date, Due Tomorrow 1 day before, Due Today on the due date, Overdue from the next midnight after 23:59:59. Add the Due Today card and tab. Nothing is invented for earlier than 7 days. |
| IP-F07 | IP-031, 032 | An independent Sent tag set only by an actual dispatch, next to the due or payment tag. The Sent filter lists dispatched invoices even when Paid or Overdue; Scheduled is excluded until dispatch. Check the real send history: a Send click or Scheduled state is not a dispatch. One shared table across status filters. |
| IP-F08 | IP-023, 027 | Edit/Correct for eligible unpaid invoices, including Scheduled, within role and field limits: extend a Due Soon due date, reschedule a send date, same invoice ID. A corrected Sent-unpaid invoice needs a reason and an audit entry with history. Paid fields stay locked. Draft and Canceled badges get distinct colors with readable text. |
| IP-F09 | IP-003, 026, 030 | Row menu adds, where eligible: Preview Invoice, Download PDF, Add Note, Log Activity, Create Task, Schedule Follow-Up, View Client Portal. Add the Send Reminder entry at the top. Invoice PDF is separate from the report PDF failure (IP-F23). |
| IP-F10 | IP-026, 030 | Conditional actions by status, payment state, provider and permission: Send/Resend, secure Copy Payment Link, reminders, Send Receipt, controlled Mark as Paid (confirmation and audit note), Issue Refund (full and partial, within provider support and refundable amount, history kept), Void and Archive (history kept), Delete (elevated permission, confirmation, retention). No identical-menu requirement. |
| IP-F11 | IP-052, 060, 063 | Reports and Templates get a Back to the exact origin with filters, selected client or invoice and draft state kept. Send Message opens the invoice client's conversation with the invoice as context (SH5's scoped Messages, `NewMessageDialog`), returns to the origin, and never sends by itself. |

### A3. Payments and settings

| ID | Source | Change |
| --- | --- | --- |
| IP-F12 | IP-036, 038 | Record Payment gets Deposit To (a firm-configured account or bookkeeping category; classification only, not a transfer), shown in the payment details, history and recent payments. Add an optional Send Receipt, Automatic Receipts in Settings, and manual Send/Resend for completed payments. A receipt goes out only after success, never twice; nothing is on by default. |
| IP-F13 | IP-041 to 044 | Settings > Payments exposes Invoice Defaults (numbering prefix, terms, memo, branding and template), Reminders & Automations (reminders, overdue, receipts, auto-apply, supported retries) and Taxes & Fees (taxes, late fees, tipping, payment-before-due). Reuse the canonical settings where stored; no second store, nothing hard-coded. |
| IP-F14 | IP-041, 042 | Each locked control says which connection, setup or permission it needs. Firms choose supported payment methods; nothing turns on for all providers. Test Save Changes validation, Reset to Default confirmation, and the Connected / Not Connected / Needs Attention states. |
| IP-F15 | IP-043 | Accepted as designed: payout information and Manage Bank Account go to the Stripe Dashboard; no local bank editor. Instant Payout only where Stripe confirms eligibility. |
| IP-F16 | IP-061 | Confirm and show evidence that each firm collects into its own Stripe account and bank, apart from Firmivra's platform Stripe; tenant isolation of accounts, payments, payouts and credentials. No account or payout change here. |
| IP-F17 | IP-040, 062 | Add routes for Recurring Invoices, Client Statement, Payment Link Generator and View All Payments (check existing pages first). Quick Links keep their names: Create Invoice, Record Payment, Invoice Templates, Services & Pricing, Payment Reports (which opens general Reports). |
| IP-F18 | IP-040 | Once Recurring is reachable: cards, tabs, table, schedule creation, generated invoices, upcoming sends, pause and resume with history, end or archive, canonical defaults and timezone, retry rules. Auto-send is configurable; AutoPay needs a supported provider and client authorization. Send Now is permission-gated. Nothing is activated by the build. |

### A4. Charts and reports

| ID | Source | Change |
| --- | --- | --- |
| IP-F19 | IP-047 | Payment Status All Invoices versus This Year are the same only because all test data is this year. Needs prior-year test data; not a defect. |
| IP-F20 | IP-050 | Payment Methods shows no data despite recorded payments: diagnose the date, filter, status and query scope and reconcile completed and recorded non-void manual and gateway payments. Cause unknown. |
| IP-F21 | IP-048 to 051, D1 | Payment Status: custom date range combined with the status filter (Draft, Scheduled, Sent, Partially Paid, Paid, Due Soon, Due Tomorrow, Due Today, Overdue, Canceled, All/reset). Invoice Activity: January to December, This Year, Last Year, Custom Date Range, labeled month and year (default this year), validated, in the firm timezone. Payment Methods: the dropdown from D1. |
| IP-F22 | IP-054 | Financial Report is empty (Total Payments, Total Amount, Revenue Summary Over Time, By Group) even after clearing filters and picking this year: find the eligible records, diagnose and reconcile. Rename By Group per D2. |
| IP-F23 | IP-056 | Report PDF export fails with "Some details need fixing" and no download. Fix a populated and an empty-state PDF. Invalid input is highlighted and focused with an explanation and kept; a backend or export error never blames validation. Other formats are untested; verify the "XLR" label means Excel (XLSX). |
| IP-F24 | IP-057 | Save Report shows success but no Saved Reports list exists. Add a list with Open, check the canonical storage, and prove the report persists across return and reload ("Invoice Review Test"). |
| IP-F25 | IP-058 | Show the firm timezone beside the scheduled time and verify the real semantics. The Schedule dialog was inspected, not activated; no schedule, cancel, run or delivery is claimed. |
| IP-F26 | IP-053, 055 | Report controls are only seen, not proven: presets, Custom dates, comparison, client type, service, More Filters, Export CSV/XLSX/PDF, Print, chart types and toggles. Retest filters, comparison, output and persistence. |
| IP-F27 | IP-045, 046, 059 | Retest with representative data: KPIs, charts, reports and ledger against the same eligible non-void records; timezone boundary fixtures for the due rules. |

### A5. Kept as they are (green, narrow)

Navigation and the four top actions; manual items, multiple items and both discount types; Save Draft, Edit Draft, three separate dates; Duplicate (dates cleared) and Cancel with a reason; future Send gives Scheduled; manual payment, partial payment, conditional references, negative input blocked, inline receipt; Void with a reason and balance restored; five KPIs; search by client and invoice number and the service, client, status and date filters (except Sent); accepted Stripe-managed payout design.

## B. Messages (MSG-F01 to MSG-F24)

| ID | Source | Change |
| --- | --- | --- |
| MSG-F01 | MSG-081, 082 | Search finds a conversation by a full email and by a full phone number (normalized), over permitted contacts and conversations. Retest the reported inputs, then the format variants. Business and lead-name search stay to test. |
| MSG-F02 | MSG-002 | A Messages Settings button in the header, routed to message-specific settings (channels, signatures, notification types, receipts, retention, attachment limits, consent and suppression). |
| MSG-F03 | MSG-018 | Add the Clients, Leads, Automations and Archived tabs on the same conversation data, within permitted scope. Documents stays. |
| MSG-F04 | MSG-025 | Send Bulk Message and Message Templates use the blue secondary-action style, readable, gold New Message unchanged. |
| MSG-F05 | MSG-032 | A Filter button beside Search, with filter state and a clear action. |
| MSG-F06 | MSG-059 | Send Bulk Message opens a working Messages bulk audience builder (Audience, Message, Review, Send) with Messages context kept; today it opens general Communications. Audience filters, counts and safeguards (MSG sections 15 to 17) follow once it is reachable: Clients/Leads/Both, services, status, entity, state, tags, staff, last contact, dates, consent, portal access; Total, Can Receive, Cannot Receive with safe reasons; suppression, dedupe, preview, high-volume confirmation, throttling, idempotent sends, failed-only retry. |
| MSG-F07 | MSG-060 | Message Templates opens the shared Templates library filtered to message templates, with a return to Messages. |
| MSG-F08 | MSG-005, 011, 076 | Back to Messages from Templates, Bulk and Open Client, restoring the selected thread, list, filters and search (use the SH1 origin Back). |
| MSG-F09 | MSG-040, 065 | New Message: choose Clients, Leads or Both, multi-select, a recipient count and Clear All, within permitted scope. |
| MSG-F10 | MSG-041, 021 | New Message channel selector (Email, SMS, In-App) showing only configured eligible channels with the reason when unavailable; show the channel on each message in the thread. SMS needs a mobile, a provider and consent. |
| MSG-F11 | MSG-042, 063 | New Message and reply get a template option and emoji; templates respect channel, category and service and stay editable after use. |
| MSG-F12 | MSG-043, 022 | Attachments on New Message and reply, permission and channel aware, with type and size checks and secure access. |
| MSG-F13 | MSG-044 | A Related To field on New Message: appointment, invoice or payment, return, document request, task, service. |
| MSG-F14 | MSG-045, 066 | Save Draft (reopens with recipients, channel and content kept) and Schedule with date and time, firm timezone shown, editable and cancelable before dispatch. |
| MSG-F15 | MSG-067, 070 | A Merge Field insert button and a Review step before Send: recipients, eligibility, channel, subject, body, attachments, resolved merge fields per recipient, timing, warnings. Unresolved fields block or warn. |
| MSG-F16 | MSG-068, 069 | Assign Staff and Add to Client Timeline on New Message, with permitted staff and the canonical history link. |
| MSG-F17 | MSG-064 | Show Sent, Delivered, Read and Failed where the channel reports them, with safe error text (D8). |
| MSG-F18 | MSG-033 | Recent Activity in the contact panel: permitted appointments, messages, forms, invoices, documents and more, with links. |
| MSG-F19 | MSG-056, 057 | Tags and Assigned Staff in the contact panel, with a clear empty state. Nothing invented. |
| MSG-F20 | MSG-051 | Schedule from the contact panel opens the appointment workflow with the client preselected (SH6) and Back to the thread. |
| MSG-F21 | MSG-028 | An appointment's Send Message opens the composer with the client chosen and the appointment in Related To. |
| MSG-F22 | MSG-035, 036 | A three-dot Thread Actions menu beside the selected client card: View Profile, Mark Read/Unread, Assign/Reassign Staff, Tags, Create Task (SH4 prefill), Schedule Appointment (SH6 prefill), Mute/Unmute (messages still arrive; internal alerts only), Archive/Restore (history kept). |
| MSG-F23 | MSG-053 | Text/SMS quick action only where the channel is configured, the role allows it and consent exists; otherwise hidden or disabled with the reason. |
| MSG-F24 | sections 6, 10, 22 | Evidence rows (not UI work): server-enforced permissions and tenant isolation, internal-note privacy, secure attachments, exports, audit of send, schedule, cancel, assignment, archive and settings changes. |

### B1. Kept as they are (green, narrow)

Search by client name and message word with clear; sender and time in the list and history; the contact panel items; gold New Message and blue active tabs; Invoices and Documents tabs share the layout; New Message modal fields, client selector, combined-empty Send disabled; oldest-first history with a stable reply box; Add Note saves inline and persists; Call opens the OS handler; Email prefills; Escape closes without sending; narrow layout; Open Client goes to the right Overview; two-thread switching.

### B2. Blocked, needs fixtures or the controls above

Unread dot and counts; Appointments, Invoices and Documents tab memberships; action cards (Book Appointment, Pay Invoice, Upload Documents); compose review, draft and schedule behavior; bulk flow; Messages settings; deep Communications and Templates review (user deferred); visual comparison with three reference frames (images not supplied).

## C. Schema needs (each needs Rasel's tap before R1 builds it; do not invent a column)

Check what exists first. Likely needs:

- Invoices: `assigned_staff` on invoices, invoice attachments, internal vs client notes, `deposit_to` on payments, an invoice dispatch history (the independent Sent state), a canonical invoice template library, saved reports, optional report schedule timezone.
- Messages: message drafts and scheduled messages, thread tags, thread assigned staff, mute and archive state per member, related-record links, add-to-timeline flag, delivery state per message and channel.

## D. Routing

| Area | Owner | Notes |
| --- | --- | --- |
| Invoices & Payments (A) | a fresh session | Large; start with IP-F06 to F09 and F17, then F01 to F05, F12, F13. Diagnosis items IP-F20, F22, F23, F24 are first because they may be bugs in existing code. |
| Messages (B) | R60 after Tax Returns, or a fresh session | Start with MSG-F01 to F08 (entry points), then F09 to F16 (compose), then F18 to F22 (contact panel and thread menu). |
| Schema (C) | R1, one table per tap | Only after the first screens show which columns are really missing. |

## E. Not in this list

Her daily revisions arriving later; the Firmivra public site; the earlier Oct 24 to 26 lists, which stay open.
