
Firmvra DashboardDeveloper Feedback
First review checkpoint24 October 2026
The first guided Dashboard review is complete. Correct the routing and interaction issues, implement the approved additions, and complete the controlled tests in this document before requesting final approval. This checkpoint is not final approval.
Scope and evidence
This feedback covers the Dashboard only. It consolidates the owner-led guided UI review against Dashboard_Developer_Instructions_UPDATED(2).docx and the approved Firm dashboard(5).png visual reference. The original 24-section guide remains the behavioral baseline except where an explicit decision below changes or adds a requirement.
Observed results are the outcomes reported during the guided review. They are not independent backend, code, security or calculation verification. The approved mockup is a design reference, not a screenshot proving the current application works.
Status
Meaning
FIX
Observed behavior does not meet the required or approved outcome.
✔ PASS
The stated UI action worked in the review. The pass is limited to that action.
ADDITION
The owner approved a new or clarified requirement during this review.
PARTIAL
Some behavior was accepted or observed; the complete workflow remains unverified.
PENDING
A controlled test, fixture, populated data or technical evidence is still required.
DECISION
A settled scope or wording decision that must not be reversed accidentally.

Highest priority corrections
Make every card, row and shortcut open the exact record, filter or creation workflow promised by its label.
Replace Completed Returns with Accepted Returns. Keep Outstanding Invoices as all unpaid outstanding amounts, not overdue-only.
Restore period controls, comparison indicators, appointment actions, notification read behavior and reliable menu dismissal.
Keep confirmed UI passes, approved additions and unverified data/security behavior separate. Do not close pending tests based on an empty widget or a working link.
Baseline boundaries
Production data must be live, firm-scoped and permission-controlled. Dashboard shortcuts must reuse canonical source-module workflows and the same authorization and audit checks. Example LVP figures, dates, names and services must never be hard-coded.
1 KPI cards and destination filters
A correct destination page alone is not enough. The destination must represent the card definition and carry the relevant status, period and firm scope. Guide sections 3, 4, 14 and 21 apply.
ID
Status
Current behavior and required outcome
Acceptance check
K1
✔ PASS
Total Clients opened the client list. Preserve this working destination.
Confirm the count reconciles with the same permitted client population; count accuracy is still pending.
K2
FIX
CURRENT: The reviewed client-list flow had no clear return to Dashboard.→ REQUIRED: Provide a clear Dashboard return path and preserve context where practical.
Return without losing the selected period, filters, widget arrangement or scroll position where practical.
K3
FIX
CURRENT: New Leads opened the general Total Leads view.→ REQUIRED: Open Leads filtered to New and the relevant reporting period.
The destination lists only the records represented by New Leads, not every lead.
K4
FIX
CURRENT: Returns In Progress opened All Returns.→ REQUIRED: Open Tax Returns filtered to the documented in-progress statuses and relevant period.
The filtered records reconcile with the card. Document which canonical tax statuses belong in progress.
K5
DECISION
Rename Completed Returns to Accepted Returns. Count and drill down to Accepted only. Exclude Transmitted and Rejected.
Label, count definition and destination filter all use Accepted. Do not create a fictional Completed tax status.
K6
FIX
CURRENT: Outstanding Invoices opened the general invoice dashboard.→ REQUIRED: Open Invoices & Payments filtered to all unpaid outstanding balances, including not-yet-overdue amounts.
Include unpaid outstanding balances even when not past due. The destination and count/balance must reconcile.
K7
FIX
CURRENT: Appointments Today and View Calendar opened the general appointments dashboard.→ REQUIRED: Open Appointments/Calendar filtered to today in the active firm timezone.
The destination/calendar is restricted to the same company-local day as the card.
K8
FIX
CURRENT: Comparison arrows, percentages and labels were missing.→ REQUIRED: Restore dynamic, metric-aware indicators with text, neutral no-change and safe New/N/A treatment for a zero prior period.
Check meaningful equivalent periods, truthful wording, semantic color plus text, zero prior period and no-change fixtures.

