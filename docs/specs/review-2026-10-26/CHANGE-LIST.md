# Octavia's review of Oct 25, 2026: Tax Returns, Payroll and Bookkeeping (change list)

Source: three Drive folders she shared on Oct 25 (guides are in this folder as text converted from her .docx, tables flattened):

- `tax-returns--developer-review.md` (Tax Returns, "First review", P01-P17, F01-F36, tests, decisions, then her original 24-section guide as Appendix A)
- `payroll--developer-review.md` (Payroll, S01-S15, F01-F13, B01-B04)
- `bookkeeping--developer-review.md` (Bookkeeping, P01-P09, I01-I03, D01-D07, navigation contract, T01, R01, E01, A01, open decisions, then both original guides as appendices)
- Screenshots (Tax Returns): `screenshots/tax-returns-1-client-portal-route.png` (F04), `-2-client-details-overlap.png` (F01), `-3-row-menu-clipped.png` (F02), `-4-new-menu-reference.png` (the working "+ New" menu she wants the row menu to behave like).

All three modules already exist on main (Tax Returns `R55-tax-returns.md`, Payroll `R56-payroll.md`, Bookkeeping `R56-bookkeeping.md` in `docs/work/`). This is a fix and addition round plus the missing Bookkeeping workspaces, not a new module build.

How to read it (same rules as `docs/specs/review-2026-10-25/CHANGE-LIST.md`):

- **P1**: a defect she hit (wrong route, lost context, data not saving, overlap). Do first. **P2**: a changed rule or missing control. **P3**: a new or bigger flow.
- "Check" means the session first looks at main and dev: her guides were written against an older dev build.
- **PASS / SUCCESSFUL** items are provisional: do not break or rework them. **PENDING, BLOCKED, NEEDS VERIFICATION** items are tests for the session (Pass, Fail or Blocked, with evidence in the PR), not defects. **CLARIFY** items need a decision: use the safer existing boundary, say which in the PR, do not invent policy. **APPROVED** means she asked for it; it is not a claim that it is built.
- Design completeness rule applies: complete screens, honest empty states, no fake numbers, no placeholder or debug text. Names, IDs and dummy company numbers in her guides (client "Peter", "Stacy Jackson", a dummy QuickBooks company) are test data: never seed them.
- Anything that changes `packages/db` needs Rasel's own tap; anything that changes auth guards or role checks needs his word as well. Say so in the PR and in the reply instead of doing it.

Priority now (Rasel, Oct 25): Octavia's focus is the **firm workspace and the client portal**. All of this must be done before Oct 28. Order of work: (1) finish the items already in flight from the Oct 25 review (Client Sign-ups, Clients E1-E10, Advisory B3-B12, Edit Draft); (2) the **shared fixes SH1-SH10 once**, because the same defect appears in all three modules; (3) the module-only P1 items; (4) the larger builds (Bookkeeping Transactions, Reconciliation, Terms) last.

## A. Shared fixes (build once, then wire into Tax Returns, Payroll and Bookkeeping)

These come from every one of the three reviews. A session that builds the shared piece fixes all three modules in the same PR or in one follow-up, instead of three separate versions.

