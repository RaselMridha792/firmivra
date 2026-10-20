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

## Team API

`apps/api/src/admin-team/` (`AdminTeamModule`, registered next to the other admin modules; 10 of
the 12 routes): `AdminTeamController`, `TeamReadService` (meta, the KPIs, the directory, one
member, the trail, the forms' choices), `TeamWriteService` (Edit Team Member, the bulk changes, the
decision), `team-context.ts` (errors, the org chart's rows, the signed-in member), `team-views.ts`
(the member, `allowed`, `can`, the filters) and the pure rules in `team-rules.ts` and
`team-plan.ts` (what a change does, checked before the database). Tests:
`test/unit/admin-team.test.ts` (39), `test/e2e/admin-team.e2e.test.ts` (23, every registered
route, the two left out answer 404), and 3 write cases in `test/isolation/admin-team-writes.ts`
for the admin-scope sweep. No contract change.

30. **Two routes left out.** `POST /members` (`createMember`) and `POST /members/invitations`
    (`resendInvitation`) are not registered, not even as a stub: they answer 404. Both create or
    need an ADMIN-pool login, and the database lets `users` and `platform_admins` rows be created
    only in platform scope (`users_insert` and `platform_admins_access`: WITH CHECK
    `app_scope() = 'platform'`; admin scope reads them but cannot insert). This API stays in admin
    scope, and staff invites already create logins inside the auth layer (`InvitesService`), so
    creating an admin login belongs to an R2 admin-invite service the Team API calls later (Needs,
    the alternative in Questions). Until then `meta().can.add` and every member's
    `allowed.resendInvitation` are false, so the screens hide Add Team Member and Resend.
31. **Admin scope only** (`AdminPrisma`). Every request reads the org chart in one admin
    transaction: departments, roles with their ALLOW keys (`platform_role_permissions`), members
    with their overrides, `platform_admins` and the ADMIN-pool logins of those admins. The signed-in
    member is their own org-chart row, which must be ACTIVE (403 FORBIDDEN otherwise), or a Super
    Admin with no row yet (the CEO). The CEO level is unrestricted. The rules run from that row,
    so they hold once R2 lets team members in; today every caller is a Super Admin.
32. **Reads.** `meta`: the viewer (no row: role and department null, scope COMPANY, every catalog
    key), `can` from the keys (approve: the CEO and Chief Officers), the catalog and the filters
    from the people the viewer sees (departments: theirs, or every active one for the CEO and HR).
    `summary`: the same people, `byStatus` always with all seven statuses (zod v4's
    `z.record(enum)` needs every key). `members`: filtered, sorted and paged in memory (the org
    chart is small): search on name, email, phone and its digits, department, role title (and the
    intended one), status label and code; ties sort by name then id; LAST_SIGNED_IN puts people
    who never signed in last; a page past the end answers the last page. `lastSignedInAt` is the
    newest `auth.signed_in` row of the person (entity `user`, platform rows). `invitation` is the
    newest `platform_member.invited` row while Pending Invitation (its `metadata.expiresAt`, else
    7 days after it). `activity`: the person's `platform_member.*` rows, newest first, display
    values from today's catalog (role titles, department names, people's names, status and scope
    labels), keys that are not keys dropped.
33. **Edit Team Member** checks, in order, before the database: 404 outside the directory, 409
    CONFLICT on `expectedUpdatedAt`, the name and phone (note 38), 422 ROLE_NOT_IN_DEPARTMENT (an
    unknown role, one outside the chosen department, or a closed department), 422
    CUSTOM_SCOPE_INVALID (unknown ids, or ids without a CUSTOM scope); then, if anything changes:
    403 SELF_CHANGE, PEER_PROTECTED or DEPARTMENT_NOT_ALLOWED (reach), 409 PENDING_APPROVAL (role,
    department or status of a hire waiting for the head), 403 FORBIDDEN for a missing key
    (department: `team.assign_department`; role: `team.change_role`; supervisor: `team.edit`;
    status: `team.deactivate`; scope or keys beyond what the role would give:
    `team.change_permissions`), 403 DEPARTMENT_NOT_ALLOWED and ROLE_CEILING (a role that would
    wait for the head is refused too: approval is for hires only), 403 SCOPE_CEILING, 422
    UNKNOWN_PERMISSION, 403 PERMISSION_CEILING (a key the person does not have, the role does not
    give and the caller does not hold), 422 SUPERVISOR_INVALID, 409 STATUS_NOT_ALLOWED and 403
    ROLE_CEILING (back to ACTIVE by someone who may not give the role directly). The same values
    are no change: nothing is written, `updatedAt` stays.
