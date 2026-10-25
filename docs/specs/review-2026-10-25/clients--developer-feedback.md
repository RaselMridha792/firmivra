
Firmvra Clients Developer Feedback
CONSOLIDATED FIRST AVAILABLE SCREEN REVIEW • Completed 25 October 2026 • Full acceptance PENDING
The first review of the currently available Clients screens is complete. This consolidated feedback records demonstrated behavior, required fixes, approved additions, and remaining tests. It is not full Clients acceptance: fixes, unavailable workflows, populated-data checks, permissions, and end-to-end testing remain open.
Evidence is from the user-operated walkthrough and the user’s reports. These are not independent backend, security, persistence, or tenant-isolation verifications. The approved guide and three reference images define expectations; mockups are not proof of the live implementation.
Status
Meaning
✔ OBSERVED
Green: only the specific interaction or visible state demonstrated during this review.
FIX OR INVESTIGATE
Red: observed gap or reported failure, with current behavior and required outcome. Root causes remain unconfirmed unless stated.
APPROVED ADDITION
Blue: owner-approved requirement or clarification, kept separate from original requirements.
PENDING
Amber: untested, partially tested, or awaiting reconciliation. No completion claim.

Review checkpoint and next module
Stacy’s Edit Details loads existing data, and the user confirmed that saving an edit and refreshing preserves the change. Cancel after a harmless unsaved edit showed no warning; add an explicit Save Changes / Discard Changes / Keep Editing choice. These results replace the earlier untested edit-persistence checkpoint.
Next selected module: SIGNUPS. Its review has not started and requires the original Signups guide before proceeding. Clients fixes and full acceptance tests remain pending in this document. This checkpoint does not authorize additional communications, exports, bulk mutations, or destructive actions.
Nonnegotiable architecture
One Clients directory uses status and service filters over the same dataset. One canonical Client ID connects the profile to every service and workflow. Leads remain separate until converted. Service enrollment must not create another client. Inactive and archived relationships retain their history. Back must preserve the originating context under the owner-approved navigation requirement.

1 Observed behavior to retain
Observed scope
Result and boundary
✔ Directory cards
Six cards are present: Clients, New, Active, Pending Docs, Balance Due, and Inactive. Values and client inclusion have not been reconciled.
✔ Status routing
All Clients restores the full list. Active applies an empty filtered result; New and Inactive filters apply. This confirms routing only, not correct counts or membership.
✔ Service routing
Annual Tax and Bookkeeping filter the same directory. Correct inclusion still requires suitable populated fixtures and service-link reconciliation.
✔ Search
Name, email, and phone searches work. An unmatched search displays No Results. Client-ID search is still pending.
✔ Main controls and Reset
Staff, last activity, status, services, and search controls are present. Reset All restores the default view. Presence is not proof of every filter’s behavior.
✔ Assigned staff filter
Selecting self shows Stacy; choosing a staff member with no clients clears the result. No broader assignment/count audit was performed.
✔ Existing profile and Edit Details
Stacy’s name opens the correct profile and Edit Details loads existing data. The user confirmed edit Save followed by refresh retains the change. This is a user-reported persistence pass, not a backend, audit, concurrency, or duplicate-check verification.
✔ Row action routing
View Profile, Invoices, and Signatures route to Stacy’s context. The initial invoice view was empty; later draft/Open-state observations are recorded below. Signatures remains empty and no signature workflow was tested.
✔ Bulk enablement and options
Bulk Actions enables after selecting clients, as required. Assign Staff, Archive Clients, and Restore Clients are visible. The earlier disabled-state concern is withdrawn.
✔ Bulk dialogs only
Assign Staff opens a staff list and selected-client count. Archive shows a confirmation count and was CANCELLED. No assignment or archive mutation was committed; Restore effects are untested.
✔ Add Client entry
Add Client from Clients opens a new-client form. Individual/Business and conditional Business Name are present. This is observed behavior, not a fix deployed during the review.
✔ Limited blank-submit behavior
A blank Save is blocked with Name highlighted. This proves Name validation only. No new client was saved; the test form was cancelled.
✔ Documents and request form
Existing document requests are visible. Create Request shows title, service, optional instructions, category, and due date. The form was CANCELLED and unsent. No files were available; file View/Download remains untested, not failed.
✔ Messages context
The Messages tab opens the correct Stacy conversation. The new-message composer shows Subject and Message only; visible destination/channel and actual delivery are not verified.
✔ Invoice context and UI state
Invoices is scoped to Stacy. A draft was created; after the user clicked Send, the UI reported Open. Adding line items works. This does not prove recipient delivery or that client identity was prefilled in every creation flow.
✔ Tags persistence and removal
TestClientReview was added, saved, and retained after refresh. It was then removed, saved, and remained removed after refresh; other tags were untouched.
✔ Limited narrow layout
At the tested narrow directory width, all actions and filters remained reachable. This is a limited layout check, not complete mobile/responsive acceptance.
✔ Limited keyboard behavior
Tab shows focus; Enter opens the row menu. Escape closes the menu and returns focus. This does not complete keyboard or accessibility coverage.
✔ Return to Clients routing
The Return to Clients button beside the name reaches the list. It clears the Annual Tax filter and Stacy search to All Clients, so context preservation fails despite successful routing.
✔ Combined filter and selection counts
Annual Tax plus name search works for one fixture. Selecting two clients shows count 2; after clearing selection, header-select in Annual Tax selects its one matching client; Clear All returns count 0. No bulk mutation was performed.


