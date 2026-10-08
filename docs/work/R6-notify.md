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
- [x] 2. Email via SES on dev, Mailpit locally; SMS via SNS on dev only after registration, otherwise written to the API log
- [x] 3. Templates: invite, approval, decline, request info, sign-up approved, password reset, document requested, appointment booked/changed/reminder, invoice sent, payment received (password reset is Cognito's own email through SES, q19: no template here)
- [x] 4. Firm branding in client emails (name, logo, colours); no secrets or SSNs in messages (logo: see Open)
- [ ] 5. Respect notification preferences (step 7)
  - TODO (waits for step 7's API): `NotifyMessage.recipient` is accepted but not read yet. When the preferences API lands, `SendingNotifyService.send` reads the recipient's `notification_preferences` row for `TEMPLATE_CATEGORY[template]` and the channel, skips the message when it is off (and logs the template only), and never skips `ALWAYS_SENT` templates (all `ACCOUNT`). With it, add the footer line "You can turn off emails like this in your notification settings." back in `templates.ts` (`footer`), on templates outside `ALWAYS_SENT` only; it is left out until then so no email promises a setting that does nothing yet.
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
- SMS consent: `sms: true` is refused (400) while SMS is not in the person's `channels`, and a new or removed phone number clears every SMS choice (opt in again for that number). Turning SMS off is always allowed.
- Client recipients (beta): a client event goes to the client's ACTIVE PRIMARY portal login only, until member permissions exist; `client-note.reminder` only to the note's owner.
- Email-only (no bell item): codes, decisions, the client's welcome, a new-device alert, a suspension notice (the firm's logins are blocked, so a bell could not be seen).

## Decisions (Oct 8, sender: steps 2 to 4)

- `send` rejects when a message does not go out (`NotifyDeliveryError`: template, channel and the provider's error name, never the address, the text or the provider's own message, no `cause`). The caller decides what that means; R4 already logs a warning with the application's id. Template or data mistakes reject with `NotifyTemplateError`, an unknown firm with `UnknownFirmError`.
- Settings are checked at start-up by R6's own loader (`src/notify/config.ts`, like field-encryption's): `EMAIL_MODE` defaults to `ses`; `smtp` (Mailpit) and `log` only with `NODE_ENV` development or test, so production refuses both (as `AUTH_MODE=local`).
- SMS: `SMS_MODE=sns` publishes only when `SMS_ORIGINATION_NUMBER` (the registered toll-free number, E.164) is set; without it the API warns once at start-up and texts go to the log (template and firm only). The app stack sets `SMS_MODE=sns` today without a number, so dev starts and no request fails over a text.
- Logs hold the channel, the template, the firm's id and an error name only: never an address, a phone number, a subject or a body, also with `AUTH_MODE=local` (step 1's local log of the whole message is gone).
- Sender: firm emails show the firm's name on `EMAIL_FROM`'s address; Firmivra's own show `EMAIL_FROM`'s name. Names lose control and format characters (bidi overrides, zero-width marks), are quoted or RFC 2047 encoded words of at most 75 characters; header values are on one line.
- Who sends what (review): `TEMPLATE_SENDER` says `platform` (`firm-application.*`, businessId null, Firmivra's branding) or `firm` (everything else, the firm's businessId). `send` rejects a mismatch with `NotifyTemplateError`, and a firm template names the firm loaded for `businessId` (in its own scope), never a name from the data: `firmName` is optional and ignored, kept only so calls written against step 1 compile, and removed after step 6.
- SES (review): the SendEmail request names no configuration set. The email stack makes `SES_CONFIGURATION_SET` the identity's default, so SES applies it anyway, and naming it would also need `ses:SendEmail` on the configuration set's ARN (the task role has `grantSendEmail` on the identity only). The API does not read `SES_CONFIGURATION_SET`. To check on dev after the merge: one real send (for example a firm application) must be seen arriving in its inbox, and in the set's event destination. A 200 from the API is not enough: R4 catches a failed send (for example `AccessDenied`) and logs only a warning, so the application still succeeds.
- Timeouts: SES and SNS calls give up after 3 s to connect and 5 s per request, at most 2 attempts (SMTP: 5 s to connect, 10 s idle), since R4's decline awaits the email before it answers.
- Branding: the firm's name, `brand_color` and `accent_color` (the portal's defaults when empty or not `#rrggbb`) and its time zone, read in the firm's own scope. Firmivra's navy and blue for firm applications. Every value is HTML-escaped, links must be http(s), colours go into styles only as `#rrggbb`.
- q18: `client.signup-declined` carries no reason (removed from its data; the template ignores one if passed). `firm-application.declined` keeps it.
- Password reset stays Cognito's own email through SES (q19, #101): no template here.

## Open (Rasel)

