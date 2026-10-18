# R56: Templates module

The Templates screens on the R55 contract (`api.templates`, `createTemplatesClient`, merged in #717) with a mock written here. Designs: `docs/mockups/firm-workspace/templates/source/` (`templates-page.jpg`, `template-category-library.jpg`, `create-edit-template.jpg`) and the developer guide docx. Branch `rasel/R56-templates` from `origin/main`, web port 3560. Conventions: `docs/work/R56-tasks.md` (handoff section).

Queue (Scrum thread, 2026-10-18): Templates, Bookkeeping (merge #718 if it has landed, else use the contract on main), then Automations and Communications once R55's contract PRs exist. Integrations, Reports, Tax Planning and Business Advisory go to a new developer.

## Owned paths

`apps/web/src/app/firm/(workspace)/templates/**` (new routes), `apps/web/src/mocks/templates.ts` (new mock), the `templates` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Templates leaves the "module not built" list), `apps/web/e2e/mock/r56-templates.spec.ts`, `r56-screenshots/tp-*`.

## Routes

| Route                       | What                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/templates`                | Home: four views, category and search, the sixteen kind cards with live counts, Recent Templates, Template Tools (Create, Import, Merge Fields, Branding & Letterhead, Template Categories), Quick Tips, starter install |
| `/templates/library/[kind]` | One kind (`email`, `sms`, `portal-message`…): subcategory tabs, category sidebar with counts and Add New Category, filters, the table with favorite, Preview, Use, the menu and the bulk bar                       |
| `/templates/new?kind=EMAIL` | Create Template                                                                                                                                                                                                   |
| `/templates/[id]/edit`      | Edit Template: content, merge-field panel that inserts at the cursor, attachments, settings and sharing, tags, version history, automation warning                                                                |

## Run it

| State           | Command                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| With data       | `NEXT_PUBLIC_API_MOCK=templates,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev`        |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=templates` (no templates; "Install starter templates" fills the 48 of the guide)                       |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff`                                                                                               |

## Steps

- [x] 1. Mock `templates` (every call of the contract, the 48 starters of the guide)
- [x] 2. Home and the tools
- [x] 3. Library
- [x] 4. Create and Edit
- [x] 5. Mock spec (10 tests), three states, 375 px, PR

## Needs from others

- **Use** opens the module page `/modules/communications?template=<id>` (not built); the contract has no "use" call, and a use is counted when a message is sent.
- **Attachments** need a saved template (the contract uploads against a template id); the editor shows a quiet frame until the first save.
- **Editor chips**: the design shows merge fields as highlighted chips inside the text; the kit editor keeps them as plain `[Field Name]` text. The **Personalize** menu of the toolbar is the Merge Fields panel.
- **Preview and Test Send** need a saved template (the contract renders by id); they are disabled until then.
- **Sixteen kinds**: the contract has an Announcement kind that the home design does not show; it has its own card.
- **Quick Tips** are fixed guidance text (the guide says they may be admin-managed later).
- **Merge-field chips in Subject**: Insert at the cursor works in the subject and the body; the design's "Insert Merge Field" drop-down is the panel on the right.

## Progress log

- 2026-10-18: Templates built on the #717 contract with a new mock; 10-test spec passes; screenshots committed.