| # | Change | Where she hit it | Prio |
|---|---|---|---|
| SH1 | **Exact-origin Back or breadcrumb.** Every route out of a service workspace (Documents, Tasks, Messages, Appointments, Integrations, FirmSign, Client Portal, Compliance, Templates) returns to the exact list, client, tab, filters, search, period and scroll it came from, never the generic module home. Unsaved-work guard where a form was open. A client or id changed in the URL must not reach a disallowed client. | BK navigation contract; PY F10; TX F03, F07 | P1 |
| SH2 | **Row-action menu clipped inside the scroll area** (and the **double dropdown arrow** on More Actions). Render the anchored menu outside the clipping container (portal), keep it inside the viewport, scroll inside the menu if needed, keyboard navigation, focus and Escape dismissal kept. One accessible arrow only. Behave like the working "+ New" menu. | PY F07, F08; TX F02 (screenshot 3, 4) | P1 |
| SH3 | **In-place Request Documents and Upload.** The shared Create Request and Upload modal or panel opens inside the current service tab or client Overview, prefilled with client/business, service (Bookkeeping, Payroll, Tax Returns) and known period or tax year; Save, Cancel and close stay on the current tab. One canonical record shared with Documents, the client profile, the service and the firm-side Client Portal view. The unscoped main-page Request Documents opening All Requests stays as is (PY S08). A request is not an uploaded file. | BK request/documents; PY F02, F03, F12 dep.; TX F08, F09, F10 | P1 |
| SH4 | **Create Task prefilled** with client, service and period (opens canonical Tasks, exact-origin Back). On service Overview task lists: inline **status dropdown** with the configured statuses and permissions, and the canonical **task action menu** (View, Edit, Mark as In Progress, Mark Complete, Reassign, Change Due Date, Change Priority, Duplicate, Convert to Recurring, Save as Template, Cancel Task, Archive Task) using the shared dialogs in context. No new recurrence engine. | BK Tasks; PY F04; TX F13, F14, F15 | P1 |
| SH5 | **Messages scoped to the client.** Open Messages / Send Message opens that client's conversation with service context, not all messages. Main Messages gets a manual client selector or filter, preselected when entered from a service. Add the **in-place composer** from the return Overview (TX F05). Nothing is sent just to test navigation. | BK Communications; PY F05; TX F05 | P1 |
| SH6 | **Schedule Appointment prefilled** with client and service context through the shared appointment creation (panel in the Overview for Tax Returns; destination with Back elsewhere). Cancel returns without creating anything. | PY F11; TX F06 | P1 |
| SH7 | **Honest connection versus sync state.** Never show "Connected" or "Provider connected" for a dummy company or test ID. Separate connection health from sync-job state, label demo or pending setup clearly, and show Last Sync and Last Attempt only from real events. Keep the last successful data on a failed sync and show the latest failure separately. Authorize, select company, map client, confirm, sync flow stays. | BK I01-I03; PY F01 | P1 |
| SH8 | **Clickable status and KPI cohort filters** on the same permitted client list: visible selection, working clear and reset, current period kept, counts reconcile. | BK D01, D02; PY F06 | P2 |
| SH9 | **Plan / Service dropdown** populated from Services & Pricing by stable id (no second catalog, no free text, no charge or invoice on selection). Distinguish "no configured plans" from loading or access errors. | BK D07; PY F12 | P2 |
| SH10 | **Pause service with a separate Stop Future Billing control** (default stop date = next billing date, custom date allowed), permission, confirmation and audit; pause stays separate from billing stop and from provider payroll. | PY F13 (and BK pause) | P2 |

## B. Tax Returns (guide: `tax-returns--developer-review.md`)

Her IDs F01-F36 are kept. Passes P01-P17 are preserved (create and filter, Q1-Q4 selector, checklists and notes, manual filing record, closed lock, amend, duplicate, archive, edit, assign, reports, links, import routes).

