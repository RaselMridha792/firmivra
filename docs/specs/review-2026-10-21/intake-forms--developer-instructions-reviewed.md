FIRMIVRA
Intake Forms Module
Developer Instructions
Updated for the main dashboard and all five supporting frames. One module, connected workflows, shared records.

## Scope and screen order

Use the uploaded three-page instructions as the functional baseline. This revision expands that guide with every section visible in the Intake Forms mockups and the follow-up layout directions in this conversation. The main dashboard is separate from the five numbered supporting frames.
| Reference | Screen | Purpose / entry point |
|---|---|---|
| Main page | Intake Forms dashboard | Working list, status filters, summary cards, templates, chart and quick actions. |
| Frame 1 | Create New Intake Form / Form Builder | Create Intake Form, Create New Form or Create Form Template. |
| Frame 2 | Send Intake Form | Send action, paper-airplane icon or Send Form to Client. |
| Frame 3 | Intake Form Detail / Submission View | Eye icon, form record or a submission awaiting review. |
| Frame 4 | Form Templates | View All in Form Templates or Manage Templates. |
| Frame 5 | Intake Form Settings | Manage Form Settings; configure defaults and related preferences. |


## How to use this document

The navy tables describe the baseline requirements and visible frame controls. Amber notes identify conflicts, missing details, or proposed implementation clarifications; they are not silently treated as approved changes. References to original sections mean the supplied Intake Forms instructions, sections 1-10.
| Branding alignment: The source document is titled Firmivra; the mockups still display LVP Pro and example firm branding. Keep Firmivra as this document title. Confirm the final product logo and client-facing firm branding before implementation; do not hard-code the mockup logo, contact details, sample URLs or sample client data. |
|---|


## Core workflow

Create or select form > select client/lead > assign staff > send secure link > recipient saves progress > recipient submits > notify staff > review > mark complete.
All Forms, Sent, In Progress, Submitted, Completed and Expired remain filtered views of the same form records, not separate page builds.
MAIN PAGE / 1 OF 2

# Dashboard, filters and status model

Basis: original sections 1-2; main Intake Forms dashboard.
| Area | Required behavior |
|---|---|
| Summary cards | Display Total Forms, Sent, In Progress, Completed and Expired. Use live firm-scoped form records. The percentage-change captions shown in the mockup are comparisons, not fixed values. |
| Search and More Filters | Search client/lead, email, form name, service or status. Include staff, date range, template and service filters. Filter the current table without navigating away. |
| All Forms / status tabs | Keep one table and page layout. Changing tabs applies a status filter; do not create duplicate records for different tabs. |
| Form Status Chart | Show the distribution of current statuses from the same dataset. Segment click may apply its status filter, as allowed in the baseline. Legend, chart and counts must reconcile. |
| Pagination | Show current range, total records, page controls and rows per page. The sample 8-per-page value is not a fixed system limit. |
| Workspace header | Use the existing workspace search, notification bell, help and account-menu behavior. Keep the shared sidebar; do not build Intake-specific copies of unrelated modules. |
| Create buttons | Create Intake Form in the top bar and Create New Form above the table both open Frame 1. Intake Forms stays active in the workspace navigation. |


## Lifecycle definitions retained from the source

| Status / view | Meaning |
|---|---|
| Draft | An unsent builder or send draft. Save as Draft is supported; where drafts appear in All Forms needs confirmation. |
| Sent / Not Started | A form delivered to a client/lead awaiting activity. Sent includes Not Started when applicable. |
| In Progress | Recipient has started but has not submitted. |
| Submitted | Recipient submitted; waiting for firm review or processing. |
| Completed | Firm reviewed/accepted the submission and marked it complete. |
| Expired | Configured response deadline passed before completion, under the original rule. |

| Status conflict: The detail mockups use Completed and 100% for forms that are still ready for review. Retain the original Submitted-versus-Completed distinction until confirmed otherwise. Question completion percentage is not the same as staff acceptance. Due-date and expiration behavior also needs sign-off; see page 15. |
|---|

MAIN PAGE / 2 OF 2

# Table, row actions and shortcuts

Basis: original sections 4-5 and 8; main dashboard.
| Table column | Behavior |
|---|---|
| Client / Lead | Name and basic contact details. Clicking the name opens the existing client/lead profile. |
| Form Name / Service | Show the assigned form/template and enabled service: Personal Tax, Business Tax, Bookkeeping, Payroll, Tax Planning, Advisory or another firm service. View opens Frame 3. |
| Status / Date Sent | Show lifecycle status and original send date. Resends belong in history and do not overwrite original Date Sent. |
| Last Activity | Most recent open, save, upload, submission, staff review or status change. |
| Assigned To | Responsible staff member from the current firm. Show name/avatar when available. |
| Selection / Actions | Checkbox selects the record. Eye opens Frame 3; paper airplane opens Frame 2 with recipient/form prefilled; ellipsis opens permitted actions. |


## Menus and dashboard shortcuts

