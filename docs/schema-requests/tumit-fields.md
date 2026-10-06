# T01: firm API schema request

Owner: Tumit. Database owner: Rasel. Requested on **2026-10-06**; tables needed by **Oct 8**.
Compared against `origin/main` at `a0bee59`, not the earlier skeleton. This is a request,
not an approved migration. Fahad must confirm the proposed UI fields and DTOs.
Ticket plan: `docs/tasks/TUMIT.md` on `tumit/FIR-0-onboarding` (15-day plan).
Use the `schema` label and assign the GitHub issue to RaselMridha792.

## Already present: reuse without new tables

| Module         | Existing storage and usable fields                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile        | `Business`: id, name, legalName, slug, status, termsUrl, privacyUrl, timestamps. Legal name and slug are not editable by these APIs.                                                                                        |
| Settings/setup | `BusinessSettings`: contactEmail, contactPhone, website, addressLine1/2, city, state, postalCode, country, timezone, logoKey, brandColor, enabledModules, clientSignUpEnabled, setupProgress, setupCompletedAt, timestamps. |
| Legal          | `FirmLegalDocument`: id, businessId, kind (TERMS/PRIVACY), version, bodyMarkdown, publishedByUserId, publishedAt; unique firm/kind/version; append-only.                                                                    |
| Team           | `Membership`: id, businessId, userId, role (OWNER/ADMIN/STAFF), status (INVITED/ACTIVE/DEACTIVATED), timestamps. `User`: name, email, phone, pool.                                                                          |
| Invites        | `Invite`: tokenHash, expiresAt, invitedByUserId, acceptedAt, revokedAt, createdAt, membershipId/clientAccountId. Rasel owns issuing and resending; never expose tokenHash.                                                  |
| Tax statuses   | `TaxStatus`: id, businessId, name, sortOrder, archivedAt, timestamps; referenced by `ClientTaxStatus` and its history. Archive rather than delete.                                                                          |
| Applications   | `FirmApplication`: id, status, legalName, dbaName, contactName/email/phone, data, internalNotes, decisionReason, reviewedByUserId/At, businessId, timestamps. Platform scope; Tumit only reads.                             |
| Audit          | `AuditLog`: id, businessId, actorUserId, action, entityType/id, metadata, ip, userAgent, requestId, createdAt. Append-only; no second log table.                                                                            |
| Support        | `SupportAccessGrant` already exists. Rasel owns the service that validates owner approval, expiry and revocation; do not invent another access model.                                                                       |

Invite lifetime follows the current database/auth contract (maximum seven days), not older 72-hour notes.
Team role changes/deactivation need a same-firm transaction that prevents removal/demotion of the last active owner;
ask Rasel whether to enforce this invariant at the database layer as well. Do not add invite fields again.

## Missing settings fields (T02)

The five-step setup wizard in `docs/SYSTEM-DESIGN.md` requires portal naming,
header and welcome content. `setupProgress` is progress only, not a content store.
These fields are proposals until Fahad/Rasel confirm the exact screen shape.

| Model            | Field          | Type             | Nullable | Default | Unique / index | Notes                    |
| ---------------- | -------------- | ---------------- | -------- | ------- | -------------- | ------------------------ |
| BusinessSettings | portalName     | String (1..120)  | yes      | null    | none           | Null uses Business.name. |
| BusinessSettings | portalHeader   | String (0..200)  | yes      | null    | none           | Plain text, no HTML.     |
| BusinessSettings | welcomeMessage | String (0..2000) | yes      | null    | none           | Plain text, no secrets.  |

Use existing enabledModules/clientSignUpEnabled for feature visibility; do not duplicate feature flags.
Use existing brandColor/logoKey until mockups confirm a need for additional colour or image fields.
Logo upload/signing belongs to Rasel's storage service; validate that the key belongs to this firm.
Legal publication must allocate the next version atomically; simultaneous writes must not overwrite a version.

## Application status history (T05; writer R4)

