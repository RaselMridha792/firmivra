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
    **Superseded (Oct 20):** both routes are built in this module (notes 69 to 78).
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
    service, Needs): the answer's `invitation` is null. **Superseded (Oct 20):** APPROVE sends
    the invitation (note 69).
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
    yourself. Needs R0. **Superseded (Oct 20):** R0's #954 landed; name and phone are saved
    (note 79).
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

- **R2 (auth):** the admin-invite service is built in the Team module (notes 69 to 78). R2 still
  owns:
  - **Activation** of a team member's invitation: `POST /api/v1/admin/auth/activation/check` and
    `POST /api/v1/admin/auth/activate` (the firm site's `ActivationCheckRequest` and
    `ActivateRequest` shapes, answering `SignInResult` with MFA_SETUP_REQUIRED), and the
    `/activate` screen on the admin host, reading `#token=`. The token is
    `TeamInvitationTokens` (`apps/api/src/admin-team/team-invitation.ts`, or `fromEnv`), with the
    checks of note 74: the seal opens for ADMIN, `memberUpdatedAt` equals the member's
    `updated_at`, the status is PENDING_INVITATION, and the login has no password. Then ACTIVE,
    `platform_member.activated`, and MFA setup. A signed-out request has no scope that reads or
    updates `platform_members` today: a definer function, or R0's policy (below).
  - **Team-member sign-in past the admin guards:** letting an ACTIVE TEAM_MEMBER sign in and use
    `/api/v1/admin/*`. `session.service.ts` and `roles.guard.ts` accept only SUPER_ADMIN today
    (`sign-in.service.ts` already finds any `platform_admins` row). The module's keys are checked
    per route, and a TEAM_MEMBER whose `platform_members.status` is not ACTIVE is refused on
    every request.
  - **Session sign-out by sub** (note 39): `signOutEverywhere` by `sub` (or a `SessionService`
    method by user id), for the Team API to call when it suspends, deactivates or makes someone
    inactive.
  - `IdentityProvider.enableUser`, if deactivating should also disable the Cognito login.
- **R0:**
  - **INSERT on `platform_admins` for TEAM_MEMBER rows** (blocks Add Team Member for a new email,
    note 80): `GRANT INSERT ON platform_admins TO firmivra_app`, with the policy narrowed so the
    app can add only TEAM_MEMBER rows in platform scope (for example `WITH CHECK (app_scope() =
    'platform' AND role = 'TEAM_MEMBER')`), so Super Admins are still added only by ops or the
    seed. No UPDATE or DELETE is needed.
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
  - **Activation's scope** (note 74): a way for R2's signed-out activation to read a
    `platform_members` row and set it ACTIVE (a definer function, as `app_enter_support_scope`
    is), unless R2 builds it another way.
- **The AuditService owner (`apps/api/src/audit/`):** `AuditAt.subjectUserId` (and the other B4
  fields), so the Team rows set `subject_user_id` to the member (note 42).
- **R6:** two platform templates: `platform.team-invite` (email: name, link as a button
  checked against `linkOrigins`, expiry; Firmivra branding) and `platform.team-invite-sms` (the
  link), in `TEMPLATE_CHANNEL`, `TEMPLATE_SENDER` and `ALWAYS_SENT`. Until then the invitation
  goes out on `platform.message-email` and `platform.message-sms` (note 75); switching is a
  change to `TeamInviteService.deliver` only.
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
  and `api.adminBroadcasts` for what they cover. With the Team API: the trail's REJECTED has no
  reason. **Since Oct 20** (notes 69 to 79) the adapter (`team-api.ts`) should call
  `createMember` and `resendInvitation` instead of its "not available yet" answers (notes 54,
  55), turn `ADD_MEMBER_AVAILABLE` on, read the decision's `invitation` (no longer null when a
  channel is chosen), and drop the 400 for name and phone (note 50): they are saved, your own
  included.

## Questions for Rasel

