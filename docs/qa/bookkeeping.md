# Bookkeeping: Review 2 QA map

This file maps every red and yellow row of Octavia's Bookkeeping Review 2 to the PR that fixed it and the test that covers it, or marks it as a **GAP**. It covers both her checklist (Nov 12, 2026) and the developer review. Both reports are kept privately, outside the repo.

Rows are named by their headings only; the report's text is not copied here. Each GAP has a plan and a status. The GAP list is at the end.

Checked against main on Nov 15, and again on Nov 17 (R60). Where only part of a row is built or tested, the row is split. **Test gap** means the code is on main but no test checks that part yet; such a row is never marked Done.

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
| D01 D02: dashboard cohorts and counts (the status chart and the Active card) | Done | #1394 | `bookkeeping.e2e` "the Active cohort leaves a paused client out, and the chart counts the cohort shown"; `r56-cohorts` "Bookkeeping: the cohort cards and the status chart filter the list" |
| D01 D02: the Income, Expense and Net cards and the monthly chart follow the list's cohort and filters | Done: the overview takes the list's tab and filters and totals only the clients listed; the cards name them (All Clients, Active Clients or Clients Shown) and an empty filter says "No figures for these clients" | this PR (R56) | `bookkeeping.e2e` "the overview adds the figures of the months and compares with the month before" (the filtered totals); mock `r56-bookkeeping-cohort-totals` |
| D03: date filter refresh | Done | #1394, #1591 (test) | `r60-bookkeeping-d03` "D03 (G5): a custom Report Due period changes the rows at once, with no reload"; `r56-module-fixes` "BK-D03: a custom Report Due period filters the list, start no later than end" (the reversed-date alert and the address). |
| N02 N03: Documents scope (client and service) | Done | #1399 | `r56-review2-bookkeeping` "View All keeps the client and service…" |
| N02 N03: recent document inline preview | Done | #1399, #1401 | `r56-review2-bookkeeping` "a recent document opens in a quick view on the workspace…" |
| N02: Documents scope by period | Done (G2) | #1441 | `r56-review2-bookkeeping` "View All opens Documents on the current period's uploads, in a chip that clears"; `documents.e2e` "keeps a period's uploads: the days from and to, both included" |
| N04 update: note fields | Done | #1408 (schema), #1424 | `notes.e2e` "keeps a note’s type and the record it is about, and every note stays internal"; `r56-bookkeeping-transactions` "Add Note opens in place, internal and on this service" |
| N04 update: the Notes tab and Client Notes View All open the workspace's Notes | Done | #1424, #1591 (test) | `r60-bookkeeping-n04` "N04 (G6): Client Notes View All and the Notes tab open this workspace's Notes" |
| N05 update: recurrence context and clickable relations | Done | #1379 | `tasks-work.e2e` "names the engagement's own workspace, so Related To can open it"; `new-task-href.test` |
| N05 original: task service and origin return | Done | #1379, #1591 (test) | `r60-bookkeeping-n05` "N05 (G7): Create Task starts on the Bookkeeping service, and Cancel goes back to the workspace"; Payroll's twin, `r60-payroll-f04`; `r56-service-tasks` "Bookkeeping: Create Task carries the current period into the details". |
| N08: Categorize opens Transactions; the tab is kept | Done | #1379 | `url-tab.test`; `r56-review2-bookkeeping` "… Categorize opens Transactions, and the tab survives a reload" |
| N08: Back from Terms returns to the tab it left | Done | #1379, #1591 (test) | `r60-bookkeeping-n08` "N08 (G8): Terms opened from a workspace tab goes Back to that same tab" |
| R01c update: statement required before approval | Done | #1402 | `bookkeeping.e2e` "needs the statement attached before approval, apart from the zero difference"; `recon-rules.test`; `r56-bookkeeping-reconciliation` |
| RP01 RP03: Refund and Settlement reports | Done | #1430 | `bookkeeping.e2e` BK-RPT part 2 (Refund and Settlement figures, a generated version); `bookkeeping-report-figures-more.test` "Refund Report…", "Settlement Report…" |
| RP01 RP03: no-data totals, CSV context, readable headings | Done | #1413 | `bookkeeping-report-figures.test` "says whose figures they are, and leaves totals blank when nothing is recorded" |
| E01b: package from Services & Pricing | Done | #1408 (schema), #1424 | `bookkeeping-terms.e2e` "takes the package from Services & Pricing and keeps its name"; isolation `bookkeeping-terms` (catalogServiceId) |
| E01b: scoped billing link | Done: Invoices opened for a client with no invoices yet names that client in the Client select, with an empty list (G4) | #1379, this PR (R56) | `r56-review2-bookkeeping` "Terms' Payment Schedule View All opens this client's invoices" (the link); mock `r56-invoices-unlisted-client` "P1-20: the Client select names a chosen client that has no invoices" |
| New approved: Tasks tab scope | Done | #1394 | `r56-review2-bookkeeping` (View All to `/tasks?clientId=`); `r56-origin-back` "Bookkeeping client: the Tasks tab opens Tasks with Back to the same client" |
| New approved: plain-language Documents messages | Done | #1399, #1591 (test) | The client-origin entry is covered by N02 above; `r60-bookkeeping-documents-help` "Documents messages (G9): Archived and Trash say in plain words why they are empty" (their help, as the buttons' accessible description). |
| New approved: desktop tab visibility | Done | #1383 | `r56-review2-bookkeeping` "every workspace tab, Settings too, shows at desktop width with no sideways scroll" |
| Cross service: independent service and billing pause | Done | #1383 | `service-billing.test` "resumes what is paused"; `r56-stop-billing` "Pausing the service says billing is not changed; Bookkeeping has the same dialog" |
| RP03 approved: explicit P&L source choice | Done | #1408 (schema), #1430 | `bookkeeping.e2e` "P&L source (Review 2, RP03)"; `bookkeeping-report-figures.test` (entered figures) |
| E01b confirmed: Payment Schedule View All client scope | Done (G4) | #1379, this PR (R56) | As E01b scoped billing link above. |

