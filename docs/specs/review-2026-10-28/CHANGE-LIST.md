# Octavia's reviews of 27-28 Oct 2026: index

Six "Developer Feedback" reports from Octavia's QA of the dev app (Owner role, LVP Accounting & Taxes). Each is turned into its own change list in this folder. IDs keep the report's own codes so her reviewer can trace every item.

| Module | File | Fix items (F) | Needs a decision or fixture (Y) | Other |
| --- | --- | --- | --- | --- |
| Communications | `COMMUNICATIONS.md` | 18 (CM-F01 to F18) | 24 | 3 later items |
| Templates | `TEMPLATES.md` | 18 (TP-F01 to F18) | 18 | 48 starter templates in TP-F18 |
| Reports | `REPORTS.md` | 22 (RP-F01 to F22) | 16 | some may overlap #1208 |
| Compliance & Deadlines | `COMPLIANCE.md` | 17 (CD-F01 to F17) | 17 | |
| Automations | `AUTOMATIONS.md` | 33 (AU-F01 to F33) | 20 | 11 deferred (AU-D) |
| Integrations | `INTEGRATIONS.md` | 4 (IN-F01 to F04) | 25 | provider readiness table for Rasel |

Y items carry a default we chose. Nothing here needs an answer from Octavia before work starts. Her reviewer sees the defaults at Review 2.

## Required in every module

A Help or info icon per functional area (hover, keyboard, tap): CM, TP-F02, RP (R-U01), CD-F (C-U01), IN-F04, and the Automations equivalent. Build one shared component once (in `packages/ui`) and reuse it, so the six modules look the same.

## Highest priorities (her High and the blockers)

- Communications: Announcement has no audience entry and Overview "Choose Recipients" opens segment management (CM-F05, CM-F03); Back loses unsaved edits (CM-F06); a saved template stays Draft so "Use Template" finds none (CM-F12).
- Templates: seed the 48 starters (TP-F18); valid PNG/PDF uploads fail (TP-F06); type-specific structures (TP-F08); Preview ignores unsaved edits (TP-F04).
- Reports: numeric filters (RP-F10, RP-F02); XLSX/PDF export (RP-F07); Today and rolling ranges one day behind the firm date (RP-F04); saved definition loses comparison/chart/labels (RP-F06). Re-test against #1208 first.
- Compliance: duplicate linked tasks (CD-F01); effective-date filters vs Upcoming (CD-F02); recurring Save Changes (CD-F10); at-risk View Client and Back (CD-F03).
- Automations: the 13 trigger selectors (AU-F08 to F20); Logs activity tabs, Applies To, Rule Owner, Trigger Event label (AU-F01 to F03, F28); Manual Event Confirmation (AU-F29 to F33).
- Integrations: "All systems operational" shown with zero connections (IN-F01); Cancel and Back lose search, filter, sort and view (IN-F02).

## Schema: needs Rasel's own tap, none requested yet

Each of these goes to Rasel on a decision card before any `packages/db` change. Check the existing tables first.

- Templates TP-F08: structured content for Document Request, Intake, Task, Tax Workflow and Bookkeeping templates (tables for task, document request and intake templates may already cover it).
- Automations: Rule Owner on the rule; a manual-confirmation flag in the per-firm automation settings; a manual-confirmation record per occurrence.
- Compliance: possibly an idempotency key on the deadline-task link (CD-F01), a document-to-deadline link (CD-F06), source URL / effective year / last-verified (CD-Y04).
- Communications: only CM-F11 (footer), and only if the MSG-F02 signature store cannot hold it.
- Reports and Integrations: none confirmed. RP-F06, RP-F12 and IN-Y01/Y22 are "no, to check".
- Fixtures (synthetic log rows, message templates, QA data) go through the seed, which only Rasel edits.

## Roles and permissions

No new roles. Defaults we chose, each to confirm at review: Owner and Admin activate templates and change integrations, Staff save drafts and view; the Automations master toggle for Manual Event Confirmation is Owner/Admin and OFF by default; Compliance and Integrations get server-side allow/deny matrices with cross-business tests.

## Proposed split (Rasel decides)

| Session | Modules | F items |
| --- | --- | --- |
| R60 | Communications, Templates | 36 |
| R56 | Reports, Compliance & Deadlines | 39 |
| R55 | Automations, Integrations | 37 |
| R1 | schema cards, seed fixtures, provider readiness | none until a card is tapped |

Order inside each module: the High items first, then the rest, then Help icons. A session finishes its open Invoices & Payments / Messages PRs before starting here.

## Overlap with work already merged

Reports (RP-F07, F06, F12, F13) may already be fixed by #1208 (IP-F23, F24); re-test first. Communications CM-F11, CM-F12 and the Back-to-Origin item may overlap MSG-F02, MSG-F07 and MSG-F08 / SH1 (#1202 to #1219); re-test first.
