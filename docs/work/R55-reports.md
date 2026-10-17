# R55: Reports

Notes for the Reports contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-integrations.md`, `R55-templates-api.md`.

## Steps

- [ ] 7. Reports. 7a [x]: contract (`packages/types/src/reports/`, `createReportsClient` as `api.reports`). 7b: API.

## Progress

- 2026-10-18: step 7a, the Reports contract: dashboard (global range, KPI cards, category cards, quick reports, recent and scheduled reports, insights), the catalog of data sources and fields for the builder, lookups for the selectors, one run endpoint for quick reports, saved reports and unsaved definitions (detail view, preview and Run Report), recent reports, saved reports (save, save as, change with etag, archive, favourites, sharing), exports (CSV, XLSX, PDF as a run to poll), scheduled reports (create, change, pause, resume, run now, duplicate, delete) and the firm's metric settings.

### Reports (step 7)

1. **One reporting layer.** KPI cards, detail views, the builder's preview, exports and schedules all run a report definition through `POST /business/reports/run` (an export is the same request in a format), so numbers reconcile. Quick reports are system definitions in code (`ReportSystemKey`); saved reports are `report_definitions`.
2. **Definitions, not results.** A saved report keeps the data source, ordered columns, filters (AND or OR, one level of inner groups), grouping, sort, a rolling or fixed date rule and display settings. A run keeps the definition it ran with (`report_runs.definition_snapshot`).
3. **Data sources and fields are data** (`GET /reports/sources`), filtered to what the caller may see; the builder does not hard-code them. The API checks every field, operator and grouping against it (400 `INVALID_DEFINITION`, 403 `FIELD_NOT_ALLOWED`). The database also refuses columns that name a secret.
4. **Date presets** are the dropdown's nine (`today` to `last_year`); `DB ReportDefinition.datePreset` is a free string, so the API maps them. A recurring schedule is always rolling. Custom range is a fixed spec.
5. **Comparison** is `PREVIOUS_PERIOD` or `SAME_PERIOD_LAST_YEAR`; where a source or range cannot be compared the API turns it off and says why in `notices`.
6. **Money** is in cents; "Total Revenue" follows the firm's `RevenueBasis` (COLLECTED or INVOICED) from `report_settings`, labelled on the KPI (`definition`).
7. **Exports** are runs (`kind EXPORT`): `POST /reports/exports` answers a run, `GET /reports/runs/:id` its status, `GET /reports/runs/:id/download` a 5-minute link (the documents' `DownloadLink`). Large exports are queued; export needs the Export capability (403 `EXPORT_NOT_ALLOWED`) and exports of financial or client data are audited (`report_runs.sensitive`). Print is the browser's.
8. **Schedules** run server-side in the firm's time zone; recipients are firm members or approved outside addresses and must be allowed to see the data (409 `RECIPIENT_NOT_ALLOWED`). Save & Schedule is one request (`target.kind NEW`), so nothing is scheduled when saving fails. Delete Schedule stops future runs and keeps history.
9. **Roles.** Everyone with the REPORTS view runs reports; Team Productivity and money reports are further gated (`allowed` on the category card). Saving, scheduling and exporting need Create, Edit or Manage; only a report's owner, an Owner or an Admin changes a saved report or schedule.
10. **Insights** are deterministic sentences from the numbers, each with the metric, the threshold, the period and the report or module list it opens; none is shown when data is missing or stale.
11. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`. A mock is a frontend task.