| Control | What opens / what changes |
|---|---|
| Row More menu | Assign staff, permitted status action, extend expiration, duplicate, archive and other approved actions. Keep all changes in activity history. |
| Send / Resend | Send the secure link and log the event. Resend the existing assigned form; do not automatically create another record. |
| Form Templates sidebar | Show the Personal Tax, Business Tax, Bookkeeping, New Client and Custom quick entries. View All opens Frame 4. Menu actions use the same template rules as the full library. |
| Send Form to Client | Open Frame 2 directly; do not require the full builder. |
| View Form Submissions | Filter the main page to Submitted forms awaiting review. |
| Create Form Template | Open Frame 1 in template-authoring context. |
| Manage Form Settings | Open Frame 5. |
| Pro Tip / Go to Automations | Open the existing Automations module; do not build a second automation engine inside Intake Forms. |

| Selection scope to confirm: The dashboard shows checkboxes but does not define a bulk-action menu. Preserve selection controls; confirm whether bulk send, reminders, reassignment or archive are in scope before adding them. Do not assume the Leads bulk workflow automatically applies here. |
|---|

FRAME 1 / 1 OF 2

# Create New Intake Form: structure

Basis: original section 3; Form Builder frame and subsequent layout direction.
| Area | Fields / behavior |
|---|---|
| Left: Form Details | Form Name and Service / Category are required. Include client-visible instructions, optional internal notes and default assigned staff where applicable. Internal notes must not appear in the recipient form. |
| Starting point | Support Create from scratch, Use existing template and Duplicate an existing form. The baseline examples include Personal Tax, Business Tax, Bookkeeping, New Client and Custom / Blank Form. |
| Center: Build Your Form | Tabs are Form Builder, Preview and Logic & Rules. Organize questions into sections; allow adding, editing, duplicating, deleting and drag-reordering sections. |
| Example sections | Personal Information, Address Information, Income Information, Deductions & Credits and Document Uploads are example Personal Tax content, not a fixed layout for every service. |
| Right: Add Questions | Allow selecting or dragging a question type into the chosen section. Show the section question counts from actual saved questions. |
| Layout adjustment | Keep one scrollable builder workspace. Make Form Settings collapsible; remove the redundant Need help / Browse Templates card. Keep top Save as Draft, Preview and Publish Form actions sticky while scrolling. |


## Question types that must be available

| Types | Required input behavior |
|---|---|
| Short Answer / Paragraph | Short and long text responses; display the authored label and instructions. |
| Email / Phone / Date Picker | Inputs appropriate to the named contact or date field. |
| Number / Currency | Numeric entry; currency is retained from the original instructions even though the tile is labeled Number. |
| Multiple Choice / Dropdown | Single selection from the author's configured choices. |
| Checkboxes / Yes-No | Multiple selections or a yes/no response as appropriate. |
| File Upload / Signature | File upload and signature/acknowledgment when enabled. |
| Section Break / Instruction Text | Organization and guidance; these are not answerable questions. |

FRAME 1 / 2 OF 2

# Question editing, logic and save actions

Basis: original section 3; Form Builder controls and Logic & Rules tab.
| Control | Required behavior |
|---|---|
| Question editor | Edit label, instructions and choices where relevant. Each question supports required or optional status, as specified in the original guide. |
| Required-field setting | The frame also shows Require all questions to be completed. Its relationship to per-question optional status must be confirmed; do not silently erase optional settings. |
| Reorder / duplicate / delete | Apply to the selected question or section. Duplicated items must be independently editable within the draft. |
| Logic & Rules | Support conditional questions as shown by the builder design direction. Exact rule operators and the condition editor were not drawn; confirm those controls before building a larger rules system. |
| Preview | Show the recipient-facing form with its instructions, ordering, required fields and enabled uploads/signature. Preview must not send the form or record a real client submission. |
| Form Settings panel | Include Require all questions, Allow file uploads, Require e-signature, Show progress bar, Set expiration date and Custom Success Message. Reuse corresponding firm-level defaults from Frame 5. |
| Save as Draft | Save authoring work without sending. Preserve editable form content and its draft state. |
| Save as Template | Retain this baseline capability even though the frame's top buttons do not show it. Route template creation through Frame 1 and the template library. |
| Publish Form | The new frame adds this action. Proposed meaning: validate and make the form available for use, without sending it to a recipient. Confirm this distinction from Save & Send. |
| Save & Send | Retain the original action: save the form and proceed to Frame 2 for recipient, delivery and message review. Do not send until the user confirms there. |

| New implementation clarification - confirm: Keep a saved version of questions and rules with each sent form. Editing a reusable template must not change previously sent forms. Validate missing labels/options and required settings before publishing; present errors beside the affected item. |
|---|


## Counts and example text

Calculate counters from the actual form. Do not hard-code the mockup question totals, character counters, service names, instructions or thank-you message. Character limits shown in mockups are examples until confirmed.
FRAME 2 / 1 OF 2

# Send Intake Form: prepare delivery

