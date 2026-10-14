# R38 work modules: API brief

The database for Bookkeeping, Tax Planning, Tasks, Compliance & Deadlines and Automations is in `packages/db` (migrations `r38_*`, the "R38: work modules" block at the end of `schema.prisma`, tests `packages/db/test/{tasks,compliance,automation,bookkeeping,tax-planning}-*.test.ts`, synthetic LVP rows in `packages/db/prisma/seed-r38.ts`). This is the brief for the API sessions: the endpoints the screens need, who may call them, and which routes already exist. Designs and written guides: `docs/mockups/firm-workspace/<module>/source/`.

Roles: FIRM_STAFF is Owner, Admin and Staff (Staff only for clients assigned to them, as today); FIRM_MANAGERS is Owner and Admin. Main merged R35 (eight roles, permission grid) before this brief was filed: where it says FIRM_STAFF or FIRM_MANAGERS, map to the R35 permissions for the module. All paths are under `/api/v1`. "Exists" means a route already on `main`.

Rules that hold for every module: `businessId` from the tenant context only; `TenantPrisma.db` for every query; `AuditService.log` for every action on client data; zod schemas from `packages/types`; an e2e test per endpoint and a firm A versus firm B test. Overdue and Due Soon are derived, never stored. An unavailable estimate or total is null, never invented.

## Decisions

- `TaskStatus` is unchanged (OPEN, DONE, CANCELLED). Where the screens say Not Started, Pending, In Progress, Waiting or Blocked, that is the new `tasks.progress` (`TaskProgress`); DONE shows as Completed.
- `tasks.client_id` stays required: every Tasks design (list, Create Task, Set Up Recurring Task) has a required Client.
- The government calendar library is per firm.
- The Bookkeeping Terms page is not modelled (it overlaps Services & Pricing, Invoices & Payments and Firm Sign). Transactions, refunds and settlements are not modelled (no ledger sync in this round).
- A deadline's tasks are `tasks.deadline_id`; a task made from a template has `tasks.template_id` (at most one per deadline and template).

## Tasks (`apps/api/src/workspaces/tasks.*`, contract in `packages/types/src/tasks`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/tasks` | **Exists** (filters: client, engagement, assignee, status, cursor). Add: progress, priority, type, due range, search, tab (mine, all, by client, completed, recurring), sort, cursor paging. Overdue is derived (OPEN and past due). | FIRM_STAFF |
| GET | `/business/tasks/summary` | KPIs (total, pending, in progress, overdue, completed this month) and "My Task Summary". | FIRM_STAFF |
| GET | `/business/tasks/calendar` | Due tasks for a month, for the Task Calendar. | FIRM_STAFF |
| GET | `/business/tasks/:id` | One task with assignees, prerequisite and its blockers. | FIRM_STAFF |
| POST | `/business/tasks` | **Exists** (title, client, engagement, details, due date, assignee). Extend with priority, type, service, start, due time, all-day, visibility, internal notes, additional assignees, prerequisite. | FIRM_STAFF |
| PATCH | `/business/tasks/:id` | **Exists** (title, details, status, due, assignee). Extend with the new fields. | FIRM_STAFF |
| POST | `/business/tasks/:id/(complete\|reopen\|cancel\|archive\|duplicate)` | Row actions. Completion stores time and actor; a required checklist item blocks completing (database rule). | FIRM_STAFF |
| POST | `/business/tasks/bulk` | Bulk reassign, status, due date, priority, complete, cancel (confirmation). | FIRM_STAFF; cancel and export FIRM_MANAGERS |
| GET, POST, PATCH | `/business/task-types` | The firm's task types (archive, never delete). | read FIRM_STAFF, write FIRM_MANAGERS |
| PUT, PATCH | `/business/tasks/:id/checklist`, `.../checklist/:itemId` | Replace the ordered checklist; complete an item. | FIRM_STAFF |
| PUT | `/business/tasks/:id/reminders` | Replace reminder rules (days before, time, in-app, email, SMS). | FIRM_STAFF |
| POST, DELETE, PATCH | `/business/tasks/:id/attachments` | Attach one of the client's documents; approve for the client (never an INTERNAL document). | FIRM_STAFF; approve FIRM_MANAGERS |
| GET, POST, PATCH | `/business/task-templates` | Templates; `POST .../:id/archive`, `POST .../:id/apply` (preview), `POST /business/tasks/:id/save-as-template`. | read FIRM_STAFF, write FIRM_MANAGERS |
| GET, POST, PATCH | `/business/task-series` | Recurring series; `POST .../:id/(pause\|resume\|stop)`, `POST /business/task-series/preview` (next occurrences before save), `GET .../:id/occurrences`, `POST .../occurrences/:occurrenceId/skip`. Edit scopes: this occurrence, this and future, entire series. | FIRM_STAFF; manage FIRM_MANAGERS |
| GET | `/portal/:firmSlug/me/tasks` | Client-visible tasks, approved fields only. | CLIENT |

