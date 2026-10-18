# Super Admin stage B6: Communications (contract note)

Migration `20261017200000_r0_platform_communications`. This note is for the API session that
builds the Super Admin Communications screens (spec 13): the dashboard and conversation center,
New Message, Templates and Create Template, and Broadcasts (the 4-step flow). It also covers the
dispatcher, inbound mail and SMS, and the file scanner.

**Who it reaches.** This is Firmivra's own correspondence with:
- firms' people (owners, admins, staff)
- sales leads (B5 contacts)
- the Super Admin team

A firm's **clients** are never recipients here; firms talk to their clients in their own
workspace. This is platform data: only the Super Admin team (admin scope) and the platform's jobs
(platform scope) reach it, and no firm scope does.

**Firm deletion keeps the correspondence.** Deleting a firm clears `linked_business_id` on its
conversations and recipients; the threads, messages and results stay as Firmivra's record. The
contact's name and address are kept as they were. Retention of old correspondence is B7's
(retention policies).

## Tables

| Table | What it holds |
| --- | --- |
| `comm_conversations` | a thread with one contact. `contact_type` is `FIRM`, `LEAD` or `TEAM` |
| `comm_messages` | a thread's messages: outbound email or SMS, inbound replies, internal notes |
| `comm_message_recipients` | a message's To, Cc and Bcc, each with its own delivery result |
| `comm_message_mentions` | team members mentioned in an internal note (the Mentions tab) |
| `comm_conversation_reads` | each team member's read mark per thread (the Unread counts) |
| `comm_template_categories` | the template tabs; the migration ships six |
| `comm_templates` | email and SMS templates |
| `comm_media`, `comm_media_links` | the image and attachment library, and where each file is used |
| `comm_segments` | audiences: the API's filter rules in `definition`, plus the last count |
| `comm_broadcasts` | a broadcast to a segment |
| `comm_broadcast_channels` | per-channel content and result: `EMAIL`, `SMS`, `IN_APP` |
| `comm_broadcast_recipients` | per-recipient, per-channel results, resolved at send |

**About `comm_conversations`:**
- A `FIRM` thread names `linked_business_id`, a `LEAD` thread `sales_contact_id`, and a `TEAM`
  thread `contact_user_id`.
- `contact_name`, `contact_email` and `contact_phone` are snapshots.
- `status` is `OPEN` or `CLOSED`; there are also `assigned_to_user_id` and `tags`.
- `last_message_at` is set by the database.

`sales_contact_id` has no foreign key, so B6 does not depend on B5's merge order. It may get one
later.

The six shipped template categories (system keys): `sales`, `onboarding`, `support`, `billing`,
`firm_applications`, `system_notices`. Admins add more and deactivate them, but never delete them.

## The send lifecycle (what the database guarantees)

**Messages**
- **Outbound:** `DRAFT` ⇄ `SCHEDULED` → `SENDING` → `SENT`, `PARTIALLY_SENT` or `FAILED`, and
  `SCHEDULED` → `CANCELLED`.
- **Send now:** write the message as a draft with its recipients, then move it to `SENDING` in the
  same transaction. Recipients are added only while the message is a draft or scheduled.
- **Schedule:** `scheduled_at` must be in the future, with an IANA `scheduled_time_zone`.
- **Locked once sending:** the subject, body, template and schedule change only while the message
  is a draft or scheduled. Once dispatch begins they never change, and neither do the recipients.
- **Deletes:** only drafts are deleted, and their recipients go with them.
- **Retry:** a new message with `retry_of_message_id` set to the failed one, which stays in
  history.
- **Internal notes** (channel and direction `INTERNAL`) are `SENT` when written; mention team
  members in `comm_message_mentions`.
- **Inbound mail and SMS** are written `RECEIVED` (platform scope), with `from_address` and no
  sender.
- **Email:** a subject is required once the message leaves draft. **SMS:** up to 1,600 characters.
- **Stamps:** the database sets the sender (the signed-in team member), `sent_at`, `failed_at` and
  the creation fields. `error_code` and `error_message` come only with a failed or partial send.
- **Double submission:** `idempotency_key` is unique; send the client's key on every send.

**Destinations** (checked per channel)
- Email: a valid address; Cc and Bcc are email only.
- SMS: an E.164 number (`+15125550147`).
- Internal and in-app: a team member (`contact_user_id`).
- Check the destination before send, and show which recipients have none (spec 13, section 8).

**Delivery results**, per recipient: `PENDING` → `SENT`, `FAILED` or `SKIPPED`; `SENT` →
`DELIVERED` or `BOUNCED`.
- The database stamps the times.
- The provider's message id and error code come with the step.
- A partly delivered message is `PARTIALLY_SENT`. Retry only the failed recipients, with a new
  message.

