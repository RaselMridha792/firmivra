# Octavia's Automations consolidated review (27-28 Oct): change list

Source: "Firmivra Automations Consolidated Developer Review" (walkthrough closed, 19 source sections, 201 requirement units). It is a user-reported UI review against a dummy, non-executing backend, not live acceptance. Green rows are kept as they are; red rows are the work; yellow rows need a decision or a fixture from us.

IDs: AU-F = build or fix (RED corrections and approved additions), AU-Y = yellow, needs a decision or fixture from us, AU-D = deferred by her. Report codes (T1-T3, E1-E4, M1-M7, section numbers 1-19) are kept in each Source cell.

## Summary

1. Counts: 33 build/fix items (AU-F01 to F33, all RED), 20 yellow items (AU-Y01 to Y20), 11 deferred items (AU-D01 to D11).
2. Priority 1: 13 trigger event selectors (12 empty + Clients expansion), AU-F08 to F20. Categories with no events cannot be used at all.
3. Priority 2: small, clear reds that are likely quick: Logs activity tabs (F02), Manage Rules Applies To (F01), Rule Owner (F28), Trigger Type renamed Trigger Event (F03).
4. Priority 3: Trigger step quality: plain-language preview (F04), structured timing and timezone summary (F05-F07), Conditions matching preview and typed controls (F21-F23).
5. Priority 4: Actions: reorder (F24), explicit Send Client Email (F25), 15 action groups and extensions (F26-F27).
6. Priority 5: Manual Event Confirmation (F29-F33): new admin master in global Automation Settings, per-trigger source, individual confirmations, reconcile without rerun.
7. Database change likely: Rule Owner on the rule (F28); a manual-confirmation setting and a manual-confirmation record (F29, F31, F32). Everything else is "no, to check". Needs Rasel's tap before any schema work.
8. Roles/permissions touched: F29 (only an authorized automation administrator changes the master), F28 (owner must be authorized), F30-F31 (server-side role and module rights for confirming), F22 (Staff role field, no escalation), F27 (assign/notify only authorized people), Y20 (full permission and audit matrix).
9. Exact-rule-state question (AU-Y01): she saw Save & Activate work and permits ACTIVE in the dummy backend, but the latest saved-rule state was never independently checked; the template editor opens with Enable OFF and a duplicate shows DRAFT. Our default: Save & Activate = ACTIVE, Save Draft = DRAFT, template editor and duplicate = DRAFT/OFF; we verify the saved state ourselves (not by asking her) and show it in Manage Rules.
10. No run, send, retry, import, filing or payment is to be triggered to close any row; run-dependent proof waits for seeded synthetic fixtures (Y18-Y19) and separately bounded authority.

Where the report asks her to decide something, this list picks a default and says so. Defaults are reversible and shown at review, never asked of her.

## Confirmed (green, kept as they are)

Overview cards and entry points; Create Automation Rule opens the builder; five builder stages and Back to Automations; all 17 category choices; observed timing controls (Appointments Coming Up, Invoice Overdue, Tasks Overdue, New Client Immediately); Recent Activity present; Quick Actions (five, Import opens its dialog); Conditions All/Any exclusive, add/delete row, operators Is/Is Not/Includes/Excludes; Actions labels Create Task, Send Client Message, Add Client Note, add and delete action; Settings identity, priority, operational checkboxes, expiration picker, Log All Activity default ON; global Settings modal (America/Chicago shown, dedupe N days, quiet hours, chain, 500 threshold, minutes saved, Keep Logs 365 with range 30-2555, failure recipients, unchanged save and reopen); Review summary and required Task Name validation; Save Draft; Save as Template and list refresh; Use Template prefill; template editor Enable OFF; Import dialog labels; Logs navigation, KPI labels, filter inventory, Reset, empty state, zero-row export feedback; Manage Rules row and menu labels, Name Search, Draft filter, 17 categories, No Results recovery, Last Run placeholder, duplicate shows DRAFT. Green is UI presence only, not wiring, execution or launch signoff.

## Code pointers (existing, one line per screen; not an audit)

