# R60: Super Admin Team (contract notes)

Part of `R60-backend.md` (step 9). Tables: R0's stage A (CREATING_TEAM 20261016_r0, migrations
`r0_platform_team_member_role` and `r0_platform_team_hierarchy`): `platform_admins`,
`platform_members`, `platform_departments`, `platform_role_definitions`,
`platform_role_permissions`, `platform_member_permission_overrides`; with `users` (the ADMIN pool)
and `audit_logs`. Catalog: `packages/db/prisma/seed-platform-team.ts` (13 departments, 129 roles,
the `team.*` template per level) and `bootstrap-platform-org.ts` (every SUPER_ADMIN mapped to CEO).
Contract: `packages/types/src/admin-team/` (`createAdminTeamClient`, `api.adminTeam`), under
`/api/v1/admin/team`. The screens' mock (`apps/web/src/mocks/admin-team.ts`,
`admin-team-catalog.ts`) set the method names and shapes; the tables set what is stored. This PR
is the contract only; the API follows in its own PR.

## Routes

All under `/api/v1/admin/team`.

| Method | Path                        | Client method              | What it does                                                                    |
| ------ | --------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/meta`                     | `meta()`                   | The signed-in member, their rights (`can`), the permission catalog, the filters |
| GET    | `/summary`                  | `summary()`                | The KPI row from the people they may see, with a count per status               |
| GET    | `/form-options`             | `formOptions()`            | Add Team Member's and the bulk dialogs' choices (departments, roles, scopes, …) |
| GET    | `/members`                  | `members(query)`           | The cards and the table: search, filters, sort and paging on the server         |
| POST   | `/members`                  | `createMember(body)`       | Add Team Member: login, admin row, org-chart row, invitation (`.created`)       |
| POST   | `/members/bulk`             | `bulkUpdate(body)`         | Change Department, Role or Status (Remove from Team) for several people         |
| POST   | `/members/invitations`      | `resendInvitation(body)`   | A new 7-day link for each person still Pending Invitation (`.invited`)          |
| GET    | `/members/:id`              | `member(id)`               | The profile panel and Edit Team Member                                          |
| PATCH  | `/members/:id`              | `updateMember(id, body)`   | Edit Team Member: only the fields given (one audit entry per kind of change)    |
| GET    | `/members/:id/activity`     | `activity(id, query)`      | The person's audit trail, newest first                                          |
| GET    | `/members/:id/form-options` | `formOptions(id)`          | Edit Team Member's choices for that person                                      |
| POST   | `/members/:id/decision`     | `decideApproval(id, body)` | The department head approves or rejects a VP / Director hire (`.approved`, …)   |

12 routes: 7 reads, 5 writes. Audit actions are `platform_member.<kind>`
(`ADMIN_TEAM_ACTIVITY_ACTIONS`), entity `platform_member`, entity id and `subject_user_id` the
member's user id, `business_id` null (R0's change B: no audit table of our own).

**Registration order:** declare `POST /members/bulk` and `POST /members/invitations` before the
`/members/:id` routes. There is no `POST /members/:id`, so neither can be shadowed, and `:id` is a
UUID (a fixed word read as an id answers 400). `/meta`, `/summary` and `/form-options` sit outside
`/members`. Every path has at most one `:id`; a role, a department or a supervisor goes in the body.

**For the admin-scope sweep (the API PR):** the seed has one org-chart row (the CEO), so the
fixtures add the others. `createMember`: a new email and any role below CEO. `updateMember`: a
member below the caller (a new phone is enough). `bulkUpdate`: an ACTIVE member with `STATUS`
SUSPENDED. `resendInvitation`: a Pending Invitation member. `decideApproval`: a member written as
PENDING_DEPARTMENT_HEAD_APPROVAL with an intended VP / Director role. The CEO (a Super Admin) may do
all of them.

## Adding a member and the invitation (Cognito)

No admin invite path exists today: staff invites (`InvitesService`) need a firm
(`invites.business_id` is required), and only SUPER_ADMIN rows sign in to the admin site
(`session.service.ts`, `roles.guard.ts`). The contract reuses the staff flow's parts and the
existing IdentityProvider:

1. **Checks.** The hierarchy rules below, then the email: 409 EMAIL_TAKEN only when it belongs to
   someone on the team (an ADMIN-pool user with a `platform_admins` row). An ADMIN-pool login with
   no admin row (a create that failed half-way) is reused. Staff and client logins are other pools
   and are never looked at, so the answer says nothing about accounts elsewhere (AUTH-DESIGN).
2. **The login.** `identity.createUser('ADMIN', email, { phone })`: Cognito `AdminCreateUser` with
   the invitation message suppressed (or the local stand-in), no password, nothing sent. Like
   `staffUserFor`: when a parallel create wins the `users_pool_email_staff_admin_key` race, the
   extra login is disabled.
3. **The rows.** In platform scope (the identity layer, as staff invites): `users` (pool ADMIN, the
   email lower-case, `name` "First Last", phone) and `platform_admins` (TEAM_MEMBER). In admin
   scope: `platform_members` (department, role, reports-to, scope and `scope_ids`, status, invited
   by), the overrides (`granted_by_user_id`), and the audit entry. The trigger
   `platform_members_ceo_role_check` needs the admin row first.
4. **Status.** PENDING_INVITATION, or PENDING_DEPARTMENT_HEAD_APPROVAL with
   `intended_role_definition_id` when HR enters a VP / Director role (the CHECK ties the two).
   `role_definition_id` then holds the same role: the column is required, and a pending member has
   no access.
5. **The invitation.** A 7-day link `${ADMIN_BASE_URL}/activate#token=…` by email (and by SMS when
   asked and there is a phone) through NotifyService, and an audit entry `platform_member.invited`
   (channels and expiry, never the token). Proposed token, no table: a value sealed with the
   existing `Sealer` (ADMIN pool key, its own purpose label) holding the user id and the member
   row's `updated_at`. It opens while the member is Pending Invitation, the login has no password
   (`identity.hasPassword`) and `updated_at` still matches, so a resend (which touches the row) or
   any change voids older links. With `AUTH_MODE=local` the link is logged, as
   `LogActivationMailer` does for staff; elsewhere it goes out once R6's templates exist.
   `invitation` in the answer says which channels it was handed to and when it expires.
