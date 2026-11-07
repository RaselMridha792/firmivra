# Super Admin review (Oct 31, 2026): index

Fifteen "Developer Feedback" reports from the client's QA review of the Firmivra Super Admin console on dev (Review One, Oct 31, 2026). Each one is turned into its own change list in this folder. The Leads/CRM, Website Management and Pricing Strategy reports are a later pass. The Super Admin Plan Tier Developer Guide (v72, Nov 1) is used only for the Sales Center plan names and prices.

| Module | File | F (fix or build) | Y (test, fixture or decision) | GREEN rows (not items) |
| --- | --- | --- | --- | --- |
| Firm Applications | `FIRM-APPLICATIONS.md` | 12 (SA-APP-F01 to F12) | 12 | 8 |
| Pipeline | `PIPELINE.md` | 1 (SA-PIP-PL01) | 6 | 9 |
| Support | `SUPPORT.md` | 1 (SA-SUP-R1) | 9 | 13 + 8 settings observations |
| Notifications | `NOTIFICATIONS.md` | 1 (SA-NOT-N01) | 17 | 9 |
| Sales Center | `SALES-CENTER.md` | 3 (SC01, SC02, F01) | 5 | 8 |
| Integrations | `INTEGRATIONS.md` | 4 (SA-INT-R1 to R4) | 12 | 12 |
| Dashboard | `DASHBOARD.md` | 13 (SA-DSH-F01 to F13) | 6 | 15 |
| Firms | `FIRMS.md` | 13 (SA-FRM-F01 to F13) | 11 | 4 |
| Billing | `BILLING.md` | 12 (R1, R2, C3, A1, A2, A2a to A2g) | 29 | 13 + 9 settings observations |
| Subscriptions | `SUBSCRIPTIONS.md` | 4 (SA-SUB-R1 to R4) | 20 | 16 |
| Communications | `COMMUNICATIONS.md` | 8 (SA-COM-R1 to R8) | 11 | 8 |
| Reports & Analytics | `ANALYTICS.md` | 8 (SA-RPT-R1 to R8) | 12 | 13 |
| System Settings | `SYSTEM-SETTINGS.md` | 7 (F1, F2, F6, F8, A1 to A3) | 19 | 8 |
| Team | `TEAM.md` | 6 (T01 to T05, F01) | 16 | 8 |
| Audit & Security | `AUDIT-AND-SECURITY.md` | 8 (SA-AUD-R1 to R8) | 13 | 9 |
| Total | | 101 | 198 | |

## How to read the IDs

- Module prefixes: SA-DSH Dashboard, SA-APP Firm Applications, SA-FRM Firms, SA-BIL Billing, SA-SUB Subscriptions, SA-SUP Support, SA-COM Communications, SA-NOT Notifications, SA-INT Integrations, SA-RPT Reports & Analytics, SA-PIP Pipeline, SA-SAL Sales Center, SA-SYS System Settings, SA-TEAM Team, SA-AUD Audit & Security.
- Where her row has a code, the ID is the prefix plus her code (SA-BIL-R1, SA-NOT-N01 for her N-01, SA-SAL-SC01 for her SC 01). Watch out: her Team "R01 to R12" are Review 2 tests (Y), and her System Settings "F3, F4, F5, F7" are follow-ups (Y).
- Where she numbered nothing (Dashboard, Firm Applications, Firms), IDs are ours: F01, F02 for fix rows, Y01, Y02 for yellow rows. Unnumbered rows in coded modules get a sub-letter of the item they belong to (SA-BIL-A2a, SA-RPT-Y1a) or a letter matching her table (SA-BIL-S1 for "Remaining safe checks", SA-AUD-C1 for "Clarifications"). The "Report" column of each table names her source row.
- Her RED and approved rows are F items. Her YELLOW and AMBER rows are Y items. Every Y decision carries a "Default:" we chose; nothing waits for an answer from the reviewer. Her reviewer sees the defaults at Review 2.
- Each F item states "Schema?" (yes, no, or to check) and its seed fixture, role check and shared component.

