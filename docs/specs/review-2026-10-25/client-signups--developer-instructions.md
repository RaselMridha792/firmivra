
Firmvra Firm WorkspaceClient Sign UpsDeveloper Instructions
New functional specification  •  Version 1.0  •  25 October 2026
Build the Firm Workspace workflow for clients who sign themselves up to a firm. Staff must be able to review requests, protect existing client identities, and approve or decline a request without creating duplicate client profiles. This document specifies intended behavior, not findings from a tested implementation.
Implementation priority
Preserve the existing Client ID whenever an applicant is an existing client. A potential match must stop automatic approval and remain pending. Staff must call the contact already on file, verify identity, and record the client’s permission before restoring access or linking the request to the existing Client ID.
Label
Meaning and implementation treatment
APPROVED REQUIREMENT
Product direction to implement. Explicit restrictions take priority over convenience.
RECOMMENDED SAFEGUARD
Proposed technical design to achieve the approved behavior. Engineering may choose an equivalent design without weakening the requirement.
OWNER DECISION PENDING
Not yet approved. Do not silently choose a production behavior or treat a suggested default as authorization.
Table colors: blue for functions and contracts, green for verification and tests, amber for decisions still pending. Labels remain authoritative.
Scope and exclusions
In scope: the expanded Firm Workspace sidebar, Client Sign-ups tabs and counts, search and filters, applicant details and history, manual review, the firm approval-mode setting, potential-match review, and separate client recovery actions.
Out of scope: platform-level applications from firms; collapsed-sidebar design; paid-service enrollment; automatic record closing, replacement, or merging; and executing any real setting change. No developer or third party is authorized to receive this document automatically.
How to use this specification
Sections 2–6 define the experience and controls. Sections 7–10 propose implementation contracts and failure handling. Sections 11–12 provide acceptance scenarios. Section 13 lists unresolved policies and release gates. Section 14 specifies origin-aware return paths for every flow. Route names and permission keys are proposed contracts, not claims about the existing codebase.

2 Workspace navigation and list behavior
APPROVED REQUIREMENT. Use only the expanded sidebar design. Client Sign-ups belongs to the firm workspace and deals with the firm’s own client applicants. Retain the established Firm Workspace navigation and clearly mark Client Sign-ups as active.
Part
Behavior
Guard or outcome
Sidebar item
Open the firm’s Client Sign-ups list. Keep the active firm visible.
Do not route to platform firm applications.
Waiting for Approval
Show requests requiring review, including unresolved potential matches. Display a count.
Potential matches remain here until valid resolution.
Approved
Show approved requests and their canonical Client ID when permitted. Display a count.
Approval is not payment or service enrollment.
Declined
Show declined requests with permitted decision metadata. Display a count.
No implicit deletion of request history.
Search
Search the authorized tenant’s applicant records. Clear resets the query.
Never search across firms or expose hidden records.
Filters
Offer applicable filters with visible current selections and a clear action.
Exact filter set is a proposed detail below.
Result row
Show applicant identity, submission date, status, and an explicit detail action.
A name alone never proves account ownership.
Detail action
Open the selected request without changing its decision.
Enforce authorization again on the server.
Recommended list contract
Use submission date newest first, with a stable request-ID tie-breaker. Suggested filters are submission date range and potential-match status. Use server pagination and tenant-scoped queries. Store the selected tab, query, filters, and page in navigation state so Back returns to the same view. Reset to the first page after a filter change.
Recommended count semantics: tab badges show tenant-wide totals for each status, independent of search; the result region separately states the filtered total. Label this distinction. Refresh list and counts after a committed transition, not on an optimistic click. Exact search fields and count semantics should be confirmed during product review.