- Local SMS codes: with logs that never hold a body, a developer can't read an SMS code from the API log once R3 sends codes through NotifyService (step 6). Today R3's own `LogClientCodeSender` still logs them locally. Options: show local texts in Mailpit as an email, or a dev-only route. Which?
- Logos: `business_settings.logo_key` is a private S3 key; a signed URL would stop working in the inbox. Emails show the firm's name until R5 serves logos at a lasting public address (or the email embeds the logo as an inline attachment, which needs raw MIME on SES).
- An environment without a custom domain gets `EMAIL_MODE=log` from the app stack with `NODE_ENV=production`, which the sender now refuses at start-up. Dev has its domain, so nothing breaks today.

- Password reset: Cognito's ForgotPassword sends its own code email today (staff and clients). Keep Cognito's email (configured to send through SES), or move it to a custom email sender that calls this service (needs a Cognito trigger Lambda: an AWS change)?
- Notifications: lock any category besides `ACCOUNT`? Octavia's My Profile spec says "critical notices may be mandatory" and lists marketing notices, which have no category (Phase 1 sends none).
- Notifications: should SMS switches show before SNS is registered (texts go to the API log until then)? The contract shows SMS only once texts can be sent and the person has a phone number.
- Notifications: where does a firm member change their own preferences? The firm site has no page for it in PAGE-MAP; the calls exist (`api.notifications.preferences()`).
- Notifications: which staff get a staff event (the client's assigned member only, or also every Owner and Admin)? `client.signup-submitted` goes to Owner and Admin (R3's queue); its category is SERVICES for now (ACCOUNT is locked, so it could never be switched off).
- Notifications: portal links open the page (`/lvp/documents`), not the one record inside it; deep links (`?request={id}`) need the pages to read a parameter. Fine for beta?
- Notifications: the brief says "in-app" preferences; the schema keeps the bell always on (email and SMS switches only). Keep it that way?
- Notifications: client members (SPOUSE, AUTHORIZED) get no bell items in beta. When member permissions land, which events reach them (by the sections they may see)? Also the members journey's "Primary client: member joined" and "Member: access removed".
- Notifications: `staff.joined` (Owner and Admin, opens `/team`) is in ACCOUNT, so it is locked like the other access notices. Fine, or a category of its own?
- Notifications: the Staff journey's "Client: signature and invoice" and the Super Admin's "Owner: access request to approve" need signatures and support grants first; their events come with those streams.
- Notifications: category names on screens (`NOTIFICATION_CATEGORY_LABELS`) are a draft for Octavia.

## Needs from others

