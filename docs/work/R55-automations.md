# R55: Automations

Notes for the Automations contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-templates-api.md`.

## Steps

- [ ] 10. Automations. 10a [x]: contract (`packages/types/src/automations/`, `createAutomationsClient` as `api.automations`). 10b: API (with the run engine).

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
