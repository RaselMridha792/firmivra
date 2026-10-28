# Octavia's review of Templates (28 Oct 2026): change list

Source: Templates "Developer Feedback" report, evidence dated 28 Oct 2026, DEV app, Owner session only. Report codes are kept in each item: TF-01 to TF-17 (consolidated findings), TP-nnn (original-guide items), T-nn (execution register), gate names (visual, permissions, delivery, history, dependency, seeds, upload, structure, crossmodule, scale, sanitize, categories, custom, branding). It is a first review, not full acceptance; Review 2 follows.

## Summary

1. Counts: RED 66 source items (17 consolidated findings = 18 F items below, plus the 48 named starters inside TP-F18); YELLOW 51 partial + 24 not run source items, grouped into 18 Y items; GREEN 23 source items.
2. F items: 18 (TP-F01 to TP-F18). Y items: 18 (TP-Y01 to TP-Y18).
3. Highest priority: TP-F18 (seed the 48 starters), TP-F06 (valid PNG/PDF uploads fail), TP-F08 (type-specific structures for 5 kinds), then TP-F04 (Preview ignores unsaved edits), TP-F17 (category rename fails) and TP-F13/TP-F14 (archived and Draft Use dead ends).
4. Database change likely: TP-F08 only (structured content for Document Request, Intake, Task, Tax Workflow, Bookkeeping). Check first: `TaskTemplate`, `DocumentRequestTemplate(+Item)`, `IntakeTemplate` already exist. TP-Y11 may need a version reference on usage (`MessageTemplateUse` already holds `version`; to check). All other items: no, to check.
5. Roles and permissions: TP-F13 (server-side rejection of Use on archived or Draft templates), TP-F10 (archive confirmation applies to whoever may archive), TP-Y09 (non-owner role fixtures and deny/allow tests). No new role is created and no permission is widened.
6. Required by the report beyond the 17 findings: help and info icons on every functional area (TP-F02); this is a user addition, not an original-guide gap.
7. Optional items (create kind chooser, expanded filters, metadata ease) are kept as Y items with a default and are not built unless we choose to.
8. Where the report asks Octavia for an authorization, approval or fixture, we chose a default and marked it "Default". Nothing needs a reply from her to start work.
9. Existing code to check first: `apps/web/src/app/firm/(workspace)/templates/` (screens and `_components`), `apps/api/src/templates/` (service, starters, categories, attachments, render). `template-starters.ts` already holds 48 starters with an `install()` flow, but names and categories differ from the 48 required below; reconcile instead of adding a second source.
10. Safety: the QA footprint listed in TP-Y18 stays untouched until Review 2. No item sends, calls, signs or runs anything; tests use the dev sinks (Mailpit, `SMS_MODE=log`).

Confirmed (green, narrow, keep as is): sidebar, Templates highlight and desktop navy/blue/white/gold pattern (TP-009 to 011); overview title, header controls, Create, four views, search and category filter, kind cards, Tools, Quick Tips (TP-014 to 017, 019, 020, 022); metadata, subject and tokens, version/actor/date display (TP-024, 025, 034); empty-save validation; private draft edit persistence; merge insertion and saved-sample preview; tags and combined filter; duplicate; archive and restore of own copy; import modal; SMS plain text and counter; Task editor inventory; Categories and Branding dialogs open and cancel; merge catalog groups and all source tokens present (TP-072 to 078); unknown-token warning; .txt attachment rejection; Portal Message picker inclusion and exclusion; HTML and plain-text imports; own favorite and bulk tag; category create, reorder, merge, archive; retained-data safe state.

## A. Cross-cutting (all Templates screens)

| ID | Source | Screen / route |
| --- | --- | --- |
| TP-F01 | TF-02, Back and same tab; T-03, T-08 | Overview `/templates`, Library `/templates/library/[kind]`, editor `/templates/new` and `/templates/[id]/edit` |

