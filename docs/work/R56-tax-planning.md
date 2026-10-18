# R56: Tax Planning & Strategy (firm workspace)

The firm Tax Planning screens on the R55 contract (`api.taxPlanning`, `createTaxPlanningClient`, merged in #738) with a mock written here. Designs: `docs/mockups/firm-workspace/tax-planning/source/` (`tax-planning.jpg`, `create-edit-planning-plan.jpg`, `planning-opportunity-strategy-review.jpg`) and the developer guide docx. Branch `rasel/R56-tax-planning` from `origin/main`. Web port 3560. These routes were R1's placeholders (Ibrahim's lane I02; nothing of his was on any branch, and Scrum asked R56 to build them).

## Owned paths

`apps/web/src/app/firm/(workspace)/tax-planning/**`, `apps/web/src/mocks/tax-planning.ts` (new mock), the `taxPlanning` entry in `apps/web/src/lib/api.ts` (mock switch), `apps/web/e2e/mock/r56-tax-planning.spec.ts`, `r56-screenshots/tp2-*`.

## Routes

| Route                                        | What                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/tax-planning`                              | Overview: four KPIs, hero and Quick Actions, Recent Planning Clients, Top Planning Opportunities, Upcoming Tax Deadlines, Planning Resources |
| `/tax-planning/clients`                      | Every client with their current plan, filters, and Create Planning Plan                                                                    |
| `/tax-planning/opportunities`                | The screening queue with filters, Run Screening and Add Opportunity                                                                        |
| `/tax-planning/opportunities/[opportunityId]` | Planning Opportunity Details (design 3): estimate, why, data used, impact, actions, documents, add to plan, discussion, assign, dismiss, history, Previous and Next |
| `/tax-planning/strategies`                   | The strategy library (create, edit, archive, restore)                                                                                      |
| `/tax-planning/calendar`                     | Tax deadlines and planning milestones for twelve months                                                                                    |
| `/tax-planning/resources`                    | Guides and checklists, and Send Client Resource                                                                                            |
| `/tax-planning/reports`                      | Projected savings by plan, with the disclaimer                                                                                             |
| `/tax-planning/calculator`                   | Tax Savings Calculator: a baseline and a strategy, result with assumptions, saved scenarios                                                |
| `/tax-planning/plans/new`, `/plans/[planId]/edit` and `/financials`, `/goals`, `/implementation`, `/review` | Create / Edit Planning Plan in five steps (design 2): details, financial overview, strategies with override, implementation, review with versions, finalize and send |

## Run it

| State           | Command                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=all NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=taxPlanning`                                                   |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me`                                                                                |

## Steps

- [x] 1. Mock `taxPlanning` (every call of the contract; ten clients, six plans, twelve library strategies, eighteen opportunities)
- [x] 2. Overview and lists
- [x] 3. Opportunity details
- [x] 4. Plan editor (five steps) and calculator
- [x] 5. Mock spec (7 tests), three states, 375 px

## Needs from others

- **Estimates are never invented**: one the model cannot make shows N/A with its reason; overriding needs a reason; the disclaimer shows wherever an estimate does.
- **Documents of a plan** are attached from the client's existing documents (the contract links a document id); uploading is in Documents. The design's drop zone is therefore a picker.
- **Photos** of clients are not in the contract: initials show instead.
- **Opportunity "Edit Client"** opens the client record. **Send Client Resource** and **Schedule Appointment** use the resources dialog and the calendar page.
- **Schedule Client Discussion** records the date on the opportunity; it does not make an appointment (the contract takes an optional appointment id).
- The savings **Reports** tab lists plans with their projected savings; the contract has no separate report call.

- **Bookkeeping Terms and Transactions** (R0 / R55): still no contract on main (Oct 18). The bookkeeping contract says Terms, transactions, refunds and settlements need tables that do not exist yet; R56 builds them once a schema and contract land.
- **Tax Returns workspace and firm-wide Documents** (R55): no module contract on main yet (checked Oct 18 after #801).

## Progress log

- 2026-10-18: Tax Planning built on the R55 contract with a new mock; 7-test spec passes; screenshots committed.
- 2026-10-18: Messages: "Mark unread" shows only when the thread has a client message (the API answers 409 otherwise) and errors show; r56-messages and nahid-client-messages pass; r17-messages (portal page, not touched here) fails on "Set as reminder".
- 2026-10-18: Audit log and Sign-ups (no design folders): module header, area chips on the log (action prefixes), avatars and plain action labels beside the codes; Sign-ups view counts, avatars and "How approval works". Tumit's, Fahad's and R23's specs still pass; `r56-audit-signups.spec.ts` (2 tests).

## Handoff for a fresh session (written Oct 18, for the next window)

**Done (merged or open, one module per PR):** Compliance #723, Payroll #729, Templates #749, Bookkeeping #750, Communications #762, Automations #771, Reports #780 (merged), and this Tax Planning PR.

**Not built, in order:**
1. **Messages** (firm `/messages`): a three-pane screen is on the local branch `rasel/R56-messages` (commit "wip: firm Messages three-pane screen"). One of my tests fails: after "Mark unread" the "Mark read" button does not show (the open thread comes from the inbox list, whose `unreadCount` the mock does not raise for a firm message). Fix the mock or the button, run `r56-messages` and `nahid-client-messages`, replace the deleted `nahid-messages-inbox.spec.ts` (already replaced by `r56-messages.spec.ts`), open the PR.
2. **Tax Returns workspace**: blocked on R55 (only the small R10 per-client API exists on main). Ask R55 for the module contract first.
3. **Documents** (firm-wide list, folders, requests dashboard, create request, upload): blocked on a firm-wide Documents contract (R55). The existing page is per-client only.
4. **Invoices & Payments**, **Audit log**, **Sign-ups**: the "basic only" pages; check each against `docs/mockups/firm-workspace/` first (Audit log and Sign-ups have no design folder).
5. **Bookkeeping Terms** page and Transactions: need contracts (see the note in `R56-bookkeeping.md`).
Skip Integrations (Ibrahim) and every Super Admin page (Tumit, Arfan).

**Barrel files:** `apps/web/src/lib/api.ts` (one mock switch per module, keep both sides) and `apps/web/src/lib/firm-modules.ts` (remove a module's entry when its screens land, then remove the icon import if unused) and the sidebar in `(workspace)/layout.tsx` conflict on every merge of main: keep both sides, then `pnpm --filter @firmivra/types build`, `tsc --noEmit`, eslint on the changed files and the module's spec.

**Gotchas:** never `git rebase` or force-push; merge `origin/main` before each PR; at most two open PRs. Mocks must not run code at import (lint rule): build fixtures inside the factory. Heredocs with quotes break in the Bash tool: write files with the Write tool. The dev server runs on port 3560 with `restart.sh "<mock modules>" "<empty modules>"`; the mock Playwright config reuses it when `reuseExistingServer` is true (use a temporary copy, never commit it). The Next dev overlay button is named "Next…": use `exact: true` for a "Next" button in specs. A controlled checkbox needs `.click()`, not `.check()`. Screenshots are quantized to 128 colours before commit. No `Co-Authored-By` or "Generated with Claude Code" lines in commits or PRs (CLAUDE.md).