## Checklist: Partially fixed (yellow)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| I01: Connected versus Pending setup | Done | #1413 | `r56-review2-bookkeeping` "the software card says linked and authorized apart from synced"; `r56-connection-state` "Bookkeeping: the software card shows the connection and the sync apart" |
| I02 I03: unavailable figures shown as zero | Done | #1413 | `bookkeeping-report-figures.test` (blank totals and the no-data note) |
| I02 I03: a successful sync | Review Three | Needs a provider sandbox; nothing to fix | — |
| D07: stable catalog link | Done | #1188 (schema), #1200 (SH9), #1424 for Terms | `r56-catalog-plans`; `bookkeeping-terms.e2e` (E01b) |
| T01a: import path, amount and source filters | Done | #1417 | `bookkeeping.e2e` "lists the ledger newest first, with search, filters and counts; Staff only their clients" |
| R01a R01d: source data and close tests | Review Three | Tests with fixtures; no code change | `bookkeeping.e2e` reconciliation-from-the-ledger and close tests |
| E01a A01: Terms events in Activity | Done | #1417 | `bookkeeping-terms.e2e` "starts empty, then New Terms is a draft from the package" (Terms events in Activity) |
| E01a A01: Activity View All | Done | #1417, #1591 (test) | `r60-bookkeeping-a01` "A01 (G10): Activity View All opens the client's whole history, with Back to the workspace" |
| E01a A01: the client Activity page has the bookkeeping events, in words (R61 live check) | Done | PR pending (live check) | View All's page reads the card's own source (bookkeeping_activity), leaving out the note and upload copies it already lists; statuses and note types read in words ("Status changed from Not started to Overdue", "General note"), older lines too. `bookkeeping.e2e` "E01a A01: the client's Activity page lists the Bookkeeping events in words…"; `r60-bookkeeping-livefix` "E01a A01…". |
| A01: note and staff upload events in the feed | Done (G1) | #1436 | `bookkeeping.e2e` "a note written on the Bookkeeping service shows in its Activity, never its text"; `documents.e2e` "shows an upload to a Bookkeeping service in that client's Bookkeeping Activity…" |
| A01: a client's upload in the feed | Done | #1436, #1591 (test) | `documents-portal.e2e` "a portal upload to a Bookkeeping service (Bookkeeping Review 2, A01)": "The client uploaded …", with no staff author. |
| P04 P07 P08 P09: filter, period and status checks | Review Three | Retest; no defect named | `bookkeeping.e2e`, `r56-bookkeeping` |
| R01 review: consistent approval controls | Done | #1402, #1591 (test) | `recon-rules.test` (the one rule both screens use); `r56-bookkeeping-reconciliation` (the Reconciliation screen); `r60-bookkeeping-r01` "R01 (G12): the Close Checklist keeps Approve off, with its reason, while a reconciliation has a difference" (the same reason on both screens). |
| R01 review: discrepancy note | Done | #1424 | `bookkeeping.e2e` (R01 note) |
| E01 latest test: Terms package field | Done | #1424 | `bookkeeping-terms.e2e` (E01b) |

