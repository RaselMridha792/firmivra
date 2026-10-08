# R6: Email and SMS sender (Oct 12)

**Goal:** One NotifyService sends email and SMS everywhere, with templates, working locally and on dev.

**Owned paths (change only these):**
- `apps/api/src/notify/**`
- `packages/types/src/notifications/**`, `packages/types/test/notifications/**`
- `apps/web/src/mocks/notifications.ts`, and the notifications lines in `apps/web/src/lib/api.ts`
- `docs/api/notifications.yaml`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- infra email stack (SES identity dev.firmivra.com)
- Local Mailpit settings

## Steps

- [x] 1. Publish the NotifyService interface by Oct 9 (Tumit T06 and other streams call it)
- [ ] 2. Email via SES on dev, Mailpit locally; SMS via SNS on dev only after registration, otherwise written to the API log
- [ ] 3. Templates: invite, approval, decline, request info, sign-up approved, password reset, document requested, appointment booked/changed/reminder, invoice sent, payment received
- [ ] 4. Firm branding in client emails (name, logo, colours); no secrets or SSNs in messages
- [ ] 5. Respect notification preferences (step 7)
- [ ] 6. Replace the log-only calls in R2, R3, R4
- [ ] 7. Plus T06 (Oct 6): notification center (list, unread count, mark read, link to the record) and preferences; reminder jobs for appointments and client notes, as a job inside the API with a Postgres advisory lock unless there's a reason for an AWS scheduler. Contract by Oct 10 (Fahad F07, Nahid N10)
  - [x] Contract: `api.notifications` and `api.myNotifications(slug)`, mock, `docs/api/notifications.yaml` (Oct 8)
  - [ ] API: the routes in the yaml, with the "Rules for the API" there, e2e and tenant-isolation tests
  - [ ] A helper the other streams call to write a bell item (with its email or SMS copy through NotifyService)
  - [ ] Reminder jobs (appointments, client note reminders)

## Done when

Every flow above sends a real email to a verified address on dev.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Decisions (Oct 8, notifications contract)

- Routes: the firm side is `/business/me/notifications...` and `/business/me/notification-preferences` (the signed-in member's own, in the firm the request acts in; every firm role), the same shape as the portal's `/portal/{firmSlug}/me/...`. One client type for both, so Fahad's bell serves both sites.
- Only the person's own: another person's notification is 404, also within the same firm.
- Title and body are made by the API when read, from the safe payload; no amounts, file names, file content or message text.
- Each item names its record with a typed `target` (`kind`, `id`, and `clientId` on the firm site, whose pages sit under `/clients/{id}`), never a URL. The site builds the link with `notificationLink(target, site)` from `packages/types` (null where the site has no page), so Fahad's bell and Nahid's Notification Center agree and a link never leaves the site.
- `NOTIFICATION_EVENTS` is the catalog of bell items (event, category, kind of record, who gets it). Events that also send an email keep the NotifyService template name (`document.requested`, `appointment.*`, `invoice.sent`, `payment.received`).
- Only `ACCOUNT` is locked (the schema's "ACCOUNT notices cannot be switched off", and `ALWAYS_SENT`); the request schema refuses it (400). `channels` says which switches to show (Octavia's "only supported channels are shown").
- No "mark unread", no delete (the schema keeps notifications for good). Preference changes are audited (consent to texts); reads are not.

## Open (Rasel)

- Password reset: Cognito's ForgotPassword sends its own code email today (staff and clients). Keep Cognito's email (configured to send through SES), or move it to a custom email sender that calls this service (needs a Cognito trigger Lambda: an AWS change)?
- Notifications: lock any category besides `ACCOUNT`? Octavia's My Profile spec says "critical notices may be mandatory" and lists marketing notices, which have no category (Phase 1 sends none).
- Notifications: should SMS switches show before SNS is registered (texts go to the API log until then)? The contract shows SMS only once texts can be sent and the person has a phone number.
- Notifications: where does a firm member change their own preferences? The firm site has no page for it in PAGE-MAP; the calls exist (`api.notifications.preferences()`).
- Notifications: which staff get a staff event (the client's assigned member only, or also every Owner and Admin)? `client.signup-submitted` goes to Owner and Admin (R3's queue); its category is SERVICES for now (ACCOUNT is locked, so it could never be switched off).
- Notifications: portal links open the page (`/lvp/documents`), not the one record inside it; deep links (`?request={id}`) need the pages to read a parameter. Fine for beta?
- Notifications: the brief says "in-app" preferences; the schema keeps the bell always on (email and SMS switches only). Keep it that way?
- Notifications: category names on screens (`NOTIFICATION_CATEGORY_LABELS`) are a draft for Octavia.

## Needs from others

- R2, R3: when step 2 lands, `ActivationMailer` and `ClientCodeSender` become thin wrappers over NotifyService (step 6), or their callers switch to it directly.
- R5, R7, R11, R12 (after step 7's API): write a bell item for their events through R6's helper (document requested or answered, invoice sent, payment received, new message, intake sent or submitted, appointment booked or changed), with the record it opens and a safe payload.

## Progress log

(newest last: date, step, what changed, commit)
- 2026-10-07, step 1: `apps/api/src/notify/` with `NotifyService` (`send({ template, to, businessId, recipient, replyTo, data })`), the typed templates (`NotifyTemplates`: staff invite; client sign-up codes, already registered, approved, declined; firm application received, info requested, approved, declined; document requested; appointment booked, changed, reminder; invoice sent, payment received), `TEMPLATE_CHANNEL` (only the SMS code goes by SMS), `ALWAYS_SENT` (codes and decisions ignore preferences), the `NOTIFY_SERVICE` token in a global `NotifyModule`, and `LogNotifyService` until step 2 (whole message only with AUTH_MODE=local; otherwise template and firm only). "Email and SMS" in apps/api/README.md. Unit tests `apps/api/test/unit/notify.test.ts`. Branch `rasel/R6-notify-interface`.
- 2026-10-08, step 7 (contract): `packages/types/src/notifications/` with `api.notifications` (firm, `/business/me/...`) and `api.myNotifications(slug)` (portal, `/portal/{firmSlug}/me/...`), one client type for both: `list({ unreadOnly, cursor, limit })` (items, `nextCursor`, `unreadCount`), `unreadCount()`, `markRead(id)`, `markAllRead()`, `preferences()` (`channels`, and every category's email and SMS with `locked`), `updatePreferences({ items })`. An item: id, category, title, body, `target { kind, id, clientId }`, `readAt`, `createdAt`; no URL from the server: `notificationLink(target, site)` builds the firm or portal path. `NOTIFICATION_EVENTS` (event, category, kind, side; email template names where they match), `LOCKED_NOTIFICATION_CATEGORIES` (`ACCOUNT`, refused by the update schema with 400) and `NOTIFICATION_CATEGORY_LABELS`. Errors: 401, 403 (BUSINESS_INACTIVE, BUSINESS_SETUP_REQUIRED, ORIGIN_NOT_ALLOWED), 400 (VALIDATION_FAILED, BUSINESS_REQUIRED), 404 (not the caller's own), 415; no 409. Tests `packages/types/test/notifications/client.test.ts` (both clients: every route, method, body, answer and refusal; links; events). Mock `apps/web/src/mocks/notifications.ts` (lazy fixtures; firm: 8 items, 3 unread; portal: 12, 4 unread, one mock per firm; records from R5's and R10's mocks). `docs/api/notifications.yaml` with the events table and the rules for the API. No apps/api code. Branch `rasel/R6-notifications-contract`.
