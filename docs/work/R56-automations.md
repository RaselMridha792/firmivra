# R56: Automations module

The Automations screens on the R55 contract (`api.automations`, PR #730, branch `rasel/R55-automations-contract`) with a mock written here. Designs: `docs/mockups/firm-workspace/automations/source/` (`automations.jpg`, `create-automation-rule.jpg`, `automation-logs-and-rule-activity.jpg`) and the developer guide docx. Branch `rasel/R56-automations`, web port 3560. This branch contains the #730 contract commits and the Templates branch (`rasel/R56-templates`, whose mock the template pickers use) until those merge. Conventions: `docs/work/R56-tasks.md` (handoff section).

Queue (Scrum thread): Templates, Bookkeeping, then Automations and Communications (contract #731). Integrations, Reports, Tax Planning and Business Advisory go to a new developer.

## Owned paths

`apps/web/src/app/firm/(workspace)/automations/**` (new routes), `apps/web/src/mocks/automations.ts` (new mock), the `automations` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Automations leaves the "module not built" list), `apps/web/e2e/mock/r56-automations.spec.ts`, `r56-screenshots/au-*`.

## Routes

| Route                    | What                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/automations`           | Overview and Manage Rules: five cards (health included), categories with counts, the rules table with an on or off switch and a menu, How It Works, Popular Templates, Quick Actions |
| `/automations/new`       | Create Automation Rule: five steps on one page, a live review (checks, planned actions, match count), Rule Summary, Affects, Related Templates                                        |
| `/automations/[id]/edit` | The same builder on a saved rule: each save of the steps is a new version                                                                                                             |
| `/automations/logs`      | Logs & Rule Activity: counts, filters, the run table, Log Details with Action Log, Rule Configuration, Related Records, Re-run, Export Logs, and the rule behind the run              |
| `/automations/templates` | Automation templates: use, export, import, archive, install starters                                                                                                                  |

## Run it

| State           | Command                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=automations,templates,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=automations`                                                                                                   |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff`                                                                                                       |

## Steps

- [x] 1. Mock `automations` (every call of the contract, a catalog of 16 events and 8 actions)
- [x] 2. Overview and rule menu
- [x] 3. Rule builder
- [x] 4. Logs and run details
- [x] 5. Templates page, mock spec (8 tests), three states, 375 px, PR

## Needs from others

- **Categories** are the contract's modules (17), not the design's groups (Deadline Based, Task Creation…); the design's category tabs are the two tabs Overview and Manage Rules plus the category list.
- **Conditions** cannot be reordered (the design has drag handles) and a condition's value is one choice or text, not several chips.
- **The match count is counted by the mock** from the number of conditions; it is never run. The real API does it from the firm's records.
- **Internal Notifications** card of the design has no counterpart in the contract; the fourth card is Time Saved (the contract's) and the fifth is Automation Health.
- **Template pickers** read active email, SMS, portal and document-request templates marked "Include in Automations" from `api.templates`.
- **Import Template** takes pasted text of an exported file (there is no file upload call).
- **Export Logs** shows the file name and row count; the download link is the API's signed link.
- **Save as Template on a new rule** saves the rule as a draft first.

## Progress log

- 2026-10-18: Automations built on the #730 contract with a new mock; 8-test spec passes; screenshots committed.
