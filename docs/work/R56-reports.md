# R56: Reports module (firm workspace)

The firm Reports screens on the R55 contract (`api.reports`, `createReportsClient`, merged in #738) with a mock written here. Designs: `docs/mockups/firm-workspace/reports/source/` (`reports-page.jpg`, `report-detail-view-report.jpg`, `custom-report-builder-1.jpg`) and the developer guide docx. Branch `rasel/R56-reports` from `origin/main`. Web port 3560. The Super Admin "Reports & Analytics" pages are a different module (Arfan) and are not touched.

## Owned paths

`apps/web/src/app/firm/(workspace)/reports/**` (the placeholders of R1 are replaced), `apps/web/src/mocks/reports.ts` (new mock), the `reports` entry in `apps/web/src/lib/api.ts` (mock switch), `apps/web/e2e/mock/r56-reports.spec.ts`, `r56-screenshots/rp-*`.

## Routes

| Route                       | What                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reports`                  | Dashboard: date range and comparison, four KPI cards, nine category cards with a ring, Create Custom Report, Quick Reports, Recent Reports, Scheduled Reports (on/off switch) and Insights & Opportunities                           |
| `/reports/[reportId]`       | One report (a quick report by key, or a saved one by id): Date Range, Compare To, Client Type, Service Type, More Filters, KPIs, chart, breakdown ring, table with search, columns, sort and paging, totals; Export (CSV, XLSX, PDF), Print, Save Report, Schedule Report, Quick Date Range, Report Settings, Insights |
| `/reports/builder`          | Create Custom Report in four steps (type and data, columns, filters, group and sort) with a live preview, Run Report, Save Report and Save & Schedule                                                                                 |
| `/reports/library`          | Recent, Saved (favourite, duplicate, archive) and Scheduled reports (run now, pause, resume, duplicate, delete)                                                                                                                       |

## Run it

| State           | Command                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=all NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=reports`                                                       |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me`                                                                                |

## Steps

- [x] 1. Mock `reports` (every call of the contract; nine data sources of made-up rows run by one engine)
- [x] 2. Dashboard
- [x] 3. Report detail with save and schedule
- [x] 4. Custom report builder and library
- [x] 5. Mock spec (7 tests), three states, 375 px

## Needs from others

- **Report Actions › Export** downloads nothing in the mock: it answers a ready run and shows its file name; the real API returns a link to download.
- **Builder column order** is changed with up and down buttons; the design drags the rows (the kit has no drag-and-drop list).
- **Builder filters** are added with Add Filter (field, condition, value); the design's fixed Service Type, Client Type, Payment Status, Client and Team Member selects are the same fields offered by the data source.
- **Category card charts** are rings of the report's breakdown; the design draws a mix of bars, rings and a funnel. The contract gives one breakdown per category.
- **Chart types**: Automatic, Column, Line and Area are offered; the screen draws every one as columns (the kit has no line chart).
- **Money rings** show whole dollars.
- **Print** is the browser's print.

## Progress log

- 2026-10-18: Reports built on the R55 contract with a new mock; 7-test spec passes; screenshots committed.
