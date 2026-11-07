# Super Admin review (Oct 31): Sales Pipeline change list

Source: "Pipeline Developer Feedback" (Oct 31, 2026, 13:07 to 13:10 UTC, `/sales/pipeline`, zero opportunities) against the Sales Pipeline Developer Instructions (13 pages). Her codes are kept (PL 01 becomes PL01). Her unnumbered AMBER tables are ours: SA-PIP-Y01 to Y04. Sales Center (`/sales`) has its own list.

## Summary

1. F items: 1 (SA-PIP-PL01). Y items: 6 (PL02, PL03, Y01 to Y04). GREEN: 9 checks, not items (navigation and board, six KPI clicks, card and list views, filters and Clear, date and analytics controls, Add Lead and Opportunity, lost reason preview, Build Pipeline, activity and appointments). Keep them working and re-test them at Review 2.
2. Highest priority: accessible names (PL01). Everything else waits for dummy sales records (Y03) and the metric definitions (Y01).
3. The guide's written lifecycle wins over labels in its trial-oriented mockup (her note, guide page 13). Do not add a real-estate workflow.
4. Schema: none. Stage requirements (`required_fields` such as "transaction", "lost_note") and attention settings already exist.
5. Role checks: Super Admin, Manager and User scopes enforced on the server (Y04 test 15).
6. Shared: the date popup's accessible names are fixed in the shared `packages/ui` date-range control.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/sales/` (pipeline route). API: `apps/api/src/admin-sales/`. DB: `SalesPipeline`, `SalesPipelineStage` (entry requirements), `SalesOpportunity` (value, lost reason, linked transaction), `SalesStageHistory`, `SalesAssignmentHistory`, `SalesAttentionSettings`.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-PIP-PL01 | PL 01 (guide page 11, section 26) | "More Ways To Add" menu; date popup | Menu shows Add Lead, Add Opportunity and Build Pipeline, but the accessibility tree has two unnamed buttons and an unnamed builder link. The date popup has unnamed fields and buttons despite visible labels. | Give each control an accessible name that matches its visible label (Add Lead, Add Opportunity, Build Pipeline; Start date, End date, Previous month, Next month, Apply). Check keyboard focus order and screen-reader output. Fix the date popup in the shared component so every screen benefits. | No. | Shared: date-range control. |

## B. Y items

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-PIP-PL02 | PL 02 (guide pages 6 to 7, sections 12 to 14) | Add Lead allows Starting Stage "Under Contract" with no linked transaction | Default: in Firmivra the linked transaction is the firm's platform subscription. Under Contract and Closed / Past Client are transaction-driven, so Add Lead no longer offers them as starting stages; moving a card into them requires a linked subscription and shows "Link a subscription first" otherwise (the stage's existing "transaction" requirement, enforced on the server). Under Contract = subscription signed and awaiting first payment; Closed / Past Client = subscription ended; a terminated contract returns the card to Nurturing. |
| SA-PIP-PL03 | PL 03 | Lost column presentation; empty filtered wording | Default: show Unqualified / Lost as a side exit, visually separated from the nine-stage path (divider and an "Exit" label). A filtered empty board says "No opportunities match these filters" with a Clear filters button; "No opportunities yet" only when there are none at all. |
| SA-PIP-Y01 | "Metric definitions to reconcile"; "Written lifecycle" | Formulas and thresholds | Default definitions, documented in the PR: Total Opportunities = open opportunities in scope (not Lost, not Closed); In Progress = stages New Lead to Nurturing; Pipeline Value = sum of entered values of open opportunities, missing values excluded and counted ("3 without value"); Conversion Rate = opportunities that reached Active Client in the period / opportunities created in the period, the same formula on Sales, Pipeline and Reports; Active Clients = opportunities in Active Client or later successful stages; Needs Attention = any of: follow-up overdue, no contact 3 days after creation, no response 7 days after last outreach, unassigned, no activity for 14 days (values in `SalesAttentionSettings`). Badges and the KPI use the same rules. |
| SA-PIP-Y02 | "Source acceptance checklist" (guide section 28) | 18 acceptance items | Test each at Review 2 against dummy records; record pass, fail or blocked per item. |
| SA-PIP-Y03 | "Review Two with dummy sales records" | Fixtures | Dummy data set J in CHANGE-LIST.md: records in all nine stages plus Lost, values (some missing), assigned and unassigned, each attention condition, tags, sources and plans, linked subscriptions, activity, appointments, duplicate candidates, an occupied custom stage, boundary dates. No real contact is notified. |
| SA-PIP-Y04 | "Required end to end flows" (guide section 27, tests 1 to 15) | End-to-end tests | Run all 15 after Y03, with the Manager and User test logins (set L) for tests 13 and 15. Also required-field and duplicate checks, reload persistence, custom dates, record links, error and no-permission states, keyboard. |

## C. Schema needs

None.

## D. Role and permission notes

No role change. Scope by role (Super Admin, Manager, User) and tenant isolation checked on the server (Y04).
