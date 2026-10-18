# R56: Communications module

The Communications screens on the R55 contract (`api.communications`, `createCommunicationsClient`, #731) with a mock written here. Designs: `docs/mockups/firm-workspace/communications/source/` (`communications.jpg`, `new-comunication-menu.jpg`, `create-new-communication-composer.jpg`, `choose-recipients-and-segments.jpg`, `communication-details-and-results.jpg`) and the developer guide docx. Branch `rasel/R56-communications` from `origin/main`, with the #731 contract branch and `rasel/R56-templates` merged in (the composer's "Use a Template" and "Save as Template" use `api.templates`). Web port 3560. Conventions: `docs/work/R56-tasks.md`.

## Owned paths

`apps/web/src/app/firm/(workspace)/communications/**` (new routes), `apps/web/src/mocks/communications.ts` (new mock), the `communications` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Communications leaves the "module not built" list), `apps/web/e2e/mock/r56-communications.spec.ts`, `r56-screenshots/cm-*`.

## Routes

| Route                          | What                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/communications`              | Overview: New Communication menu, five quick cards, eight tabs (Messages and Templates link to their modules), four KPIs, Recent Communications, Start a New Communication, right rail; list tabs; Segments & Lists |
| `/communications/new?channel=` | Makes the draft (opening the menu alone creates nothing), then opens the composer                                                                                                                      |
| `/communications/[id]/edit`    | Composer for Email, Text Message and Announcement; Choose Recipients modal; Send Test; Use a Template; Review & Send                                                                                   |
| `/communications/[id]`         | Details & Results: KPIs, Overview, Recipients, Activity, Message and Settings tabs, right rail, Duplicate, Save as Template, Send Follow-Up, Resend to Failed, Export, Archive                           |

## Run it

| State           | Command                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| With data       | `NEXT_PUBLIC_API_MOCK=all NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=communications`                            |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,templates`                                                   |

## Steps

- [x] 1. Mock `communications` (every call of the contract; ~120 clients and 30 leads, nine segments, twelve communications)
- [x] 2. Overview and list tabs
- [x] 3. Composer, Choose Recipients, Review & Send
- [x] 4. Results and segments
- [x] 5. Mock spec (9 tests), three states, 375 px

## Needs from others

- **Nothing is ever sent** in the mock; a "sent" campaign gets made-up recipients and results from its audience.
- **KPIs**: the design shows message counts with 30-day trends; the contract gives campaign counts and no trend. "Emails Sent" and "Texts Sent" are the numbers of sent email and text campaigns, and no trend arrows are shown.
- **Recipient table**: "Opened" is Yes/No (the contract has an open count, not the first-open time).
- **Message preview** is plain text with sample data; the design's branded email header needs the Branding settings of Templates.
- **Segment list tabs of Choose Recipients** (Client Services, Client Status) show the saved segments that fit; the contract has no separate service or status catalogue.
- **Add Exclusions** opens All Contacts, where each contact has Exclude/Include.
- **Choose Recipients saves the audience as it changes** (so the counts are the server's); Cancel puts it back.
- **Static lists** are created from a sample of up to 25 contacts; the contract has no candidates call outside a communication.
- **Dialog width**: the kit's Modal has one width; the recipients modal stacks the groups as a row above the list.
- **Time zone** is shown, not editable (the contract has no time-zone field on a communication).

## Progress log

- 2026-10-18: Communications built on the #731 contract with a new mock; 9-test spec passes; screenshots committed.
