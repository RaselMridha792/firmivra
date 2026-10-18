# R55: Staff and organisation API (departments, teams, org chart)

Contract: `packages/types/src/staff/departments.ts` (R42). Module: `apps/api/src/departments/`.

## Steps

- [ ] 1. Departments, teams and the org chart (this PR).
- [ ] 2. Roles and the permission grid (`/business/roles`, `/business/permission-modules`).
- [ ] 3. The staff directory, details, security, documents and drafts (the rest of `packages/types/src/staff/client.ts`).

## Progress

- 2026-10-18: step 1. Departments (list with search, status and pages; summary; detail with its teams; create; edit, change head, deactivate, reactivate, archive) and teams (list, detail, create, edit, change lead, move department, deactivate, archive; the whole member list set at once with one primary and one backup team each), and the org chart (active people, their supervisor, departments and the departments they head).

## Notes

1. Everyone with the grid's Staff Management view reads; only Owner and Admin change (a route role, so Manager and Staff get 403 FORBIDDEN).
2. A department or team name must be free among the firm's departments and teams that are not archived, ignoring case (409 DUPLICATE_NAME); archiving frees it.
3. A head or lead, and every team member, must be an ACTIVE member of the firm (409 MEMBER_NOT_ACTIVE).
4. Deactivating or archiving a department with active people or active teams is 409 GROUP_IN_USE unless `moveTo` names another ACTIVE department: the people and the active teams move first. A team with active members cannot be deactivated (409 GROUP_IN_USE); set its members first.
5. A person is the PRIMARY of one team and the BACKUP of one team at most; a second one is a 400 naming the row. Members join an ACTIVE team only.
6. Nothing is deleted. Audited with ids and field names only.
7. No schema change.

## Needs from others

- None.
