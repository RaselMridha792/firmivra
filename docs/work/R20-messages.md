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
- [x] 6. Notices: `message.received` bell item and email (one name), on #159 and #160
- [x] 7. Isolation sweep; route list to R21 for the isolation suite

## Defaults taken (open questions, sent to the Scrum thread with the contract PR)
- Private notes in the audit log (Owner and Admin read it): the save and the reminder change are logged with no note id, text or date.
- Email floods: no second `message.received` email for a thread while the recipient still has an unread message in it.
- SPOUSE and AUTHORIZED logins read and send messages, as the database allows.
- Internal notes: the author edits and deletes; Owner and Admin may too.
- Attachments: in the schema, not in the API until the Scrum thread asks.

## Routes for the isolation suite (R21)
Firm (`x-business-id`; Owner/Admin all clients, Staff assigned only, else 404):
- `GET /business/message-threads`, `GET /business/message-threads/unread-count`
- `GET|POST /business/clients/{id}/message-threads`
- `GET|PATCH /business/message-threads/{id}`, `POST .../{id}/messages`, `POST .../{id}/read`, `POST .../{id}/unread`
- `GET|POST /business/clients/{id}/notes`, `PATCH|DELETE /business/notes/{id}` (other Staff's note: 403)

Portal (client and login from the session; another client's thread 404):
- `GET|POST /portal/{slug}/me/messages`, `GET .../unread-count`, `GET .../{id}`, `POST .../{id}/messages`, `POST .../{id}/read`, `POST .../{id}/unread`
- `GET|PUT /portal/{slug}/me/notes`, `PUT|DELETE /portal/{slug}/me/notes/reminder` (owner's actor scope only)

Covered in `apps/api/test/e2e/messages.e2e.test.ts` and `notes.e2e.test.ts`: firm B by id and by client id, unassigned Staff, client Y in the same firm, a firm A client at firm B's portal, internal notes absent from every portal response, private notes invisible to staff routes, the spouse and the database with no actor.

## Needs from others
- R15: `docs/work/R11-intake-messages.md` (lines 6-8 and step 6) still lists the messages paths. R15 handed them to R20 on Oct 9 and adds "moved to R20 on Oct 9" under R11 step 6 in its next docs change.

## Progress log
- Oct 9: contract (step 1) on `rasel/r20-messages-ui8jcx`, PR #168.
- Oct 9: threads, read state and unread counts (steps 2-3) on `rasel/R20-threads`, PR #177.
- Oct 9: internal notes and private notes with reminders (steps 4-5) on `rasel/R20-notes`.
- Oct 9: notices (step 6) on `rasel/R20-notices`, built on #159 and #160 (merged into the branch); PR opens once both are on main.
- Oct 9: isolation sweep (step 7): cases in the two e2e files; route list above, sent to R21.
