# R55: Templates API

Notes for step 5 (Templates). Steps 1 to 4 are in `R55-catalog-documents-api.md` and `R55-tasks-api.md`.

## Steps

- [ ] 5. Templates (the message-template library: categories, templates with versions, attachments, sharing, favourites, uses, branding, custom merge fields, the 48 starter templates). 5a [x]: contract (`packages/types/src/templates/`, `createTemplatesClient` as `api.templates`). 5b: API.

## Progress

- 2026-10-17: step 5a, the Templates contract: summary page (tabs, category cards, recent), the library query, template detail with versions, attachments (the documents upload ticket), shares, favourites and automation impact, preview and test send, bulk actions, categories (reorder, merge), merge fields (built-in and custom), Branding & Letterhead, HTML and text import, and the starter templates. Compliance was reassigned to another session; a draft of its contract is on the local branch `rasel/R55-compliance-contract` (not pushed).

### Templates (step 5)

1. **Delete**: the app role may not delete templates, categories or their versions (grants are select, insert and update), and sends keep the version they used. The contract offers archive and restore only; the guide's "Delete where there is no usage" is not available.
2. **Active automations**: the contract has `automationCount` and `confirmAutomationImpact`, but no table links an automation to a template (rule versions hold their steps as data). Until Automations has its API the count reads 0.
3. **DOCX import**: the contract takes HTML and plain text; a .docx must be converted by the screen first.
4. **Merge fields from live data**: built-in Client, Company, Staff and Custom fields resolve in the first API; Appointment, Invoice, Tax and Workflow fields resolve when the record id is given, and are reported as unresolved otherwise.