Basis: original sections 3 and 7; Send Intake Form frame.
| Step / panel | Fields and behavior |
|---|---|
| 1. Select Recipient | Provide Client and Lead tabs and a searchable recipient selector. Display selected name and saved email/phone. The original instructions also permit entering a new name plus email/phone when staff permissions allow. |
| 2. Select Form | Select Form / Template; show form name and question count. Preview Form opens a recipient preview without sending. |
| 3. Delivery Method | Offer Email, SMS and Client Portal as shown. Email is supported; SMS requires texting to be enabled. Portal delivery must respect existing client access. The frame shows one selected channel, not confirmed multi-channel sending. |
| Email | Use the recipient email shown in the card. Send a secure form link, not the completed answers as a normal email attachment. |
| SMS | Use the saved mobile number and the enabled texting integration. Confirm SMS-specific message formatting; do not assume the email subject field applies. |
| Client Portal | Deliver to the assigned recipient's secure portal. A lead without portal access needs an explicit supported access path; do not create portal credentials silently. |
| 4. Message & Settings | Show Subject and Message, due date, expiration date, optional assigned staff, Send Reminders with Edit Schedule, and Allow Client to Save and Continue. |
| 5. Review & Send | Show form, recipient, delivery method/address, due and expiration dates, staff, reminders and save/resume setting. Edits in earlier panels must update this summary. |
| Ready to Send / copy | Show the chosen delivery route and secure-link message. Include Send me a copy of the email only for email delivery; clarify the destination using the current staff account. |
| Send Form / Save as Draft | Send Form performs the confirmed delivery and creates the assigned form record. Save as Draft preserves the send setup but sends nothing. |

| Recipient privacy: Use only recipients and staff in the current firm. A lead/client selector is not permission to expose another person's form. The source requires a secure authenticated portal or secure tokenized link for recipient access. |
|---|

FRAME 2 / 2 OF 2

# Delivery, reminders and recipient progress

Basis: original sections 7 and 10; Frame 2 reminder, dates and save/resume controls.
| Event / control | System response |
|---|---|
| Successful send | Record form, recipient, assigned staff, chosen route and send time. Place the form in Sent / Not Started. Notify the assigned staff member and log the send. |
| Recipient opens / starts | Record the open event. Change to In Progress when the recipient starts the form. Preserve progress when Save and Continue is enabled. |
| Recipient saves / uploads | Persist permitted progress and uploaded files on that recipient's assigned form. Update Last Activity and activity history. |
| Submit | Validate required answers and enabled signature/acknowledgment requirements. Set Submitted; notify assigned staff and the firm master email, retaining the baseline notification rule. |
| Confirmation | Show the configured thank-you message. Use the configured post-submission redirect and confirmation notification where enabled. |
| Automatic reminders | Use configured intervals: the source examples include 3 days after sending, 1 day before expiration or custom intervals. Frame 2 Edit Schedule opens the reminder schedule, not another form record. |
| Manual reminder / resend | Send a reminder for the same form and record the action. A Completed form must not receive an incomplete-form reminder without an intentional reopen workflow. |
| Expiration / extension | Original behavior sets Expired after the configured deadline. Authorized staff may extend the date and resend without creating a new form. Preserve existing answers/history. |
| Delivery failure | Proposed handling: show a failed-send state and retry path; do not display Ready/Sent as proof of successful delivery. Final error labels are not specified in the mockup. |

| Dates require confirmation: The original guide uses a single response deadline; the Send frame has separate Due Date and Expiration Date. Proposed rule: due date triggers an overdue indicator/reminder; expiration closes recipient editing. Confirm how expiration applies after submission, while staff review is pending. |
|---|


## Shared reminder rule - implementation clarification

Stop incomplete-form reminders after submission, completion or expiration unless a form is intentionally reopened. Repeated Send clicks should not create duplicate forms or duplicate scheduled reminders. These are proposed safeguards for the displayed workflow, not additional approved automation types.
FRAME 3 / 1 OF 2

# Intake Form Detail / Submission View

Basis: original section 5; both detail mockups, including the revised Submission Review frame.
| Section / action | Required behavior |
|---|---|
| Header and breadcrumbs | Show Intake Forms > selected form > Submission Review. Include form title, client/lead, form name, service, lifecycle status, Date Sent, Submitted date/time and Assigned To. |
| Date variants | The earlier detail frame also shows Completed Date and Due Date. Preserve these as record details; completion date refers to the staff-complete event under the original definition. |
| Overview | Summarize submitted information, documents, notes and review progress. It is not a separate record from the other tabs. |
| Responses / Form Responses | Show every configured question and response organized by the form's saved sections. Support expanded/collapsed sections and Expand All. |
| Documents | Show submitted files, receipt/upload date, related question and permitted file actions. View All opens the full file list for this form. |
| Notes | Show internal notes with author and timestamp; Add Note appends a note linked to this form. Do not expose staff-only notes to the recipient. |
| Communication(s) | Show form-linked sends, reminders and messages. The mockups use singular and plural labels; select one final label consistently. |
| History | Show chronological sends, opens, saves, uploads, submissions, review, assignment and status events with actor/time. |
| Appointments / Tasks | These tabs appear in the earlier detail frame but not the revised frame. Retain access to linked appointments and tasks; confirm whether they remain tabs or move to More Actions. |


