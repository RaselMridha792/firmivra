<!-- Octavia's Bookkeeping review of Oct 25, 2026, converted from her .docx (tables flattened). Original wording kept. -->

Firmivra Bookkeeping
Consolidated developer review
25 October 2026 | Firm Workspace | First review
Preserve working behavior and complete the missing workflows
Implement the corrections and approved additions in this review, preserve the working behavior, and verify the remaining requirements from both original guides. The walkthrough exposed missing transaction and reconciliation controls, incorrect or unscoped routes, an unverified connection displayed as Connected, and several persistence and usability gaps. This is a developer handoff, not final acceptance of Bookkeeping.
Review evidence is user-reported from the walkthrough, including a test client named Peter and a dummy QuickBooks company and ID. No application code, server responses, real provider authorization or financial calculations were independently verified. A visible control, saved record or opened page is not a completed financial workflow.
How to use this package
Sections 1 through 10 contain the current consolidated review. Appendix A preserves all 13 sections of the Module guide; Appendix B preserves all 17 sections of the Fresh guide. Both originals remain unchanged. Use the appendices as the complete retained requirement baseline, not as competing new instructions. Explicit decisions in this review take precedence only for the behavior they resolve. Omission from one original does not cancel a requirement in the other.
The file name Fresh does not establish precedence. Firmivra is used for this handoff; the source spelling difference remains an explicit product decision. The original six-tab and ten-tab workspace layouts are not silently reconciled into an approved redesign. Preserve their functional union while the navigation decision is made.
Review state
Meaning
PASS
Green: a narrow user-reported result to preserve. It is not independent end-to-end acceptance.
GAP
Red: a user-reported defect or missing visible capability. The underlying technical cause is not established.
APPROVED
Blue: an explicit addition or clarification approved in this walkthrough, not a claim of implementation.
PENDING
Amber: an unresolved choice, blocked test or untested requirement. Do not infer failure or completion.
Implementation order
First correct connection truthfulness, persistence and context routing. Restore the full Transactions and Reconciliation workspaces without inventing data. Add the approved filters and activity access, restore Terms access, then verify source-linked financial workflows, report output, permissions and client delivery with controlled fixtures and authorized integrations.
1 Working behavior to preserve
These passes apply only to the stated interaction and tested scope. They must coexist with the gaps elsewhere in this review.
ID
State
User reported result
Limit of the result
P01
PASS
Selecting an already-enrolled client through Add Client blocked duplicate enrollment.
One tested enrollment guard only; other duplicates, company mapping and server enforcement remain untested.
P02
PASS
The tested Bookkeeping Settings values saved and remained after refresh.
Exact values and full control coverage were not established. This does not retract the checklist focus defect or prove timers, reminders or overrides.
P03
PASS
The new test client initially displayed Not Started.
Correct display for that client only, not all automatic status rules or counts.
P04
PASS
Lower list tabs All, On Track, Needs Attention, Missing Documents, Overdue, Not Started and Upcoming responded as filters.
Only one known test record was available. Positive and negative cohorts, counts and combinations remain unverified.
P05
PASS
Manage Integrations opened Integrations. Manage Accounts from the account card opened Settings within Bookkeeping.
Destination opening only; exact-origin return is still required. Account setup and provider authorization were not tested.
P06
PASS
View Reports and the Overview report link opened an empty reports view when no reports existed.
Expected empty-state/navigation result only; Bookkeeping scoping, report contents and filter correctness were not proven.
P07
PASS
Reconciliation Add Period created a month/date period displayed Not Started.
Period creation and display only. Refresh persistence, account/statement linkage and actual reconciliation remain unverified.
P08
PASS
A Profit and Loss report entry was created, saved and remained after refresh.
Report-record persistence only. Computed statement contents, values, versions, export and delivery remain untested.
P09
PASS
Manual status changed to On Track and remained after refresh.
One manual status persistence test only. Rule precedence, audit, authorization and chart/cohort updates remain unverified.
Visible controls are not additional passes
The user saw cadence options Monthly, Quarterly, Annual and Custom; Close by Day; Sync stale after set to 48 hours; an editable Upcoming Report Window; and a separate Overdue after control. The main page showed client-type choices All, Business and Individual, software choices Connected and Not Connected, period choices This Month, Last Month, Quarter and Year, status/date controls, and a Jan to Dec empty income-versus-expenses chart. These observations establish visibility or UI response, not data accuracy, elapsed-time behavior or all filter combinations.
The status dropdown included On Track, Needs Attention, Missing Documents, Overdue, Not Started and Reports Due; the lower list tab used Upcoming. Due-date presets were reported as All Dates, Next 7 Days, Next 30 or 31 Days and Past Due; the exact 30-versus-31 label was not confirmed. Preserve that uncertainty rather than silently renaming the control.
Sync All Clients produced a request response for already-connected clients; it did not enroll all firm clients. This is not a successful data sync. The Pause dialog requested a reason; a subsequent reason prompt was only tentatively attributable to Archive. No pause, resume, archive, restore or related persistence result was established.
2 Connection integrity and shared data rules
ID
Review state
Developer direction
Evidence needed to close
I01
GAP
Do not show a real authorized connection as successful when only a dummy company and ID have been entered. Peter showed QuickBooks Online Connected without provider authentication, and Last Sync Never. Distinguish demo or pending setup from verified provider-and-company authorization. Preserve the original authorize, select company, map client, confirm and sync flow. Sources M7 and M12; F14.
Verify a supported provider authorization flow and mapped company; reject or clearly label arbitrary test IDs. Show the true connection state after refresh and reconnect.
I02
PENDING
Keep the last successful data on sync failure; show the latest failure separately from Last Synced. Preserve source IDs, incremental sync where supported, retry, stale warnings, disconnect history and duplicate-resistant reconnect. Financial facts remain source-authoritative unless an explicitly permitted supported write-back exists. Sources M7; F14.
Use authorized provider or controlled fixture tests for success, failure, stale data, retry, disconnect and reconnect; reconcile records and last-success timestamps.
I03
PENDING
Keep empty or unavailable totals honest. Identify period and source for financial totals; isolate tenant, client/business and authorized cohort. Never fabricate values or infer valid financial data from the dummy connection. Show useful empty/setup states rather than a blank workspace. Sources M2, M10; F opening and F15 to F16.
Compare known source balances and transactions with displayed totals, including permission boundaries and no-data states.
Provider names in the designs are examples, not a fixed product limit. Use modular integrations and secure credentials; never display secret tokens to staff. Every bookkeeping record must retain the correct tenant, client/business, period, service, assigned staff and audit linkage. Reuse the canonical Clients, Documents, Reports, Tasks, Notifications, Staff Permissions, Integrations and Activity systems rather than building parallel records or engines.
3 Dashboard filters settings and persistence
ID
Review state
Developer direction
Evidence needed to close
D01
APPROVED
Make Active Bookkeeping Clients and Clients With Upcoming Reports clickable cohort filters on the same client list and dashboard. Keep totals, charts and report context consistent with the selected cohort, current period and permissions. Keep Total Income, Total Expenses and Net Profit nonclickable in this change scope.
Select each approved card; verify one consistent cohort across list and dashboard, a visible selection and a working clear/reset.
D02
APPROVED
Make the status chart categories On Track, Needs Attention, Missing Documents, Overdue and Not Started filter the same client list. They were not clickable. Preserve current period/context and clear/reset behavior. The responding lower list tabs are separate controls and do not close this gap. Source F1.
Test every category against known matching and nonmatching records; check counts, combined filters and restoration after clearing.
D03
APPROVED
Add Custom Date Period with start and end dates for Next Report Due on the same permitted client list. Combine it with current filters rather than opening another page. Validate start no later than end; confirm boundary and timezone conventions before implementation. Source M4.
Test valid, invalid, empty and boundary ranges with current search, status, client type, plan and software filters retained.
D04
APPROVED
Label Missing Documents after X days clearly as age measured from the document request sent date. Retained source safeguard: satisfied or canceled requirements stop obsolete shared reminders. Define complete eligibility and exclusions for the Missing Documents state rather than treating them as fully approved policy. Do not hard-code suggested 7-day, 0-day or 14-day values as policy. Sources M8 to M9.
Verify the approved request-sent anchor, resolution/cancellation handling and configurable values. Resolve the separate Overdue anchor before testing it.
D05
GAP
Fix checklist-creation text entry losing focus after every keystroke. Preserve continuous typing, caret position and entered text through UI updates. The exact field and code cause were not established; the later Settings save result does not prove this issue was fixed.
Type, edit, paste and select text without refocusing; save and refresh a checklist, and verify accurate validation and retained values.
D06
GAP
Fix Assign/Reassign persistence or display. Selecting staff and clicking Assign repeatedly left or returned the value to Unassigned. Save the canonical permitted staff identity, reflect it consistently in list and workspace, record audit history and show truthful errors. Source M5.
Assign and reassign an eligible staff member; refresh, reopen both views and verify stored assignment, permissions, audit and failure feedback.
D07
PENDING
Populate Plan Type from eligible firm-configured Bookkeeping plans in Services and Pricing, not a hard-coded second catalog. The dropdown was empty, but configured eligible plans were not established, so absence alone is not a proven defect. Sources M4 and M13; F10.
Confirm a known eligible plan, catalog linkage and filter results; distinguish no configured plans from loading, access or sync errors.
Sync stale after is a staleness threshold, not a sync schedule or start delay. Its visible 48-hour value does not prove elapsed-time behavior. The Upcoming Report Window remains configurable; 14 days was only a recommendation. The separate Overdue after clock, trigger and policy remain open. Preserve firm defaults and client overrides only where the product explicitly supports them; the tested Settings save did not prove inheritance.
4 One contextual navigation contract
All Bookkeeping actions must either stay in the current context or open the correct canonical destination with an exact-origin return. Carry the selected tenant, client/business, Bookkeeping service, reporting period, originating tab or list, search and filters. After Save, Cancel or Back, restore that origin, not generic Bookkeeping home, a generic client profile or an unfiltered module. Main-page actions with no client selected must ask for the recipient or client rather than guess. Enforce destination permissions as well as source permissions.
Route
Review state
Canonical destination and specific requirement
Request Documents
GAP
The quick action opened folders or Documents instead of request creation. Open shared Create Document Request directly in a modal/panel or dedicated canonical flow; prefill Bookkeeping and the known client/business/period. Apply the exact-origin return contract. Do not create a separate request/reminder engine.
Documents tab and row View Documents
GAP
The tab opened general Documents. Open Peter-specific canonical Bookkeeping documents with View, Upload and Request. A correctly scoped external Documents page with breadcrumb/Back is acceptable; a universal inline document-list mandate is not required.
Overview recent document View
APPROVED
Retain the specifically requested inline preview from Overview without losing Bookkeeping context. This is distinct from the accepted external Documents tab/row route. Upload remains canonical and dependent on the existing Documents upload issue.
Add Note and Notes
GAP
The route opened the generic client profile Overview. Prefer the explicitly requested in-place Add Note popup backed by canonical linked-client notes. A direct selected-client Notes composer with exact Back is an accepted alternative nuance; do not send users to a generic profile. Keep internal notes separate from client-message composition.
Tasks and Create Task
APPROVED
Central canonical Tasks filtered and prefilled for the client is accepted, with the exact-origin return contract. Preserve transaction, close, report or request linkage when applicable. No inline-only requirement or additional task automation was approved.
Communications
GAP
The tab exists but opened unfiltered main Communications. Open the selected client conversation/history directly with Bookkeeping context, then return to the precise origin. Do not substitute a generic profile or firm-wide message list. No sending or delivery was tested.
Manage Integrations
GAP
The correct Integrations module opened, but the contextual Back path was missing. Restore the exact originating Bookkeeping view, client, period and filters. Navigation success does not establish genuine provider connectivity.
Reports and other row actions
APPROVED
Use in-context controls or correctly scoped canonical destinations with exact Back. Reports must retain Bookkeeping, client and period context. A route opening successfully or an empty result is not proof of scoping or a completed operation.
Acceptance for this contract: start from both a filtered list and a selected-client tab, exercise each route, then Save or Cancel where safe and authorized and use Back. Verify scope, selected record, current period, list position where supported and filters are restored. Verify a disallowed client cannot be reached by changing a URL or identifier. Do not send a request, message or notification merely to test navigation.
Row action inventory
The visible menu contained View Bookkeeping Profile, Sync Now, View Sync Details, View Synced Reports, Request Documents, View Documents, Create Task, Log Activity, Send Message, Schedule Appointment, Update Bookkeeping Status, Assign/Reassign, Manage Accounts Connection, Pause Bookkeeping Service and Archive Bookkeeping Client. This is a visibility inventory, not a pass for every action. Preserve all functional requirements from M5 and F1; finalize placement rather than assuming every required function must appear in this exact menu.
Categorize Transactions was reported as routing to Reconciliation, but the exact destination still needs confirmation. Categorization belongs in the full transaction workflow; do not label the reported button route as a proven defect before confirming it. Current Period was blank with no period configured; provide clear setup and selection behavior, but do not infer that the sources require automatic period creation.
5 Restore the complete Transactions workspace
GAP T01: Peter’s Transactions page was a blank page with no controls, not merely an empty transaction table. Implement the full F3 to F5 requirements below. Render the structural grid, search/filter and action controls with useful no-data or setup guidance even when no records exist. Disable only actions whose prerequisites are unavailable, explaining why. Missing UI and the unverified integration block substantive tests; they do not prove every backend capability is absent.
Component
Required behavior
Grid and search
Display date, description/payee, account, amount, debit/credit, category, status, type and source. Provide search and filters for date, account, category, amount, status, type, source and vendor/payee.
Categorize and split
Assign chart-of-accounts categories and supported class/location. Support category splits only when the split sum equals the transaction total; show validation rather than silently changing amounts.
Transfer match and exclude
Link both transfer sides without double-counting income or expense. Match feed items to existing transactions where supported. Exclude only under source-platform rules and the user’s permissions.
Documents bulk actions and audit
Attach canonical supporting receipts/documents. Apply bulk categorization or updates only to eligible selected items. Store actor, old/new values, source and timestamp for material changes.
Refunds and chargebacks
Model received refunds, customer refunds issued and chargebacks/disputes as distinct events. Link the original expense, sale or payment where possible; preserve source status, dispute resolution and firm category/contra-account rules. Do not blindly treat an expense refund as ordinary income.
Refund detail and actions
Retain refund ID, original transaction, date, amount, reason, method, processor, status and settlement link. Support source view, link/match, task, note and report inclusion. Filter refund reports by date, processor, customer/source, amount and status.
Settlements and payouts
Retain source settlement ID, processor/connected account, batch period and payout date; separate gross payments, refunds, chargebacks, fees and adjustments. Define net payout according to the provider and show the matched bank-feed deposit.
Settlement states and actions
Support Unmatched, Partially Matched, Matched/Reconciled and Needs Review. Drill into included payments/refunds/fees. Provide Match Deposit, Review Items, Add Note, Create Task and Export/Report with correct source and permission scope.
Acceptance: use known transactions and distinct refund, chargeback, fee and payout fixtures. Test zero rows, search/filter combinations, valid and invalid splits, transfers, supported matching and exclusion, bulk eligibility, receipt linkage, duplicate flags and audit. Reconcile settlement components to net payout and the bank deposit without double-counting. Do not silently delete suspected duplicates or overwrite authoritative source facts.
6 Complete Reconciliation and period close
GAP R01: Reconciliation contained only Add Period with month/start/end controls. The period creation result in P07 is not a reconciliation pass. Restore the full F6 workflow and connect it to source ledger or authorized imported data and the relevant statement.
Stage
Required behavior and gate
Select and substantiate
Select the account and statement period; record beginning and ending statement balances and attach the bank or credit-card statement.
Reconcile
Show eligible transactions, mark cleared items, calculate the difference and surface unmatched, duplicate, refund and settlement exceptions. Persist unfinished work.
Zero tolerance
The user explicitly approved zero reconciliation tolerance. Block approval until the calculated difference is zero at the approved currency precision. Do not silently write off differences or automatically approve. Confirm precision and rounding behavior; zero is a product decision here, not a claim of a universal accounting rule.
Review and approval
Route Ready for Review work to the reviewer. Require authorized approval and a recorded reason for a controlled reopen. A saved period or report entry must not bypass this gate.
Close checklist
Cover categorization; reconciliations; refunds; settlements; documents; adjustments; Profit and Loss; Balance Sheet; open items; reports; reviewer approval; and client delivery.
Close and history
Follow work in progress, review, approval, reports, client delivery and closed period. Version and lock the closed period, retain historical records and permit only controlled audited reopening.
Acceptance: prove account/statement linkage, retained progress after refresh, correct balances and cleared items, zero-difference gating, exception handling, reviewer routing and authorization, approval permissions, completed checklist, version/lock and reasoned reopen. Include a nonzero-difference negative test and an unauthorized approval test. The visible Add Period control supplies none of this evidence by itself.
7 Reports Terms and Activity
Reports remain a financial output workflow
P08 establishes that a report record can persist, not that a statement was computed. Preserve every M8 and F7 report requirement: supported Profit and Loss, Balance Sheet and Cash Flow; General Ledger; Trial Balance; Transaction Detail; Uncategorized; Reconciliation; Refund; Settlement; Bookkeeping Status; and Missing Documents reports. Keep firm-configurable report choices. Refund and Settlement entries were not heard in the walkthrough, but the complete list was not confirmed; do not label them missing on that basis alone.
Observed report controls were All Statuses, Not Started, In Progress, Review, Approved and Delivered, with All Reports, Upcoming and Overdue views. Types heard were Balance Sheet, Profit and Loss, Cash Flow, General Ledger, Trial Balance, Transaction Details, Uncategorized Transactions, Reconciliation Report, Quarterly Review, YTD Summary, Bookkeeping Status, Missing Documents and Custom. The spoken Transaction Details label was uncertain; confirm the UI spelling. This inventory is visibility only, not approval of an exhaustive list or completed report behavior.
Reports need period and source context, supported basis, comparisons and filters, preview, generation, download, send, schedule and mark-reviewed controls. Preserve generated and sent snapshots, report versions and delivery status. Store report type, period, generated and delivered dates, staff member and linked document. Calculate the next report due from cadence and last completed period; notification uses the secure portal and approved channels. Mark Report Complete is not permission to bypass reconciliation or close approval.
Acceptance: generate supported reports from a known source dataset, reconcile amounts and period/basis, verify refund and settlement breakdowns, compare immutable generated/sent versions, and test permitted export, scheduling, review and authorized delivery. Verify next-due calculation and linked completion metadata. The report lifecycle labels seen in the UI are not an approved substitute for these gates.
Terms access and complete service history
GAP E01: No Terms entry was visible in Peter’s workspace. Restore discoverable access to the full Fresh requirements while resolving the overall workspace navigation decision. This is a visible coverage gap, not proof that all underlying billing or agreement capabilities are absent. The Module guide’s omission of Terms does not cancel F2 and F10 to F13.
Terms area
Required scope
Main frame
Provide Terms, Service Details, Billing and Payments, Engagement Documents, Renewal and Notices, and History. Link the package to Services and Pricing. Preserve start/end, auto-renew, scope, pricing, billing terms and internal terms notes.
Service details
Record package defaults and authorized client-specific scope, exclusions, add-ons and fee treatment, deliverables, client responsibilities, firm commitments and authorized scope changes with effective date/history.
Billing and payments
Keep configured frequency, advance/arrears timing, due terms, authorized payment methods/autopay, late-fee rules, discounts/credits and audit. Link canonical Invoices and Payments for refunds/credit memos and invoice/payment/refund history. Link processor settlements where available.
Agreement and payment schedule
Show invoice, period, issue/due dates, amount, status and permitted actions. Provide client-facing agreement preview and authorized Upload Signed Agreement, Send Terms, Download PDF and View Portal Version actions.
Versions renewal and notices
Generate from approved templates and the current terms snapshot; preserve uploaded/signed/e-sign agreement versions, effective dates and status. Track renewal method/date/notice period, price-change notices, termination/non-renewal reason and dates. Create a new version for new terms; never overwrite prior signed terms.
Acceptance: verify all six Terms areas and canonical links, authorized scope/price changes, payment authorization boundaries, agreement snapshots and signatures, renewal/notice timing and immutable prior versions. Do not execute payment, signing, sending or termination actions without appropriate authorization.
Selected client Activity feed
APPROVED A01: Add a visible selected-client-scoped Activity feed or equivalent discoverable access. No Activity Log was visible, although Log Activity was present in the row menu. This is a display/discoverability gap, not proof that backend audit is absent. Preserve M5 to M6 activity coverage and F15 audit coverage for syncs, requests/uploads, status and staff changes, notes, financial edits, categorization, refund/settlement linking, reconciliation, close, reports, terms and integration actions. Verify actor, time, record/context, permitted detail, completeness and tamper resistance; none was established by the walkthrough.
8 Untested baseline and release controls
The original sources remain requirements where the walkthrough did not test them. In particular, retain the following cross-cutting controls rather than interpreting an unreviewed item as out of scope.
Area
Retained requirement
Workspace identity
Use one client bookkeeping workspace with client/business, masked EIN, plan, client-since, status, next report due and current period context. Preserve connection health, assigned staff, outstanding items and recent activity. Search EIN only with permission.
Status rules
Keep All Clients and the six status views on one list with search, filters and pagination. Preserve automatic/manual rules, exact reasons for attention states and audited status changes. Upcoming Reports derives from its configured window; Not Started refers to the current cycle. Manual On Track persistence does not prove rule precedence.
Client documents and portal
Reuse document categories, missing-document checklist, related transaction/reconciliation/settlement links, visibility flags and history. Only approved reports, requests, tasks, notes and documents may appear in the separate Client Portal. Satisfied/canceled requirements stop obsolete reminders.
Settings scopes
Retain firm-level cadence, reminders, status rules, integrations and categories, plus supported client cadence/close target/report schedule/checklist/staff and reviewer/category defaults/reconciliation accounts/portal defaults/alerts. Define inheritance and override permissions; do not treat one scope as a replacement for the other.
Security and audit
Enforce permissions server-side for Bookkeeping/Financials, Categorize, Refund/Settlement Review, Reconcile, Approve Close, Reports, Documents, Terms/Pricing, Integrations, Export and Admin. Respect assigned-client rules and tenant/client isolation; hiding buttons is insufficient.
Error and usability states
Preserve loading, empty, validation, error, responsive and keyboard-accessible states. Explain disconnected, failed/stale sync, missing documents, attention, overdue, difference and unmatched settlement states. Flag suspected duplicates without silent deletion; preserve form state and reconcile concurrent edits.
Commercial configuration and shell
Keep the complete Firm Workspace sidebar from M11 with Bookkeeping highlighted. Reuse the approved shell and source design intent. Do not permanently hard-code one firm’s plans, staff, categories, rules, providers or report types; configure them through the canonical systems.
9 Decisions that remain open
These items require a product decision or targeted confirmation, not an invented default. Preserve the safer existing boundary until a decision is explicit.
Decision
Current boundary
Required resolution
Workspace layout
M6 specifies six tabs; F2 specifies ten. Connections, Activity and combined versus separate Tasks/Notes differ. All functional requirements are retained.
Approve a navigation map, including discoverable Terms and Activity, without deleting either source’s functionality. A full actual tab inventory was not verified.
Note visibility
M requires staff-only notes; F allows explicitly client-visible notes. Routing approval does not authorize sharing.
Define note visibility and permission model. Keep internal notes internal by default, do not expose existing notes, and require explicit per-note client visibility authorization if supported.
Firmivra and Firmvra spelling
This handoff uses Firmivra; the originals differ. No app-wide branding change was approved.
Confirm the canonical product spelling and preserve allowed firm customization boundaries.
Overdue rule and thresholds
Request-sent age for Missing Documents is approved. The separate Overdue anchor and suggested 7/0/14-day defaults are not approved.
Define event, date anchor, threshold, exclusions and precedence. Keep values configurable; do not treat a casual acknowledgment as a fixed policy.
Date and precision conventions
Custom next-report-due range and zero reconciliation tolerance are approved. Inclusive endpoints, timezone, currency precision and rounding are not settled.
Specify these conventions and their boundary tests without changing the zero-difference requirement.
Plan setup and current period
Plan Type is empty without a known eligible plan; Current Period is blank without a configured period.
Confirm setup/selection and empty-state behavior. Do not claim either condition proves a missing backend or auto-creation defect.
Menu and specific routes
Visible menu inventory is known; exact final placement across both guides is not. Categorize Transactions destination remains tentative.
Confirm the actual categorization route and final action placement. Do not infer a missing status option or report type from items not read aloud.
Settings inheritance
Firm settings and client preferences are complementary source scopes. The walkthrough established only tested value persistence.
Specify allowed overrides and their visibility, precedence, access and audit. Do not invent a missing client Settings tab from incomplete inventory.
10 Verification handoff and complete source map
Pending and blocked checks
Test group
Current state and dependency
Completion evidence
Integration and source data
PENDING: real OAuth/provider connection and a trusted dataset were not established.
Close I01 to I03 with authorized provider or controlled fixture evidence, correct mappings, safe sync lifecycle and reconciled source totals.
Transactions refunds and settlements
BLOCKED: blank controls plus unverified integration.
Complete T01 and its full acceptance cases; verify distinct event models, source links, transfer/split rules, bank matching and audit.
Reconciliation and close
BLOCKED: period-only UI and missing substantive inputs.
Complete R01 with a statement and known ledger, zero-difference negative/positive tests, review, approval, lock and controlled reopen.
Reports
PENDING: entry save/refresh passed; financial outputs did not.
Verify section 7 report computations, supported bases, snapshots/versions, correct exports, completion metadata and authorized delivery.
Documents requests and reminders
BLOCKED for actual upload by the existing Documents dependency; view/request/reminder operations remain untested.
Verify canonical upload/preview, client/period links, request creation, approved sent-date aging, stop conditions, visibility and authorized notification.
Notes tasks and communications
PENDING: routes were reviewed, but no note/task save, message send or delivery was proven.
Verify section 4 destinations, exact Back, canonical record linkage, persistence, permissions and explicit audiences before any authorized communication test.
Settings filters statuses and assignment
PARTIAL: only the narrow P02 to P04 and P09 results passed.
Close D01 to D07, then test time-based transitions, multi-filter cohorts, configured plans, override behavior, status audit and permissions.
Terms and Activity
PENDING: Terms and Activity entry gaps; underlying workflows untested.
Complete E01 and A01 with six-area Terms coverage, immutable signed history and correctly scoped, permissioned Activity evidence.
Pause archive and restoration
PENDING: reason prompt only; Archive prompt attribution tentative.
Use authorized test records to verify confirmed actions, reasons, persistence, resume/restore and effects without unintended deletion or financial changes.
Security usability and concurrency
PENDING: no independent server, isolation or full accessibility tests.
Verify section 8 permissions, tamper-resistant audit, cross-tenant/client negative cases, race/network handling, retained form state and keyboard/responsive behavior.
Retest evidence should identify the build, role, tenant/client fixture, period, source, steps and actual result. Record pass, fail, blocked or not tested separately. Do not close a financial test with a screenshot of a shell record, a toast, a visible button or a dummy Connected label. Preserve the narrow passes while retesting affected flows.
Source map
M is Firmivra_Bookkeeping_Module_Developer_Instructions(1).docx. F is Firmvra_Bookkeeping_Developer_Instructions_Fresh(1).docx. The 30 original sections and all content from the 30 original tables are retained in source order. Four single-cell narrative blocks are ordinary paragraphs. M section numbers map to Appendix A and F section numbers to Appendix B. The complete appendix text remains part of the handoff.
Source section
Current review location
M1 Page purpose and primary actions
Sections 2 to 4
M2 Summary cards and panels
Sections 2 to 3
M3 Status tabs
Sections 1 and 8
M4 Filters and client table
Sections 3 and 8
M5 Row actions
Sections 3 to 4 and 7
M6 Client workspace
Sections 4 and 7 to 9
M7 Integration behavior
Section 2
M8 Reports documents reminders
Sections 3 to 4 and 7 to 8
M9 Statuses and automatic logic
Sections 3 and 8 to 9
M10 Permissions and data rules
Sections 2 and 8
M11 Complete sidebar
Section 8
M12 Developer click flow
Sections 2 and 4 and 7
M13 Commercial app requirement
Sections 2 and 8
F1 Bookkeeping Overview
Sections 2 to 4
F2 Client workspace
Sections 4 and 7 to 9
F3 Transactions
Section 5
F4 Refunds and chargebacks
Section 5
F5 Settlements and payouts
Section 5
F6 Reconciliation and close
Section 6
F7 Reports
Section 7
F8 Documents tasks notes communications
Sections 4 and 8 to 9
F9 Bookkeeping settings
Sections 3 and 8 to 9
F10 Terms main frame
Section 7
F11 Terms service details
Section 7
F12 Terms billing and payments
Section 7
F13 Engagement renewal history
Section 7
F14 Integration and sync
Section 2
F15 Permissions audit error states
Sections 2 and 8
F16 Developer acceptance checklist
Sections 5 to 10
F17 Recommended build sequence
Opening implementation order and section 10
Appendix A Module guide
Complete retained original requirements
Source: Firmivra_Bookkeeping_Module_Developer_Instructions(1).docx
This appendix preserves the original body paragraphs and table contents in their original reading order with normalized formatting. Original statements are historical requirements, not additional walkthrough passes. Apply the explicit current decisions above where they differ; unresolved source conflicts remain open.
FIRMIVRA  |  Firm Workspace  |  Developer Directional Guide
Bookkeeping Module
Simple instructions for what appears on the Bookkeeping page, what each control does, and how the workflow should respond.
Core rule: This is one Bookkeeping module. Status tabs (All Clients, On Track, Needs Attention, Missing Documents, Overdue, Not Started, Upcoming Reports) are filtered views of the same client list - do not build a separate page for each tab.
1 Page Purpose and Primary Actions
Area / Button
Developer Behavior
Bookkeeping page
Central work area for recurring bookkeeping clients, accounting integrations, document collection, monthly status, and report delivery.
Connect Accounting Software
Open integration connection flow. User selects provider, authenticates, selects/matches the client, then saves the connection.
Sync All Clients
Start permitted background syncs for connected clients. Update Last Synced, connection status, and any sync error indicators when complete.
Request Documents
Open the existing Document Request workflow with Service prefilled as Bookkeeping and the selected client when launched from a client row.
View Reports
Open Reports filtered to Bookkeeping; allow reports by client and reporting period.
Bookkeeping Settings
Open firm-level bookkeeping settings such as report cadence, reminder defaults, status rules, integration defaults, and permitted categories.
2 Summary Cards and Dashboard Panels
Section
What It Shows / Does
Active Bookkeeping Clients
Count of clients currently enrolled in an active bookkeeping service.
Total Income / Total Expenses / Net Profit
Aggregated values for the selected period from connected bookkeeping data or approved imported data. Respect user permissions.
Clients with Upcoming Reports
Clients whose next scheduled bookkeeping report is approaching.
Client Bookkeeping Status
Chart/counts for On Track, Needs Attention, Missing Documents, Overdue, and Not Started.
Monthly Income vs. Expenses
Visual trend for the selected date range. Firm Admin can change period; data is based on authorized client records.
Connected Accounting Software
Show supported providers, connection status, number of connected clients, and Manage Integrations link.
3 Status Tabs Same Page Different Filter
Tab
Show
All Clients
Every bookkeeping client the signed-in user is permitted to view.
On Track
Active clients with no current overdue items, missing required documents, or unresolved sync/report issue.
Needs Attention
Clients requiring staff review, cleanup, reconciliation, mapping, or follow-up.
Missing Documents
Clients with one or more required bookkeeping documents still outstanding.
Overdue
Clients with overdue bookkeeping work, report, task, or required client action.
Not Started
Clients enrolled in bookkeeping but whose current reporting-period workflow has not begun.
Upcoming Reports
Clients with a bookkeeping report due within the configured upcoming window.
4 Filters and Client Table
Control / Column
Behavior
Search
Search client name, business name, EIN (when user has permission), and allowed bookkeeping metadata.
Client Type
Filter Individual / Business or firm-configured client types.
Plan Type
Filter by bookkeeping package/plan. Plan names come from Services & Pricing and must be firm-configurable.
Accounting Software
Filter by connected provider or Not Connected.
Status
Filter bookkeeping workflow status.
Report Due
Filter by next scheduled report date/range.
Client Name
Open the client bookkeeping workspace for that client.
Business Name
Display linked business/entity; open profile when permitted.
Last Synced
Last successful integration sync. Show error/attention state separately if latest sync failed.
Next Report Due
Next scheduled bookkeeping report date based on client plan/cadence.
Pagination
Same list, paginated. Do not load a separate page per status.
5 Row Actions Three Dot Menu
Action
What Happens
Open Bookkeeping Workspace
Open the selected client's bookkeeping workspace.
Sync Now
Run a sync for that client when an accounting integration is connected.
Connect / Manage Integration
Connect software, reconnect an expired connection, change mapped company, or disconnect if user has permission.
View / Request Documents
Open client bookkeeping documents or create a bookkeeping document request.
View Reports
Open bookkeeping reports for the client.
Mark / Change Status
Set On Track, Needs Attention, Missing Documents, Overdue, Not Started, or other firm-configured status.
Assign / Reassign Staff
Assign responsible bookkeeper/staff if the signed-in user has permission.
Add Task / Note
Create an internal bookkeeping task or staff-only note tied to the client and period.
Mark Report Complete
Record report completion, delivered date, period, and staff member; calculate next report due date.
View Activity
Show syncs, document requests/uploads, status changes, reports generated/delivered, notes, and staff actions.
6 Client Bookkeeping Workspace
When a client row is opened, use one client bookkeeping workspace. The firm does not need a different page design for each status.
Workspace Tab
Contents
Overview
Current period, status, assigned staff, integration health, outstanding items, next report date, and recent activity.
Connections
Connected accounting provider(s), connection health, last sync, reconnect/sync controls, and mapped business.
Documents
Bookkeeping-specific documents and outstanding requests for the client.
Reports
P&L, balance sheet, cash-flow or other firm-configured reports, reporting period, delivery status, and history.
Tasks & Notes
Internal follow-ups, close tasks, cleanup items, and staff-only notes.
Activity
Audit-style bookkeeping activity history for the client.
7 Integration Behavior
Providers shown in the design (QuickBooks Online, Xero, FreshBooks, Zoho Books) are examples; integrations must be modular and not hard-coded as the only providers.
Connection credentials/tokens must be handled securely. Never display secret tokens to staff.
A sync failure must not erase the last successful data. Show an error/attention state and allow authorized retry/reconnect.
Avoid duplicate client/company connections. A firm should intentionally map each integration company to the correct Firmivra client/business.
Financial totals and reports must always stay isolated to the correct firm/tenant and client.
8 Reports Documents and Reminders
Workflow
Developer Rule
Report cadence
Each bookkeeping client can have a monthly, quarterly, annual, or firm-configured reporting cadence.
Upcoming report
Calculate from cadence and last completed reporting period. Show in Upcoming Reports and Next Report Due.
Report completion
Store report type, period, generated date, delivered date, staff user, and linked report document.
Missing documents
Outstanding bookkeeping requests should drive Missing Documents status when configured.
Document reminders
Use the shared document-request reminder engine. Stop obsolete reminders when requirement is satisfied/canceled.
Client notification
When a report is published/shared, notify the client through the secure portal and approved notification channels.
9 Statuses and Automatic Logic
Status
Recommended Logic
On Track
No unresolved critical bookkeeping issue for the active period.
Needs Attention
Staff action required but not yet overdue.
Missing Documents
Required client documents/data are outstanding.
Overdue
Configured report/task/client requirement is past due.
Not Started
Current bookkeeping cycle has not started.
Statuses may be manually changed by permitted users, but Firmivra can also suggest/update status from due dates, missing-document requests, sync errors, and workflow rules. Status changes must be recorded in activity history.
10 Permissions and Data Rules
Firm Admin sees the full Bookkeeping module for the firm and can manage settings/integrations according to plan and permissions.
Staff sees only clients, integrations, reports, and actions allowed by Staff Management permissions and assigned-client rules.
Permissions must be enforced server-side, not only by hiding buttons.
Clients do not use this Firm Workspace page; client-facing bookkeeping documents, reports, requests, and messages appear in their separate Client Portal.
Every record must remain tied to the correct tenant, client/business, reporting period, service, assigned staff, and audit/activity history.
11 Updated Firm Workspace Sidebar
Sidebar Tab
Purpose
Dashboard
Main firm overview
Clients
Master client list
Leads
Lead management
Appointments
Scheduling
Intake Forms
Form workflows
Documents
Firm/client document management
Client Portal
View/manage client portal access
Tax Returns
Tax preparation and filing workflows
Tax Planning & Strategy
Year-round tax planning
Bookkeeping
Bookkeeping workspace - CURRENT PAGE
Payroll
Payroll workflows
Business Advisory & Development
Advisory/development projects
Invoices & Payments
Billing and receivables
Messages
Direct messages
Communications
Bulk email/SMS/campaigns
Tasks
Work tasks
Automations
Workflow automations
Compliance & Deadlines
Due dates and compliance tracking
Reports
Firm-wide reporting
Templates
Reusable templates
Services & Pricing
Firm service/package setup
Staff Management
Users, roles, permissions
Integrations
External software connections
Settings
Firm/workspace settings
12 Developer Click Flow
User Action
System Response
Open Bookkeeping
Load summary metrics, charts, integrations, status tabs, and permitted client list.
Choose status tab
Filter the same list; keep filters/search available.
Select client row
Open that client's Bookkeeping Workspace.
Connect software
Provider auth -> choose/map company -> confirm client -> save -> initial sync -> update connection state.
Sync client(s)
Run permitted background sync -> update data/last sync -> show completion or error state.
Request documents
Open shared document-request workflow -> prefill Bookkeeping + client -> send -> track request status.
View Reports
Open Bookkeeping reports -> choose client/period/report -> preview/download/share if permitted.
Complete report
Save completion/delivery metadata -> link report -> calculate next report due -> update status/activity.
Open action menu
Display only actions permitted for the signed-in user.
13 Commercial and Sellable App Requirement
Do not hard-code LVP Accounting & Taxes plan names, status rules, staff, bookkeeping categories, report types, or integration providers as permanent defaults.
Each firm should configure its bookkeeping services, plans, report cadence, staff permissions, document requirements, reminders, and supported integrations.
The visual shell remains Firmivra; firm branding/configuration applies only where the product design permits customization.
Implementation priority: Keep the Bookkeeping page simple. Reuse shared Clients, Documents, Reports, Tasks, Notifications, Staff Permissions, Integrations, and Activity components instead of creating duplicate systems inside Bookkeeping.
Original footer: Firmivra | Bookkeeping Module | Developer Instructions
Appendix B Fresh guide
Complete retained original requirements
Source: Firmvra_Bookkeeping_Developer_Instructions_Fresh(1).docx
This appendix preserves the original body paragraphs and table contents in their original reading order with normalized formatting. Original statements are historical requirements, not additional walkthrough passes. Apply the explicit current decisions above where they differ; unresolved source conflicts remain open.
FIRMVRA - BOOKKEEPING MODULECOMPREHENSIVE DEVELOPER INSTRUCTIONS
Overview • Client Workspace • Transactions • Refunds • Settlements • Reconciliation • Reports • Documents • Tasks • Notes • Communications • Settings • Terms
Developer review this first
Use the approved Firmvra navy/blue/white design and complete current sidebar. Bookkeeping remains highlighted.
All bookkeeping records are company- and client-scoped. Preserve source-system IDs, sync status and last-sync metadata.
Financial totals must reconcile to source data and identify the period/source. Never fabricate unavailable values.
Refunds, chargebacks, processor fees and settlements/payouts are distinct financial events and must retain source linkage.
Month/quarter close follows work in progress → review → approval → reports → client delivery → closed period.
All material financial, reconciliation, close, report, terms, refund/settlement and document actions are permission-controlled and audited.
1 Bookkeeping Overview
Area
Developer behavior
KPIs
Active clients, income, expenses, net profit and upcoming reports; live and period-aware.
Top Actions
Connect Accounting Software, Sync All Clients, Request Documents, View Reports, Bookkeeping Settings.
Status Views
On Track, Needs Attention, Missing Documents, Overdue, Not Started, Upcoming Reports.
Charts
Client status and income-vs-expenses with drill-down.
Connected Software
QuickBooks, Xero, FreshBooks, Zoho Books and supported integrations; Manage Integrations.
Client Filters
Client type, plan, software, status and report due.
Client Row
Open Client Bookkeeping Workspace.
Row Menu
Sync, Request Documents, Transactions, Reconcile, Generate Report, Statements, Task, Terms, Integration, Pause/Archive.
2 Client Bookkeeping Workspace
Area / Tab
Required behavior
Header
Client/business, masked EIN, plan, client-since, status and next report due.
Overview
Connection, period, KPIs, accounts, uncategorized items, tasks, documents, notes, trends and reports.
Transactions
Full transaction/refund/settlement workspace.
Reconciliation
Bank/credit-card reconciliation and review.
Reports
Statements and bookkeeping reports.
Documents
Bookkeeping document center.
Tasks
Canonical Tasks filtered to client.
Notes
Internal/client-authorized bookkeeping notes.
Communications
Bookkeeping communication history/actions.
Settings
Client bookkeeping preferences.
Terms
Service scope, fees, billing, agreements and renewal.
3 Transactions Page
Control
Requirement
Transaction Grid
Date, description/payee, account, amount, debit/credit, category, status, type and source.
Filters
Date, account, category, amount, status, type, source and vendor/payee.
Categorize
Assign chart-of-accounts category and supported class/location.
Split
Split across categories; split total must equal transaction total.
Transfer
Link both sides and avoid income/expense double-counting.
Match
Match feed item to existing transaction where supported.
Exclude
Use source-platform rules and permission.
Receipt
Attach supporting document.
Bulk Actions
Categorize or update eligible selected items.
Audit
Store actor, old/new values, source and timestamp.
4 Refunds and Chargebacks
Event / Field
Required handling
Refund Received
Link to original expense where possible; do not blindly treat as ordinary income.
Customer Refund Issued
Link to original sale/payment and preserve source status.
Chargeback / Dispute
Separate event with original payment, dispute status and resolution.
Refund Detail
Refund ID, original transaction, date, amount, reason, method, processor and status.
Accounting Treatment
Mapped category/contra account according to firm rules.
Settlement Link
Show settlement/payout containing refund.
Actions
View source, link/match, create task, add note, include in report.
Refund Report
Filter by date, processor, customer/source, amount and status.
5 Settlements and Payouts
Field / Action
Requirement
Settlement ID / Processor
Source identifier and connected account.
Period / Date
Batch period and payout date.
Gross Payments
Gross source amount.
Refunds / Chargebacks
Separate totals.
Fees / Adjustments
Separate components.
Net Payout
Source/calculated net according to provider definition.
Bank Deposit
Matched bank-feed deposit.
Status
Unmatched, Partially Matched, Matched/Reconciled, Needs Review.
Included Transactions
Drill down to payments/refunds/fees.
Actions
Match Deposit, Review Items, Add Note, Create Task, Export/Report.
6 Reconciliation and Close
Step
Behavior
Account / Period
Select account and statement period.
Balances
Beginning and ending statement balances.
Cleared Items
Mark eligible transactions cleared.
Difference
Must meet zero/tolerance rule before approval.
Exceptions
Unmatched, duplicate, refund and settlement items.
Statement
Attach bank/credit-card statement.
Save Progress
Persist unfinished work.
Ready for Review
Route to reviewer.
Approve / Reopen
Authorized approval or reopen with reason.
Close Checklist
Categorization, reconciliations, refunds, settlements, documents, adjustments, P&L, Balance Sheet, open items, reports, reviewer approval, client delivery.
Close Period
Version/lock with controlled reopen.
7 Reports
Report / Control
Requirement
P&L / Balance Sheet / Cash Flow
Core financial statements where source supports them.
General Ledger / Trial Balance
Detailed accounting reports.
Transaction Detail
Filtered transaction report.
Uncategorized Report
Outstanding categorization.
Reconciliation Report
Account/period reconciliation.
Refund Report
Refund detail and totals.
Settlement Report
Gross, refunds, chargebacks, fees, adjustments, net payout and bank match.
Bookkeeping Status / Missing Documents
Operational reports.
Controls
Period, basis if supported, compare, filters, preview, generate, download, send, schedule, mark reviewed.
History
Preserve generated/sent report snapshots and delivery status.
8 Documents and Tasks and Notes and Communications
Page
Required functionality
Documents
Upload/request, categories, missing-doc checklist, link to transaction/reconciliation/settlement, client-visible flag, history.
Tasks
Canonical Tasks; create/assign/recurring; relate to transaction, close, report or document request.
Notes
Internal or explicitly client-visible; author/date/type/related record and audit.
Communications
Email/SMS/portal history and compose from approved templates.
Client Portal
Expose only approved reports, requests, tasks, notes and documents.
9 Bookkeeping Settings
Setting
Requirement
Integration
Connected provider/company/account and sync controls.
Bookkeeping Cadence
Monthly, quarterly or configured.
Close Target
Default close-day/date rule.
Report Schedule
Reports, due dates and delivery method.
Document Checklist
Default monthly/quarterly requests.
Staff
Primary bookkeeper and reviewer.
Categorization Rules
Firm/client defaults.
Reconciliation Accounts
Required accounts.
Portal Defaults
Report/task/document visibility.
Alerts / Automation
Missing docs, stale sync, overdue close and failed integration.
10 Terms Page Main Frame
Section
Required behavior
Tabs
Terms, Service Details, Billing & Payments, Engagement Documents, Renewal & Notices, History.
Service Package
Package from Services & Pricing.
Dates / Auto-Renew
Start/end and renewal behavior.
Billing Terms
Frequency, due terms, preferred payment method and reminders.
Pricing
Monthly fee, setup fee, additional-service billing and authorized late-fee rules.
Included / Excluded Services
Explicit scope checklist and custom details.
Payment Schedule
Invoice, period, issue date, due date, amount, status and actions.
Agreement Preview
Client-facing agreement preview.
Quick Actions
Upload Signed Agreement, Send Terms, Download PDF, View Portal Version.
Notes
Internal terms notes.
11 Terms Service Details
Area
Requirement
Included Services
Defaults from package; authorized client-specific adjustments.
Exclusions
Clearly record not-included services.
Add-Ons
Link Services & Pricing and fee treatment.
Deliverables
Reports, reconciliations, meetings and support.
Client Responsibilities
Documents, access, responses and approvals.
Firm Responsibilities
Defined service commitments.
Scope Change
Authorized change with effective date and history.
12 Terms Billing and Payments
Area
Requirement
Frequency / Timing
Monthly, quarterly, annual; advance/arrears as configured.
Payment Terms
Due on receipt, Net 7/15/30 or configured.
Payment Method / Autopay
Only with valid authorization/integration.
Late Fee
Configurable subject to firm policy/applicable requirements.
Discount / Credit
Authorized adjustment with audit.
Refund / Credit Memo
Link canonical Invoices & Payments workflow.
Payment History
Invoice/payment/refund status and source.
Settlement Reference
Link processor settlement where available.
13 Terms Engagement Documents and Renewal and History
Area
Requirement
Generate Agreement
Create from approved template and current terms snapshot.
Upload / E-Sign
Signed agreement upload or connected e-sign.
Agreement Version
Preserve version/effective date/status.
Renewal
Auto/manual/fixed term, renewal date and notice period.
Price Change Notice
Track effective date and client notice.
Termination / Non-Renewal
Notice, effective date and reason.
New Terms
Create new version; never overwrite prior signed terms.
History
Track terms, package, pricing, agreement, renewal, notice and termination events.
14 Integration and Sync
Scenario
Requirement
Initial Connect
Authorize provider, select company/account and import supported metadata.
Sync
Incremental sync where supported; store outcome and last sync.
Disconnect
Preserve history; stop future sync.
Reconnect
Resume without duplicates.
Failure / Stale Data
Show error/last successful sync and retry.
Mapping
Map accounts/categories/classes where needed.
Conflict
Source-system financial facts remain authoritative unless supported write-back exists.
Write-Back
Only supported provider actions with explicit permission/audit.
15 Permissions and Audit and Error States
Area
Requirement
Permissions
View Bookkeeping/Financials, Categorize, Refund/Settlement Review, Reconcile, Approve Close, Reports, Documents, Terms/Pricing, Integrations, Export, Admin.
Audit
Financial edits, categorization, reconciliation, close, reports, terms, refund/settlement linking and integration actions.
Disconnected / Sync Failed
Show connection/retry state.
Stale Sync
Show freshness warning.
Missing Documents / Needs Attention / Overdue
Explain exact reason.
Reconciliation Difference
Prevent approval until resolved/tolerance met.
Unmatched Settlement
Flag for review.
Duplicate Transaction
Flag potential duplicate; never silently delete.
Permission Denied
Do not expose restricted financial data.
Save / Network Conflict
Preserve form state and reconcile concurrent edits.
16 Developer Acceptance Checklist
Acceptance item
Required result
Overview
Live KPIs, filters, software connections and client routing work.
Client Workspace
All tabs and quick actions route correctly.
Transactions
Categorize, split, transfer, match, exclude, documents and audit work.
Refunds / Settlements
Distinct event models, source linkage, bank matching and reports work.
Reconciliation / Close
Review/approval workflow and historical records work.
Reports
Core, refund and settlement reports generate/version/deliver correctly.
Terms
All six tabs, billing, scope, agreements, renewal and history work.
Integrations
Sync/reconnect/error/stale behavior is safe and duplicate-resistant.
Security
Permissions are server-side and client/company isolation is enforced.
UX
Loading, empty, validation, error, responsive and keyboard-accessible states are implemented.
17 Recommended Build Sequence
Define client bookkeeping, account, transaction, refund, settlement, reconciliation, close-period, report-version, terms/agreement and audit data models.
Build Overview and client list/filter/action behavior.
Build Client Bookkeeping Workspace and all tab routing.
Implement integration sync normalization and source-ID mapping.
Build Transactions including categorization, split, transfer and matching.
Build refund, chargeback and settlement/payout models and bank matching.
Build Reconciliation and month/quarter Close workflow.
Build Reports including Refund and Settlement reports and report versioning.
Connect Documents, Tasks, Notes, Communications and Client Portal.
Build Settings and Terms pages with Services & Pricing / Invoices & Payments / e-sign links.
Complete permissions, audit coverage, error states, accessibility and end-to-end financial reconciliation QA.
Final developer note: Bookkeeping should operate as a coordinated workflow over connected accounting/payment data. Source financial facts, client scope, audit history, report versions and engagement terms must remain traceable from import through reconciliation, close and client delivery.
