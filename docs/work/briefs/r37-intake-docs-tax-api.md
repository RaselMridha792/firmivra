# R37 intake forms, documents, tax returns, appointments, clients and leads: API brief

The database for these six modules is in `packages/db` (migrations `20261014190001` to `190016` named `r37_*`, the "R37" columns on their models and the R37 section at the end of `schema.prisma`, tests `packages/db/test/{intake,documents,document,tax-return,appointment,client,lead}-*.test.ts`, synthetic LVP rows in `packages/db/prisma/seed-r37.ts`). This is the brief for the API sessions: the endpoints the screens need, who may call them, which routes already exist and what is deliberately not done yet. Designs and written guides: `docs/mockups/firm-workspace/<module>/source/`. Contracts already on main: `intake-forms-contract.md` and `leads-contract.md` (R43) in this folder.

Paths are under `/api/v1`. Every write calls `AuditService.log` (ids and codes only, no free text, never document content, SSN, EIN or bank numbers). `businessId` from the tenant context only; `TenantPrisma.db` for every query; zod schemas from `packages/types`; an e2e test per endpoint and a firm A versus firm B test. List endpoints take `page`/`pageSize` with a total (the designs show "Showing 1 to 10 of 248"), not only cursors.

## Roles: use the R35 permission grid

R35 is on main (eight roles, `PermissionModule`/`PermissionCapability`, `DEFAULT_ROLE_PERMISSIONS`, the firm's `role_permissions` and `member_permissions`). Do not use `FIRM_STAFF` or `FIRM_MANAGERS` on new routes: use `@Access(module, capability?)` from `apps/api/src/auth/decorators.ts` (read `docs/work/briefs/r35-staff-roles-api.md` and `apps/api/README.md`, "Adding a module"). The Roles column below says which capability a route needs in the module of its section; the HTTP method gives it when `capabilityOfMethod` is enough:

| Column says | Capability | Notes |
| --- | --- | --- |
| `VIEW`/`CREATE`/`EDIT` by method | GET = VIEW, POST = CREATE, PATCH/PUT = EDIT | A POST that only changes something (send, resend, remind, status, review, archive of a draft) is EDIT: pass it to `@Access` explicitly. |
| `DELETE` | DELETE | Archive, trash and restore of documents and leads, delete of a never-filed return. |
| `APPROVE` | APPROVE | Extend an intake, unlock, request correction, tax return approvals and ready-to-file or close, client INACTIVE. |
| `MANAGE` | MANAGE | Templates, folders, types, offices, rooms, settings, tag catalog. |
| `EXPORT` | EXPORT | CSV and bulk export (masked and audited). |

Default grid, to know who gets what (Owner and Admin have all): Staff and Manager have VIEW/CREATE/EDIT in Clients, Leads, Appointments, Intake Forms, Documents, Tax Returns; Tax Preparer has Clients VIEW/CREATE/EDIT, Appointments VIEW/CREATE, Intake Forms VIEW/CREATE, Tax Returns VIEW/CREATE, the rest VIEW; Client Support has Clients and Appointments VIEW/CREATE/EDIT, Leads, Intake Forms and Documents VIEW; Bookkeeper has Clients VIEW and Documents VIEW/CREATE; Read Only has Clients and Appointments VIEW. Staff (role STAFF) still see only clients assigned to them, as today. Existing routes keep `@Roles(...FIRM_STAFF)` until they are moved to `@Access` (do that when you extend them).

## Database walls the API must respect

- Same-firm composite foreign keys, forced RLS and `firmivra_app` grants are on every new table; open the scope with `forBusiness(businessId)` or `TenantPrisma.db`. Tables the app may only read (history tables, written by SECURITY DEFINER triggers) cannot be written from the API: `tax_return_history` and `client_status_history`. Do not try to insert there.
- The database keeps these: per-firm numbers (client number, tax return and lead numbers), `sent_at`, `completed_at`, a tax return's `status` from `workflow_status` (status is derived, never written by the API), the filing status from its newest attempt, `last_activity_at` from the API (not from triggers: see deferred items), reminders and series never create two rows for one occurrence (`idempotency_key`), double-booking of one staff member (with buffers) is refused with an error the API maps to 409.
- Rules on new enum values (for example the new lead statuses) live in trigger bodies: map the database error code to a 4xx, never to a 500.

## Endpoints

### Intake Forms (`INTAKE_FORMS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/intakes` | Dashboard list: `status`, `q`, `assignedUserId`, `serviceId`, `templateId`, `sentFrom/To`, `sort`, `page` | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/intakes/summary` | KPI cards with month-over-month change, status chart | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/intakes` | Create and send, or save as DRAFT, for a client or a lead (channel, subject, message, due, expiry, assignee, reminders, allowSaveResume) | `VIEW`/`CREATE`/`EDIT` by method (new; today only `POST business/engagements/:id/intakes` sends) |
| PATCH `business/intakes/:id` | Edit a draft's setup, reassign, change dates | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/intakes/:id/send` · `/resend` · `/remind` · `/archive` | Send a draft; resend (sentAt unchanged); manual reminder; archive (a draft is archived, never deleted) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/intakes/:id/extend` | New `expiresAt`; reopens an EXPIRED one | `APPROVE` (new) |
| GET `business/intakes/:id/history` · `/communications` · `/pdf` | Audit entries (uses the new `audit_logs` index), sends/reminders, export | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST `business/intakes/:id/notes` | Internal notes. Needs a place to store them: `notes` is client-only and belongs to the work-modules group (see "Not in these PRs") | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST `business/intake-templates`, GET `…/:id`, PUT `…/:id/draft`, POST `…/:id/publish` · `/duplicate` · `/archive` · `/restore`, GET `…/summary` | Form Templates and the builder (versions are `intake_forms` rows) | list/get `VIEW`/`CREATE`/`EDIT` by method, rest `DELETE` (new) |
| GET `business/intake-forms/:formId` | One version, for preview and for the version an intake was sent with | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/PUT `business/intake-settings`, POST `…/reset` · `/test-reminder`, GET `…/changes` | Settings page (`intake_settings`), recent changes from the audit log | read `VIEW`/`CREATE`/`EDIT` by method, write `MANAGE` (new) |
| GET/PUT/POST `portal/:firmSlug/forms/:token/…` | A lead recipient's secure link (`intakes.access_token_hash`) | public, token (new) |
| Exists | `GET business/clients/:id/intakes`, `GET business/intakes/:id`, `POST …/review` · `/complete` (`EDIT`), `…/request-correction` · `/unlock` (`APPROVE`), `portal/:firmSlug/me/intakes/…` (CLIENT) | |
| Gap | `GET business/team` needs `STAFF_MANAGEMENT` `VIEW`, so staff cannot load the "Assign to" list: add a list of assignable members for any role with `CREATE` or `EDIT` in the module of assignable members | |

### Documents (`DOCUMENTS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/documents` | Firm-wide library: client, category, folder, `reviewStatus`, service, year, reviewer, dates, `scope` (active/archived/trash), `q`, sort, pages | `VIEW`/`CREATE`/`EDIT` by method (new; today per client only) |
| GET `business/documents/summary` | KPI cards and folder counts | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/documents/uploads` (+ confirm) | Upload with folder, description, tags, reviewer, `notifyClient`, `replacesId`; today's client route also gains them | `VIEW`/`CREATE`/`EDIT` by method (extend) |
| PATCH `business/documents/:id` | Rename, details, folder, category, year, reviewer, `expiresOn` | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/documents/:id/review` · `/archive` · `/restore` · `/trash` · `/untrash` | Start review, verify, request replacement, complete; archive and trash (trash needs `DELETE`) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/documents/:id/versions` · `/activity` · `/preview` | Version chain, audit entries, inline preview link (CLEAN only) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/documents/bulk` | Reclassify, assign reviewer, archive, download links | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/documents/:id/access` · POST `…/shares` · PATCH/POST `…/shares/:shareId` (+ `/revoke`) · GET `…/access-history` | Sharing (`document_shares`): client login or member, view/download/upload/sign, expiry. Clients only for non-INTERNAL documents | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/document-requests`, `…/summary`, GET/PATCH `…/:id`, POST `…` · `/:id/send` · `/resend` · `/remind` · `/complete` · `/cancel` · `/bulk` | Requests dashboard and Create request (`document_request_packets`, items are `document_requests` rows) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST/PATCH/DELETE `business/document-requests/:id/items[/:itemId]` + `/items/reorder` | Checklist items (draft only) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST/PATCH `business/document-request-templates` (+ `/archive`) | Request types and "My saved lists" | list `VIEW`/`CREATE`/`EDIT` by method, firm types `DELETE`, own lists `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST/PATCH/DELETE `business/document-folders` (+ `/reorder`) | Folder tree | list `VIEW`/`CREATE`/`EDIT` by method, write `DELETE` (new) |
| POST/PATCH `business/document-categories` | Document types (write routes missing today) | `MANAGE` (new) |
| GET/PATCH `business/document-settings` | Documents settings | read `VIEW`/`CREATE`/`EDIT` by method, write `MANAGE` (new) |
| GET `portal/:firmSlug/me/document-requests[/:id]`, POST `…/:id/submit` | Portal request page, "Submit for review" | CLIENT (extend/new) |
| Exists | `GET business/clients/:clientId/documents`, `POST …/documents/uploads` + `business/documents/uploads/confirm`, `GET business/documents/:id[/download]`, `GET business/document-categories`, `GET/POST business/clients/:clientId/document-requests`, accept/reject/cancel, the portal document routes | |

### Tax Returns (`TAX_RETURNS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/tax-returns` | Firm-wide list: tabs, `taxYear`, `formType`, client type, `workflowStatus`, preparer, dates, `q`, sort, pages | `VIEW`/`CREATE`/`EDIT` by method (new; today per client only) |
| GET `business/tax-returns/summary` | KPI cards (+ month change from `tax_return_history`), season progress | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/tax-returns/:id` | Workspace header: people, deadline, extension, prior year, blockers ("Next steps") | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST/PATCH `business/clients/:id/tax-returns`, `business/tax-returns/:id` | Create/edit with the new columns; duplicate warning | `VIEW`/`CREATE`/`EDIT` by method (exists, extend) |
| POST `business/tax-returns/:id/status` | Move `workflowStatus` with a reason when going back; the database checks the gates | `VIEW`/`CREATE`/`EDIT` by method; ready-to-file/close `APPROVE` or reviewer (new) |
| GET `…/history` · `…/activity` | Status/assignment log; merged timeline | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `…/archive` · `/restore`; DELETE (never-filed only) | | `DELETE` (new / tighten delete) |
| POST `…/amend` · `/carry-forward` · POST `business/tax-returns/import` | Amended return, next-year copy, single import | `VIEW`/`CREATE`/`EDIT` by method / `MANAGE` (new) |
| GET/PUT `…/filings`, POST `…/filings/:id/attempts`, PATCH `…/attempts/:attemptId`, POST `…/filings/:id/paper-filed` | Jurisdictions, recorded transmissions and acknowledgments (status tracking only, nothing is sent) | `VIEW`/`CREATE`/`EDIT` by method / transmissions `MANAGE` (new) |
| GET/POST/PATCH `…/checklist[/:itemId]`, POST `…/final-validation` | Preparation/review lists and the manual final validation | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `…/approvals`, POST `…/approvals/:id/approve` · `/return` | Review steps | assignee or `APPROVE` (new) |
| GET/PUT `…/authorizations`, POST `…/authorizations/:id/link` | Signature lines; sending/status reuse `esign/requests` | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST/DELETE `…/documents` | A file's role in the return | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/tax-returns/reports/efile`, `…/export` | E-file report, CSV export (masked, audited) | `EXPORT` (new) |
| Exists | `GET/POST business/clients/:id/tax-returns`, `PATCH/DELETE business/tax-returns/:id`, `GET portal/:firmSlug/me/tax-returns` (CLIENT, unchanged: `status` is derived) | |

### Appointments (`APPOINTMENTS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/appointments/summary` | KPI cards (total, next 7 days, completed, no-shows, cancelled) with change | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/appointments/list` | Paged List/Today/Upcoming: `q`, `status`, `confirmed`, `when`, staff, client | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST/PATCH `business/appointments[/:id]` | Booking/edit with service, time zone, all-day, colour, notes, instructions, `confirmedAt`, `idempotencyKey`, office/room, reminders, series, buffers | `VIEW`/`CREATE`/`EDIT` by method (exists, extend) |
| POST `…/:id/confirm` · `PUT …/:id/reminders` · `POST …/:id/send-reminder` · `POST business/appointments/send-reminders` | Confirm, reminder schedule, send now | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/appointments/conflicts` | "No conflicts" panel: staff, client, blocked time, room, buffers | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST/PATCH `business/offices`, `…/:id/rooms` | Offices and rooms | list `VIEW`/`CREATE`/`EDIT` by method, write `MANAGE` (new) |
| GET/PUT `business/availability/:userId/overrides` | One-day changes | self or `MANAGE` (new) |
| POST/PATCH `business/appointment-series…` | Cancel/change a series | `VIEW`/`CREATE`/`EDIT` by method (new) |
| appointment types | add the new fields to `business/appointment-types` | `APPROVE` (extend) |
| GET/PATCH `business/appointment-settings` | Defaults and the copy email | read `VIEW`/`CREATE`/`EDIT` by method, write `MANAGE` (new) |
| Exists | calendar GET, `slots`, `:id`, reschedule, cancel, complete, no-show, types, availability, blocked-times, portal appointment routes | |

### Clients (`CLIENTS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/clients` | Add filters (status, service kind, type, entity type, staff/unassigned, tags, priority, source, state/city, last activity, next appointment, balance, missing docs), sort, pages with a total, and the row fields (number, status, services, missing docs, balance, last activity, next appointment, tags) | `VIEW`/`CREATE`/`EDIT` by method (extend) |
| GET `business/clients/summary` | Cards and tab counts with change vs last month (`client_status_history`) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/clients/duplicate-check` | Likely matches on email, phone, name, leads | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST/PATCH `business/clients[/:id]` | New fields, `duplicateOverrideReason` | `VIEW`/`CREATE`/`EDIT` by method (extend) |
| POST `business/clients/:id/status` | Change status (INACTIVE needs `APPROVE`) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET `business/clients/:id/overview` · `/activity` | 360° cards; cross-module timeline | `VIEW`/`CREATE`/`EDIT` by method (new) |
| PUT `business/clients/:id/tags`; GET/POST/PATCH `business/tags` | Tags (catalog write needs `MANAGE`) | `VIEW`/`CREATE`/`EDIT` by method / `MANAGE` (new) |
| POST `business/clients/bulk/assign` · `/status` · `/tags` · `/engagements` · `/archive` · `/export` | Bulk actions (preview with `dryRun`) | assign/archive/export `EXPORT`, rest `VIEW`/`CREATE`/`EDIT` by method (new) |
| Exists | clients CRUD, profile, archive/restore, tax-years, engagements, documents, requests, intakes, tax returns, appointments, invoices, message threads, tasks, notes, audit log | |
| Not here | Bulk messages, requests, intake, e-sign, tasks, payment reminders and invoices belong to their own modules and take `clientIds[]` | |

### Leads (`LEADS`)
| Method and path | What | Roles |
|---|---|---|
| GET `business/leads` | Add filters (source, service, status, owner, dates, priority, tag, overdue, archived), `q`, pages with a total, row fields | `VIEW`/`CREATE`/`EDIT` by method (extend) |
| GET `business/leads/summary` · `/options` | Six cards with change; services and active members for the pickers | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/leads` | Add New Lead (409 `POSSIBLE_DUPLICATE` on email/phone) | `VIEW`/`CREATE`/`EDIT` by method (new) |
| PATCH `business/leads/:id` · POST `…/status` · `…/assign` · PUT/DELETE `…/next-action` · POST `…/next-action/complete` | Edit; change status; owner (staff only themselves); follow-up | `VIEW`/`CREATE`/`EDIT` by method (new) |
| GET/POST `business/leads/:id/activity` | Timeline, notes, logged calls | `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/leads/:id/archive` · `/restore`; POST `business/leads/bulk` | Archive (the UI's "delete"); bulk assign/status/tags/archive | archive `DELETE`, rest `VIEW`/`CREATE`/`EDIT` by method (new) |
| POST `business/leads/:id/convert` | Several services, contact overrides, carry-over options; from any open status | `VIEW`/`CREATE`/`EDIT` by method (extend) |
| Exists | `GET business/leads[/count|/:id]`, `POST …/review` (retire or map to CONTACTED), `POST …/decline` (= Not Qualified), upload download | |

## Routes that exist today and what they still lack

Each table's "Exists" row lists the routes on main. Gaps worth stating once: `GET business/clients`, `GET business/leads` and the per-client document, tax return and appointment lists have no filters, sorting or totals; intake send exists only through `POST business/engagements/:id/intakes`; there are no firm-wide document or tax return lists; no route writes document categories; no endpoint reads or writes any of the new tables.

## Deferred (not in the database yet; each needs a decision or an API and screens session first)

1. **Appointments without a client** (internal meetings, lead appointments), **`LocationKind.OTHER`** and **appointment DRAFT**: `appointments.client_id` stays required, no OTHER, no DRAFT. Making them change touches about sixteen API and web type sites; do it together with the Appointments screens, then add a migration.
2. **Firm-owned and lead documents**: `documents.client_id` stays required. The Documents design shows files without a client; needs a nullable client and a rule for who may read them.
3. **Changing a document's direction** (to the firm or from it): not modelled. Use shares (`document_shares`): INTERNAL documents cannot be shared with a client.
4. **External share links** (a person with no account): not built. The portal recipient of an intake link uses `intakes.access_token_hash`.
5. **Optional `leads.service_id`**: the lead's own service stays required; extra services are `lead_services`.
6. **Lead score and a lead date of birth**: not modelled (no score on the designs; priority is set by hand).
7. **Deleting a client**: not modelled; archive and restore only.
8. **Intake internal notes**: `notes` is client-only. Needs a table or a `notes` extension (Tasks and Notes group).
9. **Client photo and EIN hash**: not modelled (needs a file prefix rule and a hash decision).
10. **Widening `ReviewedLeadStatus`** (`packages/types/src/leads/schemas.ts`): the web maps use the four old reviewed statuses. The new lead statuses are database-only until the Leads screens move.
11. **Contact consent and filing extensions are not in these tables.** Email and SMS consent belongs to R39 `communication_consents`; extensions belong to R38 `compliance_deadlines` (`extension_filed_on`, `extended_due_on`). The Clients list and Tax Returns workspace read from those.
12. **Client last activity** is written by the API (`client_profiles` / client `last_activity_at`) when a module logs a client action. Triggers on documents and requests deadlocked concurrent uploads and were removed.
13. **Pay type, document scan and similar lists** follow the R35 brief; nothing new here.
14. **API e2e tests that failed before this change**: three document concurrency e2e tests failed on `main` before the merge; on the merged branch the whole suite passes from a clean database.

Resolved in R47 (Oct 15), formerly item 11, the contract and database lead enums: the database is the one source. Migration `20261015060000_r47_lead_enums` adds PHONE_CALL, WALK_IN, EMAIL and EVENT to `LeadSource` (11 values, as the Leads design shows) and DOCUMENT and CAMPAIGN to `LeadActivityKind`. The Leads contract (`leads/pipeline.ts`) now uses the generated `LeadSource`, `LeadPriority` and `LeadActivityKind` (STATUS_CHANGED, EMAIL_SENT, SMS_SENT, FOLLOW_UP_COMPLETED, APPOINTMENT_SCHEDULED, ...), and its stage is the database's `LeadStatus` without DRAFT and EXPIRED (`LeadPipelineStatus`; SUBMITTED is "New Lead", DECLINED is "Not Qualified"). There is no stage column. The second R47 migration (`20261015070000_r47_lead_action_summary`) adds SMS and CLOSE_LEAD to `LeadActionType` (the contract's `NextActionType` is now that enum) and widens `lead_activities.summary` from 200 to 1,000 characters; a CLOSE_LEAD next action still has a time (when the lead is closed).

## Where the data lives (per module)

- Intake Forms: `intakes` (+ send, assign, expiry, DRAFT), `intake_settings`, `intake_templates`, `intake_forms.template_id`.
- Documents: `documents` (folder, description, tags, review, expiry, versions, archive, trash), `document_folders`, `document_request_packets`, `document_requests` (items), `document_request_templates` and `document_request_template_items` (firm types and saved lists), `document_shares`, `document_settings`.
- Tax Returns: `tax_returns` (workflow columns), `tax_return_history`, `tax_return_filings`, `tax_return_filing_attempts`, `tax_return_approvals`, `tax_return_checklist_items`, `tax_return_authorizations`, `tax_return_documents`.
- Appointments: `appointments` (title, service, colour, confirmed, notes, idempotency key, time zone, all day), `appointment_reminders`, `firm_offices`, `firm_rooms`, `appointment_series`, `availability_overrides`, `appointment_settings`, `appointment_types` columns.
- Clients: `clients` and `client_profiles` columns (number, status, priority, source, client since, county), `client_status_history`, `client_tags`, `tags`.
- Leads: `leads` columns, `lead_services`, `lead_tags`, `lead_activities`, new `LeadStatus` values.
