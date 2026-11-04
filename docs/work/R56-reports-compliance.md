# R56: Octavia's Oct 28 reviews, Reports and Compliance & Deadlines

Rasel's word (Nov 4): R56 owns Reports (RP-F01 to F22, `docs/specs/review-2026-10-28/REPORTS.md`) and Compliance & Deadlines (CD-F01 to F17, `COMPLIANCE.md`). Reports first, its High items first (RP-F10, F02, F07, F04, F06); Compliance from CD-F01 (R1's #1232 is merged), then F02, F10, F03 and the rest. The shared Help icon comes from R60's `packages/ui` PR once merged (until then no icons). Permission matrices: server-side allow and deny plus cross-business tests. No `packages/db` change from here: schema ideas go under "Needs from others".

Standing rules (lead, Nov 4): local checks only for what changed; group one area's items in a PR; a branch stacked on the open one while CI runs; at most three open; each PR at 8 of 8 with its full head and exact title to Rasel and the lead.

## Re-test against #1208 (IP-F23, F24), Nov 4

- **RP-F07**: fixed by #1208 (XLSX and PDF are made and download; an export error no longer shows the validation message). What remained is parity: covered in the filters PR (an export carries the screen's search and More Filters, row for row, with real bytes).
- **RP-F06**: not fixed. The definition already stores comparison, chart type, labels and the fixed or rolling range; the detail view's Save sends the saved definition, not the screen's controls, and a reopened report does not set them from it. Web only.
- **RP-F12**: not fixed (#1208 made Saved Reports reachable; the library still has no search, filter, sort or Owner).
- **RP-F13**: not fixed (Save always makes a new report; `PATCH /reports/saved/:id` exists, unused by the screen).

## Needs from others

- None yet.

## Log

- Nov 4: #1241 `rasel/R56-rp-filters`: RP-F02, F09 (typed operators, value boxes by type, Clear All, client suggestions, column drag), F10, F20, F07's parity test.
- Nov 4: #1244 `rasel/R56-rp-saved`: RP-F06 (a saved report reopens as saved; Save takes the screen), F13 (Save Changes and Save As), F12 (library search, category, show, sort, Owner, Status, permitted row actions), F03 (the library's state in the address; SH1's Back returns to it).
- Nov 4: #1245 `rasel/R56-ip-pdf-tax` (Rasel's follow-up to R55's #1230): the invoice PDF's Tax row; Recurring Invoices bills a schedule with its discount and tax.
- Nov 4: #1249 `rasel/R56-rp-dates`: RP-F04 (one firm-day clock: Reports reload at the firm's midnight), F01 (the overview's range and comparison travel to a report and back), F16 (Custom Range on the overview and in the builder, its problems said in place).
- Nov 4: `rasel/R56-cd-tasks`: CD-F01 (a deadline's Create Task makes one task per deadline and template, also without one, on R1's #1232 scope; View Task after).
- Laptop rules (lead, Nov 4): heavy commands through `F:/firmivra-tools/heavy.sh`; only Postgres runs locally (S3 and SMTP tests are CI's).
