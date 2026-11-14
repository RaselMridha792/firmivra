# Bookkeeping: Review 2 QA map

This file maps every red and yellow row of Octavia's Bookkeeping Review 2 to the PR that fixed it and the test that covers it, or marks it as a **GAP**. It covers both her checklist (Nov 12, 2026) and the developer review. Both reports are kept privately, outside the repo.

Rows are named by their headings only; the report's text is not copied here. Each GAP has a plan and a status.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- API unit tests: `apps/api/test/unit/`
- Mock specs: `apps/web/e2e/mock/`
- Web unit tests: next to the code (`*.test.ts`)
- Isolation: `apps/api/test/isolation/cases/`

## Checklist: Needs correction (red)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| R01 approved: discrepancy note beside the difference | Done | #1408 (schema), #1424 | `bookkeeping.e2e` "keeps a note on the difference with who wrote it and when, for the reviewer" |
| D01 D02: dashboard cohorts and counts | Done | #1394 | `bookkeeping.e2e` "the Active cohort leaves a paused client out, and the chart counts the cohort shown"; `r56-cohorts` "Bookkeeping: the cohort cards and the status chart filter the list" |
| D03: date filter refresh | Done | #1394 | `r56-module-fixes` "BK-D03: a custom Report Due period filters the list, start no later than end" |
| N02 N03: Documents scope (client and service) | Done | #1399 | `r56-review2-bookkeeping` "View All keeps the client and service…" |
| N02 N03: recent document inline preview | Done | #1399, #1401 | `r56-review2-bookkeeping` "a recent document opens in a quick view on the workspace…" |
| N02: Documents scope by period | **GAP G2** | Decision needed (see GAPs) | — |
| N04 update: note fields and route | Done | #1408 (schema), #1424 | `notes.e2e` "keeps a note's type and the record it is about, and every note stays internal"; `r56-bookkeeping-transactions` "Add Note opens in place, internal and on this service" |
| N05 update: recurrence context and clickable relations | Done | #1379 | `tasks-work.e2e` "names the engagement's own workspace, so Related To can open it"; `new-task-href.test` |
| N05 original: task service and origin return | Done | #1379 | `new-task-href.test`; `r56-service-tasks` "Bookkeeping: Create Task carries the current period into the details" |
| N08: Categorize opens Transactions; the tab is kept | Done | #1379 | `url-tab.test`; `r56-review2-bookkeeping` "… Categorize opens Transactions, and the tab survives a reload" |
| R01c update: statement required before approval | Done | #1402 | `bookkeeping.e2e` "needs the statement attached before approval, apart from the zero difference"; `recon-rules.test`; `r56-bookkeeping-reconciliation` |
| RP01 RP03: Refund and Settlement reports | Done | #1430 | `bookkeeping.e2e` BK-RPT part 2 (Refund and Settlement figures, a generated version); `bookkeeping-report-figures-more.test` "Refund Report…", "Settlement Report…" |
| RP01 RP03: no-data totals, CSV context, readable headings | Done | #1413 | `bookkeeping-report-figures.test` "says whose figures they are, and leaves totals blank when nothing is recorded" |
| E01b: package from Services & Pricing | Done | #1408 (schema), #1424 | `bookkeeping-terms.e2e` "takes the package from Services & Pricing and keeps its name"; isolation `bookkeeping-terms` (catalogServiceId) |
| E01b: scoped billing link | Done | #1379 | `r56-review2-bookkeeping` "Terms' Payment Schedule View All opens this client's invoices" |
| New approved: Tasks tab scope | Done | #1394 | `r56-review2-bookkeeping` (View All to `/tasks?clientId=`); `r56-origin-back` "Bookkeeping client: the Tasks tab opens Tasks with Back to the same client" |
| New approved: plain-language Documents messages | Done | #1399 | Help text only (Archived and Trash in `folders-panel`) |
| New approved: desktop tab visibility | Done | #1383 | `r56-review2-bookkeeping` "every workspace tab, Settings too, shows at desktop width with no sideways scroll" |
| Cross service: independent service and billing pause | Done | #1383 | `service-billing.test`; `r56-stop-billing`; `r56-bookkeeping` "Actions menu: … pause and resume" |
| RP03 approved: explicit P&L source choice | Done | #1408 (schema), #1430 | `bookkeeping.e2e` "P&L source (Review 2, RP03)"; `bookkeeping-report-figures.test` (entered figures) |
| E01b confirmed: Payment Schedule View All client scope | Done | #1379 | `r56-review2-bookkeeping` "Terms' Payment Schedule View All opens this client's invoices" |

