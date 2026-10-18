# Super Admin stage B5: Sales Pipeline (contract note)

Migration `20261017190000_r0_platform_sales`. This note is for the API session that builds the
Super Admin Sales Pipeline: the board, the list, the KPIs, the record view and the pipeline
builder (spec 17).

**Firmivra sells to prospective firms.** A prospect is a contact (a person and their company). An
opportunity moves them through a pipeline. A won deal links to the firm's application and, once
the firm is provisioned, to the firm itself. This is platform data: only the Super Admin team
(admin scope) and the platform's jobs (platform scope) reach it, and no firm scope does.

One dataset sits behind every view: board, list, KPIs, analytics and record. There are no copies
per screen.

## Tables

| Table | What it holds |
| --- | --- |
| `sales_pipelines` | sales processes; the migration ships `system_key = 'firmivra_default'` |
| `sales_pipeline_stages` | a pipeline's stages, in `position` order |
| `sales_contacts` | the master person record. Conversion never creates a second one |
| `sales_opportunities` | the record behind the card and the row |
| `sales_tags`, `sales_opportunity_tags` | reusable tags (never a stand-in for the stage) |
| `sales_stage_history`, `sales_assignment_history` | written by the database only; the app reads them |
| `sales_activities` | outreach and conversations (call, email, text, meeting); insert-only |
| `sales_follow_ups` | follow-ups and appointments (the Upcoming panel); cancelled, never deleted |
| `sales_notes` | a team member's notes; only the author edits or deletes one |
| `sales_attention_settings` | one row (id 1): the attention thresholds |

## The shipped pipeline (spec 17, section 4)

| Position | Stage | `system_key` | `stage_type` |
| --- | --- | --- | --- |
| 0 | New Lead | `new_lead` | `ACTIVE` |
| 1 | Attempted Contact | `attempted_contact` | `ACTIVE` |
| 2 | Contacted | `contacted` | `ACTIVE` |
| 3 | Qualified | `qualified` | `ACTIVE` |
| 4 | Appointment Set | `appointment_set` | `ACTIVE` |
| 5 | Nurturing | `nurturing` | `ACTIVE` |
| 6 | Active Client | `active_client` | `CONVERTED` |
| 7 | Under Contract | `under_contract` | `TRANSACTION_SYNCED` (requires `transaction`) |
| 8 | Closed / Past Client | `closed_past_client` | `CLOSED` |
| 9 | Unqualified / Lost | `unqualified_lost` | `LOST` (the side exit) |

A terminated transaction returns the record to Active Client: the pipeline's
`terminated_return_stage_id`, which must be an `ACTIVE` or `CONVERTED` stage of the same pipeline.

The six stages before Active Client are all `ACTIVE`. The database doesn't enforce the order among
them, so the API decides which backward moves are allowed (spec 17, section 12).

## What the database guarantees

**Stages**
- A shipped stage (one with a `system_key`) keeps its key and type and is never deleted. Renaming,
  reordering and deactivating it are fine.
- A stage that holds records never changes type.
- A stage that holds records can't be deleted (the foreign key refuses it). Move the records first
  (spec 17, section 15).
- An inactive stage accepts no new records.
- Only the migration ships keys, so the app can't create a stage or pipeline with a `system_key`.

**Entering a stage**
- The record must have the stage's `required_fields`: `value`, `assignee`, `plan`, `transaction`
  or `lost_note`.
- Converting (entering `CONVERTED`, `TRANSACTION_SYNCED` or `CLOSED`) stamps `converted_at` once.
- `stage_entered_at`, `lost_at`, `converted_at`, `transaction_synced_at`, `created_at`,
  `created_by_user_id` and `updated_at` are the database's to set.

**Lost** (the side exit)
- Entering a `LOST` stage requires `lost_reason` (`NOT_A_FIT`, `BUDGET`, `NO_RESPONSE`,
  `CHOSE_COMPETITOR`, `TIMING`, `DUPLICATE`, `INVALID_LEAD`, `OTHER`).
- `OTHER` also requires `lost_note` when `lost_other_note_required` is set (the default).
- Leaving a lost stage clears the reason. The history keeps it, so lost reasons stay reportable
  from `sales_stage_history`.

**The transaction sync (no double entry, spec 17, section 14)**
- The linked transaction is `transaction_kind`, `transaction_id` and `transaction_status`, set
  together. Link it with status `OPEN`.
- When the transaction side changes the status, the record follows on its own:

| New status | The record moves to |
| --- | --- |
| `UNDER_CONTRACT` | the pipeline's first active `TRANSACTION_SYNCED` stage |
| `CLOSED` | its first active `CLOSED` stage |
| `TERMINATED` (from Under Contract) | the pipeline's return stage |

- While the transaction is under contract or closed, nobody can move the stage by hand.
- A person can't enter Under Contract without a transaction under contract.
- A transaction under contract can't be unlinked.
- `transaction_synced_at` shows the "Synced to Transactions" badge.

