# Payroll: Review 2 QA map

This file maps every red and yellow row of Octavia's Payroll Review 2 to the PR that fixed it and the test that covers it, or marks it as a **GAP**. It covers both her checklist (Nov 12, 2026) and the developer review. Both reports are kept privately, outside the repo.

Rows are named by their headings only; the report's text is not copied here.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- Web unit tests: next to the code (`*.test.ts`)

## Checklist: Needs correction (red)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| F02: portal due date, and the request beside the staff file | Done | #1399, #1588 (test) | `r60-payroll-f02` "F02: a file the client sent for a request names that request, with a link to it" (the staff file's "For request" link; the documents mock now has a Green Leaf payroll request answered from the portal) and "F02: the portal shows a request’s due date on a line of its own". |
| F04: Payroll service prefilled; Cancel to the exact origin | Done | #1379, #1588 (test) | `r60-payroll-f04` "F04: Create Task fills in the Payroll service, and Cancel goes back to the exact page"; `r56-service-tasks` "Payroll: Create Task is prefilled, Back asks first…" (Client and Related to). |
| F05: Messages Back to the Communications tab | Done | #1379 | `r56-review2-payroll` "Open Messages from Communications comes back to Communications" |
| F10: browser Back restores the newest filters | Done | #1394, #1588 (test) | `r60-payroll-f10` "F10: the browser’s Back button brings back the newest filters, each time" (the browser's Back, twice, after newer filters); `r56-origin-back` "Payroll list: Back from Send Message restores the period, search and list" (the in-app Back link). |
| F13: Stop Future Billing control | Done | #1383 | `r56-stop-billing` "Payroll: pause billing from the next billing date, then resume it"; `service-billing.test` |
| B01: saved report Open, Preview, Download and file name | Done | #1399, #1537 | `payroll.e2e` "adds provider reports from the vault as versions and lists them" (the API names the file); `r60-payroll-b01` "a report shows its file by name; View opens it and Download downloads it (B01, UX02)". #1537 shows the name in the Reports table, and Download saves the file under that name. |
| N01: demo formula and source labels | Done | #1413, #1588 | `r60-payroll-n01` "N01: the demo names its sample rates, and its taxes and benefits follow them as earnings change" (banner and summary name the rates; employee taxes, employer taxes and benefits are those rates of gross pay, before and after an edit). #1588 also makes the demo run hold only the three sample employees its banner names (it showed the client's 25); `r56-payroll` "A demo review shows the five Run Payroll steps…" passes again. |
| UX01: Reports tab and context kept on refresh and navigation | Done | #1379 | `url-tab.test`; `r56-review2-payroll` "every tab shows at desktop width … and the tab survives a reload" |
| UX02: staff View and Download, with service and source | Done | #1399 | `r56-review2-payroll` "a document shows its service and source, with View and Download"; `r60-payroll-b01` "a report shows its file by name; View opens it and Download downloads it (B01, UX02)" (View and Download) |
| UX03: Settings visible without sideways scrolling | Done | #1383 | `r56-review2-payroll` "every tab shows at desktop width with no sideways scroll…" |
| Cross-service: service and billing pause together or apart | Done | #1383 | `service-billing.test`; `r56-stop-billing` "Pausing the service says billing is not changed; Bookkeeping has the same dialog" |

## Checklist: Partially fixed (yellow)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| F01: configured, authorized and synced wording | Done | #1413, #1588 (test) | `r60-payroll-f01` "F01: the providers panel counts the clients that chose each provider and says which are authorized"; `payroll.e2e` "numbers the overview from confirmed runs only" (chosen is not authorized) and "links the Integrations connection when the provider is connected, and queues a sync" (authorized once connected); `r56-connection-state` (the client card and Sync Details). The mock now counts a provider authorized only once data came from it, as the API counts only a connected one. |
| F01: a live connection and sync | Review Three | Needs the provider in production; nothing to fix | — |
| F06: chart, tab and dropdown agree; the All Clients caption; the empty-list message | Done | #1394, #1588 (test) | `r56-review2-payroll` "the tabs and the Status filter keep one status, and the list says which (F06)"; `r56-cohorts` "Payroll Status: a status filters the list, keeps the period, and Clear resets it"; `r60-payroll-f06` "F06: a search with no match says so, and Clear Filters brings the whole list back" and "F06: through the Status filter, the chart and a tab, the period stays and the rows are the status named". |

## Developer review: PARTIAL rows not listed above

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| F03: upload persistence and file name | Done (passed in Octavia's Nov 12 retest) | SH3 (earlier); no change needed | `r56-service-documents` "Payroll Documents tab: Upload Document files to this client and stays on the tab" |
| F09: populated runs and history | Review Three | Needs provider data; the empty state passed | `r56-module-fixes` "PY-F09: Payroll Runs shows its columns and says why there is no run yet" |
| F12: saved plan and catalog link | Done for the save | SH9 (earlier) | `r56-catalog-plans`; automatic billing is Review Three |
| B02: five-stage review | Review Three | The demo labels are fixed (N01), and the demo run holds only its three samples (#1588); the real workflow needs a provider | — |

## GAPs

None open. The test gaps (F01, F02, F04, F06, F10, N01) are covered by #1588. One related item is noted:

- F11 (purple, left for testing): the Save as Draft error is fixed; drafts are now stored (#1448 db, #1451; Appointments P1). e2e `scheduling` "drafts (Review 2, Save as Draft)"; mock `r56-appointments-review` "Review 2 (Save as Draft): a draft keeps the form…".

## Not in scope here

The purple rows (F01/B03, F02/F03, F04, F05, F06, F07/F08, F09, F10, F11, F12, F13, B01 to B04, UX01 to UX04) and the earlier successes (S01 to S15) are tests left for Review Three. None names a defect to fix now.