## Cross-module decisions and supersessions

1. Open Firm Workspace: the Firms decision (12:53) supersedes the Firm Applications removal (12:40). The option stays only for the platform owner, on Firm detail, for a verified government or regulatory request, with reauthentication and a request record (SA-FRM-F09 to F13). It is removed from Application detail (SA-APP-F12). Every other admin is denied on the server.
2. Super Admin Billing is platform billing: Firmivra bills firms. Tenant firm-to-client invoicing stays in the firm workspace (default in SA-BIL-R1 and C2; it follows the Dashboard decision on Payment Issues).
3. Payment retry: original attempt plus three retries, three days apart, four in total, then contact the firm (SA-BIL-A2a). Supersedes the earlier three-attempt reading.
4. Plan catalog: the v72 guide (Nov 1) replaces the plan names and prices her Sales Center review used (SoloFirm $59, SoloFirm Pro $89, DuoFirm $149, TeamFirm $199, GrowFirm $499, ScaleFirm from $799). Her SC01 and SC02 are applied to the new catalog (SA-SAL-SC01, SC02, F01).
5. The Billing rows in the Dashboard report are built in `BILLING.md`; the bell in `NOTIFICATIONS.md` (SA-NOT-N01). Dashboard keeps only the links.
6. The System Settings precedence contract (SA-SYS-F8: mandatory restriction, firm lock, user choice, default) also decides channel precedence in Support (SA-SUP-Y6).
7. Not checked against current `origin/main`: some items may already be partly done (for example Approve and Decline in SA-APP-F05, Reactivate in SA-FRM-Y10). Look first; build only the gap.

## Shared pieces (build once, reuse)

1. Date-range control in `packages/ui/src/date-range-picker.tsx`: keeps a valid range after Apply with an active chip, rejects reversed ranges inline and keeps the values, has accessible names. Fixes SA-SUP-R1, SA-INT-R4, SA-NOT-N02, SA-SUB-C2, SA-PIP-PL01 (date popup) and the custom ranges in SA-DSH-F06, SA-BIL-A1, SA-APP-Y12.
2. List state in the URL with Back restore: SA-APP-F11, SA-FRM-Y05, SA-NOT-N04 and Y9, SA-AUD-C3.
3. Admin header (`console-shell.tsx`): search SA-DSH-F01 and bell SA-NOT-N01.
4. Clickable row and KPI tile (whole row is one link): SA-DSH-F02 to F13, SA-SAL-Y01.
5. "Save and continue" disclosure and the unsaved-changes guard: SA-COM-R5, SA-COM-R8, SA-INT-R1.
6. Confirm-with-reason dialog and one server action per account state change: SA-FRM-F03, F04, SA-BIL-A2e, SA-APP-F05 (Decline).
7. Step-up reauthentication: SA-FRM-F10, SA-SYS-A2, SA-AUD-Y1.
8. Admin record-link helper (record type and id to the exact admin route, with a safe "not available" state): SA-AUD-R5, SA-NOT-N01 and Y2, SA-RPT-R4 and R5.
9. Shared metric queries: MRR (SA-SUB-R2, SA-RPT-R3, Y1a); Monthly Revenue (SA-DSH-F05, SA-BIL-A1); payment-issue count (SA-DSH-F08, SA-BIL-A2); Total Users (SA-DSH-F04, SA-RPT-Y1b).
10. Export writers on `PlatformExportJob`: SA-RPT-R1, SA-AUD-Y4.
11. Readiness states (enabled, configured, connected, last test): SA-SYS-A3, used by Integrations and Notifications.
12. Platform-owner check: SA-FRM-F09, SA-TEAM-F01.

## Highest priorities (hers, per module)

