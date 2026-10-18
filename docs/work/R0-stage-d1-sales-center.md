# Super Admin stage D1: Sales Center (contract note)

Migration `20261019010000_r0_sales_center`. This note is for the API session that builds the Super Admin Sales Center (targets and goals) and the Leads / CRM import.

It builds on B5 (`docs/work/R0-stage-b5-sales.md`). The sales records, the metric definitions and the duplicate check are B5's. D1 adds the goals measured against those records and a record of each import.

**Platform data.** Only the Super Admin team (admin scope) and the platform's import job (platform scope) reach these tables; no firm scope does. The policies use B5's `app_is_sales_team()`. Which targets and imports a team member may see or change is the API's check, from `platform_members.scope_type` and the `sales.*` permission keys, as in B5.

**Where the requirements come from.** The Master Developer Guide lists "targets/goals" for the Sales Center and "lead creation/import … deduplication strategy" for Leads / CRM, but gives no fields. The Sales Center mockup has no targets panel. The choices below are mine (Rasel's rule: decide and write it down).

## Tables

| Table | What it holds | The app may |
| --- | --- | --- |
| `sales_targets` | one goal: who it is for, the metric, the goal value and the period | select, insert, update (archive instead of delete) |
| `sales_lead_imports` | one import batch: the file, where its leads go, the duplicate mode, the status and the counts | select, insert, update (cancel instead of delete) |
| `sales_lead_import_rows` | one outcome per file row | select, insert (insert-only) |

## Targets

**Who a target is for** (`scope`, exactly one subject):

| `scope` | Subject column | Notes |
| --- | --- | --- |
| `COMPANY` | none | |
| `TEAM` | `department_id` | Firmivra's platform hierarchy has departments and no separate team table, so a sales "team" is a platform department. It must be active when the target is created. |
| `REP` | `user_id` (a `platform_admins` row) | Removing that admin removes their targets. |

**The period** (`period_type`, `period_start`, `period_end`; the dates are inclusive, as UTC days):
- `MONTH`, `QUARTER` and `YEAR` must start and end on the calendar boundaries, for example 2026-10-01 to 2026-12-31 for a quarter.
- `CUSTOM` is any range of up to 366 days.

**The goal value.** `target_value` is above 0. It is:
- a count, for most metrics
- cents, for `REVENUE_WON`
- basis points (at most 10,000), for `CONVERSION_RATE`

**Uniqueness.** Only one live target exists per subject, metric and exact period (unique index `sales_targets_one_live`). To replace a target, archive it, then create the new one.

**Editing.** The name, goal value and note can change. The subject, metric and period never change: archive the target and create another. That way attainment history always compares like with like.

**Archiving.** Set `archived_at` to any value; the database stores its own time. It happens once, and an archived target never changes again.

**Database-stamped columns.** `created_at`, `created_by_user_id`, `updated_at` and `updated_by_user_id`.

### Attainment: computed by the API, never stored

Compute attainment from the source records for the target's period and subject, with the same definitions on the Sales Center, the Dashboard and Reports. Use B5's definitions, scoped like this:
- `COMPANY` counts every record.
- `TEAM` counts records whose `assigned_to_user_id` (or, for activities, `actor_user_id`) belongs to a member of that department.
- `REP` counts that rep's records.
- Attribution follows the current owner (B5 keeps assignment history if a report ever needs the owner at the time).

| Metric | What it counts in the period |
| --- | --- |
| `NEW_LEADS` | `sales_opportunities` with `created_at` in the period |
| `DEMOS_SCHEDULED` | `sales_follow_ups` with `kind = 'DEMO'` and `due_at` in the period, except `CANCELLED` ones (subject: the follow-up's assignee) |
| `TRIALS_STARTED` | `platform_firm_subscriptions` with `trial_started_at` in the period that an opportunity links to (`transaction_kind = 'platform_subscription'`); the subject is that opportunity's owner |
| `WON_DEALS` | opportunities with `converted_at` in the period |
| `REVENUE_WON` | the sum of `value_cents` over those won deals; a null value adds nothing (never invent a value) |
| `CONVERSION_RATE` | B5's conversion rate over opportunities created in the period, in basis points: converted ÷ (created minus those lost as `DUPLICATE` or `INVALID_LEAD`) |
| `OUTBOUND_ACTIVITIES` | `sales_activities` with `direction = 'OUTBOUND'` and `occurred_at` in the period (subject: `actor_user_id`) |

For a period that hasn't ended, show progress so far and "on pace" (the share of the period elapsed). Don't project values into the database.

## Lead imports

**The batch.**
- **The file:** `file_name`, `file_size_bytes` (1 B to 50 MB), an optional `file_sha256` (lowercase hex), and an optional `s3_key` under `platform/sales-imports/`.
- **Repeat warning:** look up `file_sha256` before you start, and warn when the same file was already imported.
- **Where leads go:** `pipeline_id` must be an active pipeline. The starting stage is `stage_id`, or null for the pipeline's first active stage. It must be an active stage of type `ACTIVE`.
- **Defaults:** `default_source` is used for rows that name no source, and `assigned_to_user_id` is the owner of the imported records (or null).
- **Column mapping:** a JSON object from file column to field.

**Lifecycle** (the database enforces it):

| From | To | What the database does |
| --- | --- | --- |
| (insert) | `PENDING` | nothing is counted yet; `created_by_user_id` is the signed-in admin |
| `PENDING` | `PROCESSING` | stamps `started_at` |
| `PENDING` | `CANCELLED` | stamps `finished_at` |
| `PROCESSING` | `COMPLETED` | stamps `finished_at`; the four counts must add up to `total_rows` |
| `PROCESSING` | `FAILED` | stamps `finished_at`; needs `failure_code` (a short lowercase code such as `unreadable_file`, no row data) |

- The file and settings change only while the batch is `PENDING`. `total_rows` can be set while it is `PENDING` or `PROCESSING`.
- A finished batch (`COMPLETED`, `FAILED` or `CANCELLED`) never changes. The one exception: its owner is cleared when that admin is removed.

**The counts are the database's.** Each row outcome adds one to `imported_count`, `duplicate_count`, `skipped_count` or `failed_count`. The app can't set the counts.

**How the import job runs** (platform scope):
1. Parse the file and set `total_rows` together with `PROCESSING`.
2. For each row, in the same transaction as the records it creates:
   - Run B5's duplicate check: look up `email_normalized` and `phone_normalized` on `sales_contacts`.
   - **No match:** create the contact and the opportunity, then insert an `IMPORTED` row with both ids.
   - **Match, and the batch's `duplicate_mode` is `SKIP`:** insert a `DUPLICATE` row with the matched contact and `matched_by`, and create nothing.
   - **Match, and the mode is `ATTACH_TO_EXISTING`:** create a new opportunity on the existing contact (never a second contact), then insert a `DUPLICATE` row with the contact, `matched_by` and the new opportunity.
   - **Blank or invalid row:** insert `SKIPPED` with a `reason_code`.
   - **Error while creating:** insert `FAILED` with a `reason_code`.
3. Run `SELECT set_config('app.sales_change_source', 'IMPORT', true)` in each transaction that creates opportunities. B5's stage history then records the source as `IMPORT`.
4. Set `COMPLETED`, or `FAILED` with a `failure_code` if the whole batch stops.

**What the database checks on each row:**
- The batch is `PROCESSING`.
- `row_number` is between 1 and `total_rows`, once per batch.
- An `IMPORTED` row names its contact and its opportunity.
- A `DUPLICATE` row names the matched contact and `matched_by`. It has an opportunity exactly when the batch attaches to existing contacts.
- The opportunity belongs to that contact and sits in the batch's pipeline.
- `SKIPPED` and `FAILED` rows carry only a `reason_code`.

**No row data is stored.** Row outcomes never copy the row's data. Names, emails and phones live only in the contact records and in the file.

**Retries.** Rows are unique per batch, so a retried job can't record a row twice. Resume from the highest recorded `row_number`.

**History survives deletions.** Deleting a contact clears `contact_id` on the outcome row and keeps the outcome. Removing an admin clears the batch's owner.

**For R1.** The uploaded file holds contact data:
- Grant the API role `platform/sales-imports/*`.
- Add a lifecycle rule that expires those objects (7 days, like the `platform/exports/*` prefix).

## Endpoints the screens need

All are under `/api/v1/admin/sales`.

**Targets**
- `GET /targets?period=&scope=`: each live target with its attainment, computed as above.
- `POST /targets`, `PATCH /targets/:id` (name, goal value, note) and `POST /targets/:id/archive`.

**Imports**
- `POST /imports`: upload, then map the columns, pick the pipeline or stage, the duplicate mode, the default source and the owner. The batch stays `PENDING`.
- `POST /imports/:id/start` (or `/cancel`). Processing runs in platform scope.
- `GET /imports` and `GET /imports/:id`: the batch, its counts and its outcomes, with links to the contacts and opportunities. Show the reason codes as text, and show no row data.

**Audit.** Every target change and every import start, cancel and finish writes `audit_logs` (category `DATA`), with no file contents.

## Seed

The regular seed adds two targets: this month's company goal for new leads, and the Super Admin's goal for won deals this quarter. It also adds one finished import (`webinar-signups-sample.csv`), run the way the job would: one row imported as a new lead, and one row matching B5's prospect by email and skipped.

Demo rows wait for demo seed stage 5.
