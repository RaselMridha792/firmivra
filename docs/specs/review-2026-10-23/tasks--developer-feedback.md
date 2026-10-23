Firmvra Tasks Module Developer Feedback
First review revised  |  October 21 2026  |  Prepared for the developer
Please correct the blockers and implement the approved additions below while preserving the controls that already work. Task publishing remains blocked, so this is not a full functional approval. The original three frames remain the visual references; the supplied Tasks specification remains the functional baseline.
Status key: Working reported = the observed control behavior may be retained, subject to retesting. Correction = a reported mismatch or broken control. Approved addition = a new or clarified request. Pending = not yet demonstrated, not automatically a defect.

# 1 Working reported results

| Area | Reported result and limit |
|---|---|
| Overview navigation | Total Tasks opens All Tasks; tabs visibly switch. Actual KPI counts and filtering remain pending. |
| Calendar and bulk entry | Calendar date opens an empty task list. Bulk Actions opens All Tasks. Navigation only; date accuracy and bulk changes remain pending. |
| Search and filters | Controls are present, including team filtering. Matching and combined-filter accuracy are unverified. |
| Task fields | Assignee options match test staff; Additional Assignees accepts two people and another. Priorities and due-date picker are present; summary reflects priority/due date. Form-level only; saved assignments remain pending. |
| Checklist and notes | Two items were added; Move Up/Down and inline text editing worked. Required and Delete controls are present; deletion success is uncertain. Internal Notes accepts text. Persistence/privacy remain untested. |
| Reminder controls | Multiple reminders can be added; removing one leaves the other intact. Relative options include 1, 2, 3, 7, 14 and 30 days; recheck same day. Form-level only; persistence/delivery remain unverified. |
| Template actions | Save as Template, Use, Duplicate and Archive work as reported. Active/Archived controls were found; Restore returned the archived test template to Active. Preserve these. Source-template Edit still needs work. |
| Recurring form | Recurrence controls change preview dates. Holiday/next-business-day, start-period, client-team assignment, tax-season link, priority and client-notification options are present/clickable. Generation is untested. |

Task saving remains blocked. Save as Draft is not present; earlier draft success was actually Save as Template. Draft creation/persistence is an approved addition, not a verified result.

# 2 Required corrections

Fix these reported issues first, then rerun the checks. Do not remove working features to resolve a blocker.

## C1 Task Type and task saving

The required Task Type selector opens empty and the reviewer could not find a setup path. Saving reports “Choose task type.” Connect the selector to the company’s configured task categories and provide a discoverable, permission-controlled configuration path. Explain an empty configuration rather than leaving an unusable required field.
Retest: create an active test type, select it on a new task, complete required fields and save. Refresh and reopen the task. Confirm the record and type persist. An inactive type must follow documented availability rules.

## C2 Templates must be optional

An earlier save attempt reported “no template selected.” A standalone task must save without a template. Template use is optional and must not be a hidden publishing requirement. Keep genuine required-field validation clear and preserve entries when validation fails.
Retest: save a valid task without a template, then another using a template. Each must create one task. Refresh both and verify their content. Separately verify draft creation and persistence; do not assume a draft was retained.

## C3 Template creation and source editing

No Add/Create Task Template button was found in the library. Add a working Create Task Template path. Preserve the working Save as Template route. Provide a clear Edit action for the source template; Use opens a task from a template and must not be treated as source-template editing.
Retest: create a template in the library, edit its source, save, reopen and use it. Confirm the new defaults appear in a new task and that existing tasks are not silently changed.

## C4 Searchable Client selector

Client list selection works, but name search is missing. Add authorized searchable client/business selection as required by the guide. Search results must remain company-scoped and respect record permissions.
Retest: search by partial client name, choose a result, clear it and search for a second client. A user without access must not discover restricted clients through results, counts or error text.

## C5 Correct Related To behavior