- Overview and Manage Rules: `apps/web/src/app/firm/(workspace)/automations/page.tsx` -> `_components/automations-screen.tsx` (public path `/automations`).
- Builder: `automations/new/page.tsx`, `automations/[id]/edit/page.tsx` -> `_components/rule-builder.tsx` (Trigger Type label at ~line 386).
- Templates: `automations/templates/page.tsx` -> `_components/templates-screen.tsx`. Logs: `automations/logs/page.tsx` -> `_components/logs-screen.tsx`.
- Dialogs (global Settings, Test, Import): `_components/automation-dialogs.tsx`.
- API: `apps/api/src/automations/` (`catalog.ts` events/actions/operators, `rules.service.ts`, `matching.ts`, `logic.ts`, `overview.service.ts`, `automations-read.service.ts`, controller `GET/PUT /automations/settings`).

---

## 1. Overview and Quick Actions (`/automations`)

No RED item. Yellow and deferred only: AU-Y11 (KPI/health/Time Saved accuracy), AU-D01 (Recent Activity contents and empty guidance), AU-D02 (other Quick Action routes). Section 1.

## 2. Manage Rules (`/automations`, rules table)

### AU-F01 Applies To summary
- Source: Reviewed UI and priority corrections (Missing Applies To summary); Manage Rules (Applies To missing); section 3.
- Observed: Manage Rules rows have no per-row conditions/scope summary.
- Build: show a readable Applies To per row from the saved canonical rule configuration, distinguishing "all applicable records" from specific criteria, updating when the rule is saved, and hiding restricted details. Check first: the code already has an `appliesTo` column (`automations-screen.tsx` ~line 180, `appliesTo()` in `logic.ts`); find why it is not visible on dev (hidden, blank, or not deployed) before building.
- Schema? no, to check.

## 3. Builder - Trigger step (`/automations/new`, `/automations/[id]/edit`)

### AU-F03 Rename Trigger Type to Trigger Event
- Source: Trigger clarity and timing; section 5. User-requested clarity change, not an original-guide defect.
- Observed: field is labeled "Trigger Type".
- Build: rename the label to "Trigger Event" everywhere it appears (builder, review, help text).
- Schema? no.

### AU-F04 Plain-language trigger preview
- Source: Trigger preview; section 5.
- Observed: the Appointments Trigger step has no readable preview. (Later Review preview not established as absent.)
- Build: a sentence showing the event and the effective timing example, updating as inputs change, with no actions executed.
- Schema? no.

### AU-F05 Structured timing (T1)
- Source: T1 Required trigger timing; section 5.
- Observed: only some events have timing controls (Appointments Coming Up, Invoice Overdue, Tasks Overdue, New Client Immediately only).
- Build: for every category and event where meaningful: Immediately / Time / Custom, numeric Days, Hours, Minutes, before/at/after a meaningful canonical time, clock-time scheduling; controls respond to the selected category and event. Custom is structured, not code.
- Schema? no, to check (timing may already be in the rule definition JSON).

### AU-F06 Valid time anchors and invalid input (T2)
- Source: T2 Valid time anchors; section 5.
- Observed: n/a (requirement). 
- Build: never schedule before a record/event that does not yet exist (New Client/Lead: immediate, after the occurrence, or a meaningful later time). Before/at/after only when a known canonical event time exists. Define and show recurrence, clock-time basis and invalid-input messages.
- Schema? no, to check.

### AU-F07 Visible timezone summary
- Source: Trigger clarity and timing (user-required timezone explanation); T1; section 5.
- Observed: no visible timezone explanation on the Trigger step.
- Build: show which timezone the timing uses (firm timezone, with the precedence note per AU-Y09) next to every timing control.
- Schema? no.

### Event selectors (AU-F08 to F20)

Rule for all: bind each event to a real supported source-module event with a stable schema (E1-E4, AU-Y10); do not invent events or dates; a configurable period has no hardcoded value; Custom is typed fields/events only, no code. All selectors also get AU-F04 to F07. Events that depend on the external-outcome policy use AU-F29 to F33.

