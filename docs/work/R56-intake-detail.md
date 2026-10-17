# R56: Intake Form submission detail

Six routes under `apps/web/src/app/firm/(workspace)/intake-forms/[id]/` built from `docs/mockups/firm-workspace/intake-forms/source/intake-form-detail-submission-view.jpg` and the docx in the same folder, on the `api.intakeForms` mock. Branch `rasel/R56-intake-detail`, web port 3560.

## Owned paths

`intake-forms/[id]/**`, `apps/web/src/mocks/intake-forms-answers.ts` (new; `intake-forms.ts` calls it for the answers, one line), `apps/web/e2e/mock/r56-intake-detail.spec.ts`, `apps/web/e2e/mock/r56-screenshots/i-*`. Not touched: `builder/`, `templates/`, `send/`, `settings/`, `intake-forms/page.tsx`.

## Run it

| State           | Command                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=intakeForms,me,notifications,team,staff NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev`, open `/intake-forms/0199c0d0-0a00-7000-8000-000000000003` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=intakeForms`                                                                                                                                                  |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff` (the shell needs `me`)                                                                                                                               |

## Steps

- [x] 1. `/intake-forms/[id]` Overview
- [x] 2. `/intake-forms/[id]/responses`
- [x] 3. `/intake-forms/[id]/documents`
- [x] 4. `/intake-forms/[id]/communication`
- [x] 5. `/intake-forms/[id]/notes`
- [x] 6. `/intake-forms/[id]/history`
- [x] 7. Mock e2e spec, three states and 375 px checked, PR opened

## Needs from others

- **Edit links** on the Overview cards (Personal Information, Dependents, Income, Deductions, Bank): the contract has no way for the firm to change a client's answers (`api.intakeForms` has `requestRevision` only). They show as quiet, non-clickable "Edit" text; Request Revision is the way back to the client.
- **Bank / Refund Information** and the design's **Income Documents amounts**: the Annual Tax form definition has no bank, refund or income-amount fields (Income is yes/no questions). The bank card shows its frame with "This form does not ask for bank or refund details"; the Income card lists the yes/no answers.
- **Opening or downloading an uploaded file**: `FormDocument` has no link or download call, so the row menu is a quiet icon and the Documents tab lists name, question, date and scan result only.
- **Per-document and per-note menus** (the design's three-dot buttons): no contract call to delete or edit a note or file.
- **Send Follow-Up** uses `remind` (open forms only; others get the API's 409 message). There is no "follow-up to a submitted form" call.
- **Export PDF**: the mock returns a text file link; the real PDF comes with the API.
- **Communication** tab: the contract's `communications` list holds sends, resends and reminders only (no replies, no message bodies).
- The design's **Date of Birth**, **Filing Status** etc. come from the form definition; a firm's custom form without those keys shows "Not provided" in the Personal Information card.

## Progress log

- 2026-10-17: all six tabs built; mock answers added in `intake-forms-answers.ts`; spec passes; screenshots committed.
