# Super Admin review (Oct 31): Notifications change list

Source: "Notifications Developer Feedback" (Review One, Oct 31, 2026, completed 17:37 UTC) against the Notifications Page Developer Instructions (10 pages, 14 tables). Empty data: all four cards showed zero. Her codes are kept (N-01 becomes N01, Y1 ...). Unnumbered rule rows ("Non-negotiable behavior", "Required source routing", "Developer prerequisites", "Safe execution boundary") are folded into the items they govern.

## Summary

1. F items: 1 (SA-NOT-N01). Y items: 17 (N02 to N04, Y1 to Y14). GREEN: 9 checks (G1 to G9), not items. Keep them working and re-test them at Review 2.
2. Highest priority: the header bell (N01), also reported on the Dashboard. One fix in the shared header covers both.
3. Rules that every item keeps: reading a notification never clears Action Required; Resolve never performs a business action by itself; each notification links to its exact source record, not a module home; header select-all means the current page only.
4. Schema: none.
5. Role checks: recipient isolation and server-side denial for lower roles (Y11).
6. Shared: header in `console-shell.tsx` (N01, with SA-DSH-F01 search); `packages/ui` date-range control (N02); list state in the URL (N04, Y9); the admin record-link helper (Y2, also SA-AUD-R5).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/notifications/` and `_components/console-shell.tsx`. API: `apps/api/src/admin-notifications/`. DB: `PlatformNotification` (category, priority, attention), `PlatformNotificationCategory`, `PlatformNotificationPriority`, `PlatformNotificationAttention`.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-NOT-N01 | N-01; Dashboard "Notifications bell" | Header bell on every admin page | Click does nothing (URL, title and accessibility tree unchanged) on Audit & Security, Notifications and the Dashboard. The sidebar link works. | Bell opens a short scrollable panel of the latest notifications for Firmivra (system and client-originated), newest first, each entry clickable to its exact source record, with "View all" to `/notifications`. Urgent (Critical, High) entries are visibly distinct from informational ones, in text as well as color. Unread badge with the count of unread notifications (shows only when above 0). Keyboard: opens with Enter, closes with Esc, focus returns to the bell. Never shows tenant employees' private notifications. | No. | Shared: header in `console-shell.tsx`. Seed: unread notifications (set H). |

## B. Y items: qualified findings and decisions (her N-02 to N-04)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-NOT-N02 | N-02 | Reversed custom range (Oct 31 to Oct 1) accepted with no error | Default: fixed by the shared date-range control: reversed range rejected inline, values kept, query not run. Re-test valid, same-day and reversed ranges against dated fixtures. |
| SA-NOT-N03 | N-03 | No sidebar collapse control found | Default: add a collapse and expand toggle to the shared admin sidebar (button with an accessible name, keyboard operable), content widens when collapsed, choice remembered per browser. Check the approved mockup first if one exists in `docs/mockups`. |
| SA-NOT-N04 | N-04; "Exact source and scope"; "Policy decisions" | Filter reset, Mark All as Read scope, opening-as-read, mixed selection | Default: the "All Notifications" card resets status only and keeps priority, category and search (the guide's wording). Filters live in the URL, so reload and Back keep them. Opening a notification marks it read; Action Required stays until the source task is done or formally resolved. Mark All as Read applies to the current filtered results and asks "Mark 23 notifications as read?" with the count. Bulk actions run on eligible rows only and report the skipped ones. |

## C. Y items: Review 2 tests (her Y1 to Y14)

Fixtures are dummy data set H in CHANGE-LIST.md. All source events are synthetic; no real payment, alert or email.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-NOT-Y1 | Y1 | Row presentation | Notifications in all nine categories and four priorities, long titles, timestamps around the Nov 1, 2026 DST change; shown in America/New_York. |
| SA-NOT-Y2 | Y2; "Required source routing" | Exact links and actions | Each fixture links to a real fixture record: application review, firm, billing issue, subscription history, integration detail, support ticket, team member, Audit & Security event, system notice. Include one whose record was removed and one the viewer may not open: both show a safe "not available" state. Uses the shared admin record-link helper. |
| SA-NOT-Y3 | Y3 | Read state and badge | Known unread counts before and after; row, card and bell update at once and after reload and in a second session. |
| SA-NOT-Y4 | Y4; "Read is not resolution" | Action Required | A notification linked to an open task: reading or opening keeps Action Required; completing the task clears it. |
| SA-NOT-Y5 | Y5 | Resolve and dismiss | Eligible and ineligible fixtures; confirmation; persistence; audit actor, time, target and result; Dismiss never deletes the source record. |
| SA-NOT-Y6 | Y6 | Bulk selection | At least 3 pages of mixed rows; header box selects the current page only; a separate explicit "select all results" if offered; untouched rows stay unchanged. |
| SA-NOT-Y7 | Y7 | Mark All as Read | Per N04 default; known unread set; confirmation wording; server result; never resolves tasks. |
| SA-NOT-Y8 | Y8 | Counts and filtering | Expected-results sheet across text, date, category, priority and status; show what is excluded as well as included. |
| SA-NOT-Y9 | Y9 | Paging and return | Newest first; filters kept while paging and on return from a detail. |
| SA-NOT-Y10 | Y10 | Event generation | A written event contract per module (event, recipients, source id, de-duplication key) and a dev harness that fires each synthetic event once; check one notification per event and the exact link. |
| SA-NOT-Y11 | Y11 | Authorization | Lower-role and second-firm test logins (set L); server denial of routes and actions; recipients only see their own notifications. |
| SA-NOT-Y12 | Y12 | Failures and concurrency | Fault injection on load and update; concise error with Retry; two sessions changing the same rows. |
| SA-NOT-Y13 | Y13 | Layout and accessibility | Supported widths and zoom; keyboard; status not by color alone; sidebar collapse from N03. |
| SA-NOT-Y14 | Y14 | Backend and scale | API contract tests, canonical UTC timestamps, source references, a large synthetic set for paging speed. |

## D. Schema needs

None.

## E. Role and permission notes

No role change. Recipient isolation and server-side denial proven with test logins (Y11).