| Model                  | Field         | Type                  | Nullable | Default | Unique / index                          | Notes                                  |
| ---------------------- | ------------- | --------------------- | -------- | ------- | --------------------------------------- | -------------------------------------- |
| FirmApplicationHistory | id            | UUID                  | no       | uuid v7 | PK                                      | New append-only table.                 |
| FirmApplicationHistory | applicationId | UUID                  | no       | none    | FK; index(applicationId, createdAt, id) | FirmApplication.id, restrict deletion. |
| FirmApplicationHistory | fromStatus    | FirmApplicationStatus | yes      | null    | none                                    | Null for initial submission.           |
| FirmApplicationHistory | toStatus      | FirmApplicationStatus | no       | none    | none                                    | Existing enum.                         |
| FirmApplicationHistory | actorUserId   | UUID                  | yes      | null    | FK User                                 | Null for system/submission event.      |
| FirmApplicationHistory | reason        | String                | yes      | null    | none                                    | No tokens/SSNs/document content.       |
| FirmApplicationHistory | createdAt     | Timestamptz(3)        | no       | now     | above                                   | Database clock.                        |

Platform table: no businessId while the firm is not created; only Super Admin can read.
Rasel's approve/request-info/decline transaction writes the history; Tumit exposes GET only.
If R4 already plans an equivalent history table, reuse it and confirm its name/fields.

## Notification center and preferences (T06)

Every table below is firm data: businessId UUID NOT NULL, FK Business,
forced RLS, same-firm relations and unique(businessId, id), unless a composite PK is listed.
UUID ids default to uuid v7 and timestamps use Timestamptz(3).

| Model                  | Field                 | Type                       | Nullable | Default                        | Unique / index                                             | Notes                                                                                      |
| ---------------------- | --------------------- | -------------------------- | -------- | ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Notification           | id / businessId       | UUID / UUID                | no       | uuid / none                    | PK; firm/id                                                | One recipient, not a broadcast row.                                                        |
| Notification           | recipientUserId       | UUID                       | no       | none                           | FK User; index(businessId, recipientUserId, createdAt, id) | Validate active Membership or ClientAccount in firm.                                       |
| Notification           | category              | enum                       | no       | none                           | none                                                       | APPOINTMENT, DOCUMENT, SERVICE, BILLING, SECURITY, LEGAL, MARKETING (proposed).            |
| Notification           | eventKey              | String                     | no       | none                           | unique(businessId, recipientUserId, eventKey)              | Producer's stable deduplication key.                                                       |
| Notification           | title / message       | String(160) / String(1000) | no       | none                           | none                                                       | Generic summary; no financial/tax/document contents.                                       |
| Notification           | entityType / entityId | String / UUID              | yes      | null                           | none                                                       | Both set or both null; allowlisted type, same-firm target; verify permission when opening. |
| Notification           | readAt                | Timestamptz(3)             | yes      | null                           | index(businessId, recipientUserId, readAt)                 | Mark-read is idempotent, first read retained.                                              |
| Notification           | createdAt             | Timestamptz(3)             | no       | now                            | above                                                      | No public recipient-selecting create endpoint.                                             |
| NotificationPreference | businessId / userId   | UUID / UUID                | no       | none                           | FK; composite PK with category                             | One set per user per firm.                                                                 |
| NotificationPreference | category              | same category enum         | no       | none                           | PK(businessId, userId, category)                           | Validate recipient is attached to firm.                                                    |
| NotificationPreference | inApp / email / sms   | Boolean each               | no       | true / true / false (proposed) | none                                                       | Only supported channels can be enabled.                                                    |
| NotificationPreference | updatedAt             | Timestamptz(3)             | no       | now/updatedAt                  | none                                                       | Self-service only.                                                                         |

Preferences never grant SMS/marketing consent. Reuse Rasel's consent source; do not add a second opt-out ledger.
NotifyService remains responsible for consent, required notices and provider delivery.
Security/legal/required billing exceptions and category/default choices need Rasel/Fahad confirmation.
Do not return delivery credentials or arbitrary external URLs as notification targets.

