# R55: Tax Returns screens (firm workspace)

Design and guide: `docs/mockups/firm-workspace/tax-return/source/` (Frame 1 `tax-returns.jpg`, Frame 2 `client-tax-return-workspace.jpg`, Frame 3 `review-e-file-and-filing-status.jpg`, the developer guide docx). Contract: `packages/types/src/tax-returns/workspace.ts` (#822). API: `apps/api/src/tax-returns/` (#826, #827). Mock: `apps/web/src/mocks/tax-return-workspace.ts` (`api.taxReturnWorkspace`).

## Routes

| Route | Frame | PR |
| --- | --- | --- |
| `/tax-returns` | 1. Tax Returns Overview: tax-type tabs, seven KPI cards (filters), filters, table, row menu, Create New Return, Tax Season Progress, Quick Actions, Helpful Links | list PR |
| `/tax-returns/{id}` (`?tab=`) | 2. Client Tax Return Workspace: header (year, return and status switches), six cards, nine tabs, action bar | workspace PR |
| `/tax-returns/{id}/review` | 3. Review, E-File & Filing Status: workflow, details, federal and state summary, notes, validation, approvals, documents, e-file, signatures, next steps | workspace PR |

The tabs are one dataset (`tab` on `GET /business/tax-returns`), as the guide asks. The sidebar item and the dashboard's two return KPIs open `/tax-returns` (no longer `/modules/tax-returns`).

## Decisions (list)

1. KPI cards follow the guide (Total, In Preparation, Waiting on Client, Ready for Review/File, Transmitted, Accepted, Rejected), not the frame's six. Each one filters the table by its status, except Ready for Review/File (three statuses; the list takes one).
2. The cards and Tax Season Progress show the season in progress (last year's returns), or the chosen Tax Year. "Completed" is Accepted plus Closed.
3. Row menu: every action of the guide's section 7. Delete is Owner and Admin only, and only for a return never filed (R10's delete); the API refuses the rest. Print / Export List is Owner and Admin (EXPORT).
4. Import Return and Bulk Upload Returns say that no tax-software integration is connected and link to Integrations: there is no import endpoint.
5. Helpful Links are Firmivra pages and public agency sites, the same for every firm.

## Decisions (workspace and review)

1. The tabs share panels with the Review page (`_components/review-panels.tsx`, `work-panels.tsx`); only the open tab loads.
2. Document Checklist is the client's document requests (Requested, Received, Reviewed, Replace Needed, Not Needed); the return's own files are its linked documents with their role.
3. Notes are the client's internal notes (the return's engagement's when it has one): there is no return-notes table.
4. Extension shows "Form on file" when an EXTENSION document is linked: there is no extension record per jurisdiction yet.
5. Firmivra records transmissions and acknowledgments (Record Transmission, Record Acknowledgment, Record Paper Filing); the design's "Transmit to IRS & State" becomes Record Transmission, since nothing transmits.
6. Add Task creates the task for the client (with the return's engagement); Upload and Request Documents open the client's Documents.

## Needs from others

- **R0 (schema):** firm-configurable helpful links (a table); an import log for Import Return and Bulk Upload (`tax_returns.import_source` exists; no import run table); return-scoped notes; an extension record per jurisdiction (original and extended deadlines, status), which the guide's section 20 asks for.
- **R56 / page owners:** Send Message, Schedule Appointment, Add Task and Request Documents open their pages without the client or return prefilled: those pages take no `clientId` yet.
