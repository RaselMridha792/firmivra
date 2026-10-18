# Super Admin stage B9: Reports & Analytics (contract note)

Migration `20261017230000_r0_platform_reports`. This note is for the API session building the Super
Admin Reports & Analytics module (spec 16): the dashboard tabs, the Firms list, Firm Report Detail,
and the Custom Report Builder with its saved reports.

**Where every figure comes from.** Admin scope never reads a firm's own tables, so cross-firm and
per-firm figures come from platform tables or rollups:

| Report area | Read from |
| --- | --- |
| Firms, statuses, plans, applications | `businesses` (platform fields), `firm_applications`, `platform_firm_subscriptions`, `platform_plans` |
| Revenue: MRR, new, upgrades, downgrades, cancellations, refunds, failed payments, overdue, by plan or firm | B3 billing (`platform_invoices`, `platform_payments`, `platform_refunds`, `platform_subscription_changes`, ...). **Never estimated from plan prices** |
| Support: totals, by status, priority and firm; response and resolution times | B2 `support_tickets` and its history |
| Users, logins, documents, leads, e-signature (per firm, over time) | `platform_firm_metrics_daily` (new) |
| Feature usage by firm, plan and date | `platform_feature_usage_daily` (new) |
| Recent platform activity | `audit_logs` (the team reads every row since B4) and B1 notifications |
| Integration adoption | B8 `platform_integration_usage_daily` |

Platform uptime comes from monitoring, not the database. Show N/A until it is wired.

## Tables

**`platform_saved_reports`.** A saved custom report holds its **configuration only**, never its
data, so it runs against current data:
- `report_type`: `FIRMS`, `USERS`, `SUBSCRIPTIONS_REVENUE`, `SUPPORT`, `FEATURE_USAGE`,
  `ACTIVITY_LOG`
- `fields`: the selected columns in order, as field keys from the API's catalogue for that type,
  e.g. `firm.name`, `firm.monthly_revenue`
- `filters` (JSON object), `date_range` (`{"preset": "LAST_30_DAYS"}` or
  `{"from": "2026-10-01", "to": "2026-10-14"}`), `sort` (JSON array)
- `shared`, `duplicated_from_id`, `last_run_at`

Ownership and sharing:
- A report is private to its owner unless shared.
- Shared reports are readable and runnable by the team; recording a run sets `last_run_at`, which
  the database stamps.
- Only the owner edits, renames or deletes a report, and the owner never changes.
- Names are unique per owner.
- Duplicate means a new report with `duplicated_from_id`.

**`platform_feature_usage_daily`.** One row per day, firm and feature key:
- `events`: the actual uses
- `active_users`: distinct users who used the feature
- feature keys look like `documents.generate`, `esign.send`, `crm.lead_created`,
  `templates.used`, `billing.invoice_sent`, `communications.sent`

It measures actual use, not whether a feature is on (spec 16, section 9). Usage percentage is the
share of the firm's active users, or of active firms, as the page shows.

**`platform_firm_metrics_daily`.** One row per day and firm: total, active and new users, logins,
total clients, documents created and completed, active documents, leads created, e-signature
requests sent and completed, and the last login.

**Both rollups:**
- Only the platform's daily job writes them (an upsert, platform scope). It reads each firm's own
  tables in that firm's scope.
- The team reads them; no firm scope does.
- They go with the firm's data when a firm is deleted.
- Rows are never deleted by the app; a re-run of the job rewrites the day.

## Rules every report must follow (spec 16)

- **Period comparison:** compare the chosen period with the immediately preceding period of the
  same length (Oct 1 to 14 against Sep 17 to 30).
- **Server-side work:** filter, sort, paginate and aggregate on the server; never load whole tables
  into the browser.
- **Exports** (CSV, Excel, PDF) use **B1's `platform_export_jobs`**, module `REPORTS`. Each export
  carries:
  - the same dataset, selected columns and filters as the preview
  - the report title, the generation time and the period
  - no hidden or unselected columns
  - an audit row, written for every export
- **Sensitive fields:** contact email and phone appear only for team members whose permissions
  allow them (the API's `reports.*` keys).

## Endpoints the screens need

All under `/api/v1/admin/reports`.
- **Dashboard and tabs:**
  - `GET /overview?from=&to=`: cards with change against the previous period, firm growth, revenue
    trend, plan distribution, feature usage, recent activity, top firms
  - `GET /revenue`, `GET /users`, `GET /feature-usage`, `GET /support` (same period parameters)
- **Firms:** `GET /firms` (search, plan, status, location, date joined; paging; export through an
  export job) and `GET /firms/:businessId` (the Firm Report Detail tabs).
- **Builder:**
  - `GET /builder/fields?type=` (the field catalogue and filters per type)
  - `POST /builder/run` (a preview with paging and total)
  - `POST /builder/export` (an export job)
- **Saved reports:** `GET /saved`, `POST /saved`, `PATCH`/`DELETE /saved/:id`,
  `POST /saved/:id/run`, `POST /saved/:id/duplicate`.

## Needs from others

- The API or R1: the daily rollup job (per-firm feature usage and metrics).
- Monitoring for platform uptime.

## Not in this stage

- Demo rows (Stage 5): a few months of rollups for the demo firms, so the charts have history.