| # | Change | Prio |
|---|---|---|
| TX-F01 | **Client Details overlaps the Document Checklist card** (long email and address run behind it). Wrap long content, fix card sizing and spacing at supported widths (screenshot 2). | P1 |
| TX-F02 | Row menu clipped: see SH2. | P1 |
| TX-F03 | Contextual Back: see SH1 (existing Back to Returns already passes). | P1 |
| TX-F04 | **Client Portal** opens Clients (screenshot 1 shows the "on its way" placeholder). Open the firm-side Client Portal scoped to the same client and the permitted return content, with a return path. Do not impersonate the client or expose staff-only material. Depends on the portal module. | P1 |
| TX-F05, F06 | In-place composer and appointment panel: see SH5, SH6. | P1 |
| TX-F07 | Row-menu Request Client Information may open Documents or Messages, Send Message and Schedule Appointment may use their destination, all with client/return context and Back. Edit Client Details may open the canonical client editor with Back and an unsaved-change guard. FirmSign keeps its destination with a breadcrumb that restores the E-Signature tab. | P2 |
| TX-F08, F09, F10 | Upload and Request open in place, one canonical record, client Documents and each service workspace get the same Upload action: see SH3. | P1 |
| TX-F11 | **Intake Form card** in Intake & Documents, linked to the client and this return's year or quarter (never a hard-coded 2025): open all submitted details, Request Correction to the client, truthful empty state, Back restores the return. Intake is never silently turned into an uploaded file. | P1 |
| TX-F12 | Link Document is BLOCKED by the empty-document dependency (dummy client has no files). Fix the upload and type dependencies first, then verify selection, role, jurisdiction, save and retrieval. Keep the existing roles (Draft, Signature Form, Filed Return, Acknowledgement, Voucher, Payment Proof, Extension). | P2 |
| TX-F13-F15 | Inline task status, task action menu and in-context dialogs: see SH4. | P2 |
| TX-F16, F17 | CLARIFY: tax-year correction path (only Return Type, Filing Status and Due Date are editable today). Provide or identify an authorized correction path with duplicate and filed-history safeguards; do not relabel a filed record. Assign/Reassign and Notes satisfy their own editing paths. Ask Rasel which lifecycle states allow it. | P3 |
| TX-F18 | **Assignment authority**: only the assigned reviewer may Approve or Return to Preparer, except an Owner/Admin with the configured override; reassignment transfers eligibility. Hide or disable the control and enforce on the server; retain actor, reassignment and override history; same check on assignment-sensitive task and schedule changes. **Touches role checks: Rasel's word first.** | P2 |
| TX-F19 | Add Approval Step must let the reviewer create or link a **validation issue** (note, severity, responsible person, return/version) when returning to the preparer. | P2 |
| TX-F20 | Severity meaning: **Error** blocks Ready to File and transmission; **Manual Warning** is review-needed but nonblocking; **Info** nonblocking. This supersedes the original configurable blocking option. A manual "Valid" label must never erase an unresolved blocker or claim provider/IRS validation (F21 stays CLARIFY). | P2 |
| TX-F22 | **Move to Rejected** changes status with no dialog: collect or link a valid acknowledgment first (agency or jurisdiction, rejection code and description, timestamp, corrective action). F23 (refresh persistence, prior attempt history) is a test; F24 (keep the rejected attempt, corrective task and owner, retransmit as a new attempt id and time) is an original requirement still to verify. | P1 |
| TX-F25 | **Filing method**: E-Filed or Mail for the return and each jurisdiction when they differ; mailed returns are never labelled electronically transmitted. | P2 |
| TX-F26 | **Mail Tracking Number** required before logging Mailed or closing a paper filing. No untracked exception. Mailed date and evidence controls: confirm detail. | P2 |
| TX-F27 | **Mailing Report** in the main Quick Actions (returns sent by mail, tracking and status; not a marketing list). Columns and export need her specification: propose in the PR. | P3 |
| TX-F28, F29 | **Manual amount entry** for refund or amount due by jurisdiction from the external software result (explicit Refund / Amount Due choice with amount, not signed numbers), source and version, estimate label, audit. Multi-state summary, save and refresh to verify. | P1 |
| TX-F30 | Manual recordkeeping stays separate from real Transmit (separate permission and confirmation; test ids are not provider proof). Tracking proves neither delivery nor acceptance. | P3 |
| TX-F31, F32 | **Business Tax create** shows Personal-style fields: add Business Name, Business EIN (masked) and Business Address, populated from the selected client's canonical business record (not matched by name), keep states, preparer, reviewer, due date; historical snapshot rule to propose. | P1 |
| TX-F33 | Quarterly selector Q1-Q4 preserved (pass limited); period due dates, amounts, vouchers and statuses are pending tests. | P3 |
| TX-F34, F35 | **Archived filter or view** so archived returns can be found and **restored** (restore is untested), history kept, filing statuses kept separate from archived visibility. | P1 |
| TX-F36 | CLARIFY: renaming, hiding and adding preset service choices belongs to a service-tab management location not yet defined. Do not expand scope. | P3 |

Tests and decisions (Parts 9 and 10 of her guide): FirmSign review, Imports (blocked until an integration exists), review gates, filing history, paper and amounts, other periods, extensions, search and reporting, communications, security and roles, history, UI resilience, configuration. Decision list for Rasel to relay: status mapping among overview statuses, workflow stages, jurisdiction outcomes, Closed and Archived; tax-year correction restrictions; manual-amount fields; review issue resolution controls; Mailing Report fields; intake empty-state route; service-label configuration. Delete is not present and is not a defect: do not add it.

## C. Payroll (guide: `payroll--developer-review.md`)

Passes S01-S15 are preserved (reminder setting, internal note, staff assignment, manual status, Log Activity, report and run routes, tab context, main Request Documents, Manage Integrations navigation, employee and contractor forms, frequency choices, report form, overview and list controls, archive dialog wording, Escape on More Actions). No real provider authorization, payroll calculation or submission, tax filing, payment, pause, archive or billing change was validated.

