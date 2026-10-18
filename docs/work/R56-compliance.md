# R56: Compliance & Deadlines module

The Compliance screens on the R57 contract (`api.compliance`, PR #719) with a mock written here. Designs: `docs/mockups/firm-workspace/compliance/source/` (`compliance-and-deadlines.jpg`, `add-edit-deadline.jpg`, `recurring-deadline-and-government-calendar-setup.jpg`) and the developer guide docx. Branch `rasel/R56-compliance`, web port 3560. This branch contains the commits of #719 until that PR merges. Conventions: `docs/work/R56-tasks.md` (handoff section).

Queue (Scrum thread, 2026-10-17): Compliance, Payroll, Bookkeeping, Templates, Automations, Communications. Integrations, Reports, Tax Planning and Business Advisory go to a new developer; do not build them.

## Owned paths

`apps/web/src/app/firm/(workspace)/compliance/**` (new routes), `apps/web/src/mocks/compliance*.ts` (new mock, three files), the `compliance` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Compliance leaves the "module not built" list), `apps/web/e2e/mock/r56-compliance.spec.ts`, `r56-screenshots/c-*`.

## Routes

| Route                                                       | What                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/compliance`                                               | Overview: six cards, seven views (Overview, All Deadlines, By Client, By Type, Government Calendars, Recurring, Completed), filters, table with row menu and bulk bar, Deadline Calendar, Types, At Risk, Quick Actions, Resources; the Tax Calendar button (month grid) and the Settings dialog |
| `/compliance/new`                                           | Add Deadline (sections 1 to 6, Deadline Summary)                                                                                                                                                                         |
| `/compliance/[id]`                                          | One deadline: actions, facts, dates (statutory, extension, payment, override reason), calendar source, reminders, tasks, documents, related deadlines, notes                                                            |
| `/compliance/[id]/edit`                                     | Edit Deadline, the same form                                                                                                                                                                                             |
| `/compliance/recurring/new` (`?tab=import, library, rules, manage or logs`, `?edit=<id>`, `?from=<deadlineId>`) | Recurring Deadline & Government Calendar Setup in six tabs                                                                                                                                  |

## Run it

| State           | Command                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=compliance,clients,engagements,documents,taskWork,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=compliance`                                                                                                                                   |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff`                                                                                                                                      |

## Steps

- [x] 1. Mock `compliance` (every call of the contract)
- [x] 2. Overview, views, Tax Calendar, Settings
- [x] 3. Add and Edit Deadline, deadline detail
- [x] 4. Recurring setup, Import, Library, Rules, Manage, Logs
- [x] 5. Mock spec (10 tests), three states, 375 px, PR

## Needs from others

- **Attachments**: the contract attaches a client's existing document by id (no upload). The form shows the drop zone as a quiet frame; documents are added from the client's list under Related Items.
- **Description formatting**: the toolbar (bold, italic, lists, link) is not built; description is plain text up to 2000 characters.
- **Quick Templates** are the firm's saved templates (recurring definitions saved "as template"), not a built-in list. **Resources** are the official source links of published calendars; the design's "Filing Guides" and "Compliance Checklist" have no data source and are not built.
- **Task template per deadline type** (settings `taskTemplates`) has no control in the Settings dialog yet.
- **Applicability rules** made in the Setup form are saved as one rule on the new recurring deadline; changing a rule afterwards is done in the Applicability Rules tab (create, switch on or off, check, generate). Editing a rule's criteria is not built.
- **Create recurring deadline (checkbox on Add Deadline)** saves the deadline, then opens the setup form prefilled from it; there is no single call that does both.
- **Mock ids**: the team mock's people have their own ids; the compliance mock accepts any member id and shows the team mock's name.

## Progress log

- 2026-10-17: Compliance built on the #719 contract with a new mock; 10-test spec passes; screenshots committed.
