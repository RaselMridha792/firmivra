# Super Admin review (Oct 31): Dashboard change list

Source: "Dashboard Developer Feedback" (Super Admin Review One, Oct 31, 2026, evidence through 12:17 UTC). Her rows carry no codes, so every ID here is ours (SA-DSH-F01, SA-DSH-Y01 ...). RED rows are the work; YELLOW rows get a default from us.

## Summary

1. F items: 13 (SA-DSH-F01 to F13). Y items: 6 (SA-DSH-Y01 to Y06). GREEN: 15 rows, not items (account menu, two Quick Actions, System Status display, View All, Review links and Back, eight module links, the regression row), plus Pending Applications, which is GREEN for navigation and YELLOW for ordering (Y01). Keep them working and re-test them at Review 2.
2. Highest priority: the dead controls. Header search (F01), the five attention rows (F07 to F11) and the disabled Platform Settings button (F13). The bell is the same defect as SA-NOT-N01 and is fixed there.
3. "Coming Soon" is not an acceptable outcome anywhere on the Dashboard (her rule). Every link opens a real page, even with zero data.
4. Owned by other lists, not counted here: notifications bell (SA-NOT-N01); Billing Revenue tab (SA-BIL-A1); All Payment Issues, retry policy, Failed Payments actions, failure email, Suspend and Cancel, dispute actions (SA-BIL-A2, A2a to A2g); Billing decisions (SA-BIL-A1a, A2h to A2k); pending application fixture (SA-APP-Y07); Firms tab order (SA-FRM-F01).
5. Schema: none.
6. Role checks: header search returns only records a Super Admin may read, never tenant employees (F01); the Users view stays read-only (F03).
7. Shared: one clickable-row link for the attention rows (F07 to F11); the date-range control in `packages/ui` (F06); shared metric queries for Total Users (F04, with Reports), Monthly Revenue (F05, with SA-BIL-A1) and payment-issue count (F08, with SA-BIL-A2).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/page.tsx`, `_components/dashboard-overview.tsx`, `dashboard-data.ts`, `platform-growth.tsx`, and `console-shell.tsx` (header search and bell, shared by every admin page).

## A. Header and KPI routing

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-DSH-F01 | "Search" | Header search (every admin page) | A firm-name search plus Enter at 12:16 gave no results and no navigation. | Search firms and applications by firm name, firm ID, owner or applicant name, contact email and status words (pending, approved, active). Results show the record type ("Firm", "Application"); Enter opens the results; a click opens the record. No employee or user search. | No. | Role: only admin-readable records. Shared: header in `console-shell.tsx`. |
| SA-DSH-F02 | "Active Firms" | Active Firms KPI | Opens the full list (All Firms). | KPI and its link open `/firms` with Active selected. Quick Action "View Firms" keeps opening All Firms. Test both links separately. Needs SA-FRM-F01 (Firms reads the status from the URL). | No. | None. |
| SA-DSH-F03 | "Total Users and View Users"; "Shared destination"; "Read-only scope" | Total Users card, View Users | Earlier showed inactive or "Coming Soon"; not re-tested in the final sweep. | Route to the existing Reports & Analytics Users view, focused on active users. No new Users page, no new sidebar item. The view stays read-only: firm grouping and basic profile only, no private workspace data, no edit controls. | No. | Role: read-only, no tenant content. |
| SA-DSH-F04 | "Counting rule" | Total Users card | Shows 31 (22 staff + 9 client logins); arithmetic only, activity not proven. | Total Users = active staff logins + active client logins. Exclude inactive logins and firm entities. Count login accounts, not people (one person with two firm logins counts twice). Use the same query as the Reports Users view. | No. | Seed: users fixture (Y06). Shared: Total Users query with Reports. |
| SA-DSH-F05 | "Monthly Revenue and View Billing" | Monthly Revenue card, View Billing | Earlier "Coming Soon"; not re-tested. | Monthly Revenue opens the new Billing Revenue tab (SA-BIL-A1) with the current month and both recurring and one-time revenue selected; the card and the tab's first view show the same total. View Billing opens `/billing` even with no data, firm search available. Keep the label "Monthly Revenue". | No. | Shared: revenue query with SA-BIL-A1. |

## B. Platform Growth

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-DSH-F06 | "All nine approved growth range options" | Platform Growth range selector | Only Last 7, 30 and 90 Days at 11:43. | Offer, in this order: This Week (position and week start per Y02), Last 7 Days, Last 30 Days, Last 90 Days, Last 6 Months, Last 12 Months, This Year, Last Year, Custom Date Range. Rolling ranges are not calendar ranges (Last 12 Months is not This Year). Custom Date Range has start and end inputs with the shared validation (reversed range rejected inline). Every choice loads its own data. | No. | Shared: `packages/ui` date-range control. Seed: growth data across 2 years. |

## C. Tasks Requiring Attention

All five labels and chevrons did nothing at 11:43, including "New users this week" with a count of 1. Make the whole row one link (label and chevron), keyboard-focusable, using one shared clickable-row component.

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-DSH-F07 | "Firm application pending review" | Attention row | Inert. | Open Firm Applications with the Pending tab selected. Do not reuse the KPI's full-list, pending-first behavior. | No. | Shared: clickable row. |
| SA-DSH-F08 | "Payment issues" | Attention row | Inert. | Open Billing > All Payment Issues with all three filters (Overdue, Failed Payments, Disputes), not an Overdue-only view. The count uses the same calculation as that list (SA-BIL-A2, A2h). | No. | Shared: clickable row; count query with SA-BIL-A2. |
| SA-DSH-F09 | "Open support tickets" | Attention row | Inert. | Open Support filtered to open tickets (destination and count rule: Y03). | No. | Shared: clickable row. |
| SA-DSH-F10 | "New users this week" | Attention row | Inert with count 1. | Open the Reports Users view filtered to logins created this week, read-only (Y03). | No. | Role: read-only. Shared: clickable row. |
| SA-DSH-F11 | "Renewals this week" | Attention row | Inert. | Open Subscriptions filtered to renewals due this week (Y03). | No. | Shared: clickable row. |

## D. Recent applications and Quick Actions

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-DSH-F12 | "Recent window"; Firm Applications "Recent Firm Applications" | Recent Firm Applications card | Five Review links pass; the 30-day cutoff and order are not verified. | Default to submissions from the last 30 days, newest first, with a period selector (Y04). Review opens the matching detail. View All opens the full Firm Applications list without the 30-day limit. | No. | Seed: applications dated inside and outside 30 days. |
| SA-DSH-F13 | "Platform Settings" | Quick Action | Disabled; click does nothing. | Enable it and open System Settings (`/system-settings`). | No. | None. |

## E. Y items (tests, fixtures and decisions)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-DSH-Y01 | "Pending Applications"; "Top Pending Applications card" | Pending-first order of the full list | Default order per SA-APP-Y04 (Pending, In Review, Awaiting Information, then the rest). Test with the pending fixtures (SA-APP-Y07). |
| SA-DSH-Y02 | "This Week" | Week start and position | Default: weeks start Monday in the platform timezone (America/New_York); This Week is first in the list, before Last 7 Days. One constant, used everywhere "this week" appears (Platform Growth, F10, F11). |
| SA-DSH-Y03 | "Dashboard definitions"; aggregate-row note | Attention destinations and count rules | Default: every row opens a filtered list, even when the count is 1. Open support tickets = tickets not Resolved or Closed; destination = Support list with that same filter. New users this week = staff and client logins created Monday to now. Renewals this week = Active subscriptions with auto-renew on and a renewal date Monday to Sunday of this week. Each count and its destination use the same query. |
| SA-DSH-Y04 | "Recent window" | Other period choices | Default: 7 days, 30 days (default), 90 days, All time. |
| SA-DSH-Y05 | "Later report decisions" | Analytics totals, grouping, firm size | Default: deferred to the Reports & Analytics work. No combined firm-and-login arithmetic, no person de-duplication, no firm-size metric this round. |
| SA-DSH-Y06 | Retest checklist "Growth, recent and counts" | Known counts | Seed (CHANGE-LIST.md dummy data sets C, E and F): active and inactive staff and client logins on 3 firms, created this week and earlier; open and closed tickets; renewals inside and outside this week; growth records across 2 years. Ship an expected-values sheet for every Dashboard number. |

## F. Schema needs

None.

## G. Role and permission notes

No role change. Header search returns firms and applications only, never tenant employees or private records (F01). The Users destination is read-only and opens no workspace data (F03, F10).
