Firmivra Workflow and Automations Developer Package
Corrections approvals and required flows • October 19 2026
Update Settings → Workflow & Automations using the owner’s testing. LATEST FINDINGS SUPERSEDE EARLIER REPORTS: appointment type creation succeeds. In-Person alone saves and Phone alone saves; selecting In-Person, Phone and Zoom together fails. Fix multi-method settings saving and specific validation feedback. Confirm persistence after refresh. Tax Return Statuses saving is approved, while client portal status visibility and notifications remain unverified. Preserve approved navigation to Staff Management; its functionality is unreviewed.
# Original Workflow and Automations page
# Review status by card
Control or area | Required behavior
Tax Return Statuses | WORKING per owner testing: adding and saving statuses, with connection to Settings tax statuses. Up/reordering and Done behavior still need explicit verification; do not claim every control passed.
Automations | FIX REQUIRED: Open Automations returns Page not found. Connect it to the existing main Automations module and retest.
Appointment Types | PARTIAL: type creation succeeds; single In-Person or Phone settings save. Multiple enabled methods fail. Require support for In-Person, Phone and Zoom together and persistence after refresh. Zoom integration remains unverified.
Tasks and Assignment | FIX REQUIRED: Open Tasks returns Page not found. Teams & Departments opens Staff Management correctly and its navigation is APPROVED. Destination-page functionality has NOT been reviewed.
# Appointment Types screenshot and correction locations
Screenshot evidence: only Back to Appointments is shown, with no saved types listed. The save failure itself was reported verbally; an error-dialog screenshot has not been supplied. Do not treat the empty list alone as proof of the failure cause.
Control or area | Required behavior
Create and save | Historical test: initial Add Type attempt returned a generic error. Latest owner test successfully adds Tax Return Consultation. Current defect is Save Settings validation failure; see the latest screenshot and update at the end.
Successful result | Create exactly one firm-scoped appointment type, show success after server confirmation, list it immediately, and retain it after reload. Selecting it should load Type Settings. Prevent duplicates on retries.
Validation | Require supported name, duration and meeting method. Show specific safe inline errors for invalid fields; distinguish provider setup errors from save errors. Saving a reusable appointment type must not create a dated Zoom meeting.
Back button addition | Keep the existing Back to Appointments link. ADD a separate Back to Workflow & Automations button that returns directly to Settings → Workflow & Automations.
Unsaved edits | When leaving an edited form, offer Discard and Leave or Stay. Do not silently lose input. Preserve the current firm and authorized context.
# Return navigation across every linked section
Every section opened from this Settings hub must provide the additional Back to Workflow & Automations control: Tax Return Statuses, Automations, Appointment Types, Tasks, and Teams & Departments in Staff Management. Preserve existing module navigation. Use a validated internal return destination; do not depend solely on browser history. Keep the origin through refresh and relevant subpage navigation.
# Card flows and developer confirmation
Control or area | Required behavior
Tax Return Statuses | Edit Statuses opens the shared firm status manager. Preserve owner-confirmed add/save behavior and synchronization with Settings tax statuses. Verify reload, order controls and Done/close separately. Renaming or retiring a status must preserve existing return associations and history.
Open Automations | Replace the broken destination with the registered Automations module route. Verify click, refresh, permissions and return navigation. Opening the module must not activate or run any automation.
Open Tasks | Replace the broken destination with the registered Tasks module route. Verify click, refresh, permissions and return navigation. Opening Tasks must not create or reassign work.
Teams and Departments | Preserve the approved link to Staff Management. Add the return-to-hub control for this entry path. Staff Management functionality is pending a separate review; navigation approval is not approval of its controls.
# Zoom connection and scheduling requirement
Each company must authorize its own Zoom connection under Integrations → Zoom. Show Connect Zoom, actual connection status, management and reconnection guidance. Keep company credentials and meeting records isolated. Map the appropriate authorized Zoom host to staff appointments; never assume one host can cover every simultaneous booking.
Required booking flow: select a Zoom appointment type → choose a date, time and staff host → validate availability and host connection → create the appointment and Zoom meeting with safe retry handling → attach the participant join link to the appointment and confirmation. The host start link is restricted to the host and must never be sent to clients. Rescheduling updates the linked meeting; cancellation updates or removes it according to the documented policy. If Zoom fails, show a clear pending/error state and avoid sending a false meeting confirmation or creating duplicates.
Developer must confirm whether Zoom authorization, host mapping, meeting creation, join-link delivery, rescheduling and cancellation are implemented. Calendar synchronization is a separate capability to confirm; creating a Zoom meeting does not itself prove external-calendar sync. Built-in video is NOT in the current scope.
# Acceptance checklist
Control or area | Required behavior
01 | Approved tax status add/save behavior remains intact; verify reload, shared status source, Up/order and Done controls.
02 | Open Automations and Open Tasks load their intended modules without Page not found.
03 | Tax Consultation with 15-minute duration saves once and persists after reload. Test In-person, Phone and Zoom methods separately.
04 | Save failures preserve input and provide actionable errors; retry does not duplicate types.
05 | All five destinations retain existing navigation AND provide the additional Back to Workflow & Automations button; unsaved-edit prompts work.
06 | Teams & Departments continues to open Staff Management. Its page functionality remains pending review.
07 | Developer confirms company-specific Zoom setup and scheduling lifecycle; run controlled booking, reschedule, cancellation and failure tests.
08 | All reads, saves, callbacks and routes enforce permissions and firm isolation. Record audit events without credentials.
09 | Re-review reported failures after fixes. Do not mark the entire hub approved while saves, routes or required integrations remain unresolved.
# Schedule and client portal connections
Additional owner requirements • October 19 2026. These connections require developer confirmation and end-to-end testing; the working status editor does not prove portal updates or notifications work.
# Appointment types must connect to scheduling
After an appointment type is saved, it must be available in the appropriate staff scheduling and client booking flows. The selected type supplies its configured duration and meeting method. Available slots must respect staff availability, existing bookings, timezone and any configured booking restrictions. The resulting appointment must appear on the Firmivra schedule with the correct client, staff member, type, date, time and duration. Disabled types must not accept new bookings; existing bookings must remain intact.
Developer must confirm the shared source of appointment types and demonstrate: create a type → reload → select it while booking → choose an available slot → save → see the appointment on the schedule. Verify that rescheduling and cancellation update the schedule, avoid double booking and follow the linked Zoom lifecycle where applicable. External calendar synchronization is a separate integration to confirm.
# Return status must connect to the client portal
When authorized staff changes an individual tax return to a new workflow status, save that status on the return and show the current status in the correct client’s portal. This applies to transitions between the configured workflow stages. Distinguish changing a return’s status from editing the reusable status list: adding or reordering a status definition must not itself move returns or notify every client.
Notify the affected client of the status transition through the configured applicable notification channels. The portal notification must open the correct authorized return or status view. Email and SMS notices must follow the established notification policy and channel availability, without exposing sensitive tax information. Internal notes and other clients’ data remain restricted. Record the transition time and actor; preserve history, deduplicate notifications and surface delivery failures for retry.
# Required confirmation and acceptance
Developer confirms appointment types feed the schedule and booking forms, using a shared firm-scoped data source.
Book a controlled test appointment and verify type, method, duration, timezone, staff assignment and schedule persistence after reload.
Change a test client return status and verify the same current status appears in that client’s portal after refresh.
Verify the intended client receives the appropriate status-change notice once and can open the correct portal record.
Verify another client cannot see the return, status history or notice; saving the same unchanged status does not create duplicate transition alerts.
Keep schedule integration, portal synchronization and status notifications marked pending verification until these tests pass.
# Custom workflow and automation creation
NEW REQUIREMENT requested by owner. Add a Custom Workflows card below the existing four cards on Settings → Workflow & Automations. Include Create Custom Workflow & Automation and Manage Workflows buttons, using the same builder and workflow engine as the main Automations module. This addition supports services beyond tax, including bookkeeping and payroll.
# Creation flow
Click Create Custom Workflow & Automation → open the builder with Back to Workflow & Automations. Enter a unique firm-scoped name, description and applicable service or record type.
Create named workflow stages in order. Allow add, rename and reorder; define completion and permitted transitions. Reusable workflow definitions and individual client work records must remain separate.
Optionally add automations: choose a supported trigger, conditions, action and timing. Actions can create tasks, assign authorized staff or eligible teams, send approved notices or move work to a stage. Only offer actions that the platform actually supports.
For tasks and assignments, choose an authorized person or eligible team/department, task details and due-date rules. Use Staff Management as the source; reject inactive or unavailable assignees and explain missing configuration.
Save Draft validates and stores the definition without running anything. Preview or Test uses sample data or a dry run and shows the proposed effects without sending messages or modifying production records.
Activate shows a review of triggers, actions, recipients, timing and required integrations. After confirmation, enable for future eligible events. Draft or disabled workflows must not execute.
Edit, duplicate and deactivate are available to authorized users. Duplicates start as drafts. Deactivation stops new triggers and states clearly what happens to already queued actions. Retiring a definition preserves existing work and history.
# Required controls and safeguards
Include Save Draft, Cancel, Test or Preview, Activate, Deactivate and View Activity. Protect unsaved edits. Restrict editing and activation by role and firm; log author, changes, activation and execution outcomes. Validate required fields, unsupported actions, missing integrations, scheduling timezone and invalid stage references. Prevent loops, repeated triggers and duplicate actions. Show failed actions with safe retry controls and avoid replaying successful actions.
# Acceptance and remaining review
The new button opens the builder and the Back control returns to the Workflow & Automations hub.
A custom workflow saves as a draft and persists after reload without executing. Invalid or duplicate names and incomplete actions produce clear validation.
Ordered stages and assignment rules persist. Test mode creates no live messages, tasks or status changes.
After authorized activation, a controlled test event produces the intended action once, for the correct firm and recipient. Verify timing, deactivation and failure recovery.
Previously approved: tax status adding/saving and its Settings connection; Teams & Departments navigation to Staff Management. Reordering and Done controls require explicit verification; Staff Management page functionality remains unreviewed.
Existing corrections remain open: Open Automations and Open Tasks routes, appointment-type saving and the additional return button across all destinations. Scheduling, Zoom and client portal status synchronization/notification connections still require developer confirmation and testing.
Add one Custom Workflows card to the Settings hub, with Create Custom Workflow & Automation and Manage Workflows actions opening the shared builder/module. Draft saving, activation, assignment and activity logs belong inside that builder. Preserve the four existing cards. Only the specifically tested items are approved.
# Latest screenshot and implementation locations
Latest owner screenshot shows the saved tax stages: Preparing Return, Client Review and Signature, and Submitted. Preserve these firm-configured values; do not hard-code them for all firms.
Upper-left Tax Return Statuses: preserve owner-tested adding/saving. Confirm changes to a return propagate to that client’s portal and notifications.
Upper-right Appointment Types: fix create/save failure; confirm types feed scheduling and booking. Add the extra return-to-hub button on the destination page.
Lower-left Automations: repair Open Automations returning Page not found.
Lower-right Tasks & Assignment: repair Open Tasks returning Page not found. Preserve approved Teams & Departments navigation; Staff Management functionality remains unreviewed.
Below the current cards: add the Custom Workflows card. All linked destinations must retain their existing navigation and provide Back to Workflow & Automations.
# Latest appointment settings correction
Latest owner test supersedes earlier broad save-failure reports: Tax Return Consultation can be added. In-Person alone saves; Phone alone saves. Selecting multiple methods together produces the settings error. Zoom alone and other combinations require testing. Persistence after refresh must be verified for the type and every setting.
Screenshot evidence: green “Tax Return Consultation added.” confirms a displayed creation-success state. The row shows 30 min, Zoom / Video, Clients Can Book No, Changes Until 24 h before, Active. The settings panel shows In-Person, Phone and Zoom / Video selected; Buffer before 30 min, Buffer after 15 min, Minimum notice 2 hours, Booking window 14 days ahead and email reminder checked. These are displayed test values, not approved defaults.
Current multi-method error: “Some details need fixing. Check the highlighted fields.” No specific highlighted field is visible in the screenshot. Support multiple enabled methods on one appointment type; do not reject valid combinations. If a field is invalid, highlight it and explain why. Persist all settings and return the same values after refresh. Preserve draft input on failure and keep the list summary consistent with saved settings.
# Booking window and persistence acceptance
REQUIRED CHANGE: expand Booking window below the current 14-day minimum to include 1 day ahead, retaining longer options. Apply this configurable option to appointment types generally, including Tax Return Consultation.
Booking window is the maximum future booking horizon. Minimum notice is the earliest allowed booking lead time. Selecting a one-day window permits eligible slots within that horizon, subject to minimum notice, availability and buffers; it does not require every booking to be a full day in advance. If a firm wants at least one day’s notice, Minimum notice needs a 24-hour option. Do not silently replace the displayed 2-hour notice with 24 hours.
Add a type and verify it remains listed after refresh and reopening the page. Record any disappearing type separately from settings persistence.
Select a type, change description, meeting methods, both buffers, minimum notice, booking window and reminder option; save and reload. Verify every field persists for the correct type.
Reproduce and fix the validation error. No generic request to check highlighted fields without specific visible field errors.
Choose 1 day ahead and verify only slots inside that horizon can be booked. Enforce the same bounds server-side and test the timezone boundary.
Verify minimum notice and buffer rules independently; prevent configurations with no possible slots or explain them clearly.
Confirm saved methods and client-booking eligibility match list summaries and the actual scheduler. Test each permitted method.
For appointments booked less than one day before the start, do not schedule the one-day reminder in the past; define and verify skip or immediate-reminder behavior without duplicate messages.
Current approval: creation succeeds; In-Person-only and Phone-only settings saves work per owner testing. Multi-method saving is NOT approved. Tax Return Statuses saving is approved; client portal visibility/notifications still require end-to-end verification. Teams & Departments navigation is approved; Staff Management functionality remains pending.
# Final findings and multiple meeting methods
This section supersedes earlier broad statements that all appointment settings fail. Preserve the screenshots and prior reproduction context, but use the current status below for implementation and approval.
WORKING per owner testing: appointment type creation, In-Person-only settings saving, Phone-only settings saving, and Tax Return Statuses saving.
FIX REQUIRED: one appointment type must allow multiple enabled meeting methods, including In-Person, Phone and Zoom / Video together. Store the enabled methods as a collection across UI, API and persistence rather than forcing one value.
BOOKING FLOW: staff or client selects the appointment type, then chooses ONE of its enabled methods for that individual booking. Store the selected booking method separately from the type’s allowed-method collection. Create a Zoom meeting only when Zoom is selected for the booking.
VALIDATION: allow supported multi-method combinations and require at least one method. Only show field-specific errors where justified. Correct the message referring to highlighted fields when none are identified.
PERSISTENCE: after saving, refresh and reopen the type; all enabled methods and other settings must remain. Do not mark a save successful before the server commits.
FIELD HELP: add Minimum notice help text explaining how far in advance a client must book. Example: 2 hours means a 10 a.m. booking can start at noon or later if available. Booking window is how far into the future appointments may be booked. Include 1 day ahead as an available booking-window option.
TAX STATUS CONNECTION: verify a saved status change on an individual return remains after refresh and appears for that client in the portal. Verify the appropriate notice is delivered once. Status-definition saving is approved; portal synchronization and delivery are still pending confirmation.
REGRESSION TESTS: save each method alone, all three pairs, and all three methods together; refresh each time. Test one booking per enabled method, the empty-selection error, and method-specific location or connection prerequisites.
RETAIN EXISTING REQUIREMENTS: broken Open Tasks and Open Automations routes; additional return-to-hub controls for every linked section; scheduling and Zoom confirmation; Custom Workflows card and builder; Staff Management review boundary.