| ID | Module (source section 2) | Observed | Build (events) | Schema? |
| --- | --- | --- | --- | --- |
| AU-F08 | Clients (B013/R01) | Labels New Client / New Client Added exist (green); 10 more groups are RED Required. | Client Status Changed (old/new); Assigned Staff or Team Changed; Onboarding Completed (define criteria, no inference from intake progress); Follow Up Due (timezone, stable key); No Contact for Configured Period (configurable, define qualifying contact); Anniversary Reached (only a supported date field; if none exists, do not show, AU-Y02 default); Tag Added or Removed; Selected Profile Field Changed (allowlisted, minimal data); Client Archived or Reactivated; Custom Client Trigger (typed). | no, to check |
| AU-F09 | Leads (R02) | Selector empty. 11 groups required. | Lead Created or Imported (one occurrence, no double run); Stage or Status Changed; Assigned Staff or Team Changed; Qualified or Disqualified (no automated qualification); Follow Up Due; No Response or No Contact for Configured Period (response vs contact distinct); Converted to Client (no duplicate client); Tag Added or Removed; Selected Lead Field Changed; Archived or Reactivated; Custom Lead Trigger. | no, to check |
| AU-F10 | Intake Forms (R04) | Selector empty. 9 groups required. | Assigned or Sent (distinct if distinct actions); Started (first start vs resume); Submitted (Completed normalizes to Submitted); Started but Not Submitted after Configured Time; Due Soon or Overdue; Submitted with Missing Required Information (no form content in logs); Returned for Corrections; Resubmitted (new version, not retry); Approved or Accepted (one decision occurrence). | no, to check |
| AU-F11 | Documents (R05) | Selector empty. 9 groups required. | Requested; Uploaded or Received (failed attempts do not count); Requested Document Due Soon or Overdue (skip if fulfilled); Reviewed or Approved (version-specific); Rejected or Returned for Correction; Corrected Resubmitted (new version); Expiration Approaching or Reached (only where an expiry date exists); Required Document Set Completed; Archived or Restored. | no, to check |
| AU-F12 | Tax Returns (R06) | Selector empty. 12 groups required. | Created; Workflow Status or Assigned Staff Changed; Required Information Due Soon, Overdue or Complete; Ready for Review; Review Approved or Returned; Signature Requested, Completed or Overdue; Filing Deadline Approaching or Passed (supported deadline only); Extension Recorded (does not submit an extension); Submission Confirmed; Return Accepted or Rejected (Integration Verified or Manually Confirmed, per F29-F33); Amendment Created; Completed, Archived or Reopened. | no, to check |
| AU-F13 | Tax Planning (R09) | Selector empty. 11 groups required. | Engagement Created; Assigned Staff or Planning Status Changed; Information Requested, Received or Overdue; Review or Strategy Meeting Due; Analysis or Plan Ready for Review; Plan Approved or Returned; Recommendation Accepted or Declined; Implementation Task Due, Complete or Overdue (use Tasks events); Tax Deadline or Estimated Payment Date Approaching (no invented deadlines, no payment processed); Plan Shared with Client; Engagement Completed or Reopened. | no, to check |
| AU-F14 | Business Advisory (R10) | Selector empty. 11 groups required. | Engagement Created; Assigned Staff or Advisory Status Changed; Discovery or Strategy Session Scheduled or Completed; Required Information Received or Overdue; Plan or Deliverable Ready for Review; Approved or Returned for Revision; Recommendation Accepted or Declined; Milestone or Action Item Due, Complete or Overdue; Progress Review Due; Deliverable Shared; Engagement Completed or Reopened. | no, to check |
| AU-F15 | Custom Rules (R17) | Selector empty. 4 groups required. | Supported Custom Field Changed (allowlisted field, typed old/new); Configured Date Arrives (supported date field, timezone); Authorized Manual Event Confirmation (uses F29-F33); Vetted Integration Event (approved schema only). No standalone threshold trigger; a comparison only as a typed field condition. | no, to check |
| AU-F16 | Bookkeeping (R07) | Selector empty (RED). Full list is YELLOW (AU-Y02). | Populate the selector from the listed events that bind to real Bookkeeping events (list: Enrolled; Period Opened; Period Status Changed; Assigned Staff Changed; Records Requested, Received or Overdue; Reconciliation Started or Completed; Unresolved Difference Flagged; Period Ready for Review; Review Approved or Returned; Period Closed or Reopened; Report Ready or Shared; Reporting Deadline Approaching or Missed; Accounting Connection Failed or Data Stale). | no, to check |
| AU-F17 | Payroll (R08) | Selector empty (RED). List YELLOW (AU-Y02). | Populate from listed events that bind to real Payroll events (Enrolled or Period Created; Run Status or Assigned Staff Changed; Date or Cutoff Approaching; Hours, Changes or Documents Due or Received; Ready for Review; Review Approved or Returned; Run Submitted, Processing, Completed or Failed; Filing or Payment Due, Confirmed or Failed; Report Ready or Shared; Provider Connection Failed or Sync Stale). Recording never starts a payroll run. | no, to check |
| AU-F18 | Communications (R12) | Selector empty (RED). List YELLOW (AU-Y02). | Populate from listed events that bind to real events (Draft Created or Submitted for Approval; Approved or Returned; Scheduled, Sent, Delivered or Failed; Client Reply Received; Follow Up Due; Campaign Completed; Recipient Unsubscribed or Reported Spam; Channel Disconnected; Announcement Published or Expired). Open/click events are NOT to be added. Loop guard on draft creation. | no, to check |
| AU-F19 | Staff Management (R15) | Selector empty (RED). List YELLOW (AU-Y02). | Populate from listed events that bind to real events (Invited or Invitation Accepted; Role or Permission Changed; Team or Location Assignment Changed; Onboarding Completed or Overdue; Training or Credential Renewal Due; Availability or Leave Status Changed; Deactivated or Reactivated; Work Reassignment Required after Departure). Do NOT add Account Activated or Manager Changed. A trigger never grants rights. | no, to check |
| AU-F20 | Integrations (R16) | Selector empty (RED, confirmed twice). List YELLOW (AU-Y02). | Populate from listed events that bind to real events (Connection Established or Disconnected; Authentication Expired or Revoked; Reauthentication Required; Sync Started, Completed or Failed; Data Stale; Import or Export Completed or Failed; Webhook Delivery Failed or Recovered; Rate Limit or Provider Outage Detected; Data Conflict Requires Review; Connection Recovered). Health reflects observed state only; no secrets in logs. | no, to check |