Related To currently repeats the services shown in Service. It must instead select the permitted related record or engagement, narrowed by the selected client and relevant record type. Keep Service as a separate optional selector using Services & Pricing. Do not let task access grant access to the linked record. Approved custom-entry behavior is specified in A1.

# 3 Additional required corrections


## C6 Upload button

Clicking Upload opens no file chooser. Restore the file-picker action and support the specified drag/drop route. Validate configured types and sizes, protect stored files and show actionable errors. Upload success, download access and confidentiality still require end-to-end testing.

## C7 All Day on the main task form

The reviewer explicitly reported All Day missing. Add it beside the main task due date/time controls, with consistent validation and summary behavior. Define and document timezone and all-day due/overdue rules. Missing All Day in the recurring panel alone is not the reported defect; the original guide places Due Time / All Day on the main task form.

## C8 Apply Same Checklist in recurrence

Apply Same Checklist stays disabled even after a checklist item is added and marked required. Make the control usable when its prerequisites are met, or clearly explain any legitimate prerequisite. Each generated occurrence must receive its own checklist snapshot, not shared completion state.

## C9 Automations routing

The top Automations button returns “Page not found.” Route it to the canonical Automations area with Tasks context. Enforce the role restriction in A4 below in both the interface and backend.

## C10 Unsaved changes warning

In Add Task, entering a changed title and pressing Cancel closes the form without warning. Add Save, Discard and Keep Editing before unsaved changes are lost. Apply this behavior when creating/editing tasks, drafts and templates. Only Add Task was tested; the other scopes are pending verification, not confirmed failures.
Retest each scope: change a field and cancel. Keep Editing must preserve the entry; Discard must discard only after selection; Save must save valid content or retain the form with validation errors. Also check Back/navigation behavior.

## C11 Duplicate checklist item

Duplicate checklist item is missing. Add it as required by the original checklist specification. Preserve working inline editing and Move Up/Down. A separate Edit button is not needed merely to replace working inline editing. Required and Delete are present, but deletion success remains unverified.
Retest: duplicate one item, confirm a separate copy, edit the copy and verify the original does not change. Save/reopen to verify order and independent state. Retest Delete and keyboard reordering.

# 4 Approved additions and clarifications

The earlier request to add an Archived view and Restore is withdrawn: both were found, and restoring the archived test template to Active was demonstrated. Preserve the existing implementation.
| ID | Approved behavior |
|---|---|
| A1 | Related To: searchable real-record selection is primary. If no suitable record exists, allow company-entered custom text with an explicit Save button beside it. Preserve the selected-client association; label custom text clearly and do not fabricate a real record link. |
| A2 | Add separate Save Task, Save as Template and Save as Draft actions. Add a tab labeled exactly Drafts beside Completed Tasks on the main Tasks page. Support draft search, applicable filters, and reopening/editing drafts. Save as Template must remain distinct from saving a draft. |
| A3 | Reminders: preserve existing options and add Custom with a numeric value and minutes, hours or days before the due time. Support multiple rules and validate values and conflicts. |
| A4 | Only company admins OR the account owner may manage task automations. Enforce create/edit/enable/disable/delete permissions server-side as well as in the UI. Other staff may work on generated tasks under ordinary task permissions. |
| A5 | Add Save & Create Another to the recurring form. This is an approved addition, not an original recurring-form defect. Preserve the existing regular-task Save & Create Another. Save once, then open a fresh form without duplicating the series on retry. |


## T29 Drafts workflow after implementation

Test: Choose Save as Draft on a named task, then open the Drafts tab beside Completed Tasks. Search by name and apply relevant filters such as priority/type. Reopen, edit and save the draft, refresh, then complete required fields and Save Task. Also test Save as Template separately.
Expected: Drafts persist and remain editable; search/filters return the correct authorized drafts. Save Task creates one normal task, not a duplicate draft/task pair. Save as Template creates a reusable template, not a draft. Publishing validation stays distinct from draft validation. No draft success is currently verified.

# 5 Pending tests for saving and overview