2 Current to required fixes and investigations
Area
CURRENT
REQUIRED
Pending Docs card
Click produces no response.
Filter the directory to clients with at least one outstanding document request. Reconcile the count against canonical requests; do not infer client status solely from the count.
Balance Due card
Click produces no response.
Filter clients with an unpaid invoice balance. The KPI counts CLIENTS, not dollars, and is not restricted to overdue invoices. Source amounts from Invoices &amp; Payments.
Last Activity
The selected From/To range beginning October 22 and ending on the review day did not return the activity the user expected. This is a reported failure; root cause is not isolated.
Investigate the canonical activity timestamp, inclusive/exclusive boundaries, date interpretation, and firm timezone. Retest with known events inside, outside, and on both boundaries.
Stacy service linkage
Stacy appears in All Clients and Annual Tax, with only Annual Tax shown in directory Services. Business Development has zero results despite prior advisory enrollment.
Reconcile the existing advisory enrollment with the canonical client/service relationship and configured service mapping. Confirm directory tags, service filter, and profile agree. This is an unresolved mapping issue, not an established filter bug.
Profile workspace access
Only Overview, Documents, Messages, Invoices, and Signatures are available; no overflow/More tab exists. Core access to Services, Intake Forms, Tasks, Notes, and Activity is missing. Overview has Profile, Contact, Portal Access, Firm Details, and Tags, but no enrolled Services.
Provide the original guide’s core workspace access and linked service status, separate from tags. Gate Tax Returns, Bookkeeping, Payroll, Tax Planning, and Advisory by enrollment, configuration, and permission. A read-only Overview is acceptable; it is not an editing defect.
Basic field validation
Blank Save blocks with only Name highlighted. Other required-field validation has not been demonstrated.
Enforce owner-required applicable basic fields and format checks. Test sequentially as each invalid field is corrected before concluding exactly which validation rules are absent.
Bulk action coverage
Only Assign Staff, Archive Clients, and Restore Clients are visible.
Implement authorized tag, service/status, message, document/intake request, export, and inactive workflows from the original guide. Apply permissions, consent, preview, confirmation, and audit safeguards. Bulk Delete is generally avoided, not an ordinary mandatory action.
Unsaved edit cancellation
Cancel after a harmless unsaved edit produces no warning.
Add Save Changes, Discard Changes, and Keep Editing. Save validates/persists; Discard abandons only unsaved changes; Keep Editing preserves the form. Test each branch.
Return context
Return to Clients routes to the list but resets Annual Tax plus Stacy search to All Clients.
Preserve the originating filters, search, sort, and list/scroll position. Clear context only on an explicit Reset or deliberate new navigation. Test combined filters and paging.
Document upload
Profile Documents offers Request but no Upload button.
Add authorized Upload Document using the canonical Documents workflow with this client’s context preselected. Verify permissions, upload outcome, and source record linkage.
Message destination clarity
Correct Stacy conversation opens, but the new composer exposes only Subject and Message; no visible recipient or channel. Actual delivery is unverified.
Make the intended client, destination, and channel visible and carry the correct context into the canonical messaging workflow. Resolve destination/channel rules before testing an authorized send; do not infer delivery from navigation.
Portal invitation access
Portal Access has no Send Invitation Link. The same gap was noted in Advisory.
Provide a client-prefilled secure invite workflow with recipient confirmation, invitation status, and permission-controlled resend/revoke. Reuse canonical Client Portal identity and avoid duplicate login/client creation. Verify actual invitation behavior separately.

