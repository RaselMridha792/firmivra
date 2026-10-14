# Intake Forms: contract for the API session (R43)

Written by R43 (Oct 15) so Arfan builds the Intake Forms screens on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/intake-forms/source/` (dashboard and Frames 1 to 5; the guide is the `.docx` there, with its "decisions required" register).

- R11's intake contract stays as it is: the form engine (`intake/definition.ts`, `answers.ts`), the portal side (`api.myIntakes`) and the firm's review calls (`intake/intakes.ts`: `createIntakesClient`, not yet on `api`). The new contract: `packages/types/src/intake/workspace.ts`, client `createIntakeFormsClient` (`api.intakeForms`) in `intake/workspace-client.ts`. It calls R11's existing routes where they fit (responses, Mark Reviewed, Request Revision).
- Mock: `apps/web/src/mocks/intake-forms.ts` (`NEXT_PUBLIC_API_MOCK=intakeForms`; `NEXT_PUBLIC_API_MOCK_EMPTY=intakeForms`).
- An assigned form is an `intakes` row (`IntakeStatus`; SENT shows as "Not Started"); a form or template is an `intake_forms` row (`IntakeFormStatus`). Paths under `/api/v1/business`, `@Access('INTAKE_FORMS')`; Staff see only their own clients' and leads' forms (others 404); the builder, templates and settings need Manage. No business id in any path, query or body. Every send, resend, reminder, review, revision, assignment, expiration change and setting change is audited. Answers and files are never emailed: a secure link or the portal. Static paths (`/summary`, `/send`, `/send-drafts`) go before `/:id`.

## Dashboard

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/intakes/summary` | grid view | - / `IntakeDashboardSummary` | to build | intakes | KPI cards: Total Forms, Sent, In Progress, Completed, Expired ("vs last month"); Form Status Chart (Completed, Submitted, In Progress, Not Started, Expired) |
| `GET /business/intakes` | grid view | `AssignedFormsQuery` / `AssignedFormPage` | to build (R11 lists one client's only: `GET /business/clients/{id}/intakes`) | intakes, intake_forms, engagements, clients, leads, intake activity (new) | Tabs All Forms, Sent, In Progress, Submitted, Completed, Expired; search "client name, email, service, or status"; More Filters (staff, date range, template, service); table: Client / Lead, Form Name, Service, Status, Date Sent, Last Activity, Assigned To, Actions (eye, send, menu); "Showing 1-8 of 24", pages, 8 per page |
| `GET /business/intake-forms?templates=true&sort=used` | grid view | `IntakeFormsQuery` / `IntakeFormList` | to build | intake_forms (+ new columns) | Form Templates sidebar (View All opens Frame 4) |

Quick Actions: Send Form to Client (Frame 2), View Form Submissions (tab Submitted), Create Form Template (Frame 1 as a template), Manage Form Settings (Frame 5); Go to Automations opens the Automations module.

## Frame 1: Create New Intake Form (builder)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `POST /business/intake-forms` | grid manage | `SaveIntakeFormRequest` / `IntakeFormDetail` | to build | intake_forms (definition JSON; new columns name, category, description, internal_notes, is_template, settings) | Form Details (Form Name, Service / Category, Description visible to client 0/500, Internal Notes 0/500, Form Template: from scratch / existing template / duplicate); Save as Draft |
| `GET /business/intake-forms/{id}`, `PUT ...` | read: grid view; save: grid manage | `SaveIntakeFormRequest` / `IntakeFormDetail` | to build | intake_forms | Build Your Form: sections (add, rename, duplicate, delete, reorder; question counts), Add Questions (15 types), Logic & Rules (`showIf`), Form Settings (require all, file uploads, e-signature, progress bar, expiration, Custom Success Message 0/200); 409 `FORM_PUBLISHED` |
| `POST /business/intake-forms/{id}/publish` | grid manage | - / `IntakeFormDetail` | to build | intake_forms (version, PUBLISHED) | Publish Form: validates (400 `FORM_INCOMPLETE`) and freezes a version; sent forms keep their version |
| `POST /business/intake-forms/{id}/duplicate` | grid manage | `{ asTemplate }` / `IntakeFormDetail` | to build | intake_forms | Duplicate an existing form; Save as Template (guide) |
| `POST /business/intake-forms/{id}/archive` | grid manage | - / `IntakeFormDetail` | to build | intake_forms (RETIRED) | template menu Archive (past submissions untouched) |

The builder's sections and questions (`FormSection`, `FormQuestion`) are converted by the API into R11's `IntakeFormDefinition` (one step per section, fields by type) on publish, so the portal renders them with the existing engine. Preview is in the browser.

## Frame 2: Send Intake Form

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `POST /business/intakes/send` | grid create | `SendIntakeFormRequest` / `SendIntakeFormResult` | to build (R11's `POST /business/engagements/{id}/intakes` sends a service's form to a client's engagement only) | intakes (+ lead or contact recipient, channel, subject, message, expires_on, assigned_user_id, reminder schedule, allow_save, new), intake activity, notifications / email / SMS | 1 Select Recipient (Client / Lead tabs, search), 2 Select Form (with question count, Preview Form), 3 Delivery Method (Email, SMS, Client Portal), 4 Message & Settings (Subject, Message 0/500, Due Date, Expiration Date, Assign To, Send Reminders with Edit Schedule, Allow Client to Save and Continue), 5 Review & Send (summary, Ready to Send, Send me a copy), Send Form. 409 `FORM_ALREADY_OPEN`, `PORTAL_UNAVAILABLE`; 400 `SMS_UNAVAILABLE`. Retry-safe |
| `GET /business/intakes/send-drafts`, `POST`, `PUT /{id}` | grid create | `SaveSendDraftRequest` / `SendDraft` | to build | intake_send_drafts (new) | Save as Draft (nothing sent) |

## Frame 3: Intake Form Detail / Submission Review

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/intakes/{id}/record` | grid view | - / `AssignedFormRecord` | to build | intakes, intake_submissions, documents, intake notes (new), intake activity (new) | Header (Client, Form Name, Service, Status, Date Sent, Submitted, Assigned To), Submission Summary (percent, four checks, View Form), Uploaded Documents, Internal Notes, Activity Timeline; tabs Documents, Notes, Communication, History |
| `GET /business/intakes/{id}` | grid view | - / `IntakeView` | **exists** (R11) | intakes, intake_submissions | Overview panels and the Responses tab: the answers by the form's sections (SSN and EIN as last 4; bank numbers masked) |
| `POST /business/intakes/{id}/complete` | grid approve | - / `IntakeView` | **exists** (R11) | intakes | Mark Reviewed |
| `POST /business/intakes/{id}/request-correction` | Owner, Admin | `RequestIntakeCorrectionRequest` / `IntakeView` | **exists** (R11) | intakes | Request Revision |
| `POST /business/intakes/{id}/notes` | grid edit | `AddFormNoteRequest` / `FormNote` | to build | intake notes (new) | Add Note |
| `PATCH /business/intakes/{id}` | grid edit | `UpdateAssignedFormRequest` / `AssignedFormRecord` | to build | intakes | row menu Assign Staff, extend expiration (an expired form reopens), due date |
| `POST /business/intakes/{id}/resend`, `/remind`, `/archive` | grid create / edit | - / `AssignedFormRecord` | to build | intakes, intake activity | Resend Form, reminder, Archive Form |
| `GET /business/intakes/{id}/pdf` | grid export | - / `FormFileLink` | to build | intakes (rendered PDF, short-lived link) | Export PDF |

Send Follow-Up opens Messages with the recipient; Schedule Appointment opens Appointments.

## Frame 4: Form Templates

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/intake-forms?templates=true` | grid view | `IntakeFormsQuery` / `IntakeFormList` | to build | intake_forms, intakes (usage count, last used) | Category tabs (All, Personal Tax, Business Tax, Bookkeeping, Payroll, Advisory, Client Onboarding), search, More Filters, cards (name, questions, category, description, last updated, used, owner, Preview, Edit, Use Template, menu View / Edit / Duplicate / Archive / Send), Recently Used (`sort=recent`) |
| `GET /business/intake-forms/summary` | grid view | - / `IntakeFormLibrarySummary` | to build | intake_forms, intakes | KPI cards Total Templates, Most Used, Custom Templates, Recently Updated (30 days); Template Categories counts |

Use Template opens Frame 2 with the template; Edit opens Frame 1.

## Frame 5: Intake Form Settings

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/intake-settings`, `PUT ...` | read: grid view; save: grid manage | `UpdateIntakeSettingsRequest` / `IntakeSettings` | to build | intake_settings (new, one per firm) | General, Client Experience, Notifications & Reminders, Automation Rules, Branding, Security & Compliance panels; Save Changes / Save Settings; 409 `SAVE_CONFLICT` |
| `POST /business/intake-settings/reset` | grid manage | `ResetIntakeSettingsRequest` / `IntakeSettings` | to build | intake_settings | Reset Defaults (confirm) |
| `POST /business/intake-settings/test-reminder` | grid manage | - / `OkResponse` | to build | email | Test Reminder Email (to the signed-in member only) |
| `GET /business/intake-settings/changes` | grid view | - / `IntakeSettingsChangeList` | to build | audit_logs (intake settings actions) | Recent Changes |

Status cards: Email Reminders (from `notifications`), Automation Rules (`automation.automationRuleCount`, from the Automations module), E-Sign (`general.requireSignature`). The Settings Checklist is worked out in the browser from the settings. Client Preview is the browser's.

## New database work this needs (Rasel)

On `intake_forms`: name, category, description, internal_notes, is_template, custom, settings (JSON), builder sections (or keep them in `definition`), service optional. On `intakes`: recipient lead or contact without an engagement, channel, subject, message, expires_on, assigned_user_id, reminder schedule, allow_save, archived. New tables: `intake_notes`, `intake_activity` (opens, saves, reminders, resends), `intake_send_drafts`, `intake_settings`.

## Not in the designs, or in conflict (the guide's register, decided here only as a proposal)

- **Submitted vs Completed**: kept as R11 has them (Completed = staff reviewed). The detail design shows "Completed" with "Ready for review"; the screen should show the record's real status.
- **Edit links on submitted answers**: answers stay read-only; Edit means Request Revision. No staff overwrite in this contract.
- **Due date and expiration**: two dates, as the send screen shows; expiration closes editing, due date only flags.
- **"Require all questions"** sets every question required when on; per-question settings come back when off.
- **Publish vs Save & Send**: Publish makes the form usable; sending is Frame 2.
- **Encrypted uploads toggle**: always on; the screen shows it on and disabled.
- **Auto-create client record**: trigger undefined; the switch is stored but does nothing until Octavia defines it.
- **Import Template, Submission Rules and Integrations panels, Template Settings**: no design; not in the contract.
- **Bulk actions** (checkboxes on the dashboard): no bulk menu designed; not in the contract.
- **Appointments / Tasks tabs** (earlier detail frame): not in the revised frame; the links go through Quick Actions.
- **Brand name**: the designs say LVP Pro; screens use the firm's branding, never a fixed logo.