## Appointments (T07)

All models have businessId/RLS and same-firm composite foreign keys as above.
Use canonical Client and Membership; do not create duplicate portal appointment records.

| Model               | Field                                              | Type                           | Nullable       | Default            | Unique / index                                                       | Notes                                                                |
| ------------------- | -------------------------------------------------- | ------------------------------ | -------------- | ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AppointmentType     | id / businessId                                    | UUID / UUID                    | no             | uuid / none        | PK; firm/id                                                          | Firm-defined type.                                                   |
| AppointmentType     | name                                               | String(120)                    | no             | none               | unique(businessId, name)                                             | Nonblank after trim.                                                 |
| AppointmentType     | durationMinutes                                    | Int                            | no             | none               | CHECK > 0, <= 480 (proposed)                                         | Server calculates end time.                                          |
| AppointmentType     | bufferBeforeMinutes / bufferAfterMinutes           | Int each                       | no             | 0                  | CHECK 0..120 (proposed)                                              | Included in overlap interval.                                        |
| AppointmentType     | allowedMethods                                     | enum[]                         | no             | none               | nonempty                                                             | PHONE, VIDEO, IN_PERSON. Free five-minute call is PHONE only.        |
| AppointmentType     | clientBookingEnabled / active                      | Boolean each                   | no             | true               | none                                                                 | Inactive type cannot be newly booked.                                |
| AppointmentType     | createdAt / updatedAt                              | Timestamptz(3)                 | no             | now/updatedAt      | none                                                                 | Configuration audit.                                                 |
| WorkingHours        | id / businessId                                    | UUID / UUID                    | no             | uuid / none        | PK; firm/id                                                          | Per provider, not firm-wide UTC recurrence.                          |
| WorkingHours        | providerMembershipId                               | UUID                           | no             | none               | FK Membership(businessId,id)                                         | Must be active staff member.                                         |
| WorkingHours        | weekday                                            | Int                            | no             | none               | CHECK 0..6                                                           | Sunday=0, explicit contract.                                         |
| WorkingHours        | startMinute / endMinute                            | Int each                       | no             | none               | CHECK 0 <= start < end <= 1440                                       | Local wall time in BusinessSettings.timezone. Split overnight hours. |
| WorkingHours        | createdAt / updatedAt                              | Timestamptz(3)                 | no             | now/updatedAt      | index(businessId, providerMembershipId, weekday)                     | Reject overlapping recurring rows.                                   |
| BlockedTime         | id / businessId                                    | UUID / UUID                    | no             | uuid / none        | PK; firm/id                                                          | Provider-specific block.                                             |
| BlockedTime         | providerMembershipId                               | UUID                           | no             | none               | FK Membership(businessId,id)                                         | Same provider lock as appointments.                                  |
| BlockedTime         | startsAt / endsAt                                  | Timestamptz(3) each            | no             | none               | CHECK startsAt < endsAt; provider/time index                         | UTC instants.                                                        |
| BlockedTime         | reason                                             | String(500)                    | yes            | null               | none                                                                 | Staff-only; never show in client availability.                       |
| BlockedTime         | createdByUserId / createdAt                        | UUID / Timestamptz(3)          | no             | none / now         | FK User                                                              | Actor from request context.                                          |
| Appointment         | id / businessId                                    | UUID / UUID                    | no             | uuid / none        | PK; firm/id                                                          | Shared by firm and portal.                                           |
| Appointment         | clientId                                           | UUID                           | no             | none               | FK Client(businessId,id); client/time index                          | Portal derives it from authenticated ClientAccount.                  |
| Appointment         | providerMembershipId / typeId                      | UUID each                      | no             | none               | Same-firm FK to Membership / AppointmentType                         | Never arbitrary provider from another firm.                          |
| Appointment         | startsAt / endsAt                                  | Timestamptz(3) each            | no             | none               | provider/time index; CHECK start < end                               | End is calculated using type snapshot.                               |
| Appointment         | occupiedStartsAt / occupiedEndsAt                  | Timestamptz(3) each            | no             | none               | Exclusion constraint below                                           | Snapshot buffers so later type edits do not move bookings.           |
| Appointment         | timezone                                           | String                         | no             | none               | none                                                                 | Valid IANA zone snapshot; UTC storage; no ambiguous DST slots.       |
| Appointment         | method                                             | meeting-method enum            | no             | none               | none                                                                 | Must be allowed by type.                                             |
| Appointment         | location / meetingUrl / instructions               | String each                    | yes            | null               | none                                                                 | Safe client-visible text; HTTPS approved meeting URL.                |
| Appointment         | status                                             | enum                           | no             | BOOKED             | provider/time index                                                  | BOOKED, CANCELLED, COMPLETED, NO_SHOW (proposed).                    |
| Appointment         | version                                            | Int                            | no             | 1                  | CHECK > 0                                                            | Optimistic concurrency for reschedule/cancel.                        |
| Appointment         | requestKey                                         | String                         | no             | none               | unique(businessId, createdByUserId, requestKey)                      | Idempotent booking; key reused with different payload -> 409.        |
| Appointment         | createdByUserId / cancelledByUserId                | UUID each                      | no / yes       | none / null        | FK User                                                              | Authenticated actor, not a body field.                               |
| Appointment         | cancelledAt / cancelReason                         | Timestamptz(3) / String(500)   | yes            | null               | none                                                                 | No private notes or sensitive details.                               |
| Appointment         | createdAt / updatedAt                              | Timestamptz(3)                 | no             | now/updatedAt      | index(businessId, clientId, startsAt, id)                            | Client and firm see the same row.                                    |
| AppointmentHistory  | id / businessId / appointmentId                    | UUID each                      | no             | uuid / none / none | Same-firm FK; index(businessId, appointmentId, createdAt, id)        | Append-only, every transition.                                       |
| AppointmentHistory  | action / actorUserId                               | enum / UUID                    | no             | none               | FK User                                                              | BOOKED, RESCHEDULED, CANCELLED, COMPLETED, NO_SHOW.                  |
| AppointmentHistory  | previousStartsAt / previousEndsAt / previousStatus | timestamp / timestamp / status | yes            | null               | none                                                                 | Null at initial booking.                                             |
| AppointmentHistory  | newStartsAt / newEndsAt / newStatus                | timestamp / timestamp / status | no             | none               | none                                                                 | Store safe change summary, not appointment content.                  |
| AppointmentHistory  | createdAt                                          | Timestamptz(3)                 | no             | now                | above                                                                | Actor from context.                                                  |
| AppointmentReminder | id / businessId / appointmentId                    | UUID each                      | no             | uuid / none / none | Same-firm FK                                                         | Durable job; not an in-process timer.                                |
| AppointmentReminder | appointmentVersion / offsetMinutes                 | Int each                       | no             | none               | unique(businessId, appointmentId, appointmentVersion, offsetMinutes) | Configurable offsets; 1440/60 proposed defaults.                     |
| AppointmentReminder | dueAt                                              | Timestamptz(3)                 | no             | none               | index(state, dueAt)                                                  | Computed from current startsAt.                                      |
| AppointmentReminder | state                                              | enum                           | no             | PENDING            | none                                                                 | PENDING, PROCESSING, SENT, CANCELLED, FAILED.                        |
| AppointmentReminder | attemptCount / lockedUntil / sentAt                | Int / timestamp / timestamp    | no / yes / yes | 0 / null / null    | none                                                                 | Worker lease, bounded retry, stable NotifyService dedupe key.        |
| AppointmentReminder | createdAt / updatedAt                              | Timestamptz(3)                 | no             | now/updatedAt      | none                                                                 | Store safe error code only, no provider secrets.                     |

