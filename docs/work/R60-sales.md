# R60: Super Admin Sales (contract and API notes)

Part of `R60-backend.md` (steps 6 and 7). Tables: R0's stages B5 (`docs/work/R0-stage-b5-sales.md`)
and D1 (`docs/work/R0-stage-d1-sales-center.md`). Contract: `packages/types/src/admin-sales/`
(`createAdminSalesClient`, `api.adminSales`), under `/api/v1/admin/sales`. The screens' mock
(`apps/web/src/mocks/admin-sales.ts`, `admin-sales-seed.ts`) set the method names and shapes; the
B5 and D1 tables set what is stored and what the database refuses.

## Routes

All under `/api/v1/admin/sales`.

| Client method                      | Route                                                   |
| ---------------------------------- | ------------------------------------------------------- |
| `meta()`                           | `GET /meta`                                             |
| `plans()`                          | `GET /plans`                                            |
| `centerKpis(query)`                | `GET /center`                                           |
| `stageCounts(query)`               | `GET /analytics/stages`                                 |
| `revenueByPlan(query)`             | `GET /analytics/revenue-by-plan`                        |
| `leadSources(query)`               | `GET /analytics/lead-sources`                           |
| `activity(query)`                  | `GET /activity`                                         |
| `appointments(query)`              | `GET /follow-ups` (scheduled, from now on)              |
| `opportunities(query)`             | `GET /opportunities`                                    |
| `pipelineKpis(query)`              | `GET /summary`                                          |
| `opportunity(id)`                  | `GET /opportunities/:id`                                |
| `duplicates(body)`                 | `POST /opportunities/duplicate-check`                   |
| `createOpportunity(body)`          | `POST /opportunities`                                   |
| `updateOpportunity(id, body)`      | `PATCH /opportunities/:id`                              |
| `moveStage(id, body)`              | `POST /opportunities/:id/stage`                         |
| `assign(id, body)`                 | `POST /opportunities/:id/assign`                        |
| `bulk(body)`                       | `POST /opportunities/bulk`                              |
| `linkTransaction(id, body)`        | `POST /opportunities/:id/transaction`                   |
| `subscriptions(query)`             | `GET /subscriptions`                                    |
| `logOutreach(id, body)`            | `POST /opportunities/:id/activities`                    |
| `addNote(id, body)`                | `POST /opportunities/:id/notes`                         |
| `updateNote(noteId, body)`         | `PATCH /notes/:id`                                      |
| `deleteNote(noteId)`               | `DELETE /notes/:id`                                     |
| `addFollowUp(id, body)`            | `POST /opportunities/:id/follow-ups`                    |
| `updateFollowUp(followUpId, body)` | `PATCH /follow-ups/:id`                                 |
| `completeFollowUp(followUpId)`     | `POST /follow-ups/:id/complete`                         |
| `cancelFollowUp(followUpId)`       | `POST /follow-ups/:id/cancel`                           |
| `pipelines()`                      | `GET /pipelines`                                        |
| `createPipeline(body)`             | `POST /pipelines`                                       |
| `savePipeline(id, body)`           | `PUT /pipelines/:id`                                    |
| `saveTag(body)`                    | `POST /tags`, or `PATCH /tags/:id` with an id           |
| `deleteTag(id)`                    | `DELETE /tags/:id`                                      |
| `attentionSettings()`              | `GET /attention-settings`                               |
| `saveAttentionSettings(body)`      | `PUT /attention-settings`                               |
| `targets(query)`                   | `GET /targets`                                          |
| `createTarget(body)`               | `POST /targets`                                         |
| `updateTarget(id, body)`           | `PATCH /targets/:id`                                    |
| `archiveTarget(id)`                | `POST /targets/:id/archive`                             |
| `adminSalesReportPath(query)`      | `GET /report` (CSV download, opened as a link)          |