**TP-F01 Return to the originating context.** Observed: global Create, enter dummy text, Cancel lands in Email Library instead of the overview; filtered Email Library, Edit, browser Back clears query, Draft status, tag and Name sort. Build/fix: stay in the same tab; provide Back to results; restore origin, view, query, status, category, owner, tag, sort, page and scroll on Cancel, breadcrumb, browser Back, preview close and a failed handoff (also TP-F14 Use rejection). Reuse the shared origin-link pattern if the app has one. Schema? No, to check (state in URL/session).

| ID | Source | Screen / route |
| --- | --- | --- |
| TP-F02 | "Help and info icons" (required user addition) | All Templates areas |

**TP-F02 Help and info icons.** Observed: none exist. Build/fix: an information icon per functional area: overview, kind cards, library, filters, editor metadata/content, merge fields, attachments, preview/test, access, automation, import, branding, categories. Each shows a short explainer (purpose, required inputs, limits, expected result, consequences) on hover and keyboard focus, with a tap/click equivalent, accessible name, readable contrast and dismiss behavior. One shared component from `packages/ui`; copy lives in one place. Retest keyboard, touch, screen reader. Schema? No.

## B. Overview `/templates`

**TP-F03 Explain the category count.** Source: TF-06, TP-021; T-01, T-07. Observed: All Categories shows 0 while an uncategorized template exists. Build/fix: if it is a template total, count uncategorized templates; otherwise label it as a number of categories. Default: relabel as "Categories" count and show uncategorized in the filter list, since the report allows either. Retest empty, uncategorized, categorized and archived records and count reconciliation. Schema? No.

Related overview item (Recent rows lack category and updated-by, TP-018) is handled in TP-F15.

## C. Create / edit template `/templates/new`, `/templates/[id]/edit`

**TP-F04 Preview current work.** Source: TF-01, TP-029; T-06. Observed: Preview shows the older saved body while the editor holds unsaved text, with no warning. Build/fix: render the current unsaved editor state; if not feasible, label it clearly as a saved-version preview with a warning (default: render current state). Retest subject, body, formatting and merge warnings without altering the master or sending. Schema? No.

**TP-F05 Protect unsaved work.** Source: TF-03, TP-035; T-03. Observed: Cancel after entering content discards silently. Build/fix: when dirty, warn on Cancel, breadcrumb and browser navigation with Stay and Discard; no warning when unchanged; no loss after Stay. Schema? No.

**TP-F06 Accept valid advertised files.** Source: TF-08, TP-028, TP-046, TP-153; T-23, T-24, T-25; gate upload. Observed: a valid 79-byte PNG and a valid 1400-byte PDF fail with "Something went wrong. Try again in a moment."; nothing persists after reload. Oversize probe also gives only the generic error. Build/fix: repair upload and storage (check `template-attachments.service.ts` and the web upload call first; no cause assumed); show actionable validation errors (type, size); support PDF, DOCX, XLSX, JPG, PNG up to the advertised 10 MB per file, boundary sizes included; secure references under the firm's prefix; preview/download; persistence across reload. .txt rejection stays. Retest with valid synthetic fixtures (the invalid 68-byte PNG and zero-buffer probe are not evidence). Schema? No, to check (`MessageTemplateAttachment` exists).

**TP-F07 Complete rich editing.** Source: TF-09, TP-026, TP-153; T-19. Observed: Insert image is disabled; no alignment; no CTA/button editing in rich editors. Build/fix: enable image insert, add alignment and a CTA/button control for rich kinds, keyboard accessible, save/reload and preview parity. SMS stays plain text. Schema? No.

