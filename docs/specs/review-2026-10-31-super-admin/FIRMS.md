# Super Admin review (Oct 31): Firms change list

Source: "Firms Developer Feedback" (Oct 31, 2026, Super Admin console, `/firms`; read-only pass 12:38 to 12:41 UTC, owner decisions through 12:53 UTC). Her rows carry no codes, so every ID here is ours (SA-FRM-F01, SA-FRM-Y01 ...). RED rows are the work; YELLOW rows get a default from us. No original Firms guide exists, so there is no guide coverage claim.

## Summary

1. F items: 13 (SA-FRM-F01 to F13). Y items: 11 (SA-FRM-Y01 to Y11). GREEN: 4 rows, not items (counts and routes, search and filters, pagination, sampled details). Keep them working and re-test them at Review 2.
2. Highest priority: Active first and default (F01), then the owner-only workspace exception (F09 to F13), then the account controls (F02 to F08).
3. This list supersedes the Firm Applications instruction to remove Open Firm Workspace everywhere: the option stays, but only for the platform owner (not a tenant firm owner, not an ordinary Super Admin), and only for a verified government or regulatory request. Application detail loses the shortcut (SA-APP-F12).
4. Close and Suspend here and Suspend and Cancel in Billing (SA-BIL-A2e) are the same account actions: build one server action per state change and call it from both menus.
5. Schema: yes for a closure time on the firm, a download-grant table, an exceptional-access request record and a platform-owner marker.
6. Role checks: a new platform-owner check (F09, also SA-TEAM-F01); the admin dropdown is Super Admin only until the Access review (Y11); users and usage views are read-only with no tenant content (F05).
7. Shared: confirm-with-reason dialog (F03, F04, also SA-BIL-A2e and SA-APP-F05); step-up reauthentication (F10); list state in the URL (Y05, same helper as SA-APP-F11).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/firms/`. API: admin firm reads (locate first); profile change requests in `apps/api/src/admin-firm-profile/`. DB: `Business.status` (PENDING_SETUP, ACTIVE, SUSPENDED, CLOSED; `activated_at`, no closure time), `SupportAccessGrant` (reason, expiry, revoke; no requester or legal fields).

## A. Navigation

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-FRM-F01 | "Default and order"; "Dashboard entry" | Firms tabs | All is first and default. Active Firms KPI opens All 15. | Tabs in this order: Active (default), All Firms, Pending Setup, Inactive. A fresh entry opens Active (7 in the QA data). Read the tab from the URL (`?status=active`, `?status=all`) so the Dashboard KPI opens Active and the Quick Action opens All (SA-DSH-F02). Test both links separately. Pending Setup keeps its meaning: approved application, account setup not finished. | No. | None. |

## B. Administrative controls (top-right dropdown on firm detail)

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-FRM-F02 | "Administrative controls"; acceptance check 1 | Firm detail header | No admin dropdown. | Add a top-right "Actions" dropdown holding F03 to F06 and F08. Separate from the restricted Open Firm Workspace option (F09). Visible and usable only by authorized roles (Y11), checked on the server. | No. | Role: yes (Y11). |
| SA-FRM-F03 | "Close Account"; acceptance check 2 | Actions > Close Account | Not present. | Confirmation naming the firm, a required reason, Cancel leaves everything unchanged. On confirm: status Closed, closure time stored, history and audit entry, owner download window starts (F07). Staff gain no access to tenant records. | Yes: `closed_at` on `businesses` (today only `activated_at`). | Shared: confirm-with-reason dialog; one server action used by SA-BIL-A2e. Seed: Active firm to close. |
| SA-FRM-F04 | "Suspend Account" | Actions > Suspend Account | Not present. | Confirmation naming the firm, required reason; status Suspended; history and audit entry. Distinct from Close: no closure clock, no download link, no deletion. Reactivation is tested under Y10. | No (`SUSPENDED` exists). | Shared: same dialog and server action as SA-BIL-A2e. |
| SA-FRM-F05 | "Users and usage" | Actions > Users & Usage | Not present. | Read-only view: roster (name, role, status, last sign-in), basic account metadata, aggregate usage counts. No tenant files, transactions, client financial records, impersonation or workspace session. Layout: Y01. | No. | Role: read-only, no tenant content. |
| SA-FRM-F06 | "Request Information" | Actions > Request Information | Not present. | Build per the Y09 default: opens a prefilled Support ticket to the firm owner (category "Information request"), so the message, the owner's reply and any files live in that ticket; the firm's history links to the ticket. Do not copy the Firm Applications request flow. | No (reuses Support tickets). | Role: Y11. |

## C. Closed-firm downloads

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-FRM-F07 | "First 30 days"; safeguards 1 to 5 | Closure flow; owner download page | Not present. | On closure, give the verified firm owner a download-only link to retained records, valid until 30 days after `closed_at`. It never reactivates the subscription, restores workspace access or lets admins read the records. Log issue, use and expiry. Identity and delivery: Y04. Boundary math: Y03. | Yes: download-grant table (firm, owner, kind auto or requested, granted by, starts, expires, revoked, reason) plus a download log. | Seed: closed firms at day 10, 45 and 95. |
| SA-FRM-F08 | "Days 31 through 90"; "Temporary downloads" | Actions > Grant Temporary Download Access | Not present. | From day 31 to day 90 after closure the owner must request access. An admin verifies identity, grants a limited download-only grant with an expiry, and can revoke it; every step audited. The window is counted from closure, never from the request; a grant never resets the clock or runs past day 90. | Yes (same table as F07). | Role: Y11. |

## D. Exceptional platform-owner workspace access

Approved requester categories: Tax Authority; Law Enforcement; Court or Judicial; Financial Regulator; Other Government Regulator.

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-FRM-F09 | "Visibility and authorization" | Firm detail > Open Firm Workspace | Visible to the Super Admin on sampled details; never clicked. | Show the option only to the platform owner. Deny every other admin on the server, including direct routes and APIs; a hidden button is not enough. | Yes, to check: no platform-owner marker exists today (`PlatformRole` is SUPER_ADMIN or TEAM_MEMBER). Default: one owner marker set only by a bootstrap script, never from the UI. | Role: new platform-owner check (also SA-TEAM-F01). Seed: owner and non-owner Super Admin test logins. |
| SA-FRM-F10 | "Reauthentication" | Before access | Not present. | The platform owner re-enters their own Super Admin password before access, every time. Never the firm owner's credentials; an existing session is not enough. | No. | Shared: step-up reauthentication prompt. |
| SA-FRM-F11 | "Reason and requester" | Access request form | Not present. | Required fields: access reason, requester category (list above), exact agency, jurisdiction, case or reference number, supporting legal document upload. Saved against the firm and the request. | Yes: exceptional-access request record (or an extension of `support_access_grants`). | None. |
| SA-FRM-F12 | "Authority and scope" | Access request review | Not present. | Record the authority review (identity, legal authority, permitted scope) and the approval before access opens. Access is limited to that scope and time window (Default: read-only, 4 hours, scope chosen from modules on the request). A password or a category alone is not authority. | Yes (same record). | Role: platform owner. |
| SA-FRM-F13 | "Access history"; recommended acceptance checks | Firm detail > Access history | Not present. | A reviewable history of each request: details, review, scope, approval, session start and end, pages and exports opened, expiry or revocation. | Yes (same record plus audit events). | None. |

## E. Y items (tests, fixtures and decisions)

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-FRM-Y01 | "Control details" | Users and usage: one view or two; control naming | Default: one read-only "Users & Usage" view with two tabs (Users, Usage). The dropdown item is named "Grant Temporary Download Access". |
| SA-FRM-Y02 | "After day 90" | What happens after day 90 | Default: download access simply ends. Nothing is deleted this round; deletion waits for the retention and legal-hold rules in System Settings (SA-SYS-P6). |
| SA-FRM-Y03 | Safeguards 2 and 4 | Closure time and window math | Default: `closed_at` stored in UTC; the automatic window ends exactly 30 x 24 hours after it, the request window exactly 90 x 24 hours after it; times shown in America/New_York. Grants default to 7 days and are capped at day 90; no extension past day 90 this round. Tests at one minute before and after each boundary. |
| SA-FRM-Y04 | Safeguard 5 | Owner identity and link delivery | Default: the link is emailed to the firm owner's login email; the download page asks for a one-time email code (existing verification codes) and opens no workspace session. In QA only the controlled test inbox receives links. |
| SA-FRM-Y05 | "Return navigation" | Back to Firms resets to All | Default: do it. Keep status, search and page in the URL and restore them on Back (shared helper from SA-APP-F11). |
| SA-FRM-Y06 | "Lifecycle wording" | Lakeside: Inactive in the list, Closed in detail, "After setup" features | Default: the Inactive tab holds Suspended and Closed firms; each row shows its exact badge (Suspended or Closed); the "After setup" feature label is hidden for Closed firms. |
| SA-FRM-Y07 | "Lifecycle history" | Lakeside has Activated but no closure event | Default: fix the seed so seeded closed firms carry a closure event; F03 writes one for every new closure. |
| SA-FRM-Y08 | "Optional list tools and data" | Date and plan filters, sortable columns, plan and approval-date placeholders on two seeded firms | Default: add a Plan filter and sortable Firm name and Joined columns; fill the placeholder plan and approval dates in the seed. |
| SA-FRM-Y09 | "Request Information" (clarification) | Recipient, fields, delivery, response, history | Default: recipient is the firm owner; fields are subject, message and optional due date; delivery is a Support ticket (email to the owner plus the ticket thread); the reply and files arrive in the ticket; firm history links the ticket. |
| SA-FRM-Y10 | "Untested workflows" | Activation, suspension, closure, reactivation, invitations, note saves, profile-change requests | Seed (dummy data set B): firms in every state, a pending profile-change request, documents and credentials on one firm. Test Reactivate on a Suspended fixture (same dialog and audit as F04). |
| SA-FRM-Y11 | Acceptance check 1; "Release acceptance" | Who sees the admin dropdown | Default until the Access review: Super Admin only; platform team members do not see it; the server checks every action. Open Firm Workspace: platform owner only (F09). |

## F. Schema needs (each needs Rasel's tap before any `packages/db` change)

- F03: `closed_at` on `businesses`.
- F07 and F08: a firm download-grant table and a download log.
- F09: a platform-owner marker (shared with SA-TEAM-F01).
- F11 to F13: an exceptional-access request record (new table, or new columns on `support_access_grants`).

## G. Role and permission notes

New check: platform owner, distinct from Super Admin and from any tenant owner (F09 to F13). Admin dropdown actions are Super Admin only by default and checked on the server (Y11). Users & Usage is read-only and excludes tenant content (F05). No route lets ordinary staff read tenant records.