Run these tests in an isolated test company or approved test environment with dummy records and test notification destinations. Do not use real client data or send live client messages. Record expected versus actual results, evidence and any blocker for each test.

## T1 Save and reopen tasks

Test: After C1 and C2 are fixed, create TEST Tasks A without a template. Add a client, allowed related record, description, assignee, priority and due date/time. Save, refresh, leave the page and reopen it. Repeat in Edit mode.
Expected: One record is created; values persist and edits update the same record. Required fields validate inline. No template is required.

## T2 Draft and repeated saves

Test: After the approved draft feature is implemented, create a named draft, leave and reopen it, then publish it once valid. Double-click Save or retry after a simulated lost response. Use Save & Create Another on a separate task.
Expected: Draft retention and transition are demonstrated. Retries do not create duplicates. Save & Create Another saves once and opens a fresh form. Missing data does not disappear on failure.

## T3 Build a controlled test set

Test: Create tasks with Pending, In Progress, incomplete past due, completed this month, completed last month and Cancelled states where configured. Include two assignees, two clients and two due dates. Use test controls to set historical dates when needed.
Expected: The known records allow exact counts and result sets to be checked. Overdue is derived from incomplete past-due work, not assumed to be a separate stored status. Document treatment of cancelled/archived tasks.

## T4 KPI cards and view tabs

Test: Click Total Tasks, Pending, In Progress, Overdue and Completed This Month. Then test My Tasks, All Tasks, By Client, By Project, Recurring Tasks, Task Templates and Completed Tasks.
Expected: Each displays its defined authorized subset or grouping. Completed This Month uses completion date. Staying on the All Tasks tab is not failure if the correct filter is applied; show active filter state clearly.

## T5 Search filters and pagination

Test: Search known task/client/record/service text. Combine status, priority, type, client, team and due-date range filters. Move between pages, clear filters and repeat with no matches.
Expected: Results match the controlled dataset; permitted metadata only is searchable. Pagination preserves state. Empty results are helpful and do not expose restricted counts. Verify the intended reset behavior of All Tasks.

## T6 Calendar and row actions

Test: Select each test due date and open a calendar event. On a saved row, test View, Edit, In Progress, Complete, Reopen, Reassign, Change Due Date, Change Priority, Duplicate and View Related Record.
Expected: Calendar shows only the correct authorized due tasks. Each action affects the intended task; completion stores actor/time. Linked records remain separately authorized. Duplicates follow documented reset rules.

# 6 Pending tests for forms and templates


## T7 Remaining row and bulk actions

Test: Test Convert to Recurring, Save as Template and Cancel/Archive. Select a mixed eligible/ineligible set and run bulk reassign, status, due-date set/shift, priority and complete. Test cancel/archive confirmation and export if supported.
Expected: Only permitted actions and eligible tasks change. Confirmation cancellation makes no changes. Partial failures are visible; affected IDs and outcomes are auditable. Export includes only authorized data.

## T8 Form fields and schedule

Test: Check required title/type, safe formatted description and length limit, optional start date, due-date policy, due time and All Day. Change client after choosing a related record. Edit additional assignees and service.
Expected: Validation is clear; disallowed relations cannot survive a client change. All Day and timed tasks use documented timezone rules. Collaborators do not gain unrelated client access. Summary matches the saved values.

## T9 Checklist behavior

Test: Add three items, reorder by mouse and keyboard, edit/duplicate/move/delete an item, complete one and save/reopen. Apply a checklist template. Where supported, assign a subtask, show progress and require an item before parent completion.
Expected: Order and state persist independently per task. Required-item rules block completion appropriately. Deletion/removal is confirmed by retest rather than the tentative walkthrough response. Optional features follow configured policy.

## T10 Template lifecycle

Test: Create a source template with assignment rule, service, relative due date, checklist, reminders and visibility default. Edit, duplicate, archive, restore and use it. Change generated task fields before saving.
Expected: Source editing is distinct from Use. Preview allows review and edits. Relative defaults calculate correctly. Existing Active/Archived and Restore behavior remains working after changes. Only safe reusable, non-client-specific attachments carry into templates.