- Firm Applications: the approved workflow, In Review on open, Request Additional Information, applicant response, Approve and Decline (SA-APP-F02 to F05), with pending dummy applications (SA-APP-Y07); workspace block (F12).
- Dashboard: the dead controls: search (SA-DSH-F01), five attention rows (F07 to F11), Platform Settings (F13).
- Firms: Active first and default (SA-FRM-F01); owner-only workspace access (F09 to F13); account controls (F02 to F08).
- Billing: issuer scope (SA-BIL-R1), template tokens (R2), Revenue tab (A1), All Payment Issues (A2).
- Subscriptions: seat usage, MRR eligibility, trial status, payment recovery data (SA-SUB-R1 to R4).
- Support: Created Date filter (SA-SUP-R1).
- Communications: recipient picker (SA-COM-R6) and editor parity (R1 to R5).
- Notifications: header bell (SA-NOT-N01).
- Integrations: draft disclosure and stale list (SA-INT-R1, R2), then R3, R4.
- Reports & Analytics: correction plans for R1 to R8; metric definitions (SA-RPT-Y1).
- Pipeline: accessible names (SA-PIP-PL01).
- Sales Center: plan content on the v72 catalog (SA-SAL-SC01, SC02, F01).
- System Settings: Audit Logs link, metadata, maintenance preview (SA-SYS-F1, F2, F6); then precedence (F8) and A1 to A3.
- Team: Add Team Member (SA-TEAM-T01) first.
- Audit & Security: event-ID search (SA-AUD-R1), actor, session and before-after context (R3, R4).

## Schema candidates (each needs Rasel's tap before any `packages/db` change)

Yes:
- SA-APP-F02: `IN_REVIEW` on `FirmApplicationStatus`.
- SA-APP-F03: information-request table (reason, requested by and at, token hash, expiry).
- SA-APP-F04: applicant-response table and file links.
- SA-APP-F06: `assigned_reviewer_user_id` on `firm_applications`.
- SA-FRM-F03: `closed_at` on `businesses`.
- SA-FRM-F07, F08: firm download-grant table and download log.
- SA-FRM-F11 to F13: exceptional-access request record (new table or columns on `support_access_grants`).
- SA-FRM-F09 and SA-TEAM-F01: a platform-owner marker (shape to check; set only by a bootstrap script).
- SA-BIL-A2a: payment attempt history and next-retry time.
- SA-BIL-A2, A2f: platform dispute table with notes and evidence.
- SA-SYS-A2: previous setting values (history table, or before and after values in the audit log).

To check (may need nothing): SA-APP-F07 (last-activity column), SA-APP-F10 (invite tables), SA-BIL-R1 (client reference on platform documents), SA-SUB-C4 (suspension kind), SA-COM-R1 to R3 (`CommMediaLink` usage kinds), SA-COM-R6 (manual broadcast recipient), SA-RPT-R2 (firm location source), SA-RPT-R7 (usage events), SA-SYS-F2 (retention minimum and lock), SA-SYS-F8 (firm locks and user choices), SA-SYS-A3 (last test time), SA-TEAM-T01 (member invitation record), SA-AUD-R2 (admin sessions), SA-AUD-R7 (security policy fields).

Not schema: SA-SAL-F01 and Y05 (plan rows are catalog data), SA-BIL-R2 (stored template migration), SA-SUB-R3 (`EXPIRED` already exists).

## Role-check candidates

New checks:
- Platform owner only: Open Firm Workspace and its request flow (SA-FRM-F09 to F13); executive-role assignment (SA-TEAM-F01).
- Super Admin and team sessions denied every tenant-workspace route and API: SA-APP-F12 (proof in Y11).
- TEAM_MEMBER admin-console guards and actor-vs-target authority checks: SA-TEAM-T01.
- New "Applications review" permission for request, approve, decline; Super Admin only for assign and resend invitation: SA-APP-F02 to F06, F10 (default SA-APP-Y03).
- Firm admin dropdown, Super Admin only until the Access review: SA-FRM-F02 to F08 (SA-FRM-Y11).
- Billing role for Retry Payment, Suspend and Cancel, Accept and Challenge Dispute: SA-BIL-A2a to A2c, A2e, A2f.
- Read-only, privacy-safe views: header search scope (SA-DSH-F01), Users view (SA-DSH-F03, F10), Users & Usage (SA-FRM-F05), user-level reporting and ticket links (SA-RPT-R6, R4).
- Settings: locked settings refused on the server (SA-SYS-F8); restore permission (SA-SYS-A2).