**Broadcasts**
- A broadcast starts as `DRAFT`. Its lifecycle: `DRAFT` ⇄ `SCHEDULED` → `SENDING` → `SENT`,
  `PARTIALLY_SENT` or `FAILED`; `SCHEDULED` → `CANCELLED`; and `FAILED` → `SENDING` for a retry.
- **Sending needs** at least one channel row, a segment, and `recipient_count` > 0. Count the
  segment when the send starts and store the count; the empty-audience warning comes from that
  count.
- **Locked once sending:** the name, segment, schedule and channel content change only while the
  broadcast is a draft or scheduled.
- **Recipients** are inserted by the dispatcher while the broadcast is `SENDING`, one row per
  recipient per channel, and only on one of its channels.
- **A retry** puts `FAILED` recipients back to `PENDING` (only while the broadcast sends). Write
  an audit row for the first attempt before retrying.
- **Per-channel results:** each channel row moves `DRAFT` → `SENDING` → `SENT`, `PARTIALLY_SENT`
  or `FAILED`, with `sent_count` and `failed_count`. Never mark the broadcast `SENT` when a
  channel failed: use `PARTIALLY_SENT`.
- **Deletes and archiving:** only drafts are deleted. A finished or cancelled broadcast is archived
  once (`archived_at`, stamped).
- **Recipient history:** when a broadcast email or SMS also belongs in a recipient's history,
  write a message in their conversation with `broadcast_id` set, and link it from the recipient
  (`message_id`, set once).
- **Test sends** are not stored as sends. Write an audit row labelled as a test, and leave the
  status alone.

**Templates and files**
- An email template needs a subject; an SMS template has none and stays within 1,600 characters.
- `merge_fields` lists the tokens the template uses, written without braces (`firm.name`,
  `contact.first_name`). They come from the API's central list; in the body they appear as
  `{{firm.name}}`.
- Templates are archived, never deleted. The database stamps who created and last changed one.
- **Library files:**
  - stored under `platform/communications/<file id>/` in S3
  - at most 10 MB; inline images are PNG, JPEG, GIF or WebP
  - the upload never changes; the scanner (platform scope) records the scan result once
  - a file is used as the kind it was uploaded as, never once a scan found it unsafe, and only
    while its message or broadcast is editable
- Send only `CLEAN` files.

**Segments:** the database stamps `last_counted_at` whenever `last_count` changes. Segments are
archived, never deleted.

**Read marks:** a team member writes only their own. Marking a thread read stores `now()`.

## Who can do what

- The team (admin scope) and the platform's jobs (platform scope) read and write everything.
- Read marks are each member's own.
- Which team member may send, broadcast or manage templates is the API's check (the
  `communications.*` keys). The spec defers fine-grained roles.
- No firm scope reaches any table.

## Endpoints the screens need

All under `/api/v1/admin/communications`.
- **Dashboard:**
  - `GET /summary`: unread, open, waiting on reply, scheduled, failed
  - `GET /conversations` with the tabs (inbox, assigned to me, unassigned, mentions, all,
    scheduled), channel, search and sort
- **Threads:**
  - `GET /conversations/:id` with messages, recipients and results; `POST .../read`;
    `PATCH .../assign`, tags and status
- **Messages:**
  - `POST /messages` (draft, send now or schedule, with an idempotency key)
  - `PATCH /messages/:id`, `POST .../send`, `.../schedule`, `.../cancel`, `.../retry`
  - `DELETE` (drafts only)
- **Templates:** `GET /templates` (category, channel, status, search, sort),
  `POST`/`PATCH /templates`, `.../duplicate`, `.../archive`, `.../preview`, `.../test`.
  Categories CRUD.
- **Files:** `POST /media` (upload ticket), `GET /media?kind=INLINE_IMAGE` (the library).
- **Segments:** `GET`/`POST`/`PATCH /segments`, `POST /segments/:id/count`.
- **Broadcasts:**
  - `GET /broadcasts`
  - `POST /broadcasts` and the 4-step `PATCH`
  - `.../test`, `.../schedule`, `.../send`, `.../cancel`, `.../retry`, `.../duplicate`,
    `.../archive`
  - `GET .../recipients` and `.../export`
- **Audit:** every send, schedule, cancel, retry, failure, assignment and status change writes
  `audit_logs` (category `DATA`), with ids only and never message bodies.

**Webhooks and jobs** (platform scope; R1 provides the infrastructure):
- the dispatcher moves `SCHEDULED` messages and broadcasts at their time
- SES and SNS delivery events update the recipient results by `provider_message_id`
- inbound email and SMS write `RECEIVED` messages, matched to a thread by address
- the scanner records `comm_media` results

## Needs from R1

- An IAM grant for the `platform/communications/*` S3 prefix (read and write for the API and the
  scanner).
- SES and SNS event wiring for delivery results and inbound mail and SMS.

## Not in this stage

- Demo rows (Stage 5).
- Firm-to-client messaging is the firm workspace's own module.
- Saved views of the conversation list.