## Review and communication controls

| Control | Result |
|---|---|
| Export PDF / Download PDF | Export the selected form submission and permitted responses. These are alternate labels for the same capability. |
| Request Revision / Request Changes | Start an intentional reopen/correction workflow. Keep submitted answers read-only until that action; identify what needs correction. |
| Mark Reviewed / Mark Complete | Mark a reviewed/accepted Submitted form Completed; store staff identity and time. Confirm whether Mark Reviewed is the final completion action or a separate review step. |
| Send Follow-Up / Send Message | Open the existing communication workflow linked to the form/recipient. Reminders, resends and follow-ups are distinct purposes. |

FRAME 3 / 2 OF 2

# Submission sections, files and activity

Basis: revised Intake Form Details frame; earlier detail quick actions; original review/privacy requirements.
| Panel | Content and behavior |
|---|---|
| Personal Information | Display form responses such as name, filing status, date of birth, masked identifier, phone and address. Do not hard-code these fields for non-tax forms. |
| Dependents | Display the submitted repeatable dependent records, relationship and date of birth. Count comes from actual responses, not the example row. |
| Income Documents | Summarize submitted income categories and amounts, including missing/not-provided responses; link relevant uploaded files where present. |
| Deductions & Credits | Display the actual yes/no answers and amounts submitted. Do not infer eligibility or convert missing answers into No. |
| Bank / Refund Information | Display provided refund method and bank details; the mockup masks the account number. Do not expose full sensitive values in the default overview. |
| Submission Summary / Progress | Calculate completion from answerable questions and required uploads. View Form opens the response view. Ready for review corresponds to Submitted under the original instructions. |
| Uploaded Documents | File list with type, name, upload time and menu. Keep files connected to this submission and available through Documents; examples such as W-2 or license are not mandatory for every form. |
| Internal Notes / Activity Timeline | Add Note records staff/time. View All opens Notes or History respectively; Show More expands timeline entries without creating another history store. |
| Earlier quick actions | Retain Resend Form, Send Message, Schedule Appointment, Download PDF and Archive Form, whether in the quick-action bar or More Actions. Use existing appointment/communication modules. |

| Edit controls versus submitted responses: The revised frame shows Edit links on response panels, while original section 5 specifies read-only submitted answers unless intentionally reopened for the client. Do not implement silent staff overwriting. Confirm whether Edit requests a client revision or creates a separately audited staff amendment. |
|---|


## Proposed revision handling - confirm

Request Revision should capture the requested corrections, notify the recipient and preserve the prior submission. Re-submission returns to Submitted for review. Whether to use a separate Changes Requested status or an In Progress record with a revision flag is not decided in the provided materials.
FRAME 4 / 1 OF 1

# Form Templates library

Basis: original section 6; Form Templates frame.
| Area | Required behavior |
|---|---|
| Top actions | Create Template opens Frame 1 in template context. Import Template is shown, but supported formats and mapping rules are not specified; confirm before implementing import. |
| Summary cards | Total Templates, Most Used, Custom Templates and Recently Updated. Recently Updated uses the last 30 days in the mockup. Define what the Most Used count represents before coding it. |
| Category tabs / filters | All Templates, Personal Tax, Business Tax, Bookkeeping, Payroll, Advisory and Client Onboarding filter the same library. Search by template name and use More Filters for supported criteria. |
| Template cards | Show name, question count, category, description, last updated, usage count and associated staff. Confirm whether the pictured staff member is owner, creator or last editor. |
| Included examples | Personal Tax Intake, Business Tax Intake, Bookkeeping Intake, Payroll Setup, New Client Intake, Tax Planning Discovery, Audit Support Intake and Custom Advisory. Keep Custom / Blank Form creation available. |
| Preview / Edit | Preview displays the template without sending. Edit opens Frame 1 with the saved questions/settings. Template edits must not change previously sent historical forms. |
| Use Template | Open Frame 2 with the selected template prefilled for sending. Use existing template within Frame 1 remains the path for authoring a customized form. |
| Card ellipsis menu | Provide original View, Edit, Duplicate, Archive and Send capabilities. Duplicate creates an independent reusable copy; archiving must not erase past submissions. |
| Template Categories sidebar | Show enabled categories and live counts; selecting a category filters the library. View All exposes all categories, not another copy of the template data. |
| Recently Used sidebar | Show templates and relative last-used dates from actual usage. View All expands the recent-use view. |
| Quick Actions / Pro Tip | Create Template, Preview Template, Duplicate Template and Template Settings use the same workflows as card actions. Preview/Duplicate require a selected template. Go to Intake Forms returns to Main. |

| Template details to confirm: Import file types, usage-count definition, Most Used ranking threshold and the scope of Template Settings are not fully specified. Proposed scope: settings for a selected template override eligible firm defaults only for future assignments. |
|---|

FRAME 5 / 1 OF 3

# Intake Form Settings: defaults and experience

