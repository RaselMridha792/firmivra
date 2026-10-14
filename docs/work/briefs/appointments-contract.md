# Appointments: contract for the API session (R42)

Written by R42 (Oct 15) so Tumit builds the Appointments workspace on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/appointment/source/` (Appointments overview with calendar; Schedule Appointment with the Staff Availability panel; the guide is the `.docx` there).

- R12's appointments contract (`packages/types/src/appointments/schemas.ts`, `client.ts`) stays as it is and keeps working: `api.appointmentTypes`, `api.availability` (weekly hours, blocked time, meeting links), `api.appointments` (list, get, slots, book, reschedule, cancel, complete, no-show, location), `api.myAppointments` (portal).
- New schemas: `packages/types/src/appointments/scheduling.ts`. Client: `createSchedulingClient` (`api.scheduling`) in `appointments/scheduling-client.ts`. The new calls read and write **the same appointment records**; they do not add a second appointment store.
- Mock: `apps/web/src/mocks/appointments-scheduling.ts` (`NEXT_PUBLIC_API_MOCK=scheduling`, with `appointments,appointmentTypes,availability` for R12's calls; `NEXT_PUBLIC_API_MOCK_EMPTY=scheduling`). Appointments sit around today, so every view is full.
- Paths under `/api/v1`. `@Access('APPOINTMENTS')`, R12's visibility rule: Owner and Admin see everything; Staff see their own and their assigned clients' appointments in full and the rest as Busy (`restricted: true`), and anything else about a Busy one is 404. Types and notice settings: Owner and Admin. Every change is audited (create, edit, reschedule, cancel, status, assignment, reminders, availability, conflict overrides).
- Static paths (`/summary`, `/agenda`, `/options`, `/contacts`, `/schedule`, `/conflicts`, `/settings`, `/reminders/send`) must be registered before `/:id` in the controller.

## Overview (Calendar, List, Today)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/appointments/summary` | Owner, Admin, Staff (their own) | `AppointmentsSummaryQuery` / `AppointmentsSummary` | to build | appointments | KPI cards: Total Appointments, Upcoming (Next 7 Days), Completed, No-Shows, Canceled, each "vs last month" (click filters by status) |
| `GET /business/appointments/agenda` | Owner, Admin, Staff | `AgendaQuery` / `AgendaPage` | to build (extends `GET /business/appointments`, which has no search, service, colour, multi-staff or display status) | appointments, clients, leads (new link), appointment_types, services, memberships | Calendar week grid cards (name, type, time, colour), List view, Today view, Today's Appointments (See All), Upcoming Appointments table: Date & Time, Client / Lead, Service, Type, Status, Staff Member, Location, Actions; header search "by name, email, phone, or service" |
| `GET /business/appointments/{id}/record` | Owner, Admin, Staff (full only) | - / `AppointmentRecord` | to build (R12's `GET /{id}` has history only) | appointments + the new columns below, appointment_notices (new) | Appointment detail panel, Edit Existing |
| `POST /business/appointments/{id}/confirm` | Owner, Admin, Staff | - / `AppointmentRecord` | to build | appointments.confirmed_at (new) | row menu > Confirm |
| `POST /business/appointments/{id}/reschedule` | | `RescheduleAppointmentRequest` / `Appointment` | exists (R12) | | calendar icon in the row, Reschedule |
| `POST /business/appointments/{id}/cancel`, `/complete`, `/no-show` | | | exist (R12) | | row menu > Cancel, Mark Completed, Mark No-Show |
| `POST /business/appointments/{id}/send-reminder` | Owner, Admin, Staff | `SendReminderRequest` / `RemindersSent` | to build | appointment_notices (new), notifications | row menu > Send Reminder |
| `POST /business/appointments/reminders/send` | Owner, Admin, Staff | `SendRemindersRequest` / `RemindersSent` | to build | as above | Quick Actions > Send Appointment Reminders |
| `POST /business/appointments/{id}/notes` | Owner, Admin, Staff | `AppointmentNoteRequest` / `AppointmentRecord` | to build | appointments.internal_notes (new) | row menu > Add / View Notes |
| `POST /business/appointments/{id}/duplicate` | Owner, Admin, Staff | - / `AppointmentDraft` | to build | appointment_drafts (new) | row menu > Duplicate |

Row menu items that route elsewhere: Send Message (Messages, with contact), Create Task (Tasks, prefilled), View Client / Lead (Clients or Leads), Join Meeting (the record's `videoUrl`). Quick Actions that route: View Appointment Reports (Reports), Sync Calendar (Integrations), Manage Appointment Types (below). The mini calendar, Week / Month switch and month navigation are browser-only (they change the agenda's `from` / `to`).

## Schedule Appointment (Create New / Edit Existing)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/appointments/options` | Owner, Admin, Staff | - / `SchedulingOptions` | to build | appointment_types, services, memberships, offices and rooms (new), integrations | Appointment Type, Related Service, Time Zone, Office / Branch, Room, Assigned Staff, reminder channels (SMS / Portal availability), Video Meeting Link (provider) |
| `GET /business/appointments/contacts` | Owner, Admin, Staff (their clients) | `ContactSearchQuery` / `ContactSearchResult` | to build | clients, client_profiles, leads | Client / Lead search "by name, email, phone, or ID"; Client Type (Individual / Business), Phone, Email; View Client Profile |
| `POST /business/appointments/schedule` | Owner, Admin, Staff (their clients) | `ScheduleAppointmentRequest` / `AppointmentRecord` | to build (R12's `POST /business/appointments` books client + one staff + type only) | appointments (+ new columns), appointment_staff (new, for more than one staff), appointment_reminders (new), appointment_series (new), appointment_links (new), appointment_notices (new) | Schedule Appointment: every section of the form (below). 409 `SCHEDULING_CONFLICT` unless `overrideConflicts` (Owner, Admin; audited). Retry-safe by `idempotencyKey` |
| `PATCH /business/appointments/{id}/details` | Owner, Admin, Staff (full only) | `UpdateAppointmentDetailsRequest` / `AppointmentRecord` | to build | as above | Edit Existing; sends an update notice when time, staff, place or link change; 409 `SAVE_CONFLICT` on a stale `version` |
| `GET /business/appointment-drafts`, `POST`, `PUT /{id}`, `DELETE /{id}` | Owner, Admin, Staff (own drafts) | `SaveAppointmentDraftRequest` / `AppointmentDraft`, `AppointmentDraftList` | to build | appointment_drafts (new) | Save as Draft (nothing booked or sent) |

Form sections to fields (`ScheduleAppointmentRequest`): Client Information = `contact` (CLIENT, LEAD, or a new CONTACT with name, business name, email, phone, client type); Appointment Details = `typeId`, `serviceId`, `startsAt`, `endsAt` (Date, Start Time, End Time; Duration is worked out), `timezone`, `method` (In Person, Phone, Zoom / Video, Other), `officeId`, `roomId`, `details`, `generateVideoLink`, `videoUrl`; Staff & Status = `staffUserIds` (one or more), `status` (Pending / Confirmed), `color`, `allDay`; Notes & Instructions = `internalNotes`, `clientInstructions`; Related Items = `related` (tax return, bookkeeping engagement, invoice, task, intake form to send before, document request to require before); Client Reminders = `reminders` (Email, SMS, Portal, each an amount and unit) and `sendConfirmation` ("Send Confirmation Message Immediately"); Recurrence = `recurrence` (Does not repeat / daily / weekly / monthly / custom). The Appointment Summary panel is the form's own values (browser only).

## Staff Availability panel and Edit My Availability

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/availability/day` | Owner, Admin, Staff (times and names only for others) | `StaffDayQuery` / `StaffDay` | to build | working_hours, blocked_times, appointments, availability rules (new), connected calendars (Integrations, later) | Staff Availability tab: staff and date pickers, hour rows (Available, Team Meeting, Selected Time, Client Consultation, Blocked (Admin)), "No Conflicts - ... is available at this time" |
| `POST /business/appointments/conflicts` | Owner, Admin, Staff | `ConflictCheckRequest` / `ConflictResult` | to build | as above + rooms (new) | Conflict state before saving (all assigned staff, room, client double-booking, buffers, every occurrence of a series) with alternative times |
| `GET /business/availability/{userId}/rules`, `PUT ...` | the member themselves; Owner, Admin for anyone | `SetAvailabilityRulesRequest` / `AvailabilityRules` | to build | availability_rules, availability_overrides, time_off (new) | Edit My Availability tab (and the "Edit My Availability" link): date overrides, time off, buffers, minimum notice, maximum booking window, busy calendars, effective date |
| `GET /business/availability`, `PUT /business/availability/{userId}/working-hours`, `GET/POST /business/blocked-times`, `DELETE /business/blocked-times/{id}` | | | exist (R12) | working_hours, blocked_times | Weekly working hours and blocked time in Edit My Availability |

## Appointment types and notice settings

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET/POST /business/appointment-types`, `PATCH /{id}`, `POST /{id}/archive`, `/restore` | | | exist (R12) | appointment_types | Manage Appointment Types: name, default duration, location, client self-booking, cutoff, active / inactive |
| `GET /business/appointment-types/{id}/config`, `PUT ...` | read: everyone; change: Owner, Admin | `SetAppointmentTypeConfigRequest` / `AppointmentTypeConfig` | to build | appointment_type_config (new, or columns on appointment_types) | the rest of the guide's type settings: description, related service, eligible staff, methods, offices, buffers, notice / window, required intake form, required documents, default reminders, colour |
| `GET /business/appointments/settings`, `PUT ...` | Owner, Admin | `SetAppointmentNoticeSettingsRequest` / `AppointmentNoticeSettings` | to build | business_branding.admin_email (master email, Settings contract), appointment settings (new) | The guide's firm master email copy rule and default reminders (no design) |

## New database work this needs (Rasel)

Columns on `appointments`: `confirmed_at`, `color`, `all_day`, `internal_notes`, `client_instructions`, `service_id`, `office_id`, `room_id`, `series_id`, `timezone`, `lead_id` (with `client_id` made optional when a lead or a new contact is booked, or a contact table), `location_kind` value `OTHER`. New tables: `appointment_staff` (more than one staff member), `appointment_reminders`, `appointment_notices` (delivery history), `appointment_series`, `appointment_links` (related items), `appointment_drafts`, `availability_rules` / overrides / time off, offices and rooms, appointment type config, appointment notice settings.

## Not in the designs, or in conflict

- **Statuses**: the designs show Confirmed, Pending, Rescheduled; the database has SCHEDULED, CANCELLED, COMPLETED, NO_SHOW. `AppointmentDisplayStatus` maps them (Pending vs Confirmed needs `confirmed_at`; Rescheduled is a moved SCHEDULED one).
- **Leads and new contacts**: R12's appointment needs a client. Booking a lead or a typed-in contact needs the schema change above.
- **More than one staff member** per appointment: one `staff_user_id` today.
- **Rooms and offices**: no tables (shared with Settings > Company Profile locations, also not designed).
- **Zoom link generation and calendar sync**: need the Integrations module; `videoProvider` is null until then and `generateVideoLink` answers 409 `VIDEO_NOT_CONNECTED`.
- **Appointment detail panel, Manage Appointment Types and Appointment Reports** have no design of their own; the guide describes them. The contract covers their data.
- **Firm master email**: the guide wants it in Settings; it is the Settings contract's Primary/Admin Email (`adminEmail`).
- **Time zone shown as "(GMT-04:00) Eastern Time (ET)"**: the API speaks IANA names (`America/New_York`); the screen formats the label.
