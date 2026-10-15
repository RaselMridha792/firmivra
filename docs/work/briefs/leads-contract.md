# Leads: contract for the API session (R43)

Written by R43 (Oct 15) so Arfan builds the Leads screens on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/leads/source/` (Leads, Individual Lead Profile, Convert Lead to Client; the guide is the `.docx` there).

- R11's Begin Online inbox (`packages/types/src/leads/schemas.ts`, `api.leads`) stays as it is. The new contract works on the same `leads` rows: `packages/types/src/leads/pipeline.ts`, client `createLeadPipelineClient` (`api.leadPipeline`) in `leads/pipeline-client.ts`.
- Mock: `apps/web/src/mocks/leads-pipeline.ts` (`NEXT_PUBLIC_API_MOCK=leadPipeline`; `NEXT_PUBLIC_API_MOCK_EMPTY=leadPipeline` for the empty state).
- Paths under `/api/v1`, all in the `business/leads` controller (`@Access('LEADS')`). The firm comes from the tenant context; no business id in a path, query or body. Every action checks the grid (view all or assigned only, create/edit, assign and stage, bulk and campaigns, convert and archive); nothing is hard-coded per role. Every change writes `AuditService.log` and a lead activity row. Static paths (`/pipeline`, `/options`, `/bulk`, `/messages`) go before `/:id`.

## Leads page

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/leads/pipeline` | Owner, Admin, grid view (Staff: assigned to them) | `LeadPipelineQuery` / `LeadPipelinePage` | to build (R11's `GET /business/leads` is the inbox: no stage, priority, source, next action, paging by page) | leads (+ new columns), lead_services (new), lead_activities (new), memberships | Table: Name (avatar or initials), Contact Info, Lead Source / Campaign, Services Interested In, Priority, Status, Last Contact, Next Action (overdue in red), Assigned To, Date Added, Actions; filters All Lead Sources, All Services, All Lead Statuses, All Staff Members, Date Range, More Filters (priority, campaign, tag); search "name, email, phone, source"; "Showing 1-8 of 156", pages, 8 per page |
| `GET /business/leads/pipeline/summary` | as above | - / `LeadPipelineSummary` | to build | leads | KPI cards: Total Leads, New Leads, In Follow-Up, Converted to Clients, Not Qualified, Overdue Follow-Ups, each "vs last month" |
| `GET /business/leads/options` | as above | - / `LeadOptions` | to build | services, memberships, campaigns (Communications, later), lead tags | the filter dropdowns, Add New Lead and Assign Staff pickers |
| `POST /business/leads` | grid create | `CreateLeadRequest` / `LeadProfile` | to build | leads, lead_services, lead_activities | Add New Lead (header button) with the guide's fields; 409 `POSSIBLE_DUPLICATE` on a matching email or phone unless `allowDuplicate` |
| `POST /business/leads/bulk` | grid edit (assign, stage), grid manage (campaign, tags), grid delete (archive) | `LeadBulkRequest` / `LeadBulkResult` | to build | leads, lead_tags, lead_activities | Bulk bar: Assign Staff, Change Status, Add to Campaign, Add Tags, Delete (archive; never removed from history) |
| `POST /business/leads/messages` | grid create | `LeadMessageRequest` / `LeadBulkResult` | to build (sends through Communications / Messages) | lead_activities; communications (to build) | Send Email, Send SMS (bulk bar and row icons) |

Row icons: Call Lead (opens `tel:` and logs with `logActivity`), Send Email, Send SMS (`message`), Schedule Appointment (opens Appointments' scheduling form with the lead prefilled: `api.scheduling` contact kind LEAD, R42), Add/View Notes, Activity (chart icon: the profile's Activity tab), Convert to Client, More Actions (View, Edit, Assign, Tags, Change Status, Archive).

## Lead Profile

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/leads/{id}/profile` | grid view | - / `LeadProfile` | to build (R11's `GET /business/leads/{id}` is the Begin Online review) | leads, lead_services, lead_activities, lead_notes, tasks, appointments | Header (name, Lead ID, priority, status, source, added, last contact, assigned to, Interested In + Add Service); Overview tab: Contact Information, Lead Details, Next Follow-Up, Lead Score, Interested In, Recent Activity, Upcoming Appointments, Open Tasks |
| `PATCH /business/leads/{id}` | grid edit | `UpdateLeadRequest` / `LeadProfile` | to build | leads, lead_services, lead_tags | Edit links (Contact Information, Lead Details), Assigned To Change, Add Tag, Add Service, Change Status, Mark Not Qualified (stage DECLINED); 409 `SAVE_CONFLICT` |
| `PUT /business/leads/{id}/follow-up`, `POST .../follow-up/complete` | grid edit | `SetFollowUpRequest`, `CompleteFollowUpRequest` / `LeadProfile` | to build | leads (next_action_*), lead_activities | Next Action / Follow-Up card (Action Type, Date, Time, Notes, Save Follow-Up); completing logs it and lets the next one be set |
| `GET /business/leads/{id}/activity`, `POST ...` | grid view; log: grid edit | `LeadActivityQuery` / `LeadActivityPage`; `LogLeadActivityRequest` / `LeadActivity` | to build | lead_activities | Activity tab, Communications tab (`kind=communications`), Recent Activity View All, Log Activity, Call |
| `GET /business/leads/{id}/notes`, `POST ...` | grid view; add: grid edit | `AddLeadNoteRequest` / `LeadNote` | to build | lead_notes (new) | Notes tab, Add/View Notes |
| `GET /business/leads/{id}/tasks` | grid view | - / `{ items: LeadTask[] }` | to build | tasks (+ lead_id, new) | Tasks tab, Open Tasks (Add Task opens Tasks prefilled) |
| `GET /business/leads/{id}/appointments` | grid view | - / `{ items: LeadAppointment[] }` | to build | appointments (+ lead_id, R42 Appointments contract) | Appointments tab, Upcoming Appointments (empty state "No appointments scheduled yet") |
| `GET /business/leads/{id}/documents-and-forms` | grid view | - / `LeadDocumentsAndForms` | to build | lead_uploads, intakes (lead_id exists) | Documents & Forms tab; Quick Actions Send Intake Form (Intake Forms' send, recipient kind LEAD), Upload Document |

The Campaigns tab and "Add to Campaign" need the Communications module's campaigns (not built): `campaign` is on the lead, and `LeadOptions.campaigns` is optional until then.

## Convert Lead to Client (five steps)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `POST /business/leads/{id}/convert-to-client` | grid convert | `ConvertLeadToClientRequest` / `ConvertLeadToClientResult` | to build (R11's `POST /business/leads/{id}/convert` takes one service and no carry-over choice; keep it for Begin Online) | clients, client_profiles, engagements (one per service), client assignments, leads (CONVERTED + client link), notes, documents (lead uploads become documents as R11 does), intakes, appointments, tasks, invites | Step 1 Review Lead Information (from the profile); step 2 Client Details & Services (Client Type, Full Name, Business Name, Email, Phone, Address, Services to Activate, Primary Staff Member, Additional Team Members); What to Carry Over (nine boxes); step 3 Portal & Settings (Send portal invitation now / later); step 4 Review & Confirm; step 5 Complete (counts carried). Retry-safe by `idempotencyKey`; 409 `DUPLICATE_EMAIL` (convert into that client with `clientId`), `ALREADY_CONVERTED` |

## New database work this needs (Rasel)

On `leads` (most of this landed in R37, `20261014190016_r37_lead_fields`): `number` (per-firm "LD-10024"), the pipeline statuses on `status` (no separate stage column), `priority`, `source`, `source_detail`, `campaign_id`, `business_name`, `address`, `date_of_birth` (encrypted like a client's), `best_time_to_contact`, `preferred_contact` (array), `assigned_user_id`, `next_action_type`, `next_action_at`, `next_action_notes`, `last_contact_at`, `last_contact_channel`, `archived_at`; `service_id` becomes optional for manual leads, or move services to `lead_services`. New tables: `lead_services`, `lead_tags`, `lead_notes`, `lead_activities`; `lead_id` on `tasks` and `appointments`. A Begin Online lead starts at SUBMITTED ("New Lead") with source BEGIN_ONLINE.

## Not in the designs, or in conflict

- **Lead Score** (85, High Intent): no rule anywhere. `score` is optional and left out until someone defines it.
- **Campaigns** (column, tab, bulk action): need the Communications module.
- **Call** needs a calling integration; until then it opens the phone and logs the call.
- **Statuses**: the design's table shows "No Response" and "Converted"; the guide's list is New Lead, Contacted, In Follow-Up, Appointment Scheduled, Qualified, Converted to Client, Not Qualified, Lost / No Response. The stage is the database's `LeadStatus` without DRAFT and EXPIRED (`LeadPipelineStatus`, labels in `LEAD_STATUS_LABELS`): SUBMITTED is "New Lead", DECLINED is "Not Qualified", "No Response" is LOST; IN_REVIEW ("In Review") stays for Begin Online leads opened before R37.
- **Delete** in the bulk bar: the guide says no automatic deletion and keep history; the contract archives.
- **Two "Actions" columns** in the table header (a design slip): one Actions column with the icons and the menu.
- **Photos** of leads: no storage; initials.
- **R11 and the pipeline**: R11's `ReviewedLeadStatus` (SUBMITTED, IN_REVIEW, CONVERTED, DECLINED) stays for the Begin Online inbox; the pipeline uses the same column with all its statuses. Rasel to decide whether the inbox becomes a filter of this page later.

## Enums: one source (R47)

The contract uses the database enums from `db-enums.ts` (generated from the Prisma schema), and the package root exports those: `LeadSource` (11 values; R47's migration `20261015060000_r47_lead_enums` added PHONE_CALL, WALK_IN, EMAIL and EVENT), `LeadPriority` (HOT, WARM, COLD) and `LeadActivityKind` (CREATED, STATUS_CHANGED, FORM_SUBMITTED, EMAIL_SENT, SMS_SENT, CALL, MEETING, NOTE, FOLLOW_UP, FOLLOW_UP_COMPLETED, APPOINTMENT_SCHEDULED, TAG_ADDED, ASSIGNED, CONVERTED, and R47's DOCUMENT and CAMPAIGN). The `stage` fields, the `stage` filter and the bulk `STAGE` action hold a `LeadPipelineStatus`. Log Activity takes CALL, EMAIL_SENT, SMS_SENT, MEETING or FOLLOW_UP; the Communications tab is CALL, EMAIL_SENT and SMS_SENT. Still different: the contract's `NextActionType` adds SMS and CLOSE_LEAD to the database's `LeadActionType`, and Log Activity's summary allows 1,000 characters where `lead_activities.summary` takes 200 (longer text goes in `body`). Both need a decision before the follow-up and activity API.