1. May the CEO appoint another CEO (a SUPER_ADMIN login) from the Team screen? The contract says
   no: no route gives the CEO role or changes a CEO-level member.
2. May HR propose a VP / Director role for an existing member (they would lose access while it
   waits)? The contract allows it for new hires only.
3. The admin invitation token: sealed, with no table (above), or a stored token like `invites`?
   **Answered (Oct 20):** sealed, no table (note 73).
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
   itself, the Cognito login still through the identity adapter? **Answered (Oct 20):** R60
   builds it in the Team module, with platform scope for the `users` and `platform_admins`
   inserts only (note 71); the UPDATE policy for name and phone is R0's #954 (note 79).
10. The rejection reason is free text: store it in the `.rejected` row's metadata (R0's change B
    allows a reason there, an exception to "ids and codes only"), or keep REJECTED's `reason`
    empty, as now?
11. Status moves between Suspended, Inactive and Deactivated (Remove from Team a suspended person)
    are allowed; the rules above list only ACTIVE to them. Confirm.

## Team screens

`apps/web/src/app/admin/(console)/team/_components/team-api.ts`: the three screens (`/team`,
`/team/new`, `/team/[memberId]/edit`) call `api.adminTeam` through this adapter, which exports the
mock's names, methods and shapes. With `NEXT_PUBLIC_API_MOCK=adminTeam` (or `all`) it hands back
`mocks/admin-team.ts` unchanged, so mock mode and `e2e/mock/tumit-admin-team.spec.ts` keep working.
Every screen imports from it, including its `errorMessage` (lib/errors' one, with the adapter's own
messages shown as written); no screen imports the mocks. No contract change.

### Mapping

43. **Levels, ids and titles.** Levels are numbers again (`ADMIN_TEAM_LEVEL_NUMBERS`), so the level
    labels, sorts and the supervisor rule stay; ids are the database's. `jobTitle` and `roleTitle`
    are the role's title (note 4). The title badge's colour keys by the department's `code`
    (`departmentCode`, set on the API only).