Service labels need configuration review
Observed tabs include Annual Tax, Bookkeeping, Bookkeeping Copy, Business Development, Payroll, Quarterly Tax, Quarterly Copy, Tax Planning, Inactive, and LVP Accounting Taxes. Investigate their configured Services &amp; Pricing source and intended mapping to the approved service categories. Unexpected labels are not proof of hard-coded duplicates or duplicate client records. Do not remove or rename configured services without confirming the intended mapping.

3 Owner approved additions and clarifications
Requirement
Implementation and review expectation
Separate Added Last 30 Days filter
Keep New tied to New/onboarding status from the original guide. Add a separate creation-date filter for Added Last 30 Days; do not replace New with numeric age.
Expanded More Filters
Add deadline range, next appointment, primary client type Individual/Business, location (state/city/county), balance, missing documents, tags, source, priority, Apply, Clear, and removable active-filter chips. Keep business entity classifications separate from primary client type.
Preserve existing filters
More Filters already contains status, configured services, and Records: Current, Archived, Current and Archived. Staff and last activity already exist in main controls; do not duplicate them merely to copy the mockup. Exact advanced-filter operators are not prescribed by the written guide and must be defined consistently.
Archived Clients shortcut
Add an Archived Clients main shortcut using the existing Records archive filter. Archive is distinct from client New/Active/Inactive lifecycle status.
Visible controlled Export
Export is not visible. Provide owner access plus explicitly delegated Export permission, with scope/affected-client preview and audit. Minimize sensitive data and enforce authorization server-side.
Applicable basic fields
Require client type, name, email, phone, and address, using Home versus Business address as appropriate. Business additionally requires Business Name, email, phone, and business address. Validate required fields and formats before save.
Business responsible party
For a Business client, require Responsible Party full name, email, and phone. Link the person and business rather than replacing one with the other.
Linked Business and Personal profiles
Carry the earlier approved Business/Personal linked profiles under one existing client relationship. Prefill known data, request only missing fields, and prevent duplicate client/login creation. Preserve canonical identity and distinct linked profile details.
Context preserving Back
Back returns to the originating page/context, including the prior directory search and filters when that was the origin. This extends the original Back to Clients behavior.
Document request details
Owner-approved addition: add View Request Details for read-only request rows. The original Clients guide does not explicitly mandate row click/edit. Handle any request editing/status controls through canonical Documents rules and permissions. Provide permission-controlled View/Download when uploaded files exist; those actions are currently untested because no files were present.
Overview service and activity layout
Show ENROLLED SERVICES in Overview with actual enrollment/status and links to the correct client service workspace, not tags. Place an Activity Log at the BOTTOM with actor, action, time, and permitted related-record links. Activity itself is already an original requirement in section 18; placement is the owner’s addition.

