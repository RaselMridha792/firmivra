<!-- Octavia's Payroll review of Oct 25, 2026, converted from her .docx (tables flattened). Original wording kept. -->

Firmivra Payroll Developer Review
Review date 25 October 2026
Retain the successful behavior below, implement the recorded fixes and approved changes, and provide evidence for the blocked checks. Results come from the user-operated Payroll review; a display or navigation success is not an end-to-end payroll pass.
No real provider authorization or sync, payroll calculation or submission, tax filing, payment, service pause, archive or billing change was validated. The original 29-section guide remains the reference; this is the focused review handoff, not a replacement specification.
Successful saved checks
These five internal checks saved and remained after refresh. Each success is limited to the tested value or record.
ID and status
Successful check
Scope of the result
S01
SUCCESSFUL
Firm reminder setting
The selected reminder value saved and remained after refresh.
Limit: Applies only to the tested value, not reminder scheduling or delivery.
S02
SUCCESSFUL
Payroll Internal Note
The in-place note saved and remained after refresh.
Limit: Client visibility, access controls and audit evidence are separate checks.
S03
SUCCESSFUL
Client staff assignment
The Payroll assignment saved and remained after refresh.
Limit: Applies to the tested Payroll assignment; role restrictions and audit evidence are separate checks.
S04
SUCCESSFUL
Manual client workflow status
On Track saved and remained after refresh.
Limit: This is client service health, not provider processing or payment status.
S05
SUCCESSFUL
Internal Log Activity
An internal Payroll review test activity saved and appeared in the Notes/Communications card on the client Payroll Overview after refresh.
Limit: Author/time, complete audit logging and notifications were not confirmed.
Successful navigation and display checks
These checks succeeded at the stated UI level. The limits below prevent them from being mistaken for saved-data, provider or financial validation.
ID and status
Successful check
Scope of the result
S06
SUCCESSFULUI check
Client report and run routes
Selecting a client in View Reports and choosing Open Report reached that client’s Reports. View Tax Filings opened the same client’s empty Filings tab. Upcoming Runs View All stayed in the same client’s Payroll Runs.
Limit: Navigation only. No report/filing content or payroll run was verified; the run-list structure needs F09.
S07
SUCCESSFULUI check
Client tab context
Payroll Documents and Communications tabs retained the client. Tasks displayed “No tasks for this client.”
Limit: Context/empty display only, not known-record filter accuracy. Create Task and Open Messages still need F04–F05.
S08
SUCCESSFULUI check
Main Request Documents
The unscoped main Payroll action opened All Requests. The user accepted this as correct.
Limit: The earlier main-route complaint is retracted. Keep this separate from the client Overview defect in F02.
S09
SUCCESSFULUI check
Manage Integrations navigation
Connected Providers → Manage Integrations opened Integrations.
Limit: Navigation only; contextual return needs F10. No real connection passed.
S10
SUCCESSFULUI check
Employee and contractor forms
Add Employee opened its form; Add Contractor automatically selected Contractor. Identity, work type/status, pay, role/date and readiness controls were visible.
Limit: Form/default only. No worker save or provider write-back passed; readiness controls do not prove bank/provider verification.
S11
SUCCESSFULUI check
Frequency and client Settings
Change Payroll Frequency exists under More Actions with Weekly, Biweekly, Semi-Monthly and Monthly choices. Settings showed frequency, provider, staff, industry, plan/service and next payroll date.
Limit: Display only, except the separate saved staff-assignment check. Other settings saves and provider calendar changes were not established.
S12
SUCCESSFULUI check
Report form and categories
Add Report showed type, period start/end and linked Document. Types included Payroll Register, Earnings, Deductions, Employment Tax, Tax Filing, Payroll Journal, Labor, W-2/W-3, 1099 and Other.
Limit: Display only. No eligible linked document was available; record save/preview is blocked under B01.
S13
SUCCESSFULUI check
Overview and list controls
Top actions, KPI/chart/provider panels, workspace tabs and lower Overview panels were visible. Lower client filters responded; clearing Search restored the list; changing the main period selection updated the UI.
Limit: Display/response only. Exact positive search matching, cohort/date-boundary accuracy and financial totals were not established.
S14
SUCCESSFULUI check
Archive confirmation semantics
Archive asked for a reason and warned that the service leaves active Payroll views while the client/history are retained. The user accepted this wording.
Limit: Dialog only; no archive, restore or persistence was tested. Archive is not an implied billing stop.
S15
SUCCESSFULUI check
More Actions keyboard dismissal
Escape closed the More Actions menu.
Limit: This single response is successful; it is not a full keyboard, focus or accessibility pass.
Fixes and approved changes
FIX REQUIRED identifies an observed issue. APPROVED CHANGE records the user’s requested behavior. VERIFY AND ALIGN preserves a location-specific ambiguity that still needs resolution.
ID and status
Check and evidence
Developer action and retest
F01
FIX REQUIRED
Connection and sync state
Connect reported “Provider connected” although no real integration occurred. Gusto Sync Details then showed Connection Connected, Sync Status Not Connected, Last Sync Never and Last Attempt Never.
Source Guide sections 8, 24, 27
Action: Do not imply authorized connection without verified authorization and the correct firm, client and provider company mapping. Distinguish connection health from sync-job state; use clear demo or pending labels where applicable and event-derived timestamps.
Retest: With controlled provider evidence, confirm consistent connection/sync states and that success/timestamps appear only after the corresponding confirmed event.
F02
FIX REQUIRED
Client Request Documents
Client Overview Request Documents opened general Documents and lost the selected client.
Source Guide sections 7, 10, 12, 23
Action: Open the shared Create Request modal or panel in place. Retain selected client/business, Payroll service and known period; Save/Cancel must stay on the current tab. The unscoped main Payroll → All Requests route is accepted and must not be changed to require a selected client.
Retest: From a client Overview, confirm context before any authorized save or cancellation and confirm the exact origin remains unchanged.
F03
VERIFY AND ALIGN
Client document upload
Overview Upload reached the correct client-profile Documents destination, where no Upload control was reported. Request/Upload were later visible in the Payroll Documents tab; these are different locations, so a global missing-upload claim is not established.
Source Guide sections 13, 23
Action: Provide a working canonical client upload path. The user prefers an in-place upload popup retaining client/Payroll context; if an external route is retained, preserve exact-origin Back. Use the same client Documents record, not duplicate storage.
Retest: Check both entry points with an authorized non-sensitive test file; verify successful save, visibility after refresh and correct client ownership.
F04
FIX REQUIRED
Create Task context
Client Overview Create Task opened canonical Tasks without the selected client prefilled.
Source Guide sections 7, 10, 12, 23
Action: Pass selected client/business, Payroll service and known period to task creation. Preserve exact-origin Back/Close. An in-place task modal was not required.
Retest: Open from the client Overview and confirm context and return behavior; use authorized test data for any save verification.
F05
FIX REQUIRED
Messages client scope
The Communications tab retained the client, but Open Messages opened all messages and lost the selected-client scope.
Source Guide sections 7, 10, 23
Action: Open the same client's canonical conversation/history with Payroll context. Add the user-requested manual client selector/filter in main Messages and preselect the current client when entering from Payroll. Preserve exact-origin Back; its current absence was not independently established.
Retest: Enter from two permitted client workspaces, verify preselection and the manual filter, then return to each origin without sending a message.
F06
APPROVED CHANGE
Payroll Status links
The user requires the six Payroll Status summary labels to link to the corresponding filtered list; a failed click was not established.
Source Guide sections 3, 4 plus review decision
Action: Make On Track, Processing, Action Required, Past Due, Not Started and On Hold hyperlinks to the same permitted client dataset, preserving the current reporting period. This instruction does not make every KPI card a required link.
Retest: Select each label and reconcile the filter and visible cohort with the matching status.
F07
FIX REQUIRED
Client row action menu
The dropdown was clipped inside the scrollable client list, requiring underlying table scrolling to reach actions.
Source Guide sections 7, 28
Action: Render the anchored menu outside the table's overflow clipping. Keep it within the viewport and use the menu's own scrolling when needed; preserve keyboard navigation, focus and dismissal.
Retest: Open menus near each viewport edge without scrolling the table to reach options; test keyboard access and dismissal.
F08
FIX REQUIRED
More Actions indicator
The client More Actions control displayed two dropdown arrows.
Source Review observation
Action: Remove the duplicate arrow and retain one accessible dropdown indicator without changing the action list or behavior.
Retest: Confirm one indicator at supported widths and unchanged menu behavior.
F09
FIX REQUIRED
Payroll Runs empty state
The selected client's empty Payroll Runs view showed only Run Payroll, with no table headings or list controls.
Source Guide section 15
Action: Provide the run-list structure and a clear empty state: run ID/period, pay date/frequency, worker count, confirmed financial totals, Firmivra status, separate provider status where needed, and supported actions. Explain missing/not-synced data rather than implying factual zero totals.
Retest: Check the no-data view and a controlled sample with upcoming and historical runs, including immutable completed history. This finding does not establish that the five-stage Run Payroll workflow is missing.
F10
FIX REQUIRED
Manage Integrations return
Manage Integrations opened Integrations successfully, but no contextual Back or breadcrumb was present.
Source Guide sections 3, 10 plus review decision
Action: Add a return to the exact originating Payroll list or client context, preserving period, filters and selection.
Retest: Enter from each supported Payroll origin and return without losing context.
F11
FIX REQUIRED
Schedule Appointment context
Client More Actions → Schedule Appointment opened general Appointments without the selected client prefilled.
Source Guide sections 7, 10
Action: Use shared appointment creation with the selected client/business and Payroll context. Preserve exact-origin Back. An in-place appointment form is a possible design option, not an explicitly required behavior.
Retest: Open from a client workspace, verify client and context, then cancel and confirm return without creating or sending an appointment.
F12
APPROVED CHANGE
Payroll Plan or Service selection
Change Payroll Plan/Service currently provides free text and Save; the user approved replacing free text with a configured dropdown.
Source Guide sections 7, 10, 23
Action: Populate eligible Payroll plans/services from canonical Services & Pricing using stable IDs. Link the selection correctly to the client service assignment and invoicing configuration; do not create a separate text catalog or trigger an invoice/charge merely by selecting a plan.
Retest: Verify the available choices and stable service linkage with controlled internal data. Plan save and effective-date behavior remain unverified; no missing effective-date field was established.
F13
APPROVED CHANGE
Pause service and future billing
Pause Payroll Service opened a reason dialog only; no pause was confirmed. The user requested separate future-billing controls.
Source Guide section 7 plus review decision
Action: Retain a reason and add a separate Stop Future Billing toggle. Default the stop date to the next billing date, with a user-selected custom date option. Link to canonical client service/billing with permission, confirmation and audit safeguards. Keep service pause separate from billing stop and from provider payroll.
Retest: Inspect confirmation of each combination and date without executing a financial change. Verify authorized test transitions separately. Existing invoices, refunds, proration and restart behavior remain unresolved; do not invent their treatment.
Blocked checks for developer confirmation
These items need the named document, safe draft, provider setup or controlled test evidence. They are not claims that the features are absent.
ID and status
Check and evidence
Developer action and retest
B01
BLOCKED
Report files and upload dependency
Add Report requires a linked Document, but no eligible file is available. Actual upload also awaits the shared Documents flow; the two upload entry points produced different observations.
Source Guide sections 13, 21, 23
Action: Resolve the canonical upload/document dependency and supply an authorized non-sensitive report file. Revisit report save, refresh and preview in review 2, as requested.
Retest: Verify client ownership, period/type, persisted record and readable file. Do not treat the empty picker as proof of a defect without eligible data.
B02
BLOCKED
Five stage payroll review
There is no existing safe test run and no verified draft-only, non-executing entry. Run Payroll was visible but was not opened. This is not evidence that the workflow is missing.
Source Guide sections 15–19
Action: Provide a safe demo/draft record and clearly non-executing review route for Payroll Period, Employees and Hours, Earnings and Deductions, Taxes and Employer Costs, and Review and Approve.
Retest: Show the pay grid, validation/exceptions, source/formula labels, draft behavior and separation of internal approval from provider submission. Do not execute payroll to obtain review evidence.
B03
BLOCKED
Provider and source backed outcomes
The reviewed provider is an unverified test shell; genuine authorization, company mapping, sync and provider-backed records are unavailable. Financial processing, payments and filings have not passed.
Source Guide sections 3, 14–15, 18, 20–22, 24
Action: Provide authorized provider setup or controlled imported data, as applicable, for capability gating, sync/freshness, worker write-back, confirmed totals and immutable run history, filing/payment references, real report files/exports and year-end reconciliation.
Retest: Verify source accuracy, report permissions/visibility/history, year-end versions and permitted delivery. Keep statutory dates under Compliance and Deadlines; internal workflow completion must never imply provider Filed/Paid.
B04
NEEDS VERIFICATION
Controlled acceptance evidence
A single-user UI walkthrough cannot establish server-side isolation, protected financial/download access, secret handling, complete audit records or provider failure safeguards.
Source Guide sections 9, 25–28
Action: Provide role/test accounts and a controlled harness for permissions, audit, firm-configurable rules, notification delivery, capability restrictions, stale/empty/error states, save conflicts, safe retries and duplicate-submission protection.
Retest: Include responsive and full keyboard/focus accessibility evidence. Preserve the narrow Escape success; do not label unverified behavior a demonstrated defect.
Completion evidence
Return results against the IDs above with the test setup, observed outcome and any remaining blocker. Keep approval, submission, filing and payment evidence separate. Do not broaden a narrow success or convert an unverified capability into a missing-feature claim.