3 Applicant details and staff actions
APPROVED REQUIREMENT. The detail view shows the application, original submission date, current status, and chronological history. Treat submitted contact information as unverified unless the canonical verification system establishes otherwise.
Part
Function
Action behavior
Applicant summary
Name, submitted contact, request ID, submission date and current status.
Display missing values explicitly; do not invent data.
Match alert
Explain that an existing-client match needs staff review.
Block automatic approval and unsafe linking.
Review Match
Compare permitted applicant data with candidate canonical records.
Comparison is read-only; opening it grants no access.
Resolve Existing Account
Present the mandatory verification and permission checklist.
Staff-only flow, distinct from client recovery.
Restore Access
Start the existing canonical recovery flow.
Disabled until all checks and permissions pass.
Link Existing Record
Associate the request with the verified existing Client ID.
No replacement ID, contact overwrite, or merge.
Not a Match
Record an authorized conclusion that candidates are not this applicant.
May proceed toward a new canonical client after a fresh check.
Keep Pending
Leave the request waiting and record a permitted note if needed.
Always available to an authorized reviewer; no account change.
Approve or Decline
Commit an allowed final decision after validation.
Show current result and preserve history.
Decision presentation
Recommended safeguard: show the applicant, firm, intended outcome, and any linked Client ID in a confirmation step before a consequential staff action. Distinguish restoring access from approving a request. Do not conceal invitations, recovery messages, or identity links behind an ambiguous Save button.
Disable unavailable actions with a plain explanation, such as “Complete verification and record client permission first.” A disabled button is only presentation: every guard must be repeated server-side. Terminal requests show their decision and history rather than misleading active action buttons.
History
Show who performed each authorized action, when it occurred, the resulting status, and a concise reason when required. Include mode changes and relevant verification events in their appropriate audit views. Never display passwords, recovery tokens, or unnecessary identity evidence in the history.

4 Existing client verification and resolution
APPROVED REQUIREMENT. A potential match always pauses automatic approval. Keep the request in Waiting for Approval until an authorized reviewer resolves it. A matching name, submitted email, or submitted telephone number is not sufficient authority to restore or grant access.
Required check
Staff workflow
Server gate
1 Call contact on file
Call a contact already held in the canonical client record. Do not use an unverified sign-up contact as the verification source.
Record the canonical contact reference and that the call check was completed.
2 Verify identity
Complete the firm’s approved identity-verification procedure with that existing contact.
Require a successful verification outcome by authorized staff.
3 Record client permission
Obtain and record permission for the specific restoration or link being performed.
Require permission scope, staff actor and timestamp.
4 Confirm target
Display the existing Client ID and requested operation.
Recheck firm ownership, candidate identity, permissions and record version.
5 Resolve safely
Restore through canonical recovery and/or link the verified record as specifically authorized.
Preserve Client ID; prevent duplicate profiles and duplicate invitations.
Incomplete or unsuccessful verification
If staff cannot reach the contact already on file, cannot verify identity, or cannot obtain permission, do not restore or link. Keep Pending remains available within the reviewer’s permission. Do not substitute a new profile to avoid the blocked verification step. Explain what is still required without exposing private candidate details to the applicant.
Not a Match
An authorized reviewer may record that the applicant is not any reviewed candidate. Store the reviewed candidate references, actor, time, and concise rationale. Re-evaluate matches immediately before creating a new canonical client. If a fresh or unresolved candidate exists, remain pending. Not a Match is not permission to merge identities or to discard an existing client record.
Actual duplicate records
Closing, replacing, or merging real duplicates requires a separate authorized review and a distinct permission. This workflow must not automatically execute any of those operations. Linking a request to an existing Client ID is not a data merge. Changes to canonical contact details require the separate authorized profile-maintenance workflow.
OWNER DECISION PENDING. The exact identity-verification procedure, acceptable permission evidence, and verification expiry require a firm policy. The mandatory call, identity check, and recorded client permission are not optional while that policy is finalized.