Additional requested reminder field: `AppointmentReminder.lastErrorCode`, nullable String(100), default null,
for a safe retry/failure category only, never provider responses or credentials. Add `DETAILS_UPDATED` to
the proposed AppointmentHistory action enum for staff changes to client-visible location/link/instructions;
retain the same interval/status and never put that content into history or audit metadata.

**Double-booking is a database invariant**, not check-then-insert in application memory.
Ask Rasel for a GiST exclusion on businessId + providerMembershipId + the half-open
`tstzrange(occupiedStartsAt, occupiedEndsAt, '[)')` for BOOKED appointments (`btree_gist` if needed).
Serialize booking/reschedule, blocked-time creation and working-hours changes on the same
firm/provider transaction lock, then recheck availability. A block cannot be inserted over a live booking.
Return 409 `SLOT_UNAVAILABLE` for the loser of a concurrent booking, with no other client's details.
Reschedule updates the original id, increments version, appends history and invalidates old reminders atomically.
Cancelled bookings never send reminders. NotifyService needs durable enqueue and idempotency guarantees;
confirm whether R6 provides an outbox, otherwise request an outbox rather than promise exactly-once delivery.

## External links (T08)

| Model        | Field                 | Type                       | Nullable | Default       | Unique / index                                    | Notes                                                                      |
| ------------ | --------------------- | -------------------------- | -------- | ------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| ExternalLink | id / businessId       | UUID / UUID                | no       | uuid / none   | PK; firm/id; forced RLS                           | Per-firm configuration, not hard-coded UI.                                 |
| ExternalLink | section               | enum                       | no       | none          | index(businessId, active, section, sortOrder, id) | IRS_TAX, FUNDING_FINANCE, PLANNING_RESEARCH.                               |
| ExternalLink | title / description   | String(160) / String(1000) | no       | none          | none                                              | Plain text.                                                                |
| ExternalLink | url                   | String(2048)               | no       | none          | none                                              | HTTPS, approved domain, no credentials or sensitive query parameters.      |
| ExternalLink | source / iconKey      | String(120) / String       | no / yes | none / null   | none                                              | Approved source and firm-scoped stored icon, no arbitrary remote fetch.    |
| ExternalLink | sortOrder / active    | Int / Boolean              | no       | 0 / true      | above                                             | Archive by active=false; retain historical references.                     |
| ExternalLink | audience              | enum                       | no       | BUSINESS      | none                                              | BUSINESS or ALL; Individual clients cannot access business-only directory. |
| ExternalLink | createdAt / updatedAt | Timestamptz(3)             | no       | now/updatedAt | none                                              | Config mutations audited.                                                  |