Appointments (R03), Invoices & Payments (R11), Tasks (R13) and Compliance & Deadlines (R14) already have one event label each (green, presence only); their expansions are YELLOW and covered by AU-Y02. Do not mark the existing Invoice Overdue, Tasks Overdue or Deadline Approaching as missing.

## 4. Builder - Conditions step

### AU-F21 Matching count and Preview Matches
- Source: Condition matching preview; Required matching preview; section 6.
- Observed: no matching-record count or Preview Matches in Conditions.
- Build: an authorized count and sample of matching records for the current conditions, no production effects, permission-scoped, minimal data shown.
- Schema? no, to check (`matching.ts` exists).

### AU-F22 Contextual field groups (19)
- Source: Context and typed controls; Required condition field groups; section 6. User-approved.
- Observed: only Client Type, Deadline Type, Priority seen.
- Build: show only fields relevant to the selected module and authorized for the user. Groups: record status; service; tags; assigned staff; team; location; created/due/last-contact dates; invoice balance; payment status; document and intake completion; client and lead status; account type; state or jurisdiction; tax year (one schema-defined type); return status; task status; appointment type; staff role (authorized visible roles only, no escalation); approved custom fields (allowlist). Do not invent missing timestamps.
- Schema? no, to check.

### AU-F23 Datatype operator and value matrix (6 rows)
- Source: Required datatype operator and value matrix; Matrix status; section 6.
- Observed: operators shown are Is, Is Not, Includes, Excludes.
- Build: Status/type/single reference: Is, Is Not (single select). Multi-value/tags: Includes, Excludes, Any Of, None Of. Number: Equals, Greater Than, Less Than only. Date/datetime: Before, After, On, Within a Period (timezone shown). Text: Contains, Does Not Contain (no code). Optional: Is Empty, Is Not Empty (no value input). Clear incompatible operator/value when field/type/operator changes; validate server-side. Check first: `OPERATORS` in `catalog.ts` uses IS/EXISTS-style names; map, do not add extra operators.
- Schema? no, to check.

## 5. Builder - Actions step

### AU-F24 Reorder actions
- Source: Movable action order; Reorder actions; section 7.
- Observed: actions cannot be reordered; she requires it.
- Build: movable actions (Move Up/Down, keyboard or drag; the method is ours to pick) keeping stable IDs, each action's configuration and visible order, and saving the new order.
- Schema? no, to check (order may already be an array index).