5 States and approval mode
APPROVED REQUIREMENT. Waiting for Approval, Approved, and Declined are the visible decision states. Use a separate resolution or match flag for pending work so a potential match does not disappear into an unreviewed fourth tab.
Current condition
Allowed event
Result and restriction
New submission
Validate and evaluate tenant approval mode.
Create one request; route to pending or eligible approval.
Manual review mode
Submit valid request.
Waiting for Approval; staff decision required.
Automatic mode with potential match
Detect or refresh any unresolved candidate.
Waiting for Approval; do not auto-approve.
Automatic mode without match
Evaluate approved eligibility policy.
Approve only if every approved condition is met.
Waiting with unresolved match
Review or Keep Pending.
Remain waiting; no new access granted by this request.
Waiting with verified existing client
Execute specifically permitted link or recovery.
Preserve existing Client ID; decision is explicit.
Waiting with no remaining match
Authorized approval.
Approved with one canonical Client ID.
Waiting
Authorized decline.
Declined; retain history.
Approved or Declined
Repeat same committed request.
Return the existing outcome; do not replay side effects.
Approval mode setting
APPROVED REQUIREMENT. The firm can select manual review or automatic approval through a permission-controlled setting. A change needs confirmation and an audit entry. The confirmation must name the firm, current mode, requested mode, and effective scope. Cancel leaves the setting unchanged. This specification authorizes design only, not changing a live setting.
RECOMMENDED SAFEGUARD. Version the setting and reject stale edits. Record actor, time, old mode, new mode and policy version. Use the committed policy version for each decision and revalidate at commit. A mode change must never silently bulk-approve the existing queue.
OWNER DECISION PENDING. Exact automatic-approval eligibility beyond the mandatory duplicate block is undecided. Do not infer that “no match” alone means eligible. Treatment of existing pending requests on a mode change also needs an explicit decision. Proposed default: apply changes prospectively and retain existing pending requests for review.

6 Permissions and tenant boundaries
APPROVED REQUIREMENT. Enforce tenant isolation, server-side authorization and least privilege for every read and write. The following capability names are recommended implementation labels; map them to the established permission model. Do not infer authority from a job title alone.
Proposed capability
Permitted scope
Never implied
signups.read
Read authorized requests, lists and permitted history in the active firm.
Decision, recovery, link or settings access.
signups.review
Review a pending request and Keep Pending.
Access to all client data or permission to merge.
signups.decide
Approve or decline after all state and identity guards pass.
Bypass of a potential-match hold.
clients.match.read
Read the minimum candidate data needed to compare.
Automatic identity verification or linking.
clients.identity.verify
Record required call and identity checks.
Permission on behalf of the client.
clients.access.restore
Execute canonical recovery after checks and recorded permission.
Reset a password directly or expose a secret.
clients.identity.link
Link the request to the verified canonical Client ID.
Merge, close, replace, or overwrite records.
firm.signup_policy.manage
Propose and confirm a firm approval-mode change.
Bulk approval or cross-firm changes.
clients.duplicates.manage
Separate duplicate-review workflow, if implemented.
Access through this sign-up page by default.
Authorization sequence
Resolve the authenticated actor and permitted firm from trusted session context. Check membership and capability; load the request and target record within that firm; enforce current state and verification guards; commit atomically. Reject a supplied firm ID that is outside the actor’s scope. The server must not rely on hidden fields, disabled controls, or client-side role claims.
Client and staff separation
A client preview contains only Sign In, Reset Password, and Contact Firm as applicable. Never render Restore Access, Link Existing Record, Review Match, approval decisions, internal candidate comparisons, or verification checkboxes in the client interface. Preview mode must not execute a real recovery, invitation, or account modification.
Recommended safeguard: deny by default when permission is missing or cannot be evaluated. Recheck after session changes and at commit. Minimize candidate data and audit access to sensitive identity comparisons.