Settled tax and invoice definitions
The reviewed tax statuses were In Preparation, Awaiting Client, Ready Review File, Transmitted, Accepted and Rejected. No Completed status was present. The approved Accepted Returns change is deliberate, not a request to treat every submitted return as completed.
The earlier suggestion to use an Overdue-only invoice card was explicitly withdrawn. Do not implement that suggestion. The balance and calculation behind Outstanding Invoices have not yet been verified.
Comparison indicators remain required
Missing arrows, percentages and comparison labels must be restored. Use metric-aware favorable/unfavorable colors with text, a neutral no-change state, and a safe New/N/A rule when the prior period is zero. Use meaningful equivalent elapsed periods and wording that matches the calculation. The accuracy of those calculations remains pending.
2 Periods charts and source reconciliation
ID
Status
Current behavior and required outcome
Acceptance check
C1
FIX
CURRENT: The required Dashboard date/period selector was absent.→ REQUIRED: Provide the requested global selector and applicable widget controls for Today, This Week, This Month, Last Month, This Quarter, This Year, Last Year and supported Custom.
Use company-local boundaries; month/quarter/year mean to date, previous month/year mean full periods. Validate Custom start/end dates.
C2
FIX
CURRENT: Revenue Overview showed No Revenue; its Month label was not clickable.→ REQUIRED: Provide working Month, Quarter, Year and supported Custom controls. Retain an honest empty state when no revenue exists.
Changing the period updates the whole widget. The empty state remains honest; populated fixtures prove chart, hover and drill-down behavior.
C3
PENDING
No financial values were available to validate revenue totals, comparisons or Reports reconciliation.
Use known invoices/payments or approved integration fixtures. Reconcile the documented revenue definition, currency and rounding.
C4
PENDING
Service Breakdown was empty. No populated segment drill-down could be tested. Do not label this a confirmed non-clickable segment defect.
Populate services from Services & Pricing. Verify percentages/values, whole-widget period and permitted segment drill-down.
C5
FIX
CURRENT: Clicking the Lead stage in Client Pipeline did nothing.→ REQUIRED: Open the matching pre-filtered Leads/Clients/Workflow view with stage and selected-period context.
Test each configured stage against known records, not only Leads. Verify the destination definition and preserved period.
C6
✔ PASS
Pipeline displayed Lead 1 and Intake 1, with other stages at 0, consistent with the review setup. This pass covers the displayed fixture counts only.
Verify live accuracy, source mutations, period boundaries and firm/role scope with controlled fixtures.

Period behavior must be explicit
Document which widgets the global period selector controls and which have their own period. Today-specific cards and due labels must retain their stated company-local meaning. Never silently turn Appointments Today into an arbitrary selected-range count.
Financial consistency is not yet a pass
Revenue Overview, Service Breakdown and Reports must use the same selected revenue definition. The approved mockup itself shows $142,680 in Revenue Overview and $142,660 in Service Breakdown. Those are illustrative values with a visible mismatch, not production targets or evidence of a live defect. Use reconciling live values instead.
Guide coverage
Sections 4–7, 14, 15, 16 and 21 remain binding: safe comparison logic, dynamic stages/services, useful empty states, live refresh, source reconciliation and exact drill-down context.
3 Messages and task interactions
ID
Status
Current behavior and required outcome
Acceptance check
T1
✔ PASS
Recent Messages and View All opened Messages. A specific message preview opened the correct conversation.
Preserve exact conversation routing and authorized previews. Unread calculations and permission boundaries still need controlled tests.
T2
✔ PASS
Tasks Due was initially empty. View All opened Tasks.
Preserve the route; verify the relevant due filter with populated fixtures.
T3
✔ PASS
A dummy Test Dashboard Due Task was assigned to the signed-in user for today, all day. It appeared on the Dashboard after refresh.
This proves post-refresh visibility for the fixture, not automatic live updates, cross-user behavior or all due-date cases.
T4
FIX
CURRENT: The task title opened the client profile.→ REQUIRED: Open the exact task from its title; provide a separate permitted related-client link.
Make the task title open that exact task. If a related client link is shown, keep it separate and permission-controlled.
T5
ADDITION
The completion checkbox completed the task immediately. Add the requested confirmation before task completion.
Cancel leaves the task unchanged. Confirm completes it once through the canonical task workflow.
T6
✔ PASS
After completion, the task disappeared from Tasks Due and appeared as Done in the main Tasks completed filter. It was not deleted.
Preserve this behavior. Do not report the disappearing due item as deletion.
T7
PENDING
A 17:00 time value could not be edited while setting up the all-day fixture. This was reported but not diagnosed.
Investigate the source task form/time control separately. Do not assert a cause or a confirmed Dashboard time defect.

