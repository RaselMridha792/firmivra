# Super Admin stage B1: notifications and export jobs (contract note)

Migration `20261017150000_r0_platform_notifications`. Platform data only: no firm scope reaches
either table. For the API session building the Super Admin Notifications page and the bell, and
for every module that exports (Audit, Integration logs, Communications, Reports, Billing, Support,
Sales).

## `platform_notifications`: the Super Admin's notification center

One row **per recipient** (a Super Admin team member, `platform_admins.user_id`). A producer
creates a copy for each team member who holds the module's permission, so a team member sees only
what their role allows.

| Column | Notes |
| --- | --- |
| `recipient_user_id` | the team member (`PlatformAdmin`) |
| `category` | `FIRMS`, `FIRM_APPLICATIONS`, `SALES_LEADS`, `BILLING_SUBSCRIPTIONS`, `SUPPORT`, `INTEGRATIONS`, `SECURITY`, `SYSTEM` |
| `type` | event key, `module.event` (e.g. `billing.payment_failed`, `firm_application.submitted`, `security.suspicious_login`) |
| `priority` | `CRITICAL`, `HIGH`, `NORMAL` (default), `INFORMATIONAL` |
| `title`, `body` | safe display text only (title up to 200, body up to 1,000). Never secrets, card or bank data, document contents |
| `source_type`, `source_id`, `source_label` | the record the item opens (the deep link): e.g. `firm_application` + its id |
| `business_id` | the firm it is about, optional (cleared if that firm is ever deleted) |
| `event_key` | the producer's stable key; unique per recipient, so a retried event never makes a second item |
| `requires_action` | true for items that ask for work |
| `attention` | `NONE`, `ACTION_REQUIRED`, `RESOLVED`, `DISMISSED` |
| `read_at` | null = unread |
| `resolved_at`, `resolved_by_user_id`, `dismissed_at` | stamped by the database |
| `occurred_at` | when the event happened (UTC), not in the future |

**The spec's five statuses** come from two columns: Unread = `read_at` null; Read = `read_at` set;
Action Required = `attention = ACTION_REQUIRED`; Resolved = `RESOLVED`; Dismissed = `DISMISSED`.

**Rules the database enforces**
- A new item starts unread, with `attention` = `ACTION_REQUIRED` if `requires_action`, else `NONE`.
- The content never changes. Only `read_at` (read, or unread again) and `attention` do.
- `INFORMATIONAL` items never ask for work, and only items that ask for work can be resolved.
  Any item can be dismissed. Resolved and dismissed are final.
- No deletes: history is kept. Dismissing never touches the source record.

**Who can do what (RLS)**
- Admin scope (`forAdmin`): a team member reads and updates only their own items (read, unread,
  resolve, dismiss).
- Platform scope (`forPlatform`): producers insert and read, and resolve every copy once the task
  is done: `updateMany({ where: { sourceType, sourceId, attention: 'ACTION_REQUIRED' }, data: { attention: 'RESOLVED' } })`.
- A signed-in team member may also insert (an admin action that notifies others).

**Endpoints the screens need** (all under `/api/v1/admin/notifications`)
- `GET /` with `category`, `status` (the five), `priority`, `from`, `to`, `search`, `page`
- `GET /summary`: the four cards (unread, action required, critical, resolved today)
- `GET /unread-count` and `GET /recent`: the bell
- `POST /:id/read`, `/:id/unread`, `/:id/resolve` (action items only), `/:id/dismiss`
- `POST /bulk` (`ids` + action) and `POST /mark-all-read` (current filter)
- Opening an item marks it read. Resolving or dismissing a security or billing item writes an
  `audit_logs` row; marking read does not.

## `platform_export_jobs`: every Super Admin export

Holds what was asked for, never the exported data. The file goes to S3 at
`platform/exports/<job id>/<file>` until `expires_at`.

| Column | Notes |
| --- | --- |
| `requested_by_user_id` | the team member who asked |
| `module` | `AUDIT`, `BILLING`, `COMMUNICATIONS`, `INTEGRATION_LOGS`, `REPORTS`, `SALES`, `SUPPORT` |
| `format` | `CSV`, `XLSX`, `PDF` (the existing `ReportFormat`) |
| `title`, `filters` (JSON object, up to 8 KB), `columns` (up to 200) | the request; never change |
| `status` | `QUEUED` -> `RUNNING` -> `COMPLETED` -> `EXPIRED`; `QUEUED` or `RUNNING` -> `FAILED` |
| `row_count`, `size_bytes`, `s3_key`, `expires_at` | set on `COMPLETED` |
| `error_code` | set on `FAILED` (`a-z0-9_.`) |

**Who can do what (RLS)**
- Admin scope: a team member creates jobs for themselves and reads their own; the CEO
  (`SUPER_ADMIN`) reads all.
- Platform scope: the export worker reads and moves every job. Only the worker updates.
- No deletes.

**Endpoints** (per module, same shape): `POST /api/v1/admin/<module>/exports` (returns 202 and the
job), `GET /api/v1/admin/exports/:id` (status, and a short-lived signed URL when `COMPLETED`), and
`GET /api/v1/admin/exports?module=` (my recent exports). Each export request and download writes an
`audit_logs` row (`export.created`, `export.downloaded`).

**Needs from R1:** the documents bucket's IAM policy allows `tenant/*` only; the worker needs
`platform/exports/*` on the bucket the exports use (or a separate bucket), and a lifecycle rule to
delete those files after 7 days.

## Seed

The regular seed adds one notification for the Super Admin (LVP's application approved) and one
completed audit export.
