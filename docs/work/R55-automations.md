# R55: Automations

Notes for the Automations contract and API. Other notes: `R55-handoff.md`, `R55-templates-api.md`.

## Steps

- [ ] 10. Automations. 10a [x]: contract (`packages/types/src/automations/`, `createAutomationsClient` as `api.automations`). 10b [x]: API with the run engine (`apps/api/src/automations/`).

## Progress

- 2026-10-18: step 10a, the Automations contract: overview (KPIs, health, recent activity), the catalog (modules, events with timing and condition fields, action types with their settings, variables), rules (list, create as draft or active, meta change, a new version for every saved definition, activate, pause with a choice for waiting actions, duplicate, archive), validate and test as dry runs with checks, rule templates (save, import and export, use, starters), logs (tabs, summary, run details with the action log and the rule snapshot, re-run, export) and settings.

### Automations (step 10)

1. **Data-driven**: events, condition fields and action types come from `GET /automations/catalog`, so a new event or action is data. The 17 module categories are the database's `AutomationModule`. Action `config` is validated by the API against the action type's fields (400 `INVALID_DEFINITION`).
2. **Versions.** A rule is the switch and its identity; its trigger, conditions, ordered actions and settings are immutable `automation_rule_versions` (`PUT .../definition` makes a new one). A run records its version, so editing never rewrites history. A pending run keeps the version it was made for.
3. **Idempotency and loops.** A run's id is stable and unique per (rule, `source_event_key`); each action has an idempotency key (rule, record, occurrence, action id) and one that succeeded is never run again (the database refuses to move it back). Loops are blocked at activation (`LOOP_RISK`) and cut at runtime by `correlationId`, `depth` and the firm's `maxDepth`.
4. **Message templates.** A send action names a message template by id in `config.templateId`; the Templates API counts a template as used by an automation when an ACTIVE rule's current version contains its id, so keep the id in `actions` as plain text. The checks warn on a missing or inactive template.
5. **Dry runs** (`validate`, `test`) create nothing and send nothing; they return the matching count, a sample the caller may see, the planned actions in order and the checks (blocking or warning). A dry run is not written as a production run.
6. **Re-run** retries only FAILED, retryable actions of the run; a succeeded action is never repeated; it needs a reason (audited), a confirmation if the rule changed since, and Automation Admin to force a run whose condition no longer matches. An inactive integration pauses retries. An invalid contact is a non-retryable failure.
7. **Client messages** respect consent, contact data, the settings' and the rule's quiet hours and the provider's limits; Communications owns delivery. Logs hold ids and safe codes only.
8. **Schema gaps (no schema change made):**
   - **Starter rule templates** (Popular Automation Templates) have no code table: `POST .../templates/starters` installs them as `automation_templates` rows (idempotent by name per firm, since the table has no starter key). A key column would make it exact.
   - **Failure alerts** use `automation_settings.failure_alert_user_ids` and the rule's `notifyOnFailureUserIds` in the definition's settings; there is no per-rule recipients table.
   - **Calendar** ("add to calendar") is a flag in the definition's settings; what it does belongs to Appointments.
9. **Roles.** Everyone with the AUTOMATIONS view reads rules and logs; creating, editing, activating, testing, retrying, exporting and settings need Create, Edit or Manage; Automation Admin forces a run. Automation never bypasses a source module's permissions: it acts as the rule's owner with the owner's module permissions.
10. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`.

## Progress (API)

- 2026-10-18: step 10b, the Automations API under `/api/v1/business/automations` (`@Access('AUTOMATIONS')`): catalog, overview, rules (versions, activation checks, pause, copy, archive), dry runs, templates (starters, import and export), the run engine and its job, the logs (list, summary, details, re-run, export) and settings.

### Automations API (step 10b)

11. **What is built in the catalog.** Five events (new client, invoice overdue, deadline approaching, task overdue, appointment coming up) and three actions (create task, send client message, add client note), each with its loader or executor. They call the other modules' own services (`TaskWriteService`, `MessagesService`, `NotesService`) as the rule's owner, so the owner's module permissions apply. A new event is an entry in `catalog.ts` and a loader in `matching.ts`; a new action an entry and a case in `engine.service.ts`. The contract's other modules (Leads, Payroll, Documents...) have no events yet.
12. **Permissions.** Owner and Admin may always. The grid roles: Create, Edit or Manage write (create, change, test, retry, export route also needs the method's capability), Approve or Manage activate, Export or Manage export, Manage is Automation Admin (settings, forcing a run). The legacy Staff role reads (runs of its own clients and those with none) and cannot write. A rule's owner is an active Owner or Admin.
13. **Checks.** Structure (unknown event, field, operator, action, setting, merge field, a dependency that is not an earlier action) is 400 `INVALID_DEFINITION` with paths, always. What only blocks activation (409 `NOT_READY`, and a new version of an active rule): a missing required setting, a missing message template, an owner who is no longer a member or may not act in the module, an assignee who is not a member, a rule past its date, a loop or a chain deeper than the firm's limit. An inactive template, a client with no email, no matches and a high count are warnings. Loops are found from what actions bring about (a task due within a day brings `task.overdue`).
14. **Runs.** The job (`AutomationJob`, every 5 minutes, `AUTOMATION_JOBS=on|off`, advisory lock) scans each active rule, starts one run per (rule, event, record, occurrence), and runs the actions in order. The run id is stable (unique per rule and `source_event_key`); an action's idempotency key is the rule, record, occurrence and action id; the database refuses to move a succeeded action back. A delayed action waits PENDING until its time; an action that depends on a failed one is SKIPPED; a client message waits out the quiet hours (the rule's, else the firm's); the duplicate window and the safety threshold (nothing runs, audited) apply. A rule past its date is paused. Immediate "new client" runs only for clients created after the rule's version was saved. Dry runs write nothing.
15. **Failures.** A failure a retry cannot fix (no email, an inactive template, the module refused, the owner gone) is `retryable: false` with a safe code; anything else is retryable. A re-run needs a reason and the Write capability; retries only failed retryable actions; asks `confirmRuleChanged` when the rule changed; when the record no longer matches, its failed actions are skipped unless an Automation Admin forces it. Logs hold ids, safe codes and short fixed sentences, never client data.
16. **Export.** CSV (ids and safe columns only) under `tenant/<business>/automations/exports/`, up to 50,000 rows (`TOO_MANY_ROWS`), audited; a file store error is 503.
17. **Templates.** Four starters installed once by name. A template keeps no choice of one firm's (message template, person), no secret-looking value and no record id (400). Using one makes a DRAFT rule; one that needs an integration the firm has not connected is 409 `TEMPLATE_UNAVAILABLE`.
18. **Not built / needs others.** No schema change. Open follow-ups: failure alerts to the people in the settings are not sent yet (no notifier is wired in; the run and the audit row exist); log retention is stored but nothing purges yet; `addToCalendar` is only kept; actions stuck RUNNING after a crash are not recovered; the overview's time saved counts successful actions times the setting. **Infra:** the API task role needs `s3:PutObject` on `tenant/*/automations/*` (with the Reports ask).