Task completion safeguards
The guide still requires permission checks, source-record updates, clear priority/due status and safe rollback. If completion fails, restore the checkbox and show an actionable error. Confirm audit behavior, duplicate-click protection and changed-permission handling using controlled tests. A successful completion does not prove those failure paths.
Message shortcut qualification
The bottom Send a Message shortcut reached a messaging location the owner accepted, but it may have opened an existing Stacy conversation. A fresh composer/client-selection flow was not verified. Keep the conversation-preview pass separate from the quick-action composer requirement.
Guide coverage
Sections 8, 9, 11, 15–17, 20 and 21 apply. Preserve correct source records and exact links; do not turn a Dashboard shortcut into a separate or weaker workflow.
4 Appointments and notification behavior
ID
Status
Current behavior and required outcome
Acceptance check
A1
✔ PASS
An upcoming October 26 appointment fixture appeared. View All opened the main Appointments area.
Preserve fixture visibility and the View All route. This does not prove all date, status or permission cases.
A2
FIX
CURRENT: An individual appointment row opened the general appointments page.→ REQUIRED: Open that exact appointment record in the active firm.
Open the exact appointment record, retaining relevant firm and return context.
A3
FIX
CURRENT: The appointment three-dot menu was absent.→ REQUIRED: Add permitted View Details, Edit, Reschedule, Send Reminder, Mark Complete, Cancel with confirmation, and Open Client actions.
Provide View Details, Edit, Reschedule, Send Reminder, Mark Complete, Cancel and Open Client, filtered by permissions.
A4
ADDITION
Add a scrollable Upcoming Appointments panel for longer lists, with a visible scrollbar and keyboard/touch access.
Long lists remain usable without hiding important controls or trapping keyboard focus. Test overflow with many appointments.
N1
✔ PASS
The notification bell displayed an appointment reminder in its list.
Preserve reminder visibility. No external reminder or notification send was performed in the review.
N2
ADDITION
Opening the notification list did not clear read/unread state. The owner requested marking viewed notifications as read and clearing the corresponding unread badge while keeping history.
Only notifications actually covered by the read action become read; retained history remains available. Verify badge persistence after refresh.
N3
FIX
CURRENT: Clicking the appointment notification opened general Appointments.→ REQUIRED: Open the exact associated appointment and recheck destination authorization.
Route to the exact associated appointment and recheck access at the destination.

