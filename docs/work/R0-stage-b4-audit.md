# Super Admin stage B4: Audit & Security (contract note)

Migration `20261017180000_r0_platform_audit_security`. This note is for the API session that
builds the three Audit & Security screens: the dashboard, event detail, and Security Settings &
Policies. It also covers every service that writes audit events.

Rasel decided on Oct 17 to keep one trail, so `audit_logs` gains the normalized event fields
instead of a second events table. The alerts, investigation notes and security policy are platform
data, and no firm scope reaches them.

## Needs Rasel's yes: the wall change

Until now, admin scope read only platform audit rows (`business_id IS NULL`). This migration
replaces the `audit_logs_admin_read` policy with `audit_logs_team_read`:
`app_is_admin() OR app_is_platform_member()`. The Super Admin team then reads **every** audit row,
the firms' rows included, which the cross-firm dashboard needs.

What does not change:
- A firm still reads only its own rows.
- A support session reads in the firm's scope, where `app_current_admin_id()` is null, so it
  gains nothing.
- Inserts are as before, and nobody updates or deletes an audit row.
- Which team member may read, search or export is the API's check, through the `audit.*`
  permission keys.

No API code reads `audit_logs` in admin scope today, so no existing screen changes.
`admin.test.ts` now asserts the new rule. Merging this PR is the yes; if the answer is no, keep
the dashboard to platform rows and read firm rows only through a per-firm support grant.

## `audit_logs`: the new fields

All the new fields are nullable, so every existing writer (`AuditService.log`, sign-in, the
database functions) keeps working unchanged. The service should fill them for every event in the
spec's taxonomy (section 6).