### AU-F25 Explicit Send Client Email
- Source: Required source action coverage (Send Email / SMS); Explicit action extensions (Send Client Email); section 7.
- Observed: only the generic Send Client Message exists.
- Build: a separate named Send Client Email option using approved email templates (for example Welcome Email) through Communications, with recipient validation, consent and settings. Keep SMS support (generic channel coverage is AU-Y06).
- Schema? no, to check.

### AU-F26 Required source action coverage (15 groups)
- Source: Required source action coverage; Coverage classification; section 7. RED means "implement or ensure", not "everything is missing".
- Build through canonical module APIs only: Create Task (template, assignee, due rule, priority, visibility); Send Email / SMS; Portal Message; Internal Notification; Create/Update Deadline; Create Appointment (duplicate safeguards); Update Status (typed allowlist, no fabricated filing/payment, no approval bypass); Assign Staff/Team; Document Request; Send Resource (no arbitrary file disclosure); Create Invoice / Reminder (duplicate protection, no money processed); Add Tag/Service/Note (keep Add Client Note); Webhook / Integration (vetted only, secret-redacted logs, idempotent); Delay / Wait; Conditional Branch. Do not assume current Send Client Message lacks or already covers Portal Message.
- Schema? no, to check.

### AU-F27 Explicit action extensions
- Source: Explicit action extensions and clarity requirements; section 7.
- Build: Notify Assigned Staff or Team (authorized recipients, no message sent in review); Assign or Reassign Work (authorized assignees/teams); Add or Remove Tags (removal included, tag IDs); Update Allowed Field or Status (typed allowlist); Request Documents or Intake; Create Follow Up or Appointment Request (a request is never shown as a confirmed booking); Delay (stable key, rule version); Create Approval Request (pending item only, never self-approve).
- Schema? no, to check.

## 6. Builder - Settings step and global Automation Settings

### AU-F28 Whole-rule Rule Owner
- Source: Missing whole-rule Rule Owner; section 9.
- Observed: no Rule Owner in per-rule Settings; Action Assign To and global failure recipients are not substitutes.
- Build: a visible Rule Owner (responsible administrator) per rule: authorized people only, saved, shown in the rule, change audited. Default we choose: the rule creator, changeable by Owner/Admin. The dropdown design is ours. Note Logs detail already reads `owner`; check what exists before adding a column.
- Schema? yes, likely: an owner user reference on the automation rule (check first whether it already exists).

### AU-F29 Manual Event Confirmation master (M1)
- Source: M1 Missing admin master control; Missing manual confirmation master; section 9. Missing user-required addition.
- Observed: not present in GLOBAL Automation Settings.
- Build: a master toggle in the global Settings dialog; only an authorized automation administrator can change it; audit actor, time and change. Default state: OFF (our default; AU-Y07).
- Schema? yes: a manual-confirmation flag in the per-business automation settings.

### AU-F30 Per-trigger source choice (M2)
- Source: M2 Per-trigger source.
- Build: for eligible supported external events, a source choice: Integration Verified, Manual Confirmation, Either. Master toggle plus server-side role/module permissions govern manual use. Unsupported automatic verification shows as unavailable, but a permitted truthful manual report is not blocked just because the integration is unavailable.
- Schema? no, to check (rule definition may carry it).

### AU-F31 Individual honest confirmation (M3)
- Source: M3 Individual honest confirmation; Missing manual confirmation master (no bulk).
- Build: confirm each record and each event occurrence separately; no bulk, blanket or select-all. Store occurrence identity, acknowledgment/reference for the known outcome, evidence/source designation, authorized actor, timestamp and audit history. Label Manually Confirmed distinct from Integration Verified; never relabel manual as provider evidence. The report names no screen for this action; default: on the source record's occurrence, not inside the rule builder (AU-Y07).
- Schema? yes, likely: a manual-confirmation record per business event occurrence (actor, time, source, reference). Check first.

### AU-F32 Reconcile without rerun (M4)
- Source: M4 Reconcile without rerun.
- Build: if provider evidence later arrives for the same occurrence, attach it to that occurrence and do not repeat completed actions; normalize manual/provider IDs; keep the original manual actor/time/source plus the later evidence.
- Schema? no, to check (uses F31 record).

### AU-F33 Scope and limits of confirmation (M5)
- Source: M5 Scope and limits.
- Build: applies across eligible categories, not only Tax Returns. A confirmation only reports a known external fact: it never files, submits, charges, transfers, refunds or processes payroll; cannot fabricate health, delivery or success; cannot override consent, bypass approvals or grant permissions. Later effects still need normal configuration, permission and activation. Add tests for each limit.
- Schema? no.

