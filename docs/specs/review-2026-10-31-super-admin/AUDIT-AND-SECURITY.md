# Super Admin review (Oct 31): Audit & Security change list

Source: "Audit and Security Developer Feedback" (Review One, Oct 31, 2026) against the Audit and Security Developer Instructions (8 pages). Three screens inspected: Dashboard, Event Detail, Security Settings. Nothing changed. Her codes are kept (R1, Y1 ...). Her unnumbered "Clarifications before acceptance" rows are ours: SA-AUD-C1 to C3.

## Summary

1. F items: 8 (SA-AUD-R1 to R8). Y items: 13 (C1 to C3, Y1 to Y10). GREEN: 9 checks (G1 to G9), not items. Keep them working and re-test them at Review 2.
2. Her priority 1: precise event-ID search (R1) and real actor, session and before-and-after context (R3, R4). Priority 2: session summary (R2), record links (R5), policy and action coverage (R6 to R8). Priority 3: isolated security fixtures and backend evidence.
3. Most of R3 to R5 is capture, not schema: `audit_logs` already has `actor_role`, `session_id`, `auth_method`, `target_label` and `metadata`.
4. Schema: to check for R2 (admin sessions are not stored; `staff_sessions` covers firm staff only) and R7 (session lifetime and token policy fields).
5. Role checks: no permission is loosened to enable a button (R8); read-only auditor, export roles and tenant isolation proven on the server (Y3, Y4).
6. Shared: admin record-link helper (R5, with SA-NOT-Y2 and SA-RPT-R4); export writers (Y4, with SA-RPT-R1); list state in the URL (C3).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/audit-security/`. API: `apps/api/src/admin-audit/`. DB: `AuditLog` (append-only), `SecurityAlert`, `AuditInvestigationNote`, `PlatformSecurityPolicy`.

## A. Audit context

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-AUD-R1 | R1 (section 2) | Audit Logs search | Searching the exact display id EVT-20261031-1AEFEC returns 82 rows, including unrelated Support events (repeated twice). Name and resource-id searches return one. | Recognize the display id format (EVT-date-suffix) and the raw event id and match them exactly; any other text keeps the normal search. A non-existent id returns no rows. Tests for exact, non-existent and raw ids. | No. | Seed: events with known ids (set K). |
| SA-AUD-R2 | R2 (sections 2, 4) | Security dashboard > Active sessions | "Not available right now." | Show active session count, freshness and a list (user, started, last seen, device, IP) for admin and firm staff sessions, reconciled with known active, revoked and expired sessions. If admin sessions cannot be listed yet, show firm staff sessions and a clear "Admin sessions not tracked yet" with the reason (her allowed fallback). | To check: admin sessions are not stored today (`staff_sessions` is firm staff only); a platform session table or an identity-provider read. | Seed: sessions in each state (set K). |
| SA-AUD-R3 | R3 (sections 3, 7) | Event detail of a sign-in | Owner "Signed In" event: Auth Method "Not applicable", Session ID and Source "Not recorded", no actor id or role shown. | Fill `auth_method`, `session_id`, actor id and the actor's role at that moment when the sign-in event is written; show them in the detail. Geolocation and referrer stay optional. | No (columns exist). | None. |
| SA-AUD-R4 | R4 (sections 3, 7) | Event detail of an update | Ticket #1001 closure: status before "-", after CLOSED, role "Not recorded"; the ticket was RESOLVED before. | Capture safe before and after values and the actor's role for every update event (the Support close path showed the gap; fix it in the shared audit write helper). Re-test RESOLVED to CLOSED. A blank before-value on a CREATE event is correct. | No (`metadata` and `actor_role` exist). | None. |
| SA-AUD-R5 | R5 (sections 3, 5) | Event detail > Related Record | Stripe and Support targets have ids, but Related Record shows N/A and the Support name is a generic type. | Show a readable target label (for example "Ticket #1001", "Stripe Test draft") and a link to the exact admin record, for permitted viewers; a safe "not available" state when the record is gone or not permitted. Never a link into a firm workspace. | No (`target_label` exists). | Shared: admin record-link helper. |

## B. Navigation and policy

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-AUD-R6 | R6 (section 2) | Audit Logs table and filters | No Category or Outcome columns; no IP or device lookup. | Add Category and Outcome columns. Add an IP filter (exact or prefix) and a device filter (user agent contains). | No. | None. |
| SA-AUD-R7 | R7 (section 4) | Security Settings policies | No maximum session lifetime, API or token lifetime and rotation, or webhook-authentication policy. | Add a maximum session lifetime setting. Show API key lifetime and rotation and webhook signing as read-only policy status with a link to Integrations > API & Webhooks, where they are managed. Remember Me is not the session lifetime. | To check: fields on `platform_security_policy`. | None. |
| SA-AUD-R8 | R8 (sections 3, 5) | Event detail > response actions | Reset, unlock, logout, suspend and MFA actions are disabled with a generic firm-management message, also shown on platform sign-in events; integration disable points elsewhere. | For each event type, show only the actions that apply, each with an accurate reason when disabled ("Platform sign-ins: manage in Team", for example) and a link to the place where the action lives. Do not loosen any permission to enable a button. | No. | Role: no permission change. |

## C. Y items: clarifications (ours, from her "Clarifications before acceptance")

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-AUD-C1 | "Actor versus tenant" | Support event header says Firmivra while the affected firm is the QA test firm | Default: the detail shows "Actor: Firmivra (platform)" and "Affected firm: <firm name>" as two separate fields. |
| SA-AUD-C2 | "Metric windows" | 14-day range vs a 7-day card comparison; High Risk 5 shows "Down 100%" | Default: each card compares the selected range with the previous range of equal length and says so ("vs previous 14 days"). Seed known events in both windows to check the math. |
| SA-AUD-C3 | "Optional context" | Risk not scored; Back to Audit Logs loses the category | Default: risk scores stay optional until risk rules exist; Back keeps category and filters through the URL (shared list-state helper). |

## D. Y items: Review 2 tests (her Y1 to Y10)

Fixtures are dummy data set K in CHANGE-LIST.md and the role test logins (set L). No production policy change, no real alert or credential operation.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-AUD-Y1 | Y1 | Policy changes | Isolated config with approved values and rollback: change summary, confirmation, reauthentication, atomic save, version conflict, audit, real enforcement. |
| SA-AUD-Y2 | Y2 | Authentication | Expendable test logins: MFA, password rules, lockout, cooldown, reauthentication, expiry, revocation. The owner session is never touched. |
| SA-AUD-Y3 | Y3 | Permissions | Least privilege, read-only auditor login, tenant isolation, direct-route and API denial, non-revealing 403 and 404. |
| SA-AUD-Y4 | Y4 | Exports | Synthetic events: CSV and JSON match the filters, ids, timezone, redaction, short-lived download, reauthentication, request and completion audit. Uses the shared export writers. |
| SA-AUD-Y5 | Y5 | Alert responses | One seeded open alert: review, acknowledge, resolve, dismiss, notes added and audited, idempotent. |
| SA-AUD-Y6 | Y6 | Audit capture | Service tests: every sensitive event on success and failure, UTC time, actor, session, target, tenant, safe before and after. |
| SA-AUD-Y7 | Y7 | Integrity and secrets | Product APIs cannot edit or delete events; redaction across UI, exports, logs and errors with synthetic secrets only. |
| SA-AUD-Y8 | Y8 | Fault handling | Failure harness: audit-write failures visible, fail-closed for high-risk actions, no duplicate events or notifications. |
| SA-AUD-Y9 | Y9 | Counts and filters | Seeded dates across the Nov 1, 2026 DST change, actors, firms, outcomes, alerts and resource types; card, table and export match; IP and device lookup (R6). |
| SA-AUD-Y10 | Y10 | Layout and access | Keyboard and focus, readable detail states, loading and errors, safe deep links, kept navigation context (C3). |

## E. Schema needs (each needs Rasel's tap before any `packages/db` change)

- R2, to check: admin session tracking (new platform session table or an identity-provider read).
- R7, to check: session-lifetime and token-policy fields on `platform_security_policy`.
- R1, R3 to R6 and R8 need no schema change.

## F. Role and permission notes

No role change and no loosening (R8). Server-side proof of least privilege, read-only auditor, export roles and tenant isolation (Y3, Y4).