Jobs, not routes: the reminder sender (uses `task_reminders.last_fired_for`) and the series generator (inserts the `task_occurrences` row first, so a retry never makes a second task).

## Compliance and Deadlines

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/compliance/deadlines` | List (date range, type, client, status, assignee, agency, "mine", tab, paging). Due Soon and Overdue are derived from `compliance_settings`. | FIRM_STAFF |
| GET | `/business/compliance/deadlines/summary` | KPIs, type chart, at-risk clients. | FIRM_STAFF |
| GET | `/business/compliance/deadlines/calendar` | A month of deadlines. | FIRM_STAFF |
| GET, POST, PATCH | `/business/compliance/deadlines[/:id]` | Read, create (with reminders, optional task from a template, once), edit. An override needs `dueOverrideReason`; a government date keeps `statutoryDueOn`. | FIRM_STAFF |
| POST | `/business/compliance/deadlines/:id/(in-progress\|complete\|not-applicable\|reassign\|archive\|extension)` | Status actions. Complete takes evidence (filed date, confirmation number); not applicable takes a reason. | FIRM_STAFF |
| PUT | `/business/compliance/deadlines/:id/reminders` | Replace reminder rules. | FIRM_STAFF |
| POST, DELETE | `/business/compliance/deadlines/:id/(tasks\|documents\|links)` | Create or link a task, attach a document of the client, link a related deadline. | FIRM_STAFF |
| POST | `/business/compliance/deadlines/bulk` | Bulk reassign, status, archive. | FIRM_STAFF |
| GET | `/business/clients/:id/compliance` | The client's compliance view. | FIRM_STAFF |
| GET, POST | `/business/compliance/calendars` | Library list; an import makes a DRAFT (`POST .../import-preview` compares with the published version first: added, changed, removed, unchanged). | read FIRM_STAFF, write FIRM_MANAGERS |
| GET, POST, PATCH, DELETE | `/business/compliance/calendars/:id[/entries]` | A version and its entries (only while DRAFT). `GET .../compare?with=` compares two versions. | FIRM_MANAGERS |
| POST | `/business/compliance/calendars/:id/(verify\|publish\|rollback\|archive)` | Publish supersedes the current version; rollback publishes the old one again. | FIRM_MANAGERS |
| GET, POST, PATCH | `/business/compliance/recurrences[/:id]` | Recurring definitions and templates; `POST .../:id/(pause\|resume\|end\|archive)`, `POST .../preview` for the next dates. | FIRM_STAFF; create, edit, end FIRM_MANAGERS |
| GET, POST, PATCH | `/business/compliance/applicability-rules[/:id]` | Rules; `POST .../:id/evaluate` previews matching clients. | FIRM_MANAGERS |
| GET, POST | `/business/compliance/suggestions` | Records that are suggested or need review; `POST .../:id/(confirm\|dismiss)` (confirm makes the deadline). | FIRM_STAFF |
| GET | `/business/compliance/logs` | Import, publish, generation, override and error log. | FIRM_STAFF |
| GET, PATCH | `/business/compliance/settings` | Due Soon and At Risk thresholds, stale calendar days, default reminders, escalation. | read FIRM_STAFF, write FIRM_MANAGERS |

Existing and reusable: the tasks routes above, `business/appointments`, the `business/clients/:clientId/documents` routes for attachments.

## Automations

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/automations/summary` | KPIs (active rules, tasks created, client and internal notifications, time saved, health). | FIRM_STAFF |
| GET, POST | `/business/automations/rules` | List (search, status, category with counts) and create a DRAFT rule with its first version. | read FIRM_STAFF, write FIRM_MANAGERS |
| GET, PATCH | `/business/automations/rules/:id` | Detail; a change to the trigger, conditions, actions or settings saves a new version. | read FIRM_STAFF, write FIRM_MANAGERS |
| POST | `/business/automations/rules/:id/(activate\|pause\|archive\|duplicate\|test)` | Activate needs a version and passes the integration, permission and loop-risk checks; test is a dry run with no side effects; duplicate makes a draft with no history. | FIRM_MANAGERS |
| POST | `/business/automations/rules/preview` | Matching records (count and sample) for a trigger and conditions. | FIRM_MANAGERS |
| GET | `/business/automations/rules/:id/versions` | Version history. | FIRM_STAFF |
| GET, POST, PATCH | `/business/automations/templates` | Templates; `POST .../:id/use` makes a draft rule, `POST .../import`. | read FIRM_STAFF, write FIRM_MANAGERS |
| GET | `/business/automations/runs` | Logs (date, rule, status, module, search, paging); `GET .../runs/summary` for the KPIs. | FIRM_STAFF |
| GET | `/business/automations/runs/:id` | Detail: action log, the version used, related records. | FIRM_STAFF |
| POST | `/business/automations/runs/:id/rerun` | Retry only failed, retryable actions; takes a reason. | FIRM_MANAGERS |
| GET | `/business/automations/runs/export` | Privacy-minimized export. | FIRM_MANAGERS |
| GET, PATCH | `/business/automations/settings` | Quiet hours, duplicate window, loop depth, safety threshold, failure alerts, time saved, log retention. | read FIRM_STAFF, write FIRM_MANAGERS |