34. **What a change writes.** `platform_members` through `updateMany` where `updated_at` is the
    one read (409 CONFLICT when someone changed the row meanwhile), so a change never overwrites
    another; the overrides deleted and rewritten relative to the (new) role's template (ALLOW for an
    extra key, DENY for one taken away, `granted_by_user_id` the caller) when the keys or the role
    change; one audit row per kind of change, entity `platform_member`, entity id the member's user
    id, `business_id` null, ids and codes only: `.department_changed` and `.role_changed`
    `{ from, to }`, `.reports_to_changed` `{ from, to, cause? }` (cause ROLE_CHANGED when a new
    role dropped the supervisor), `.scope_changed` `{ from, to, scopeIds? }`,
    `.permissions_changed` `{ granted, revoked }`, `.status_changed` `{ from, to, requested? }`
    (requested ACTIVE when the person went back to Pending Invitation). Bulk rows add
    `bulk: true`.
35. **Bulk.** The request's own problems refuse it whole: 422 ROLE_NOT_IN_DEPARTMENT (an unknown
    role, a role outside the chosen department, a closed department), 403 FORBIDDEN (the key of the
    action), 403 DEPARTMENT_NOT_ALLOWED. Each person is then planned like an edit and skipped with a
    reason: NOT_FOUND (outside the directory, no name), SELF, OUT_OF_REACH, PENDING_APPROVAL,
    NOT_IN_DEPARTMENT (Change Role across departments), NEEDS_APPROVAL, ROLE_CEILING,
    STATUS_NOT_ALLOWED; people already as asked count as `unchanged`. People go highest level
    first and each one's checks see the changes before them (a supervisor moved down in the same
    request is no longer valid for the people below). One transaction for all.