**Which transaction.** For Firmivra's sales, the transaction is the firm's platform subscription
(`transaction_kind = 'platform_subscription'`, `transaction_id` = the
`platform_firm_subscriptions` row). The billing and subscription service (B3) reports its status:
- signed contract or active paid plan: `UNDER_CONTRACT`
- ended at the end of its term: `CLOSED`
- cancelled early: `TERMINATED`

The API can link another kind later, with no schema change.

**History**
- Every stage change and every owner change writes a row, with the stage names at the time (a
  later rename never rewrites history).
- Each row records the actor: the signed-in team member, or null for the platform.
- Each row records the source:
  - `MANUAL` by default
  - `TRANSACTION` for a sync
  - `AUTOMATION` or `IMPORT` when the API runs
    `set_config('app.sales_change_source', 'AUTOMATION', true)` (or `'IMPORT'`) in the
    transaction
- Creation writes the first row: from null to the starting stage.

**Contacts**
- The database trims `email` and `phone`.
- It keeps `email_normalized` (lowercase) and `phone_normalized` (digits) for the duplicate check:
  look up both before creating a contact, and flag probable duplicates (spec 17, section 16).

**Activity and follow-ups**
- Activity is logged as the signed-in member, never dated in the future, and is insert-only. A
  linked follow-up must belong to the same record.
- A follow-up starts `SCHEDULED` and moves once to `COMPLETED` or `CANCELLED` (final, stamped).
  It can be edited and rescheduled only while scheduled.

**Firm deletion.** Deleting the firm or its application clears `linked_business_id` or
`firm_application_id`; the sales record and its history stay (`sales-firm-delete.test.ts`).

## Who can do what

- **The team (admin scope)** reads and writes everything except the history. Which records a team
  member sees and changes is the API's check, from `platform_members.scope_type` and the
  `sales.*` permission keys:
  - `OWN_RECORDS`: their assigned records
  - a team scope: their team's
  - `COMPANY`: all
- **Platform scope** (imports, the transaction sync, attention jobs) reads and writes the same.
- **Notes:** written, edited and deleted only by their author.
- **The app never deletes** opportunities, pipelines or follow-ups (lose, deactivate or cancel
  instead), and never writes history.

## Definitions the API must use everywhere (dashboard, Sales, Reports)

**Pipeline value** is the sum of `value_cents` over opportunities in `ACTIVE`, `CONVERTED` and
`TRANSACTION_SYNCED` stages. It never includes `LOST` or `CLOSED`, and never invents a value.

**Closed revenue** is the sum over `CLOSED` stages.

**Conversion rate** is:
- **numerator:** opportunities created in the period that have a `converted_at`
- **denominator:** opportunities created in the period, minus those lost as `DUPLICATE` or
  `INVALID_LEAD`

**The KPIs**
- **In Progress:** the `ACTIVE` stages.
- **Active Clients:** `CONVERTED` and `TRANSACTION_SYNCED`.
- **Needs Attention:** any attention rule below.

**Attention rules** (from `sales_attention_settings`):

| Badge | When it shows |
| --- | --- |
| No contact yet | in New Lead with no outbound activity after `no_contact_hours` |
| No response | `no_response_attempts` outbound activities with no inbound or `CONNECTED`/`REPLIED` outcome since |
| Follow-up due | a scheduled follow-up due within `follow_up_due_hours` |
| Overdue | a scheduled follow-up past due |
| Unassigned | no owner, while `owner_required` |
| No activity | no activity or stage change for `no_activity_days` |

## Endpoints the screens need

All under `/api/v1/admin/sales`.
- `GET /opportunities`:
  - board and list from one query
  - filters: stage(s), owner, plan, source, tag, date range, `overdue`, `unassigned`, search
    (company, contact name, email, phone, title)
  - sort and paging
- `GET /summary`: the KPIs, for the same filters.
- `GET /analytics?period=`: counts and values per stage, lost reasons.
- `POST /opportunities` (with the duplicate check), `GET` and `PATCH /opportunities/:id`.
- Stage and lost moves: `POST /opportunities/:id/stage` (`stageId`, plus `lostReason` and
  `lostNote` for a lost stage).
- Assignment: `POST /opportunities/:id/assign` and `POST /opportunities/bulk` (assign, stage, tags;
  confirm the count).
- Transactions: `POST /opportunities/:id/transaction` (link or unlink). Status changes come from
  the transaction side, in platform scope.
- The record's sub-resources:
  - activities, follow-ups (complete, cancel, reschedule) and notes
  - its history: stage and assignment rows, merged with activity into the Recent Activity feed
- Pipeline builder: `GET /pipelines`, `POST`/`PATCH /pipelines`,
  `POST`/`PATCH`/`DELETE /pipelines/:id/stages`. Stage deletes and type changes need the records
  moved first.
- `GET`/`PUT /attention-settings`, and tags CRUD.
- Every material change writes `audit_logs` (category `DATA`): creation, owner, stage, value,
  source, tag changes, lost, transaction link and sync.

## Not in this stage

- Demo rows (Stage 5): a full pipeline across every stage, including lost reasons and synced
  transactions.
- Linking leads that arrive through the public firm application or the Begin Online sign-up: the
  API can create an opportunity from a submitted firm application (source `WEBSITE`, with
  `firm_application_id` set).
