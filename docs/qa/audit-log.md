# Audit Log: Review Two QA map

This file maps every row of Octavia's Audit Log review to the PR that built it and the test that covers it, or marks it as a **GAP**. That means the green rows G01 to G05, the red corrections R01 to R04, the yellow rows Y01 and Y02, the red Missing rows M01 to M04 and the Review Three tests T01 to T10. Her review is kept privately, outside the repo. Rows are named by their IDs and short headings only; her text is not copied here.

Her status is in the second column. "Her retest" means her Review Three check of something built, not open code work. The decisions behind these rows are in the lead's DECISIONS.md, "Audit Log".

**Where the tests are**
- API e2e: `apps/api/test/e2e/audit-log.e2e.test.ts`
- API unit: `apps/api/test/unit/audit-viewer.test.ts`, `audit-service.test.ts`
- Types: `packages/types/test/workspaces/workspaces.test.ts`, `settings/admin.test.ts`
- Web unit: `apps/web/src/app/firm/(workspace)/audit-log/_components/` `audit-time.test.ts`, `audit-details.test.ts`, `audit-links.test.ts`
- Mock specs: `apps/web/e2e/mock/` `r1-audit-log`, `tumit-audit-log`, `fahad-audit-details`, `r56-audit-signups`

| Row | Her status | Code status | PR | Test |
| --- | --- | --- | --- | --- |
| G01 Event identity | Green | Done | before Review Two | e2e `audit-log` "never the user agent or the firm id; the contract shape exactly"; unit `audit-viewer` "toEntry answers the contract's shape" |
| G02 Actor, action and record filters | Green | Done | before Review Two | e2e `audit-log` "by person, record type and record id", "an action exactly or by prefix" |
| G03 Record type filter, paging, Clear | Green | Done | before Review Two | e2e `audit-log` "defaults to 50 a page…"; mock `tumit-audit-log` |
| G04 One-day range, one end only | Green | Done | before Review Two; day bounds in the firm's zone since #1609 (R01b) | mock `tumit-audit-log`; e2e `audit-log` "the last 30 days by default…" |
| G05 Module before/after values | Green | Done | before Review Two | Her scoped pass (the catalog's from/to diff) |
| R01a Times in the firm's zone | Red | Done | #1609 | web unit `audit-time` "shows 20:50Z as 2:50 PM CST for a Chicago firm, with the zone"; mock `r1-audit-log` "R01: times and the date filter are the firm's…" (browser in another zone) |
| R01b Date filter bounds in the firm's zone | Red | Done | #1609 | web unit `audit-time` "bounds a Chicago day…", "keeps a daylight-saving day whole…"; mock `r1-audit-log` R01 (Nov 15 and Nov 16 in New York) |
| R01c Export times in the firm's zone | Red | Done | #1609 | e2e `audit-log` "is the filtered log as CSV…" (Time (UTC) and Time (America/Chicago)); unit `audit-viewer` "zonedTime" |
| R01d Stored time stays UTC | Red (kept) | Done | before Review Two | e2e `audit-log` contract test (`at` is ISO with offset) |
| R02a Export downloads with the session; useful failure | Red | Done | #1609 | types `workspaces` (the export through the session's fetch), `settings/admin` (a 401 is an error with its request id, never a file); mock `r1-audit-log` "R02a: Export saves the file and says how many entries; a failure says why" and "R02a: the Users export downloads through the session too" |
| R02b Filters, firm and role kept on export | Red (kept) | Done | before Review Two | e2e `audit-log` "is the filtered log as CSV…", "is for Owner and Admin only, in their own firm" |
| R03a Recurrence update before/after | Red | **GAP**: part 2 | | The shared before/after helper (lead decision 2) |
| R03b Applicability rule update before/after | Red | **GAP**: part 2 | | The shared before/after helper (lead decision 2) |
| R03c Details readable: null, empty, false, zero | Red | Done (display) | #1609 | web unit `audit-details`; mock `r1-audit-log` "R03c: Details reads each change as old → new…". The values themselves come with R03a/b |
| R04a Complete and reopen: status and values | Red | **GAP**: part 2 | | Lead decision 5: filed-on and from/to stored, the confirmation number as set/changed/cleared, Reopen keeps both and is audited |
| R04b History never rewritten | Red (kept) | Done | before Review Two | e2e `audit-log` "no entry can be changed or deleted by the app…" |
| Y01a Staff, client and system attribution | Yellow | Done | before Review Two | e2e `audit-log` "names staff and clients, hides Super Admins as Firmivra Support without IP" |
| Y01b Coverage, denied actions, outcomes | Yellow | Her retest after M02b | | Closes with M02b (part 2) and T04 |
| Y02 No secrets in Details | Yellow | Her retest after M03 | | Closes with M03 (part 2) and T08 |
| M01a Readable record names; deleted records | Red Missing | Done | #1609 | e2e `audit-log` "M01a: names each record as it is now; a gone record is "Deleted client"; never another firm's" (screen and export); mock `r1-audit-log` "M01a: …". Lead decision 1a: looked up when the log is read, nothing stored |
| M01b Links to the record, access-checked | Red Missing | Done | #1609 | web unit `audit-links`; mock `r1-audit-log` "M01b: a record opens on its own page; a gone record has no link". The record's own page and API check access |
| M02a Exports logged | Red Missing (kept) | Done | before Review Two | e2e `audit-log` "is the filtered log as CSV…" (`audit_log.exported`) |
| M02b Denied actions logged with outcome | Red Missing | **GAP**: part 2 | | Lead decision 3: security-sensitive denials only, rate-limited per user and action |
| M02c Failed changes never shown as successful | Red Missing (kept) | Done | before Review Two | `AuditService.logIn` commits or rolls back with the change |
| M03 Consistent secret redaction | Red Missing | **GAP**: part 2 | | Central redaction in `AuditService` |
| M04 Logging failure detection and alert | Red Missing | Done (log line); alarm is H | #1609 | unit `audit-service` "a row that cannot be written…" (one `audit_write_failed` line, no values, still throws). The CloudWatch metric filter and alarm on that line is infra (Rasel), on the prod-resume list |
| T01 Time zone regression | Review Three | Her retest | | After R01 (#1609) |
| T02 Export integrity | Review Three | Her retest | | After R02a (#1609) |
| T03 Exact before/after survives refresh and export | Review Three | Her retest | | After R03 and R04 (part 2) |
| T04 Event coverage and outcomes | Review Three | Her retest | | After M02b (part 2) |
| T05 Role and tenant isolation | Review Three | Built and tested; her retest | before Review Two | e2e `audit-log` "Owner and Admin read it; Staff and clients 403", "another firm gets 404…"; isolation suite firm GET sweep |
| T06 Immutability | Review Three | Built and tested; her retest | before Review Two | e2e `audit-log` "no entry can be changed or deleted by the app…" |
| T07 Retention and retrieval | Review Three | Her retest | | Lead decision 4: kept forever, append-only (the app's database role only reads and adds), as Settings > Data says; any past range of up to 366 days can be read |
| T08 Privacy and redaction | Review Three | Her retest | | After M03 (part 2) |
| T09 Logging failure handling | Review Three | Her retest | | After M04 and its alarm |
| T10a Reversed dates | Review Three | Done | #1609 | types `workspaces` (T10a messages); mock `r1-audit-log` "T10a: a To date before the From date has its own message" |
| T10b Links, renamed and deleted records | Review Three | Her retest | | After M01a and M01b (#1609) |