**TP-F08 Real type-specific structures.** Source: TF-10, TP-049, TP-050, TP-054 to 056, TP-166; T-13, T-18; gate structure. Observed: Document Request, Intake and Organizer, Task, Tax Workflow, Bookkeeping use generic body text. Build/fix, per kind:
- Document Request: reusable requested-document list with secure upload CTA.
- Intake and Organizer: organizer fields and instructions that persist as structure.
- Task: internal checklist, due-date offsets, assignee rules.
- Tax Workflow: workflow/checklist by return or service type.
- Bookkeeping: recurring document requests, close checklist, client updates.
Structure must persist and instantiate safely downstream (retest instantiation, not just body text); preview and safe use exposed. Default for the rules the report asks Octavia to confirm: start from the existing task, document-request and intake structures already in the product and expose them in the editor; no new service or task rules are invented. Schema? Yes, likely: a structured content payload for these kinds on the template record, or reuse of existing `TaskTemplate`, `DocumentRequestTemplate(+Item)`, `IntakeTemplate` (to check first; needs Rasel's tap before any schema change).

**TP-F09 Expose Tax and Staff merge groups.** Source: TF-11, TP-027; T-20. Observed: editor tabs show All, Client, Company, Appointment, Invoice, Custom; Tax and Staff tokens exist only in All/catalog. Build/fix: add searchable Tax and Staff groups with cursor insertion at the focused field. Retest each group, focus target, search. The Workflow group is only an enhancement (see TP-Y03). Schema? No.

**TP-F10 Confirm archive actions.** Source: TF-12, TP-033; T-10. Observed: archiving the own duplicate archives immediately. Build/fix: confirm with template name and consequences before archive or delete; show known usage/dependencies; history preserved. Undo optional (default: not built, Restore already exists). Retest cancel vs confirm and the dependency warning on an inert referenced fixture (TP-Y12). Schema? No.

**TP-F11 Clear transition to Draft.** Source: TF-15, TP-032, TP-144; T-27. Observed: Active Portal Message set to Draft with Include in Automations ON fails with "This kind of template cannot be used in automations" (misleading). Build/fix: default is to permit Draft with the inclusion kept dormant (not offered to pickers while Draft); use status-specific validation and a correct message. Retest Active/ON to Draft and back; Draft stays absent from production pickers. Schema? No.

## D. Template library `/templates/library/[kind]`

**TP-F12 Truthful status labels.** Source: TF-04, TP-041; T-10. Observed: All Statuses hides the archived own copy; explicit Archived finds it. Build/fix: default is to rename the default option "Non-archived" (report allows including Archived instead). Retest each filter, count, reset and back-navigation state. Schema? No.

**TP-F13 Hide and enforce ineligible archived Use.** Source: TF-05, TP-146; T-10. Observed: archived row shows an enabled Use link (not clicked). Build/fix: disable Use with an explanation and enforce eligibility server-side so manual and automated use of an archived template is rejected; historical references remain. Schema? No.

**TP-F14 Avoid the Draft Use dead end.** Source: TF-16, TP-043, TP-069; T-32. Observed: Use on a private Draft email opens Communications in the same tab (`communications/new?channel=EMAIL&template=<id>`) then says "That template cannot be used here"; only Back to Communications is offered. Build/fix: disable Use for ineligible templates with a reason (default; no activate-from-here route); keep a return to Templates context after any rejection (see TP-F01). Eligible manual use is retested only with an approved safe fixture; no send. Schema? No.

**TP-F15 Required library metadata.** Source: TF-17, TP-018, TP-041; T-01. Observed: Recent rows omit category and updated-by; Email Library omits description and tags columns. Build/fix: show them directly, or via an inspectable details row, without hiding primary actions on responsive layouts. Retest populated, blank and updated states. Schema? No.

## E. Tools (Import, Categories)

**TP-F16 Offer DOCX import.** Source: TF-13, TP-137; T-11, T-28. Observed: Import offers HTML and Plain text only; no file input or DOCX. Build/fix: add DOCX where appropriate (default: rich-text kinds only, not SMS), state supported types and limits, sanitize imported content (allowlist), keep private draft defaults (Draft, Only me, automations OFF). Retest formatting, tokens, safe rendering. Adversarial sanitizer suite is TP-Y14. Schema? No.

**TP-F17 Category rename persists.** Source: TF-14, TP-139; T-31; gate categories. Observed: Save on rename returns "We couldn't find that. It may have been removed."; reopen shows the old name; repeat fails. Build/fix: diagnose and repair rename (see `template-categories.service.ts`, no cause assumed). Counts and references must survive rename, reorder, merge, archive. Schema? No.

## F. Seeds

**TP-F18 Seed all 48 editable starters.** Source: TF-07, TP-005, TP-082 to 136, TP-155; T-17; gate seeds. Observed: Owner All Templates showed two records, neither a seed; none of the 48 names exists. Build/fix: load all 48 into every firm (and DEV) as Active, editable, with correct kind and category, applicable subject/title, body, useful merge fields; no hard-coded client, staff, year, date, price or URL; confidential content points to the secure portal; engagement and formal-notice copy stays editable and unlocked. Reconcile against the existing `STARTERS` in `apps/api/src/templates/template-starters.ts` (same count, different names and categories) so there is one source; do not keep two lists. Check how `install()` is triggered (it should run at business setup, not only on demand). Acceptance: name-by-name reconciliation of the table below, editability by an authorized role, safe workflow availability. Schema? No, to check (`starter_key` already exists).

Type column below is our default proposal (the report says a category label is not automatically the right kind); confirm against the 16 kinds when reconciling.

| TP | Name | Type (default) | Category |
| --- | --- | --- | --- |
| TP-083 | New Client Welcome Email | Email | Email / Client Communication |
| TP-084 | Existing Client Welcome Back | Email | Email / Client Communication |
| TP-085 | Missing Documents Follow-Up | Email | Email / Client Communication |
| TP-086 | Document Received Confirmation | Email | Email / Client Communication |
| TP-087 | General Client Follow-Up | Email | Email / Client Communication |
| TP-088 | Client Portal Invitation | Email | Email / Client Communication |
| TP-089 | Tax Season Opening Announcement | Email | Tax Season |
| TP-090 | Tax Organizer Ready | Email | Tax Season |
| TP-091 | Tax Appointment Preparation | Email | Tax Season |
| TP-092 | Tax Documents Still Needed | Email | Tax Season |
| TP-093 | Tax Return Ready for Review | Email | Tax Season |
| TP-094 | Tax Return Signature Request | Email | Tax Season |
| TP-095 | Tax Return Filed Confirmation | Email | Tax Season |
| TP-096 | Extension Filed Confirmation | Email | Tax Season |
| TP-097 | Estimated Tax Payment Reminder | Email | Tax Season |
| TP-098 | Appointment Confirmation | Appointment | Appointments |
| TP-099 | Appointment Reminder - 24 Hours | Appointment | Appointments |
| TP-100 | Appointment Reminder - 1 Hour | Appointment | Appointments |
| TP-101 | Appointment Rescheduled | Appointment | Appointments |
| TP-102 | Missed Appointment / No-Show Follow-Up | Appointment | Appointments |
| TP-103 | Post-Appointment Follow-Up | Appointment | Appointments |
| TP-104 | Invoice Issued | Invoice and Payment | Invoices & Payments |
| TP-105 | Payment Due Soon | Invoice and Payment | Invoices & Payments |
| TP-106 | Payment Overdue - First Notice | Invoice and Payment | Invoices & Payments |
| TP-107 | Payment Overdue - Final Reminder | Invoice and Payment | Invoices & Payments |
| TP-108 | Payment Received / Receipt | Invoice and Payment | Invoices & Payments |
| TP-109 | Monthly Bookkeeping Document Request | Bookkeeping | Bookkeeping |
| TP-110 | Bookkeeping Records Missing | Bookkeeping | Bookkeeping |
| TP-111 | Monthly Books Completed | Bookkeeping | Bookkeeping |
| TP-112 | Quarterly Bookkeeping Review | Bookkeeping | Bookkeeping |
| TP-113 | Year-End Bookkeeping Checklist | Bookkeeping | Bookkeeping |
| TP-114 | Payroll Information Reminder | Payroll | Payroll |
| TP-115 | Payroll Completed Notification | Payroll | Payroll |
| TP-116 | Payroll Document / Employee Info Request | Payroll | Payroll |
| TP-117 | New Lead First Response | Lead Follow Up | Leads |
| TP-118 | Lead Follow-Up - No Response | Lead Follow Up | Leads |
| TP-119 | Consultation Reminder | Lead Follow Up | Leads |
| TP-120 | Post-Consultation Follow-Up | Lead Follow Up | Leads |
| TP-121 | Engagement Agreement Sent | Engagement Agreement | Engagement / Documents |
| TP-122 | Engagement Agreement Reminder | Engagement Agreement | Engagement / Documents |
| TP-123 | Document Signature Request | Email | Engagement / Documents |
| TP-124 | Secure Document Upload Request | Document Request | Engagement / Documents |
| TP-125 | New Portal Message Notification | Portal Message | Portal / Notices |
| TP-126 | Important Client Notice | Letters and Notices | Portal / Notices |
| TP-127 | Monthly Tax & Business Newsletter | Communication Campaign | Marketing / Campaign |
| TP-128 | Tax Deadline Reminder Campaign | Communication Campaign | Marketing / Campaign |
| TP-129 | Service Announcement / New Service | Communication Campaign | Marketing / Campaign |
| TP-130 | Standard Client Follow-Up Task Checklist | Task | Internal / Workflow |

One-line purpose per row is in the source report (TP-083 to TP-130 rows); seed copy follows it.

## G. Yellow items (decision, fixture or evidence from us; none needs Octavia to answer first)

**TP-Y01 Create kind chooser (optional).** Source: Create kind chooser; T-03. Global Create opens Email directly. Default: relabel the global action "Create Email Template" now; a searchable kind chooser is later. Type-library Create keeps its kind. Schema? No.

**TP-Y02 Expanded dropdowns (optional).** Source: Expanded dropdowns. Required filters (Search, Status, Owner, Tag, Sort) stay. Default: not built now: multi-select category/tag/owner, date ranges, access and automation filters, applied-filter chips, Reset, saved views. Selections must be preserved on return (covered by TP-F01). Schema? No (saved views would need to check).

**TP-Y03 Metadata and merge ease (optional).** Source: Metadata and merge ease. Default: build only the tag hint ("Press Enter to add") and keep an uncommitted typed tag from being lost on Save; do not add service, audience or locale fields; no hard-coded tax-year or date defaults; Workflow merge group kept as a later enhancement. Schema? No.

**TP-Y04 Announcement kind.** Source: Type specific functionality, Announcement. Extra exposed kind with common controls and no source contract. Default: treat as a rich-text announcement kind used from Communications campaigns, not offered to Automations, until the intended use is decided; no separate structure. Schema? No.

**TP-Y05 Type families, partial.** Source: TP-046 to 048, 051 to 053, 057 to 060; T-12, T-35. Email, SMS Text, Portal Message, Engagement Agreement, Invoice and Payment, Appointment, Payroll, Lead Follow Up, Communication Campaign, Letters and Notices have working basic editors but incomplete integration. Provide: harmless fixtures per kind; non-ASCII SMS segment cases; type-specific previews; letterhead output check for Letters and Notices (with TP-Y17); signature-workflow link for Engagement Agreement (no signing). Schema? No, to check.

**TP-Y06 Starter content rules.** Source: TP-131 to 136 (not run until TP-F18). After seeding, run the content review: concise, professional, editable, live branding/contact and neutral merge fields, configured deadlines, confidential content routed to the secure portal. Default: engagement and formal-notice starters ship Active and editable with a "firm should review" note inside the editor, not locked. Schema? No.

**TP-Y07 Cross-module pickers.** Source: gate crossmodule; TP-062, 063, 065, 066, 069 (partial), TP-064, 067, 068, 070, 071 (not run); T-26, T-33. Observed: Automation Send client message picker works; Create task action has no picker; Appointment new and Invoice new have no template selector; Tax link opens generic Templates; Lead Create Campaign saves a Communications draft. Default scope: add a type-filtered picker (Active, eligible only) to Appointment new, Invoice new, the Automation Create task action and the Tax checklist link; leave the Leads campaign step as is; provide named dummy appointment, lead, invoice, return, bookkeeping, payroll and document fixtures and a non-delivery mode; show live merge and version-use evidence. Schema? No, to check.

**TP-Y08 Visual and responsive.** Source: gate visual; TP-012, 013. The guide's three reference illustrations were not embedded. Default: compare against the Templates frames in `docs/mockups/firm-workspace/templates/`, and provide desktop, tablet and mobile screenshots (1440, 768, 390 px) or automated viewport evidence; responsive primary actions included. Schema? No.

**TP-Y09 Roles and permissions fixtures.** Source: gate permissions; TP-013, 023 to 036 permission parts, TP-143. Only an Owner session was tested. Default: seed least-privilege test users (Admin, Staff, plus a selected-user share case) in DEV with a permission matrix; seed private/team/shared template fixtures; add API deny/allow tests for create, edit, share, archive, delete, use, sensitive fields, tenant boundary and per-user favorites. No role or permission is changed. Schema? No.

**TP-Y10 Delivery sink.** Source: gate delivery; TP-030, 036, 064 to 071. Default: use the dev sinks only (Mailpit with `EMAIL_MODE=smtp`, `SMS_MODE=log`, no real recipients), synthetic recipients, with before/after evidence that master content, activity and template version are unchanged. Live merge resolution and the unresolved-field send gate are retested there. Schema? No.

**TP-Y11 History fixture.** Source: gate history; TP-147, 149 to 151. Default: seed one historical sent message/document/activity that references a known template ID and version, then edit and archive the template and assert the old rendered content, version, actor and time are unchanged. Usage-version logging checked on `MessageTemplateUse`. Schema? No, to check.

**TP-Y12 Dependency fixture.** Source: gate dependency; TP-149. Default: seed an inert active automation (transport disabled, no client-side effects) that references a QA template; show edit/archive/delete warnings and unbroken history. Feeds TP-F10. Schema? No.

**TP-Y13 Scale.** Source: gate scale; TP-045. Default: seed more than two pages of synthetic templates in an isolated DEV fixture and test server-side pagination, search and sort consistency. Schema? No.

**TP-Y14 Import security.** Source: gate sanitize; TF-13. Default: run an isolated sanitizer suite (unsafe markup and URLs, no external network or script effects) with sanitized-output assertions after TP-F16. Schema? No.

**TP-Y15 Category lifecycle with templates.** Source: gate categories; TP-038, 039, 043, 044; T-30. After TP-F17: populated category rename, merge, archive and reorder with own categorized fixtures; counts and references preserved; multi-row category/archive bulk actions with several own templates. Schema? No.

**TP-Y16 Custom merge field.** Source: gate custom; TP-079 to 081; T-16. Default: create a tenant-scoped custom field with key, label and fallback using a synthetic name prefixed "QA", with a dummy client context; test validation, permissions, live value and fallback resolution; remove it after the test. Schema? No, to check (existing custom-field setup).

**TP-Y17 Branding.** Source: gate branding; TP-141; T-15. Default: use a known synthetic Settings branding fixture (logo, legal name, contact, footer, signature) and verify propagation to preview and letterhead output across types without changing historical content. Schema? No.

**TP-Y18 Retained QA data and rollback.** Source: Retained QA footprint; version rollback paragraph. Do not delete or repurpose the retained fixtures before Review 2: SAL QA Email Draft 20261028 (01a18095-f9ce-77ef-bf3a-ec1928eb2b2a, v3), its archived Copy (01a1809b-6ac2-7003-b9fc-1ff6a95b2b11), SAL QA Portal Picker (01a180be-19f7-762b-b160-21010985cd26), SAL QA HTML Import (01a180c4-bacc-72ca-ab0e-2ef8aab22b91), SAL QA Text Import (01a180de-05c3-762c-9b22-845d0906dff3), and the two archived SAL QA categories. Version rollback is optional and not an original-guide defect. Default: not offered; restore of archived copies stays as is. Schema? No.

## H. Review 2 exit

Close TP-F01 to TP-F18 (including the required help icons), reconcile the 48 seeds name by name, run the applicable TP-Y gates with evidence and no unauthorized side effects.
