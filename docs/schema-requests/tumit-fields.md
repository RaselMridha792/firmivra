# T01: firm API schema request

Owner: Tumit. Database owner: Rasel. Requested on **2026-10-06**; tables needed by **Oct 8**.
Compared against `origin/main` at `a0bee59`, not the earlier skeleton. This is a request,
not an approved migration. Implementations are on T02–T08 ticket branches, not main.
This revision matches their current adapter/fixture columns. Fahad must confirm UI fields/DTOs.
Ticket plan: `docs/tasks/TUMIT.md` on `tumit/FIR-0-onboarding` (15-day plan).
Use the `schema` label and assign the GitHub issue to RaselMridha792.

## Already present: reuse without new tables

| Module         | Existing storage and usable fields                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile        | `Business`: id, name, legalName, slug, status, termsUrl, privacyUrl, timestamps. Legal name and slug are not editable by these APIs.                                                                                        |
| Settings/setup | `BusinessSettings`: contactEmail, contactPhone, website, addressLine1/2, city, state, postalCode, country, timezone, logoKey, brandColor, enabledModules, clientSignUpEnabled, setupProgress, setupCompletedAt, timestamps. |
| Legal          | `FirmLegalDocument`: id, businessId, kind (TERMS/PRIVACY), version, body (API alias: bodyMarkdown), publishedByUserId, publishedAt; unique firm/kind/version; append-only.                                                  |
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
The T02 implementation reads these fields as null until supplied, and rejects unavailable writes with 503.
Fahad/Rasel must confirm the screen shape before migration/merge.

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

| Model                  | Field                             | Type                       | Nullable | Default              | Unique / index                                             | Notes                                                                                      |
| ---------------------- | --------------------------------- | -------------------------- | -------- | -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Notification           | id / businessId                   | UUID / UUID                | no       | uuid / none          | PK; firm/id                                                | One recipient, not a broadcast row.                                                        |
| Notification           | recipientUserId                   | UUID                       | no       | none                 | FK User; index(businessId, recipientUserId, createdAt, id) | Validate active Membership or ClientAccount in firm.                                       |
| Notification           | category                          | enum                       | no       | none                 | none                                                       | APPOINTMENT, DOCUMENT, SERVICE, BILLING, SECURITY, LEGAL, MARKETING (proposed).            |
| Notification           | eventKey                          | String                     | no       | none                 | unique(businessId, recipientUserId, eventKey)              | Producer's stable deduplication key.                                                       |
| Notification           | title / message                   | String(160) / String(1000) | no       | none                 | none                                                       | Generic summary; no financial/tax/document contents.                                       |
| Notification           | targetEntityType / targetEntityId | String / UUID              | yes      | null                 | none                                                       | Both set or both null; allowlisted type, same-firm target; verify permission when opening. |
| Notification           | readAt                            | Timestamptz(3)             | yes      | null                 | index(businessId, recipientUserId, readAt)                 | Mark-read is idempotent, first read retained.                                              |
| Notification           | createdAt                         | Timestamptz(3)             | no       | now                  | above                                                      | No public recipient-selecting create endpoint.                                             |
| NotificationPreference | businessId / userId               | UUID / UUID                | no       | none                 | FK; composite PK with category                             | One set per user per firm.                                                                 |
| NotificationPreference | category                          | same category enum         | no       | none                 | PK(businessId, userId, category)                           | Validate recipient is attached to firm.                                                    |
| NotificationPreference | inApp / email / sms               | Boolean each               | no       | true / false / false | none                                                       | Only supported channels can be enabled.                                                    |

Add Notification.inApp Boolean NOT NULL DEFAULT true (column in_app): a creation-time channel snapshot.
Only in-app rows appear in the bell/count/read APIs. Stored target columns are target_entity_type/id;
response target uses entityType/id. Preference fallback is inApp=true, email=false, sms=false;
R6 supplies supported channels and mandatory-category policy. There is no proposed second consent ledger.

Preferences never grant SMS/marketing consent. Reuse Rasel's consent source; do not add a second opt-out ledger.
NotifyService remains responsible for consent, required notices and provider delivery.
Security/legal/required billing exceptions and category/default choices need Rasel/Fahad confirmation.
Do not return delivery credentials or arbitrary external URLs as notification targets.

## Appointments (T07)

The implementation and isolated fixture now define the following contract. Names below are
camelCase; physical columns are snake_case, under the exact tables listed. Rasel owns production
models/migrations. UUID ids are server-generated; timestamps are timestamptz. All tables require
businessId, forced RLS and same-firm foreign keys; never use platform scope for worker access.

- **AppointmentType / appointment_types:** id, businessId, name (nonblank, max 120), durationMinutes
  (1..480), bufferBeforeMinutes / bufferAfterMinutes (0..120), allowedMethods (nonempty PHONE,
  VIDEO, IN_PERSON), clientBookingEnabled, active, isIntroCall (Boolean, default false), createdAt,
  updatedAt. Introductory calls require durationMinutes=5 and PHONE only; enforce that CHECK in DB.
  Name uniqueness is checked case-insensitively under the business lock; retain a per-firm unique
  name/index if Rasel confirms normalization. At most 100 configured types in the API.
