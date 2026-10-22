# Octavia's review of Oct 20, 2026: Intake Forms, Leads, Services & Pricing, Appointments (change list)

Source: Octavia's Fiverr note and Drive of Oct 21 (four folders): Intake Forms, Leads (plus a Settings supplement called "Confirm Checks"), Services & Pricing, Appointments. Guides are in this folder as markdown, one file per area (converted from her .docx). Her screenshots are in `docs/mockups/firm-workspace/review-2026-10-21/<area>/` (numbered 01.png and up, same order as the files in her folder).

More feedback is coming: she finishes her remaining reviews on Oct 22 and sends feedback for all areas of the three updates by Friday (Oct 23). Extend this file per area when it arrives.

How to read it:

- **P1**: a defect she hit while testing (error, missing page, data not showing). Do first.
- **P2**: a changed value or rule (options, limits, wording).
- **P3**: new or bigger flow she specified.
- "On main" is what was checked on origin/main on Oct 21 at 16:40 UTC. "Check" means the session that takes the item must look at main and dev first: her guides were written against an older dev build, and some items may already be fixed.
- Her guides say items marked PASS or "working in review" are provisional until live end-to-end tests pass. Do not break them, do not rework them.
- Everything she lists as **pending** (Reschedule, Cancel, delivery tests and so on) is a test for the session, not a defect. Record Pass, Fail or Blocked with evidence in the PR.
- Design completeness rule applies: complete screens, empty states, no fake numbers.

## How her business works (her clarification, Oct 21)

The intake form, the client portal and scheduling live on the **LVP Accounting website** and link into Firmivra. Firmivra lets firms like LVP connect them; the forms, client portals and appointments themselves live inside Firmivra. So the descriptions in the intake-form guides are LVP's, and other firms will use the same links for their own services. This is why every area below asks for **stable public links plus embed code with Copy buttons** (intake forms, appointment types, service packages): the firm puts the link behind a button on its own website.

Build this **once** as a shared "Copy link / Copy embed code" block (one component, one API shape for link and embed code per public item: form, appointment type, package) and reuse it in the three places. Inactive, archived or hidden items must refuse new public use.

## Her questions (reply drafted separately)

- Where does she review the client-facing part of Begin Online? Public pages, no login: `portal.dev.firmivra.com/lvp/begin`; six forms: `/lvp/begin/annual-tax`, `/bookkeeping`, `/business-development`, `/payroll`, `/quarterly-tax`, `/tax-planning` (apps/web `portal/[firmSlug]/(public)/begin/`). Submissions land in the firm's Intake Forms.
- Is it the test environment? Yes, dev.
- "Only 2 intake forms": Begin Online has six public forms in code. The firm's Intake Forms library lists templates per service and she saw one of each (Annual Tax, Bookkeeping). See I18 below.

## A. Intake Forms (guide: `intake-forms--developer-instructions-reviewed.md`, items 8 to 24)

| # | Change | Prio | On main |
|---|---|---|---|
| I1 | **Template library shows every form**: all six Begin Online forms (annual tax, bookkeeping, business development, payroll, quarterly tax, tax planning) exist as templates for every firm; counts (total, custom, recent, per category) come from the same rows as the list; saved drafts and duplicates stay visible (resume, rename, remove); "Used 6 times" is usage, not quantity (her item 18) | P1 | Check: library lists templates by service (`intake-library.service.ts`); she saw one per category |
| I2 | **Send to client fails** ("Something went wrong") with email to a controlled address: find the cause, show an actionable error, no duplicate sends on retry; show failed-send state (item 19) | P1 | Check |
| I3 | **Publish fails with no highlighted fields**: inline error per invalid field, scroll to the first, keep entries (item 17). Publish must also produce a shareable URL and embed code with Copy; Save as Draft never publishes (items 17, 20) | P1 | Check; no embed code on main |
| I4 | **Settings Edit links**: Notifications & Reminders Edit does not open; check every overview Edit individually (Branding Edit works) (item 8) | P1 | Check |
| I5 | **Submission Rules shortcut**: "Go to Settings" lands on General instead of the submission-rule settings (item 15) | P1 | Check |
| I6 | **Test Reminder Email** does nothing useful: send a real test to an authorized test address, clear success/failure, no change to any recipient (item 16) | P1 | Check |
| I7 | Notifications & Reminders: add "Notify additional emails" (editable, persists), keep assigned-staff and firm master-email rules (item 9) | P2 | Check |
| I8 | First and Final reminder options: keep 3, 5, 7, 10, 14, 21, 30 days; add 5, 10, 15, 30 minutes, 1, 2, 3, 6, 12 hours, 1 and 2 days to both; label "after sending"; final follows first, none after completion or expiry (item 10) | P2 | Missing (main has `firstAfterDays` in days only: `send/_components/schedule-modal.tsx`, `settings-cards.tsx`) |
| I9 | Expiration alert: keep existing 72, 42, 24, 12 hours; add 30 minutes and 1, 2, 3, 5, 6, 10 hours before expiry. Do not change 42 to 48 (item 11) | P2 | Check |
| I10 | File size per file: keep 2, 5, 10 MB; add 50 and 100 MB, saved and enforced in uploads (item 12) | P2 | Missing; 10 MB cap in `settings-model.ts:185`. 100 MB schema is in #995; the multipart uploader is R1's work in progress. Do this with it, same cap |
| I11 | Encryption: replace the switch with a read-only "Encrypted file uploads: Always on" label (item 13) | P2 | Check (main still shows a toggle) |
| I12 | Add "Data retention period" in Security & Compliance, custom number of years, saved. Define start event and end behavior before any deletion; selecting a period deletes nothing (item 14) | P2 | Missing |
| I13 | Live tests she asked for (items 20 to 24): publish and distribution, one send to her test address, recipient flow (start, save/resume, upload, signature, mobile, submit), reminders, notifications, automations, permissions, archive/restore, version isolation | Test | Pending, after I1 to I6 |

