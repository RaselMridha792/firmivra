# R56: Octavia's Oct 28 reviews, Reports and Compliance & Deadlines

Rasel's word (Nov 4): R56 owns Reports (RP-F01 to F22, `docs/specs/review-2026-10-28/REPORTS.md`) and Compliance & Deadlines (CD-F01 to F17, `COMPLIANCE.md`). Reports first, its High items first (RP-F10, F02, F07, F04, F06); Compliance from CD-F01 (R1's #1232 is merged), then F02, F10, F03 and the rest. The shared Help icon comes from R60's `packages/ui` PR once merged (until then no icons). Permission matrices: server-side allow and deny plus cross-business tests. No `packages/db` change from here: schema ideas go under "Needs from others".

Standing rules (lead, Nov 4): local checks only for what changed; group one area's items in a PR; a branch stacked on the open one while CI runs; at most three open; each PR at 8 of 8 with its full head and exact title to Rasel and the lead.

## Re-test against #1208 (IP-F23, F24), Nov 4

- **RP-F07**: fixed by #1208 (XLSX and PDF are made and download; an export error no longer shows the validation message). What remained is parity: covered in the filters PR (an export carries the screen's search and More Filters, row for row, with real bytes).
- **RP-F06**: not fixed. The definition already stores comparison, chart type, labels and the fixed or rolling range; the detail view's Save sends the saved definition, not the screen's controls, and a reopened report does not set them from it. Web only.
- **RP-F12**: not fixed (#1208 made Saved Reports reachable; the library still has no search, filter, sort or Owner).
- **RP-F13**: not fixed (Save always makes a new report; `PATCH /reports/saved/:id` exists, unused by the screen).

## For Review 2: behaviour that changed

- #1269 (CD-F13): the API refuses a rule's `excludeStatuses` that are not real client statuses (NEW, PENDING_DOCUMENTS, IN_PROGRESS, ACTIVE, ON_HOLD, INACTIVE), on create and on edit. Rules saved earlier with free text still read as before.
- #1269 (CD-F13): Setup Recurring Deadline's "Exclude clients marked as tax-exempt" used to send "Tax-exempt" as a client status, which matched no client. It is now the criterion `notTaxExempt`, so the rule says staff must check it (no client field records tax-exempt).
- CD-Y13 (`rasel/R56-cd-perms`), observed and kept: Staff may pause and resume a recurring definition and generate, confirm and dismiss suggestions; ending or archiving a definition, the library, rules, settings and Save as Template are Owner and Admin only. The matrix test pins this; no role changed.

## Needs from others

- **Audit Log page** (`apps/web/src/app/firm/(workspace)/audit-log/`, Tumit's page in PAGE-MAP; Rasel to route): CD-F15 links open `/audit-log?action=compliance.` (from Compliance Logs) and `/audit-log?entityType=compliance_deadline&entityId=<id>` (Audit history on a deadline). The screen keeps its filters in local state, so it opens unfiltered. Asked: read `action`, `entityType` and `entityId` from the address as its first filters (the API's `AuditLogQuery` already takes all three).

## Log

- Nov 4: #1241 `rasel/R56-rp-filters`: RP-F02, F09 (typed operators, value boxes by type, Clear All, client suggestions, column drag), F10, F20, F07's parity test.
- Nov 4: #1244 `rasel/R56-rp-saved`: RP-F06 (a saved report reopens as saved; Save takes the screen), F13 (Save Changes and Save As), F12 (library search, category, show, sort, Owner, Status, permitted row actions), F03 (the library's state in the address; SH1's Back returns to it).
- Nov 4: #1245 `rasel/R56-ip-pdf-tax` (Rasel's follow-up to R55's #1230): the invoice PDF's Tax row; Recurring Invoices bills a schedule with its discount and tax.
- Nov 4: #1249 `rasel/R56-rp-dates`: RP-F04 (one firm-day clock: Reports reload at the firm's midnight), F01 (the overview's range and comparison travel to a report and back), F16 (Custom Range on the overview and in the builder, its problems said in place).
- Nov 4: #1250 `rasel/R56-cd-tasks`: CD-F01 (a deadline's Create Task makes one task per deadline and template, also without one, on R1's #1232 scope; View Task after).
- Nov 4: #1255 `rasel/R56-cd-overview`: CD-F02 (ranges and the Tax Calendar on the effective due date; Upcoming is open-only, like its card), F03 (an at-risk client opens its own deadlines with the reason), F05 (the overview's state in the address; Add Deadline's Cancel and SH1's Back return to it).
- Nov 4: #1260 `rasel/R56-cd-recurring`: CD-F10 (Save Changes no longer sends `isTemplate`, which the update refuses; a refusal names its field).
- Nov 4: #1261 `rasel/R56-rp-builder`: RP-F14 (Run Report opens the full report of the unsaved definition; Back finds the builder's work in its address), F05 (the Tasks unsaved guard on the builder), F15 (a new data source asks before it resets), F08 (the overview's KPI cards open their reports, with their definitions).
- Nov 6: #1262 `rasel/R56-cd-workspace`: CD-F09 (the setup tab in the address, a history step), F11 (a custom interval of 0 claims no frequency; `frequencyText` in `schedule-text.ts`), F12 (the import tab stays mounted; leaving with a draft asks, Save imports it). Next: CD-F13, F04, F06 to F08, F14 to F17, then Reports RP-F17 to F21 (the High items of both are done).
- Nov 6: #1263 `rasel/R56-help-icons`: RP-F22 and CD-F17 (R60's shared `HelpTip` in every Reports and Compliance area, the words in `report-help.tsx` and `compliance-help.tsx`; the setup page's icon follows the open tab).
- Nov 6: #1266 `rasel/R56-cd-form`: CD-F07 (a closed deadline opens read-only, its real status shown, Reopen first), F08 (tax years from five ahead back to 2000; a month, a fiscal year end or a custom period; a saved period that is none of these stays as written).
- Nov 6: #1269 `rasel/R56-cd-filters`: CD-F04 (the list's search, a custom From and To, tax year, priority, source, jurisdiction, recurring and Unassigned, all in the address; Client and Assigned To are searched by typing), F13 (the library by name, authority or form, year, state, jurisdiction and how long ago it was verified; Manage by search, status, type and kind; a rule's states and excluded client statuses are chosen, and the API refuses a status that does not exist). Next: CD-F06, F14 to F16, Y13, then Reports RP-F17 to F21.
- Nov 6: #1272 `rasel/R56-cd-logs`: CD-F16 (Logs search by record name or ID, the person and dates, in the address; each row names its record where the viewer may open it, an override's dates before and after, a run's rule and version; an edit's audit keeps before and after for fields that are not free text), CD-F15 (Logs and a deadline link to the Audit Log, Owner and Admin; a deadline's Activity opens its own Logs). The Audit Log reading the address is under Needs from others.
- Nov 7: `rasel/R56-cd-perms`: CD-Y13 (every Compliance route: signed out 401, a client 403, another firm 404, Staff 403 on Owner-and-Admin routes, the allowed role past the check; firm B never reaches firm A's records by URL, in its lists, or named in its own bodies). Tests only.
- Laptop rules (lead, Nov 4): heavy commands through `F:/firmivra-tools/heavy.sh`; only Postgres runs locally (S3 and SMTP tests are CI's).
