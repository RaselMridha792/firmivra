# R20: Messages and notes API (Oct 9)

**Goal:** The firm and its clients exchange messages in threads with read receipts and unread counts; the firm keeps internal notes on a client; each client login keeps a private note with an optional reminder that no staff role can ever see; a new message sends an email notice without its text. Split off R11 step 6 (R15) by Rasel's card, Oct 9 09:15 UTC.

## Owned paths
- `apps/api/src/messages/**` (threads, messages, internal notes, private notes)
- `packages/types/src/messages/**`, `apps/web/src/mocks/messages.ts`, `docs/api/messages.yaml`
- Its lines in `apps/web/src/lib/api.ts`, `packages/types/src/index.ts` and `apps/api/src/app.module.ts`
- Its e2e and unit tests

Not R20's: R15's intake, Begin Online and leads; `apps/api/src/notify` (R15's `message.received` email template, #159); `apps/api/src/notifications` (R16); screens (Nahid F10, R17 N09); `packages/db`, `infra`, `.github`.

## Read first
- `CLAUDE.md`, `docs/work/README.md`, `apps/api/README.md`, `docs/api/messages.yaml`
- `docs/specs/NOTES-client-portal.md`: "12. Messages and notes.png" and "D5. Messages & Notes.docx"
- The schema: `MessageThread`, `Message`, `MessageAttachment`, `ClientPrivateNote`, `ClientNoteReminder`, `Note`; migrations `r0_messages`, `r0_note_reminder_access`, `r0_services`

## Steps
- [x] 1. Contract: zod schemas and clients (`api.messages`, `api.clientNotes`, `api.myMessages(slug)`, `api.myNotes(slug)`), mocks, `docs/api/messages.yaml`
- [x] 2. Threads and messages, firm and portal
- [x] 3. Read receipts and unread counts
- [x] 4. Internal notes
- [x] 5. Private notes and reminders
- [ ] 6. Notices: `message.received` bell item and email (one name) (after #159 and #160)
- [ ] 7. Isolation sweep; route list to R0 for R8's suite

## Defaults taken (open questions, sent to the Scrum thread with the contract PR)
- Private notes in the audit log (Owner and Admin read it): the save and the reminder change are logged with no note id, text or date.
- Email floods: no second `message.received` email for a thread while the recipient still has an unread message in it.
- SPOUSE and AUTHORIZED logins read and send messages, as the database allows.
- Internal notes: the author edits and deletes; Owner and Admin may too.
- Attachments: in the schema, not in the API until the Scrum thread asks.

## Needs from others
- R15: `docs/work/R11-intake-messages.md` (lines 6-8 and step 6) still lists the messages paths. R15 handed them to R20 on Oct 9 and adds "moved to R20 on Oct 9" under R11 step 6 in its next docs change.

## Progress log
- Oct 9: contract (step 1) on `rasel/r20-messages-ui8jcx`, PR #168 (merged).
- Oct 9: threads, read state and unread counts (steps 2-3) on `rasel/R20-threads`, PR #177 (merged); client replies lock the thread FOR NO KEY UPDATE (no deadlock on parallel replies).
- Oct 9: internal notes and private notes with reminders (steps 4-5) on `rasel/R20-notes`, PR #184.
- Oct 9: #184 follow-ups on `rasel/R20-notes-fixes`: one private-note transaction per login (advisory lock), a due reminder survives a save, audit rows inside the owner transaction.