Basis: original sections 3 and 8-9; Intake Form Settings frame.
This is one firm-level settings workspace. General, Client Experience, Notifications, Automation, Submission Rules, Branding, Security & Compliance and Integrations are settings categories, not separate Intake Forms modules.
| Control / section | Required behavior |
|---|---|
| Save Changes / Save Settings | Both save permitted settings for the current firm. Keep unsaved edits distinct from saved values; record changes in Recent Changes/history. |
| Preview Client View / Preview Form | Display a sample recipient form using the selected settings. Client Preview / View Full Preview opens the larger preview; do not send a real form. |
| Reset Defaults | Frame shows this action. Proposed safeguard: confirm before replacing customized settings; do not reset other modules or other firms. |
| Top status cards | Active Settings, Email Reminders, Automation Rules and E-Sign indicate current configuration. Mockup counts, percentages and trends are not approved definitions. |
| General Settings | Default form expiration, Allow save and resume, Require e-signature, Auto-generate submission ID and Assigned owner. Values shown (such as 14 days and Intake Team) are examples. |
| Client Experience | Show progress bar, Allow mobile-friendly view, Custom thank-you message, Redirect after completion and optional Redirect URL. Confirm destination before enabling redirect; do not use the mockup URL. |
| Form-level settings | The builder and send screen also expose save/resume, reminders, signature, dates and success messages. Proposed order: start with firm defaults, apply template/form settings, then apply any permitted per-send override. |
| Mobile presentation | The frame shows a mobile-friendly setting; the supplied design direction requires a usable mobile recipient experience. Clarify that turning off an optional mobile presentation must not make the form unusable. |

| Scope clarification - confirm: Apply changed defaults to future drafts/assignments unless staff deliberately updates an existing assigned form. The sources do not authorize silently changing existing expiration dates, required questions or signature conditions in forms already sent. |
|---|

FRAME 5 / 2 OF 3

# Notifications, automation and submission rules

Basis: original section 7; Settings notification and automation panels; Submission Rules navigation label.
| Category / control | Required behavior |
|---|---|
| Notifications & Reminders | Include Send confirmation email to client and Notify assigned staff member. Retain the original requirement to notify assigned staff and the firm master email after submission. |
| Reminder defaults | First reminder after, Final reminder after and Expiration alert. The frame examples are 3 days, 7 days and 24 hours before closing; they are configurable examples, not hard-coded rules. |
| Test Reminder Email | Send a clearly identified test to an authorized staff test destination. It must not change a real recipient's status or trigger their reminder sequence. |
| Auto-create client record | This toggle appears in Frame 5. Its trigger and relationship to Leads conversion are not defined. Confirm before enabling automatic lead-to-client creation; reuse/link existing client records where appropriate. |
| Auto-create follow-up task | Create a linked task through Tasks when its approved trigger occurs. Confirm whether the trigger is submission, review/completion or another event. |
| Route by service type | Use configured service/owner routing. Confirm precedence between a manually assigned owner, service routing and the default follow-up owner. |
| Default follow-up owner | Select an eligible firm staff/team owner. Do not hard-code Operations Team from the example. |
| Automation navigation | Go to Automations opens the existing module. Intake settings should reference shared rules, not create overlapping schedules that send duplicate reminders. |
| Submission Rules | This category is listed but no separate contents frame was provided. Cover baseline required-field checks, enabled acknowledgment/signature, read-only submission, review/completion, expiration and revisions. Additional rule controls need confirmation. |


## Proposed operational safeguards - confirm

A submission or completion event should trigger each configured task/notification once. Existing client/lead links must be checked before automatic creation. Failed messaging or integration jobs should show a retryable error rather than pretending that a notification or task exists.
| Do not treat sample toggles as approval: The Settings mockup has several automation switches On. That is a visual example, not a decision that every new firm should auto-create clients, require signatures or run six rules by default. |
|---|

FRAME 5 / 3 OF 3

# Branding, security and connected settings

Basis: original sections 8-9; Settings panels, sidebar and quick actions.
| Category / panel | Fields and behavior |
|---|---|
| Branding | Show firm logo, primary button color, accent color and Use this branding on client-facing forms. Use the selected firm's branding, not a fixed LVP Pro logo or palette for every customer. |
| Security & Compliance | Frame shows Enable encrypted file uploads, Accepted file types, Max file size per file and Consent checkbox required. Preserve the baseline requirement for secure answers/uploads and no ordinary public links. |
| File types and limits | PDF, JPG, PNG and 20 MB are examples shown in the frame. Make the approved allowed types/limits explicit and show helpful upload validation; do not treat the mockup values as universally approved. |
| Signature / consent | Use enabled signature/acknowledgment and consent controls as configured. The source does not define legal consent wording, signature provider or retention period; those require separate approval. |
| Integrations | A category is present but no detailed panel was created. Link to or surface existing enabled delivery, document, portal, signature and automation services needed by this workflow; exact providers/configuration fields remain open. |
| Settings Checklist / View All | Show actual configuration checks with links to the relevant category. Do not display Ready to use or Security configured solely because a sample toggle is On. |
| Recent Changes / View All | Show changed setting, actor and timestamp. Open a detailed settings-change history rather than the recipient submission timeline. |
| Client Preview | Use a sample form with current eligible branding and experience settings; View Full Preview opens the larger view. |
| Manage Templates | Return to Frame 4. Template Settings must be distinguished from these firm-wide settings. |
| Edit links | Each General overview card's Edit opens its matching category or editing panel, preserving the shared settings record. |