Jobs, not routes: event ingestion (one run per rule and source event key), condition evaluation, the delayed-action scheduler. Each action runs once per idempotency key; a succeeded action is never run again (database rule).

## Bookkeeping

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/bookkeeping/summary` | KPIs, status counts, connected software, monthly income and expenses (from period totals; null when unknown). | FIRM_STAFF |
| GET | `/business/bookkeeping/clients` | The list: tabs (all, on track, needs attention, missing documents, overdue, not started, upcoming reports), client type, plan, software, status, report due, search (name, business, EIN only for roles that may see it), paging. | FIRM_STAFF |
| POST | `/business/bookkeeping/clients` | Enroll: creates or uses a Bookkeeping engagement and its profile. | FIRM_STAFF |
| GET, PATCH | `/business/bookkeeping/clients/:engagementId` | Workspace overview (profile, accounts, current period, tasks, documents, notes, upcoming reports) and settings (cadence, reviewer, close day, portal defaults, alerts). | FIRM_STAFF |
| POST | `.../:engagementId/(status\|assign\|pause\|resume\|archive)` | Row actions; every one writes `bookkeeping_activity`. | FIRM_STAFF (assign, pause, archive FIRM_MANAGERS) |
| GET, POST | `.../:engagementId/activity` | History and "Log Activity". | FIRM_STAFF |
| GET, POST, PATCH | `.../:engagementId/accounts` | Bank and card accounts (last digits only). | FIRM_STAFF |
| GET, POST | `.../:engagementId/connections` | Map an accounting company; `POST .../connections/:id/(sync\|disconnect\|reconnect)`, `GET .../:id/sync-runs`, `POST /business/bookkeeping/sync-all`. Sync is a stub until an integration exists. A failed sync never clears `last_successful_sync_at`. | FIRM_STAFF; connect and disconnect FIRM_MANAGERS |
| GET, POST | `.../:engagementId/periods` | Periods; `GET .../periods/:id` with checklist and reconciliations; `PATCH` for totals. | FIRM_STAFF |
| POST | `.../periods/:id/(start\|ready-for-review\|send-back\|approve\|close\|reopen)` | The close workflow; reopen takes a reason and raises the close version. A closed period and its steps are locked. | FIRM_STAFF; approve, close, reopen FIRM_MANAGERS |
| PATCH | `.../periods/:id/close-items/:itemId` | Complete a close step. | FIRM_STAFF |
| PUT, POST | `.../periods/:id/reconciliations/:accountId` | Save progress; `POST .../(ready-for-review\|approve\|reopen)`. Approval needs the difference within the tolerance. | FIRM_STAFF; approve FIRM_MANAGERS |
| GET, POST, PATCH | `.../:engagementId/reports` | Report work; `POST .../:id/(generate\|submit-for-review\|approve\|deliver)`; deliver needs the existing engagement report published. | FIRM_STAFF; approve FIRM_MANAGERS |
| GET, PATCH | `/business/bookkeeping/settings` | Firm defaults (cadence, close day, upcoming window, stale sync, tolerance, checklists, schedules). | read FIRM_STAFF, write FIRM_MANAGERS |

Existing and reusable: `POST /business/clients/:id/engagements` (makes the Bookkeeping engagement), `GET /business/engagements/:id` and its complete, cancel, reactivate actions, `GET /business/workspaces` (Bookkeeping and Tax Planning engagements), `business/workspaces/:engagementId/reports` and `business/reports/:id` (draft, publish, unpublish; the client sees the engagement report), tasks, `business/clients/:id/notes` (the Notes tab), the documents and document-request routes (View / Request Documents), `business/appointments`, `business/message-threads` (Communications), `business/dashboard`.

## Tax Planning

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/tax-planning/summary` | KPIs: active planning clients, strategies in progress, projected savings (sums of plan strategy estimates, with the estimate disclaimer). Upcoming planning appointments come from `business/appointments`. | FIRM_STAFF |
| GET, POST | `/business/tax-planning/plans` | Planning clients and plans (client, plan, year, status, staff, entity, paging); create with step 1 fields. | FIRM_STAFF |
| GET, PATCH | `/business/tax-planning/plans/:id` | Read and edit the five stages; save as draft is a PATCH. | FIRM_STAFF |
| PUT, POST, PATCH | `.../plans/:id/strategies` | Select and prioritise, add a custom strategy, override an estimate (reason; FIRM_MANAGERS), recalculate. | FIRM_STAFF |
| PUT | `.../plans/:id/inputs` | Financial overview figures (historical, projected, adjustment with note). | FIRM_STAFF |
| POST | `.../plans/:id/(finalize\|generate\|send\|archive\|close)` | Finalize, generate and send each write a `tax_plan_versions` snapshot; send is external delivery. | FIRM_MANAGERS for send |
| GET | `.../plans/:id/versions` | Snapshots. | FIRM_STAFF |
| POST, DELETE | `.../plans/:id/documents` | Attach one of the client's documents. | FIRM_STAFF |
| GET, POST, PATCH | `/business/tax-planning/strategies[/:id]` | The strategy library (active, archived). | read FIRM_STAFF, write FIRM_MANAGERS |
| GET | `/business/tax-planning/opportunities` | The queue (status, priority, client, strategy) and the top-opportunities aggregate (clients and estimated savings per strategy). | FIRM_STAFF |
| GET, POST, PATCH | `.../opportunities[/:id]` | Detail with previous and next in the queue, manual create, edit. | FIRM_STAFF |
| POST | `.../opportunities/:id/(add-to-plan\|assign\|schedule-discussion\|not-applicable\|dismiss\|implement)` | Dispositions; each writes `tax_opportunity_events`; not applicable and dismiss take a reason. `POST .../reopen` and `close` are FIRM_MANAGERS. | FIRM_STAFF |
| GET | `.../opportunities/:id/events` | History. | FIRM_STAFF |
| GET, POST | `/business/tax-planning/scenarios` | Tax Savings Calculator: calculate and save; `POST .../:id/save-to-plan` attaches the snapshot (frozen). | FIRM_STAFF |

The screening job (re-evaluates clients, writes opportunities and `SCREENED` events) is internal. The Tax Calendar tab reads the published compliance calendar entries and deadlines (no new table); Resources reuse `content_items` and `business/content`; Send Client Resource and Schedule a Planning Consultation reuse messages and appointments. Existing and reusable: `business/workspaces` reports of kind ESTIMATE and PROJECTION, documents, tasks.
