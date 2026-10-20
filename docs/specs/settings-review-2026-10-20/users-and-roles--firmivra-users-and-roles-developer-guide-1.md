Firmivra Users and Roles Developer Guide
Corrections required flows and acceptance tests
Prepared for the Firmivra developer on behalf of Octavia HolderReview date October 18 2026Scope Settings > Users & Roles and the related Staff Management > Roles & Permissions screens
Complete the Users & Roles workflows so staff accounts can load, receive invitations, inherit role permissions, and have access managed reliably. Use the correction tables and embedded screenshots below to implement each area and record the acceptance test results before returning the tab for review.
Evidence basis: supplied screenshots and Octavia’s narrated tests. This guide does not claim independent end to end testing. “Observed” means shown in a screenshot; “Reported” means described during the walkthrough; “Required” means the agreed target behavior; “Verify” means an outcome still needs testing.
Priority | Finding | Required next step
P1 | Observed: counters and employee list do not load. | Repair data loading and distinguish errors from empty results.
P1 | Reported and pictured: sending an invitation returns a vague error. | Complete invitation delivery and activation.
P1 | Observed: custom role creation is unavailable. | Implement template selection, permissions dialog and saving.
P1 | Observed: reset and deactivate selectors show no users. | Load all eligible company users independently of the visible table page.
P1 | Reported: Admin permission edits fail while Manager changes save. | Verify the signed in role and enforce the agreed Owner and Admin authority.
P2 | Reported: audit date and action filters appear to work. | Verify complete logging and read only behavior.
Delivery standard: do not treat a toast, open dialog, or visible checkbox as proof that a workflow is complete. Verify saved data after refresh, email receipt where applicable, and actual account access.
# 1 Dashboard counters and navigation
Figure 1 Dashboard counters show Not loaded  |  Screenshot 2026-10-18 at 7.59.48 PM.png
Area | Correction and required behavior | Acceptance test
Total Users | Count accepted accounts in the selected company scope: Active + Locked + Inactive. Exclude Pending invitations. Clicking the card selects All Statuses and clears search and role filters for that company scope. | Compare with seeded accounts in each status. Pending remains separately counted even though All Statuses includes it.
Active Users | Count Active accounts in scope. Clicking filters the table to Active. If a percentage is displayed, divide active by total accepted accounts; handle zero safely. | Compare card and table counts after activating and deactivating a test account.
Pending Invitations | Count pending invitations separately. Clicking filters to Pending. Accepted invitations leave this count. Define expired and revoked invitation handling consistently. | Send, accept, resend and revoke a test invitation; verify no double counting.
Roles | Count saved configured roles in scope. Required named roles total nine before custom roles. Other is an action and does not increase the count. | Create one custom role: count increases by one after successful save only.
Loading and errors | Show a loading state while fetching, then real values. A failed request must show an error and Retry rather than 0 or a misleading empty state. | Simulate loading, success, failure and retry. A valid zero displays 0.
Use the same company scope for cards, table and actions. All Companies must include only companies the signed in account may access; it must not expose another firm’s records.
# 2 Employee table search filters and export
Figure 2 User table cannot load  |  Screenshot 2026-10-18 at 7.59.59 PM.png
Control | Required behavior | Test
Employee data | Users here are employees and staff with system access, not customers. Load name, work email, role, company, status, MFA state, last login and row actions. | Verify against stored records and refresh.
Search | Match name, email and role; combine with company, role and status filters. | Search full and partial values; verify no matches and clearing search.
Company and role | All Companies and All Roles clear only their own filter. Role options include all saved roles. | Combine filters and confirm the result set stays within authorized companies.
Status | Default to All Statuses. Options are Active, Pending, Locked and Inactive. Locked is a security block; Inactive is a deliberate deactivation. | Check each state and document the unlock flow or waiting period.
Empty and error states | Use No employees added yet for a genuinely empty dataset; No employees match your filters for no matches; Unable to load employees with Retry for failures. | Trigger each state independently.
Export CSV | One Export button downloads basic employee fields for all matching pages using current filters and search. All Statuses with cleared filters includes active, pending, locked and inactive records in scope. Never export passwords, activation codes, reset tokens or MFA secrets. | Compare CSV rows to the entire filtered dataset, including records beyond page one.
Pagination and actions | Page size, displayed range, total and number of pages agree. Row actions target that exact employee. Define selection scope and available bulk actions when checkboxes are enabled. | Use more than one page; change page size and filters; check last page and row identity.
Reference image note: the original design illustration showed 1–8 of 28, 10 per page and four pages. Treat those numbers as mockup data; live pagination must be calculated from actual results.
# 3 Roles and permission authority
Figure 3 Role Permissions and Module Permissions  |  Screenshot 2026-10-18 at 8.00.12 PM.png
Requirement | Implementation direction
Required roles | Owner, Admin, Manager, Staff, Bookkeeper, Tax Preparer, Client Support, Read Only and Business Consultant. Include All Roles in the filter. Other opens custom role creation; it is not a saved role.
Owner and Admin | As requested, Owner and Admin can edit all roles and permissions in their authorized company scope. Do not reject these edits solely because a role is equal to their own or a permission is not currently checked for them. Verify the signed in account’s actual role; do not infer it from the failed save.
Role level permissions | Selecting Staff edits the Staff role only. Save applies its defaults to all employees assigned that role in that company, subject to individual overrides. It does not assign the role or change other roles.
Individual overrides | Add an employee profile permission editor available to Owner and Admin. Each permission supports Inherit, Allow or Deny. A saved override takes priority over the role default. Reset to Inherit restores the role default.
Save and cancel | Load saved permissions for the selected role. Checkbox edits are drafts until Save Changes. Confirm success only after persistence; keep drafts and show a clear error on failure. Warn before leaving unsaved edits.
Enforcement | After saving, enforce effective permissions on subsequent protected requests. Menus reflect changes on next page load or sooner. Direct links and backend requests must also deny removed access.
Reset to Default | Clearly identify the selected role and company before restoring its defined baseline. Confirm before applying, preserve other roles and employee overrides, and record the change.
Permission Details | Update the panel when a module or permission is selected. Name the role and explain the selected action. This is explanatory; it does not save changes.
Reported test result: a Manager permission save displayed Permission saved. Admin editing returned a restriction message. Neither persistence after refresh nor actual access changes were confirmed. Retest both with a known Owner or Admin account.
# 4 Permission coverage and custom roles
Cover every applicable module, including Dashboard, Clients, Leads, Appointments, Intake Forms, Documents, Client Portal, Tasks, Tax Returns, Bookkeeping, Payroll, Tax Planning, Business Advisory, Invoices and Payments, Messages, Communications, Automations, Compliance, Reports, Templates, Services and Pricing, Staff Management, Integrations and Settings. Use View, Create, Edit, Approve, Export and Admin where meaningful; mark inapplicable actions clearly. Document dependencies such as needing View before Edit.
Figure 4 Role Details still reports custom roles unavailable  |  Screenshot 2026-10-18 at 8.03.53 PM.png
Step | Required custom role flow
1 Select entry | Manage Roles may open Staff Management > Roles & Permissions. This destination is acceptable when it opens that exact tab and preserves company scope; do not flag the route itself as broken.
2 Name and template | Create Custom Role or Other opens Role Name, optional Description and Start From. Selecting a role template copies its current defaults without changing the original template.
3 Set permissions | Next or Create Role automatically opens a Set Permissions dialog. Show all module permissions with the template defaults preselected. Owner or Admin can adjust every applicable option.
4 Save Role | Validate a nonblank role name and prevent duplicate names in the same company. Save the role and its permissions together. Cancel must not leave an incomplete usable role.
5 Synchronize | After successful save, show the new role in Manage Roles, the role filter, invite form, employee assignment and role count. Add Edit Permissions for later changes.
6 Template list | Include Business Consultant. Keep Owner, Admin and other configured roles consistent across selectors. Display all role counts from saved data.
Missing screen to build: the Set Permissions dialog does not yet exist in the supplied evidence. Figure 4 documents the blocker, not a completed permissions selection flow.
# 5 Invite User and staff record connection
Figure 5 Invitation submission returns We could not find that  |  Screenshot 2026-10-18 at 5.45.18 PM.png
Area | Correction and flow
Entry points | Top Invite User and Quick Actions > Invite User open the same workflow. Create the employee in Staff Management first, then invite that existing record; do not create duplicate staff records.
Form | Provide a searchable existing employee selector; auto fill name and work email from that record. Select a role and show its description or permissions summary. The short invitation form is otherwise sufficient; no activation code field is needed.
Submit | Validate employee, work email, role and company. Prevent duplicate active accounts and duplicate pending invites. Preserve inputs after errors. Replace the current vague not found error with a meaningful recoverable message.
Success | Persist the invitation, confirm the result, update Pending Invitations and deliver the activation email. Do not claim email was sent when delivery failed; provide retry or resend.
Activation | Automatically generate a one time activation code and email it with the setup page link. The employee verifies the code, creates their own password and completes two factor setup before normal access.
Expiry and resend | Set a documented expiration time. Reject used and expired codes. Resend creates a new code and invalidates earlier codes. Never display codes or passwords to an admin or write them to logs.
Linking and logging | Accepted access remains linked to the original staff record and selected company. Log inviter, employee, assigned role, company, timestamp and outcome. Pending becomes Active after required setup.
Observed evidence plus user report: the error appeared after completing the form and attempting to send. Invitation delivery and activation were not completed during this review.
# 6 Quick Actions and role templates
Figure 6 Quick Actions and Role Templates  |  Screenshot 2026-10-18 at 8.00.20 PM.png
Quick action | Required destination and outcome
Invite User | Open the same existing employee invitation flow as the top button. See section 5.
Manage Roles | Open Staff Management > Roles & Permissions with the role selector and custom role workflow available. Preserve company context. See section 4.
View Audit Log | Open a searchable read only log. Allow date and action filters, detail viewing and authorized export. See section 9.
Reset User Passwords | Open a searchable selector across all eligible company users, then a confirmation and Send Reset Link. See section 7.
Deactivate User | Open a searchable selector, then a named confirmation before removing access. See section 8.
Role Templates | Clicking a template starts custom role creation with its permissions as a baseline. Adjust and save the new role without changing the source template.
Use the same action implementation from both quick links and employee row menus. Dialogs need working Cancel and Close controls, keyboard focus, meaningful loading states and clear success or failure feedback.
# 7 Reset User Password
Figure 7 Reset selector is empty and Continue is unavailable  |  Screenshot 2026-10-18 at 7.51.03 PM.png
Step | Required behavior | Acceptance check
Select | Search all eligible existing company users by name or email, regardless of table pagination or current filters. | Find a user beyond page one and under a different table filter.
Continue | Enable only after a valid selection. Show the selected name and email on a confirmation screen. | Check selected identity and cancel with no side effect.
Send Reset Link | Send an expiring one use link to the email on file. The employee chooses their own password. | Receive email, use link once, reject reuse and expiry.
Feedback and audit | Show accurate success or error, allow safe retry, and log requester, target, company, time and outcome. | Verify log contains no passwords, codes or reset tokens.
Self service | Keep Forgot Password on sign in functional so employees can initiate their own reset. | Test a known test account through reset and sign in.
Correction: No users on this page must not be the selector’s normal behavior when users exist. Investigate whether the empty picker shares the same failing user data source as the main table. Root cause is not yet confirmed.
# 8 Deactivate User
Figure 8 Deactivation selector is empty  |  Screenshot 2026-10-18 at 8.04.13 PM.png
Step | Required behavior | Acceptance check
Select employee | Search eligible company users independently of current page and table filters. | Find the correct test employee by name and email.
Continue and confirm | Show name, email and company, explain access will stop and records remain, and require explicit Deactivate confirmation. | Cancel leaves the user Active with no access change.
Deactivate | Set status to Inactive, block future sign ins and revoke active sessions or otherwise prevent further protected requests. Preserve staff history, documents and assigned records. | Confirm a previously signed in test account loses access and records remain.
Refresh counts | Remove from Active Users and keep in Total Users. Make the employee discoverable under Inactive and All Statuses. | Compare cards and filtered table after refresh.
Audit and recovery | Log actor, employee, company, time and outcome. Provide an authorized reactivation path. Protect against removing the last viable owner or administrator without a replacement. | Test successful deactivation, failed request, reactivation and last administrator handling.
Evidence limit: the supplied image shows the initial selector, not the final confirmation. The earlier reported confirmation does not prove that account access was removed. Build and verify the full flow above.
# 9 Audit log and test execution
The audit log must be read only for every role, including Owner and Admin. No edit or delete control may alter an existing entry. A correction elsewhere creates a new entry rather than rewriting history. Date and action filters were reported to work; complete event coverage and export remain unverified.
Event family | Minimum record and verification
Access management | Invitation creation, resend, acceptance and revocation; role assignments; role creation and permission edits; individual overrides; resets; lock and unlock; deactivation and reactivation.
Event data | Actor identity, company, affected account or role, action, timestamp with timezone, outcome and relevant permission changes. Include safe error details; exclude credential values and secrets.
Coverage | Verify each Users & Roles action creates the appropriate entry. Define and test logging for other material application actions across the remaining modules separately.
Read and export | Authorized search, date and action filters, detail opening and export work. Unauthorized users cannot access the log or download it.
# Acceptance test register
Use disposable development accounts. For each case record Pass or Fail, tester, date, build and evidence. All cases below require execution unless the current evidence status explicitly states only an observed UI response.
Test | Steps and expected result | Current evidence
T01 Data loading | Open page; verify four counters and populated table. Fail requests; verify Retry and recovery. | Observed failure
T02 Counts and cards | Seed accepted accounts across statuses plus pending invitations. Verify totals and each card’s filter. | Needs verification
T03 Search and filters | Combine name, email, role, company and status; clear each independently; verify all empty states. | Blocked by data loading
T04 CSV and pages | Export filtered data spanning multiple pages; compare counts and safe columns. Verify page size and last page. | Needs verification
T05 Invitation | Select existing staff, send, verify email and counter; accept with code and complete setup. | Submission failed in review
T06 Invite edge cases | Invalid email, duplicate account, expired or used code, resend and delivery failure produce correct results. | Needs verification
T07 Role authority | Known Owner and Admin edit Admin and Manager permissions; refresh and verify actual access. Lower roles cannot self elevate. | Admin save rejected; Manager success reported
T08 Role scope | Edit Staff permission; all Staff inherit it, other roles do not change. Verify company isolation. | Needs verification
T09 Overrides | Deny one Manager Dashboard access; other Managers retain it. Reset to Inherit restores defaults. | Required feature
T10 Custom roles | Create from template; edit defaults in dialog; save; verify all selectors and count. Cancel leaves no partial role. | Unavailable in screenshots
T11 Password reset | Find user beyond first page; confirm; email reset; test expiry, reuse and new login. | Selector empty
T12 Deactivate | Select, cancel, confirm; verify inactive state, counters, preserved records and revoked access. Reactivate. | Selector empty
T13 Audit | For T05–T12 verify accurate immutable events, search, filters and authorized export without secrets. | Filters reported working only
T14 Persistence and UI | Refresh saved settings; test direct links, keyboard dialogs, mobile layout, cancel and failure recovery. | Needs verification
# 10 Additional screenshot evidence
These images show alternate states of the same workflows. They support the correction list and do not demonstrate successful completion.
Figure 9 Create Custom Role modal blocks creation  |  Screenshot 2026-10-18 at 7.46.02 PM.png
Figure 10 Alternate Role Details screen retains entered name but cannot create a role  |  Screenshot 2026-10-18 at 7.54.11 PM.png
Developer handoff: return the completed test register, relevant screenshots and test email evidence after fixes. Include build identifier and any unresolved items. Do not close loading, invitation or access control issues based solely on visual changes.
# 11 Additional account management corrections and flows
These requirements complete the connections between the employee table, staff profiles, invitations, permissions, counters and audit log. They are implementation requirements and require testing; no completed functionality is implied. Existing screenshots remain in sections 1 through 10.
# Changing an existing user role
From the employee row or staff profile, Owner or Admin selects Change Role. Show the employee name, work email, company, current role and a selector containing saved roles in that company. Preview the new role permissions and any existing individual overrides. Save changes the assignment for this employee only; role defaults and other employees remain unchanged. Preserve individual overrides and clearly explain their effect. Enforce new effective permissions on the next protected request, update the table and profile, and log old and new role plus actor and outcome. Cancel changes nothing. Prevent removal of the last viable Owner or Admin. On failure preserve the current assignment and allow retry.
# Revoking pending invitations
From Pending Invitations or the employee row, Owner or Admin selects Revoke Invitation. Show identity and company and require confirmation. Revoke invalidates every outstanding activation code and setup link for that invitation, removes it from the pending count, and preserves the staff record and invitation history. Show Revoked in invitation history; the staff record remains available for a new invitation. A revoked link cannot activate an account. Cancel leaves the invitation valid. If acceptance happened first, report the current account state and use Deactivate User instead. Log the outcome.
# Unlocking an account
From a Locked employee row or profile, Owner or Admin opens Unlock Account, reviews identity and confirms. Clear the temporary authentication lock and failed-attempt counter, retaining the role, overrides, password and MFA configuration. Return to Active only when the lock was the sole restriction; never unlock an Inactive account into access. Require normal sign-in and MFA. Update status and affected counts and log actor, target and outcome. Cancel or failure leaves restrictions unchanged. Unlocking does not reset a password.
# Reactivating a user
Filter to Inactive, open the employee row or profile and select Reactivate. Owner or Admin reviews identity, company, saved role and overrides before confirmation; provide Change Role if needed. Restore access only after successful save. Preserve history and do not restore previously revoked sessions; require a fresh sign-in and configured MFA. Update status to Active, Active Users count and table; Total Users stays unchanged. Log the action. Reactivation does not bypass a separate security lock or MFA requirement. Cancel or failure leaves the account Inactive.
# Bulk selection and available actions
Checkboxes select rows only and never execute an action. The header checkbox selects eligible rows on the current page and displays the selected count. Preserve selections across pagination within the same filter set; clear selection on search, company, role or status filter changes. Do not silently select all matching pages. Proposed initial actions are Export Selected, Resend Invitations and Deactivate Selected; exclude bulk role assignment, unlock, reset and reactivation until separately specified. Validate eligibility and authority again when executing. Resend applies only to Pending invitations; deactivate only to eligible accepted accounts, excluding the acting account and the last viable Owner or Admin. Show affected identities, exclusions and explicit confirmation before email or access actions. Report success, skipped and failed results per user; retry failures only. Refresh counts and log each affected user. Export Selected exports only selected authorized records and excludes secrets. Disable any bulk control that lacks implementation.
# Code and link expiration defaults
Proposed implementation defaults: invitation activation code and associated setup link expire 24 hours after issuance; password reset link expires 30 minutes after issuance. Both are single use and validated by the server at submission, using stored issuance and expiry timestamps. Resend or requesting a newer credential invalidates all earlier unused credentials for that invitation or reset purpose. Expired invitation remains Pending with an Expired indicator until resent or revoked; it is included in Pending Invitations. Rejected expired credentials cannot change account state. Show clear expiry and recovery instructions; a new invitation or reset receives a fresh expiry. Never extend expiry merely by opening a page. These durations are proposed product defaults, not a claim about existing behavior.
# 12 Additional acceptance tests
Execute alongside T01 through T14. Record tester, build, date, result and evidence. All tests below are pending execution.
Test | Action and expected result | Connections to verify
T15 Role reassignment | Change a test employee role; verify effective access after refresh and on direct requests. Cancel and fail the save; existing role remains. Test overrides and last administrator protection. | Employee row and profile; role selector; permissions; audit.
T16 Invitation revocation | Revoke a pending invitation; old code and setup link fail, pending count decreases once and staff history remains. Test cancel and an invitation accepted just before revocation. | Pending list; activation page; counters; audit.
T17 Account unlock | Unlock a security-locked account; normal sign-in with MFA succeeds. Verify inactive users remain blocked and failed or cancelled unlock changes nothing. | Locked filter; status; access checks; counters; audit.
T18 Reactivation | Reactivate an inactive test employee; verify fresh sign-in, role and overrides, preserved history and correct counts. Old sessions stay invalid. Test a separate security lock, cancel and request failure. | Inactive filter; profile; authentication; counters; audit.
T19 Bulk actions | Select across pages, change filters and check clearing. Verify eligible and ineligible mixed selection, confirmations, selected-only export, partial failures and retry of failed users only. | Selection count; action eligibility; per-user outcomes; counts; audit.
T20 Expiry and replacement | With a controlled clock, test both credentials immediately before and at expiry, after use, and after replacement. Old credentials fail; expired invitations remain Pending with Expired indicator. | Email; setup and reset pages; server validation; invitation count; safe audit.