| Security conflict to resolve: The mockup presents encrypted uploads as a toggle; original section 9 requires secure storage. Recommended interpretation: encryption is enforced and the interface reports its state, not an option to store sensitive files insecurely. Confirm the wording/control design rather than implementing an unsafe Off state. |
|---|

SHARED REQUIREMENTS / PERMISSIONS AND RECORDS

# Access, history and module connections

Basis: original sections 5-10; links and related-data tabs in all frames.
| Requirement | Developer direction |
|---|---|
| Central staff permissions | Do not hard-code staff roles into Intake Forms. Check Staff Management / Settings permissions for viewing, building, sending, reviewing, exporting, archiving, template editing and settings changes. |
| Firm isolation | A firm can see only its own forms, templates, staff, clients/leads and submissions. Apply the same boundary to search, related tabs, exports and notifications. |
| Recipient access | Only the assigned client/lead may access their form, through the secure authenticated portal or secure tokenized link described in the source. |
| Sensitive responses / uploads | Use secure storage and avoid ordinary public links. Preserve masked identifiers in default detail views. Export/reveal privileges and retention settings need approved rules. |
| Audit trail | Log sends, resends, reminders, opens, saves, uploads, submissions, staff reviews, completion, assignments, status/expiration changes and settings changes with actor/time. |
| Shared form record | Dashboard rows, detail tabs, chart, notifications and reminders refer to the same assigned form. Templates are reusable definitions; edits must not rewrite historical assigned forms. |
| Clients / Leads | Use existing recipient records and profile links. Forms sent from a Lead Profile must remain available when that lead links or converts to a client, without duplicating submissions. |
| Documents / Communication | Keep form-linked uploads and sends accessible from the form and the corresponding existing modules, subject to permissions. Do not create disconnected copies of the same history. |
| Appointments / Tasks | Use the existing modules for linked schedule actions and follow-up tasks. Resolve ownership within the current firm. |
| Automations / Templates / Settings | Use shared workflows and centralized permissions; changes here must not change unrelated firm settings or duplicate scheduled jobs. |

| Implementation clarification: The sources specify the access and history outcomes, not the technical storage schema or vendor stack. Implementation details, retention periods, full-identifier reveal rules and external integration credentials still require approved designs. |
|---|

ALIGNMENT REGISTER / DECISIONS REQUIRED

# Resolve these differences explicitly

This register preserves the source and records where the mockups do not fully define behavior.
| Issue | Source difference / decision needed |
|---|---|
| Brand name | Document says Firmivra; frames show LVP Pro and LVP Accounting & Taxes. Confirm final platform identity and tenant branding. This document retains its supplied Firmivra title. |
| Submitted / Completed | Original: Completed means staff reviewed/accepted. Detail frames: Completed can appear alongside Ready for review and Mark Reviewed. Keep the original lifecycle pending sign-off; do not mark complete automatically on submission. |
| Staff Edit controls | Baseline makes submitted responses read-only. Revised detail panels show Edit links. Confirm revision request versus audited staff amendment; no silent overwriting. |
| Due date / expiration | Original describes a response deadline; Send shows two dates. Decide which date locks responses and how already-submitted forms behave while awaiting staff review. |
| Required questions | Original permits required/optional per question; builder shows Require all. Define whether that switch sets defaults or intentionally changes every question, including conditional ones. |
| Publish / send / draft | Builder has Publish Form; source has Save as Template and Save & Send. Confirm publish makes a form reusable without sending, draft visibility, and the exact template-save action. |
| Automation / security | Confirm auto-client creation trigger, duplicate handling, routing precedence and reminder stopping rules. Confirm encryption is mandatory rather than a disableable protection. |
| Metrics / sample content | Dashboard status counts and detail question counts are inconsistent across mockups. Settings growth percentages, Most Used counts and character limits lack definitions. Use real values after definitions are approved. |
| Undrawn panels | Import Template, detailed conditional logic, Submission Rules, Integrations, checklist detail and some More menus have no complete panel design. Implement only documented scope; confirm any additions. |
| Tabs / labels | Earlier detail includes Appointments/Tasks; later one omits them. Confirm final placement. Standardize Communication(s), Export/Download PDF, Request Revision/Changes and Mark Reviewed/Complete. |

These items do not require new pages for every status. Resolve labels and behavior within the six-screen module and its existing dialogs/panels.
ACCEPTANCE CHECKLIST / COMPLETE MODULE

# Developer handoff and completion checks