## Checklist: Partially fixed (yellow)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| I01: Connected versus Pending setup | Done | #1413 | `r56-review2-bookkeeping` "the software card says linked and authorized apart from synced"; `r56-connection-state` "Bookkeeping: the software card shows the connection and the sync apart" |
| I02 I03: unavailable figures shown as zero | Done | #1413 | `bookkeeping-report-figures.test` (blank totals and the no-data note) |
| I02 I03: a successful sync | Review Three | Needs a provider sandbox; nothing to fix | — |
| D07: stable catalog link | Done | SH9 (earlier), #1424 for Terms | `r56-catalog-plans`; `bookkeeping-terms.e2e` (E01b) |
| T01a: import path, amount and source filters | Done | #1417 | `bookkeeping.e2e` "lists the ledger newest first, with search, filters and counts; Staff only their clients" |
| R01a R01d: source data and close tests | Review Three | Tests with fixtures; no code change | `bookkeeping.e2e` reconciliation-from-the-ledger and close tests |
| E01a A01: Terms events and View All | Done | #1417 | `bookkeeping-terms.e2e` "starts empty, then New Terms is a draft from the package" (Terms events in Activity) |
| A01: note and upload events in the feed | Done (G1) | #1436 | `bookkeeping.e2e` "a note written on the Bookkeeping service shows in its Activity, never its text"; `documents.e2e` "shows an upload to a Bookkeeping service in that client's Bookkeeping Activity…" |
| P04 P07 P08 P09: filter, period and status checks | Review Three | Retest; no defect named | `bookkeeping.e2e`, `r56-bookkeeping` |
| R01 review: consistent approval controls | Done | #1402 | `recon-rules.test`; `r56-bookkeeping` "Close: checklist, figures, reconciliation and the review steps" |
| R01 review: discrepancy note | Done | #1424 | `bookkeeping.e2e` (R01 note) |
| E01 latest test: Terms package field | Done | #1424 | `bookkeeping-terms.e2e` (E01b) |

## Developer review: NOT FIXED and PARTIAL rows not listed above

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| D04: missing document age label | Review Three | The wording was fixed earlier; aging needs a sent request | `r56-module-fixes` "BK-D04: Missing Documents counts days since the request was sent" |
| RP02: preview, version and CSV | Done for the code; Review Three for populated data | #1413, #1430 | `bookkeeping.e2e` BK-RPT parts 1 and 2 |
| C01: workspace layout (the tab map) | Decision | Octavia approves the final tab map; nothing to fix | — |
| C05: dates and precision | Decision | Timezone and rounding to approve; nothing to fix | — |
| C06: plans and current period | Review Three | Verify; nothing to fix | `r56-catalog-plans` |
| C07: menus and routes | Done | #1379 (Categorize), #1430 (Refund, Settlement) | as N08 and RP01 above |
| X01: identity and canonical linkage | Done for the routes named | #1379, #1399 | as N02 and N08 above |

## GAPs

| GAP | Row | Plan | Status |
| --- | --- | --- | --- |
| G1 | A01 | A note written on a client's Bookkeeping service, or a file uploaded to it (by staff or the client), adds an entry to the client's Bookkeeping Activity. The entry shows who and when, never the note's text or the file's content. | Fixed in #1436 |
| G2 | N02 (period) | A document has a client, a service and a tax year, but no bookkeeping period. Proposed default: Documents opened from a period filters by upload date from the period's first day, shown as a chip the user can clear. The alternative is a period link on each document (a schema change). Octavia chooses. | Waiting for the decision |

## Not in scope here

- The purple rows (left for testing) and the BLOCKED developer-review rows (T01b, T01c, RP04, X02, X03, X04) need fixtures, a provider sandbox or role tests in Review Three. None names a defect to fix now.
- N04 also noted that the client profile Overview's Notes field said "Not on file". That field shows the profile's additional information, not internal notes. Renaming it is a Clients item, outside this map.
