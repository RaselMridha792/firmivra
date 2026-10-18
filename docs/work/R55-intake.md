# R55: Intake Forms workspace API

Contract: `packages/types/src/intake/workspace.ts` and `workspace-client.ts` (R37). Module: `apps/api/src/intake-workspace/` (the assigned-form routes `GET /business/intakes/summary` and `GET /business/intakes` are in `apps/api/src/intake/intakes.controller.ts`, before `:id`).

## Steps

- [x] 1. The forms sent (summary, table with tabs and filters), the form library (list, summary, one form) and the settings (get, update, reset, recent changes).
- [ ] 2. Send a form (`POST /intakes/send`, with its idempotency key), send drafts, one form's record, notes, update (assignee and dates), resend, remind, archive, the PDF.
- [ ] 3. The form builder: create, save, publish, duplicate and archive a form.

## Progress

- 2026-10-18: step 1.

## Notes

1. A library "form" is an `IntakeTemplate` (id = the template's id) shown with its newest version; the sent form's `form.id` is the same template id, so the `formId` filter matches. Usage is the intakes sent with any version.
2. The category tab comes from the service kind (`ANNUAL_TAX` Personal Tax, `QUARTERLY_TAX` Business Tax, Bookkeeping, Payroll, Tax Planning, `BUSINESS_DEVELOPMENT` Advisory, else Other). `isTemplate` is the service's default form; `custom` is a form a person made (not Firmivra's).
3. The form engine's steps and fields are shown as sections and questions: a grid or a repeating group shows as a section break, and only an "equals" condition is shown. The builder cannot yet save these back (step 3).
4. Assigned forms: a draft (send setup not sent) and an archived form are not listed. Staff see forms of their own clients, their own leads, and forms assigned to them.
5. Settings: one row per firm, created on the first read. `mobileFriendly` is always true; HEIC, DOC, XLS and CSV are refused (the platform accepts PDF, JPG, PNG, XLSX and DOCX, up to 10 MB). A final reminder cannot come before the first. Owner and Admin change; the recent changes are read from the audit log (sections only, never values).
6. A test reminder answers 503 `TEST_REMINDER_UNAVAILABLE`: the notifier sends events about records, not ad hoc messages.

## Needs from others

- Tables for assigned-form notes and events (`FormNote`, `AssignedFormEvent`), send drafts and the settings change list are not in the schema. Notes and the history can come from the audit log and the intake's own dates; send drafts need a table (R0) or can be kept as DRAFT intakes once a recipient is chosen. To decide in step 2.