Also kept from the baseline (decisions she left open, do not guess; list them under "Needs from others" in the PR instead): Submitted vs Completed, due date vs expiration, staff Edit vs Request Revision, import template file types, auto-create client trigger.

## B. Appointments (guide: `appointments--developer-instructions.md`)

| # | Change | Prio | On main |
|---|---|---|---|
| A1 | **Multiple meeting methods** can be selected; on save failure highlight the exact fields with errors and keep values | P1 | Schema ready in #995 (`appointment_types.meeting_methods`, 1 to 3); API and screen to do |
| A2 | **Staff Availability save error**; show a conflict only when an appointment is really outside availability | P1 | Check |
| A3 | Booking Window options: add 2, 6, 12, 24 hours and 3, 5, 7 days; stays separate from Minimum Notice | P2 | Check (`calendar/types/_components/types-screen.tsx:455`) |
| A4 | **Copy Booking Link** and **Copy Embed Code** per appointment type; archiving stops new public bookings | P3 | Missing. Use the shared block (see top) |
| A5 | **Save Client** inline in the scheduling flow without losing scheduling details | P3 | Missing in calendar (only in Business Advisory) |
| A6 | Zoom link: aligned toggle, full-width link field with Copy button | P2 | Check |
| A7 | Several reminders per appointment type, each with Email, SMS and Portal choices | P3 | Check |
| A8 | Client confirmation after scheduling; reminders ask to confirm until confirmed, then only remind | P3 | Check |
| A9 | Service intake request tied to the service selected; completion recorded on the appointment | P3 | Check |
| A10 | Appointment type description is internal only (not in public booking views or client content) | P2 | Check |
| A11 | Pending tests: draft, reschedule, cancel, complete, no-show, recurring, reminder delivery, confirmation behavior, intake completion, staff status permissions | Test | Pending |

## C. Leads (guide: `leads--developer-review-package.md`; screenshots in `leads/`)

| # | Change | Prio | On main |
|---|---|---|---|
| L1 | **Lead name and More > View open "couldn't find"**; Overview does not load. Both must open the correct Lead Workspace | P1 | Routes exist under `leads/[id]`; the link target is wrong or the API returns 404: reproduce on dev |
| L2 | **SMS sending fails** ("Something went wrong"), single and bulk; show the saved recipient number before sending; accurate success/failure feedback and history | P1 | Check |
| L3 | Overdue Follow-Ups filter and card; past-due unfinished follow-ups in red and in the count | P1 | Check |
| L4 | Email composer: saved signature with logo, font family/size, bold/italic, inline image upload, placement and resize. Delivered formatting must be verified, not just the composer opening | P3 | Check |
| L5 | Tags: searchable existing-tag picker when applying to leads or clients; no duplicates | P2 | Check |
| L6 | **Add New Tag** button beside Add New Lead; one firm tag list shared by Leads and Clients | P3 | Check |
| L7 | **Create Campaign** beside Add New Lead and Add New Tag: same builder as Communications, in a modal or panel, Back to Leads keeps filters and selection. No automatic enrolment or sending on creation | P3 | Check |
| L8 | "+ Add Follow-Up" during lead creation: several steps, each with action, date/time and notes; edit and remove; Next Action shows the next unfinished step | P3 | Check |
| L9 | **Convert to Client**: fields inside the panel must be editable (address, business details, services, staff) before completion; carry forward source, campaign, tags, notes, appointments, communications, activity; no duplicates; lead is kept with status Converted | P1 | Check |
| L10 | **Archived Leads** under More Filters and a Restore action per record (permission-gated); restored lead returns with prior status and history | P3 | Check |
| L11 | **Only Firm Admin may delete leads** (single and bulk), enforced on the server and in the UI; others may archive where permitted | P2 | Check |
| L12 | Verify bulk Convert to Client, filters (source, service, status, staff, combined), search (name, email, phone, source, campaign, notes) with pagination, table columns, Schedule Appointment prefill, status list | Test | Pending |
| L13 | Website lead capture beyond the intake form (Shopify, GoDaddy, Wix, WordPress, others): list the supported methods, give test steps; Shopify presence alone does not confirm capture | P3 | Open: answer in the PR, do not guess platforms |
| L14 | Direct client creation without a lead first (she reported it unavailable): carried to the Clients review | P1 | Check on Clients |

