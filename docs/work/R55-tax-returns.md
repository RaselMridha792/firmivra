# R55: Tax Returns screens (firm workspace)

Design and guide: `docs/mockups/firm-workspace/tax-return/source/` (Frame 1 `tax-returns.jpg`, Frame 2 `client-tax-return-workspace.jpg`, Frame 3 `review-e-file-and-filing-status.jpg`, the developer guide docx). Contract: `packages/types/src/tax-returns/workspace.ts` (#822). API: `apps/api/src/tax-returns/` (#826, #827). Mock: `apps/web/src/mocks/tax-return-workspace.ts` (`api.taxReturnWorkspace`).

## Routes

| Route | Frame | PR |
| --- | --- | --- |
| `/tax-returns` | 1. Tax Returns Overview: tax-type tabs, seven KPI cards (filters), filters, table, row menu, Create New Return, Tax Season Progress, Quick Actions, Helpful Links | list PR |
| `/tax-returns/{id}` | 2. Client Tax Return Workspace: header, deadline and people cards, the nine tabs | next PR (a header-only page until then) |
| `/tax-returns/{id}/review` | 3. Review, E-File & Filing Status | after it |

The tabs are one dataset (`tab` on `GET /business/tax-returns`), as the guide asks. The sidebar item and the dashboard's two return KPIs open `/tax-returns` (no longer `/modules/tax-returns`).

## Decisions (list)

1. KPI cards follow the guide (Total, In Preparation, Waiting on Client, Ready for Review/File, Transmitted, Accepted, Rejected), not the frame's six. Each one filters the table by its status, except Ready for Review/File (three statuses; the list takes one).
2. The cards and Tax Season Progress show the season in progress (last year's returns), or the chosen Tax Year. "Completed" is Accepted plus Closed.
3. Row menu: every action of the guide's section 7. Delete is Owner and Admin only, and only for a return never filed (R10's delete); the API refuses the rest. Print / Export List is Owner and Admin (EXPORT).
4. Import Return and Bulk Upload Returns say that no tax-software integration is connected and link to Integrations: there is no import endpoint.
5. Helpful Links are Firmivra pages and public agency sites, the same for every firm.

## Needs from others

- **R0 (schema):** firm-configurable helpful links (a table), and an import log for Import Return and Bulk Upload (`tax_returns.import_source` exists; no import run table).
- **R56 / page owners:** Send Message, Schedule Appointment, Add Task and Request Documents open their pages without the client or return prefilled: those pages take no `clientId` yet.