Existing matrices to enforce and prove on the server: SA-BIL-Y11, SA-SUB-Y10, SA-SUP-Y5 and Y6, SA-COM-Y11, SA-NOT-Y11, SA-INT-Y8, SA-PIP-Y04, SA-RPT-R1 (export), SA-SYS-P10, SA-TEAM-R02 to R06, SA-AUD-Y3 and Y4. No item loosens a permission to enable a button (SA-AUD-R8).

## Dummy data needed for Review 2

Rasel approved a dev seed extension and test logins on Nov 7; R1 builds them. Rules: dev only, never production; synthetic names; delivery disabled except to the controlled QA recipients; Stripe test mode; one expected-values sheet per set; credentials handed over privately, never in docs, PRs or results. Keep the existing QA records: support ticket #1001, Stripe Test integration draft `int_001`, broadcast draft "QA preview only - do not send", and the seeded firms she used (Lakeside, Bluebird, Pinecrest, Meridian, Harborline, Summit, Quickfile, Demo Accounting Group, Test Subject, R1 SES).

| Set | Contents | Unlocks |
| --- | --- | --- |
| A. Firm applications (first) | The dev signup URL documented; Pending applications for each path (to approve, to decline, to request information); one In Review and assigned; one Awaiting Information with an open request and a response link to the QA inbox; one with a response received (text plus a harmless PDF and PNG); a repeat-request case; a duplicate-EIN pair, a missing-credential case and a clean case; applications dated 1, 29, 31 and 45 days ago and at 23:59 Oct 31 and 00:00 Nov 1. | SA-APP all, SA-DSH-Y01, F07, F12 |
| B. Firm lifecycle | Firms in Active, Pending Setup (owner invite expired and valid), Suspended (nonpayment and administrative), Closed at day 10, 45 and 95 after closure with a closure event; a pending profile-change request; documents and credentials on one firm; plan and approval dates filled. | SA-FRM all, SA-APP-F10 |
| C. Users and growth | Active and inactive staff and client logins on 3 firms, created this week and earlier, one deleted login; firm locations set and unset; feature-usage rollups; two years of growth records. | SA-DSH-F04, F06, F10, Y06; SA-RPT-R2, R6, R7, Y1b, Y2 |
| D. Platform billing | Invoices in every status, one-time and recurring, this month and last month; USD and CAD firms; one invoice at attempt 2 of 4 and one at 4 of 4; one open dispute with a response deadline; full and partial refunds; credit notes; estimates in every status; recurring schedules active, paused and canceled. | SA-BIL all, SA-DSH-F05, F08, SA-RPT-R3 |
| E. Subscriptions | At least 17 subscriptions on the v72 plans: Active monthly and annual, Non-renewing, Trial (active, ending tomorrow, expired, converted), Past Due with a failed invoice and attempts, Suspended of both kinds, Canceled; seats below, at and over the limit; a discount and a credit; renewals inside and outside this week; known contact emails and domains. | SA-SUB all, SA-DSH-F11, SA-RPT-Y1a |
| F. Support | At least 12 tickets across statuses, priorities, sources and queues, assigned and unassigned, one SLA breach, one Waiting on Customer, created on range boundaries; two canned responses; a second ticket for merge tests. | SA-SUP all, SA-DSH-F09, SA-RPT-R4, Y1d |
| G. Communications | Email, SMS and Internal conversations in unread, open, waiting, assigned and mention states; templates in each category and status, one with an attachment and an inline image; broadcasts in Draft, Scheduled, Sent, Failed and partial (synthetic results, no dispatch); two segments. | SA-COM all |
| H. Notifications | At least 30 notifications (three pages) over 9 categories and 4 priorities in every status, linked to records from sets A to F and K, one linked to an open task, one whose record is gone, timestamps across the Nov 1 DST change, long titles. | SA-NOT all |
| I. Integrations | One working sandbox platform connection; catalog entries Enabled, Disabled and Coming Soon with plan limits; firm connections on two plans; a test API key; a webhook endpoint delivering to a sink; seeded logs and usage with known metrics. | SA-INT all |
| J. Sales | At least 25 opportunities over the nine stages plus Lost (with reasons including Other), values with some missing, assigned and unassigned, each attention condition, tags, sources and v72 plans, linked subscriptions for Under Contract and Closed, activities, appointments today and later, follow-ups, a duplicate pair, an occupied custom stage, boundary dates. | SA-PIP all, SA-SAL-Y01, Y04 |
| K. Settings and security | Harmless feature flags with a dependency on two firms and plans; a firm-locked and a user-overridable setting; healthy, unconfigured and unavailable channel states; held and unheld records; audit events across categories, actors, firms and outcomes with known ids; admin and staff sessions active, revoked and expired; one open security alert. | SA-SYS all, SA-AUD all |
| L. Role test logins (second) | Platform owner (separate from the CEO and Super Admin logins); non-owner Super Admin; non-owner CEO; HR; Chief Officer; VP/Director; QA Sales Manager (level 4, Direct Reports); QA Sales Staff (SDR, level 6, Own Records); QA Support Staff (level 6, Own Records, separate department); Billing staff; read-only auditor; a restricted login with no export. Supervisor chains in two departments, teams and locations, more than 12 members in every member status. | Every role check above; SA-TEAM all |
| M. Controlled recipients | One Firmivra-controlled QA email inbox and one test phone number, seeded as selectable contacts; every send in QA goes only there, and only with approval for that test. | SA-COM-Y1, SA-APP-F03, F10, SA-FRM-F07, SA-SUP-C2, SA-TEAM-R07 |