Verify the main dashboard plus Frames 1-5 together before marking the module ready.
| Area to verify | Expected result |
|---|---|
| Main dashboard | Search, filters, tabs, counts, chart and pagination use the same firm-scoped data. Client and form links open the correct existing records. |
| Builder | Each supported question type, sections, ordering, required/optional rules, eligible uploads/signature, draft/template saves and preview work. Confirmed logic rules behave correctly. |
| Send workflow | Client or lead, template, valid enabled channel, message, owner, dates, reminders and save/resume are reflected in Review & Send. Draft sends nothing; actual send logs the event. |
| Recipient flow | Secure access, save/resume, upload, validation and submission work on mobile. Success message/redirect use firm settings; internal staff notes stay private. |
| Review workflow | Submitted answers are read-only; files, notes, communication, history and linked tasks/appointments resolve. Revision preserves history; completion records reviewer/time. |
| Templates | Preview, use, edit, duplicate, archive, categories, recent-use links and menu actions work. Existing sent forms retain the template version used when sent. |
| Settings | All eight categories are accounted for. Save, reset confirmation, test reminder, full preview, checklist and recent-change history work within approved scope. |
| Notifications / automation | Staff and master-email notifications match source rules. Reminder timing, expiration extension, service routing and follow-up task creation follow the confirmed rules. |
| Permissions / isolation | Test permitted and denied staff actions, cross-firm isolation and recipient-only access to answers/files, including exports and related tabs. |
| Empty / error conditions | Proposed checks: no forms/templates, invalid recipient, failed send/upload, expired link, missing integration and unsaved edits have clear recovery paths; no silent data loss. |


## Coverage of the original instructions

Original sections 1-2: pages 2-3. Section 3: pages 4-7. Sections 4-5: pages 3 and 8-9. Section 6: page 10. Section 7: pages 7 and 12. Section 8: pages 3 and 11-13. Section 9: pages 13-14. Section 10: pages 1, 7-9 and this checklist.

## Source set used for this revision

Supplied file: Firmivra_Intake_Forms_Module_Developer_Instructions(2).docx, 3 pages, sections 1-10. Visual sources: Main Intake Forms dashboard; Frame 1 Form Builder; Frame 2 Send Intake Form; both Frame 3 detail/submission variants; Frame 4 Form Templates; Frame 5 Intake Form Settings. No additional unseen frames are assumed.
Intake Forms: Developer Review Update
October 20, 2026 | Consolidated review and resume checkpoint
Apply this update alongside the preceding baseline. Explicit decisions below supersede conflicting proposals in the baseline. PASS confirms only the stated observed behavior, not end-to-end readiness. Overall module status: FIXES REQUIRED / PENDING LIVE TEST.

# Confirmed checks

1. PASS | Builder settings
Allow File Uploads (including Off), Require Signature, expiration and Success Message retained changes after draft save and refresh. Draft saving also worked on the template whose Publish action failed. Other builder requirements remain in the baseline; do not repeat completed checks unless affected by changes.
2. PASS | Notification settings
Send confirmation email to client and Notify assigned staff member retained changes after save/refresh. First reminder, Final reminder and Expiration alert selections also persisted. Actual message delivery is not confirmed.
3. PASS | Automation settings
Auto-create client record, Auto-create follow-up task and Route by service type switches retained changes after saving and refreshing. Execution, triggers, routing precedence and duplicate prevention remain pending.
4. PASS | Branding
Branding Edit works. Primary color, accent color, logo and favicon changes were reported to save and persist. Client-facing preview opened and showed the branding.
5. PASS | Security settings
Accepted file types, an available maximum file size and Consent checkbox required saved and persisted. This does not verify upload enforcement or encryption.
6. PASS | Navigation and previews
Open Integrations navigated to Integrations. Manage Templates opened the templates dashboard. Annual Tax Intake Form and Business Bookkeeping Intake Form previews each opened the matching form.
7. PASS | Template search and send preparation
Annual Tax and Bookkeeping searches returned their matching templates. Send to a client opened; a dummy client was selected and the workflow reached Ready to send. Form, delivery method, message, due date, expiration, assigned staff, reminders and save/continue controls were available. Sending itself failed; see below.

# Required fixes and approved additions