- R2, R3: when step 2 lands, `ActivationMailer` and `ClientCodeSender` become thin wrappers over NotifyService (step 6), or their callers switch to it directly.
- R5, R7, R11, R12 (after step 7's API): write a bell item for their events through R6's helper (document requested, accepted, rejected or answered, invoice sent, payment received, new message, intake sent or submitted, appointment booked or changed), with the record it opens and a safe payload.
- R2 (after step 7's API): `staff.joined` when an invite is accepted, to the firm's Owner and Admins.
- Whoever owns the phone number change (staff and client profiles): call R6's helper to clear the person's SMS choices when the number changes or is removed.
- Infra (Rasel): once the toll-free number is registered, set `SMS_ORIGINATION_NUMBER` on the API task (texts stay in the log until then). For an environment without a custom domain, decide between requiring the email stack and allowing `EMAIL_MODE=log` there.
- Rasel: `.env.example` could list `SMS_ORIGINATION_NUMBER=` (empty) under SMS, and apps/api/README.md's "Email and SMS" still says a failure never fails the caller and that the service only logs: it should say `send` rejects with `NotifyDeliveryError` and the caller catches it.
- Every caller: catch `send`'s rejection and log the record's id only (as R4's `emailApplicant` does).
- Rasel: apps/api/README.md's example passes `firmName` in `data`; it is now ignored (the name comes from `businessId`), so the example can drop it.
- Rasel (PR size): steps 2 to 4 are one branch of about 1,700 changed lines (docs/work/README.md rule 5 asks for one or two steps under ~600). Split at PR time into (a) `config.ts`, `transports.ts`, `notify.service.ts`, `notify.module.ts`, `notify.types.ts` with `notify.test.ts` (sender, step 2), then (b) `templates.ts`, `branding.ts` with `notify-templates.test.ts` and the fixtures (steps 3 and 4), or allow one PR as an exception.

## Progress log

(newest last: date, step, what changed, commit)
- 2026-10-07, step 1: `apps/api/src/notify/` with `NotifyService` (`send({ template, to, businessId, recipient, replyTo, data })`), the typed templates (`NotifyTemplates`: staff invite; client sign-up codes, already registered, approved, declined; firm application received, info requested, approved, declined; document requested; appointment booked, changed, reminder; invoice sent, payment received), `TEMPLATE_CHANNEL` (only the SMS code goes by SMS), `ALWAYS_SENT` (codes and decisions ignore preferences), the `NOTIFY_SERVICE` token in a global `NotifyModule`, and `LogNotifyService` until step 2 (whole message only with AUTH_MODE=local; otherwise template and firm only). "Email and SMS" in apps/api/README.md. Unit tests `apps/api/test/unit/notify.test.ts`. Branch `rasel/R6-notify-interface`.
- 2026-10-08, step 7 (contract): `packages/types/src/notifications/` with `api.notifications` (firm, `/business/me/...`) and `api.myNotifications(slug)` (portal, `/portal/{firmSlug}/me/...`), one client type for both: `list({ unreadOnly, cursor, limit })` (items, `nextCursor`, `unreadCount`), `unreadCount()`, `markRead(id)`, `markAllRead()`, `preferences()` (`channels`, and every category's email and SMS with `locked`), `updatePreferences({ items })`. An item: id, category, title, body, `target { kind, id, clientId }`, `readAt`, `createdAt`; no URL from the server: `notificationLink(target, site)` builds the firm or portal path. `NOTIFICATION_EVENTS` (event, category, kind, side; email template names where they match), `LOCKED_NOTIFICATION_CATEGORIES` (`ACCOUNT`, refused by the update schema with 400) and `NOTIFICATION_CATEGORY_LABELS`. Errors in the order the API checks them: 415 and 403 ORIGIN_NOT_ALLOWED (changes, before sign-in), 401, 400 BUSINESS_REQUIRED (firm site), 404 (no place in the firm), 403 BUSINESS_INACTIVE or BUSINESS_SETUP_REQUIRED (only after the place in the firm is checked), 400 VALIDATION_FAILED, 404 (not the caller's own); no 409. Tests `packages/types/test/notifications/client.test.ts` (both clients: every route, method, body, answer and refusal; links; events). Mock `apps/web/src/mocks/notifications.ts` (lazy fixtures; firm: 8 items, 3 unread; portal: 12, 4 unread, one mock per firm; records from R5's and R10's mocks). `docs/api/notifications.yaml` with the events table and the rules for the API. No apps/api code. Branch `rasel/R6-notifications-contract`.
- 2026-10-08, step 7 (contract, review): errors listed in the order the API checks them (cross-site 415 and 403 first, then 401, then the tenant guard's 400, 404 and status 403, then validation and the caller's own 404), and 415 on the read and read-all POSTs. Events `document-request.accepted` (client) and `staff.joined` (staff, new kind `membership` opening `/team`). Client events go to the PRIMARY login only in beta; `client-note.reminder` to the note's owner. `sms: true` refused while SMS is not offered (also in the mock), and a phone change clears SMS choices.
- 2026-10-08, steps 2 to 4: `SendingNotifyService` (`src/notify/notify.service.ts`) replaces `LogNotifyService`: renders the template with the firm's branding (`branding.ts`) and sends through SES v2 SendEmail (no `ConfigurationSetName`: the identity's default configuration set applies), Mailpit over SMTP (nodemailer), or the log; SMS through SNS Publish (transactional, from `SMS_ORIGINATION_NUMBER`) or the log (`transports.ts`). Settings in `config.ts`, checked at start-up. Every template in `templates.ts`: subject, plain text and simple HTML. `TEMPLATE_CATEGORY` for step 5. q18: no reason in `client.signup-declined`. Unit tests `apps/api/test/unit/notify.test.ts` (service, logs and errors without recipients, SES and SNS requests with fakes, SMTP through nodemailer's stream transport, config, branding) and `notify-templates.test.ts` (every template, escaping, q18); one manual send to local Mailpit. Branch `rasel/R6-sender`.
- 2026-10-08, steps 2 to 4 (review): SES requests no longer name the configuration set (the identity's default applies; the task role has no grant on the set). `TEMPLATE_SENDER` (firm or platform) checked in `send` and `render`; firm templates take the firm's name from the branding loaded for `businessId`, `firmName` is ignored. From names lose bidi and zero-width characters and long non-ASCII names split into encoded words of at most 75 characters. SES and SNS clients with 3 s connect and 5 s request timeouts, 2 attempts. No "turn off emails like this" footer until step 5. Tests for each.
- 2026-10-08, steps 2 to 4 (lead's review): SES and SNS requests time out for real (`throwOnRequestTimeout: true`; without it @smithy/node-http-handler only warns), tested against a local server that never answers. `firm-application.received` is fixed text with no data (the address is not verified yet, so nothing from the form reaches it); R4's caller passes `{}`. Links must be on the app, portal or admin origin from `APP_BASE_URL`, `PORTAL_BASE_URL`, `ADMIN_BASE_URL` (required with ses and smtp; https outside development and test), without user name, password or control characters, and go out normalised. From names at most 64 characters, with every `=?` broken up. A malformed businessId is `UnknownFirmError` and a database error while loading branding is `NotifyDeliveryError` (`BrandingUnavailable`); SMTP failures carry nodemailer's error code. Tests for each.
