# Super Admin stage B2: Support (contract note)

Migration `20261017160000_r0_platform_support`. Firmivra's support desk for firms (Support spec).
For the API session building the Super Admin Support pages (and later the firm portal's "Help").

**Decided (Rasel, Oct 17):**
- Tickets carry the firm (`business_id`). The Super Admin team sees every ticket.
- A firm's members see and raise only their own firm's tickets and replies. They never see
  internal notes, note files or the history.
- Attachments live under the firm's S3 prefix: `tenant/<firm>/support/...`.

## Tables

| Table | What it is | Key columns |
| --- | --- | --- |
| `support_tickets` | a ticket | `number` (platform-wide, from 1001, given by the database), `business_id`, `contact_user_id` (a member of that firm), `subject`, `description`, `category_id`, `priority_id`, `status`, `source`, `assigned_user_id` (a `platform_admins` row; null = queue), `created_by_user_id`, escalation (`is_escalated`, `escalated_at`, `escalated_by_user_id`, `escalation_reason`), SLA (`first_response_due_at`, `first_responded_at`, `resolution_due_at`, `sla_paused_at`, `sla_paused_seconds`), `resolved_*`, `closed_*`, `reopened_count`, `merged_into_ticket_id`, `last_activity_at`, `idempotency_key`, `version`, `deleted_at` |
| `support_ticket_messages` | the conversation, insert-only | `author_user_id`, `author_side` (`STAFF` or `CUSTOMER`), `body`, `delivery_channel` (e.g. `EMAIL`; null = portal only) |
| `support_ticket_notes` | internal notes, insert-only, team only | `author_user_id`, `body` |
| `support_ticket_attachments` | files on a message or a note (or the ticket) | `message_id` or `note_id` (at most one), `file_name`, `content_type`, `size_bytes` (at most 10 MB), `sha256`, `s3_key` (`tenant/<firm>/support/...`), `scan_status` |
| `support_ticket_events` | history, insert-only, team only | `actor_user_id` (null = system), `actor_type`, `action` (`ticket.assigned`, `ticket.status_changed`, `sla.breached`, ...), `old_value`, `new_value` |
| `support_categories` | reference data | `name`, `description`, `is_active`, `sort_order`. Seeded: Account Access, Billing & Payments, Document Filing, Compliance, Technical Issue, General Inquiry |
| `support_priorities` | reference data and SLA targets | `code`, `name`, `color`, `response_target_minutes`, `resolution_target_minutes`, `business_time`. Seeded: CRITICAL 60, HIGH 240, MEDIUM 480 (1 business day), LOW 960 (2 business days) |
| `support_settings` | one row | `working_days` (1 = Monday), `opens_at`, `closes_at`, `time_zone`, `sla_mode` (`BUSINESS_HOURS` or `CALENDAR`), `pause_while_waiting`, `round_robin`, `last_assigned_user_id`, `reassign_after_minutes` |
| `support_holidays` | days the business-hours clock stops | `date`, `name` |
| `support_escalation_rules` | when to escalate | `kind` (`SLA_BREACH`, `HIGH_PRIORITY_UNRESOLVED`, `CRITICAL_IMMEDIATE`), `priority_id`, `threshold_minutes`, `notify_user_id`, `channels` (`EMAIL`, `IN_APP`, `SMS`). Three defaults seeded |
| `support_canned_responses` | saved replies | `title`, `body`, `category_id`, `is_active` |
| `support_notification_rules` | who hears about what | `event` (`ticket.created`, `ticket.assigned`, `ticket.reassigned`, `ticket.customer_replied`, `ticket.escalated`, `sla.warning`, `sla.breached`, `ticket.resolved`, `ticket.reopened`, `ticket.closed`), `notify_assignee`, `notify_role_keys`, `channels`. Defaults seeded |
| `support_ticket_counters` | the last number given | read-only for the app |

**Statuses:** `OPEN` (the start), `IN_PROGRESS`, `WAITING_ON_CUSTOMER`, `RESOLVED`, `CLOSED`.
Overdue and Escalated are flags and tabs, not statuses. A merged ticket is `CLOSED` with
`merged_into_ticket_id`.

**Sources:** `PORTAL`, `EMAIL`, `PHONE`, `INTERNAL`, `WEB_FORM`.

**SLA state** (Within SLA, Warning, Breached) is worked out by the API from the due times, the
paused time, `support_settings` and `support_holidays`. It is not stored.

## Rules the database enforces

- **Ticket numbers and times:** the number is given on insert (a caller's value is ignored), and
  `created_at` and `last_activity_at` are stamped. A new ticket starts `OPEN`.
- **Fixed facts:** firm, number, source, contact, creator, creation time and idempotency key never
  change. `idempotency_key` is unique, so a retried submit is refused rather than becoming a
  second ticket.
- **Contact:** the contact is a member of the ticket's firm (composite key to `memberships`),
  whatever the scope.
- **Status facts:** `RESOLVED` needs `resolved_at`; `CLOSED` needs `closed_at` (and only a closed
  ticket has it); a merge is closed and points at another ticket; an escalation carries its time.
- **Insert-only rows:** messages, notes and history are never edited or deleted, and the
  database stamps their time.
- **Files:** a file's identity never changes. It starts `PENDING`, and only the scanner records
  the result, once.
- **No hard deletes of tickets:** soft delete with `deleted_at`. Categories and priorities are
  retired with `is_active`.

## Who can do what (RLS)

- **Super Admin team** (admin scope: the CEO or any `ACTIVE` org-chart member) and **platform
  jobs** (platform scope: SLA clock, auto-assignment, email intake): read and write every table.
  Which team member may do which action is the API's check, with `support.*` permission keys in
  `platform_role_permissions` (view all or own, assign, escalate, resolve, close, merge, delete,
  view internal notes, manage canned responses, edit settings).
- **A firm** (business scope, with the signed-in member as actor):
  - reads its own non-deleted tickets, their messages and their conversation files
  - raises a ticket: `source = PORTAL`, `created_by_user_id` = itself, unassigned, not escalated
  - replies as `CUSTOMER` under its own name, and adds files to its own messages
  - reads the categories and priorities, to pick from
  - never updates a ticket, and never sees notes, note files, history, settings, rules or canned
    responses
- Staff replies are written as `STAFF` under the signed-in team member's own id.

**API's job:**
- Don't assign to a team member whose org-chart row isn't `ACTIVE`. Admin scope can't see other
  members' rows, so the database can't check this.
- Bump `version` on every update (`where: { id, version }`) and answer 409 on a mismatch.
- Write an `support_ticket_events` row for every change the history lists.
- Recompute `last_activity_at`.

## Endpoints the screens need (all under `/api/v1/admin/support`)

- `GET /tickets` with `tab`, `search`, `status`, `priority`, `category`, `businessId`, `assignee`,
  `source`, `createdFrom`, `lastActivityFrom`, `slaState`, `escalated`, `page`
- `GET /summary`: Total, Open, Overdue, Waiting on Customer, Resolved (30 days), and the tab
  counts
- `POST /tickets` (multipart or with pre-uploaded files; `idempotencyKey`) and
  `GET /firms/:businessId/contacts` (the firm's members, to pick the contact)
- `GET /tickets/:id` and `PATCH /tickets/:id` (with `version`)
- `POST /tickets/:id/` followed by `assign`, `status`, `escalate`, `resolve`, `close`, `reopen`,
  or `merge` (`{ targetTicketId }`)
- `GET` and `POST /tickets/:id/messages`; `GET` and `POST /tickets/:id/notes`
- `GET` and `POST /tickets/:id/attachments`; `GET /tickets/:id/attachments/:aid/download`
- `GET /tickets/:id/history`
- `DELETE /tickets/:id` (soft, permissioned)
- Settings: CRUD on `/settings/` followed by `categories`, `priorities`, `holidays`,
  `canned-responses`, `escalation-rules` or `notification-rules`; `GET` and `PUT` on
  `/settings/sla` and `/settings/assignment`

**Firm side, later:** `GET` and `POST /api/v1/business/support/tickets`,
`GET /api/v1/business/support/tickets/:id`, `POST .../messages`. The same tables, through the
firm policies above.

## Seed

The regular seed adds an LVP ticket (#1001): raised by email, assigned, a staff reply with a
scanned screenshot, the owner's reply from the firm's side, an internal note and a history row.
It also adds a Thanksgiving holiday and a canned response. The migration itself inserts the
categories, priorities, settings, counter, escalation rules and notification rules, so dev and
production have them too.
