# R55: Intake Forms workspace API

Contract: `packages/types/src/intake/workspace.ts` and `workspace-client.ts` (R37). Module: `apps/api/src/intake-workspace/` (the assigned-form routes under `/business/intakes` are in `apps/api/src/intake/intakes.controller.ts`, static ones before `:id`).

## Steps

- [x] 1. The forms sent (summary, table with tabs and filters), the form library (list, summary, one form) and the settings (get, update, reset, recent changes).
- [x] 2. Send a form (`POST /intakes/send`, with its idempotency key), send drafts, one form's record, notes, update (assignee and dates), resend, remind, archive, the PDF.
- [x] 3. The form builder: create, save, publish, duplicate and archive a form.

## Progress

- 2026-10-18: step 1 (#781).
- 2026-10-18: steps 2 and 3 (branch `rasel/R55-intake-step2`).

## Notes

1. A library "form" is an `IntakeTemplate` (id = the template's id) shown with its newest version; the sent form's `form.id` is the same template id, so the `formId` filter matches. Usage is the intakes sent with any version.
2. The category tab comes from the service kind (`ANNUAL_TAX` Personal Tax, `QUARTERLY_TAX` Business Tax, Bookkeeping, Payroll, Tax Planning, `BUSINESS_DEVELOPMENT` Advisory, else Other). `isTemplate` is the service's default form; `custom` is a form a person made (not Firmivra's).
3. The form engine's steps and fields are shown as sections and questions: a grid or a repeating group shows as a section break, and only an "equals" condition is shown (a choice's condition by the option's label).
4. Assigned forms: a draft (send setup not sent) and an archived form are not listed. Staff see forms of their own clients, their own leads, and forms assigned to them.
5. Settings: one row per firm, created on the first read. `mobileFriendly` is always true; HEIC, DOC, XLS and CSV are refused (the platform accepts PDF, JPG, PNG, XLSX and DOCX, up to 10 MB). A final reminder cannot come before the first. Owner and Admin change; the recent changes are read from the audit log (sections only, never values).
6. A test reminder answers 503 `TEST_REMINDER_UNAVAILABLE`: the notifier sends events about records, not ad hoc messages.
7. Send: clients only, by Portal or Email, both through R6's Notifier (`intake.sent`: the bell and its email copy to the client's portal logins). No login reached: the form stays sent and `delivery.status` is FAILED. SMS is 400 `SMS_UNAVAILABLE`; a lead or a new contact is 503 `LEAD_LINK_UNAVAILABLE` (no secure link page; `access_token_hash` is unused). Retry-safe: an advisory lock on the key and the `intake.sent` audit row (written in the transaction) that carries it. One open copy per engagement and form (409 `FORM_ALREADY_OPEN`). Expiration defaults: the form's `expiresAfterDays`, then the firm's. The subject and message are stored; the Notifier never sends caller text. `sendMeCopy` is accepted and not acted on.
8. Send drafts are DRAFT intakes (R37), so a draft needs a client or lead and a published form; a new recipient or form on a saved draft starts a new draft (the old one is archived) and the answer carries the new id. Sending promotes the member's own draft of the same form version. The portal never shows an intake with no `sent_at` (list, one form, uploads, agreements).
9. Record: history from the intake's audit rows (sent, resent, reminder, opened by the recipient, saved, submitted, review, revision, completed, assigned, dates, archived), plus what only the intake's own dates and documents show. Communications are the sends and reminders. Progress counts the shown questions (uploads by their files or "not available").
10. Remind uses the same `intake.sent` notification as a send (there is no reminder text in R6's events yet).
11. Builder: a section is a step with one section (more than 10 share the 10 steps); a question whose key and type match an existing field keeps the engine's details (SSN type, grid, group, option codes). Saving a published form starts the next draft version; publish checks the engine's schema (400 `FORM_INCOMPLETE`) and retires the old live version. The description is the definition's `subtitle`; Form Settings ride in the definition as `formSettings`. SIGNATURE questions are refused (the form is signed on submit). The detail shows the newest version (a draft over a published one).
12. Export PDF: pdf-lib, standard font, SSN/EIN as their last four, file names only; under `tenant/<business>/reports/` with a 5-minute link (503 `FILE_STORE_UNAVAILABLE` if the store fails).

## Needs from others

- **Schema (R0):** `form_notes` (assigned-form notes: intake, author, text, time); `assigned_form_events` (only if the audit-log history is not enough); `intake_send_drafts` (a draft with no recipient yet, or a new contact); per-form settings columns (today in the definition JSON).
- **Notifications (R6):** an `intake.reminder` event and text; an ad hoc "copy to me" email.
- **Leads:** the secure link page for lead recipients (`access_token_hash`), then lead sends.
- **SMS:** an SMS sender for intake forms.
