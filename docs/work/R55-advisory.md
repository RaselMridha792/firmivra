# R55: Business Advisory & Development

Notes for the Business Advisory contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-integrations.md`, `R55-reports.md`, `R55-tax-planning.md`, `R55-templates-api.md`.

## Steps

- [ ] 9. Business Advisory & Development. 9a [x]: contract (`packages/types/src/advisory/`, `createAdvisoryClient` as `api.advisory`). 9b: API.

## Progress

- 2026-10-18: step 9a, the Business Advisory contract: overview (four KPIs, recent advisory clients, goals, meetings, resources, service options), the Advisory Clients tab and Client Advisory Detail (KPIs, Business Health Score with its factors, workstreams, counts, activity), business plans in five stages with versions, finalize and send, financial snapshots and the Financial Analysis tab, goals and milestones, recommendations and action items (Action Plans), meetings, resources and the firm's settings (health formula, stale days).

### Business Advisory (step 9)

1. **Plan documents are validated here.** `advisory_plans.profile`, `.assessment` and `.strategy` are JSON the API validates with the zod schemas `AdvisoryPlanProfile`, `AdvisoryPlanAssessment` and `AdvisoryPlanStrategy` (strict, every field optional so a draft saves at any step). The EIN is not in the profile: only its last 4 digits, masked, on the client detail and only for those who may see it. A change merges the three documents at their top-level keys.
2. **Services come from Services & Pricing** (`GET /advisory/services`): a firm enables, renames, prices and packages them without code. One Primary workstream per client (making another primary demotes the old one); a declined service stays as DECLINED. Services that are regulated specialist needs are `referralOnly` and tracked as referral or project steps.
3. **The Business Health Score is explainable**: the API calculates it from the firm's formula (`advisory_settings.health_formula`, factor weights summing to 100), stores the factors and time on the advisory client, and the contract returns the factors, each factor's value (null when its data is missing, and left out of the score) and whether the data is stale. No opaque score.
4. **Versions.** Finalizing keeps an immutable `advisory_plan_versions` row with the profile, assessment, strategy, goals, recommendations, workstreams and financial assumptions and the source-data date; sending records who, when and how (`PORTAL`, `EMAIL`, `DOWNLOAD`). Only client-visible recommendations and action items are in what is sent.
5. **Financials** are insert-only snapshots with source and as-of date; a correction is a new row. A manual override of figures that came from a source needs a reason and the permission (403 `OVERRIDE_NOT_ALLOWED`), keeps the earlier row, and is audited. Net profit must equal revenue minus expenses when all three are given (409 `INCONSISTENT_FIGURES`). Figures are `null` without "View financial analysis".
6. **Statuses** follow Octavia's lists: plan (Draft, In Review, Finalized, Sent, In Progress, Completed, Archived; Finalized and Sent only through their routes), goal (Not Started to Cancelled; Overdue is also worked out when read from a past target date), recommendation and service.
7. **Roles and reach.** Owner and Admin reach every advisory client; Staff only the clients assigned to them (404 otherwise); the grid's capabilities decide plans, goals, recommendations, financial analysis, overrides, services, sending and Advisory Admin (settings).
8. **Schema gaps (no schema change made):**
   - **Resource library** has no table (formation, EIN, branding, website, banking, funding, planning, research, financial, growth, education; client-facing flag). The contract has read and send only; the first API serves an approved catalog from code (`AdvisoryResourceKey`). Add and archive need a table.
   - **Notes, documents, meetings and the client-portal tab** are not new tables: they use the client's BUSINESS_DEVELOPMENT engagement (notes, documents, appointments tagged Business Advisory) and the `clientVisible` flags on recommendations and action items. `GET /advisory/meetings` reads the appointments; scheduling is in Appointments.
   - **Advisory reports** use the Reports module; `ReportCategory` has `ADVISORY`.
   - **Document types** for advisory documents (business plan, financials, funding, formation, branding, website deliverables, banking checklist, licenses) are the Documents module's categories; none is added here.
9. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`. A mock is a frontend task.