The fixed paths (`/opportunities/duplicate-check`, `/opportunities/bulk`, `/summary`) are POST or
sit outside `/opportunities/:id`, and `:id` is a UUID, so none can be read as a record id.

## Where the mock and the database differ

1. **Plans.** The mock hard-codes a `PlanId` enum (SOLO_CORE … ENTERPRISE), a price table and a
   marketing catalog. The database has `platform_plans` (UUID ids, code, name, base price, billing
   cycle, seats, seat price, locations, location price, display order, active) and
   `platform_plan_features`. The contract reads plans with `plans()` and `meta().plans`, and every
   request takes a `planId` (UUID). Screens key the plan colours by `code`. The catalog's copy
   (tagline, outcome, why upgrade, capacity, expansion and locations lines, best fit, three
   highlights, upgrade trigger, "From" price, trial allowed) is not stored and is left out. The
   capacity and expansion lines can be built from the numbers. `salesPlanPriceCents` and
   `salesPlanMaxExtraSeats` replace `monthlyCents` and `maxExtraUsers`.
2. **Extra users and locations** on a record have no columns. They are left out of requests and
   responses. `monthlyCents` becomes `plan.priceCents` (the base price). A form can still preview a
   price with add-ons with `salesPlanPriceCents`.
3. **Stage types.** The mock's TRANSACTION is the database's TRANSACTION_SYNCED.
4. **Stage requirements.** The mock's LOST_REASON, TRANSACTION and APPOINTMENT become the
   database's `required_fields` (value, assignee, plan, transaction, lost_note): VALUE, ASSIGNEE,
   PLAN, TRANSACTION, LOST_NOTE. A LOST stage always needs a reason, so there is no flag for it.
   APPOINTMENT cannot be stored (the CHECK allows only the five keys) and is dropped. The mock gave
   Closed a TRANSACTION requirement and Appointment Set an APPOINTMENT one; the migration ships
   only Under Contract with `transaction`.
5. **Stage colour.** There is no colour column. `tone` comes from `salesStageTone`: the shipped
   key's colour (the mock's colours), otherwise the type's. The builder's colour picker cannot be
   saved.
6. **Stage automation.** The mock's single `automation` becomes `onEnter`, a list stored in
   `on_enter_actions` (keys `notify_owner`, `create_follow_up`, `send_welcome_email`,
   `start_onboarding`). The API runs CREATE_FOLLOW_UP only. Saving any other action is 422
   NOT_SUPPORTED_YET. The shipped stages have no actions (the mock gave New Lead NOTIFY_OWNER and
   others). `on_exit_actions` is not exposed.
7. **Saving the builder.** The contract keeps the mock's single save (`PUT /pipelines/:id` with
   every stage and the removals) instead of B5's per-stage POST, PATCH and DELETE, so a layout
   change is one transaction and one audit entry. `expectedUpdatedAt` gives 409 CONFLICT when
   someone saved in between. The database rules come back as codes: a shipped stage keeps its type
   and is never removed (422 SHIPPED_STAGE); a stage with records keeps its type and is removed
   only after its records move (422 STAGE_HAS_RECORDS); the moves follow a move's rules. The mock
   refused switching off a stage that holds records. The database allows it (B5: deactivating is
   fine), so the contract allows it; the board already shows inactive stages that hold records.
   Limits are the database's: pipeline name 100 (mock 60), description 1,000 (mock 300), stage name
   60 (mock 40). Stage names are unique per pipeline: the database compares case-sensitively; the
   contract, like the mock, ignoring case.
8. **Default pipeline.** There is no `is_default` column. `isDefault` is the shipped pipeline
   (`system_key = 'firmivra_default'`) and cannot move to another one. Switching a pipeline off is
   not in the contract (no screen asks for it).
9. **Create Pipeline.** The DEFAULT template copies the shipped stages without their keys (only the
   migration sets keys), so the copies are not protected and take their type's colour. BASIC is the
   mock's (New, Won, Lost).
