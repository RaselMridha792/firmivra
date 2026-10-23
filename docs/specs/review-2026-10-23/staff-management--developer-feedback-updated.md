Firmvra Staff Management
Updated developer feedback and test results
Review sessions October 21–22, 2026 • Updated through the October 22 walkthrough
Implement the corrections and approved additions in this report, preserve working behavior, and return the pending items for retesting. This document consolidates the earlier checkpoint with the latest review. It is not final release approval and does not replace unchanged requirements in the original Staff Management developer guide.

# Current review position

The review has progressed beyond Add Team. Teams and departments, Staff Settings, Reports routing, bulk-upload mapping, account sessions, history and account-action permissions have now been reviewed. Do not restart at the previous Add Team checkpoint.
Bulk upload is blocked at Validate & Preview by “Something went wrong”. Owner-access tests remain pending because the developer has not transferred ownership. Draft retrieval/pay persistence, invitation delivery and security enforcement remain unverified.

# Status key

| Area | Status | Finding and developer instruction |
|---|---|---|
| Reported result | Working | User reported the stated behavior. Persistence is only included where save and refresh/reopen were specifically confirmed; no independent backend certification is implied. |
| Repair | Correction | Reported defect, wrong route or original-guide requirement gap. Fix and retest. |
| New direction | Addition | User-approved enhancement or more explicit policy. Later directions override conflicting earlier checkpoint decisions. |
| Open item | Pending | Unperformed, blocked, data-dependent or awaiting clarification. Do not mark passed or assume a cause. |

Evidence: original FIRMVRA Staff Management Developer Instructions, earlier review checkpoint content, and user-guided walkthrough through October 22. The separate Tasks review is excluded. No document has been sent to the developer as part of this preparation.

# Overview and navigation

| Area | Status | Finding and developer instruction |
|---|---|---|
| Summary cards | Addition | Total Staff, Active Staff, Inactive Staff and Department cards are not clickable. Make them open the corresponding authorized list/filter or Teams & Departments, with the active context visible. |
| Staff directory | Addition | Both Staff Settings → Staff Directory and Manage Staff Accounts must open the same dedicated directory view with search, filters and staff actions. This supersedes the earlier decision to keep scrolling on the overview. |
| Search and status | Working | Email search narrows results. Active and Invited filters show records. Inactive returned zero with no inactive test staff; do not claim positive inclusion was tested. |
| Department filter | Pending | TEST – Operations Department returned no matches after team membership/head changes. Direct staff Department assignment was not established. Clarify whether the filter uses direct assignment, team membership or both; retest with confirmed assigned staff. |
| Existing staff | Pending | Earlier profile/row navigation showed existing details and Save Changes. Later editing is blocked in the current Admin account; Owner-access explanation is unverified. Test authorized editing and same-ID persistence after access is resolved. |
| Create Staff | Working | Blank form opens; four-step order is correct. Missing required fields block Next with red outlines and explanatory text. Live preview updates; role/defaults carry forward. |
| Global date and time | Addition | Show current date and time at top-right of EVERY page, updating and visibly identifying the signed-in/configured timezone. This is platform-wide. |
| Reports route | Correction | Shortcut opens general Reports instead of staff/team context. Add the missing Staff/Team reporting option in canonical Reports and have the shortcut select it automatically; do not create a separate report system. |
| Activity route | Working | Activity & Login History opens and shows successful and failed login attempts, staff filters and 7/30/90-day ranges. Custom date ranges already exist in Full Audit Log; remove the earlier proposed missing-custom-date addition. |


# Account information and company lists

| Area | Status | Finding and developer instruction |
|---|---|---|
| Department fields | Pending | HR appears and can be selected. Required active-department multi-select remains to be confirmed with multiple saved assignments. |
| Job titles | Addition | Preserve typing and add searchable saved-title selection with permitted custom entry. Authorized users must be able to add, edit and save reusable company job titles. |
| Role catalog | Pending | Observed Manager, Staff, Bookkeeper, Tax Preparer, Client Support, Business Consultant and Read Only. Reconcile the original catalog and equivalent names; do not duplicate synonyms or infer professional titles grant privileges. |
| Owner availability | Pending | Owner is not a missing-role defect. Current user is Admin; developer still holds Owner. Verify protected owner grants and transfer/access arrangements. Apply the newer Original Owner/Delegated Owner rules on page 8. |
| Custom role route | Addition | Custom Role already exists in View Roles & Permissions. Add a shortcut by the role selector, and Back to the same in-progress staff form with entries preserved and the saved role selectable. |
| Custom role save | Correction | Creating a custom role as Admin did not save/appear. User rejected duplicate name as the explanation. Investigate save behavior and authorized Admin grants; root cause is unknown. |
| Service areas | Working | Form multi-selection/removal work. Options include tax preparation/planning, bookkeeping, payroll, business counseling and business development. |
| Service area setup | Pending | Identify where add/rename/deactivate occurs, whether Services & Pricing is canonical, and whether Admin or only Owner may manage it. Do not invent owner-only restrictions. |
| Account controls | Working | Standard User/Manager/Administrator control, Access Start Date calendar and live preview respond. New-account status is locked to Pending Invite. Actual escalation and existing-account status changes remain untested. |
| Office and titles route | Correction | Staff Settings → Offices & Job Titles incorrectly leads to Add Staff. Open the proper list-management editor for add/edit/save; synchronize choices with staff forms and canonical Location Management. |