| Column | Notes |
| --- | --- |
| `category` | `AUTHENTICATION`, `AUTHORIZATION`, `DATA`, `INTEGRATION`, `SECURITY`, `SYSTEM`. A row with a category must also carry `severity`, `outcome` and `actor_type` |
| `severity` | `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (spec 11, section 6) |
| `outcome` | `SUCCESS`, `FAILURE`, `DENIED` |
| `actor_type` | `STAFF`, `CLIENT`, `PLATFORM` (Super Admin team), `SERVICE` (integration, API key), `SYSTEM` (jobs, rules), `ANONYMOUS` (signed out, e.g. a failed sign-in) |
| `actor_name`, `actor_role` | snapshots at the time of the action (up to 200 and 100 characters) |
| `session_id` | `[A-Za-z0-9._:-]`, up to 128 characters |
| `auth_method` | e.g. `password`, `password_totp`, `api_key`; lowercase, never a credential |
| `target_label` | the target's display label at the time (up to 200) |
| `subject_user_id` | the user acted on, when not the actor |
| `subject_business_id` | the firm a **platform** row is about; a firm's own row may only name itself |
| `parent_event_id` | a bulk operation's parent, or the event a response action answers (not itself) |
| `risk_score` | 0 to 100 |
| `rule_id` | e.g. `login.failed_burst` |
| `detection_source` | e.g. `sign_in`, `rules_engine` |
| `item_count` | a bulk operation's count, 0 or more |

`subject_user_id` and `subject_business_id` have no foreign key, like `actor_user_id`: the history
outlives the login and the firm. When a firm is deleted, its own rows go with it. A platform row
about that firm keeps the firm's id, and a platform row whose parent was a firm event loses only
the parent link (the test is `audit-security-firm-delete.test.ts`).

`created_at` is server-generated. When the app role (`firmivra_app`) writes a row, the database
sets `created_at` to `now()` whatever the app sends. The owner (seeds, tests, the database's own
functions) may still write a past time, so demo history can be dated.

**Indexes** for the dashboard and for related events:
- `(created_at)`, `(category, created_at)`, `(severity, created_at)`
- `(actor_user_id, created_at)`, `(subject_business_id, created_at)`
- `(session_id)`, `(parent_event_id)`

These are added to the existing `(business_id, created_at)` and
`(business_id, entity_type, entity_id, created_at)`.

**Filters on the dashboard**
- Tenant/firm: `business_id = X OR subject_business_id = X`.
- Free text: actor name, `target_label`, `entity_id`, `ip`, `action` and the event id.
- Paginate with a cursor on `(created_at, id)`; never load the whole table.

**Never in a row:** passwords, tokens, API secrets, keys, SSNs, bank numbers or document contents
(CLAUDE.md rule 4). Mask before/after values for sensitive fields in `metadata`.

## `security_alerts`

An alert is raised by a rule that matched an audit event.

| Column | Notes |
| --- | --- |
| `audit_log_id` | the event that raised it |
| `business_id` | the firm it is about, optional: the event's firm, or the `subject_business_id` of a platform event. The alert is deleted with that firm's data |
| `rule_id`, `severity`, `title`, `summary`, `risk_score` | fixed at insert. The summary says why it was raised and why that severity |
| `event_key` | unique: a rule raising the same alert twice gets the first one (idempotency, spec 11, section 11) |
| `status` | `OPEN` → `ACKNOWLEDGED` → `RESOLVED` or `DISMISSED`; `OPEN` may go straight to a final state |
| `assigned_to_user_id` | a team member; changes while the alert is not closed |
| `acknowledged_at`/`_by_user_id`, `closed_at`/`_by_user_id` | stamped by the database: the signed-in team member, or nobody for a platform job |
| `resolution_note` | only together with the close |

**Who can do what:**
- The rules engine raises and may auto-close alerts in platform scope.
- The team reads and works them in admin scope.
- No firm scope reaches them, and nothing is deleted.

Notifications for high and critical alerts go to B1's `platform_notifications`, with the alert's
`event_key` as the notification's key, so a retry never sends a second one.

The rules engine should evaluate rules **when the event is written**, because the writer has the
row. Platform scope still reads only platform audit rows, so a platform job cannot scan firm
events; widening that is a separate decision.

## `audit_investigation_notes`

A team member's notes on an event. They are **additive** (spec 11, section 3):
- A note's text never changes.
- An **edit** is a new note by the same author with `supersedes_note_id` set to the earlier note.
  A note is superseded at most once, never after it is retracted, and only within the same event.
- A **delete** sets `retracted_at` (the database stamps it) once, by the author only. The text
  stays for the record.
- The API writes an audit row for each note, edit and retraction (`audit_note.created`,
  `audit_note.edited`, `audit_note.retracted`).

The team reads all notes, and a member writes and retracts only their own (the author is the
signed-in team member). To show the current text, list the notes no other note supersedes.

## `platform_security_policy`: one row, id 1

The migration inserts the defaults below. The app only updates the row, and it never inserts or
deletes one.

Every save adds 1 to `version` (the database does it, whatever the app sends) and stamps
`updated_at` and `updated_by_user_id`. Save with
`updateMany({ where: { id: 1, version: <the version read> }, data })`. A count of 0 means someone
else saved first, so reload and show the conflict (spec 11, section 10).

**Who can do what:**
- The team reads and saves the row in admin scope. Which member may save is the API's `security.*`
  check.
- The platform's own services (sign-in, sessions, exports) read it in platform scope.

**Each section is a JSON object.** The API owns the zod schemas (`packages/types`). The database
checks only the floors marked "floor" below, so that a mistake never weakens the platform.

| Section | Keys (default) | Floor |
| --- | --- | --- |
| `mfa` | `requiredFor` (`PLATFORM_ADMINS`; or `PLATFORM_ADMINS_AND_ROLES`, `ALL_USERS`), `roleKeys` ([]), `methods` (["TOTP"]) | never below the platform team; `roleKeys` is up to 100 strings |
| `password` | `minLength` (12), `requireUppercase`, `requireLowercase`, `requireNumber` (true), `requireSymbol` (false), `preventReuseCount` (5), `rotationDays` (null: no forced rotation, spec 11) | length 8 to 128; reuse 0 to 24 |
| `session` | `idleTimeoutMinutes` (30), `maxLifetimeHours` (12), `concurrentSessions` (`ALLOW`), `adminsCanRevokeAll` (true) | idle 5 to 1,440; lifetime 1 to 720 |
| `loginProtection` | `maxFailedAttempts` (5), `lockoutMinutes` (15), `suspiciousLoginAlerts` (true), `ipAllowList`, `ipBlockList` ([]) | attempts 3 to 20; lockout 1 to 1,440 |
| `adminAccess` | `reauthForHighRiskChanges` (true), `reauthWindowMinutes` (10) | window 1 to 60 |
| `apiIntegrations` | `maskSecrets` (true), `tokenLifetimeDays` (90), `rotationReminderDays` (14), `requireWebhookSignatures` (true), `disableAfterAuthFailures` (5) | `maskSecrets` always true; lifetime 1 to 365 |
| `auditRetention` | `retentionDays` (2,555, about 7 years), `archiveAfterDays` (365), `editable` (false: show it read-only) | retention 365 to 3,650; archive 30 or more and not after retention |
| `exportControls` | `exportRoleKeys` ([]), `requireReauth` (true), `linkExpiryHours` (24) | expiry 1 to 168 |
| `alertRouting` | `inApp` (true), `email` (true), `sms`, `webhook` (false), `minimumSeverity` (`HIGH`), `recipientRoleKeys` ([]) | `inApp` always true; severity `LOW` to `CRITICAL` |

A section may hold other keys that the API's schema allows, up to 16 KB per section.

Every save writes an audit row (`policy.changed`, category `SECURITY`, severity `HIGH`). It holds
the changed field names and their old and new values, which are safe because the policy holds no
secrets.

## Endpoints the screens need

All under `/api/v1/admin/audit`.
- `GET /events`: the filters above, with a cursor.
- `GET /summary`: the cards, for the selected date range: critical, high-risk, failed logins,
  permission changes and open alerts. Active sessions come from the session service.
- `GET /events/:id`: the event with its parent and children, related events (same actor,
  session, IP or target), its alerts and its notes.
- `POST /events/:id/notes`, `POST /notes/:id/edit` (a new note), `POST /notes/:id/retract`.
- `GET /alerts`, then `POST /alerts/:id/acknowledge`, `/resolve` (with a note), `/dismiss` and
  `/assign`.
- `POST /exports`: B1's `platform_export_jobs` with `module = AUDIT`. Each request and each
  download is audited.
- `GET /policy` and `PUT /policy` (with `version`).

Response actions (revoke a session, suspend or lock a user, reset MFA, disable an integration)
act on their own objects and write a **new** audit row whose `parent_event_id` is the event they
answer. The original event never changes.

## Not in this stage

- Saved dashboard filter views: B9 (saved reports).
- Retention runs and legal holds: B7. This policy only states the retention.
- Session storage: owned by the auth design.
- Demo rows (Stage 5): a burst of failed sign-ins and the alert it raised, permission changes, and
  a policy save.