| # | Change | Prio |
|---|---|---|
| PY-F01 | Connection and sync state: see SH7 (Connect said "Provider connected", Gusto Sync Details showed Connected, Not Connected, Never, Never). | P1 |
| PY-F02 | Client Overview **Request Documents** opened general Documents and lost the client: see SH3. The main Payroll to All Requests route is accepted and must not require a selected client. | P1 |
| PY-F03 | Client document upload: Overview Upload lands on the client-profile Documents where no Upload control was reported. Provide the working canonical upload path (in-place popup preferred, exact-origin Back otherwise): see SH3. | P1 |
| PY-F04 | Create Task context: see SH4. | P1 |
| PY-F05 | Messages scope and manual client selector: see SH5. | P1 |
| PY-F06 | **Payroll Status links**: On Track, Processing, Action Required, Past Due, Not Started and On Hold link to the filtered client list, reporting period kept. Not every KPI card has to be a link. | P2 |
| PY-F07, F08 | Clipped row menu and the double arrow: see SH2. | P1 |
| PY-F09 | **Payroll Runs empty state**: run-list structure with headings and controls (run id and period, pay date and frequency, worker count, confirmed totals, Firmivra status, provider status where needed, actions), clear empty state, no fake zero totals, completed history immutable. The five-stage Run Payroll workflow is not shown to be missing. | P1 |
| PY-F10 | **Manage Integrations** needs a Back or breadcrumb to the exact Payroll list or client context: see SH1. | P1 |
| PY-F11 | Schedule Appointment prefill: see SH6. | P1 |
| PY-F12 | Plan or Service dropdown from Services & Pricing: see SH9. | P2 |
| PY-F13 | Pause Payroll Service plus Stop Future Billing: see SH10. Existing invoices, refunds, proration and restart are unresolved: do not invent. **Billing link touches billing data: check with Rasel before any schema change.** | P2 |
| PY-B01 | Report files need the canonical upload and a document to link; revisit report save and preview after SH3 (test, not a defect). | P3 |
| PY-B02 | Provide a safe draft-only, clearly non-executing review route for the five-stage payroll review (demo record, no execution). | P3 |
| PY-B03, B04 | Provider-backed outcomes and controlled acceptance evidence (roles, audit, isolation, delivery, accessibility): tests that need authorized setup. Report results by ID. | P3 |

## D. Bookkeeping (guide: `bookkeeping--developer-review.md`)

Passes P01-P09 are preserved (duplicate enrolment guard, settings values, Not Started display, status list tabs, Manage Integrations and Manage Accounts, empty reports, Add Period, saved P&L record, manual On Track). Both original guides are kept as Appendix A (Module) and Appendix B (Fresh): together they are the requirement baseline; her explicit decisions win only where they apply.

| # | Change | Prio |
|---|---|---|
| BK-I01-I03 | Connection integrity: see SH7. Peter showed QuickBooks Online Connected from a dummy company id with Last Sync Never. I02 (keep last good data, retry, stale, duplicate-resistant reconnect) and I03 (honest totals, period and source, empty and setup states, tenant isolation) are tests with controlled fixtures. | P1 |
| BK-D01, D02 | Clickable Active Bookkeeping Clients, Clients With Upcoming Reports and the status chart categories filter the same list: see SH8. Income, Expenses and Net Profit stay non-clickable. | P2 |
| BK-D03 | **Custom Date Period** (start and end) for Next Report Due on the same list, combined with current filters, start no later than end. Boundary and timezone convention to confirm. | P2 |
| BK-D04 | Label "Missing Documents after X days" as age from the **document request sent date**; satisfied or canceled requirements stop reminders. Do not hard-code 7, 0 or 14 days. Overdue anchor is still open. | P2 |
| BK-D05 | **Checklist creation text loses focus after every keystroke.** Keep typing, caret and text through updates. | P1 |
| BK-D06 | **Assign/Reassign** keeps returning to Unassigned. Save the permitted staff identity, show it in list and workspace, audit, truthful errors. | P1 |
| BK-D07 | Plan Type dropdown empty: see SH9. | P2 |
| BK-NAV | **One contextual navigation contract** (SH1): Request Documents opens the shared request flow; Documents tab and View Documents open the client's canonical Bookkeeping documents with View, Upload, Request (scoped external page with Back is acceptable); **Overview recent document View stays an inline preview**; **Add Note opens in-place** on canonical linked-client notes (internal by default, not the generic profile); Tasks and Create Task per SH4; Communications per SH5; Manage Integrations Back per SH1; Reports keep Bookkeeping, client and period. Main-page actions without a client ask for the client instead of guessing. Confirm where Categorize Transactions routes today (reported as Reconciliation) before calling it a defect. | P1 |
| BK-T01 | **Transactions page is blank** (no controls). Restore the full workspace: grid (date, payee, account, amount, debit/credit, category, status, type, source), search and filters, categorize and split (split sum must equal the total), transfer match, exclude, receipts, bulk actions, audit; refunds, chargebacks and settlements as distinct events with source links, matched deposit and the four settlement states. Render the structure and honest setup or empty states even with no records. **Needs tables: Rasel's tap.** | P1 for the structure, P3 for the engines |
| BK-R01 | **Reconciliation has only Add Period.** Restore the workflow: account and statement period, beginning and ending balances, statement attachment, cleared items, difference, exceptions, save progress, Ready for Review, approve and reopen with reason, close checklist, version and lock. **Zero tolerance is approved**: block approval until the difference is zero at currency precision (precision and rounding to confirm). **Needs tables: Rasel's tap.** | P1 for the structure, P3 for the engines |
| BK-RPT | Reports remain a financial output workflow: P08 only proves a record persists. Supported P&L, Balance Sheet, Cash Flow, General Ledger, Trial Balance, Transaction Detail, Uncategorized, Reconciliation, Refund, Settlement, Status and Missing Documents reports with period and basis, preview, generate, download, send, schedule, mark reviewed, immutable versions. Mark Report Complete never bypasses reconciliation. Largest piece: schedule after T01 and R01. | P3 |
| BK-E01 | **No Terms entry** in the workspace. Restore discoverable access to the six Terms areas (Terms, Service Details, Billing and Payments, Engagement Documents, Renewal and Notices, History), linked to Services & Pricing and Invoices & Payments, never overwriting signed versions. | P2 |
| BK-A01 | Visible **selected-client Activity feed** (display and discoverability; backend audit is not shown to be missing). | P2 |
| BK-OPEN | Open decisions for Rasel to relay (use the safer boundary until answered): workspace layout (six tabs in one guide, ten in the other: keep the functional union), note visibility (internal by default), Overdue anchor and thresholds, inclusive endpoints and timezone, currency precision, plan setup and current period, settings inheritance, product spelling. | n/a |