Appointment actions must be controlled
Cancel requires confirmation. Edit, reschedule, status updates, reminders and client navigation must use the existing source-module rules and effective permissions. A meeting icon must use a valid permitted meeting link; location controls must open appropriate details. These action outcomes were not all exercised.
Create appointment route accepted
The + New Appointment action opened the calendar, where appointment creation was possible. The owner accepted that route. Preserve it as an accepted navigation result; do not claim that a direct creation modal was observed or require one as a correction to this accepted route.
Guide coverage
Sections 1, 2, 10, 15–18, 20 and 21 apply. Notification and appointment links must identify the intended source record rather than merely opening the right module.
5 Quick actions and the New menu
ID
Status
Current behavior and required outcome
Acceptance check
Q1
FIX
CURRENT: Bottom Add a New Client opened the general Clients list.→ REQUIRED: Open the canonical new-client form directly.
Open the canonical new-client form/workflow directly.
Q2
PARTIAL
Bottom Send a Message reached an accepted messaging destination. A new composer was not conclusively verified.
Open a fresh message composer/client selection; do not silently reuse an unrelated existing conversation.
Q3
FIX
CURRENT: Bottom Create a Bulk Email opened Communications Overview.→ REQUIRED: Open the Send Bulk Email composer directly, not the campaigns list. Opening it must not send or create a campaign automatically.
Open the Send Bulk Email composer directly. The earlier campaigns-list suggestion was withdrawn. Do not auto-send or auto-create a campaign.
Q4
FIX
CURRENT: Bottom Generate an Invoice opened the invoice overview.→ REQUIRED: Open a blank canonical invoice creation form.
Open a blank canonical invoice creation form. Keep this separate from the working + New Invoice result.
Q5
FIX
CURRENT: Bottom Upload Documents opened main Documents.→ REQUIRED: Open secure document upload with required client/details selection.
Open the secure upload workflow with required client/details selection. No file was uploaded during the review.
Q6
FIX
CURRENT: The + New menu had only Client, Appointment, Invoice and Message.→ REQUIRED: Also show New Lead, New Task, Bulk Email/Communication and Upload Documents when the user has permission.
Add permitted New Lead, New Task, Bulk Email/Communication and Upload Documents actions. Do not expose unauthorized actions.
Q7
FIX
CURRENT: + New Client opened the Clients list.→ REQUIRED: Open the canonical new-client form, matching the corrected bottom shortcut.
Open the same canonical new-client form as the corrected bottom shortcut.
Q8
✔ PASS
+ New Invoice opened the invoice creation form.
Preserve this working route; verify saving/permissions separately with authorized fixtures.
Q9
✔ PASS
+ New Appointment reached the calendar, where creation was possible. The owner accepted this route.
Preserve the accepted calendar route. This does not claim a direct creation modal or a completed appointment submission.
Q10
FIX
CURRENT: Escape and outside click did not close + New.→ REQUIRED: Close on Escape, outside click, route change and selection, with keyboard navigation and appropriate focus return.
Close on Escape, outside click, route change and selection. Return focus appropriately and support keyboard navigation.
Q11
PENDING
+ New Message was not clearly tested.
Verify a fresh message composer/client-selection flow separately before marking it passed.

All five bottom quick-action cards were present. Presence is not completion: verify each destination, required initial form state and permission behavior. Opening + New alone must create nothing. Guide sections 2, 11, 17, 18, 20 and 21 apply.
6 Approved forms support and card configuration
ID
Status
Approved requirement
Acceptance check
D1
ADDITION
For the shared client form, require name, email, phone and the appropriate address for Individual and Business clients. Remove misleading optional labels. Business Name is required conditionally for Business clients; use appropriate home/business address wording.
Switch client type and verify required labels, conditional Business Name and validation. No client-form test submission occurred.
D2
ADDITION
Help currently provides two email actions for contact/reporting. Add in-app support messaging, FAQ and live chat or call options according to configured availability.
Show only supported, configured channels and honest availability. Do not fabricate live support or send a message merely by opening Help.
D3
ADDITION
Replace the Report Problem/Bug helper copy with the exact text below. Make attachments a user choice and keep reporting privacy-safe.
User can review the report and choose attachments. Include only appropriate firm/page context; never automatically include secrets or unrelated sensitive content.
D4
ADDITION
Add administrator-controlled service-card templates in Settings. Select service, status, metric and label together, with a small selected set and optional additional cards.
The chosen label, count and drill-down stay aligned. Use effective permissions and firm scope; changing a label must not disguise an unrelated underlying metric.
D5
DECISION
Keep Total Clients, New Leads and Outstanding Invoices fixed. Use Accepted Returns as the default tax outcome card, replacing Completed Returns.
Verify fixed cards remain fixed and tax Accepted-only semantics survive configuration. Never relabel a tax metric as an unrelated service metric.