10. **Terminated return stage.** The database has `terminated_return_stage_id`; the mock returned a
    record to the first CONVERTED, else ACTIVE stage. The contract shows it on the pipeline and
    lets the builder set it (422 RETURN_STAGE_INVALID).
11. **Linked transaction.** The mock had a free-text reference (TX-2026-0142), a link time, an
    estimated close date, a closed time, and buttons for Under Contract, Close and Terminate. The
    database stores a kind, a UUID, a status and a sync time, and the status comes from the
    transaction side. The contract links the firm's `platform_firm_subscriptions` row
    (`linkTransaction(id, { subscriptionId })`, kind PLATFORM_SUBSCRIPTION) picked with
    `subscriptions()`. Null unlinks (409 UNLINK_UNDER_CONTRACT while under contract). A
    subscription linked to another record is 409 TRANSACTION_IN_USE, one of another firm is 422
    FIRM_MISMATCH, and a pipeline without active Under Contract and Closed stages is 422
    SYNC_STAGE_REQUIRED. The event buttons go: Billing reports UNDER_CONTRACT, CLOSED and
    TERMINATED in platform scope. There is no reference, link time or estimated close date; the
    card's "Est. Close" line falls back to "Since".
12. **Entering Under Contract by hand.** The mock let a move into the TRANSACTION stage link a
    transaction from a typed reference. The database allows that stage only with a transaction
    under contract, and no manual move while it is under contract or closed: 422
    TRANSACTION_LOCKED. `transactionReference` is gone from moves and from Add Lead.
13. **Lost.** The same eight reasons. The note is up to 2,000 characters (mock 500). OTHER needs a
    note only while `lostOtherNoteRequired` is on (in `meta().attention`): 422 LOST_NOTE_REQUIRED.
    A note without a reason is refused before sending; a reason for a stage that is not LOST is 422
    LOST_REASON_NOT_ALLOWED. Leaving a lost stage clears the reason and note on the record; the
    history keeps them.
14. **Field errors.** The mock's `SalesFieldError` carried a message per field. `ApiRequestError`
    carries one code and one message, so each required field has its own code (VALUE_REQUIRED,
    OWNER_REQUIRED, PLAN_REQUIRED, TRANSACTION_REQUIRED, LOST_REASON_REQUIRED, LOST_NOTE_REQUIRED)
    and a form puts it next to the field. A move may carry `valueCents`, `ownerId` and `planId` to
    fill a requirement in the same step.
15. **Follow-ups and appointments.** The mock kept tasks (title, due day, done) apart from
    appointments (six types, date and time, status). The database has one `sales_follow_ups`
    table with five kinds. Suggested mapping: a task is FOLLOW_UP; DEMO is DEMO;
    INITIAL_CONSULTATION is CONSULTATION; the follow-up, proposal review, trial check-in and
    check-in appointments are CALL or MEETING with the name in the title. The title is required
    (database). The due time is an ISO time (the screen joins its date and time). The record has one
    `followUps` list that the screen splits by kind, and `nextFollowUp` and `nextAppointment`
    objects instead of `nextFollowUpAt`. `scheduleAppointment` and `addFollowUp` become one
    `addFollowUp(id, { kind, … })`. Edit, reschedule and cancel are added (B5). The mock's "today
    or later" check is not a database rule; the screens keep it.
16. **Appointment Set.** The mock moved a record to the stage that required APPOINTMENT when one was
    booked. The contract: booking an appointment kind for a record in an earlier ACTIVE stage moves
    it to the shipped `appointment_set` stage (history source AUTOMATION). Other pipelines do not
    move.
17. **Communications.** The mock took `{ channel, reached, summary }` (summary up to 300) and kept
    counters on the record. The database has `sales_activities` (kinds CALL, EMAIL, SMS, MEETING,
    OTHER; direction; outcome; a time no later than five minutes from now; summary up to 2,000; a
    follow-up link), insert-only, with the actor set by the database. `logOutreach` takes those
    fields. "Reached" is an INBOUND activity or the outcome CONNECTED or REPLIED. `attempts` and
    `contactedAt` are counted from the rows.
