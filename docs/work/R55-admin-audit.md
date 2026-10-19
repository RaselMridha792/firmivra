# R55: Super Admin Audit & Security

Contract: `packages/types/src/admin-audit/` (`api.adminAudit`). API: `apps/api/src/admin-audit/` (next PR). Design: `docs/mockups/super-admin/audit-security/` (dashboard, two Event Details frames, Security Settings, developer instructions). Tables: R0 stage B4 (`docs/work/R0-stage-b4-audit.md`). The screens were built on `apps/web/src/mocks/admin-audit-security.ts`; the contract follows its shapes where the database allows.

## Steps

- [x] 1. Contract: events (list, facets, summary, detail, export), response actions, notes, alerts, the security policy.
- [x] 2. API, with unit, e2e and the admin-scope WRITES cases (`rasel/R55-admin-audit-api`).

## Decisions (contract)

1. **The database's enums win over the mock's.** Outcome is SUCCESS, FAILURE or DENIED (the mock's BLOCKED and DETECTED are DENIED and a SECURITY event); category includes SYSTEM.
2. **Paging is by page with a total** (the design's "Showing 1 – 8 of 248" and page numbers), at most 100 a page, not the B4 note's cursor.
3. **Rows written before the normalized fields** (no `category`) are classified from their action when read (`auth.sign_in_failed`: AUTHENTICATION, MEDIUM, FAILURE); `classified: false` says so. Today no writer fills the B4 columns, so this is every row.
4. **Response actions that change a firm member's account** (Reset Password, Unlock, Force Logout, Suspend, Reset MFA) are listed with `enabled: false` and a reason: the admin scope cannot read or change firm memberships, staff security settings or sessions. Mark Reviewed (a new `audit.event_reviewed` row naming the event) and Send Alert (a `security_alerts` row) work. Disable Integration waits for the Integrations API (R56).
5. **Active Sessions** (summary card) is null for the same reason: `staff_sessions` is firm data.
6. **Export** builds the file in the answer (CSV or JSON, at most 10,000 rows, 409 EXPORT_TOO_LARGE beyond) and is audited; `platform_export_jobs` waits for an export worker.
7. **Security Settings** keep the mock's sections, inside the database's floors: audit retention 365 to 3650 days (the mock's 90 days and 6 months are not allowed), MFA always required for Super Admins (`ALL` adds everyone; no "Optional"). The API maps them onto `platform_security_policy`'s nine JSON sections (extra keys where a section has no field for one).

## Notes (API)

1. `apps/api/src/admin-audit/`: `AdminAuditController` (`/admin/audit`, `@Roles('SUPER_ADMIN')`, static paths first), `AdminAuditService` (log, facets, summary, Event Details, export), `AdminAuditActionsService` (responses, notes, alerts), `AdminSecurityPolicyService` (the policy), `classify.ts` (pure: the action rules, the database filters built from them, labels, references, devices, masked changes).
2. Reads run in admin scope (`AdminPrisma`); names of users come from the platform's `users` (`PlatformPrisma`, a platform table read for a Super Admin). No business scope is ever opened (the admin-scope sweep checks it).
3. The admins' own rows are written in admin scope with all four normalized fields (`writeAdminEvent`), `parent_event_id` naming the event. A review is `audit.event_reviewed` (one per event; a repeat answers the first) and is left out of the log: it is its event's timeline.
4. The firm filter is `business_id = X OR subject_business_id = X`, so a firm's view includes the Super Admins' rows about it (alerts raised, notes).
5. The policy page maps onto the nine sections, keeping keys it does not manage (`roleKeys`, `adminsCanRevokeAll`, the integration settings, `webhook`); its own extra keys (`rememberMeDays`, `concurrentLimit`, `ipMode`, the notice toggles under `alertRouting.events`...) sit beside them. `policy.changed` keeps the changed fields with old and new values (lists as a count).

## Needs from others

- **R0 / Rasel:** firm accounts from the Super Admin console (unlock, suspend, reset, force logout, active sessions) need either an admin path into firm memberships and `staff_security_settings`/`staff_sessions`, or a support grant flow that allows writes. Until then those actions answer 409 ACTION_UNAVAILABLE.
- **Writers of the B4 fields:** `AuditService` does not set category, severity, outcome or actor type; the sign-in service and the rest write bare actions. The API classifies on read meanwhile.
- **A rules engine** that raises `security_alerts` when events are written (failed-login bursts and so on). Only Send Alert raises one today.
- **An export worker** for `platform_export_jobs` (module AUDIT) for exports over 10,000 rows.
