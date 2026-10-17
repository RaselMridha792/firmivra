# R55: Tax Planning & Strategy

Notes for the Tax Planning contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-integrations.md`, `R55-reports.md`, `R55-templates-api.md`.

## Steps

- [ ] 8. Tax Planning & Strategy. 8a [x]: contract (`packages/types/src/tax-planning/`, `createTaxPlanningClient` as `api.taxPlanning`). 8b: API.

## Progress

- 2026-10-18: step 8a, the Tax Planning contract: overview (four KPIs, recent planning clients, top opportunities, deadlines, resources), the Clients tab, plans (create as a draft, change with etag, financial inputs, strategies with estimates and authorized overrides, documents, status, finalize and send with immutable version snapshots), the strategy library, the opportunity queue and Planning Opportunity Details with explicit review actions, the screening run, the Tax Savings Calculator with saved scenarios, the Tax Calendar and Resources.

### Tax Planning (step 8)

1. **Estimates are estimates.** Every estimate carries its tax year, when it was calculated and its basis; an unavailable one is `null` with a reason, never invented; an override needs the permission and a reason and keeps the model's figure beside it. The disclaimer text is `TAX_PLANNING_DISCLAIMER` and comes with plans, opportunities and calculator results.
2. **Opportunities are not recommendations.** Reading one never changes it; every disposition is an explicit action (`POST .../actions`), audited with its reason; `MARK_NOT_APPLICABLE` and `DISMISS` need a reason and may suppress re-screening until a date; nothing implements a strategy or changes a tax return. Duplicates (one open opportunity per client, library strategy and year) are 409 `DUPLICATE_OPPORTUNITY`.
3. **Versions.** Finalizing and sending keep an insert-only snapshot (`tax_plan_versions`): strategy names, priorities, estimates, overrides, assumptions, the inputs and the age of the data. Later edits never rewrite what was delivered. Only the client notes are sent, never the internal ones.
4. **Overlapping savings** are not double-counted: the plan total is the model's, and `overlapNotes` says what was applied. The overlap rules are the API's to define and document.
5. **Roles and reach.** Owner and Admin reach every client; Staff only their assigned clients (404 otherwise). The grid's capabilities decide Create/Edit plans, Review opportunities, Manage strategies, Override estimates, Send plans and resources, View financial inputs (the plan's `inputs` and an opportunity's `clientDataUsed` are `null` without it) and Planning Admin (the screening run).
6. **Schema gaps (no schema change made):**
   - **Resources** have no table (guides, checklists, videos, client-facing flag, add and archive). The contract has read and send only; the first API serves an approved catalog from code (`PlanningResourceKey`). Add and archive need a table.
   - **Custom milestones** on the Tax Calendar have no table either. The calendar reads tax deadlines (Compliance & Deadlines) and has no create route.
   - **Planning reports** use the Reports module; `ReportCategory` has no planning value (ADVISORY exists), so the planning reports share TAX or ADVISORY until a value is added.
   - **Tax tables** for the calculator and the screening rules live in code, per tax year.
7. **Documents** are uploaded in the Documents module for the plan's client (`document_id`), then linked with `POST .../plans/:id/documents`; only the client's own documents can be linked (409 `DOCUMENT_NOT_ALLOWED`).
8. **Opportunity navigation**: `GET .../opportunities/:id` takes the queue's filters and returns `previousId` and `nextId`, so Previous and Next keep the review state.
9. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`. A mock is a frontend task.