## Proposed order

1. Firm Applications workflow and the dummy data: SA-APP-F01 to F12, while R1 builds sets A and L first, then the other sets.
2. Light modules and quick fixes: the shared date-range control with SA-SUP-R1; SA-NOT-N01 with the header; SA-PIP-PL01; SA-SAL-SC01, SC02, F01; SA-INT-R1 to R4; plus SA-TEAM-T02 to T05, SA-RPT-R8 and SA-SYS-F1.
3. Dashboard: SA-DSH-F01 to F13, with SA-FRM-F01 (Firms reads the tab from the URL). F05 and F08 go live together with SA-BIL-A1 and A2; until then they open the existing Billing page, never "Coming Soon".
4. Firms: SA-FRM-F02 to F13.
5. The rest: Billing (R1, R2, A1, A2 first, then A2a to A2g, C3); Subscriptions (R1 to R3, then R4 after SA-BIL-A2a); Communications; Reports & Analytics R1 to R7; System Settings F2, F6, F8, A1 to A3; Team T01 and F01; Audit & Security R1 to R8.

Inside each module: her priority order first, then the rest of the F items, then Y defaults that need code.

## Proposed split (Rasel decides)

| Session | Modules | F items |
| --- | --- | --- |
| R1 | Dummy data sets A to M, role test logins, schema cards | none until a card is tapped |
| R60 | Firm Applications, Dashboard, Firms | 38 |
| R56 | Support, Notifications, Pipeline, Sales Center, Integrations, then Billing, Subscriptions | 26 |
| R55 | Communications, Reports & Analytics, System Settings, Team, Audit & Security | 37 |

A session finishes its open PRs before starting here. Shared pieces are built by the first session that needs them: date-range control (R56, with SA-SUP-R1), list state (R60, with SA-APP-F11), header (R60 search, R56 bell: agree on one PR), record-link helper (R55, with SA-AUD-R5).