7 Proposed routes and service contracts
RECOMMENDED SAFEGUARD. Adapt these conceptual routes to the actual application architecture. They describe destinations and operations, not verified existing URLs. All staff routes require tenant-scoped authorization; every write uses an idempotency key and expected version.
Conceptual route or operation
Purpose
Required contract
/firm/{firmId}/client-signups
List tabs, counts, search and filters.
GET; validated status, query, cursor and filters.
/firm/{firmId}/client-signups/{requestId}
Show applicant details and history.
GET; tenant-scoped request and permitted fields.
/…/{requestId}/matches
Review candidate existing clients.
GET; capability and minimum necessary data.
/…/{requestId}/verification
Record call, identity outcome and client permission.
POST; target Client ID, evidence metadata, version.
/…/{requestId}/resolution
Keep Pending, Not a Match, or Link Existing Record.
POST; explicit action and relevant guards.
/…/{requestId}/restore-access
Invoke canonical account recovery.
POST; all checks, scoped client permission, one operation ID.
/…/{requestId}/decision
Approve or decline a waiting request.
POST; decision, reason if required, expected version.
/firm/{firmId}/settings/client-signups
Read or change approval mode.
GET or PATCH; capability, confirmation and policy version.
Client sign-up and recovery routes
Submit; Sign In; Reset Password; Contact Firm.
Separate public or client surface; no staff capabilities.
Response and validation contract
Return a stable request ID, current state, version, permissible actions, and an operation or correlation ID. Use clear validation errors for invalid input; an authorization failure for denied access; not-found behavior that does not leak another tenant’s records; and a conflict response for a stale version or incompatible decision. Never include stack traces or secrets in the UI.
Normalize comparison fields without silently changing submitted identity. Validate required fields against the approved sign-up form; exact field inventory, length limits, and matching rules must be confirmed against the canonical data model. Rate-limit public submission and recovery using the existing abuse controls. Public responses must not disclose whether a matching account exists.
Recoverable conflict
When another reviewer acts first, fetch the authoritative request and explain that it changed. Preserve an unsent note where safe, but require fresh review before a different decision. Do not automatically retry a stale approval against a newly linked or declined request.

8 Data integrity and concurrent operations
RECOMMENDED SAFEGUARD. Store the request separately from the canonical Client record. A request may be pending without creating a new client. Keep decision status, identity-match resolution, and access-provisioning status distinct so one cannot falsely imply another.
Record or field group
Minimum purpose
Integrity requirement
Request
Request ID, firm ID, submitted fields, submitted time, state and version.
Stable identity; preserve original submission.
Canonical association
Existing or newly created Client ID.
One approved target; never mint a replacement for an existing client.
Match review
Candidate references, resolution, reviewer, time and rationale.
Unresolved candidates block automatic approval.
Verification record
Canonical contact reference, call outcome, identity result, permission scope, actor and time.
No passwords, recordings or excess identity evidence by default.
Policy snapshot
Mode, policy version and decision evaluation result.
Trace why an automatic decision was eligible.
Audit event
Actor, firm, request, action, old/new state, time and correlation ID.
Append-only or tamper-evident design recommended.
Side-effect operation
Invitation or recovery operation ID, status and retry metadata.
Unique operation; no duplicate invitations or recovery dispatches.
Atomic decision and side effects
In one guarded transaction, re-read the request version, tenant, permissions, current match result, canonical target, and eligibility policy. Commit the decision and intended side-effect record together. Recommended pattern: transactional outbox with a deduplicated worker. Send a canonical invitation or recovery message only through the established service, not directly from the browser.
Idempotency and races
A repeated submission with the same idempotency key and payload returns the same request. Reuse with a different payload is a conflict. Approval retries return the committed Client ID. Two reviewers cannot both commit conflicting decisions. A new match discovered between review and commit blocks creation. Database constraints and transaction isolation must prevent concurrent submissions from producing duplicate canonical profiles.
If a network timeout leaves the outcome unknown, look up the operation before retrying. If provisioning fails after approval, show approval and provisioning separately and retry only the failed side effect. Never create a second client to recover from an invitation failure. Repeated independent sign-ups are matched and reviewed, not blindly discarded or auto-merged.

