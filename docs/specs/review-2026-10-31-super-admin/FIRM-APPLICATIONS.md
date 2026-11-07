# Super Admin review (Oct 31): Firm Applications change list

Source: "Firm Applications Developer Feedback" (Oct 31, 2026, Super Admin console, `/applications`; read-only pass 12:24 to 12:27 UTC, owner decisions through 12:40 UTC). Her rows carry no codes, so every ID here is ours (SA-APP-F01, SA-APP-Y01 ...). RED rows are the work; YELLOW rows get a default from us.

## Summary

1. F items: 12 (SA-APP-F01 to F12). Y items: 12 (SA-APP-Y01 to Y12). GREEN: 8 rows, not items (counts and tabs, search, status filters, date filters, pagination, detail navigation, detail display, Quick Actions and View All). Keep them working and re-test them at Review 2.
2. Highest priority: the approved workflow (F02 In Review on open, F03 Request Additional Information, F04 applicant response, F05 Approve and Decline) and the pending dummy applications (Y07). Nothing in the lifecycle could be tested: there are 0 pending applications and no visible signup entry.
3. Two rows in her "Dashboard entry points" table are owned by the Dashboard list: the Pending Review attention row (SA-DSH-F07) and the Recent Firm Applications 30-day window (SA-DSH-F12). Not counted here.
4. Open Firm Workspace: at 12:40 she asked to remove it everywhere. The later Firms decision (12:53) keeps it for the platform owner only. Default: remove it from Application detail entirely (F12); the only path is the owner-only flow on Firm detail (SA-FRM-F09 to F13).
5. Schema: yes for the In Review status, the assigned reviewer, and the information-request and applicant-response records. Status history already stores actor, time and reason (`firm_application_status_history`).
6. Role checks: reviewer actions are checked on the server (Y03); Super Admin is denied every tenant-workspace route (F12).
7. Shared component: list state in the URL with Back restore (F11), also used by SA-FRM-Y05, SA-NOT-Y9 and SA-AUD-C3.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/applications/`. API: `apps/api/src/firm-applications/`. DB: `FirmApplication` (status enum PENDING_REVIEW, INFO_REQUESTED, APPROVED, DECLINED; `decision_reason`, `reviewed_by_user_id`, `reviewed_at`, `internal_notes`, `ein_last4`, `ein_hash`), `FirmApplicationStatusHistory` (from, to, changed by, reason, time), `PlatformOwnerInvite`.

Rules for every item: synthetic records only; no request, invitation or email goes to anyone but the controlled QA recipient; every state change writes a history row and an audit event; a test per fix.

## A. Approved workflow

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-APP-F01 | "Application submitted" | Firm signup, then Applications | Approved rule: a new application starts as Pending. Not testable: no signup entry was found. | Confirm the dev firm signup creates `PENDING_REVIEW`, shown as "Pending". Put the dev signup URL in the PR so QA can submit an application. | No (default is already PENDING_REVIEW). | Seed: yes (Y07). |
| SA-APP-F02 | "Review begins"; "Implementation checks" | Application detail | Approved rule, untested. | When an authorized reviewer opens the detail page, change Pending to In Review once and write a history row (actor, time). Use an explicit idempotent POST sent by the detail page, never a write inside a GET. Opening the list changes nothing. Approved, Declined, In Review and Awaiting Information never change on open. Request info, Approve and Decline stay available in In Review. Add the status to tabs, filters and counts (Y04). | Yes: add `IN_REVIEW` to `FirmApplicationStatus`. | Role: reviewer only (Y03). Seed: Pending fixtures. |
| SA-APP-F03 | "Additional information requested"; acceptance checks 1 and 4 | Detail > Request Additional Information | Approved rule, untested. | Action with a required reason field (what is needed). Sends the applicant an email with a protected link to a response page for this application (Y06). Status becomes Awaiting Information: reuse `INFO_REQUESTED`, label it "Awaiting Information". History row with actor, time and reason. While a request is open the button reads "Request again". | Yes: information-request record (application, reason, requested by and at, link token hash, expiry, closed at). | Role: reviewer. Seed: Awaiting Information fixture. |
| SA-APP-F04 | "Applicant responds"; acceptance checks 2 and 3 | Applicant response page; application detail | Approved rule, untested. | The response page accepts written text, files, or both, saved under the SAME application (never a new one). Reviewers see the text and can view and download the files on the detail page. Notify the reviewer (Y05). Request status and last activity update. Status after a response: Y02. | Yes: response record (request, text, submitted at) and file links (S3, scanned like other uploads). | Seed: response fixture with one PDF and one PNG (Y08). |
| SA-APP-F05 | "Decision made" | Detail > Approve, Decline | No pending record, so the actions were not exercised. | Approve and Decline on Pending, In Review and Awaiting Information. Decline requires a reason (Y05); Approve takes an optional note. Record who, when and why (`decision_reason`, `reviewed_by_user_id`, history row). Approve keeps the existing path: firm created as Pending Setup, owner invitation sent. Check what already exists; build only the gaps. | No. | Role: reviewer. Seed: one fixture to approve, one to decline. |

## B. Approved reviewer tools and recovery

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-APP-F06 | "Assigned reviewer" | List and detail | Not shown. | Show the assigned reviewer on list and detail; Assign / Reassign control on detail; the saved assignment shows when the application is reopened; history row on each change. | Yes: `assigned_reviewer_user_id` on `firm_applications`. | Role: Super Admin assigns (Y03). |
| SA-APP-F07 | "Last activity" | List and detail | Not shown. | Show "Last activity" (date, time and event, for example "Response received") on detail and as a sortable list column. Events: submitted, review started, information requested, response received, note added, decision, invitation resent. Show the platform timezone (America/New_York) with its label. | No, to check: derive from history, request and response times; add a stored column only if list sorting needs it. | None. |
| SA-APP-F08 | "Document request status" | List and detail | Not shown. | Show "No request", "Requested, waiting" or "Response received" with the date. Repeat requests each keep their own row in a small request list on the detail page, so an open request is never confused with an earlier answered one. | No (derived from F03 and F04 records). | Seed: repeat-request fixture. |
| SA-APP-F09 | "Decision history" | Detail > History | Display only, no decisions made. | One history panel listing submission, review start, each request and response, notes and decisions, each with actor, time and reason. Entries must match the actions performed. | No (history table plus F03 and F04 rows). | None. |
| SA-APP-F10 | "Resend expired owner invitation" | Application detail | Test Subject (invite expired Oct 18) and R1 SES (expired Oct 25) are Pending Setup with no recovery action. | Add "Resend owner invitation" when the firm is Pending Setup and the owner invite has expired (also "Send a new link" while still valid). Revoke the old invite, issue a new one with the standard expiry, write history and audit. In QA, send only to the controlled test recipient. | No, to check (`invites`, `platform_owner_invites` exist). | Role: Super Admin only (Y03). Seed: existing Test Subject and R1 SES. |
| SA-APP-F11 | "Preserve list state on return" | Detail > Back to Applications | Back resets to All Applications, page 1, empty search (reproduced from Test Subject on page 3 and from the R1 SES search). | Keep tab, status, date filter, search and page in the URL; detail links carry them; App Back and browser Back restore them. Test each one alone and all together. | No. | Shared: list-state helper. |
| SA-APP-F12 | "Block private workspace access" | Application detail (and anywhere the shortcut appears) | "Open Firm Workspace" is visible on approved application details. Not clicked. | Remove the shortcut from Application detail. On the server, deny every firm-workspace route and API to Super Admin and team sessions (403), with no impersonation route. The owner-only exceptional path is SA-FRM-F09 to F13. | No. | Role: yes, server-side deny. Tests: Y11. |

## C. Y items (tests, fixtures and decisions)

Defaults are ours. Show them at Review 2; nothing here waits for the reviewer.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-APP-Y01 | "Status labels" | Application status vs firm account status (Lakeside Approved / Closed; Bluebird Approved / Pending Setup) | Default: the detail page shows two labelled badges, "Application: Approved" and "Firm account: Closed" (or Pending Setup, Active, Suspended). The list keeps application status and adds a small "Account" column. Both example combinations are valid; no data change. |
| SA-APP-Y02 | "Resubmission" | Status after the applicant responds | Default: a response moves Awaiting Information back to In Review and notifies the reviewer. A repeat request moves it to Awaiting Information again. It never returns to Pending. |
| SA-APP-Y03 | "Permissions and action availability" | Who may assign, decide, request and resend | Default: Super Admin can do everything. Platform team members can open, request information, approve and decline only with an "Applications review" permission, which no role has by default. Assign, reassign and resend invitation: Super Admin only. Approved and Declined are final this round (no reopen). Actions in In Review: Request info, Approve, Decline, Assign, Note. In Awaiting Information: Request again, Approve, Decline, Assign, Note. |
| SA-APP-Y04 | "Counts and pending work"; Top Pending Applications card | Tabs, totals, pending-first order, Dashboard pending count | Default: tabs All, Pending, In Review, Awaiting Information, Approved, Declined; All is the sum. Dashboard "Pending applications" = Pending + In Review (work on Firmivra's side); Awaiting Information waits on the applicant and is excluded but has its own tab. Pending-first order for the Dashboard top card: Pending, In Review, Awaiting Information, then the rest; newest first inside each group. One count query feeds tabs and Dashboard. |
| SA-APP-Y05 | "Reasons and notifications" | Mandatory reasons; response notification | Default: Decline reason required; Request reason required; Approve note optional. Response notification: in-app platform notification (category Firm Applications) to the assigned reviewer, or to all Super Admins when nobody is assigned, sent at once. No staff email this round. |
| SA-APP-Y06 | "Request and invitation controls"; security recommendation | Response link, uploads, repeat requests, invitation recovery | Default: random token stored hashed, tied to one application, expires after 14 days. The applicant confirms a 6-digit code sent to the application contact email before uploading (reuse the existing verification codes). Files: PDF, JPG, PNG; 10 MB each; up to 10 per response; scanned before reviewers can open them. A repeat request expires the earlier link. Invitation resend lives on Application detail, Super Admin only. Every request, response and resend is audited. No public access. |
| SA-APP-Y07 | "Pending lifecycle and dummy approval" | Pending applications to test with | Seed (dummy data set A in CHANGE-LIST.md): Pending applications for each path (approve, decline, request info, response received), one already In Review and assigned, dated records for the 30-day window. Also document the dev signup URL (F01). |
| SA-APP-Y08 | "Document upload and review" | Documents to view and download | Seed one application with a harmless PDF and PNG, one open request with a response link that delivers to the controlled QA inbox, and one response with text plus a file. |
| SA-APP-Y09 | "Internal notes" | Save Note | Test Save Note only on a seeded application. No change planned unless it fails. |
| SA-APP-Y10 | "Automated checks" | EIN, duplicate and credential checks | Seed three applications with known results: a duplicate-EIN pair ("Possible duplicate"), one with a missing credential, one clean ("Passed"). List the expected labels in the PR. Synthetic EINs only. |
| SA-APP-Y11 | "Workspace access enforcement" | Proof of F12 | API tests: Super Admin and team logins get 403 on firm-workspace routes and APIs; browser check that the button is gone from Application detail. Uses the role test logins; never real tenant data. |
| SA-APP-Y12 | "Date boundaries" | Inclusive dates, timezone, month rollover | Default: platform timezone America/New_York; start and end dates inclusive; "Last 7 days" is today plus the 6 days before. Seed records at 23:59 Oct 31 and 00:00 Nov 1 local, plus one on Nov 1 (US daylight saving ends that day). Uses the shared date-range control. |

## D. Schema needs (each needs Rasel's tap before any `packages/db` change)

- F02: `IN_REVIEW` value on `FirmApplicationStatus`.
- F03: an information-request table (reason, requested by and at, token hash, expiry, closed at).
- F04: an applicant-response table and its file links.
- F06: `assigned_reviewer_user_id` on `firm_applications`.
- To check only: F07 (stored last-activity column), F10 (invite tables already cover resend).
- Fixtures go through the dev seed extension Rasel approved on Nov 7 (R1 builds it).

## E. Role and permission notes

Server-side checks: reviewer actions (F02 to F06, Y03); invitation resend Super Admin only (F10); Super Admin and team sessions denied every tenant-workspace route and API (F12, Y11). No new platform role; the "Applications review" permission is a new permission key with no default holder.
