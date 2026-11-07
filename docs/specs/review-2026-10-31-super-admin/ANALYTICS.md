# Super Admin review (Oct 31): Reports & Analytics change list

Source: "Reports and Analytics Developer Feedback" (Review One, Oct 31, 2026) against the Reports & Analytics Developer Instructions (11 pages). All seven tabs, firm detail and six builder types inspected; default period Oct 2 to 31, 2026. Her codes are kept (R1, Y1 ...). Her unnumbered "Reconcile before calculation acceptance" rows become Y1a to Y1d (sub-items of her Y1, developer decisions).

## Summary

1. F items: 8 (SA-RPT-R1 to R8). Y items: 12 (Y1, Y1a to Y1d, Y2 to Y8). GREEN: 13 checks (G1 to G13), not items. Keep them working and re-test them at Review 2.
2. Her priority 1: correction plans for R1 to R8. Priority 2: metric definitions and known-value fixtures (Y1 to Y2). Priority 3: say which Review 2 prerequisites are ready.
3. Privacy rule for every item: reporting never opens private tenant content; the later owner-only workspace rule controls.
4. Schema: none confirmed. To check: where a firm's location comes from (R2) and whether feature-usage events exist for the full taxonomy (R7).
5. Role checks: user-level reporting stays inside a privacy-safe field list (R6); direct ticket links only for permitted viewers (R4).
6. Shared: one MRR query with Subscriptions (R3, SA-SUB-R2); the Total Users query with the Dashboard (SA-DSH-F04); export writers with Audit & Security (R1, SA-AUD-Y4); the admin record-link helper (R4, R5).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/reports/`. API: `apps/api/src/admin-reports/`. DB: `PlatformSavedReport`, `PlatformExportJob`.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-RPT-R1 | R1 (sections 4, 13) | Builder preview > Export | Excel and PDF disabled ("writer unavailable"); CSV offered but not run. | Implement CSV, Excel and PDF from the same filtered dataset and selected columns as the preview: title, generated time, period and filters in the file; clean column names; no hidden fields. Large exports run as a background job (`PlatformExportJob`). | No. | Role: export permission checked on the server. Shared: export writers with SA-AUD-Y4. |
| SA-RPT-R2 | R2 (section 4) | Builder > Firms > selectable fields | No Location field; the Location filter is disabled for lack of data. | Add Location (city, state of the firm's main location) as a selectable field whether or not data exists; missing values show "Not set". | To check: the source of a firm's location (main office record or firm settings address). | Seed: firms with and without a location (set C). |
| SA-RPT-R3 | R3 (sections 1, 7) | Overview and Revenue trend | The trend charts payments received, not the guide's monthly recurring revenue trend. | Two labelled series or charts: "MRR" (from subscription records, eligibility per SA-SUB-R2, value at each month end) and "Collected payments" (from billing records). Never estimate revenue from plan list prices. | No. | Shared: MRR query with SA-SUB-R2; collected query with SA-BIL-A1. |
| SA-RPT-R4 | R4 (sections 3, 10) | Firm detail > Support; builder Support preview | Firm detail shows only open tickets and a generic Support link; closed #1001 cannot be opened from the preview. | Keep the open-ticket summary; add the firm's full ticket history (all statuses) and make ticket numbers links to the exact ticket, for permitted viewers. Back returns to the report with filters kept. | No. | Shared: admin record-link helper. |
| SA-RPT-R5 | R5 (section 3) | Firm detail > Subscriptions, Billing links | Links open the generic modules with no firm selected. | Link to the firm-scoped destinations (the firm's subscription detail; Billing filtered to the firm). Back returns to the firm view in Reports. | No. | Shared: admin record-link helper. |
| SA-RPT-R6 | R6 (section 8) | Users tab and builder Users | Only firm aggregates; no user-level role, status or drill-down. | Add a user-level view limited to: login type (staff or client), firm, role, status, created date, last sign-in. No profile content, messages, documents or other tenant data. Drill-down from firm aggregates to this list. | No. | Role: privacy-safe field list, server-side. Seed: set C. |
| SA-RPT-R7 | R7 (section 9) | Feature Usage selectors | Taxonomy differs from the guide; Sales Center absent. | Align the feature list with the guide and measure actual use events, not enabled flags. Default for "Sales Center": it is a Super Admin tool, not part of any firm package (v72 catalog), so count it under platform usage, not firm feature usage. Transactions only where it applies. | To check: which usage events are recorded today. | Seed: usage rollups (set C). |
| SA-RPT-R8 | R8 | Builder default filter labels | "All Subscription Statuss", "All Ticket Statuss". | Correct to "Statuses" and check every builder type's empty and default labels. | No. | None. |

## B. Y items: developer decisions (her Y1, with her reconcile rows as Y1a to Y1d)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-RPT-Y1 | Y1; G11 | Definitions, taxonomy, search differences | One metric-definitions file in the PR covering every card. Default for builder search vs Firms tab search: the builder searches the same fields as the Firms tab (firm name and contact domain), so "Demo" returns the same 9 firms in both. |
| SA-RPT-Y1a | "MRR and ARR" | Reports $0 vs Subscriptions $2,411 | Default: one MRR query for both (SA-SUB-R2 rule: ACTIVE and NON_RENEWING, annual / 12, override and discount applied). Known fixture: $2,183 MRR, $26,196 ARR on the review sample. |
| SA-RPT-Y1b | "User counts" | 31 current vs 51 new in Oct 2 to 31 | Default: "Total users" = active logins now (Dashboard rule); "New users" = logins created in the period, counted even if later deleted, labelled "created in period". Document the seed provenance (reseeds create new logins). |
| SA-RPT-Y1c | "Unavailable metrics" | Uptime, usage, login, document and lead metrics show dashes | Default: a dash means "not collected" and says so on hover ("Not collected yet"); zero is shown only for a real zero. List which rollup jobs exist and how often they run. |
| SA-RPT-Y1d | "Support timing" | Average resolution 0 hours for #1001 | Default: show durations in hours and minutes ("0 h 2 m"); first response and resolution are separate clocks (SA-SUP-C1). Test with known durations. |

## C. Y items: Review 2 tests (her Y2 to Y8)

Fixtures are dummy data sets C, D, E and F in CHANGE-LIST.md.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-RPT-Y2 | Y2 | Known datasets | Ledger and subscription lifecycle, user joins, deletions, roles and statuses, daily rollups, locations, support timing, a previous period and timezone edges, with an expected-values sheet. |
| SA-RPT-Y3 | Y3 | Dates and comparisons | Every metric vs the selected range and the previous range of equal length; inclusive ends; DST (Nov 1, 2026); empty intervals. |
| SA-RPT-Y4 | Y4 | Saved definitions | Create, run, edit, rename, duplicate, delete; type, fields, filters, dates and sort persist; rerun uses current data. |
| SA-RPT-Y5 | Y5 | Exports | After R1: CSV, Excel and PDF match the preview rows, fields and period; permissions; background job for large files. Synthetic data only. |
| SA-RPT-Y6 | Y6 | Server and privacy | Server-side filtering, sorting and paging; direct-route and API isolation; altered ids never return another firm's private data; export audit. |
| SA-RPT-Y7 | Y7 | UI and performance | Builder results over 50 rows; 25 and 50 page sizes; every sort; joined-date boundaries; kept filters and Back; keyboard and phone width. |
| SA-RPT-Y8 | Y8 | Visual source | Default: use `docs/mockups` for the Super Admin analytics screens if present; otherwise visual fidelity is not claimed at Review 2. |

## D. Schema needs

None confirmed. To check: the firm location source (R2) and recorded usage events (R7).

## E. Role and permission notes

No role change. Server-side export permission (R1), privacy-safe user fields (R6), permitted ticket links (R4).