9 Client access and communications
APPROVED REQUIREMENT. Approval does not enroll the client in a paid service, create a subscription, or authorize a charge. It must not manufacture a second account when a canonical client already exists.
Surface or event
Expected behavior
Policy boundary
Sign In
Use the established authentication destination.
No staff action or candidate disclosure.
Reset Password
Use canonical self-service recovery and neutral responses.
Do not reveal account existence or send credentials.
Contact Firm
Use the firm’s approved contact destination.
No exposure of internal match notes or client records.
New client approved
Associate one canonical Client ID; use established portal invitation if required by approved access policy.
Track invitation separately from decision.
Existing client verified
Use existing Client ID and authorized canonical recovery or link.
Do not overwrite contacts with submitted data.
Waiting for Approval
Display a pending outcome without promising specific access.
Pending-client access policy is unresolved.
Declined
Retain staff decision and history.
Whether and how to notify the client is unresolved.
Delivery failure
Show delivery status to authorized staff and allow safe retry.
No second decision, profile, or duplicate dispatch.
Notification safety
RECOMMENDED SAFEGUARD. Separate the decision event from message delivery. Deduplicate notification jobs, retry transient delivery failures, and preserve provider outcomes without logging credentials or full recovery links. Copy must use the firm’s approved template and avoid disclosing candidate accounts, internal verification notes, or other clients’ data.
Recovery for an existing client must use the verified canonical destination. A newly submitted address does not become a trusted recovery destination because a form was completed. Changes to recovery contacts belong to a separately authorized identity-maintenance process.
Pending decisions are release dependencies
OWNER DECISION PENDING. Confirm whether a pending applicant has no portal access, limited status-only access, or another specifically defined entitlement. Confirm exact automatic-approval eligibility. Confirm whether declines notify applicants, by which channel, with what wording, and whether staff may choose not to send. Do not ship guessed defaults for these branches.
PROPOSED DEFAULT ONLY. Until those choices are approved, keep affected behavior disabled or behind an explicit release gate. This is a recommendation for safe rollout, not an approved product policy or an instruction to change live settings.

10 Loading errors accessibility and responsive behavior
RECOMMENDED SAFEGUARD. The page must remain understandable when data is unavailable, an action is pending, or the viewport is small. Do not use color as the only indication of status or risk.
State
Presentation
Interaction and recovery
Initial loading
Stable skeleton or labelled loading indicator.
Do not show false zero counts or enabled decisions.
No requests
State that this status has no requests.
Retain tabs and navigation; no fabricated rows.
No search results
Show query or filter context and clear action.
Keep distinction from a globally empty queue.
List read failure
Plain error with retry.
Preserve tab and filters; do not render stale totals as current.
Action in progress
Label the specific pending action.
Prevent duplicate clicks; keep status unchanged until confirmed.
Network outcome unknown
Explain that confirmation is pending.
Query operation status before another write.
Permission lost
Explain access changed without exposing data.
Remove restricted content and block further operations.
Version conflict
Explain another change occurred.
Reload authoritative state and ask for fresh review.
Validation failure
Inline errors linked to affected fields.
Retain safe input and focus the first error.
Service unavailable
Indicate temporary unavailability.
Keep pending; never fall back to automatic account creation.
Accessibility
Use semantic headings and a labelled tab list with correct selected state and keyboard navigation. Search, filters, and every icon action need accessible names. Status badges need readable text. Announce asynchronous count changes and action results without repeatedly interrupting a screen reader. Maintain visible focus, adequate contrast, and usable touch targets.
Dialogs must trap focus, support an accessible close path, and return focus to the invoking control. The confirmation must identify the action and target. Required verification steps need individually associated labels, errors and state; never rely on a colored checkmark alone.
Responsive layout
Preserve the expanded-sidebar design as the approved desktop reference. On narrower screens, keep the same navigation labels and hierarchy in an accessible navigation region; do not invent a new collapsed-sidebar visual as an approved design. Tables may become labelled cards or use an accessible scroll region. Keep applicant identity and action context visible; avoid hiding mandatory checks below unreachable content.

