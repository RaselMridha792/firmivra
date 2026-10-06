# Nahid: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md` and `docs/junior/AI-RULES.md` first.

## Your role

Frontend. You own the client portal (portal.dev.firmivra.com/{firm}), shown in each firm's branding.

From Oct 7, Tumit and Ibrahim build screens too, and Rasel's sessions build every API, so your list is shorter. Begin Online moved to Ibrahim; portal appointments and the public firm application form moved to Tumit.

- Pre-review pair: Ibrahim (you review each other's PRs)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | API (built by Rasel's sessions) |
| --- | --- | --- | --- |
| N01 | Oct 6-7 | Portal layout, landing and route map | `portalBusiness` on main; branding from T02 |
| N02 | Oct 7-8 | Client sign-up and verification | R3 |
| N03 | Oct 9 | Portal sign-in and password reset | R3 |
| N05 | Oct 10 | My Docs, upload popup and My Profile | R5, R10 |
| N06 | Oct 11-12 | My Services, Taxes and Intake form tabs | R10, R11 |
| N09 | Oct 13-14 | Messages and notes, Invoices with Pay, Business tab, External links | R11, R7, R12 |
| N10 | Oct 15 | Resource pages, calculators and notifications | R12, R6 |
| - | Oct 16 | Pixel check of all your screens | |
| - | Oct 17 | Fixes from Octavia's review | |
| - | Oct 18 | Production smoke test | |

Moved to others: N04 and N08 went to Tumit; N07 went to Ibrahim.

## Ticket cards

### N01 · Oct 6-7 · Portal layout, landing and route map

Finish it and open the PR on Oct 7.

- **Route map:** in the PR description, list every portal and Begin Online mockup with its URL. Begin Online is Ibrahim's now: give it `/{slug}/begin` and `/{slug}/begin/{service}` unless you have a better reason.
- **Layout:** firm logo, colours and name; sidebar (Home, My Documents, Intake Forms, Messages, Appointments, Invoices & Payments, My Services, My Profile); header with the welcome text and a bell placeholder; footer with the firm's Terms and Privacy links and "Powered by Firmivra".
- **Firm colours:** set them once in the layout as the CSS variables `--color-firm-primary` and `--color-firm-accent`. Pages then use the `firm-*` token classes. This is the only inline style allowed.
- **API:** `api.portalBusiness(slug)` (on main) for the firm name. The full branding (colours, portal name, header, welcome message) comes from the lead's T02; use mock mode until it merges.
- **Mockup:** `docs/mockups/client-portal/Client portal landing page.png`.

Checklist:

- [ ] Works for `/lvp`; an unknown slug shows not-found
- [ ] Matches the mockup at desktop and 375 px

### N02 · Oct 7-8 · Client sign-up and verification

- **Pages:** `/{slug}/sign-up`, `/{slug}/verify-email`, `/{slug}/verify-phone`, `/{slug}/sign-up/done` (or the names in your route map).
- **Mockups:** `LVP Client Portal Sign-Up Page.png`, `Verify email .png`, `Verify phone.png`, `LVP Client Portal Account Confirmation.png`, all in `docs/mockups/client-portal/`.
- **API:** R3's client sign-up functions, published by Rasel's session on Oct 7 in `packages/types/src/client-auth/`. Use mock mode until the API merges.
- **Build:** sign-up form (full name, email, phone, password with the rules, Individual or Business, and a checkbox for the firm's Terms and Privacy with links). Then the 6-digit email code, then the 6-digit SMS code, each with resend and a countdown. The confirmation page says the account waits for the firm's approval.

Checklist:

- [ ] The same message whether or not the email already has an account
- [ ] Codes never appear in the URL
- [ ] Errors shown with `errorMessage()`
- [ ] Matches the mockups at desktop and 375 px

### N03 · Oct 9 · Portal sign-in and password reset

- **Mockup:** none: use the sign-up style.
- **API:** R3.
- **Build:** sign-in, the MFA code screen when the API asks for it, forgot and reset password (never says whether an account exists), sign-out in the user menu.

### N05 · Oct 10 · My Docs, upload popup and My Profile

- **Mockups:** `My docs tab.png`, `Upload docs popup.png`, `My profile.png`. Instructions: `docs/specs/client-portal/My Docs tab instructions.docx`, `My Profile tab instructions.docx`.
- **API:** R5's documents (upload with the kit's `uploadFile()` helper), R10's client profile.
- **Build:** documents by service and year; the upload popup (pick the service, the category, PDF/JPG/PNG up to 10 MB); upload status. Profile with name and date of birth locked ("Request Name Change"), contact details, notification preferences and a change-password link.

### N06 · Oct 11-12 · My Services, Taxes and Intake form tabs

- **Mockups:** `Taxes tab.png`, `Intake form tab.png`. Instructions: `Tax Returns tab Instructions.docx`, `Intake form instructions.docx` in `docs/specs/client-portal/`.
- **API:** R10 (services, tax status, tax returns), R11 (intake forms).
- **Build:** My Services (Active, Recurring, Completed, Cancelled). Taxes tab: year table with the firm's statuses and the Tax Return Payment card. Intake form tab: open forms, autosave, submit, and the Needs Correction state. Reuse Ibrahim's Begin Online form blocks; ask him where they are.

### N09 · Oct 13-14 · Messages and notes, Invoices with Pay, Business tab, External links

- **Mockups:** `Messages and notes.png`, `invoices tab.png`, `Business Tab.png`, `External links .png`. Instructions: `Messages & Notes.docx`, `Invoices tab instructions.docx`, `Business tab instruction.docx`, `FirmVora_External_Links_Directions.docx`.
- **API:** R11 (messages and private notes), R7 (invoices and checkout), R12 (content).
- **Build:** message threads with direction filters and an unread badge; private notes with an optional reminder, never shown to the firm. Invoices: Pending, Due Soon, Paid, Upcoming, Canceled, with a Pay button that opens Stripe checkout. Business tab. External links grouped by section with icons, opening in a new tab.

### N10 · Oct 15 · Resource pages, calculators and notifications

- **Mockups:** `Business Startup Guide Dashboard.png`, `Record Keeping Best Practices Dashboard.png`, `payroll_resources_dashboard.png`, `LVP_Tax_Deductions_Small_Businesses.png`.
- **API:** R12 (content and calculators), R6 (notifications).
- **Build:** the three resource pages from content data; the Tax Return Calculator with its disclaimer; the notification center with Fahad's bell.

## Dev sites

- https://portal.dev.firmivra.com/lvp (LVP client portal)
- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
