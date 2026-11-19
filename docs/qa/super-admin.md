# Super Admin: Review 2 QA map

This file maps each Super Admin Review 2 row (Octavia's change list for the Super Admin console) to the PR that changed it and the test that covers it. The reports are kept privately, outside the repo; rows are named by their IDs only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- API unit: `apps/api/test/unit/`
- Mock specs: `apps/web/e2e/mock/`

| ID | What | PR | Test |
| --- | --- | --- | --- |
| SA-DSH-F02 | Active Firms opens Firms on the Active tab | #1583 | mock `r60-sa-dashboard` "SA-DSH-F02, SA-FRM-F01: Active Firms opens Firms on Active; the tab lives in the address" |
| SA-DSH-F03 | Total Users opens Reports > Users (read-only) | #1583 | mock `r60-sa-dashboard` "SA-DSH-F03: Total Users opens Reports Users" |
| SA-DSH-F04 | Total Users = active staff + active client logins of active firms | **GAP** (not in #1583) | Needs the approved db function `app_platform_active_logins()` (db-only PR first; the admin site never opens a firm's scope). Until then Total Users counts staff and client logins from `users`. |
| SA-DSH-F07 | The pending-review row opens Applications on the Pending tab | #1583 | mock `r60-sa-dashboard` "SA-DSH-F07: the pending row opens Applications on its Pending tab" |
| SA-DSH-F09 | Open support tickets opens Support filtered to Open; the count is what this viewer's Support list shows (all, or only their own with View own tickets; no number without either) | #1583 | e2e `firm-applications` "SA-DSH-F09: Open support tickets counts only what the viewer's Support list shows"; mock `r60-sa-dashboard` "SA-DSH-F09: Open support tickets opens Support filtered to Open, with the same count" |
| SA-DSH-F10 | New users this week counts from Monday 00:00 UTC and opens Reports > Users for this week | #1583 | e2e `firm-applications` "SA-DSH-F09, F10, F11: counts what the screens they open show"; mock `r60-sa-dashboard` "SA-DSH-F10: New users this week opens Reports Users from Monday to today" |
| SA-DSH-F11 | Renewals this week opens Subscriptions filtered to Renewing this week (Monday to Sunday) | #1583 | e2e `firm-applications` "SA-DSH-F09, F10, F11: counts what the screens they open show"; unit `admin-subscriptions` "SA-DSH-F11: renewing this week is next billing from Monday to Sunday"; mock `r60-sa-dashboard` "SA-DSH-F11: Renewals this week opens Subscriptions filtered, with the same count" |
| SA-DSH-F12 | Recent Applications defaults to the last 30 days, with a period selector that View All keeps | #1583 | mock `r60-sa-dashboard` "SA-DSH-F12: Recent Applications shows the last 30 days, and View All keeps the period" |
| SA-DSH-F13 | The Platform Settings quick action opens System Settings | #1583 | mock `r60-sa-dashboard` "SA-DSH-F13: Platform Settings opens System Settings" |
| SA-APP-F10 | Resend owner invitation on Application detail | #1583 | mock `r60-sa-dashboard` "SA-APP-F10: an approved application resends the owner invitation; a joined owner has none" |
| SA-FRM-F01 | Firms tabs: Active first and the default, read from `?status=` | #1583 | mock `r60-sa-dashboard` "SA-DSH-F02, SA-FRM-F01: Active Firms opens Firms on Active; the tab lives in the address" |
| SA-APP-F04 | The applicant's /apply/respond page and its public API (the Request Additional Information link) | 456472153 (R56) | e2e `firm-application-respond`; mock `r56-apply-respond` |
| SA-FRM-F02 | Firm page "Actions" menu (Super Admin only, checked on the server) | #1653 | mock `r60-sa-firms` "SA-FRM-F02, F04, Y10: Suspend asks for a reason, Cancel changes nothing, Reactivate restores"; e2e `admin-firm-account` "needs a reason, a known firm and a Super Admin" |
| SA-FRM-F03 | Close Account: reason, `closed_at`, history and audit; final | #1653 | e2e `admin-firm-account` "Close is final: the closure time is recorded and nothing reopens the firm"; mock `r60-sa-firms` "SA-FRM-F03, Y06: Close is final; a closed firm says Closed, never \"After setup\"" |
| SA-FRM-F04 | Suspend Account: reason, history and audit; the firm's people refused until reactivated | #1653 | e2e `admin-firm-account` "Suspend refuses the firm's people, Reactivate lets them back, and the history keeps both reasons" |
| SA-FRM-F06 | Request Information: a Support ticket to the owner (Waiting on Customer), an email, and an Account History entry linking it; the owner answers in Settings > Requests from Firmivra with text and files, and the answer moves the request back to Open | #1655 | e2e `admin-firm-info-request` (5 tests, including "the owner reads it; staff and another firm's owner can't"); mock `r60-sa-firms-info` |
| SA-FRM-Y09 | Request Information's recipient, fields, delivery and history (the default) | #1655 | as SA-FRM-F06 |
| SA-FRM-Y05 | Firms list view (tab, search, plan, sort, page) in the address; Back from a firm restores it | #1653 | mock `r60-sa-firms` "SA-FRM-Y05, Y08: plan, sort and tab live in the address, and Back from a firm restores them" |
| SA-FRM-Y06 | Inactive tab badges Suspended or Closed exactly; no "After setup" for a closed firm | #1653 | mock `r60-sa-firms` "SA-FRM-Y06, Y07: the Inactive tab shows each firm's own status; an older closure is in its history" |
| SA-FRM-Y07 | Account History, with a closure event for firms closed before closures were recorded | #1653 | e2e `admin-firm-account` "a firm closed before closures were recorded still shows its closure (Y07)" |
| SA-FRM-Y08 | Plan filter; Business Name and Date Approved sort either way | #1653 | e2e `admin-firm-account` "filters by the plan the application asked for", "sorts by firm name, ignoring case, either way", "sorts by approval day, the never-approved last either way" |
| SA-FRM-Y10 | Reactivate a suspended firm (same dialog and audit as Suspend) | #1653 | e2e `admin-firm-account` "a firm suspended during setup goes back to Pending Setup"; mock `r60-sa-firms` (Reactivate step) |