Source interpretation
The original guide already requires Services in the 360° workspace, canonical client identity, duplicate prevention, exports with separate permission, and source-module routing. Those are not new additions. The advanced-filter PNG supplies visual detail beyond the written guide. Its pink branding, mixed type/entity choices, and Active-specific layout do not override the one-directory architecture or approved Individual/Business primary type.
Billing additions for the Invoices review
Keep these owner-approved billing additions as a cross-reference for the upcoming Invoices &amp; Payments review. They are not explicit requirements of the original Clients guide. Clients itself requires canonical client-filtered billing, a client-context Create Invoice route, and permission-controlled balance data. No invoice action menu was available in this walkthrough; actual invoice recipient delivery remains unverified.
OWNER APPROVED BILLING ADDITION
REQUIRED OR TO CLARIFY
Branding
Add the firm logo to invoice presentation.
Invoice actions
Provide permission-controlled Archive, Cancel, and Edit/Correct actions with confirmation as appropriate. Preserve the SENT original and its history; corrections must not silently overwrite it.
Line item service selection
Make item description searchable from Services &amp; Pricing while retaining custom typing. Adding line items already works; the requested catalog-selection behavior is an addition.
Optional service dates
Offer optional service start and end calendars on invoice items/workflows as appropriate.
Catalog write safeguard
Save As New Service must be an explicit, authorized choice. Typing a custom line item must not automatically modify the service catalog.
Defaults to clarify
Confirm how settings, location, and template defaults should apply before implementation. Do not infer an approved default hierarchy.

4 Pending tests and safeguards
Test area
What remains unproven
Next module and Clients retests
Next module is SIGNUPS, selected but not started; obtain its original guide. For Clients, first retest the unsaved-edit warning and context-preserving Return to Clients after fixes. Edit Save/refresh persistence already passed for the tested change.
Create and duplicate prevention
Complete Individual and Business required-field checks, responsible-party linkage, a separately authorized new-client save, persistence, canonical ID, email/normalized phone/company matches, permitted identifier checks, and matching-lead conversion/link. No new client has been saved.
Counts and filter membership
Reconcile six KPI values, New/onboarding versus Added Last 30 Days, Active/Inactive membership, populated service fixtures, Pending Docs, unpaid balance counts, combinations, sort, pagination, preserved filters, and date boundaries.
Full client workspace
Verify missing core Services/Intake Forms/Tasks/Notes/Activity access, enrolled service links/status, bottom Activity Log, portal invitations, and applicable service tabs. Confirm enrollment creates a service relationship, not another client; retest Back context after correction.
Documents and financial data
Document requests are visible and the request form was inspected but cancelled unsent. No files were available, so upload and View/Download need populated fixtures. Reconcile missing counts, submitted intake history, invoice/payment values and balance links. Draft creation and Send-to-Open UI transition do not establish actual recipient delivery.
Appointments and relationship tools
Test appointment links/dates, important dates, portal invite delivery/status, actual messaging destination/delivery, tasks, notes with author/time, and source-linked activity. Correct Stacy conversation routing passed; external delivery remains unverified.
Bulk and lifecycle mutations
Actual Assign Staff save, Archive, Restore, inactive behavior, consent-controlled communications, requests, service/status actions, and retained history remain untested. User reports Archive works, but it was not retested here. Archive confirmation was cancelled.
Export and security
Test export scope/preview/audit, owner and delegated permission, restricted identifiers and financial data, server authorization, tenant isolation, and negative permission cases. UI visibility alone is insufficient.
Reliability and accessibility
Limited narrow-directory reachability and Tab/Enter/Escape row-menu behavior passed. Full mobile/responsive and keyboard/accessibility coverage remains pending, along with loading, other empty/error states, network failure, duplicate-create prevention, missing linked records, disabled modules, and edit conflicts.