36. **The decision** checks: 404 outside the directory, 409 NOT_PENDING_APPROVAL, 403 SELF_CHANGE,
    403 FORBIDDEN (not the CEO nor the ACTIVE Chief Officer of the intended role's department),
    422 ROLE_NOT_ALLOWED (APPROVE with a role that is not a VP / Director of that department),
    422 PHONE_REQUIRED (a text invitation without a phone). APPROVE writes the role (and its
    department), clears the intended role, sets Pending Invitation and `approved_by_user_id`; a
    different role than the intended one loads its template and default scope and drops a
    supervisor no longer valid. REJECT sets Inactive and clears the intended role. Audit:
    `.approved` `{ intendedRoleId, roleId, from, to, invite, invitationSent: false }` or
    `.rejected` `{ intendedRoleId, from, to, reasonGiven }`. No invitation is sent yet (R2's
    service, Needs): the answer's `invitation` is null.
37. **Status moves.** ACTIVE to Suspended, Inactive or Deactivated; from those back to ACTIVE or
    between them (Remove from Team a suspended person, beyond the list in the rules above);
    Pending Invitation and the database's own Pending Approval to Inactive or Deactivated only; a
    hire waiting for the head never (409 PENDING_APPROVAL). Back to ACTIVE asks the identity
    adapter (`hasPassword`, R2's SignInModule, before the transaction, 10 at a time) and becomes
    Pending Invitation when the login has no password; a lookup that fails counts as no password,
    which grants nothing.
38. **Name and phone are read-only for now.** They live on `users`, and admin scope cannot update
    `users` (`users_update`: platform scope or `app_current_user_id()`, which only user scope
    sets). An edit whose name or phone differs answers 400 VALIDATION_FAILED on that field
    (`firstName`, `lastName` or `phone`, as the staff module does for names); the same values
    pass, and "Mary Ann" / "Smith" for "Mary Ann Smith" is the same name. Your own row is the same
    (the contract lets everyone edit their own name and phone), so `allowed.edit` is false for
    yourself. Needs R0.
39. **Sessions are not ended** when someone is suspended, made inactive or deactivated.
    `IdentityProvider.signOutEverywhere(pool, username)` takes the Cognito username, which is not
    stored (logins are created with a random username; `users` keeps the `sub`), and the methods
    that resolve a `sub` (`disableUser`, `resetMfa`) disable the login or reset its MFA. Nobody
    these routes change can be signed in today (only SUPER_ADMIN rows pass the guards, and
    CEO-level members are never changed here), so nothing is left open now. Needs R2.
40. **The catalog** (`meta().modules`, `teamCatalog`): the Team row's 17 keys with `team.view`,
    `team.create` and `team.edit` in View, Create and Edit, `team.deactivate` in Delete,
    `team.change_role` in Assign, `team.change_permissions` in Manage and the rest under the grid;
    `team.deactivate` and `team.change_permissions` require `team.edit`, the others `team.view`
    (`team.view` and `org.view` nothing). Support's row has `SUPPORT_KEYS` with
    `SUPPORT_PERMISSION_LABELS` (view_all, assign, delete and edit_settings in a column). The other
    modules `<module>.<action>` with the mock's actions; create, edit, assign, approve and export
    require view, delete and manage require edit (or view when the module has no edit). A key
    outside the catalog that the role's template or the person already holds is accepted back
    unchanged; any other is 422 UNKNOWN_PERMISSION.
41. **Form options.** Add (and the bulk dialogs): the roles the caller gives directly and, for HR,
    the hires that wait (`needsApproval`); the departments that have one of those roles (an
    Executive holding only the CEO role is not offered); no key filter, since Add is off. Edit:
    the person's current role and department always, other roles of their department with
    `team.change_role`, of other departments with `team.assign_department`, never a role that
    would wait. Supervisors: the people the caller sees who are Active or Pending Invitation,
    highest level first; on edit never the person or anyone below them. `statuses` on edit: the
    current one and the moves the caller may make now (none without reach or `team.deactivate`).
42. **Traps found.**
    - Admin scope cannot insert `users` or `platform_admins` (note 30) nor update `users`
      (note 38); `forAdmin`'s own comment says it "never updates users".
    - `AuditService.logIn` has no subject: the rows carry the member in `entity_id`, and
      `subject_user_id` (R0's B4 field the notes above named) stays null (Needs).
    - The trigger `platform_members_ceo_role_check` reads `platform_admins` in the caller's scope;
      admin scope's `platform_admins_admin_read` lets it. Its two messages map to ROLE_CEILING and
      PEER_PROTECTED as a backstop; other CHECKs answer 400, foreign keys and unique indexes 409
      CONFLICT, a row-level refusal 403, so none surfaces as a 500.
    - A role change re-checks only the changed person's own supervisor: people who report to
      someone moved to their level or below keep that line until they are edited (the bulk change
      re-checks the people in the same request).
    - The test database's owner role is a superuser, so the fixtures' rows bypass row-level
      security: the e2e test proves the API's own writes in admin scope, the fixtures do not.

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
  - **The admin-invite service** the Team API calls for Add Team Member, Resend Invitation and
    the decision's link (notes 30 and 36), in `apps/api/src/auth/`, exported by `SignInModule`:
    - `createTeamMember(input)` takes `{ email, name, phone, member, invitedByUserId, invite }`:
      the email (lower case), the name ("First Last"), the phone (E.164 or null), the member row's
      fields as the Team API checked them (`roleDefinitionId`, `departmentId`,
      `reportsToUserId`, `scopeType`, `scopeIds`, `status` PENDING_INVITATION or
      PENDING_DEPARTMENT_HEAD_APPROVAL, `intendedRoleDefinitionId`, and the overrides
      `{ permissionKey, state }[]`), the signed-in admin, and the channels (`{ email, sms }`, or
      null to send nothing: a hire waiting for the head, or both false).
    - It does: 409 EMAIL_TAKEN when the email belongs to an ADMIN-pool user who is a SUPER_ADMIN
      or has a `platform_members` row; otherwise the ADMIN-pool login through the identity adapter
      (`identity.createUser('ADMIN', email, { phone })`, nothing sent by Cognito; a login left
      half-made, with no admin row or only a TEAM_MEMBER row without a member row, is reused; a
      parallel create that loses the `users_pool_email_staff_admin_key` race disables its extra
      login), in platform scope the `users` row (pool ADMIN) and the `platform_admins` TEAM_MEMBER
      row, then the `platform_members` row and its overrides (in admin scope as
      `invitedByUserId`, which `platform_members_admin_all` allows, after the admin row has
      committed: the trigger needs it) with the audit rows `platform_member.created`
      `{ roleId, departmentId, status }` and, when sent, `platform_member.invited`
      `{ channels, expiresAt }`; then the sealed invitation (the `Sealer` with the ADMIN pool key
      and its own purpose label, holding the user id and the member row's `updated_at`, 7 days),
      sent through NotifyService (`platform.team-invite`, `platform.team-invite-sms`; logged with
      `AUTH_MODE=local`), within INVITE_LIMITS (429 RATE_LIMITED).
    - It returns `{ userId, invitation: { email, sms, expiresAt } | null }`; the Team API answers
      `{ member, invitation }` from it.
    - `sendInvitation({ userId, channels, sentByUserId })`, for Resend and the decision's APPROVE:
      a new link for a member still Pending Invitation (touching the row, so older links stop
      working) and its `platform_member.invited` row, the same limits. Returns
      `{ email, sms, expiresAt }`, or a refusal the contract's skip reasons name
      (NOT_PENDING_INVITATION, NO_PHONE, RATE_LIMITED).
    - Then this API registers `POST /members` and `POST /members/invitations`, turns `can.add`
      and `allowed.resendInvitation` on, and the decision sends its link.
  - **Ending a team member's sessions** (note 39): `signOutEverywhere` by `sub` (or a
    `SessionService` method by user id) the Team API can call when it suspends, deactivates or
    makes someone inactive; and, once ACTIVE team members are let in, the guards refusing a
    TEAM_MEMBER whose `platform_members.status` is not ACTIVE on every request.
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
  - **Name and phone of team members** (note 38): an admin-scope UPDATE policy on `users` for
    ADMIN-pool rows of `platform_admins` (TEAM_MEMBER rows, and the caller's own row), limited to
    `name` and `phone` (`users_identity_columns` already keeps id, sub, pool and email to platform
    scope). Edit Team Member then saves them with a `platform_member.profile_updated` row
    `{ fields }`.
- **The AuditService owner (`apps/api/src/audit/`):** `AuditAt.subjectUserId` (and the other B4
  fields), so the Team rows set `subject_user_id` to the member (note 42).
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
  and `api.adminBroadcasts` for what they cover. With the Team API: Add Team Member and Resend
  Invitation stay hidden (`can.add` and `allowed.resendInvitation` are false) until R2's service;
  name and phone are read-only on Edit (a change answers 400 on its field); the decision answers
  `invitation: null` for now; the trail's REJECTED has no reason.

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
9. Creating admin logins: R2's admin-invite service (Needs, the plan), or R0 adds admin-scope
   INSERT policies on `users` limited to ADMIN-pool rows and on `platform_admins` limited to
   TEAM_MEMBER rows (with the UPDATE policy for name and phone), so the Team API writes them
   itself, the Cognito login still through the identity adapter?
10. The rejection reason is free text: store it in the `.rejected` row's metadata (R0's change B
    allows a reason there, an exception to "ids and codes only"), or keep REJECTED's `reason`
    empty, as now?
11. Status moves between Suspended, Inactive and Deactivated (Remove from Team a suspended person)
    are allowed; the rules above list only ACTIVE to them. Confirm.