## T11 Related record and custom entry

Test: Search permitted records for client A and choose one. Open the link. Switch to client B. Test no-match custom text, its adjacent Save button, reopening and later editing.
Expected: Records narrow by client/type and remain authorized. Invalid old links are cleared or rejected. Custom text persists with the correct client, is identifiable as custom text and is not represented as a real record ID or link.

## T12 Attachments and notes

Test: Upload allowed files by picker and drag/drop, then try invalid type/size. Save/reopen; test view, download, replace, reclassify and permitted archive/delete. Enter internal notes and check the portal as a test client.
Expected: Valid files persist in private scoped storage. Invalid files receive useful errors; scanning follows configured support. Attachment access and material actions are audited. Internal notes never appear in client-facing output.

# 7 Pending tests for permissions and notifications


## T13 Company and record isolation

Test: Use separate test companies plus owner, admin, limited staff and client accounts. Attempt direct URLs/API calls for another company’s task and a restricted related client/record. Repeat through search, export, attachments and bulk actions.
Expected: Unauthorized access is rejected without data leakage. Viewing a task never grants access to the client or related record. Checks apply server-side, not only through hidden buttons.

## T14 Task permission matrix

Test: For each role, test view/create/edit, complete/reopen, assign/reassign, client visibility, templates, recurring management, bulk changes, attachments, reports/export and task administration.
Expected: Each action follows its explicit permission. Unauthorized direct requests fail safely. Inactive/unavailable staff follow configured assignment policy. Do not infer role security from one admin walkthrough.

## T15 Automation management

Test: As owner and company admin, open Automations from Tasks and manage a test task automation. As ordinary staff, attempt the same UI action and direct request. Trigger an approved test event.
Expected: Owner/admin can manage automations; ordinary staff cannot. The canonical route keeps Tasks context. Generated tasks use canonical task APIs and ordinary task permissions. No duplicate event-processing tasks appear.

## T16 Client visibility and attachments

Test: Keep one task internal and explicitly expose another to a client with portal access. Approve only one of two attachments for that client. Test another client and a client without portal access.
Expected: Only approved task fields/checklist content and separately approved attachments are exposed. Internal notes, security metadata and restricted files remain hidden. Task visibility does not expose every attachment automatically.

## T17 Reminder calculation and delivery

Test: Use test destinations and a near-future timed task. Add multiple standard rules and custom minute/hour/day rules; edit/remove one, change the due date and complete/cancel the task. Test in-app/email/SMS only where enabled, available and consented.
Expected: Rules calculate in the documented timezone; invalid values and after-due rules are handled clearly. Delivery, suppression/rescheduling and retries follow documented policy without unintended duplicates. A clickable reminder control is not delivery proof.

## T18 Dependencies

Test: Save tasks A and B, set B to depend on A, and attempt to start B. Complete A. Then try A depends on B and a longer circular chain. Test a restricted prerequisite.
Expected: Blocked reason is visible and B unblocks under the configured rule; optional assignee notice is verified separately. Circular chains and unauthorized prerequisites are rejected. An empty selector before tasks exist is not itself a defect.

# 8 Pending tests for recurring tasks


## T19 Frequency preview and boundaries

Test: Create series for daily, selected weekly days, monthly date/nth weekday, quarterly and annual patterns. Test interval changes, start date, no end, End After N and End On Date. Include month-end and leap-year cases.
Expected: Preview matches documented scheduling rules. End After N produces exactly N scheduled occurrences; none fall after the end date. Quarterly is every three months unless a configured fiscal rule applies. Invalid dates are handled consistently.

## T20 Timezone holidays and creation time

Test: Test timed dates across daylight-saving changes, holiday next/previous-business-day policy, lead time and Create at Start of Period. Compare preview with generated records.
Expected: Creation and due dates use explicit timezone rules; business-day adjustments are consistent and do not violate end rules. The pasted specification ended at “Timezone” without its detail: document the rule before acceptance.