44. **Permissions.** The grid keeps the mock's `{ module: actions }` value; the adapter reads keys
    into it and back by `meta().modules` (each key's column), so the Team row has six columns and
    Support's four. `teamModules()` gives the rows: the catalog once loaded, the mock's before it
    (the form's frame when the API is unreachable). Keys with no column (`team.view_profile`,
    `org.view`, `team.assign_department`, the message and announce keys, Support's others) are not
    shown and are kept: an edit sends the person's off-grid keys back with the grid's (the new
    role's when the grid was changed after Load Role Defaults). A new role whose grid is its
    template leaves `permissions` out, so the API loads the whole template. `roleTemplate`,
    `grantable` and the module counts read the API's templates and catalog; the profile lists the
    grid's keys only.
45. **Statuses.** The hire waiting for the department head reads as the mock's Pending Approval, and
    so does the database's own PENDING_APPROVAL (no route sets it); the Status filter's Pending
    Approval asks for both. Add's Status select offers Pending Invitation only (note 9).
46. **Scopes.** On the API the scope select and labels are `ADMIN_TEAM_SCOPES` (OWN_RECORDS, no
    LOCATION), and a new role loads its own `defaultScope` (`roleDefaultScope`), not the mock's level
    rule.
47. **The directory query.** `status` is `statuses`, `descending` is `dir`. Sorts: Job Title is
    ROLE, Availability LAST_SIGNED_IN, Location NAME (no one has a location, so it sorts as the
    mock's ties did). A Location or Team filter (none can be chosen) answers an empty page.
48. **Rights.** `can` maps one to one (`editMembers` is `edit`, `changeRoles` `changeRole`, `remove`
    `changeStatus`), plus `changeDepartment`; `manageGroups`, `messageCompany` and `announce` come
    from the viewer's keys (`team.create_group`, `team.message_company`, `team.announce_*`). A
    member's `remove` is `changeStatus` unless they are Deactivated; `resendInvite` is
    `resendInvitation` (false).
49. **Edit Team Member** sends only what differs from the member as last read, with
    `expectedUpdatedAt` from that read (409 CONFLICT when someone changed them meanwhile); a new
    role always sends the scope and supervisor the form shows. Nothing changed: no request, and the
    member as read. A refusal of a field (a 400's `details`, EMAIL_TAKEN, ROLE_NOT_IN_DEPARTMENT,
    SUPERVISOR_INVALID, SCOPE_CEILING, CUSTOM_SCOPE_INVALID, STATUS_NOT_ALLOWED, PHONE_REQUIRED)
    shows by that field.
50. **Name and phone** (note 38): the form sends a changed name or phone and shows the API's 400 by
    its field ("Names and phone numbers of team members cannot be changed here yet …"); the same
    values pass (a phone typed with spaces, the name split another way). Chosen over leaving them
    out: one line in the form, no rule of its own, and the fields work once R0's policy lands.
51. **The form's checks** on the API are the contract's for names, email and phone (E.164; a US
    number may come without +1), a role of the chosen department, and no job title of the person's
    own: Job Title takes the role's title or nothing ("The role's title is the job title for now").
52. **Bulk.** `confirmedCount` is the number selected; skips read as
    `ADMIN_TEAM_SKIP_REASON_LABELS`, someone outside the directory as "one person"; `unchanged` is
    counted apart in the summary.
53. **Activity.** Each line is `adminTeamActivityText`; ACTIVATED, REPORTS_TO_CHANGED and
    MAPPED_TO_CEO have icons; an entry with no actor (R0's bootstrap) shows "System".

### Not available yet (422) or empty

54. **Add Team Member** (note 30): `can.add` is false, so the directory hides the button. `/team/new`
    keeps its form, filled from `formOptions()`, and its submit answers 422 "Adding team members is
    not available yet." `ADD_MEMBER_AVAILABLE` (true in mock mode) turns the no-permission line
    back on with the route.
55. **Resend Invitation** is hidden in the member menus (`allowed.resendInvitation`); the
    selection's More Actions keeps it and answers 422 "Invitations cannot be resent yet."
56. **Approval** answers `invitation: null`: the toast says "… role is approved. No invitation was
    sent yet." instead of "the invitation is on its way".
57. **Messages.** A message to one member (Message on a card, a row or the profile, or one person in
    Specific Team Members) goes out through `api.adminCommunications.messages.create` with
    `contact: { type: 'TEAM', userId }`: by email (the subject and the editor's HTML), then by text
    (its plain text, at most 1,600 characters) in the same thread. In-App Chat has no route and
    counts as unavailable in the result ("In-App Chat unavailable for 1"), as do a missing phone and
    NO_DESTINATION. Refused with 422 rather than dropped: several people, a department, a location,
    a custom group or the whole company ("Team messages are not available yet. Send to one team
    member at a time, by email or text message."), in-app only, attachments (the dialog's files are
    not Communications' file library), a priority other than Normal, replies turned off, and Save
    as Announcement. `api.adminBroadcasts` was not used for the whole team: each send would need a
    saved audience and a named broadcast, records the dialog would create in Communications' lists.
58. **Recipients**: the directory's people whose `allowed.message` is true; departments from
    `meta().filters` with their counts; Entire Company and Department by `team.message_company` and
    `team.message_department`. No locations, teams or groups are stored, so those lists stay empty
    ("Nothing matches your search."). Create Custom Group shows by `team.create_group` and answers
    422 "Custom groups are not available yet."; Save as Announcement is enabled by `team.announce_*`
    and refused on send.
59. **Location, team, presence and job title**: the card's "No location", the table's "—", the
    profile's "No team" and the empty Location and Team filters are the existing empty states.
    Presence reads "Presence unknown" on cards and the profile; the table's Availability column
    shows the last sign-in ("Signed in Oct 3, 2026", "Never signed in"), which it sorts by.
60. **Card / List** (note 28) is kept in memory while the page is open.

### Screen edits beyond the imports

61. `team-parts.tsx`: `Presence` takes null (and `signedInAt`); `TitleBadge` takes `department` (a
    code, or the mock's id) with the 13 codes' colours.
62. `member-card.tsx`: the badge by `departmentCode`. `member-table.tsx`: Availability passes
    `signedInAt`.
63. `team-toolbar.tsx`: Change Department by `can.changeDepartment` (the mock's `changeRoles` when
    absent).
64. `team-screen.tsx`: the approval toast (note 56).
65. `bulk-dialog.tsx`: `bulkSummary` adds "N team members were already up to date."
66. `access-permissions.tsx`, `member-form.tsx`, `member-profile.tsx`: `teamModules()` instead of
    `TEAM_MODULES` (the grid's lookup is built per render). `member-form.tsx` loads a new role's
    scope with `roleDefaultScope` and puts a refusal's messages by their fields (`fieldErrorsOf`).
    `member-profile.tsx`: icons for the three new kinds, "System" for no actor.
67. `new-member-screen.tsx`: the no-permission line only with `ADD_MEMBER_AVAILABLE`.
68. **Checked on the local API** (Oct 20, at 1440 px with data, empty and the API unreachable,
    and at 375 px with data; sheets in `apps/web/e2e/screenshots/r60-team-screens/`): no API
    response of 400 or more from the Team routes and no console error. The data is six synthetic
    members made in the local database the way the Team e2e test makes its people (Add Team Member
    waits on R2), on the shipped catalog. Edit Team Member saved twice from the page (a module
    granted, then taken back: PATCH 200 each). One change after the check: **Add Team Member stays
    in the page header on the API** (the design's), leading to the form whose submit answers
    "Adding team members is not available yet.", instead of being hidden by `can.add` (false for
    everyone until the route exists); mock mode still follows `can.add`. The mock spec
    (`e2e/mock/tumit-admin-team.spec.ts`) passes, 8 of 8.
69. **Messages to several people, a department or the whole company** (after #952): the adapter
    turns the audience into people, and sends each one the same message through Communications
    (`messages.create`, contact TEAM, one conversation each), by email and by text as chosen.
    The people are the chosen members, everyone in the chosen departments (`members({
    departmentId })`, every page), or everyone (`members()`). Those without `allowed.message`
    count as unavailable, as do channels a person has no address for. At most 100 people a
    send (`MESSAGE_RECIPIENT_LIMIT`; the answer says to choose fewer). Location and custom-group
    audiences still answer 422 (no table). In-app, attachments, priority, turning replies off and
    announcements still answer 422 (no field in Communications). Checked on the local API: a
    department of three, by email, made one department read and three sends (200 each), and
    Mailpit received the three emails.

## Team invitations

This section's notes run from 69 on; the earlier list's own note 69 (messages, above) came
from #976 on `main`.

Rasel's decisions (Oct 20): R60 builds the admin invite in the Team module, the login goes in the
ADMIN pool, and platform scope is used for the `users` and `platform_admins` inserts only.
`TeamInviteService` (`team-invite.service.ts`: Add Team Member, Resend Invitation, the decision's
link), `team-invitation.ts` (the token, the caps, the messages), and `planCreate`, `planResend`,
`planProfile` and `withProfile` in `team-plan.ts`. All 12 routes are registered. Tests:
`test/unit/admin-team.test.ts` (53), `test/e2e/admin-team.e2e.test.ts` (34), and 5 write cases in
`test/isolation/admin-team-writes.ts`. No contract change.

**Blocked on R0 for a brand-new login (note 80, first trap; Needs).** The app's role has no
INSERT on `platform_admins`: R0's `r0_platform_tightening` (Oct 7) revoked it ("Super Admins are
added by ops or the seed"), whatever `platform_admins_access` allows. Until R0 grants it for
TEAM_MEMBER rows in platform scope, Add Team Member for an email with no ADMIN-pool login answers
500. Nothing is left in the database (the `users` insert rolls back with it), and the Cognito login
made for the request is disabled. Everything else works today: a login left half-made (with an
admin row) is reused, and Resend, APPROVE's link and the edits are unaffected. Locally, 4 of the 34 e2e tests need the grant and fail until then, each
with the message "R0: firmivra_app needs INSERT on platform_admins". The other 30 pass, and so do
the 53 unit tests.

69. **The routes.**
    - `POST /members` answers 201 `{ member, invitation }`.
    - `POST /members/invitations` answers 200 `{ sent, skipped }`.
    - `POST /members/:id/decision` APPROVE now makes the link and sends it to the channels chosen
      (`invite`, email by default). `.approved` has `invitationSent: true` when a link was made.
      A 429 refuses the decision too: approve with neither channel and resend later.
    - Both fixed paths come before `/members/:id`.
    - `meta().can.add` is `team.create`. A member's `allowed.resendInvitation` is: Pending
      Invitation, within reach, and the caller holds `team.create`.
70. **Add Team Member, step by step.**
    1. Admin scope, reading only: `planCreate`, and when a link will go out, the daily caps. All of
       this runs before any Cognito login exists.
    2. `adminUserFor` in platform scope (note 71).
    3. One admin transaction:
       - `planCreate` again, on the rows as they are now;
       - the `platform_members` row (a unique violation is 409 EMAIL_TAKEN: a parallel create got
         there first) and its overrides;
       - a reused login's name and phone, saved again (`users_admin_team_update`, now that the
         member row exists);
       - `.created` with the role, department, supervisor, scope (and custom ids), status and the
         keys granted or revoked against the template;
       - the link (note 73).
    4. After the commit: seal the token and send it (note 75).
    5. Read the member back.

    `planCreate`'s order:
    - 403 FORBIDDEN without `team.create`;
    - 422 ROLE_NOT_IN_DEPARTMENT;
    - 422 CUSTOM_SCOPE_INVALID;
    - 403 FORBIDDEN for a scope or keys beyond the role's without `team.change_permissions`;
    - 403 DEPARTMENT_NOT_ALLOWED, ROLE_CEILING, SCOPE_CEILING;
    - 422 UNKNOWN_PERMISSION;
    - 403 PERMISSION_CEILING;
    - 422 SUPERVISOR_INVALID (the supervisor must be someone the caller sees);
    - last, 409 EMAIL_TAKEN.

    HR's VP / Director hire is PENDING_DEPARTMENT_HEAD_APPROVAL, with the intended role equal to
    the role, and its `invite` is ignored. Everyone else is PENDING_INVITATION. If step 3 fails,
    the login and its admin row stay (half-made), and the next try reuses them.
71. **The platform-scope method.** `TeamInviteService.adminUserFor(email, name, phone)` uses
    `DATABASE.forPlatform()` / `withScope({ kind: 'platform' })`, as `staffUserFor` does. Its
    comment cites Rasel's decision. The reason: `users_insert` and `platform_admins_access` allow
    these inserts in platform scope only. The method does only these three things:
    - looks up the ADMIN-pool login with this email, with its admin row;
    - for a new login, inserts `users` (pool ADMIN, lower-case email, "First Last", phone) and
      `platform_admins` (TEAM_MEMBER) in one platform transaction;
    - for a reused login without an admin row, adds that row.

    A unique violation (`users_pool_email_staff_admin_key`) reads the other request's row and
    calls `identity.disableUser('ADMIN', sub)` on the orphan login. Any other failure of the
    transaction disables that login too, then rethrows. A SUPER_ADMIN row found there is 409
    EMAIL_TAKEN. Everything else stays in admin scope (`AdminPrisma`): the member row, the
    overrides, the users name and phone, and the audit rows. The login comes from
    `identity.createUser('ADMIN', email)`: no password, nothing sent by Cognito, and the phone is
    not passed to Cognito.
72. **No account-existence leak.**
    - EMAIL_TAKEN is decided in admin scope from the org chart's own rows (admin scope reads only
      ADMIN-pool logins that have an admin row). It means a Super Admin, or someone with a
      `platform_members` row.
    - A TEAM_MEMBER login with no member row is reused, and so is an ADMIN-pool login with no
      admin row.
    - STAFF and CLIENT logins are never queried. A staff login's email gets a new ADMIN login and
      the same answer as a new email.
    - The email check runs after every authority check.
    - Errors and log lines hold member ids and error names only.
73. **The token** (question 3: sealed, no table).
    - The `Sealer` with label `fv-admin-team-invite-v1` and the ADMIN pool's key
      (`COGNITO_ADMINS_CLIENT_SECRET`, or `LOCAL_AUTH_SECRET` locally).
    - The value is `{ pool: 'ADMIN', userId, memberUpdatedAt }`. It expires 7 days later in whole
      seconds, the same time as the `.invited` row's `expiresAt`.
    - Each link touches `platform_members.updated_at`, strictly later than before, under the
      invitations lock. The token holds the new value, so every older link stops matching. Any
      other change to the row also voids the link: an edit, a status change, a name fix.
    - The link is `${ADMIN_BASE_URL}/activate#token=…`, in the fragment as staff links are.
      `ADMIN_BASE_URL` comes from config.
    - The token is never stored, logged or audited.
    - AdminTeamModule exports `TeamInvitationTokens`. R2 can also build its own with
      `TeamInvitationTokens.fromEnv(env)`, so SignInModule never imports the Team module.
74. **What R2's activation must check.** Nothing in `apps/api/src/auth/` was changed.
    1. `tokens.open(token)` is defined: it opens only for the ADMIN pool with this label, when not
       expired and not tampered with.
    2. `TeamInvitationTokens.stillValid(opened, row)` for the `platform_members` row of
       `opened.userId`: the same person, status PENDING_INVITATION, and `updated_at` equal to
       `memberUpdatedAt` to the millisecond.
    3. The login is ADMIN pool and `identity.hasPassword('ADMIN', sub)` is false. A reused login
       may already have a password: refuse, as staff's ACCOUNT_EXISTS does, and never reset it.
    4. Set the password, then make the member ACTIVE with an `updatedAt` condition (a resend or a
       change made meanwhile wins), write `platform_member.activated`, and answer
       MFA_SETUP_REQUIRED.

    Every failure answers the same way: 404 INVITE_INVALID or 410 INVITE_EXPIRED, as staff. The
    request is signed out, and no scope today may read or update `platform_members` for it:
    admin scope is the CEO's, and platform scope has no policy on it (Needs, R2 and R0).
75. **Email and text.**
    - There is no team-invite template, so R6's generic Firmivra ones are used.
      `platform.message-email` takes `{ name, subject, body }` and renders "Hi {name}," with
      Firmivra's branding and From. `platform.message-sms` renders "Firmivra: {body}". The wording
      fits: subject "You're invited to join the Firmivra team"; the body says they were added to
      the Firmivra team, gives the link to set a password and sign in to the admin site, and says
      when it expires and to ignore an unexpected email.
    - The link is plain text in the body. The generic template has no button, and does not check
      the link against `linkOrigins`.
    - The text message is sent because the contract asks for it (`invite.sms`, resend's `sms`) and
      the notifier supports it. A JWE in a text is long: about 300 characters, several segments.
    - Locally, email goes to Mailpit (`EMAIL_MODE=smtp`) and texts to the API log without their
      text (`SMS_MODE=log`). The link is logged nowhere, not even with `AUTH_MODE=local`: note 5's
      "logged, as LogActivationMailer" no longer holds.
    - `invitation` in the answer lists the channels that accepted the message. A failed send is
      logged with the member id and the error's name. The link stands, since the `.invited` row
      was written before sending, and Resend makes a new one.
76. **The caps.** `TEAM_INVITE_LIMITS` allows 50 links a day for the platform and 5 a day per
    person. It counts `.invited` rows (entity `platform_member`, `business_id` null, last 24 hours)
    under a transaction advisory lock (`hashtextextended('admin-team-invite', 0)`), so two requests
    never pass on the same count.
    - Add Team Member: 429 RATE_LIMITED before the login is made (only when sending), and again in
      the write transaction.
    - APPROVE: a 429 refuses the decision.
    - Resend: the person is skipped as RATE_LIMITED.
    - Adding without an invitation is not capped.
77. **Audit**, with ids and codes only, never email, name, phone, link or token:
    - `.created`, as in note 70;
    - `.invited` with `{ channels, expiresAt, via }`: channels `EMAIL` and `SMS`, via `CREATE`,
      `RESEND` or `APPROVAL` (a resend is its own `.invited`);
    - `.approved` with `invitationSent`;
    - `.profile_updated` with `{ fields }` (note 79).
78. **Resend.**
    - The request needs `team.create` (403 for the whole request).
    - Each person may be skipped: NOT_FOUND (no name), SELF, OUT_OF_REACH,
      NOT_PENDING_INVITATION or RATE_LIMITED, in the order sent.
    - The email always goes. The text goes when `sms` is set and the person has a phone. People
      without a phone still get the email, so NO_PHONE is never used.
    - All links are made in one transaction and sent one by one after it commits.
    - `sent` counts the people whom at least one channel reached. A person whose every send failed
      is in neither list; the log has their id.
79. **Name and phone (R0's #954, `users_admin_team_update`).**
    - Edit Team Member saves a changed name ("First Last" from the two fields, as it reads back)
      and phone (E.164 or null) on the person's `users` row, in admin scope, in the same
      transaction as the member update. The audit row is `platform_member.profile_updated` with
      `{ fields: ['name', 'phone'] }`, never the values.
    - It also moves `platform_members.updated_at`, so `expectedUpdatedAt` covers it. A Pending
      Invitation link made earlier is then void: resend it.
    - Yourself: your name and phone, with no key needed. Anything else on your own row is still
      403 SELF_CHANGE. `allowed.edit` is true for yourself; your other flags are false.
    - Others: reach and `team.edit` (403 PEER_PROTECTED, DEPARTMENT_NOT_ALLOWED, FORBIDDEN).
    - This replaces note 38's 400. The policy needs `app_is_admin()`, which is CEO level today.
80. **Traps found.**
    - **No INSERT on `platform_admins` for the app**, in any scope. `r0_platform_tightening`
      revoked INSERT, UPDATE and DELETE on it (Oct 7), so the `platform_admins_access` policy's
      platform scope never gets the chance. Neither the policy nor Rasel's decision 2 shows it:
      the first new login answered 500 (Prisma P2039, SQLSTATE 42501 "permission denied for table
      platform_admins"). No definer function inserts there either. The fix is R0's (Needs).
      Until then the `users` insert rolls back with it, and `adminUserFor` disables the Cognito
      login it made on any failure, not only a lost race, so retries leave no stray logins.
    - Platform scope cannot read `platform_members` (only admin scope and the member themself can).
      So the "on the team" check belongs to admin scope; platform scope only finds the ADMIN login
      and its admin row.
    - The trigger `platform_members_ceo_role_check` needs the admin row committed first. That
      takes two transactions (platform, then admin), so a failure in between leaves a half-made
      login, which is reused (note 70).
    - A reused login may already have a password, for example a former admin's: activation must
      check it (note 74).
    - Prisma 7's pg adapter reports a unique violation as P2002 or SQLSTATE 23505:
      `isUniqueViolation` (appointments/errors) covers both.
    - `.invited` rows are written before sending, so a failed send still counts toward the caps
      and shows as the member's `invitation`.
    - `/dev/token` finds users by email in every pool. An ADMIN login with a fixture's staff email
      would make that fixture's token ambiguous (400) in every other test file, so the e2e's
      staff and client logins use emails of its own run.
    - The platform cap is the whole test database's. The e2e lowers
      `TEAM_INVITE_LIMITS.perPlatform` to the current count, instead of writing 50 rows that would
      make other files' sends answer 429.
