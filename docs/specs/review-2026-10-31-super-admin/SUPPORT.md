# Super Admin review (Oct 31): Support change list

Source: "Support Developer Feedback" (Review One, Oct 31, 2026, through about 16:49 UTC) against the Support Module Developer Instructions (9 pages). One authorized QA ticket, #1001, was created, noted, assigned, resolved and closed. Her codes are kept (R1, C1, Y1 ...).

## Summary

1. F items: 1 (SA-SUP-R1). Y items: 9 (C1, C2, Y1 to Y7). GREEN: 13 checks (G1 to G13) plus 8 settings observations, not items. Keep them working and re-test them at Review 2.
2. Her priority 1: Created Date filter retention and validation (R1). Priority 2: notification routing and delivery, the remaining lifecycle paths, SLA rules, server safeguards and privacy.
3. Keep ticket #1001 (QA test firm, Closed, one internal note) and its history. Do not delete or edit it.
4. Schema: none.
5. Role checks: the 3-role, 11-action Support permission matrix must be enforced on the server (Y6); staff-only notes never reach client views, exports or APIs (Y5).
6. Shared: R1 is fixed in the `packages/ui` date-range control, which also fixes SA-SUB-C2, SA-NOT-N02, SA-INT-R4 and the custom ranges in Dashboard and Billing.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/support/`. API: `apps/api/src/admin-support/`. DB: `SupportTicket`, `SupportTicketMessage`, `SupportTicketNote`, `SupportTicketEvent`, `SupportSettings`, `SupportEscalationRule`, `SupportNotificationRule`, `SupportCannedResponse`.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-SUP-R1 | R1 (date retention; coverage limit) | Support list > Filters > Created Date | Oct 1 to 31 entered, both inputs filled; Apply closed the panel with no chip or count; reopening showed both blank. Same with Tab after each input. A reversed range also cleared with no message. | Keep valid ranges after Apply: show an active chip ("Created: Oct 1 to Oct 31, 2026") and count it in "Filters (n)". Reject a reversed range inline ("End date is before start date") and keep the entered values. Works with the date picker and keyboard typing. Apply the same to Last Activity. Keep the filter in the URL so reload and pagination keep it. Then test results against known tickets (inclusive ends, timezone). | No. | Shared: date-range control. Seed: tickets on range boundaries (set F). |

## B. Y items: clarifications

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SUP-C1 | C1 | SLA after resolving with no public first response (#1001 showed "Met") | Default: first response and resolution are separate targets. Resolving never satisfies first response. A ticket resolved without a public reply shows "First response: none" and the SLA badge reads "Resolution met" instead of "Met". Internal-source tickets have no first-response target. |
| SA-SUP-C2 | C2 | Admin notification delivery not proven | Default: route test notifications only to the controlled QA inbox; record the provider message id and result in the delivery log; check receipt in that inbox. Customer and assignee suppression stays separate from admin notices. |

## C. Y items: Review 2 tests (her Y1 to Y7)

Fixtures are dummy data set F in CHANGE-LIST.md.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SUP-Y1 | Y1 | Creation safeguards | API tests: required fields, unique numbering, duplicate-submit protection, rollback on failure. |
| SA-SUP-Y2 | Y2 | Replies and delivery | Formatted replies with attachments to the controlled QA recipient; inbound reply threading; canned response insertion never sends by itself; no duplicate sends with Communications. |
| SA-SUP-Y3 | Y3 | Remaining lifecycle | Reopen, merge (with a second fixture ticket), escalation, priority and category changes; merge keeps messages, notes, attachments and both ticket numbers. |
| SA-SUP-Y4 | Y4 | Assignment and SLA | Eligible and inactive staff, round robin, reassignment, breach triggers, weekends, holidays, business vs calendar time, DST (Nov 1, 2026); fake clock. No notice to unrelated staff. |
| SA-SUP-Y5 | Y5 | Files and privacy | 10 MB limit, type and scan checks; staff-only notes hidden from client views, exports and APIs; tenant separation; owner-only workspace rule respected. |
| SA-SUP-Y6 | Y6; "Channel precedence" | Settings saves, permissions, channel precedence | Save, deactivate and reactivate settings keeping old references; server checks on the 11 actions. Default for precedence: a global channel switch that is OFF wins over any escalation rule (critical SMS does not send while global SMS is OFF), per the System Settings precedence contract (SA-SYS-F8). Show a warning on the escalation rule when its channel is globally off. |
| SA-SUP-Y7 | Y7 | Populated UI and reports | At least 12 tickets for paging; search fields, filter combinations, sorting, kept query state; volume, source, assignee, SLA, response, resolution, reopen and escalation metrics; keyboard and responsive checks. |

## D. Schema needs

None.

## E. Role and permission notes

No role change. Server enforcement of the Support permission matrix (Y6) and of staff-only notes (Y5), proven with the Support staff test login (set L).