## T21 Generation and retry safety

Test: Save a short test series with two or three upcoming occurrences. Run its scheduler in the test environment, repeat the same job and simulate a transient failure/retry.
Expected: Stable series/occurrence keys prevent duplicate tasks. Actual generation matches preview and lead-time rules. Failures are logged and persistent failures notify authorized admins. UI preview alone is insufficient.

## T22 Snapshots and additional options

Test: Generate two occurrences with checklist, attachments, priority and reminders. Complete an item on the first. Change client-team membership before another occurrence. Exercise tax-season link and permitted client notification.
Expected: Each occurrence has an independent snapshot. Eligible current staff resolve under the configured rule. Reusable resources remain safe; calendar links do not duplicate Compliance & Deadlines logic. Client notices obey visibility and communication rules.

## T23 Series edit scopes

Test: Create a series with completed past, open current and future occurrences. Edit This Occurrence Only, This and Future, then Entire Series. Change assignee/checklist/frequency, skip one occurrence and test confirmed future deletion.
Expected: Selected scope is respected; completed history is not rewritten. Future calculations preview before save. Skip reason and destructive confirmation behave as specified. Past/completed tasks are preserved.

## T24 Pause stop and recurring saves

Test: Pause and resume where supported, then stop a series. Test inactive client/staff fallback. Use recurring Save & Create Another and retry its save.
Expected: Pause/stop prevents future generation as specified while preserving existing tasks/history. Fallback is explicit, not silent data loss. Save & Create Another creates one series and opens a fresh form; retries are idempotent.

# 9 Final validation and developer handoff


## T25 Errors and concurrent edits

Test: Try missing required data, unsafe description content, invalid recurrence/upload/reminder values and an inactive assignee. Disconnect the network during save. Edit the same task in two sessions. Cancel/back with unsaved changes in create/edit tasks, drafts and templates; rerun the failed Add Task Cancel case.
Expected: Clear inline errors preserve the form. Retry is safe. Conflicts prompt refresh/reconciliation instead of silent overwrite. Unsaved changes offer Save, Discard and Keep Editing. Loading and empty states are usable.

## T26 Audit coverage

Test: Perform task edits, status/completion/reopen, assignment, due date/priority, visibility, reminder/dependency, attachment, template, recurring, generation and bulk actions. Inspect the authorized audit history.
Expected: Logs identify actor, timestamp, task/series/template/document IDs as relevant, meaningful old/new values, affected IDs/count and outcome. Generation includes occurrence key/date and created task ID; failures are represented.

## T27 Cross module integrity

Test: Link tasks to an appointment and supported engagement records. Trigger a compliance-linked task and inspect related reporting. Test service labels and assignee availability/status.
Expected: Task and appointment remain distinct records. Compliance & Deadlines remains the deadline source of truth. Reports use the canonical reporting architecture. Services and staff data remain configured and permission-controlled.

## T28 Responsive and keyboard access

Test: Repeat create/edit, selectors, reminders, checklist ordering, menus and confirmation dialogs on mobile-width and desktop views using keyboard-only navigation as well as pointer input.
Expected: Labels, focus, keyboard order and validation are usable; no hidden or clipped required controls. Reordering has a keyboard-accessible alternative. Navigation does not lose unsaved work unexpectedly.

# Completion record

For each item, return status, actual result, test build, tester/date, evidence and remaining limitations. Visible or clickable controls alone do not verify persistence, permissions, delivery or scheduler behavior.
| Release condition | Required evidence |
|---|---|
| Saving unblocked | Task Type configured; tasks save without templates; save/reopen and duplicate-retry tests pass. |
| Corrections and additions | C1–C11 corrected; A1–A5 implemented and retested without removing working behavior. |
| Functional and security checks | Saved-record actions, company/client isolation, attachment visibility, reminders, dependencies and audit evidence supplied. |
| Recurring reliability | Preview, generation, unique keys, retry, edit scopes, history, pause/stop and date-boundary tests pass. |