18. **Activity feed.** The mock wrote its own log with prepared sentences and 20 kinds. The contract
    reads the feed from the stage and owner history, the activities, the follow-ups, the notes and
    the linked subscription's trial, with 16 kinds (`SalesFeedKind`). `salesFeedText` and
    `salesFeedDetail` build the lines. Not in the feed, because no table holds them as rows: field
    edits (the mock's UPDATED), TRANSACTION_LINKED, PROPOSAL_SENT and AUTOMATION; edits and links
    are audit log entries. `valueCents` is the record's value now (the mock's was the plan price at
    the time). `kinds: 'sales' | 'all'` becomes a `kinds` list; `SALES_CENTER_FEED_KINDS` is the
    Sales Center's.
19. **Attention.** B5's rules with the thresholds from `sales_attention_settings` (the mock used
    constants: 48 hours for no contact and for follow-up due; the database defaults to 24). Needs
    Attention counts all six badges, as B5 says; the mock left out FOLLOW_UP_DUE. Badges show only on
    open records, as in the mock. For NO_CONTACT outside the default pipeline, "New Lead" is read as
    the pipeline's first stage.
20. **Pipeline KPIs** use B5's definitions. Active Clients is CONVERTED and TRANSACTION_SYNCED (mock:
    CONVERTED only). Conversion is converted ÷ (created minus those lost as DUPLICATE or
    INVALID_LEAD), over the records created in the range (mock: records now in converted stages ÷
    all). The rate is in basis points with its two counts. Closed revenue and per-badge counts are
    added. `pipelineKpis` takes the list filters (B5: "for the same filters"). A trend is null when
    the earlier count is 0 (the mock answered +100%).
21. **Sales Center KPIs** use D1's metrics. Demos count by due date, not by creation. Trials (active
    and started) come from the linked subscriptions (the mock stored trial dates on the record).
    Lost deals come from the stage history, because a record's lost time is cleared when it leaves
    the lost stage. Projected MRR is the linked subscriptions' monthly price (the mock used the
    catalog price with add-ons for won deals and trials). Revenue won and trials started are added;
    the active trials trend is null. The answer carries the period's days and the previous period's.
22. **Revenue by Plan.** The mock summed monthly prices into fixed families (Solo, Team Pro,
    Business, Enterprise, Add-ons). The contract sums the estimated value of the deals won in the
    period (REVENUE_WON) per database plan, plus "No plan". The add-ons slice is dropped (not
    stored).
23. **Lead Sources.** The same, with the total and the period.
24. **Stage counts.** The same "open during the period" rule, with a closed or lost record's date
    taken from its stage entry (the record keeps no closed time), plus the lost reasons. It answers
    an object with the period instead of an array.
25. **Filtering.** The mock filtered every record in the browser with `matchesQuery`. The contract
    filters on the server (one query for the board and the list), with paging (up to 500) and sort.
    `plan` is `planId`, `stageId` is `stageIds`, `overdueOnly`, `unassignedOnly` and `attentionOnly`
    are `overdue`, `unassigned` and `attention`, and `scope` is `set` with B5's sets (the mock's
    PIPELINE and OPEN were the same set, now OPEN; CLIENTS is ACTIVE_CLIENTS). Search also covers the
    title.
26. **Days.** The mock used the browser's local days. The contract uses UTC days, as D1's targets,
    and `meta().today` is the UTC day.
27. **Contact.** B5 keeps one master person record per contact, shared by that person's
    opportunities, so editing the contact's name, email or phone changes it on each of them.
    `firmName` is the opportunity's `title` (and `company_name`). Email is lower-cased. Phone is
    stored as E.164 through `Phone` (mock: free text, 10 to 15 digits; the database takes digits and
    `+ ( ) . x -` up to 40). Length limits are the database's (names 200; mock 120 and 80). An email
    or a phone is required, as in the mock (the database does not require one).