## 7. Automation Logs (`/automations/logs`)

### AU-F02 Separate activity tabs
- Source: Missing Logs activity tabs; Separate activity tabs; section 13.
- Observed: only a Status dropdown and non-clickable KPI cards; no tabs.
- Build: tabs All Activity, Successful, Failed, Skipped, Pending with consistent status mapping, shared query state and the existing filters kept. KPI cards need not be clickable.
- Schema? no.

Other Logs items are yellow or deferred: AU-Y18 (rows, Log Details, export contents), AU-Y19 (retry), AU-D11.

---

## Yellow items (decision or fixture from us)

| ID | Source | What is open | Our default or action |
| --- | --- | --- | --- |
| AU-Y01 | Rule state boundary; Save and Activate; Qualified saved-rule persistence; Template editor Enable OFF; Duplicate is DRAFT; acceptance boundary; sections 10, 12 | Exact-rule-state question. She reported Save & Activate and later activation, permits ACTIVE in the non-executing backend, but the latest saved state was not verified and her refresh affirmation was qualified (mixed with the Logs "No Runs" view). Template editor Enable OFF and duplicate DRAFT are separate confirmed states. | Default (ours): Save & Activate = ACTIVE; Save Draft = DRAFT; Use Template editor = Enable OFF, not saved until the user saves; Duplicate = DRAFT. Activation is not a run. We verify the saved status after refresh in dev (rule row, Status filter, Activate/Pause menu label matches status) and record it ourselves; do not ask her. Add a test for each path (`rules.service.ts` sets ACTIVE only with activate). |
| AU-Y02 | Module event tables (YELLOW Confirm); Next work item 4; section 5 | Nine acknowledged or spoken-context lists not exact-locked: Appointments, Bookkeeping, Payroll, Invoices & Payments, Communications, Tasks, Compliance & Deadlines, Staff Management, Integrations. | Default: ship each listed event that binds to a real canonical event; events with no real source stay unlisted and are tracked as not available. Invoice due-state definitions follow IP-F06 (firm timezone, open balances only). Anniversary only if a supported date field exists. No Account Activated, Manager Changed, or open/click events. |
| AU-Y03 | Custom action timing; section 8 | Five presets only (Immediate, 1 hr, 1 day, 3 days, 7 days After). Custom N minutes/hours/days and a trigger-versus-previous-action anchor are her assistant's recommendation, not approved. | Default: do not build; keep the five presets. Revisit only if approved. |
| AU-Y04 | Import method and validation; Remaining template evidence; section 12 | Import has Template File and Paste Text Here; no file-picker addition was approved. | Default: keep both inputs; do not add a picker or new format. Our evidence: supported format, schema/version check, permission, validation messages, sanitized import (no import performed for review). |
| AU-Y05 | Message template prerequisite; section 7 | Send Client Message shows "No templates available right now." | Not a missing selector. Fixture from us: provide approved synthetic message templates in dev and state the eligibility rules (channel, category, approved status). The seed is Rasel's. |
| AU-Y06 | Message routing coverage; section 7 | Sender, Channel, Recipient not reported; generic Send Client Message may cover Email/SMS/Portal. | We check and document the channel mapping and contact validation; no sending. |
| AU-Y07 | M6 Definitions; M7 Evidence still needed | Definitions open. | Defaults (ours): master OFF; eligible events = external-outcome events in Tax Returns, Payroll, Bookkeeping, Invoices & Payments, Communications, Integrations, Compliance (not health, approval or delivery fabrication); who can confirm = firm Owner and Admin, Staff only with the source module's right and the master ON; acknowledgment = a safe reference (id/short note, no credentials or sensitive documents); correction/revocation = a later audited entry, history kept; retention follows the firm's log retention. Evidence: tests for permission enforcement, provenance label, cross-source dedupe. |
| AU-Y08 | Unconfirmed timing details; section 5 | Custom business-day semantics and the invoice timing definitions are proposals. | Default: business-day timing not offered until defined; invoice definitions from IP-F06; Trigger When approval does not approve Custom Action Timing. |
| AU-Y09 | T3 Time correctness; section 5 | Numeric ranges, zero/negative handling, timezone precedence, DST, boundaries, recalculation or cancellation of obsolete pending occurrences after a due-date or appointment change. | Default precedence: firm timezone unless the source record carries its own. We provide unit tests with boundary and DST fixtures; no real scheduling. |
| AU-Y10 | E1 to E4; sections 5, 11, 16 | Canonical contracts, dedupe, safe orchestration, verification evidence. | We supply evidence: documented event schema/version and stable IDs, dedupe keys, loop/depth guards, no duplicate task/message/client systems, safe-ID logs. Tests only; no live runs. |
| AU-Y11 | Overview accuracy and deferred details; section 1 | KPI values, Time Saved formula, "All Systems Operational" badge not proven to be the specified health computation. | We document the KPI and health formulas and check them against seeded data. |
| AU-Y12 | Per-operation semantics; History and menu semantics; section 3 | Last Run accuracy, duplicate-no-history, archive/history policy, Test isolation, permissions, activation audit. | Default: duplicate has no run history; archive keeps history; Test is side-effect free. We provide evidence. |
| AU-Y13 | Copy identity and master; section 12 | New copy gets a distinct ID and the master is unchanged. Heading "Edit Automation Rule" alone is not a defect. | We verify and test; no UI change for the heading. |
| AU-Y14 | Dry run and confirmation; Material Review UI deferred; section 10 | Truly side-effect-free Test/Preview, complete validation, confirmation with rule ID/status/Rule and Logs links. | We verify Test creates no task/message/note and report; add a confirmation only if missing. |
| AU-Y15 | Settings enforcement; Failure and calendar behavior; global observations; sections 9, 11 | Validation, persistence of changed values, enforcement and per-rule inheritance of: dedupe N days, quiet hours, safety threshold, longest chain, failure recipients, Keep Logs range, expiration, Notify Me If Fails, Add to Calendar. Test/live separation. | We test and report; no retention or timezone value changed for review. Optional controls are not defects. |
| AU-Y16 | Ordering and delays; Failure and retry safety; Source controls; section 8 | Run order, dependency, partial failure, retry keys, rate limits, no false outcomes. | Evidence by tests; no real actions run. |
| AU-Y17 | Implementation boundary; Deferred UI and technical verification; section 6 | Server-side AND/OR, comparisons, contextual filtering, null semantics, count accuracy, no-match save/warning policy. | Default: no-match shows a warning and still allows save. Tests with synthetic data. |
| AU-Y18 | Run and export prerequisites; Log Details; Run evidence; sections 13-14 | No run rows exist: columns, detail record, config snapshot, related links, filter/count accuracy, export file contents/privacy/permissions unverified. | Fixture from us: seed synthetic log rows (success, failed, skipped, pending) without running the engine. Do not initiate a run. Export test checks file contents and permissions. |
| AU-Y19 | Retry scenarios; Loops and pending work; sections 11, 15 | Failed-only retry, idempotency keys, changed conditions/version, invalid contact, inactive integration; self and cross-rule cycles; deactivation and pending work. | Evidence by isolated tests with synthetic fixtures only; no Retry click in the UI. |
| AU-Y20 | Permission and audit matrix; Error and access states; Canonical destinations; Developer Acceptance Checklist; sections 16-18 | Server-side View, Create/Edit, Activate, Templates, Logs, Retry, Export, Settings, Automation Admin and source-module rights; audit for create/edit/version, activation, template use, runs, retries, settings, exports; missing-trigger/condition validation, inactive-integration and no-match warnings, loop blocking, network-failure preservation, concurrent edit, permission denial; related links to the 14 destination modules. | We build the matrix and tests; a roles/permissions item. No rights changed, no sensitive data exposed. |