## Developer review: NOT FIXED and PARTIAL rows not listed above

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| D04: missing document age label | Review Three | The wording was fixed earlier; aging needs a sent request | `r56-module-fixes` "BK-D04: Missing Documents counts days since the request was sent" |
| RP02: preview, version and CSV | Done for the code; Review Three for populated data | #1413, #1430 | `bookkeeping.e2e` BK-RPT parts 1 and 2 |
| C01: workspace layout (the tab map) | Decision | Octavia approves the final tab map; nothing to fix | — |
| C05: dates and precision | Decision | Timezone and rounding to approve; nothing to fix | — |
| C05: times in the firm's time zone (R61 live check) | Done | PR pending (live check) | The Activity card, report versions, sync times, Terms times, notes, recent documents and reconciliation notes use the firm's zone, as the client Activity page. `r60-bookkeeping-livefix` (browser in Dhaka, firm in New York): "E01a A01…" (card and page agree) and "C05: report version times…". |
| C06: plans and current period | Review Three | Verify; nothing to fix | `r56-catalog-plans` |
| C07: menus and routes | Done | #1379 (Categorize), #1430 (Refund, Settlement) | as N08 (Categorize) and RP01 above |
| X01: identity and canonical linkage | Done for the routes named | #1379, #1399 | as N02 and N08 (Categorize) above |

## Not in scope here

- The purple rows (left for testing) and the BLOCKED developer-review rows (T01b, T01c, RP04, X02, X03, X04) need fixtures, a provider sandbox or role tests in Review Three. None names a defect to fix now.
- N04 also noted that the client profile Overview's Notes field said "Not on file". That field shows the profile's additional information, not internal notes. Renaming it is a Clients item, outside this map.

## GAPs

| GAP | Row | Plan | Status |
| --- | --- | --- | --- |
| G1 | A01 | A note written on a client's Bookkeeping service, or a file uploaded to it (by staff or the client), adds an entry to the client's Bookkeeping Activity. The entry shows who and when, never the note's text or the file's content. | Fixed in #1436; the client's upload tested in #1591 (G11) |
| G2 | N02 (period) | A document has a client, a service and a tax year, but no bookkeeping period. The lead chose (Nov 14) the default with no schema change: Documents opened from Bookkeeping keeps the current period's uploads (its first to last day), in a chip that names the period and clears. | Fixed in #1441 |
| G3 | D01 D02 | The Income, Expense and Net cards and the Monthly Income vs. Expenses chart take the overview's figures for the period only. They follow the cohort and filters the list shows, as the status chart already does. | Done (this PR, R56) |
| G4 | E01b, E01b confirmed | Invoices opened from Terms' Payment Schedule names the client in its Client select even when that client has no invoices yet. Today the select's options come from the loaded invoices, so such a client is likely shown as All Clients. | Done (this PR, R56): the chosen client is added to the options by its record |
| G5 | D03 | A mock check that choosing a custom Report Due range changes the rows at once, with no reload. | Done: tested in #1591 |
| G6 | N04 (route) | A mock check that the Notes tab and Client Notes View All open the workspace's own Notes tab. | Done: tested in #1591 |
| G7 | N05 original | One check, shared with Payroll F04: Create Task from a workspace starts on the engagement's service, and Cancel returns to the workspace. | Done: tested in #1591 |
| G8 | N08 (Terms) | A mock check that Terms opened from a workspace tab goes Back to that same tab. | Done: tested in #1591 |
| G9 | New approved: plain-language Documents messages | A mock check of the Archived and Trash help text. | Done: tested in #1591 |
| G10 | E01a A01 | A mock check that Activity's View All opens the client's whole history, with Back to the workspace. | Done: tested in #1591 |
| G11 | A01 | An e2e check that a client's portal upload to a Bookkeeping service adds an entry to its Activity, with no staff author. | Done: tested in #1591 |
| G12 | R01 review | A mock check that the Close Checklist's Approve is disabled, with its reason, while a reconciliation has a difference. | Done: tested in #1591 |