28. **Duplicates.** The mock threw `SalesDuplicateError` with the matches. `ApiRequestError` carries
    no list, so creating answers 409 POSSIBLE_DUPLICATE and `duplicates()` lists the matches (email
    and phone normalized, as B5, and the firm name). Add Lead never attaches to an existing contact.
29. **Value.** The same $0 to $10,000,000; null stays null. The mock's `sendProposal` set a missing
    value to 12 × the monthly price, an invented number.
30. **sendProposal** is dropped. The plan and the value go through `updateOpportunity`. The proposal
    PDF and the "Proposal sent" entry have no table (platform estimates need a firm), so the record's
    Documents panel has no data.
31. **startTrial** is removed (Sales API, note 44). A trial is a firm's platform subscription, which
    needs a provisioned firm, and no Subscriptions API exists yet.
32. **nextStep** has no column and is left out.
33. **viewPreference / setViewPreference** have no table and are left out. The screen keeps the Card
    or List choice for the viewer.
34. **exportReport** returned CSV text. The contract makes it a download, `adminSalesReportPath`
    (`GET /report`), opened as a link like the other modules' CSV exports.
35. **Assign and bulk.** `assign(id, { ownerId })` (B5's single route) and `bulk({ ids,
confirmedCount, action })` (B5's bulk route with the confirmed count) replace `assign({ ids })`,
    `bulkStage` and `bulkTag`. Bulk is all or nothing. Tags can also be removed in bulk. A bulk move
    to a lost stage takes one reason for every record.
36. **Permissions.** The mock's four flags stay; `manageTargets`, `manageSettings` and `recordScope`
    are added (`platform_members.scope_type`: OWN_RECORDS is OWN, COMPANY is COMPANY, the others
    TEAM; a Super Admin is COMPANY).
37. **Notes** are up to 10,000 characters (mock 2,000). Only the author edits or deletes one (B5),
    shown by `mine`; `updateNote` and `deleteNote` are added.
38. **Reps.** The mock's fixed list becomes the `platform_admins` who can own records (the assignee
    foreign key), with the org chart's role title and an `active` flag.
39. **Targets (D1)** are in: `targets`, `createTarget`, `updateTarget`, `archiveTarget`, and teams
    (platform departments) in `meta()`, although the Sales Center page has no targets panel yet.
    The subject and the period rules are checked before sending (`isSalesTargetPeriod`,
    `salesTargetPeriodEnd`).
40. **Lead imports (D1)** are left out: no screen uses them.
41. **Text.** Every text field also passes the platform tables' `platform_text_ok`: it refuses the
    soft hyphen, U+034F, U+17B4, U+17B5 and the line and paragraph separators (which `text` allows)
    and needs one visible character.
42. **Tags and attention settings** routes are added (B5) though no screen manages them yet. A tag
    colour is a design-token name.
43. **Backward moves.** The mock allowed any move and wrote "Moved back". The database does not
    order the ACTIVE stages, and B5 leaves the rule to the API (spec 17, section 12). The contract
    allows every move the database accepts (see the questions below).

## Sales API (step 7)

`apps/api/src/admin-sales/` (40 routes): `AdminSalesController`, `SalesRecordsService` (records,
moves, owners, bulk, the linked subscription, outreach, notes, follow-ups, the list and KPI row),
`SalesAnalyticsService` (Sales Center numbers, stage counts, revenue by plan, lead sources, Recent
Activity, upcoming follow-ups, the report), `SalesSetupService` (meta, plans, the pipeline builder,
tags, attention settings), `SalesTargetsService` (D1 targets), `sales-common.ts`, `sales-feed.ts`
and the pure rules in `sales-math.ts`. Tests: `test/unit/admin-sales.test.ts` (18),
`test/e2e/admin-sales.e2e.test.ts` (32, every route), and 24 write cases in
`test/isolation/admin-sales-writes.ts` for the admin-scope sweep.

44. **Contract changes made with the API.** `startTrial` is removed: the admin-scope sweep calls
    every admin write with a valid body and needs it to succeed, and a trial cannot be stored for a
    prospect (note 31). Editing and deleting a note moved to `PATCH /notes/:id` and
    `DELETE /notes/:id` (`updateNote(noteId, body)`, `deleteNote(noteId)`): the sweep fills only
    `:id`. The contract test follows both.
45. **Admin scope only** (`AdminPrisma`): every read and write runs as the signed-in Super Admin;
    nothing opens a firm's scope or platform scope. Audit rows are the platform's
    (`businessId: null`) with ids and codes only, never names, emails, notes or summaries:
    `sales_opportunity.created`, `.updated`, `.stage_changed`, `.assigned`, `.transaction_linked`,
    `.transaction_unlinked`, `sales_activity.logged`, `sales_note.added`, `.updated`, `.deleted`,
    `sales_follow_up.scheduled`, `.updated`, `.completed`, `.cancelled`, `sales_pipeline.created`,
    `.saved`, `sales_tag.created`, `.updated`, `.deleted`, `sales_attention_settings.updated`,
    `sales_target.created`, `.updated`, `.archived`, `sales_report.exported`. `AuditService.logIn`
    has no category, so B5's "category DATA" is not set (see Needs from others).
46. **Team and rights.** Reps are every Super Admin and the members of the Revenue / Sales
    department (`REVENUE_SALES`); ACTIVE members take new records and follow-ups (422
    INACTIVE_CHOICE otherwise). Only Super Admins pass `@Roles('SUPER_ADMIN')`, so every caller has
    the six permissions and `recordScope` COMPANY; no `sales.*` keys are read yet (question 2).
47. **Checks before the database.** Each change checks what B5's and D1's triggers and CHECKs would
    refuse and answers the contract code first: an inactive stage, the transaction lock, a lost
    stage's reason and note (the OTHER note per `lostOtherNoteRequired`), a lost reason outside a
    lost stage, each required field (VALUE, ASSIGNEE, PLAN, TRANSACTION, LOST_NOTE), inactive plans,
    reps and tags, and a follow-up already completed or cancelled. A refusal the checks miss is
    mapped from the trigger's message (`asSalesError`) instead of surfacing as a 500.
48. **Add Lead runs once per `requestId`.** There is no idempotency column, so the API takes a
    transaction advisory lock on the request id and looks for its own `sales_opportunity.created`
    audit row with that id, answering the record it made. Without `allowDuplicate`, a match is 409
    POSSIBLE_DUPLICATE: the same normalized email, the same phone digits (a US number with or
    without its 1), or the same firm name (ignoring case) on a record's title or company or a
    contact's company. A new record starts in the pipeline's first active stage that is not
    TRANSACTION_SYNCED.
49. **Lists and the KPI row** read the pipeline's 5,000 newest records with the cheap filters in
    Prisma (stages, owner or unassigned, plan, source, tag, the range's last day) and the rest in
    memory (search, the range's first day for closed and lost records, overdue, attention, the
    set). Each record's counters (last activity, attempts, first two-way contact, next follow-up and
    appointment, badges, trial) are worked out on every read. `pipelineKpis` takes the same
    filters; its conversion counts the records created in the range (all without one). B5's
    numerator keeps a converted record later lost as DUPLICATE or INVALID_LEAD while the
    denominator drops it, so in that case the rate can pass 100% (question 5).
50. **Moves.** A move to the stage the record is in changes nothing. A lost reason and note are
    stored only with a lost stage; the database stamps the conversion and lost times and writes the
    history (source MANUAL). Backward moves are allowed (question 1). Booking a CALL, DEMO,
    CONSULTATION or MEETING for a record in an earlier ACTIVE stage moves it to the shipped
    `appointment_set` stage after `set_config('app.sales_change_source', 'AUTOMATION', true)`; when
    that stage's required fields are missing, nothing moves. A stage's CREATE_FOLLOW_UP action adds
    a FOLLOW_UP "Follow up: <stage>" for the owner, due in two days.
51. **The linked subscription.** Linking stores it OPEN, sets the record's firm, then applies the
    subscription's current state in the same transaction (ACTIVE, PAST_DUE and NON_RENEWING are
    UNDER_CONTRACT; EXPIRED is CLOSED; CANCELLED is TERMINATED; TRIAL and SUSPENDED stay OPEN), so
    the database moves the record into Under Contract or Closed (history source TRANSACTION, actor
    the admin). That stage's required fields must be there. A subscription linked to another record
    is 409 TRANSACTION_IN_USE (no unique index holds this), one of another firm 422 FIRM_MISMATCH,
    and a pipeline without active Under Contract and Closed stages 422 SYNC_STAGE_REQUIRED.
    Unlinking with nothing linked changes nothing. Later status changes are Billing's (Needs from
    others).
52. **Save Pipeline** compares `expectedUpdatedAt` with the latest change to the pipeline or its
    stages (409 CONFLICT), then checks: SHIPPED_STAGE, STAGE_HAS_RECORDS (a type change, or a removed
    stage with records and no target), RETURN_STAGE_INVALID (the return stage must stay an active
    ACTIVE or CONVERTED stage), NOT_SUPPORTED_YET (stage actions other than CREATE_FOLLOW_UP), 400
    for a LOST_NOTE requirement outside a lost stage (it could never be met), SYNC_STAGE_REQUIRED
    when records have a transaction, and each record of a removed stage against its target (a
    move's rules; a record under contract or closed only to a stage of its transaction's type; a
    lost record keeps its reason). Then it writes: temporary names (a swap of two names never meets
    the unique index), the layout, the moves (the database writes their history), the pipeline,
    and last the deletions. A deletion the database still refuses (a lead import pointing at the
    stage) is 422 STAGE_HAS_RECORDS.
53. **Create Pipeline.** DEFAULT copies the shipped pipeline's stored stages (names, types, required
    fields) without their keys; the copy's CONVERTED stage is its return stage. Prisma makes no id
    for `sales_pipelines` (the id is a key of the pipeline's own return-stage relation, so the
    insert failed with a NOT NULL error), so the API passes a v7 id (for R0).
54. **The Sales Center's numbers** are counted per D1 with database counts: leads by creation, demos
    by due date (not cancelled), wins by conversion time, lost deals from the stage history
    (distinct records), revenue won from `value_cents`; trials and projected MRR from the linked
    subscriptions (the negotiated price or the plan's base price, plus purchased seats and
    locations at the plan's prices; an annual plan's price divided by 12; each subscription once).
55. **Stage counts** take a closed or lost record's date from its stage entry; lost reasons count the
    pipeline's entries into lost stages in the period. Revenue by plan lists active plans (and
    inactive ones with deals) in display order, then "No plan".
56. **Recent Activity** is read per request from the latest rows of each source, merged: stage rows
    (WON is the row stamped with the record's `converted_at`), owner rows, follow-ups (who completed
    or cancelled one comes from this API's audit row: the table keeps no actor), activities, notes
    and the linked subscriptions' trial starts ("Billing"). The record page shows up to 500 entries.
57. **The report** is CSV (`text/csv`, attachment, no-store) of the records created in the period,
    every pipeline unless one is given, at most 50,000 rows, with an audit row of the count.
58. **Targets.** Attainment is counted per D1 on every read (TEAM: the department's members, any
    status; REP: a platform admin). A live duplicate is 409 TARGET_EXISTS before the unique index
    would refuse it; archiving lets the database stamp the time.

## Needs from others

- **R0 (B5 schema):**
  - `sales_pipeline_stages.color_key` (a design-token name, like `sales_tags.color_key`), so the
    builder's colour picker can be saved.
  - An `appointment` key in the stages' `required_fields` CHECK, if Appointment Set must need a
    booked appointment.
  - `sales_opportunities.extra_seats`, `extra_locations` (the add-ons the forms ask for) and
    `next_step`.
  - A place for proposals sent to prospects (platform estimates need a firm).
  - An expected close date for the linked transaction (the card's "Est. Close").
  - A per-member preference for the Card or List view, if it must follow the member across
    devices.
  - A sales time zone setting, if the team wants local days instead of UTC.
- **R0 (B5, found while building the API):**
  - `sales_pipelines.id` has no database default and Prisma makes none for it (the id is a key of
    the pipeline's own `terminatedReturnTo` relation), so an insert without an id fails NOT NULL.
    The API passes a v7 id; a `DEFAULT` on the column, or a relation that does not reuse the id,
    would remove the trap.
  - No unique index keeps one open link per transaction (`transaction_kind`, `transaction_id`): two
    records on one subscription would both move and count. The API checks (409
    TRANSACTION_IN_USE).
  - `sales_follow_ups` keeps no `completed_by_user_id` / `cancelled_by_user_id`; the feed reads the
    actor from this API's audit rows.
  - No idempotency key on `sales_opportunities`; Add Lead's `requestId` lives in the audit row.
  - The stages' CHECK allows a `lost_note` requirement on a stage that is not LOST, which no record
    can ever meet (a lost note needs a lost reason, and a reason needs a lost stage). The API
    refuses it at save.
  - The pipelines trigger checks the return stage's type only when the pipeline row changes: a
    stage update can still turn the return stage into a LOST stage or switch it off. The API checks.
  - B5 asks for audit rows in category DATA; `audit_logs` and `AuditService.logIn` have no category.
- **R0 (platform plans):** the plan card copy (tagline, outcome, why upgrade, best fit, highlights,
  upgrade trigger, "From" price) and a self-serve trial flag on `platform_plans`, or a decision that
  this copy lives in the web app.
- **Billing and Subscriptions (B3; later R60 steps):** report subscription status changes to the
  linked opportunities in platform scope (B5's mapping: signed contract or active paid plan
  UNDER_CONTRACT, end of term CLOSED, early cancellation TERMINATED) after the link (the Sales API
  applies the state at link time only), and start a firm's trial (a
  TRIAL subscription), so the Sales Center's Start 14-Day Trial can come back. A prospect without a
  firm cannot have one.
- **R56:** a bell-notification producer, so NOTIFY_OWNER can run. **R6:** a welcome email template
  (SEND_WELCOME_EMAIL). **Firm onboarding owner:** START_ONBOARDING.
- **Admin Sales screen owners:** switch to `api.adminSales`. Changes: plan ids from `plans()` and
  `meta()`; send the filters instead of `matchesQuery`; one `followUps` list; the transaction panel
  picks a subscription and loses the event buttons; the colour picker, the Documents panel and the
  next step have no data; the duplicate warning calls `duplicates()`; feed lines from
  `salesFeedText` and `salesFeedDetail`.

## Questions for Rasel

1. Spec 17, section 12: which backward moves between stages are allowed? The contract allows every
   move the database accepts.
2. Which platform members count as sales reps, and which `sales.*` keys stand for the six
   permissions (`managePipelines`, `assign`, `bulkEdit`, `export`, `manageTargets`,
   `manageSettings`)? Today only Super Admins sign in, so every caller has them all.
3. B5 counts FOLLOW_UP_DUE in Needs Attention; the mock did not. The contract follows B5: confirm.
4. NO_CONTACT applies in "New Lead". Outside the default pipeline the contract reads it as the
   pipeline's first stage: confirm.
5. B5's conversion rate keeps a converted record later lost as DUPLICATE or INVALID_LEAD in the
   numerator but not the denominator (note 49): should the numerator drop it too?