11 Acceptance tests for functional behavior
Run these scenarios in a test tenant with synthetic applicants and canonical clients. Record actual results and evidence during implementation QA. These are specified tests, not tests already executed.
ID
Given and when
Required result
F01
Staff opens Client Sign-ups from the expanded firm sidebar.
Correct firm queue and active navigation; no platform firm-application screen.
F02
Staff selects each status tab.
Only that status appears; counts and filtered totals follow the agreed contract.
F03
Staff searches, filters, opens a detail, then returns.
Correct authorized results; query and filter context retained.
F04
A valid applicant submits under manual review.
One waiting request with submission date, state and history.
F05
An eligible applicant submits under automatic mode.
One approval only when the approved eligibility policy passes.
F06
A potential existing-client match is detected under automatic mode.
Remains waiting; no automatic approval, new duplicate profile or invitation.
F07
Staff opens Review Match.
Permitted comparison data only; no access restoration or link occurs.
F08
Staff has not completed one of call, identity check or client permission.
Restore Access and Link Existing Record are blocked in UI and API.
F09
Staff calls only the unverified contact from the new submission.
Required on-file call check is not satisfied; no restoration or link.
F10
All mandatory checks pass and staff links the existing client.
Original Client ID retained; no duplicate profile or contact overwrite.
F11
Staff cannot verify identity and chooses Keep Pending.
Request remains waiting; no entitlement or canonical-record change.
F12
Authorized staff records Not a Match and approves after a fresh clear match check.
At most one new canonical client; no merge or deletion of reviewed candidates.
F13
Staff declines a waiting request.
Declined state and audit retained; notification follows only the approved policy.
F14
A client views the recovery preview.
Only Sign In, Reset Password and Contact Firm; no staff controls or real side effects.

12 Acceptance tests for safety and resilience
ID
Given and when
Required result
S01
Actor changes the firm ID or request ID to another tenant.
Read and write denied without disclosing the other firm’s data.
S02
Actor invokes an API action hidden by their role.
Server rejects it; no state or side-effect change.
S03
Only a matching name is supplied.
No identity verification, access grant or automatic link.
S04
Two staff approve and decline the same version concurrently.
Exactly one compatible transition commits; the other sees a conflict.
S05
Submit or approve is retried after timeout with the same key.
Same request or committed Client ID returned; no repeated side effects.
S06
An idempotency key is reused with different data.
Conflict; the earlier operation is not changed.
S07
A match appears after review but before approval commit.
Approval stops and request remains waiting for resolution.
S08
Two requests concurrently refer to the same existing client.
No duplicate canonical profiles; existing Client ID preserved.
S09
Invitation delivery fails after a successful approval.
Approval remains distinguishable from delivery failure; retry does not create a second client.
S10
Permission is revoked while the reviewer has a dialog open.
Commit fails authorization; restricted data and actions are refreshed.
S11
Authorized owner cancels or confirms a mode change.
Cancel changes nothing; confirm changes once and audits old/new values.
S12
A mode change races with an automatic decision.
Decision uses a validated committed policy version; no policy bypass.
S13
Staff tries merge, close or replace through the sign-up workflow.
No such automatic action; require a separate authorized workflow.
S14
Keyboard, screen reader and narrow viewport are used.
Tabs, errors, dialogs, checks and decisions remain operable and labelled.
S15
Logs and history are inspected after recovery and verification.
No passwords, tokens, full recovery URLs or excessive identity evidence.
S16
A request is approved without a paid-service purchase.
No subscription, service enrollment, invoice or charge is created.
Add policy-dependent tests after the owner decides pending access, automatic eligibility, decline notifications and any reversal or resubmission rules. A test cannot pass by substituting an unapproved default.

