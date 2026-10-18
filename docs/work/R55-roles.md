# R55: Roles and the permission grid API

Contract: `packages/types/src/staff/roles.ts` (R42). Module: `apps/api/src/roles/`.

## Progress

- 2026-10-18: `GET /business/roles`, `GET`, `PUT` and `DELETE /business/roles/:role/permissions`, `GET /business/permission-modules`, and `POST /business/roles/custom` (501). The roles guard now reads the firm's saved grid for Manager, Bookkeeper, Tax Preparer, Client Support and Read Only.

## Notes

1. Owner and Admin only. The Owner role is never changed (403 FORBIDDEN); nobody changes their own level or above (403 CANNOT_GRANT, from `ROLES_MANAGED_BY`: an Admin changes the roles below Admin).
2. The defaults are code (`DEFAULT_ROLE_PERMISSIONS`); only the cells that differ are stored in `role_permissions` (a cell set back to its default deletes its row). A save merges the cells it names; the others stay.
3. A capability without View in its module is 400 PERMISSION_NEEDS_VIEW. Giving a cell the default does not give is 409 PERMISSION_ESCALATION until `acknowledgeEscalation`.
4. `PermissionGrantsService` serves the guard: the default with the firm's changes on top, cached for 10 seconds per firm and role, and dropped at once by the task that saved. Another task sees a change within 10 seconds.
5. The grids of Admin and Staff can be saved and are shown, but their routes follow `@Roles(...)` as before; only the five newer roles are decided by the grid.
6. Every module supports all seven capabilities in the catalog served by `permission-modules`.
7. Custom roles need a `custom_roles` table and a membership column: 501 NOT_IMPLEMENTED. Per-member changes (`member_permissions`) belong to the staff API (next).
8. Audit holds the role, counts and the actor, never the cells.

## Needs from others

- Custom roles: a `custom_roles` table (R0), when wanted.