- **WorkingHours / working_hours:** id, businessId, providerMembershipId, weekday (0=Sunday,
  0..6), startMinute (0..1439), endMinute (1..1440, greater than start). Index firm/provider/weekday.
  These are local wall minutes in BusinessSettings.timezone, not UTC recurrence. Reject overlapping
  intervals and split overnight hours. No createdAt/updatedAt columns are required by this adapter.
- **BlockedTime / blocked_times:** id, businessId, providerMembershipId, startsAt, endsAt, reason
  (nullable max 500), createdAt. CHECK endsAt > startsAt, index firm/provider/time. The actor is
  recorded in AuditLog; this adapter does not require a separate createdByUserId column.
- **Appointment / appointments:** id, businessId, clientId, clientName, providerMembershipId,
  providerName, typeId, typeName; the three display names are safe booking-time snapshots.
  startsAt / endsAt and occupiedStartsAt / occupiedEndsAt are UTC instants with valid ordered
  half-open intervals; occupied bounds include the bufferBeforeMinutes / bufferAfterMinutes
  snapshots. timezone is an IANA zone snapshot; method is PHONE/VIDEO/IN_PERSON. location,
  meetingUrl and instructions are nullable client-visible values; HTTPS meeting URLs cannot
  contain credentials. status is BOOKED/CANCELLED/COMPLETED/NO_SHOW; version starts at 1.
  createdByUserId, requestKey, requestFingerprint, createdAt, updatedAt are required. requestKey
  and requestFingerprint store SHA-256 hashes, never the raw header or response/audit metadata.
  Unique(businessId, createdByUserId, requestKey) provides durable booking retry identity.
  Changed canonical input with the same actor/key returns 409 IDEMPOTENCY_CONFLICT; retries
  return the same canonical appointment in its current state, including after cancellation.
  Index firm/createdAt/id and firm/client/startsAt/id. Cancellation actor/reason/time belong to
  history; no duplicated cancelledByUserId/cancelReason/cancelledAt row fields are required.
- **AppointmentHistory / appointment_histories:** id, businessId, appointmentId, action,
  actorUserId (nullable), previousStartsAt / previousEndsAt / previousStatus (nullable),
  newStartsAt / newEndsAt / newStatus (required), reason (nullable max 500), createdAt.
  Actions written now: BOOKED, RESCHEDULED, CANCELLED, DETAILS_UPDATED. Future completion/no-show
  transitions are not exposed by these APIs. Index firm/appointment/createdAt/id. Append-only:
  app role SELECT/INSERT only; no UPDATE/DELETE. Never copy appointment instructions into history.
- **AppointmentReminder / appointment_reminders:** id, businessId, appointmentId,
  appointmentVersion, recipientUserId, kind, eventKey, dueAt, nextAttemptAt, leaseUntil (nullable),
  leaseToken (nullable UUID), attempts (Int default 0), status, lastErrorCode (nullable safe code),
  createdAt. Unique(businessId,eventKey); index businessId/status/nextAttemptAt/dueAt. kind records
  the change/reminder identity; each provider/client recipient has its own durable event key.
  status is PENDING/PROCESSING/QUEUED/CANCELLED. **QUEUED means accepted by R6, not delivered.**
  This adapter does not use offsetMinutes/state/attemptCount/lockedUntil/sentAt/updatedAt columns.
  Beta reminder defaults are 24 hours and 1 hour before start; schedule only future reminders.

Composite FKs use (businessId,id) on Client, Membership and AppointmentType, and
(businessId,appointmentId) on histories/reminders. Clients/providers must be active when booking;
portal clientId is derived from the current ClientAccount. Staff use their own calendar and assigned
clients; owner/admin use their firm. Calendar reads page providers and expose nextFrom after 1000
slots. UTC-minute scanning preserves DST-fold instants and excludes nonexistent DST-gap times.

**Double-booking is a database invariant.** The named valid appointments_no_overlap GiST exclusion
must cover businessId + providerMembershipId + tstzrange(occupiedStartsAt,occupiedEndsAt,'[)')
with overlap (&&), WHERE status='BOOKED' (btree_gist required). Booking/reschedule returns 503 if
the invariant is missing/wrong, and maps structured SQLSTATE 23P01 to 409 SLOT_UNAVAILABLE.
All calendar mutations serialize on the Business row and provider advisory transaction lock,
then recheck current role/provider/availability; a block cannot invalidate a live booking.
Reschedule preserves id, increments version, appends history and invalidates old reminders atomically.

AppointmentJobs uses leased FOR UPDATE SKIP LOCKED jobs with status/version/recipient checks and
safe backoff. R6 must durably enqueue/deduplicate eventKey, honor consent, and recheck the current
appointment version/recipient again at actual delivery. Rasel must register runDue(trustedBusinessId)
with his scheduler. No fake sender, in-memory timer, public worker endpoint or delivery claim.

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

## Exact handoff references

- T05: apps/api/test/helpers/draft-schema.ts (firm_application_histories, platform SELECT only).
- T06: apps/api/test/fixtures/notification-schema.ts (notifications, notification_preferences).
- T07: apps/api/test/fixtures/appointment-schema.ts (six calendar/job tables and exclusion).
- T08: apps/api/test/fixtures/external-links-schema.ts (external_links).
- Fixture DDL is synthetic-test contract evidence, never a production migration or instruction
  to apply it to the normal local database. Rasel confirms production names/policies/indexes.
- OpenAPI and shared Zod DTOs on each ticket branch describe actual request/response shapes;
  schema issue submission, frontend agreement and reviews remain pending.