# Permissions and security configuration

| Area | Status | Finding and developer instruction |
|---|---|---|
| Matrix tools | Working | Apply Defaults restores form selections. Copy Permissions opens staff selector/preview but was not applied. Clear All opens Cancel/Clear All confirmation. Do not infer saved permissions. |
| Matrix coverage | Working | Guide module areas are broadly present; Messages and Communications are separate. View/Create/Edit/Delete/Approve/Manage/Full Access are visible. |
| Export | Correction | Add missing Export capability for applicable modules with separate permission control, scoped data access and backend enforcement. |
| Dependencies | Working | Create enables View; clearing View clears Create. Assigned role and selections are readable in the Admin account, while self-editing is disabled. Owner editing and effective enforcement remain pending. |
| Password setup | Pending | UI says temporary password autogenerated, with custom-password control disabled. Verify secure time-limited activation/password-setup links. Do not claim plaintext was sent or enable plaintext handling; original no-secret-storage rules remain. |
| Security controls | Working | Work Email carries over; mandatory 2FA is locked on. First-login change and welcome toggles respond. Logout offers 15/30 minutes and 1/2/4/8 hours; disable-date calendar, concurrent limits 1–10, trusted devices and recovery email are present. |
| Notifications | Pending | Login/new-device, failed-attempt, password/security-change and lockout alerts are visible. Verify MFA-change coverage, consent/provider rules where applicable and actual delivery. |
| Global security route | Correction | Staff Settings → New Accounts & Security incorrectly opens Step 3 of Create Staff. It must open company-wide staff security policies for all staff, with allowed individual exceptions explicit. Explain affected accounts and confirm consequential saves. |
| Other settings routes | Working | Staff Settings opens its five cards. Roles & Permissions opens role management; Departments & Teams opens the management page. |
| Enforcement | Pending | Verify server-side permissions, authorized grants, Full Access limits, final-owner protection, session restrictions, policy enforcement, verified recovery, expiring/revocable links and fail-closed updates. |


# Additional details drafts and staff files

| Area | Status | Finding and developer instruction |
|---|---|---|
| Employment details | Pending | Employment options include W2/contractor/full-time/part-time/contract/temporary/seasonal/intern/other. Confirm contractor/1099 mapping. Employee ID input works; uniqueness/persistence untested. |
| Schedule and dates | Correction | Work Schedule only has presets. Support company-defined/custom saved schedules. Supervisor lists active test staff; Hire Date, optional End Date and timezone controls are present/responding. |
| Work Start Date | Addition | Add a separate Work Start Date, distinct from Hire Date and Access Start Date. |
| Office and teams | Working | Primary Team and Backup Team now load the saved test team in Create Staff, clearing the former empty-selector item at UI level. Staff assignment persistence remains pending. Office/Branch was empty before location setup. |
| Draft saving | Pending | Save Draft appears in Steps 1 and 4; message says “Draft saved (pay is not kept)”, but draft could not be found/reopened. Do not mark persistence passed. Clarify/correct compensation exclusion and avoid silent HR data loss. |
| Draft access | Addition | Add Drafts view and Draft status to staff directory/search/filters. Reopen the same staff record with values retained, without invitation or account access. Verify Back/Save Draft across all four steps. |
| Upload controls | Working | File selection/type selector and Remove work. All original document types, including Other, are present. This is not storage or privacy verification. |
| File lost on Back | Correction | Selected file disappears after Back and forward while other fields remain. Preserve draft file and document type across navigation. |
| Per-file Save | Addition | Add Save beneath Remove in file Actions. Persist the private draft attachment/type before final staff submission, without invitations or activation. |
| Additional fields | Working | Primary Service Specialty selects company service areas; new-client assignment toggle and compensation Type/Rate/Frequency/Commission/Payroll ID inputs respond. Team, workload and specialty selections survive Back/forward. Saving, eligibility and HR restrictions remain untested. |
| Workload units | Correction | Maximum Workload accepts a number but says clients or tasks. Clarify the capacity unit and how assignment limits are applied; actual enforcement remains pending. |