## Deferred items (she deferred these; not missing, not engine-blocked)

| ID | Source | Item | Our action |
| --- | --- | --- | --- |
| AU-D01 | Overview YELLOW; section 1 | Recent Activity required fields and empty guidance. | Self-check in dev before the next review. |
| AU-D02 | Additional confirmed UI; section 1 | Quick Action routes other than Import. | Self-check that each routes to the right screen. |
| AU-D03 | Deferred UI and technical verification; section 6 | Condition reorder. | Next review; not a defect. |
| AU-D04 | same; section 6 | Apply to All versus Specific Criteria UI. | Next review. |
| AU-D05 | Material Review UI deferred; section 10 | Review: Affected Records count/sample, readable Review Trigger Preview, Integration Check, Permission Check, warning controls. | Next review (start here). Note AU-F04 and AU-F21 are separate Trigger/Conditions items. |
| AU-D06 | Actions; section 7 | Generic Message sender/channel/recipient, actual assignee selection, Note configuration, other uninspected action controls. | Next review. |
| AU-D07 | Manage Rules; section 3 | Other filter combinations and menu-specific details. | Next review. |
| AU-D08 | Developer Acceptance Checklist; section 18 | Basic keyboard and responsive inspection. Do not claim an accessibility pass. | Next review; we check keyboard and narrow layout ourselves first. |
| AU-D09 | Settings; section 9 | Global/per-rule inheritance and optional control details. | Next review (see AU-Y15). |
| AU-D10 | Permissions, Audit & Error States; section 17 | Other errors, loading, network, concurrent and permission states (no disruptive fault simulation). | Next review (see AU-Y20). |
| AU-D11 | Retry / Re-run Rules; section 15 | Retry and Re-run clicks: no authority to run. | Do not click; needs fixtures (AU-Y18-Y19) and separately bounded authority. |

