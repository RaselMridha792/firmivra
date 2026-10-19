# R55: Super Admin Reports & Analytics

Contract: `packages/types/src/admin-reports/` (`api.adminReports`). API: `apps/api/src/admin-reports/` (next PR). Design: `docs/mockups/super-admin/reports/` (dashboard, Firm Report Detail, Custom Report Builder, developer instructions). Tables: R0 stage B9 (`docs/work/R0-stage-b9-reports.md`) and the platform's own.

## Steps

- [x] 1. Contract: overview, revenue, users, feature usage, support, firms list and Firm Report Detail, the builder (fields, run, CSV export), saved reports.
- [ ] 2. API, with unit, e2e and admin-scope WRITES cases.

## Decisions (contract)

1. Every figure is live; a figure with no source is null (the screen shows "Not available"), never zero or invented: platform uptime (no monitoring yet), active users, per-firm users, documents, leads and feature usage until the daily rollup job fills `platform_firm_metrics_daily` and `platform_feature_usage_daily` (`hasData` / `hasActivityData` say so).
2. Money is integer cents from billing records (payments received, refunds, overdue invoices, recurring billing for MRR), never from plan prices.
3. "vs. previous" compares with the range of equal length just before; the default range is the last 30 days.
4. Export is CSV built in the answer (title, time, period and filters on top; at most 10,000 rows), audited. Excel and PDF need writers the API does not have; `platform_export_jobs` waits for an export worker.
5. Firm location is null: no admin-readable column (the application's address only).

## Needs from others

- **The daily rollup job** (the API or R1): platform scope, reading each firm in its own scope, into `platform_firm_metrics_daily` and `platform_feature_usage_daily`. Until it runs, the per-firm and feature figures are empty.
- **Uptime monitoring** for the Platform Uptime card.
- **R0:** a platform column for a firm's city, state and country, if the Firms filter by location is wanted.
- **XLSX and PDF writers** (and the export worker) for Export to Excel and Export to PDF.
