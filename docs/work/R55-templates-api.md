# R55: Templates API

Notes for step 5 (Templates). Steps 1 to 4 are in `R55-catalog-documents-api.md` and `R55-tasks-api.md`.

## Steps

- [x] 5. Templates (the message-template library: categories, templates with versions, attachments, sharing, favourites, uses, branding, custom merge fields, the 48 starter templates). 5a [x]: contract (`packages/types/src/templates/`, `createTemplatesClient` as `api.templates`). 5b [x]: API (`apps/api/src/templates/`: library, versions, sharing, favourites, bulk, preview, import, categories, merge fields, branding, attachments, 48 starters).

## Progress

- 2026-10-17: step 5a, the Templates contract: summary page (tabs, category cards, recent), the library query, template detail with versions, attachments (the documents upload ticket), shares, favourites and automation impact, preview and test send, bulk actions, categories (reorder, merge), merge fields (built-in and custom), Branding & Letterhead, HTML and text import, and the starter templates. Compliance was reassigned to another session; a draft of its contract is on the local branch `rasel/R55-compliance-contract` (not pushed).
- 2026-10-17: step 5b, the Templates API: library (summary, list with tabs and visibility, detail, create, change with versions and etag, duplicate, archive, restore, favourites, sharing, bulk), versions and restore, preview with sample or live data, test send (validated, not delivered), HTML/text import, 48 starter templates, categories, merge fields, branding and attachments. Tests: 26 e2e, 26 unit, isolation cases for every record route.

### Templates (step 5)

1. **Delete**: the app role may not delete templates, categories or their versions (grants are select, insert and update), and sends keep the version they used. The contract offers archive and restore only; the guide's "Delete where there is no usage" is not available.
2. **Active automations**: no table links an automation to a template (rule versions hold their steps as data), so `automationCount` counts ACTIVE, not archived rules whose current version's steps contain the template id as text. It is exact for ids stored in `actions`; when Automations has its API a link table would make it an index lookup.
3. **DOCX import**: the contract takes HTML and plain text; a .docx must be converted by the screen first.
4. **Merge fields from live data**: built-in Client, Company, Staff and Custom fields resolve in the first API; Appointment, Invoice, Tax and Workflow fields resolve when the record id is given, and are reported as unresolved otherwise.
5. **Test send**: the route validates the destination (the caller's own address or number only, 400 `TEST_SEND_REFUSED`) and then answers 503 `TEST_SEND_UNAVAILABLE`. Sending needs a Templates message in `NotifyService` (`notify.types.ts`, R6), which this session does not own. `TEST_SEND_UNAVAILABLE` is not in the contract's `TemplateErrorCode` yet.
6. **Attachments are not scanned**: `message_template_attachments` has no `scan_status` column, so confirm checks size, SHA-256 and that the bytes are what the type says (Office files with a password or macros are refused), but there is no GuardDuty gate before a download. A `scan_status` column (as `firm_agreement_files`) and a scan handler would close it. Until then attachments should not be sent to clients.
7. **Template names** are unique per kind among templates that are not archived, ignoring case, checked in the API (the database has no such index). Two saves at the same moment could both pass.
8. **Restore version** has no `confirmAutomationImpact` in the contract, so it never asks, though it changes the text automations use.
9. **Balance Due** is left unresolved unless the invoice is PAID: payments are not summed in the first version. **Payment Link** resolves for an OPEN invoice only.
10. **Category merge** answers the target category (with its new count); the archived source is read with `includeArchived`.
11. **Isolation suite**: the positive-control test now has a 180 s limit (it builds a world per write route; the 30 s default was reached with this module's routes).