13 Owner decisions and implementation handoff
The approved identity protections are fixed requirements. The unresolved choices below need explicit product ownership before the affected behavior is enabled. Suggested defaults are proposals only.
Decision
Question to resolve
Implementation consequence
Pending client access
What can a pending applicant see or do before approval?
Define entitlements and client copy; do not infer access from request creation.
Automatic eligibility
Which conditions, beyond no unresolved match, make a request eligible?
Version the approved rules; block automatic approval without a complete policy.
Decline notifications
Should the client be notified, through which channel and with what content?
Define dispatch and retry rules before enabling this branch.
Verification procedure
What identity checks and permission evidence are accepted, and for how long?
Implement firm-approved validation without weakening the mandatory on-file call.
Mode-change scope
Do new settings affect only future submissions or also existing pending requests?
Proposed default: prospective only; never silently bulk-approve.
Decision reversal
Can a declined or approved request be reopened, and by whom?
No implicit reopening, resubmission merge or reversal until approved.
Data and UI details
What exact form fields, search fields, filters, matching rules and count semantics apply?
Align with canonical schema and approved visual; avoid invented production fields.
Retention and audit access
How long are request and verification metadata retained, and who can view them?
Apply approved retention and least-privilege policies; no secret storage.
Recommended build sequence
1. Confirm the outstanding policies and canonical client, authentication and invitation integration contracts.2. Implement the tenant-scoped request model, server guards, audit and idempotent operations.3. Build the expanded-sidebar list, detail and mandatory staff resolution flow.4. Add approval-mode controls and approved client communications.5. Execute all functional, permission, race, recovery and accessibility scenarios before release.
Definition of ready for release
The product owner has resolved every policy used by the release. Engineering has mapped all proposed routes and capabilities to the actual application. QA has recorded passing results for applicable tests, including concurrent and cross-tenant cases. Existing Client IDs remain intact. Delivery retries cannot duplicate clients or invitations. No live setting changes, external distribution, paid enrollment, or duplicate merging are part of this document’s creation.

14 Origin aware Back Cancel and Close paths
APPROVED REQUIREMENT. Every function and flow must provide a clear way back to where the person came from. Back is not a generic Dashboard shortcut. Preserve the originating tab, search, filters, pagination and scroll position where practical. Back, Cancel and Close are navigation actions only: they must never accidentally submit, approve, decline, send, restore, link or change settings.
Flow or destination
Required return path
State and safety behavior
Client Sign-ups list
Back to the actual preceding Firm Workspace destination.
Do not substitute Dashboard; retain that destination’s context where practical.
Applicant detail or history
Back to the originating list or authorized referring module.
Restore tab, query, filters, page and list position.
Review Match comparison
Back or Close to the exact applicant detail that opened it.
Retain request and originating list context; no resolution on exit.
Resolve Existing Account
Back or Cancel to the invoking applicant detail or match view.
Warn on unsaved verification entries; never record completion on exit.
Restore Access flow
Back or Cancel to the staff resolution view that launched it.
Before dispatch, leave without sending; after dispatch, show committed status and return without replay.
Link Existing Record
Back or Cancel to the invoking resolution view.
No link until explicit guarded commit; returning cannot undo a committed link.
Not a Match or Keep Pending
Close the action dialog to its originating review or detail view.
Discard only after an unsaved-input guard; do not commit a decision on close.
Approve or Decline confirmation
Cancel to the exact invoking detail view.
Keep existing status; after a commit, return with current authoritative outcome.
Approval mode settings
Back to the invoking settings area or Client Sign-ups view.
Preserve origin; guard unsaved selection; Cancel leaves live policy unchanged.
Canonical Client module
Back to the originating applicant or resolution view when opened from it.
Carry a validated return context; retain original Client ID and committed changes.
Client Sign In Reset Password or Contact Firm
Back or Cancel to the client screen that launched the flow.
Never return a client to staff routes or repeat authentication or message submissions.
Return context and unsaved changes
Recommended safeguard: carry a validated same-application return destination and safe UI state through nested flows. Support browser Back consistently. Reject arbitrary external return URLs and recheck access on return. On a direct deep link without prior context, use the nearest authorized parent view, label it explicitly, and never invent an originating screen. Warn before discarding unsaved changes; offer Stay and Discard and leave. Already committed operations remain committed.
Acceptance tests B01–B04: traverse every route above and verify its exact return destination; restore list context after nested review; cancel each write flow and verify zero side effects; test unsaved changes, browser Back, direct links, invalid return URLs and permissions lost while away. No Back control may issue a decision, recovery, invitation, link or settings mutation.