Approved Report Problem text
Describe what went wrong. Your firm name and affected page will be included in the report.
Help and form verification limits
Opening Help exposed contact/report email actions; no email or support report was sent. The review did not submit a client form. Validate required-field behavior using authorized test records and keep submission separate from navigation checks.
Configuration is an addition not a retrospective defect
The original section 13 describes optional dashboard customization when enabled or supported. Its absence alone is not a defect. The Settings-based service-card configuration above is a newly approved requirement and must be tracked as such. Any customization must respect backend authorization and must not fetch sensitive data for hidden or unauthorized widgets.
7 Header usability and settled review decisions
ID
Status
Current behavior and required outcome
Acceptance check
U1
✔ PASS
Global Search found Stacy and opened the correct record. A Zzz query produced a no-results message.
Preserve these cases; test supported record types, role/firm scope and reset behavior separately.
U2
✔ PASS
The owner confirmed the greeting name and role. Date and time were visible, including Saturday, October 24, 2026 at 17:56 during the review.
Keep the date/time automatic using the firm timezone in Settings. Verify boundary behavior; do not add manual date/time entry.
U3
✔ PASS
Tab navigation showed a blue focus outline. Enter opened Total Clients and an appointment control.
This is a partial keyboard pass only. Test every interactive control, menus, Escape, Space where appropriate and focus return.
U4
✔ PASS
In the reviewed narrow window, the owner reported no overlap and all content remained reachable.
This is a limited responsive observation, not full mobile/tablet approval. Test supported widths, touch and overflow.
U5
✔ PASS
After clearing search and refreshing, the greeting, date/time, counts and appointment display returned.
This is refresh restoration, not proof of automatic live updates, cache correctness or comprehensive return-state persistence.

Do not reintroduce withdrawn or unsupported findings
Decision
Required handling
No missing clock defect
Date and time were present. The earlier missing-clock/manual-date idea was withdrawn.
No overdue-only replacement
Keep Outstanding Invoices as all unpaid outstanding amounts, including not-yet-overdue balances.
No campaigns-list destination
Bulk Email must go directly to Send Bulk Email composer, not Overview or the campaigns list.
No empty chart click failure claim
Service Breakdown had no populated segments. Segment interaction remains unverified.
No deleted task claim
The completed fixture left Tasks Due and appeared Done in the main completed filter.
No mandatory original layout customization claim
Original section 13 was conditional. Track the approved Settings service-card addition separately.
No direct appointment modal claim
The + New calendar route was accepted; a direct creation modal was not verified.

The company-local date and configured Tax Season/Off-Season context remain original requirements. A displayed clock does not by itself verify timezone correctness or tax-season configuration.
8 Controlled tests required before final approval
These areas were not verified by the available UI review. Keep them pending until controlled fixtures and reproducible evidence establish the result. Empty widgets, working links and one successful task completion are not substitutes.
ID
Test area
Required evidence
V1
Metric definitions and reconciliation
Known clients/leads/returns/invoices/payments; documented inclusion rules; exact agreement among Dashboard, filtered source records and Reports. Accepted-only and unpaid-outstanding definitions are mandatory.
V2
Comparisons and date boundaries
Known prior/current periods, partial-period equivalence, no-change and prior-zero cases; firm timezone day/week/month/quarter/year boundaries; validated Custom ranges.
V3
Revenue and service breakdown
Populated financial data; approved revenue source/definition; matching totals and service percentages; exact hover values and permitted drill-downs; currency/rounding consistency.
V4
Live updates and cache scope
Create/update/complete source fixtures and observe the documented refresh strategy without relying only on manual reload. Verify correct invalidation, firm isolation and no duplicate requests/actions.
V5
Roles and permission changes
Owner/admin, manager, staff, financially restricted and custom-role fixtures. Verify data/action visibility and server-side checks, including access revoked before destination/action completion. Check for cross-firm or hidden-widget leakage.
V6
Failure and safe rollback
Loading, empty, source error, stale data, disconnected integration, network failure and optimistic completion failure. Verify retry, safe state, checkbox rollback and no restricted data leakage.
V7
Security and audit parity
Dashboard-sensitive actions use canonical module authorization, tenant scope and equivalent audit events where auditable. Verify changed permissions and failure handling, not only successful navigation.
V8
Loading and performance
Slow/failing-widget isolation, progressive shell rendering, appropriate deferred/off-screen loading, realistic large-data snapshots, request efficiency and meaningful Dashboard/API instrumentation.
V9
Routing and return context
Exact record/filter/period drill-downs; stable URLs/query state where supported; destination permission rechecks; practical preservation of period, filters, layout and scroll on return.
V10
Accessibility and responsive behavior
Full keyboard/assistive-technology pass; chart text/table alternatives; screen-reader labels; non-color status cues; supported mobile/tablet widths; touch and long-list scrolling.
V11
Forms and action outcomes
Required client-field validation; secure upload client/details flow; fresh message and bulk-email composers; invoice creation; permitted appointment menu actions; task confirmation and cancellation. Use authorized test data and intentional submissions only.