# Teams and departments

| Area | Status | Finding and developer instruction |
|---|---|---|
| Team creation | Working | TEST – Staff Review Team saved under HR and survived refresh, despite no success popup. Edited description persisted on reopen. Its menu includes Edit, Manage Members, Change Lead, Move Department, Deactivate and Archive. |
| Move Department | Working | Test team moved to TEST – Operations Department and remained there after save and refresh, as reported by the user. Manage Teams also shows the moved team under the correct department. |
| Department lifecycle | Working | Required-name validation blocks blank names. TEST – Operations Department saved and survived refresh. Edited description persisted on reopen. Empty-department Deactivate confirmation/status and Reactivate were exercised; Active persisted after refresh. |
| Department Head | Working | Eligible test staff selector opens; selecting/saving a Department Head worked and remained after refresh. |
| Team Lead | Working | Change Lead offers test staff and No Lead. Assigning a lead and removing it both persisted after save/refresh. |
| Team members | Working | Manage Members lists test staff. Adding one member persisted after refresh; removing that member returned to zero selected after save/refresh. |
| Team status | Working | Empty test team showed Deactivate confirmation, stayed Inactive after refresh, then Reactivate returned it to Active and persisted. This does not prove dependency handling for populated teams. |
| Department members | Addition | Add Manage Members directly to each department menu. Authorized users must add/remove staff WITHOUT creating or assigning a team. Keep staff Department assignments, counts and directory filtering consistent. |
| Department filter | Pending | Headship and team membership are not evidence of direct Department assignment. Confirm the source of the directory filter and retest with known direct assignments; current no-match result alone is not a proven defect. |
| Hierarchy and safety | Pending | Org Chart opens with two separate staff cards; reporting lines remain unverified without a known saved supervisor relationship. Dependency warnings/reassignment for active workflows, department/team archive where supported, company scoping and audit history need verification. Deactivation must never delete staff. |

Keep team membership, department assignment, department head and team lead distinct. A successful action in one must not be used as proof of another. The latest approved direct-department membership requirement must work independently of teams.

# Bulk upload and account history

| Area | Status | Finding and developer instruction |
|---|---|---|
| Template | Working | CSV template downloads and opens. Headers include first/last name, email, phone, job title, role, department, employment type, office, hire date and Employee ID. A sample row was reported. |
| Upload and mapping | Working | Upload opens the chooser. Uploaded test file reaches Map Columns with corresponding staff fields and Do Not Import choices. No actual staff import or invitation was completed. |
| Formats and guidance | Correction | UI states CSV only, maximum 1 MB and 500 rows; original guide requires CSV/XLSX template/import support. Add XLSX support and clear required-column, accepted-value and date-format instructions. Validate/document limits; no new higher row limit was approved. |
| Employee ID | Correction | Bulk flow requires Employee ID despite original guide making it optional. Permit blank/omitted Employee ID; check uniqueness when supplied. |
| Validate and Preview | Correction | Repeated “Something went wrong” blocks progress, including after choosing Do Not Import. Fix validation/preview and provide useful row/field errors instead of an unexplained generic failure. Cause is not established. |
| Import completion | Pending | Preview counts/row errors, valid create/update import, duplicate prevention, invitation choice, results/error file and audit remain blocked/unverified. Retest after validation repair. |
| Active Sessions | Correction | Empty for the same account currently signed in; user confirmed the account matches. Investigate session tracking/loading. No cause or revoke behavior has been established. |
| Staff Login History | Correction | Selected account’s Login History does not show recent successful login, while overall Activity & Login History has events. Check staff-specific linkage/query and scoped permissions. |
| Activity and Audit | Working | Visible entry shows user name, Audit log view and correct date/time. Entry does not open; the original guide does not require every row to be clickable. Complete event/outcome coverage is pending. |
| Account Notes | Pending | Present but disabled for current Admin. Confirm intended permissions and retest with Owner access; note saving is not verified. Ownership transfer has not occurred. |


# Approved account authority rules