## D. Services & Pricing (guide: `services-pricing--developer-review.md`; screenshots in `services-pricing/`)

| # | Change | Prio | On main |
|---|---|---|---|
| S1 | **Saving a service fails** ("Something went wrong") for Save as Draft and Save & Activate (Fixed Price $100 with category). Find the real cause, show actionable errors, keep entries, no duplicates on retry | P1 | Reproduce on dev |
| S2 | **Draft rules and visibility**: Draft saves incomplete work (no category required); Draft and All views, consistent counts, resumable copies. Duplicate must persist (it showed eight, then six after refresh) | P1 | Check |
| S3 | **Reactivate Bookkeeping fails**; restore it to Active, counts and audit consistent | P1 | Check |
| S4 | **Package archive**: Active, Inactive, Draft, Archived, All views and Restore; find and restore her archived test package | P1 | Check |
| S5 | Category empty state: explain the empty dropdown, "Add New Category" shortcut for authorized users | P2 | Check |
| S6 | Additive line-item pricing: base $100.50 plus $75 line item shows $175.50 immediately in additive mode; included mode never double charges | P2 | Check |
| S7 | Not Included entries appear in the client-facing detail; Internal Notes stay private | P2 | Check |
| S8 | **View Full Page** for a package (as in the baseline mockup), using current content and client options | P3 | Missing |
| S9 | Quote-required comparison: Total Selected Services must not show zero; show an explicit quote-required warning; optional extras do not inflate the included-service total | P2 | Check |
| S10 | Promotion validation: 101% and reversed dates reject with no highlight today; add precise inline errors, summary, focus first invalid field, state the 0 to 100 and date-order rules, also negative values | P1 | Check |
| S11 | Sorting by Service Name and Last Updated does nothing; Category, Pricing, Status too; indicators, filters preserved | P1 | Check |
| S12 | **Package booking link**: stable public URL per active, client-visible package, Copy Booking Link and embed code (shared block), opens the right firm with the package preselected; answer in the PR how a package maps to appointment type, staff, duration, availability, time zone, add-ons, and whether payment, quote or approval is required. Inactive, archived or hidden packages refuse new public bookings, history stays; reactivation restores the same link | P3 | Missing |
| S13 | Her test-record handoff: Bookkeeping Inactive, archived test package and the inaccessible draft/copy must be found and recovered; confirm valid promotion dates were restored | P1 | With S2 to S4 |
| S14 | Pending tests she listed (persistence, all price types, add-ons, discounts, usage, invoices keep a snapshot, permissions, isolation, keyboard and responsive) | Test | Pending |

## E. Settings "Confirm Checks" (supplement, in the Leads folder; file `settings--confirm-checks-supplement.md`)

Eleven checks (Overview, Users and Roles actions, ownership transfer, branding and login customization, branding across surfaces, security and access, data and backups restore, unsaved-change and conflict handling, isolation and audit, tab-to-page mapping, shared time zone/currency/language). They are **verification tasks**, not new features. For each, the owning session returns: Built, Partially built or Not built; exact page; test result; evidence; remaining work. Platform Administration is excluded. Owners: Overview, Locations, ownership transfer, branding: R56 and R60; Users and Roles actions and audit: R55; Security and Data: R60 and R1; Preferences consistency: R60. The tab-to-page mapping (check 10) is one table in this file's PR, owner R60.

## Routing

| Session | Takes |
| --- | --- |
| R56 (free until R1's Locations API) | Section D (Services & Pricing) first, then B (Appointments), and the shared Copy link / embed block |
| R60 | Section A (Intake Forms), with the Begin Online audit; then E |
| R55 | Section C (Leads) after custom roles; L1, L2, L3, L9 first |
| R1 | I10 (100 MB) rides on the multipart work; A1 meeting-methods API needs no new migration (#995 has it) |

One PR per slice, P1 first. Tell the session when an item is already fixed on main instead of changing it.
