# Nahid: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md` and `docs/junior/PAGE-MAP.md` first. Your page files already exist as placeholders: PAGE-MAP.md lists them.

## Your role

Frontend. You own the client portal (portal.dev.firmivra.com/{firm}), shown in each firm's branding.

From Oct 7, Tumit and Ibrahim build screens too, and Rasel's sessions build every API, so your list is shorter. Begin Online moved to Ibrahim; portal appointments and the public firm application form moved to Tumit.

- Pre-review pair: Ibrahim (you review each other's PRs)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | API (built by Rasel's sessions) |
| --- | --- | --- | --- |
| N01 | Oct 6-7 | Portal look and landing page | R3 (public firm info) |
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

### N01 · Oct 6-7 · Portal look and landing page

Finish it and open the PR on Oct 7.

- **Pages:** R1 creates the portal layouts and every portal page; `docs/junior/PAGE-MAP.md` is the route map. You make the layouts match the mockups and build the landing page, all in `portal/[firmSlug]/`:
  - `layout.tsx`: the firm colours, set once as the CSS variables `--color-firm-primary` and `--color-firm-accent`. Pages then use the `firm-*` token classes. This is the only inline style allowed.
  - `(public)/layout.tsx`: firm logo and name; footer with the firm's Terms and Privacy links and "Powered by Firmivra".
  - `(client)/layout.tsx`: sidebar (Home, My Documents, Intake Forms, Messages, Appointments, Invoices & Payments, My Services, My Profile, Log Out); header with the welcome text, a bell placeholder and the user menu; footer.
  - `(client)/(tabs)/layout.tsx`: "My Client Portal", the six folder tabs and the right column (Need Help?, Upcoming Appointment).
  - `(public)/page.tsx`: the landing page. Use the mockup's hero, the "What you can do" icons, the two panels (Sign in, Create an account) and the trust strip, in the firm's branding; leave out LVP's website menu and long footer.
- **API:** the firm's public info (name, logo, colours, portal name, header, welcome message, current Terms and Privacy) from R3's `portal/{slug}/info`, published by Rasel's session on Oct 7 in `packages/types/src/client-auth/`. Use mock mode until the API merges.
- **Mockups:** `docs/mockups/client-portal/Client portal landing page.png` (landing), `My docs tab.png` (signed-in layout).

Checklist:

- [ ] Works for `/lvp`; an unknown slug shows not-found
- [ ] Matches the mockups at desktop and 375 px
- [ ] The sidebar becomes a drawer at 375 px

### N02 · Oct 7-8 · Client sign-up and verification

- **Pages:** `/{firm}/sign-up`, `/{firm}/sign-up/verify-email`, `/{firm}/sign-up/verify-phone` and `/{firm}/sign-up/done`, in `portal/[firmSlug]/(public)/sign-up/`.
- **Mockups:** `LVP Client Portal Sign-Up Page.png`, `Verify email .png`, `Verify phone.png`, `LVP Client Portal Account Confirmation.png`, all in `docs/mockups/client-portal/`.
- **API:** R3's client sign-up functions, published by Rasel's session on Oct 7 in `packages/types/src/client-auth/`. Use mock mode until the API merges.
- **Build:** sign-up form (full name, email, phone, password with the rules, Individual or Business, and a checkbox for the firm's Terms and Privacy with links). Then the 6-digit email code, then the 6-digit SMS code, each with resend and a countdown. The confirmation page says the account waits for the firm's approval; a pending client who signs in later lands there too.

Checklist:

- [ ] The same message whether or not the email already has an account
- [ ] Codes never appear in the URL
- [ ] Errors shown with `errorMessage()`
- [ ] Matches the mockups at desktop and 375 px

### N03 · Oct 9 · Portal sign-in and password reset

- **Pages:** `/{firm}/sign-in`, `/{firm}/forgot-password` and `/{firm}/reset-password`, in `portal/[firmSlug]/(public)/`.
- **Mockup:** none: use the sign-up style.
- **API:** R3.
- **Build:** sign-in, the MFA code screen when the API asks for it, forgot and reset password (never says whether an account exists), sign-out in the user menu.

### N05 · Oct 10 · My Docs, upload popup and My Profile

- **Pages:** `/{firm}/documents` (`(client)/(tabs)/documents/`) and `/{firm}/profile` (`(client)/profile/`).
- **Mockups:** `My docs tab.png`, `Upload docs popup.png`, `My profile.png`. Instructions: `docs/specs/client-portal/My Docs tab instructions.docx`, `My Profile tab instructions.docx`.
- **API:** R5's documents (upload with the kit's `uploadFile()` helper), R10's client profile.
- **Build:** documents by service and year; the upload popup (pick the service, the category, PDF/JPG/PNG up to 10 MB); upload status. Profile with name and date of birth locked ("Request Name Change"), contact details, notification preferences and a change-password link.

### N06 · Oct 11-12 · My Services, Taxes and Intake form tabs

- **Pages:** `/{firm}/services` (`(client)/services/`), `/{firm}/taxes` and `/{firm}/intake` (in `(client)/(tabs)/`).
- **Mockups:** `Taxes tab.png`, `Intake form tab.png`. Instructions: `Tax Returns tab Instructions.docx`, `Intake form instructions.docx` in `docs/specs/client-portal/`.
- **API:** R10 (services, tax status, tax returns), R11 (intake forms).
- **Build:** My Services (Active, Recurring, Completed, Cancelled). Taxes tab: year table with the firm's statuses and the Tax Return Payment card. Intake form tab: open forms, autosave, submit, and the Needs Correction state. Reuse Ibrahim's Begin Online form blocks; ask him where they are.

### N09 · Oct 13-14 · Messages and notes, Invoices with Pay, Business tab, External links

- **Pages:** `/{firm}/messages`, `/{firm}/invoices` and `/{firm}/business` (in `(client)/(tabs)/`), and `/{firm}/resources/external-links`.
- **Mockups:** `Messages and notes.png`, `invoices tab.png`, `Business Tab.png`, `External links .png`. Instructions: `Messages & Notes.docx`, `Invoices tab instructions.docx`, `Business tab instruction.docx`, `FirmVora_External_Links_Directions.docx`.
- **API:** R11 (messages and private notes), R7 (invoices and checkout), R12 (content).
- **Build:** message threads with direction filters and an unread badge; private notes with an optional reminder, never shown to the firm. Invoices: Pending, Due Soon, Paid, Upcoming, Canceled, with a Pay button that opens Stripe checkout. Business tab. External links grouped by section with icons, opening in a new tab.

### N10 · Oct 15 · Resource pages, calculators and notifications

- **Pages:** in `portal/[firmSlug]/(client)/`: `resources/startup-guide/`, `resources/record-keeping/`, `resources/payroll/`, `resources/tax-deductions/`, `calculator/` and `notifications/`.
- **Mockups:** `Business Startup Guide Dashboard.png`, `Record Keeping Best Practices Dashboard.png`, `payroll_resources_dashboard.png`, `LVP_Tax_Deductions_Small_Businesses.png`.
- **API:** R12 (content and calculators), R6 (notifications).
- **Build:** the three resource pages from content data; the Tax Return Calculator with its disclaimer; the notification center with Fahad's bell.

## Dev sites

- https://portal.dev.firmivra.com/lvp (LVP client portal)
- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