6. **Activation (R2, not this contract).** The admin site's activate screen posts the token and a
   password; the API opens the token, calls `identity.setPassword('ADMIN', sub, password)`, sets
   the member ACTIVE, writes `platform_member.activated`, and answers MFA_SETUP_REQUIRED (the
   admins pool requires TOTP). Department, role and permissions keep coming from the database.
7. **Signing in.** Until R2 lets an ACTIVE TEAM_MEMBER through the admin guards, only CEO-level
   members (SUPER_ADMIN) use the console, so every caller is unrestricted today; the rules below
   apply as soon as others can sign in.

## Rules the API enforces

The screens show only what `meta().can`, `formOptions()` and each member's `allowed` say; the API
checks every rule again (team docx §25, hierarchy doc §17).

- **Directory (who sees whom).** The CEO, the CHRO and the Authorized HR / People Administrator
  (role codes `HR_PEOPLE_CHRO`, `HR_PEOPLE_AUTHORIZED_HR_PEOPLE_ADMINISTRATOR`) see everyone.
  Others by their scope, with `team.view`: COMPANY everyone; DEPARTMENT and DIVISION their
  department plus the CEO and the Chief Officers; TEAM and DIRECT_REPORTS their reporting line
  (their supervisor and everyone below them; direct reports only for DIRECT_REPORTS); OWN_RECORDS
  their department; CUSTOM the departments and people listed. Someone outside it is 404.
- **Reach (who changes whom).** Never yourself (name and phone only, 403 SELF_CHANGE), never a
  peer or anyone above (403 PEER_PROTECTED), never a CEO-level member. The CEO reaches everyone
  else; HR reaches every level below Chief Officer in any department; others reach people below
  them in their own department and directory. Each change also needs its key: `team.edit`,
  `team.change_role`, `team.assign_department`, `team.deactivate`, `team.change_permissions`.
