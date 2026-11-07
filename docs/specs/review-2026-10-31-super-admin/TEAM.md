# Super Admin review (Oct 31): Team change list

Source: "Team Developer Feedback" (Oct 31, 2026, observations through 13:45 UTC, `/team`) against three Team guides (Oct 14): A Team Section (5 pages), B Hierarchy and Permissions v3 (10 pages), C Team master form (11 pages). Her codes are kept (T01, P01, R01, G01). In this report "R01 to R12" are AMBER Review 2 tests, not RED fixes. The owner decision on executive assignment has no code: it is ours, SA-TEAM-F01; the dummy-account plan is ours, SA-TEAM-Y01.

## Summary

1. F items: 6 (T01 to T05, F01). Y items: 16 (P01 to P03, R01 to R12, Y01). GREEN: 8 checks (G01 to G08), not items. Keep them working and re-test them with the dummy accounts.
2. Highest priority: T01, Add Team Member fails with "Adding team members is not available yet". Every Review 2 test depends on it.
3. Owner decision: executive-role assignment belongs to the company / platform owner only, not to anyone with the CEO, Super Admin or HR label (F01).
4. Schema: to check for T01 (how a platform member is invited). F01 uses the same platform-owner marker as SA-FRM-F09.
5. Role checks: T01 needs the admin-console guards for TEAM_MEMBER logins (the schema notes that letting TEAM_MEMBER sign in is a later PR); every administrative request checks actor, target authority, department, scope and permission (her "Required rule").
6. Shared: platform-owner check with SA-FRM-F09.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/team/`. API: `apps/api/src/admin-team/`. DB: `PlatformMember` (role definition, department, reports to, scope type and ids, status PENDING_INVITATION, PENDING_APPROVAL, PENDING_DEPARTMENT_HEAD_APPROVAL, ACTIVE, SUSPENDED, INACTIVE, DEACTIVATED), `PlatformRoleDefinition`, `PlatformRolePermission`, `PlatformMemberPermissionOverride`, `PlatformAdmin` (role SUPER_ADMIN or TEAM_MEMBER).

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-TEAM-T01 | T01 (B section 18; C sections 19 to 20) | `/team/new` > submit | One authorized attempt (QA Sales Manager, Revenue/Sales, level 4 Admin, Direct Reports, reporting to the CEO, Pending Invitation, email on, SMS off) failed: "Adding team members is not available yet". Roster unchanged. | Make creation work end to end: create the member (role, department, supervisor, scope, permissions from the template plus overrides), the admin-console identity as TEAM_MEMBER, and the invitation (email, SMS, both, or none per the form). Persist, reload, audit. Add the console guards so a TEAM_MEMBER login sees and calls only what its permissions allow. In QA, invitations go only to the controlled recipients. | To check: invitation record for platform members (an `invites` row or a new one). | Role: TEAM_MEMBER guards, actor-vs-target authority checks. Seed: set L. |
| SA-TEAM-T02 | T02 (A section 2) | Member cards | No account status and no permission-level label; "CEO" is a job title, not a level. | Add the account status badge and a permission-level label (for example "Level 4 Admin") to each card, shown per viewer permission. | No. | Seed: members with varied levels and statuses (set L). |
| SA-TEAM-T03 | T03 (A section 2; C section 3) | List view | No Reports To or Team columns; Location column empty in current data. | Add Reports To and Team columns. Empty data shows "Not set". Visibility follows the viewer's scope. | No. | Seed: supervisor chains and teams (set L). |
| SA-TEAM-T04 | T04 (A section 9) | Message composer > Subject | Subject marked required; guide A says optional. | Remove the asterisk and the requirement; a message with body and recipient but no subject sends. | No. | None. |
| SA-TEAM-T05 | T05 (C section 3) | Team page subtitle | "Manage your team, roles, and access." | Use "Manage team members, departments, roles, reporting relationships, and access permissions." | No. | None. |
| SA-TEAM-F01 | "Authority decision" (owner decision; B section 17; C section 25) | Add and edit member > executive roles | Not tested (no second identity). | Only the platform owner may assign or change an executive role (CEO, Chief Officer level). Check it on the server; a CEO, Super Admin or HR label alone does not grant it. | To check: same platform-owner marker as SA-FRM-F09. | Role: new platform-owner check. Seed: owner and non-owner CEO, Super Admin and HR logins. |

## B. Y items: clarifications (her P01 to P03)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-TEAM-P01 | P01 | Chief Officer, VP/Director and HR delegation and approval | Default: use guide B's stricter rules until the owner says otherwise. Chief Officer roles: platform owner only (F01). VP/Director: HR may add them only as Pending Department Head Approval; the department's Chief Officer finalizes. HR cannot grant authority above its own. |
| SA-TEAM-P02 | P02 | SDR template and scope | Default: SDR = Team View plus Sales view and edit on Own Records (assigned leads and opportunities); no export, no delete, no reassignment. |
| SA-TEAM-P03 | P03 | Explicit grants vs effective access; one team or several | Default: the profile shows "Effective access" with the source of each grant (role template, override, Super Admin full access). One team per member this round. |

## C. Y items: Review 2 tests (her R01 to R12) and accounts

Run allowed and denied cases as distinct test logins, not only through the Super Admin screen. Record test login, scope, expected allow or deny, actual UI and server result, saved record or delivery evidence and the audit entry. Keep addresses and credentials out of the results.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-TEAM-R01 | R01 | Create and save | After T01: create a member, reload roster and profile; unique email, required fields, dependent roles and supervisors, scope and permissions persisted. |
| SA-TEAM-R02 | R02 | Executive assignment | Owner vs non-owner CEO, Super Admin and HR logins; non-owner attempts denied on the server (F01). |
| SA-TEAM-R03 | R03 | Hierarchy and peers | Downward management, role ceilings, denied equal and higher-rank changes, circular reporting lines rejected. |
| SA-TEAM-R04 | R04 | Scope and escalation | Direct Reports, own records, team, department, location; cross-department grants; denied direct routes, API calls and scope enlargement. |
| SA-TEAM-R05 | R05 | Templates and edits | Department plus role loads its template; overrides stay within the grantor's authority with a custom marker; changing role or department warns before replacing custom access. |
| SA-TEAM-R06 | R06 | Approvals and audit | Pending members get no unapproved authority; approve, reject, return for changes; audit actor, target, before and after, time, approver. |
| SA-TEAM-R07 | R07 | Invitations | Email, SMS, both, none; only the chosen channels send; receipt and first login with controlled recipients. |
| SA-TEAM-R08 | R08 | Audience security | Company, department, location, team, member and custom-group audiences show only eligible recipients. |
| SA-TEAM-R09 | R09 | Compose and channels | Optional subject (T04), required body and recipient, real attachments and the 10 MB limit on the server, unavailable channels reported. |
| SA-TEAM-R10 | R10 | Replies and announcements | Replies stay in the thread; replies off makes the recipient view read-only; announcement permission and audience. |
| SA-TEAM-R11 | R11 | Groups and history | Create, edit and delete groups with confirmation; message history keeps attachments, reply settings and channel status. |
| SA-TEAM-R12 | R12 | Account lifecycle | Fixtures in every member status; permitted transitions, access revoked and restored, owned history kept. |
| SA-TEAM-Y01 | "Dummy account plan"; "Additional data required" | Test accounts | Dummy data set L in CHANGE-LIST.md: the three proposed QA accounts (QA Sales Manager level 4 Direct Reports; QA Sales Staff SDR level 6 Own Records; QA Support Staff level 6 Own Records, separate department) plus owner, non-owner CEO, Super Admin, HR, Chief Officer, VP/Director and restricted logins; supervisor chains in two departments; teams and locations; more than 12 members in every status. |

## D. Schema needs

To check only: the platform-member invitation record (T01) and the platform-owner marker (F01, shared with SA-FRM-F09).

## E. Role and permission notes

New: TEAM_MEMBER console guards (T01) and the platform-owner check for executive roles (F01). Every administrative request is authorized by actor, target authority, department, scope and the specific permission, on the server. No new models or extra features to resolve these findings (her rule).