8. FIX REQUIRED | Settings Edit controls
Notifications & Reminders Edit did not open editing. Earlier report described multiple overview Edit controls failing; verify each affected section individually. Branding Edit later worked, so do not report all Edit controls as broken. Direct controls that save are separate from the Edit-link defect.
9. FIX REQUIRED | Additional notification recipients
Add Notify additional emails under Notifications & Reminders, with editable recipients and persistence. It was not visible on the overview and could not be checked inside the nonworking Edit panel. Preserve the baseline assigned-staff and firm master-email notification requirements.
10. FIX REQUIRED | First and Final Reminder choices
Keep existing 3, 5, 7, 10, 14, 21 and 30 day options. Add 5, 10, 15 and 30 minutes; 1, 2, 3, 6 and 12 hours; 1 and 2 days to BOTH dropdowns. Label the timing origin explicitly. Review direction is elapsed time after sending; verify scheduling and stop rules live. Final reminder must follow the first and must not run after completion/expiry.
11. FIX REQUIRED | Expiration Alert choices
This specific list replaces the earlier proposal to use the First/Final Reminder additions here. Retain existing options (user reported 72, 42, 24 and 12 hours; verify the unusual 42-hour label). Add 10, 6, 5, 3, 2 and 1 hour, plus 30 minutes BEFORE expiration. Do not silently replace 42 with 48. Test scheduling against the actual expiration timestamp.
12. FIX REQUIRED | File-size limits
Retain 2, 5 and 10 MB; add BOTH 50 and 100 MB per file. Persist the selected limit and support it throughout upload handling. Show clear errors for oversized or disallowed files. Actual limit enforcement remains pending.
13. FIX REQUIRED | Encryption always on
Replace the unchangeable encryption switch with a read-only label: Encrypted file uploads - Always on. Encryption must remain enabled and cannot be disabled. This supersedes the earlier broken-toggle classification. Verify protection in transit and storage; a label or locked switch does not prove encryption.
14. FIX REQUIRED | Data retention period
Add Data retention period under Security & Compliance. Allow entry of a custom number of years rather than a fixed short list. Save via Save Settings and retain after refresh. Define the retention starting event, affected records/uploads and end-of-period behavior before implementing deletion. Do not auto-delete merely because a duration was selected.
15. FIX REQUIRED | Submission Rules shortcut
Go to Settings returns to the General tab inside Intake Forms instead of opening the relevant submission-rule settings. Correct the destination. Settings itself can be reached separately; the defect is the shortcut route. Submission-rule testing is blocked.
16. FIX REQUIRED | Test Reminder Email
Initial click reported Test reminder emails are not available yet; later click produced no useful action. Implement an actual test to an authorized test destination, with meaningful success/failure feedback. Do not change recipient status or trigger a real reminder sequence. No email delivery has passed.
17. FIX REQUIRED | Publish validation and distribution
Publish shows Check highlighted items, then save (also described as Check the highlighted fields), but highlights no fields. Identify each invalid field with a specific inline error, bring the first into view and preserve entries. Draft save works. Publishing must generate a shareable URL usable behind a website button and website embed code, each with Copy. Draft save must not publish or generate active distribution access. Publishing and copying remain untested.
18. FIX REQUIRED | Template counts, drafts and missing copies
Screenshot: 8 total, 6 custom, 8 recently updated; categories Personal Tax 6 and Bookkeeping 2. All Templates showed only one of each; individual categories also showed one. All Statuses + Apply Filter and refresh did not reveal more; no pagination/load-more was reported. Total later reached 10. Duplicate increased the count but the copy stayed absent after refresh. Starting templates may create untitled drafts, but cause is unconfirmed. Reconcile metrics and lists from the same real dataset; expose saved drafts and duplicates for resume, rename and permitted removal. Do not count usage as template quantity: Used 6 times is usage. The earlier oral nine-active figure was not confirmed by the screenshot.
19. FIX REQUIRED | Actual Send to client failure
Email was selected for a dummy client using an email controlled by the reviewer. Clicking Send returned Something went wrong. Try again in a moment. No email was found in inbox or spam at the check. Investigate validation, publication eligibility, record creation and delivery; expose actionable errors and avoid duplicate sends on retries. Do not mark successful delivery from reaching Ready to send.

# Pending live tests and completion criteria

20. PENDING LIVE TEST | Publish and distribution
After fixing validation, publish a complete test template; confirm saved published state, shareable URL, embed code, Copy actions and correct form access. Template-card previews passed; builder live preview without submission still needs its own confirmation.
21. PENDING LIVE TEST | Delivery and recipient workflow
Send once to the controlled test recipient; verify confirmation, received email, correct secure link and the assigned form record/status/history. Then test start, save/resume, uploads, required questions, consent/signature, mobile behavior, submission, success message/redirect and staff review/completion.
22. PENDING LIVE TEST | Reminders and notifications
Verify first/final reminders and expiration alerts at configured times, correct recipient/staff/additional addresses, test email delivery and clear failures. Verify no reminders after submission/completion as appropriate; expiration changes reschedule correctly. Confirm precise stop rules before sign-off.
23. PENDING LIVE TEST | Automations and security
Verify approved auto-client/task/routing triggers, no duplicate clients/tasks/jobs, staff ownership, encrypted transfer/storage, file-type and 50/100 MB enforcement, firm/recipient access boundaries and retention behavior.
24. PENDING LIVE TEST | Remaining baseline checks
Keep unverified baseline actions pending: archive/restore behavior and historical records, import, template use/version isolation, review/revision/export, permissions, checklist/history links, reset/unsaved-change handling and lifecycle/count reconciliation. Their presence in the baseline is not a PASS.

# Resume here

Review paused after confirming both template searches. Do not repeat successful settings/preview/search checks unless a fix affects them. Developer should first repair publishing, sending/test email, missing template/draft/duplicate visibility and Submission Rules navigation, then implement the approved settings additions.
Resume with a complete test template: verify publishing and distribution, send to the controlled test email once, confirm receipt and secure access, then perform the recipient submission, reminders, notifications and automation tests above. Overall status remains pending live testing; the module is not approved as complete.