Seed the eight approved IRS/SBA/FDIC/Census entries from
`docs/specs/FirmVora_External_Links_Directions.docx` into the beta firm, not a global cross-firm table.
Domain approval source/maintenance belongs to Rasel; do not accept arbitrary staff domains without approval.

## Relations, isolation, seeds and handoffs

- Composite FKs prevent firm-A records referencing firm-B providers, clients, types or history.
- New firm tables require RLS coverage tests; recipient identity/portal client scope is also checked in the API.
- Notification preferences may only be changed by their user. Privileged worker access must be scoped,
  not a general platform bypass to firm rows.
- No new SSN, EIN, bank-number or document-content fields. Application `data` is read via R4's allowlisted DTO,
  never returned as an unrestricted JSON blob; sensitive application fields need Rasel's encryption/redaction design.
- Synthetic seed: LVP and firm B; two providers, individual/business clients, read/unread notifications,
  preferences, weekly hours, a blocked interval, a booking/history/reminders, active/inactive links and application history.
- Tests: cross-firm reads/writes/FKs, append-only history, last owner, unique legal versions,
  two simultaneous booking attempts, booking versus blocked time, DST gap/fold, reschedule reminder invalidation.
- Rasel dependencies: invite resend API (T03), R4 application/history DTO (T05), R6 NotifyService and consent/outbox (T06/T07),
  logo storage contract (T02), owner-approved support-grant adapter (T08), scheduler worker mechanism (T07).
- Fahad confirmation pending: portal content, notification categories/defaults, appointment rules/durations,
  paging/filter states, external-link section/audience display. No approval is implied by this document.
