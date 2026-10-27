<!-- Octavia's Tax Returns review of Oct 25, 2026, converted from her .docx (tables flattened). Original wording kept. -->

Firmivra Tax Returns
Consolidated developer review
25 October 2026 | Firm Workspace | First review
Preserve the working features and complete the gaps
Please implement the corrections and approved additions below, keep the working behavior, and verify the remaining original requirements. This package covers the complete original 24-section guide, including requirements that were not tested during the walkthrough. It is not final acceptance of the Tax Returns module.
Result
How to read this review
PASS
Octavia reported the specific behavior during the guided walkthrough. A narrow pass does not prove every related path, persistence, permission or integration.
FIX
A reported defect or missing control on the tested route. Do not assume the entire backend feature is absent.
APPROVED
A requested development change or clarification, not a statement that it has been built.
BLOCKED / PENDING
A dependency prevented testing, or the requirement was not exercised. Keep it open without labeling it failed.
CLARIFY
An implementation decision or source mapping still needs confirmation. Do not silently invent policy.
Scope and source priority
Parts 1–10 record the review and superseding decisions. Part 11 maps all original sections. Appendix A retains the original requirements in full; apply the explicit review changes when they differ, especially nonblocking manual warnings, contextual actions, and mandatory tracking for mailed returns. The original source file remains unchanged.
The walkthrough used dummy return records under an Owner account. Manual transmission and acknowledgment entries are recordkeeping tests, not evidence of actual IRS or state submission. E-signature delivery, imports, real uploads and live filing remain unverified.
Suggested implementation order
Repair contextual navigation and layout; connect canonical documents and intake; enforce review and rejection rules; add business identity, manual amounts and tracked-mail recording; then complete dependent tests and the full original acceptance checklist.
1 Working behavior to preserve
Result and area
Observed behavior and limit
P01 PASSCreate and filter
Created a Personal test return, saved entered details, saw In Preparation and reopened its information. Personal view included it; Business view excluded it. Other filter combinations, counts, search and date ranges are not fully verified.
P02 PASSCreate controls
Create New Return opens. Five tax types are present: Personal, Business, Quarterly, Amended and Prior Year. Selecting Quarterly displays Q1–Q4. This is a conditional-field display pass, not a saved quarterly workflow.
P03 PASSOverview tasks
Add Task and View All Tasks respond; marking a task Complete worked. View All Tasks opens Tasks, but contextual Back is missing. Full task-action coverage and linkage remain pending.
P04 PASSReturn navigation
Back to Returns returns from the client return to the main return list. Recent Activity displays; View All Activity remains within Tax Returns. View Workflow opens Review; workflow correctness is not established by that route alone.
P05 PASSPreparation
Added preparation checklist items, ticked completion and retained items/states after refresh. Added notes and retained them after refresh. This does not establish unlimited item capacity.
P06 PASSReview controls
Review checklist ticks update. Added named approval steps with self/another approver. Return to Preparer accepted a note and displayed the returned state and missing-questionnaire reason. Review checklist/approval refresh persistence was not separately confirmed.
P07 PASSManual filing record
Record Transmission required a submission ID and date and displayed Transmitted after a manual entry. Premature Accepted transition was blocked; after manually recording Accepted acknowledgment, progression to Accepted and Closed worked. Real provider processing was not tested.
P08 PASSClosed status lock
A closed return blocked Change Status with a closed-return message. Preserve that behavior. This does not authorize locking every metadata, notes or document action, and does not define a reopening policy.
Federal and state record controls were visible; separate successful save and independent outcomes for every jurisdiction were not proven. Source sections 13 and 19 still require supported confirmation before presenting an actual agency outcome.
2 Additional passes and navigation results
Result and area
Observed behavior and limit
P09 PASSNotes and activity
Added two notes in Notes & Activity; activity displayed the actions performed. Audit/Activity opens its side panel from row actions. Completeness, restricted visibility and final-tab refresh persistence remain pending.
P10 PASSAmendment
Amend asks for a reason and creates a separate amendment without changing the original, per user report. Verify mandatory original linkage, changed-item history, persistence and new filing/signature requirements separately.
P11 PASSDuplicate
Duplicate / Carry Forward worked as a user test. New-year mapping, restricted metadata copying and duplicate prevention remain pending. Preserve the source’s optional, permission-controlled scope.
P12 PASSArchive
Archive confirmation appeared and the test return left the active list. Restore has not been tested because an accessible archived filter/view is still needed.
P13 PASSEdit and assign
Edit Return Details opened saved information; both closed and open duplicate records offered Return Type, Filing Status and Due Date only. Assign/Reassign responds and was reported working; persistence and cross-role enforcement remain pending.
P14 PASSReports
Print/Export List was reported working with return/status output; exported content was not independently checked. Generate E-File Report opens its report popup; completeness and accuracy remain pending.
P15 PASSHelpful links
Filing Deadlines & Compliance opens Compliance & Deadlines. Client Document Checklist opens Templates. Common Tax Forms opens. State Tax Agencies was clarified as FTA. Exact external destination/content and destination-module functionality are not fully verified.
P16 PASSIntegration route
Import Return and Bulk Upload explain that an approved tax-software connection is required; Open Integrations reaches Integrations. No integration is connected, so actual import and bulk-import behavior remain blocked.
P17 PASSOther routes
View Client Profile opens the linked profile; Documents opens the client documents area. E-File Transmission Details opens its destination. E-Signature View routes to FirmSign. These are navigation passes, not completion of the destination workflows.
Errors Information was mentioned without a distinct test result. Helpful-link configuration remains untested. Do not mark Templates, Compliance & Deadlines, Integrations or FirmSign fully reviewed solely because a link opens them.
3 Layout and contextual navigation corrections
ID and before
After and acceptance direction
F01 FIXClient Details overlap
Before: email/address and client information overflow behind the Document Checklist card. After: wrap long content and correct card sizing/spacing at supported widths so every field remains readable. Octavia will provide the illustrative screenshot separately.
F02 FIXClipped row menu
Before: the long three-dot menu is trapped inside the return-list scroll area and requires table scrolling. After: render it above/outside that clipping container, anchored to its trigger like the working New menu. Fit the viewport, allow dismissal and keyboard access.
F03 FIXContextual Back
Before: external module routes lose the originating return. After: provide breadcrumb/Back to the exact Tax Returns list or client return, tab and permitted context. Preserve filters/position where appropriate and guard unsaved work. Existing Back to Returns already passes.
F04 FIXClient Portal route
Before: Client Portal opens Clients. After: open the firm-side Client Portal scoped to the same client and permitted return content, with a return path. Do not impersonate the client or expose private staff material. The portal module is still a dependency.
F05 APPROVEDOverview composer
Before: Send Message goes to client Messages and requires another New Message click. After: open the shared client/return composer in place from the return Overview; Save/Cancel/close keeps the return context. Actual delivery is still untested.
F06 APPROVEDAppointment action
Before: Create Appointment leaves the return for Appointments. After: use the shared client/return-prefilled appointment creation panel in the Overview. Separate full-calendar navigation may leave the workspace with contextual Back.
F07 APPROVEDRow action routes
Latest direction permits row-menu Request Client Information to open Documents or Messages, and Send Message/Schedule Appointment to use their destination with Back. Preserve client/return context. This row-menu allowance does not cancel the approved in-place Overview and Upload/Request flows.
Edit Client Details may open the canonical client editor/profile with Back and an unsaved-change guard. FirmSign may remain its canonical destination, with a breadcrumb and Back that restores the originating return’s E-Signature tab.
4 Canonical document and intake connections
ID and before
After and acceptance direction
F08 FIXUpload and Request
Before: buttons in Overview and Intake & Documents only navigate to the client Documents section. After: open the shared Upload or Request modal/panel directly inside the current return/service. Prefill client, return, year/period and appropriate service; preserve context on Save, Cancel and close.
F09 APPROVEDOne saved record
A successful upload/request must be the same canonical record in central Documents, the client profile, the linked return/service and relevant firm-side Client Portal views. Show it in the correct folder/type and client search. Do not create duplicate file stores or assume every client file belongs to every return.
F10 APPROVEDClient upload entry
Provide the same canonical Upload action in the client’s Documents section and each applicable service workspace. Retain Request separately. A request is not an uploaded file; link the received file when fulfilled.
F11 FIXIntake Form card
Before: Intake & Documents shows documents but no usable submitted intake form entry. After: add an Intake Form card linked to the correct client and this return’s year or quarter. Do not hard-code 2025. Open all submitted details and support Request Correction to the client.
F12 BLOCKEDLink Document
The dialog opens but the dummy client has no uploaded files, so no document can be selected. Repair the existing upload/type dependencies, then verify selection, role, jurisdiction, save and retrieval. Empty results alone do not prove Link Document is defective.
Keep the existing link metadata
Observed Role in This Return options: Draft, Signature Form, Filed Return, Acknowledgement, Voucher, Payment Proof and Extension. The Jurisdiction field showed US/state-code context; accepted values and validation were not tested. Preserve supported source-document associations as required by the original guide; do not infer the observed list is exhaustive.
Intake and privacy acceptance
Retain the canonical submitted form and its correction/version history. Intake submissions must not be silently converted into uploaded files. If no matching submission exists, show a truthful empty state with a permitted link/request path; exact empty-state controls need confirmation. Returning from the form must restore the return context.
Client-facing visibility requires an explicit eligible share or assignment. Internal notes, workpapers and other private staff records remain private. Central client/year/return permissions apply to each view, count, link and file URL.
The document checklist showed dummy requested items. No upload date was expected because no file had been received. Final request delivery and file receipt were not verified.
5 Tasks assignments and editable return details
ID and before
After and acceptance direction
F13 APPROVEDInline task status
Before: the Overview task shows Pending but changing status requires central Tasks. After: provide a status dropdown that uses the same configured task statuses, transitions and permissions. Update the same task record and history.
F14 APPROVEDTask action menu
Mirror the canonical task menu in Tax Returns and other service Overview task lists: View; Edit; Mark as In Progress; Mark Complete; Reassign; Change Due Date; Change Priority; Duplicate; Convert to Recurring; Save as Template; Cancel Task; Archive Task.
F15 APPROVEDTask action context
Use the shared action dialogs in context so routine changes do not require leaving the service. Actions must use canonical IDs and permissions; Duplicate intentionally makes a new task. Full Tasks navigation needs Back. This is not a new recurrence or automation engine.
F16 CLARIFYTax year editing
Both open and closed test editors expose only Return Type, Filing Status and Due Date. Source section 7 includes permitted tax year metadata. Provide or identify an authorized tax-year correction path, with duplicate and filed-history safeguards. Do not simply relabel a filed record.
F17 CLARIFYSeparate controls
The guide says editable metadata “such as” year, staff/reviewer and notes; it does not require all fields in one dialog. Assign/Reassign and Notes can satisfy their respective editing paths. Confirm constraints by lifecycle state and permissions.
F18 APPROVEDAssignment authority
Only the assigned reviewer may Approve or Return to Preparer, except an Owner/Admin with the configured override access. Authorized reassignment transfers eligibility to the new assignee. The previous assignee loses it unless independently authorized.
The Owner could approve another assigned person’s step; this is not enough to prove a permission defect. Verify a non-owner/non-override account separately. Hide or disable unauthorized controls and enforce the same decision server-side.
Apply equivalent assignment/override checks to assignment-sensitive task and schedule changes. Do not interpret this as a blanket restriction on all team visibility or collaboration. Prevent unauthorized reassignment from becoming an approval bypass and retain actor, reassignment and override history.
6 Review validation and rejection corrections
ID and before
After and acceptance direction
F19 APPROVEDLinked review issues
Before: Add Approval Step asks only for a step name and approver; the issue severity is disconnected from validation. After: let the authorized reviewer create/link a validation issue when identifying a problem or returning it to the preparer. Link the note, severity, responsible person and return/version.
F20 APPROVEDSeverity meaning
Error represents a blocking critical issue and must prevent Ready to File/transmission. Manual Warning means review-needed but nonblocking; Info is nonblocking. This explicit manual-warning decision supersedes the original configurable blocking option. Retain the original review requirement; the exact manual warning acknowledgment workflow remains to be confirmed.
F21 CLARIFYResolution controls
Confirm exact issue-entry placement, required fields, resolution authority and how correction/re-review clears an issue. Do not allow a manual Valid label to erase an unresolved blocker or falsely claim provider/IRS-schema validation.
F22 FIXRejection details
Before: More Actions > Move to Rejected changed the displayed status to Rejected without a reason dialog. After: collect or link a valid acknowledgment containing agency/jurisdiction, rejection code/description, timestamp and corrective action before recording the rejection.
F23 PENDINGRejection history
Displayed Rejected is confirmed; refresh persistence and any existing acknowledgment link were not checked. A transition before transmission may be a gap, but the exact prior attempt/history on this dummy is not established. Inspect that history before declaring a bypass.
F24 ORIGINALCorrection and retry
Retain the rejection attempt; create/link a corrective task and owner. A later retransmission gets a new attempt ID/time without replacing the rejected history. These source requirements remain untested, not automatically missing.
The missing-preparer-questionnaire example is a review issue, not an automatic tax-law rule. The illustrative Schedule C/1099 conversation does not define validation logic. Real provider-required errors cannot be downgraded or bypassed by manual warning labels.
The Review/E-File screen displayed one critical error; that is a display pass only. Verify actual filing/readiness blocking, required approvals/signatures, version-specific approval and material-change invalidation. Preserve all reviewed/generated/filed/signed artifacts.
7 Filing records paper filing and amounts
ID and before
After and acceptance direction
F25 APPROVEDFiling method
Provide E-Filed or Mail recording for the return and each relevant jurisdiction if methods differ. The original guide already requires this distinction; the current field location was not fully verified. Do not label mailed returns electronically transmitted.
F26 APPROVEDTracked mailing
For Mail, require a tracking number before logging Mailed or completing/closing the paper filing. No untracked exception was approved. Label it Mail Tracking Number, not an electronic submission ID. Mailed date and evidence/confirmation controls are recommended details to confirm.
F27 APPROVEDMailing report
Add Mailing Report to main Quick Actions for tax returns sent by mail. Report permitted paper-filing records and their tracking/status information. It is not a marketing mailing list. Exact report columns and export behavior need specification.
F28 FIXManual amount entry
Before: federal/state amount summary is visible but no usable Add/Edit Amount control was found. After: allow authorized manual recording of refund or amount due by jurisdiction using the external tax-software result. Keep source/version, estimate labels and audit history.
F29 CLARIFYAmount controls
Recommended UI: explicit Refund or Amount Due choice with amount/currency, rather than ambiguous signed numbers. Exact fields and validation need agreement. Multi-state summary population, save and refresh remain pending.
F30 ORIGINALRecord versus submit
Keep manual external-software recordkeeping separate from actual supported submission. Require separate permission and confirmation for real Transmit. Manual test IDs/acknowledgments are not provider proof. Actual integrations are a later dependency.
Tracking proves neither delivery nor tax-authority acceptance. Preserve evidence and prior attempts when changing filing method; do not erase an earlier electronic rejection. Required jurisdiction outcomes must be resolved under firm policy before closing; paper tracking is necessary but is not a substitute for other required outcomes.
Federal and state outcomes remain independent. Store actual source and dates for real filing records and clearly distinguish test/manual entries. No tax payment, refund transfer, bank change or live filing was performed in this review.
Extensions remain linked records with original filing and payment deadlines retained. A filing extension does not automatically extend payment. Do not redefine the return due date as a processing turnaround without an explicit separate field and agreed meaning.
8 Return types archive and future configuration
ID and before
After and acceptance direction
F31 APPROVEDBusiness identity
Before: Business Tax creation shows the Personal-style fields without business identity. After: add Business Name, Business EIN and Business Address for the business return. Keep the existing states, preparer, reviewer and due-date fields.
F32 CLARIFYCanonical business
Use the selected client’s correct business/entity record to populate identity where possible. Define authorized edits versus historical return snapshots; do not create an unrelated duplicate or match by name alone. Mask/restrict EIN. No business return save was tested.
F33 PASS LIMITEDQuarterly selector
Selecting Quarterly displays Q1, Q2, Q3 and Q4. Preserve this. Period-specific due dates, amounts, statuses, vouchers, confirmations and any firm-defined period support remain pending.
F34 APPROVEDArchived filter
Before: Archive removes the record, but an accessible archived list/filter was not found. After: add an Archived visibility filter/view so authorized users can locate and restore archived tax returns. Preserve Accepted/Closed and other filing statuses separately from archived visibility.
F35 PENDINGRestore
Test restoration from the new archived view, correct permissions and retained history. The archive confirmation mentioned restoration, but Restore itself was not tested.
F36 CLARIFYService configuration
The owner discussed renaming, hiding/disabling and adding preset service choices. Preserve original firm-configurable types/workflows/statuses/roles/integrations; confirm the exact service-tab management location and behavior before expanding this Tax Returns scope.
The user-reported amendment and duplicate passes do not establish all amended/prior-year rules. Preserve original links, reason, changed items, new authorizations/filing where required, year-specific rules and history. Never replace the original filed return.
The current role is Owner. Delete was not present or tested; its absence is not automatically a defect because the original guide conditions it on elevated permission, confirmation, retention and audit rules. Do not add unrestricted deletion or use Archive as destructive deletion.
Keep one Tax Returns dataset. All Returns, Personal, Business, Quarterly, Amended and Prior Year are views. Tax Planning & Strategy and Business Advisory & Development remain separate sidebar modules.
9 Remaining tests and dependency boundaries
Area and status
Next verification after the relevant prerequisites
BLOCKEDDocuments
Complete type/upload fixes, then upload an authorized dummy file; verify canonical client/return/year/folder/type linkage and client-visible permissions. Test Link Document across Intake, Preparation, E-Signature, E-File and Payments & Refunds.
BLOCKEDImports
Connect/review an approved integration through its authorized setup. Verify preview, matching, duplicate warnings, metadata, errors, per-record results and import log. Current routing pass does not verify Import Return or Bulk Upload.
PENDINGFirmSign
Review the separate FirmSign module, then verify request/envelope IDs, authorization statuses, timestamps, signed copy/certificate, reminders, decline/expiry/void/resend history and Back to Return.
PENDINGIntake and requests
Verify full correct-year/quarter submission viewing, correction request/version history, empty state and actual request/notification delivery. Intake Form card and inline flows must be implemented first.
PENDINGReview gates
Use authorized test accounts/records to verify preparation prerequisites, approval/signature/critical-error blocking, warning behavior, reassignment/override rules, material-change invalidation and version-specific approval.
PENDINGFiling history
Verify rejection details, correction task/owner, retransmission attempt preservation, jurisdiction-independent outcomes, truthful manual versus provider provenance and close rules. Never perform live filing merely to test navigation.
PENDINGPaper and amounts
Verify required tracking and agreed mailed-record controls, blocked completion without tracking, Mailing Report, manual jurisdiction amounts, source/version labels and multiple-state summary behavior.
PENDINGOther periods
Verify business identity/save and entity-specific requirements; full Quarterly lifecycle; amended original linkage/changed items; prior-year rules; and multiple-state creation and independent outcomes.
10 Full acceptance items not yet proven
Area
Retained verification requirement
Extensions and deadlines
Linked jurisdiction extension; original filing/payment deadlines; verified extended filing deadline/confirmation/status; deadline links and configurable reminders. No extension flow was tested.
Search and reporting
Search permissions, permitted identifier last-four matching, all filter combinations/reset, counts, season progress, pagination/sorting where implemented, operational reports, e-file report accuracy and masked/minimized audited exports.
Communications
Configured reviewer/client notices, rejection alerts, upcoming reminders and stopping obsolete reminders. Client/return context and actual portal/email/SMS delivery must be verified. No sensitive taxpayer details in notification previews.
Security and roles
Tenant isolation in routes/search/files/exports; server-side assignment and override enforcement; separate prepare/review/e-sign/transmit/retransmit/export permissions; restricted identifiers and bank/payment data.
History and preservation
Complete actor/time audit for relevant actions; signed/generated/reviewed/filed versions; backward-transition reasons; archived/restored history; approved version and material-change behavior.
UI and resilience
Responsive layout, keyboard operation, focus and modal return; loading/empty/error/validation/permission/integration/rejection/network/conflict states; safe retries and no loss of entered values.
Configuration
Firm-configurable links, types, workflows, statuses, roles and integrations. Source says cards can filter, table columns are recommended and carry-forward is optional. Do not promote optional wording to a mandatory defect.
Decisions to confirm before final acceptance
Define the mapping among overview statuses, workflow stages, independent jurisdiction acknowledgments and Closed. Clarify initial Intake versus In Preparation and how Completed/Accepted notification rules map to closure. Keep Archived visibility separate. Do not silently merge these categories into one status field.
Confirm tax-year correction restrictions; manual-amount field design; review issue resolution controls; exact Mailing Report fields; client intake empty-state route; and service-label configuration scope. These decisions do not remove the original security, retention or provider-confirmation requirements.
Completion rule
The first walkthrough is complete enough for developer feedback. Final acceptance requires the fixes, blocked dependency tests and all applicable original requirements below. Record new evidence per feature rather than marking the entire module complete from this package.
11 Original requirement coverage map
Every original section is retained in Appendix A. References below connect the original specification to this review; “pending” means not established by the walkthrough, not missing by default.
Original section
Review location
Coverage status
1 Purpose
Parts 1, 4, 8, 10
Client/return linkage partially exercised; full isolation pending.
2 Tax type tabs
Parts 1, 8, 9
Personal positive/Business negative filter; other type lifecycles pending.
3 Status workflow
Parts 1, 6, 7, 10
Manual transitions partly exercised; status mapping and gates pending.
4 Main page
Parts 2, 3, 7, 10
Entry routes/reports partial passes; menu clipping and mailing report updates.
5 Create return
Parts 1, 5, 8
Personal saved; business identity addition; quarterly display only.
6 Import
Parts 2, 9
Integration route passes; actual import blocked.
7 Actions
Parts 2–8
Narrow menu results, context fixes, tax-year clarification, archive filter.
8 Return workspace
Parts 1–7
Working cards retained; layout, intake and contextual actions updated.
9 Quarterly
Parts 8, 9
Q1–Q4 visible; remaining estimate/payment workflow pending.
10 Notifications
Parts 6, 10
All actual delivery/stop behavior pending.
11 Permissions
Parts 5, 10
Owner test cannot establish lower-role enforcement.
12 Developer notes
Parts 8, 10
Single dataset, separate modules, configurability and isolation retained.
11 Original requirement coverage continued
Original section
Review location
Coverage status
13 Frame package
Parts 1, 7
Three source frame references retained; provider truth boundary unchanged.
14 Client workspace
Parts 1–7, 9
Intake card and canonical context additions; remaining tabs tracked.
15 Workflow actions
Parts 3–6, 10
Inline flows/task actions; backward reasons/gates pending.
16 Review and filing
Parts 6, 7, 9
Validation display partial pass; amounts/gates pending.
17 Validation versions
Parts 5, 6, 10
Manual warnings nonblocking; linked issues; version rules retained.
18 E-signatures
Parts 2, 3, 9
FirmSign route only; provider actions and copies pending.
19 Filing outcomes
Parts 1, 6, 7, 9
Manual records pass; rejection collection gap; tracked-mail addition.
20 Payments extensions
Parts 7, 9, 10
Manual amounts addition; extension/payment safeguards untested.
21 Type import reports
Parts 2, 8–10
All type specifics retained; imports blocked; reports partial.
22 Security audit
Parts 4, 5, 10
Canonical scoping, overrides and full security tests retained.
23 Acceptance
Parts 9, 10
Full checklist remains applicable; no blanket acceptance.
24 Build sequence
Parts 1, 9; Appendix A
Original recommended sequence preserved; dependencies explicit.
Appendix A Original requirements retained
The following reproduces the original 24 numbered sections and their requirements. It is the retained baseline, not a list of implemented or passed features. Apply the explicit approved changes in Parts 3–8 where they supersede a baseline choice. All other original requirements, conditions and safeguards remain in force.
Source: Firmivra_Tax_Returns_Developer_Guide_UPDATED_DOWNLOAD(1).docx. Original guide: 10 pages, 24 numbered sections and 21 tables. The referenced approved frames are visual references; no frame images were embedded in that source.
Core rule: Build ONE Tax Returns module. The tax-type tabs and status tabs are filtered views of the same return data. Do not create a separate full page for every tab unless a workflow requires a dedicated detail screen.
A1 Page Purpose
Area
Developer Direction
Tax Returns workspace
Manage personal, business, quarterly/estimated tax work, amended returns, and prior-year returns in one place.
Main users
Firm Admin and staff with Tax Returns permission. Staff visibility/actions must follow role permissions.
Data connection
Every return must stay linked to the correct client profile, tax year, return type, assigned staff, status, documents, notes, and activity history.
A2 Tax Type Tabs
Tab
What Must Show
All Returns
Every tax record the signed-in user is permitted to see.
Personal Tax
Individual returns such as Form 1040 and related individual filings.
Business Tax
Business/entity returns such as 1120S, 1120, 1065, Schedule C-related business workflows, and firm-configured business return types.
Quarterly Taxes
Estimated-tax / quarterly-payment work. Show client, tax year/quarter, due date, amount if entered, status, assigned staff, and actions.
Amended Returns
Returns being corrected/amended. Keep link to the original return and prior versions/history.
Prior Year Returns
Older-year returns. Filter by tax year and keep the same client/return workflow.
A3 Status Tabs Workflow
Status
Meaning / What Should Appear
In Preparation
Return has been started and is being worked on.
Waiting on Client
Work is paused because documents, answers, signatures, or other client action are needed.
Ready for Review
Preparer work is complete enough for reviewer/manager review.
Ready for Signature
Return is complete/reviewed and waiting for required signatures/authorization.
Ready to File
All required review/signature steps are complete; return can be filed/transmitted.
Transmitted
Return has been electronically transmitted or otherwise submitted.
Accepted
Tax authority acceptance received.
Rejected
Submission rejected; display rejection reason/code when available and required corrective action.
A4 Main Page Areas
Page Area
What It Does
Search
Search permitted returns by client name, business name, EIN/SSN last four where allowed, return ID, or keyword.
Summary Cards
Total Returns, In Preparation, Waiting on Client, Ready for Review/File, Transmitted, Accepted, Rejected. Cards can act as quick filters.
Filters
Tax Year, Return Type, Client Type, Status, Assigned Staff, date range, and additional filters as needed.
Returns Table
Recommended columns: Client, Return Type, Tax Year, Status, Last Updated, Assigned To, Actions.
Tax Season Progress
Visual summary of current-year return progress by status.
Quick Actions
Create New Return, Import Return, Bulk Upload/Import, Generate E-File Reports, Print/Export List, if permission allows.
Helpful Links
Firm-configurable links/resources. Do not hard-code LVP-only links for all future firms.
A5 Create New Return
Step
System Behavior
1. Click Create New Return
Open a modal/page to start a tax record.
2. Select Client
Search/select an existing client. If permitted, allow creation of a new client first.
3. Select Tax Type
Personal Tax, Business Tax, Quarterly Taxes, Amended Return, or Prior Year Return.
4. Enter Return Details
Tax year, entity/return type, state(s) if relevant, assigned preparer/reviewer, due date, and optional internal notes.
5. Create
Create the return record, set initial status (normally In Preparation), add it to the table, and open the Return Detail workspace.
A6 Import Return
Action
Developer Direction
Import Return
Allow an authorized user to import a return record/file from an approved source or tax-software integration.
Match Client
Require user/system to link imported return to the correct existing client or create a new client if permitted.
Map Metadata
Tax year, return type, status, assigned staff, source/integration, import date/time.
Duplicate Check
Warn before creating duplicate return records for the same client/tax year/type.
A7 Actions Menu What Goes Under the Three Dots
Action
What Happens
Open / View Return
Open the full Return Detail workspace for that client/tax year.
Edit Return Details
Edit permitted metadata such as return type, tax year, due date, assigned staff, reviewer, or internal notes.
Change Status
Move the return to another permitted workflow status and log the change.
Assign / Reassign Staff
Select the preparer/reviewer responsible for the return.
View Client Profile
Open the linked master client profile without creating a duplicate client record.
Documents
Open documents linked to this return/client/tax year; allow upload/request where permitted.
Request Client Information
Create a document/information request and notify the client through the portal plus configured email/SMS notice.
Send Message
Open communication composer tied to this client/return.
Schedule Appointment
Open appointment creation with client and return context prefilled.
Signature / Authorization
Send applicable return documents/authorization for e-signature through the configured provider.
E-File / Transmission Details
Show filing/transmission history, submission date/time, status, acknowledgment, and rejection details when available.
Amend Return
Create an amended-return record linked to the original return and preserve original history.
Duplicate / Carry Forward
Optional permission-controlled action to start a new period/year using permitted prior-year metadata; do not copy sensitive values blindly.
Activity / Audit History
Show important return events, status changes, assignments, uploads, signatures, transmissions, and actor/time.
Archive
Remove from active views without destroying required history.
Delete
Admin/elevated permission only; require confirmation and block deletion when retention/audit rules require preservation.
A8 Return Detail Workspace
Section
What Must Be Available
Overview
Client, tax type, tax year, status, assigned staff/reviewer, due dates, filing method, and key alerts.
Documents
All files linked to the return, including requested/missing items.
Checklist / Workflow
Configurable preparation checklist and completion indicators.
Notes
Internal staff notes; client-facing notes/messages must be separate.
Signatures
Signature/authorization status and provider tracking.
Filing / E-File
Transmission state, acknowledgments, acceptance/rejection information, and relevant filing history.
Activity
Audit/event timeline for the return.
A9 Quarterly Taxes Specific Behavior
Item
Requirement
Quarter / Period
Q1, Q2, Q3, Q4 or firm-defined estimated-tax period.
Due Date
Track the applicable due date for each estimate/payment record.
Amount
Allow calculated/recommended amount to be entered or imported where supported.
Status
Examples: Not Started, Calculated, Sent to Client, Scheduled, Paid/Confirmed, Overdue.
Proof / Confirmation
Allow supporting voucher/payment confirmation to be linked to the client and period.
A10 Notifications Automation
Trigger
System Response
Waiting on Client
Optionally send portal/email/SMS notice that action or documents are needed.
Ready for Review
Notify assigned reviewer/manager if configured.
Ready for Signature
Notify client that signature/authorization is required.
Rejected
Alert assigned preparer/admin and display rejection details/action needed.
Upcoming Due Date
Allow configurable internal/client reminders.
Status Completed/Accepted
Stop obsolete reminders and update dashboard/summary counts.
A11 Permissions
Rule
Developer Direction
Firm Admin
Can view/manage all permitted firm returns, configuration, assignments, reports, and elevated actions.
Staff
Only see clients, return types, and actions allowed by their role/assignment.
Sensitive Data
Mask sensitive identifiers in list views where appropriate; enforce access server-side.
Exports / Bulk Actions
Require separate elevated permission because exports can expose large amounts of taxpayer data.
A12 Developer Notes
Keep the Tax Returns page visually consistent with the current blue Firm Workspace design and updated sidebar.
Tax Planning & Strategy remains a separate sidebar module; it is not the same as Tax Returns.
Business Advisory & Development remains a separate sidebar module.
Do not build separate full pages for every tax-type or status tab. They should filter the same return dataset.
All counts, filters, lists, actions, and return data must be tenant-isolated and permission-aware.
Status changes, assignments, filing events, signatures, and important actions should be logged for audit/history.
Future commercial firms must be able to configure return types, workflows, statuses, staff roles, and integrations without developer intervention.
A13 Approved Frame Package Developer Must Review
Frame 1: Tax Returns Overview.
Frame 2: Client Tax Return Workspace.
Frame 3: Review, E-File & Filing Status.
Frames are visual references; this document is the functional specification. Tax-type tabs remain filtered views of one return architecture.
Never imply transmission or acceptance without supported provider/tax-software confirmation.
A14 Frame 2 Client Tax Return Workspace
Area / Tab
Developer direction
Header
Client, masked ID, contact, tax year, return type and status.
Deadline / Extension
Show filing deadline and extension status; link canonical Compliance & Deadlines records.
Assignments
Preparer/reviewer from Staff Management with history.
Overview
Progress, client details, document checklist, tasks and activity.
Intake & Documents
Organizer/intake, received/requested/missing documents and checklist.
Preparation
Preparation checklist, workpapers/source links, notes and exceptions.
Review
Reviewer checklist, validation, review notes, approvals and return-to-preparer.
E-Signatures
Required authorizations, provider status and timestamps.
E-File
Readiness, transmission, acknowledgments, acceptance/rejection and history.
Payments & Refunds
Federal/state estimated refund or amount due, vouchers, estimated payments and instructions.
Notes
Internal return notes.
Activity
Documents, status, assignments, signatures, filing events, tasks and communications.
A15 Frame 2 Return Workflow Documents Actions
Feature
Requirement
Workflow
Intake → Preparation → Review → E-Signatures/Ready to File → Transmitted → Closed. Federal/state sub-statuses may differ.
Document Checklist
Configurable by return type; Requested, Pending, Received, Reviewed, Not Needed, Replace Needed.
Upload / Request
Use canonical Documents/Document Request flow with client, year and return linkage.
Add Task
Tasks prefilled with client/return/year.
Client Portal
Open permitted return requests/documents/signatures.
Send Message
Messages prefilled with client/return context.
Create Appointment
Appointments prefilled with tax-return context.
Ready for Review
Validate preparation prerequisites, transition status and notify reviewer if configured.
Backward Transition
Require reason/history; never erase prior review events.
A16 Frame 3 Review E File Filing Status
Area
Developer direction
Workflow
Show Intake, Preparation, Review, Ready to File, Transmitted, Closed.
Return Details
Year, type, filing status, federal/state configuration, preparer, reviewer, stage, last updated.
Federal & State Summary
Estimated refund/amount due by jurisdiction; label estimates and never guarantee timing.
Validation
Critical errors, warnings, informational items; Run Final Validation and drill-down.
Approvals
Preparer review, reviewer/final approval and configurable approval steps.
Client Signatures
Form 8879 and applicable state authorization/consent statuses.
Documents
Draft return, signature forms, source docs and acknowledgments.
E-File Status
Federal/state transmission, submission ID, timestamp, acknowledgment, acceptance/rejection.
Next Steps
Dynamic blockers/actions: signatures, validation, approval, Ready to File, transmit, monitor acknowledgments.
Primary Action
Mark Ready to File only when prerequisites pass; Transmit disabled until eligible.
A17 Validation Review Versioning
Item
Requirement
Critical Error
Blocks Ready to File/transmission.
Warning
Requires review/acknowledgment; blocking behavior configurable.
Informational
Non-blocking.
Final Validation
Use supported tax-software/e-file validation; otherwise record manual review without pretending IRS schema validation.
Review Notes
Reviewer may assign issue to preparer and return stage to Preparation.
Approval
Store reviewer, timestamp and approved version.
Material Change
Invalidate/reopen approval according to configured rule.
Versioning
Preserve generated/reviewed/filed versions; never overwrite filed historical artifacts.
A18 E Signatures Authorization
Feature
Requirement
Federal Authorization
Track Form 8879 or applicable authorization.
State Authorization
Track state authorization where required.
Send
Use configured e-sign provider/portal; store request/envelope ID.
Statuses
Not Sent, Sent, Viewed, Signed, Declined, Expired, Voided or provider equivalent.
Signed Copy
Preserve immutable signed document/reference and certificate where supported.
Reminder
Manual/automated reminder through Communications/Automation.
Blocker
Required unsigned authorization blocks filing.
Resend
Preserve prior request history.
A19 E File Transmission Acceptance Rejection
Stage / Field
Requirement
Ready to File
All configured prerequisites satisfied.
Transmit
Only if supported integration can submit; require permission and confirmation.
Federal / State
Track jurisdictions independently.
Submission ID / Timestamp
Store provider-confirmed values.
Acknowledgment
Pending, Accepted, Rejected or provider equivalent.
Accepted
Store confirmation and stop obsolete reminders.
Rejected
Store agency, reject code/description, timestamp, jurisdiction and corrective action.
Correction Task
Create/link task and responsible owner.
Retransmit
New attempt ID/time; preserve prior rejected attempt.
Paper Filing
Separate manual filing status; never label as e-file transmitted.
Close
Only after required jurisdiction outcomes are resolved by firm policy.
A20 Payments Refunds Extensions
Area
Requirement
Refund / Amount Due
Federal/state amounts with source/version; estimated before acceptance where appropriate.
Estimated Payments
Track/import prior estimates/credits when supported.
Vouchers
Generate/store approved voucher/reference where supported.
Payment Deadline
Link Compliance & Deadlines; filing extension does not automatically extend payment due date.
Refund Tracking
Only show authorized government/provider tracking or links; never promise timing.
Bank Data
Mask/restrict sensitive bank data; avoid duplicating credentials.
Extension Record
Separate linked extension by jurisdiction.
Original Deadline
Always preserve original filing/payment deadlines.
Extended Deadline
Store verified extended filing deadline and confirmation.
Extension Status
Not Filed, Prepared, Filed/Sent, Confirmed/Accepted, Rejected as applicable.
A21 Tax Type Import Reporting Sub Areas
Area
Requirement
Personal
Filing status, dependents, federal/state returns, 1040-related docs/signatures.
Business
Entity/tax classification, return form, K-1 tracking where applicable, state/entity filings.
Quarterly
Quarter, due date, amount, voucher/payment status and confirmation.
Amended
Mandatory link to original filed return, reason, changed items, new signatures/filing and preserved original.
Prior Year
Same architecture with year-specific rules/deadlines.
Import Return
Approved source, client matching, metadata mapping, duplicate check and import log.
Bulk Import
Preview, validation, matching, errors and per-record result.
E-File Reports
Transmission/acknowledgment/acceptance/rejection reports.
Operational Reports
Status, missing docs, reviewer workload, rejected returns and due dates.
Export
Elevated permission, masked/minimized identifiers and audit event.
A22 Permissions Security Audit Additions
Area
Requirement
Identifiers
Mask SSN/EIN according to role.
Documents
Private client/year/return-scoped storage.
Preparation / Review
Separate permissions for preparer work and reviewer approval.
E-Sign
Permission to send/void/resend requests.
Transmit
Separate elevated e-file permission.
Retransmit
Permission/audit for correction and resubmission.
Payments / Refunds
Restrict bank/payment-sensitive data and exports.
Audit
Status, assignments, validation, approval, docs, signatures, transmissions, acknowledgments, rejection correction, extensions and exports.
Tenant Isolation
No cross-firm taxpayer data in routes/search/exports.
A23 Developer Acceptance Checklist
Frame 1 remains one shared return dataset with tax-type/status filters.
Frame 2 includes all approved tabs and canonical task/document/message/appointment links.
Frame 3 clearly distinguishes Review, Ready to File, Transmitted, Accepted/Rejected and Closed.
Federal/state filing statuses are tracked independently.
Validation and signature blockers prevent premature filing.
Rejected returns preserve reject codes/history and support correction/retransmission without overwriting prior attempts.
Payments/refunds are jurisdiction-specific, estimates are labeled, and refund timing is never guaranteed.
Extensions preserve original filing/payment deadlines separately.
Filed/signed/generated versions are historical snapshots.
Permissions are server-side; sensitive identifiers/data are masked/restricted.
All material workflow, filing, signature, approval and export events are audited.
Loading, empty, validation, integration, rejection, permission and network/conflict states are implemented.
Responsive and keyboard-accessible behavior is supported.
A24 Recommended Build Sequence
Extend return data model for workflow stage, jurisdiction filing status, extension, signature, validation, approval, transmission attempt and acknowledgment.
Build Frame 2 client return workspace and all tab routing.
Connect Documents, Intake Forms, Tasks, Messages, Appointments and Compliance & Deadlines.
Build preparation/review workflow and versioning.
Connect e-sign provider workflow.
Build Frame 3 validation, approvals, readiness and e-file status.
Implement jurisdiction-aware transmission/acknowledgment/rejection/retransmission.
Build Payments & Refunds and extension handling.
Complete reports/imports, permissions, audit, error states, accessibility and end-to-end QA.
