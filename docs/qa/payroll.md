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
| F02: portal due date, and the request beside the staff file | Done | #1399 | No test covers this row yet: `r56-review2-payroll` "a document shows its service and source, with View and Download" checks the file, not the request or the due date. **Test gap:** R60 adds the check after the product items (Nov 15). The staff file's "For request" link is checked by hand until a fixture exists: the mock cannot seed a client upload for a request. |
| F04: Payroll service prefilled; Cancel to the exact origin | Done | #1379 | `r56-service-tasks` "Payroll: Create Task is prefilled, Back asks first…" (Client and Related to only; not Service or Cancel). **Test gap:** R60 adds the check after the product items (Nov 15). |
| F05: Messages Back to the Communications tab | Done | #1379 | `r56-review2-payroll` "Open Messages from Communications comes back to Communications" |
| F10: browser Back restores the newest filters | Done | #1394 | `r56-origin-back` "Payroll list: Back from Send Message restores the period, search and list" and "Payroll list: a filter typed on the page is in the address, and Back keeps the scroll" (the in-app Back link and the address; not the browser's Back button). **Test gap:** R60 adds the check after the product items (Nov 15). |
| F13: Stop Future Billing control | Done | #1383 | `r56-stop-billing` "Payroll: pause billing from the next billing date, then resume it"; `service-billing.test` |
| B01: saved report Open, Preview, Download and file name | Done | #1399, #1537 (open) | `payroll.e2e` "adds provider reports from the vault as versions and lists them" (the API names the file); `r60-payroll-b01` "a report shows its file by name; View opens it and Download downloads it (B01, UX02)". #1537 shows the name in the Reports table, and Download saves the file under that name. |
| N01: demo formula and source labels | Done | #1413 | Label text only (`DEMO_SAMPLE_RATES` on the run screen); `r56-payroll` checks the demo banner, not this wording. **Test gap:** R60 adds the check after the product items (Nov 15). |
| UX01: Reports tab and context kept on refresh and navigation | Done | #1379 | `url-tab.test`; `r56-review2-payroll` "every tab shows at desktop width … and the tab survives a reload" |
| UX02: staff View and Download, with service and source | Done | #1399 | `r56-review2-payroll` "a document shows its service and source, with View and Download"; `r60-payroll-b01` "a report shows its file by name; View opens it and Download downloads it (B01, UX02)" (View and Download) |
| UX03: Settings visible without sideways scrolling | Done | #1383 | `r56-review2-payroll` "every tab shows at desktop width with no sideways scroll…" |
| Cross-service: service and billing pause together or apart | Done | #1383 | `service-billing.test`; `r56-stop-billing` "Pausing the service says billing is not changed; Bookkeeping has the same dialog" |

## Checklist: Partially fixed (yellow)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| F01: configured, authorized and synced wording | Done | #1413 | `r56-connection-state` (SH7: the client card and Sync Details; Pending setup, never synced; Connected with its last sync). The providers panel wording from #1413 is not tested. **Test gap:** R60 adds the check after the product items (Nov 15). |
| F01: a live connection and sync | Review Three | Needs the provider in production; nothing to fix | — |
| F06: chart, tab and dropdown agree; the All Clients caption; the empty-list message | Done | #1394 | `r56-review2-payroll` "the tabs and the Status filter keep one status, and the list says which" (a tab clears the Status filter; the caption); `r56-cohorts` "Payroll Status: a status filters the list, keeps the period, and Clear resets it". Not tested: the no-match message with Clear Filters, and the period and rows in the mixed sequence. **Test gap:** R60 adds the check after the product items (Nov 15). |

## Developer review: PARTIAL rows not listed above

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| F03: upload persistence and file name | Done (passed in Octavia's Nov 12 retest) | SH3 (earlier); no change needed | `r56-service-documents` "Payroll Documents tab: Upload Document files to this client and stays on the tab" |
| F09: populated runs and history | Review Three | Needs provider data; the empty state passed | `r56-module-fixes` "PY-F09: Payroll Runs shows its columns and says why there is no run yet" |
| F12: saved plan and catalog link | Done for the save | SH9 (earlier) | `r56-catalog-plans`; automatic billing is Review Three |
| B02: five-stage review | Review Three | The demo labels are fixed (N01); the real workflow needs a provider | — |

## GAPs

- B01: the saved report row showed its file name to screen readers only. Fixed in #1537 (open). Owner: R60.
- F01 (test): the providers panel wording from #1413. Owner: R60.
- F02 (test): the portal's "Due" line; the staff "For request" link is checked by hand until a fixture exists. Owner: R60.
- F04 (test): the Service prefill and Cancel back to the origin. Owner: R60.
- F06 (test): the no-match message with Clear Filters, and the period and rows in the mixed sequence. Owner: R60.
- F10 (test): the browser's Back button after a filter change. Owner: R60.
- N01 (test): the demo's sample-rate wording. Owner: R60.

The six test gaps are added after the product items (Nov 15). One related item is noted:

- F11 (purple, left for testing): the Save as Draft error is fixed; drafts are now stored (#1448 db, #1451; Appointments P1). e2e `scheduling` "drafts (Review 2, Save as Draft)"; mock `r56-appointments-review` "Review 2 (Save as Draft): a draft keeps the form…".

## Not in scope here

The purple rows (F01/B03, F02/F03, F04, F05, F06, F07/F08, F09, F10, F11, F12, F13, B01 to B04, UX01 to UX04) and the earlier successes (S01 to S15) are tests left for Review Three. None names a defect to fix now.