## E. Data and schema needs (R1 owns them, Rasel's own tap first)

Nothing below is to be built by a screen session. Each item is a question to put to Rasel as a card before R1 starts:

1. Tax Returns: filing method and **mail tracking number per return and jurisdiction**, **manual refund or amount due per jurisdiction** with source and version, **rejection details** (agency, code, description, timestamp, corrective action, attempt id), **validation issues** linked to review steps (severity, responsible person, version), business identity on a business return, and an archived flag if one does not exist yet.
2. Payroll: **Stop Future Billing** (flag and stop date) on the client service, linked to billing.
3. Bookkeeping: transactions (with splits, transfer links, refunds, chargebacks), settlements and payouts, reconciliation periods with statement, cleared items, difference and approval, close checklist with version and lock, report versions, Terms and agreement versions, activity events. Largest schema ask of the round; sequence after Rasel's decision on scope for Oct 28.
4. Any assignment-authority change (TX-F18) is a role-check change: Rasel's word, not just a schema tap.

## F. Routing (who does what)

Rasel runs at most two worker sessions at once next to R1 (his laptop hangs with four). Proposed split, in order:

| Session | Takes | Reads |
|---|---|---|
| R1 | Light: the EIN status PR, prod bootstrap, then the schema items in section E once Rasel taps | `docs/work/R1-*.md` |
| R56 (fresh) | The shared fixes **SH1-SH10**, then **Payroll** (PY-F01 to F13) and the **Bookkeeping** P1 and P2 items (BK-D01 to D07, BK-NAV, BK-E01, BK-A01), then Edit Draft #1155 retarget | `docs/work/R56-payroll.md`, `R56-bookkeeping.md`, this file sections A, C, D |
| R60 | First what is already in flight (Clients E1-E10, Sign-ups), then **Tax Returns** (TX items in section B), picking up the R55 Tax Returns file | `docs/work/R55-tax-returns.md`, this file sections A and B |

The big Bookkeeping builds (BK-T01, BK-R01, BK-RPT) go last: they need R1's tables and are bigger than the time left before Oct 28 for two workers. Do them in the order T01 structure, R01 structure, then the engines, and say in each PR which parts are structure only. Each PR links the IDs it closes.

Each PR: one module or one shared fix, title `<type>: <what> (Rn)`, link the IDs, and for every test item (PENDING, BLOCKED, NEEDS VERIFICATION) record Pass, Fail or Blocked with the setup and the observed result. Do not mark a financial test closed from a screenshot of a shell record, a toast or a dummy Connected label.