Record build/version, firm, role, timezone, fixture, steps, expected result, actual result and evidence for each retest. Do not mark an unexecuted or inconclusive test as passed.
9 Original guide coverage and closure criteria
This map preserves coverage of all 24 original sections without replacing their detailed requirements. References below point to the feedback IDs or controlled tests in this document.
Guide section
Review disposition and remaining coverage
1 Header and Global Controls
U1–U2, N1–N3, D2–D3. Tax-season settings and full profile/help behavior remain to verify.
2 New Dropdown
Q6–Q11 and the accepted appointment route. Verify all permitted actions and no creation on open.
3 Top KPI Cards
K1–K8. Accepted-only change; unpaid outstanding preserved. Reconciliation remains V1.
4 Trend Indicator Logic
Missing indicators are corrections; calculation and semantic treatment require V2.
5 Client Pipeline
C5–C6. Stage drill-down is a fix; complete live counts/period behavior require V1, V4 and V9.
6 Revenue Overview
C2–C3; period-control correction and populated financial evidence under V3.
7 Service Breakdown
C4; empty-state observation only. Populated values, reconciliation and segments require V3.
8 Recent Messages
T1 pass is limited to reviewed routes/conversation. Unread and permissions require retest.
9 Tasks Due
T2–T7; exact-task routing and confirmation; rollback/audit still V6–V7.
10 Upcoming Appointments
A1–A4, N3; exact records/menu/scrolling. Remaining action tests under V11.
11 Quick Actions
Q1–Q5; direct canonical workflows and qualified message-composer result.
12 Dashboard Color System
Preserve approved visual direction, semantic trends and text cues. Full accessibility remains V10.
13 Customization and Widget Behavior
Original optional scope preserved. D4–D5 add approved Settings service-card configuration.
14 Period Dropdowns and Comparison Rules
C1–C2; common documented date boundaries and comparison wording require V2.
15 Data Refresh and Consistency
T3 and U5 are limited refresh observations. Automatic updates, caching and reconciliation remain V1–V4.
16 Loading Empty Error and Restricted States
Empty widgets/no-results were observed; remaining states and rollback require V6.
17 Admin vs Staff Permissions
No comprehensive role/security pass. Controlled role and changing-access tests remain V5.
18 Responsive and Accessibility
U3–U4 are partial observations only. Full keyboard, screen-reader and mobile pass remains V10.
19 Multi Firm Requirement
No cross-firm isolation proof. Firm configuration, query/cache/search/widget isolation remain V5.
20 Security and Audit Integration
Source-module authorization and audit equivalence remain V7; shortcuts cannot bypass either.
21 Drill Down and Return Context
K/Q/A/N/T routing corrections; exact metric context, stable routing and return state remain V9.
22 Performance and Independent Loading
Independent loading, failure isolation, lazy loading and instrumentation remain V8.
23 Developer Acceptance Checklist
Not complete. Resolve corrections/additions and attach evidence for all pending acceptance tests.
24 Recommended Build Sequence
Use as implementation guidance; sequence completion is not evidence of test completion.

Checkpoint and next submission
First review completed. Final approval pending. The next developer submission should identify each resolved feedback ID, explain any unresolved item, and include evidence for the controlled tests. Preserve the observed passes, implement the approved changes, and request a focused Dashboard retest after the corrections are ready. This checkpoint covers the Dashboard only.