5 Original specification coverage map
All 25 original sections remain accounted for. PARTIAL means only the stated subset was reviewed, not that the section passed. Completion of the first available screen review does not mark full functional acceptance for any section.
No.
Original scope
Status
Coverage and next check
1
Client Page Tabs
PARTIAL
Status and two service filters route within directory; membership, configured labels, and complete service coverage pending.
2
Client Workflow
PARTIAL
Add form, existing profile and limited edit persistence reviewed. Create/onboarding/activation and full lifecycle pending.
3
Filters and Buttons
PARTIAL
Search, Reset, staff and one combined filter fixture observed; card/date/context gaps and complete operators pending.
4
Client Table
PARTIAL
Client/profile and selected row routes observed; all columns, values, and source links not fully checked.
5
One Client Profile
PARTIAL
Correct profile opens; core workspace access and enrolled Services gaps identified. Full conditional service behavior pending.
6
Developer Summary
PARTIAL
Same-directory filtering observed. Lead separation, retained history, and tenant isolation not verified.
7
Approved Frame Package
PARTIAL
Directory and profile used; cross-module stable Client ID consistency not verified.
8
Directory Detail
PARTIAL
Cards/controls and selection counts observed; limited narrow/keyboard checks passed. Sorting, paging, complete actions and count reconciliation pending.
9
KPI and Status Definitions
PENDING
Counts not reconciled. Pending Docs/Balance Due click gaps; New semantics and Added Last 30 Days kept separate.
10
Add New Client
PARTIAL
New form, type adaptation and Name validation observed; full validation and save not tested.
11
Duplicate Prevention
PENDING
No create committed; matching, lead conversion/link, override and merge safeguards untested.
12
360 Degree Workspace
PARTIAL
Five visible tabs and no overflow confirmed; core access gaps, service layout and Back-context fix remain open.
13
Overview Summary Cards
PENDING
Canonical source values, populated summaries and click behavior not fully tested.
14
Contact and Profile
PARTIAL
Existing data loads; tested edit and tag add/remove persist after refresh. Full validation, identifiers, edit history and permissions pending.
15
Manage Services
PENDING
Reconcile Stacy advisory linkage; service enrollment, pause/end, packages and assignments untested.
16
Important Dates
PENDING
Source dates, deadlines, renewal/review and portal dates not verified.
17
Quick and More Actions
PARTIAL
Selected routes, request-form inspection and draft invoice/Open UI state observed. Upload/invite gaps and actual delivery remain pending.
18
Tasks Notes and Activity
PENDING
Notes/Activity/Tasks access missing from available workspace. Canonical fields, author/time, source links and behavior untested.
19
Tab Source of Truth
PARTIAL
Correct Stacy Documents/Messages/Invoices context observed. No uploaded-file or signature test; full source-module integration pending.
20
Edit Client
PARTIAL
Edit Save/refresh passed for tested change. Unsaved Cancel has no warning; required warning, conflicts, dedupe, permissions and audit pending.
21
Bulk Actions
PARTIAL
Enablement, selection counts, three options, assignment dialog and cancelled archive confirmation observed. Actual mutations/restore/export untested.
22
Security and Tenant Isolation
PENDING
Permissions, sensitive data, exports, destructive safeguards, audit and server/tenant enforcement unverified.
23
Loading Empty and Error States
PARTIAL
Unmatched search No Results observed; remaining error/permission/network/inactive states untested.
24
End to End Flow
PARTIAL
Available screens reviewed with limited edit/tag persistence and invoice UI state. Full canonical lifecycle remains incomplete.
25
Acceptance Checklist
ACCEPTANCE PENDING
First available screen review complete. Fixes, unavailable workflows, populated-data checks, security and full accessibility acceptance remain open.

Source references
Original guide: Firmivra_Clients_Module_Developer_Guide_UPDATED_DOWNLOAD(1).docx, FIRMIVRA — CLIENTS TAB DEVELOPER GUIDE, all 25 sections. The guide was inspected in full.
Approved visual references: Clients(2).png; Individual Client Profile : 360° Workspace.png; Clinet More filters example.png. Reference sample names, dates, balances, and counts are illustrative, not live acceptance fixtures.
Walkthrough evidence: user-operated Clients review and user-reported observations from 24–25 October 2026. This consolidated first-screen-review document has not been sent to the developer. Next selected module is Signups; its review has not started.