- **Roles (403 ROLE_CEILING).** No route gives the CEO role. The CEO gives any other role; a Chief
  Officer VP / Director and below in their department; HR any department, Manager and below
  directly and VP / Director as a hire that waits for that department's Chief Officer
  (`needsApproval`; the CHRO gives HR's own VP / Director directly); a VP / Director Manager and
  below in their department; a Manager Lead / Supervisor and Individual Contributor in their
  department; Leads and Individual Contributors none. Adding needs `team.create` (the HR
  administrator's template denies it, so the CEO grants it as an override). A role must be in the
  chosen department (422 ROLE_NOT_IN_DEPARTMENT); a department outside the caller's is 403
  DEPARTMENT_NOT_ALLOWED.
- **Scope (403 SCOPE_CEILING).** No scope broader than the caller's own (`adminTeamScopeRank`);
  HR gives DEPARTMENT and narrower; CUSTOM only the CEO, with departments and people the API finds
  (422 CUSTOM_SCOPE_INVALID).
- **Permissions (403 PERMISSION_CEILING).** Beyond the role's template, only keys the caller holds
  (`adminTeamGrantable`); the CEO any key in the catalog (422 UNKNOWN_PERMISSION otherwise).
  Customizing beyond the template needs `team.change_permissions`.
- **Reports To (422 SUPERVISOR_INVALID).** A higher level, in the role's department or Executive,
  or the CEO (`adminTeamSupervisorsFor`); active or invited; never the person or anyone below them.
- **Approval.** Only the CEO and the department's ACTIVE Chief Officer decide (403 FORBIDDEN); a
  person not waiting is 409 NOT_PENDING_APPROVAL; while waiting, role and status change only
  through the decision (409 PENDING_APPROVAL).
- **Status (409 STATUS_NOT_ALLOWED).** ACTIVE to SUSPENDED, INACTIVE or DEACTIVATED; back to ACTIVE
  only by someone who may give the person's role directly, and only when the login has a password
  (otherwise they go back to Pending Invitation and need a new link); Pending Invitation to
  INACTIVE or DEACTIVATED only (its links stop working). Suspending, deactivating or making
  inactive ends their sessions (`identity.signOutEverywhere('ADMIN', sub)`); the guards refuse them
  on the next request since roles come from the database. The Cognito login is not disabled: the
  IdentityProvider has no way to enable it again.
- **Invitations (429 RATE_LIMITED).** As `INVITE_LIMITS`: 50 links a day for the platform and 5 a
  day per person, counted from the `platform_member.invited` rows.

## Where the mock and the database differ

1. **Ids and the catalog.** The mock's slugs (`sales`, `sales-manager`) become UUIDs with stable
   `code`s (`REVENUE_SALES`, `REVENUE_SALES_SALES_MANAGER`). Names and titles are the database's:
   13 departments ("Executive", not "Executive Leadership"), 129 roles ("CEO", not "CEO — Chief
   Executive Officer"); the mock's Sales Team Lead does not exist. The title badge's colours key by
   department `code`.
2. **Levels** are `PlatformRoleLevel` (CEO … INDIVIDUAL_CONTRIBUTOR), not 1 to 6;
   `ADMIN_TEAM_LEVEL_NUMBERS` gives the number and `ADMIN_TEAM_LEVEL_LABELS` the text.
   `adminTeamAccessLevel` replaces `accessLevelOf`.
3. **Names.** `users` has one `name`: the request takes first and last name and stores "First
   Last"; answers split it back (first word / the rest, `adminTeamNameParts`), as the staff
   contract does. "Mary Ann Smith" reads back as Mary / Ann Smith.
4. **Job title** has no column: the role's title is the job title. The mock's own title (defaulted
   to the role title) is left out.
5. **Location** has no table: the Location / Office field, the filter, the column, the card line,
   the LOCATION scope and the location audience are left out.
6. **Team** (a unit inside a department) has no platform table: the Team field, filter and name are
   left out. The TEAM scope stays (a database value), with no ids.
7. **Availability** (Online, In a meeting, Away) has no column and is left out. `lastActiveAt`
   becomes `lastSignedInAt`, the newest `auth.signed_in` audit row of the person; the table's
   Availability column can show it.
8. **Statuses** are the database's seven. The mock's PENDING_APPROVAL (HR's VP / Director hire) is
   PENDING_DEPARTMENT_HEAD_APPROVAL, with the role in `intendedRole`. The database's own
   PENDING_APPROVAL (docx §17's approval of a change) has no record of the change it waits for, so
   no route sets it; a row in it is listed and counted as pending.
9. **Status on Add.** The mock offered Pending Invitation, Active and Inactive. A new login has no
   password, so a member starts as Pending Invitation (or waits for the department head) and
   becomes Active by activating. Add's Status select goes. To create without sending, both
   `invite.email` and `invite.sms` are false; Resend Invitation sends the first link later.
10. **Scopes** are the database's seven: OWN is OWN_RECORDS, LOCATION goes. CUSTOM carries its
    departments and people (`customScope`, stored in `scope_ids`, at most 200).
11. **Permissions** are a list of keys, not `{ module: actions[] }`. The catalog comes from
    `meta().modules` (the 12 sidebar modules, each with its keys, a grid column `action` or null,
    and the keys it `requires`). The Team row has R0's 17 keys (`ADMIN_TEAM_KEYS`: `team.view`,
    `team.create`, `team.change_role`, `org.view`, …), not view … manage; the API places
    `team.deactivate` in Delete, `team.change_role` in Assign and `team.change_permissions` in
    Manage, the rest under the grid. Support's row has Support's own `support.*` keys; the other
    modules `<module>.<action>` with the mock's actions until their modules define keys. The
    screens' `roleTemplate`, `grantable` and `samePermissions` become `role.template`,
    `adminTeamGrantable` and `adminTeamSamePermissions`.
12. **Templates** are the role's ALLOW rows in `platform_role_permissions`: today R0's `team.*` and
    whatever Support's settings wrote. The mock gave every role its department's modules at its
    level's actions (a Sales Manager got Sales, CRM, Pipeline, …); that is not stored, so a new
    member loads only the Team keys until module templates exist (Needs). What differs from the
    template is stored per member: ALLOW for an extra key, DENY for a template key taken away.
13. **Rights.** The mock's nine flags become seven, each from a key: add (`team.create`), edit,
    changeRole, changeDepartment (`team.assign_department`, new), changeStatus (`team.deactivate`;
    it covers Remove, so `remove` goes), customizePermissions, approve (CEO and Chief Officers).
    The mock's level shortcuts (level 2 may change status and permissions) follow R0's template
    instead: only the CEO has `team.deactivate`, `team.assign_department` and
    `team.change_permissions` by default. `manageGroups`, `messageCompany` and `announce` go with
    the messages (R56).
14. **`viewer()` and `filterOptions()`** are one `meta()`. The filters lose locations and teams;
    roles carry their department.
15. **Directory query.** `status` is `statuses` (a comma list), `descending` is `dir`, the sort keys
    are NAME, DEPARTMENT, ROLE (the job title column), ACCESS_LEVEL, STATUS, ADDED and
    LAST_SIGNED_IN (location and availability go). Page size 12 by default, at most 100. Search
    covers name, email, phone, department, role title and status.
16. **KPIs.** `addedLastMonth` is `addedLast30Days`; `pending` and `byStatus` are added.
17. **The member.** `department` and `role` are references (id, code, name or title, level);
    `intendedRole`, `customScope`, `invitation` (the newest link, from the audit rows) and
    `lastSignedInAt` are added; `jobTitle`, location, team and `availability` go. `allowed` gains
    `changeDepartment` and `customizePermissions` and loses `remove`.
18. **Form options.** Departments carry their code; roles their code, `defaultScope` (the database's
    `default_scope_type`, not the mock's level rule) and `template`; supervisors their level.
    `viewerPermissions` is `ceiling`; `executiveDepartmentId` is added for
    `adminTeamSupervisorsFor`; locations and teams go.
19. **Saving.** The mock's one `SaveTeamMember` ('' for none) is `CreateAdminTeamMemberRequest`
    (strict, with the email and the invitation) and `UpdateAdminTeamMemberRequest` (only the fields
    given; a value equal to the current one is no change, so the whole form can go back;
    `expectedUpdatedAt` gives 409 CONFLICT). The phone is E.164 (`Phone`; the mock took 10 to 15
    digits). Names stay at 50.
20. **A new role on edit** loads its template and its default scope unless `permissions` and
    `scope` come with it (the mock kept a scope that was not the old default), and drops a
    supervisor no longer valid (the mock did that in bulk only).
21. **Approval is for hires only.** The mock also sent an existing member to Pending Approval when
    HR gave them a VP / Director role. The database keeps an intended role only for that status,
    and the person would lose their access while waiting, so the contract refuses it (403
    ROLE_CEILING) and the edit form does not offer those roles.
22. **The decision.** `decideApproval(id, 'APPROVE' | 'REJECT')` takes APPROVE with an optional
    `roleId` and `invite` (the head may pick another VP / Director role in the department, hierarchy
    doc §18; 422 ROLE_NOT_ALLOWED otherwise) or REJECT with an optional `reason`. Approve leads to
    Pending Invitation and sends the link; reject to Inactive, as in the mock. Return for Changes
    (docx §17) is left out: no status or record holds it. Answers `{ member, invitation }`.
23. **Bulk.** `bulkUpdate(ids, change)` is `bulkUpdate({ ids, confirmedCount, action })` like Sales,
    with `type` DEPARTMENT, ROLE or STATUS, at most 100 people. Each person is changed on their own,
    as in the mock; skips come back as codes (`ADMIN_TEAM_SKIP_REASON_LABELS`) with `unchanged`
    counted apart. People the caller cannot see are skipped as NOT_FOUND without a name (the mock
    dropped them silently). A new role resets the scope to the role's default too. A role that
    would need approval is skipped (NEEDS_APPROVAL).
24. **Resend.** `resendInvitation(ids)` is `resendInvitation({ ids, sms })` and answers how many
    were `sent` and who was `skipped` (not waiting, no phone, out of reach, the daily limit).
25. **The CEO.** No route gives the CEO role or changes a CEO-level member (the mock let the CEO
    give any role and change anyone else). A CEO-level member is a SUPER_ADMIN with full
    admin-scope rights, which the database ties to the level both ways; that stays an operations
    step (seed, bootstrap).
26. **Errors.** `TEAM_ERROR_MESSAGES` is `ADMIN_TEAM_ERRORS`, with the API's codes. The field checks
    of `checkMember` run as the schemas' messages before sending; the database's own refusals come
    back as codes the form puts next to their field (EMAIL_TAKEN, ROLE_NOT_IN_DEPARTMENT,
    SUPERVISOR_INVALID).
27. **Activity.** The mock's prepared sentences become a kind with previous and new display values
    (and the keys granted and revoked); `adminTeamActivityText` builds the line. Read from the audit
    rows, at most 100 (`limit`). REPORTS_TO_CHANGED, ACTIVATED and MAPPED_TO_CEO (R0's bootstrap
    rows) are added. A profile change records which fields changed, not the phone itself.
28. **Card or List** (`viewPreference`, `setViewPreference`) has no table and is left out; the
    screen keeps the choice in the browser.
29. **Messages, groups and recipients** (`messageOptions`, `createGroup`, `sendMessage`) are left
    out: see R56 below. Each member's `allowed.message` stays as the button's hint.

## Needs from others

- **R2 (auth):**
  - The admin site's activation: `POST /api/v1/admin/auth/activation/check` and
    `POST /api/v1/admin/auth/activate` (the firm site's `ActivationCheckRequest` and
    `ActivateRequest` shapes, answering `SignInResult` with MFA_SETUP_REQUIRED), the `/activate`
    screen on the admin host, and the token (the sealed value above, or a stored one if preferred).
  - Letting an ACTIVE TEAM_MEMBER sign in and use `/api/v1/admin/*`: `session.service.ts` and
    `roles.guard.ts` accept only SUPER_ADMIN today (`sign-in.service.ts` already finds any
    `platform_admins` row), with the module's keys checked per route.
  - `IdentityProvider.enableUser`, if deactivating should also disable the Cognito login.
- **R0:**
  - Row-level security for an ACTIVE TEAM_MEMBER caller. `app_is_admin()` stays CEO-only, and a
    member reads only their own `platform_members` row and no overrides, so the Team API cannot
    serve a non-CEO caller under their own scope until the team gets read (and, through the API's
    checks, write) policies on the org-chart tables and the ADMIN-pool user rows.
  - Module templates: `<module>.*` rows in `platform_role_permissions` per role (the mock's rule:
    the department's modules at the level's actions), or a decision that the API supplies those
    defaults as Support does.
  - `platform_members.job_title` (the visible title apart from the role, docx §6), locations
    (`platform_locations`, `platform_members.location_id`), teams inside departments
    (`platform_teams`, `platform_members.team_id`, ids for the TEAM scope), custom groups and their
    members (the message dialog's Custom Group), and presence, if those fields must come back.
  - First and last name on `users`, if the split is not good enough.
  - A pending change record (who asked, what, the approver), if docx §17's approval of changes and
    Return for Changes are wanted.
  - A per-member Card / List preference, if it must follow the member across devices.
- **R6:** two platform templates: `platform.team-invite` (email: name, link, expiry; Firmivra
  branding) and `platform.team-invite-sms` (the link), in `TEMPLATE_CHANNEL` and `TEMPLATE_SENDER`.
- **R56 (Communications):** the message dialogs have no route here. Covered today: a message to one
  member (`api.adminCommunications.messages.create` with `contact: { type: 'TEAM', userId }`, on
  EMAIL or SMS; INTERNAL is a note in the thread, not delivered to them) and a broadcast to the
  whole team (`api.adminBroadcasts`, a segment with `contactTypes: ['TEAM']`, on EMAIL, SMS and
  IN_APP, with the file library's attachments). Not covered: several chosen members in one
  message, a department, a team, a location, a custom group, priority, Allow Replies, Save as
  Announcement, and the senders' audiences by key (`team.message_*`, `team.announce_*`). A
  segment's definition is JSON (`comm_segments.definition`), so `teamUserIds` and `departmentIds`
  in `AdminCommSegmentDefinition` need no schema change.
- **Support and the other modules (R60 Support, R55, R56):** read the member's overrides
  (`platform_member_permission_overrides`) with the role's keys, so what Team grants takes effect;
  Support reads only the role's rows today.
- **Screen owner (Tumit):** switch the three screens to `api.adminTeam`. Changes: `meta()` instead
  of `viewer()` and `filterOptions()`; ids and codes from the database; keys instead of the
  module map (the Team row's keys are R0's); no location, team, job title, availability or Status
  on Add; `lastSignedInAt`; approval as `decideApproval(id, { decision })`; bulk with
  `confirmedCount`; Card / List in the browser; the message dialogs on `api.adminCommunications`
  and `api.adminBroadcasts` for what they cover.

## Questions for Rasel

1. May the CEO appoint another CEO (a SUPER_ADMIN login) from the Team screen? The contract says
   no: no route gives the CEO role or changes a CEO-level member.
2. May HR propose a VP / Director role for an existing member (they would lose access while it
   waits)? The contract allows it for new hires only.
3. The admin invitation token: sealed, with no table (above), or a stored token like `invites`?
4. With no division or team tables, the directory reads DIVISION as the department and TEAM as the
   reporting line. Confirm, or wait for R0's teams.
5. The Team form's module rows: each module's own keys (Support's `support.*`), and
   `<module>.<action>` for modules without keys yet? Today only Support reads keys, and only on
   roles.
6. Should a new member ever start as Active (the mock allowed it)? The contract starts everyone at
   Pending Invitation until they activate.
7. Deactivation ends the sessions and the guards refuse the person. Should it also disable the
   Cognito login (R2 then needs `enableUser` for Reactivate)?
8. HR's cross-department rights go to the CHRO and the Authorized HR / People Administrator role
   (by role code), with `team.create` granted to the administrator as an override. Confirm.