These user-approved rules supersede ambiguous earlier discussion. Implement at both UI and API layers, within the company. Do not treat disabled buttons in the current Admin view as proof that the intended policy is implemented.
| Area | Status | Finding and developer instruction |
|---|---|---|
| Original Owner | Addition | Identify the original account owner separately from delegated owner-level access. Only the Original Owner grants owner-level access and can revoke that grant by demoting the delegate to Administrator. |
| Delegated Owner | Addition | May manage company staff/departments beneath the Original Owner, including owner-level MFA/invitation capabilities. Cannot edit Original Owner details, deactivate/demote/disable or otherwise change that account, or grant owner-level access to others. |
| Owner protection | Pending | Verify protected account identity and backend checks across every route. Preserve final-owner/admin protections. Do not interpret “everything” as cross-company or platform-wide authority. |
| Own password | Addition | Every employee tier must be able to securely reset its own password. The control was grayed out in the current view; make the authorized self-service flow available and verify it. |
| Reset MFA | Addition | Restrict to Original Owner and explicitly granted owner-level access, subject to Original Owner protection. User withdrew the earlier suggestion to make this available to everyone. |
| Resend Invitation | Addition | Authorized management levels may resend for staff beneath them, not themselves or above them; owner-level access spans the company subject to protected-owner rules. Define whether lower-manager scope is direct reports or the whole reporting chain before final acceptance. |
| Own sessions | Addition | Every signed-in user can sign out their own sessions. Provide Sign Out All Other Sessions under Staff Account Actions, preserving the current session, with confirmation and audit. Managing another person’s sessions remains restricted. |
| Lock Account | Addition | Owner-level users and Admins only. Open policy detail: whether Admin locking is also limited to lower-level accounts. Do not infer a final answer from the deactivation clarification. |
| Deactivate | Addition | Owner-level users may act below the protected Original Owner. Admin may deactivate ONLY lower-level accounts, across departments, never peers or higher roles. Enforce hierarchy server-side and preserve history. |
| Observed actions | Pending | Reset Password, Reset MFA, Resend Invitation, Sign Out Sessions, Lock and Deactivate are present but grayed out in current Admin view. No action/enforcement test is approved as passed; role changes and sensitive tests require authorization. |


# Retest plan and release acceptance

The next session should retest corrections and access-dependent items, not repeat already confirmed UI checks. Use safe test data and role-separated accounts. Obtain appropriate authorization for invitations, privilege changes, session revocation and destructive actions.
| Area | Status | Finding and developer instruction |
|---|---|---|
| 1  Unblock | Pending | Repair custom-role save, draft retrieval/pay retention, file persistence, bulk Validate & Preview, staff-specific sessions/history and misrouted Staff Settings/Reports. |
| 2  Confirm policy | Pending | Resolve Admin locking scope and direct-report versus full-chain invitation authority. Confirm Original Owner protections and authorized Owner access for review. |
| 3  Save and reopen | Pending | Verify same-ID staff edits; all four draft steps; permissions/security/HR fields; attachments after Back/forward and reopening; no duplicate retry, invite or activation from drafts. |
| 4  Directory | Pending | Check the new dedicated route, summary cards, known direct-department assignments, inactive positive cases, department member counts and Org Chart reporting lines. |
| 5  Teams | Pending | Preserve reported save/refresh passes; test authorization, populated-team/workflow dependency warnings, archive/history and direct-department membership independent of teams. |
| 6  Import | Pending | Recheck optional Employee ID and CSV/XLSX; invalid/duplicate inputs, preview/errors, authorized create/update, results/error file and audit. Import/invite execution remains unverified. |
| 7  Invitations | Pending | Earlier Invited record had no received email; test-environment explanation is unconfirmed. Test secure delivery, Success summary/routes, resend and partial-failure recovery without duplicate staff. |
| 8  Security | Pending | Test own-password/session actions and permitted management actions by role; deny forbidden grants/targets via API as well as UI. Verify MFA, session/disable restrictions and Owner-protected operations. |
| 9  Privacy and audit | Pending | Verify company isolation, HR/file access, no public documents or secret leakage, token-free audit detail and all staff/role/invite/session/team/document/import events. |
| 10  UX and errors | Pending | Required/duplicate/permission errors, unsaved Save Draft/Discard/Keep Editing, network retry, concurrent save conflicts, empty/loading states, keyboard accessibility and responsive layouts. |

Developer response requested: for every correction/addition, identify implementation status, affected screen, reproducible retest steps and evidence. Retain Working findings only at their stated scope. Final acceptance remains pending, not approved.