## Schema needs (each needs Rasel's tap; do not invent a column)

Clearly needed: Rule Owner on the automation rule (AU-F28, check first); a manual-confirmation flag in the per-business automation settings (AU-F29); a manual-confirmation record per event occurrence (AU-F31, AU-F32). Possible, to check: timing/source options inside the existing rule definition (AU-F05, F30), saved action order (AU-F24). All other items: no, to check. Synthetic fixtures (AU-Y05, Y18) go through the seed, which is Rasel's.

## Roles and permissions touched

AU-F29 (master toggle: authorized automation administrator only), AU-F28 (authorized owner), AU-F30-F31 (server-side role and module rights to confirm), AU-F22 (Staff role condition field, no escalation), AU-F27 and AU-F26 (authorized assignees and recipients), AU-F19 (events never grant rights), AU-Y20 (full matrix). Nothing here changes an existing role definition without a decision.

## 19-section disposition

| # | Source section | Disposition | Items |
| --- | --- | --- | --- |
| 1 | Frame 1 - Automation Overview | UI partial | Y11, D01, D02 |
| 2 | Automation Categories / Links | UI inventory done; backend blocked | F08-F20, Y02, Y10 |
| 3 | Manage Rules | UI gaps; semantics partial | F01, Y12, D07 |
| 4 | Frame 2 - Five-Step Rule Builder | Structure reviewed; functional partial | Y01, F03 |
| 5 | Step 1 - Trigger | UI gaps recorded | F03-F07, F08-F20, Y02, Y08, Y09, Y10 |
| 6 | Step 2 - Conditions | UI partial | F21-F23, Y17, D03, D04 |
| 7 | Step 3 - Actions | UI partial; expansions retained | F24-F27, Y05, Y06, D06 |
| 8 | Action Execution & Failure Rules | Configuration partial; execution blocked | Y03, Y16 |
| 9 | Step 4 - Settings | UI gaps; enforcement blocked | F28-F33, Y07, Y15, D09 |
| 10 | Step 5 - Review & Activate | UI partial; material controls deferred | Y01, Y14, D05 |
| 11 | Loop / Runaway Safeguards | Controls present; backend blocked | Y15, Y19 |
| 12 | Templates | UI partial; identity/validation unverified | Y01, Y04, Y13 |
| 13 | Frame 3 - Automation Logs & Rule Activity | UI gaps; data partial | F02, Y18 |
| 14 | Log Details | Blocked: no run fixture | Y18 |
| 15 | Retry / Re-run Rules | Blocked: no fixture or authority | Y19, D11 |
| 16 | Cross-Module Links | Blocked/partial: link evidence | Y10, Y20 |
| 17 | Permissions, Audit & Error States | UI partial; evidence blocked | Y20, D10 |
| 18 | Developer Acceptance Checklist | Not accepted; gaps open | D08, Y20 |
| 19 | Recommended Build Sequence | Build evidence unverified | Y10, Y20 |

Build order we suggest (from the report's own sequence): selectors and trigger quality (F03-F20), conditions (F21-F23), actions (F24-F27), settings and manual confirmation (F28-F33), Logs tabs and Applies To (F01-F02), then the yellow evidence and the deferred re-review.
