> **Repo notes (Oct 4, 2026).** Read `CLAUDE.md` first; it wins where this doc differs.
> - Mockups: `docs/mockups/begin-online/`, `client-portal/`, `super-admin/` (same file names as Octavia's Drive folders). Specs: `docs/specs/client-portal/`, `super-admin/`, `platform-guide/`.
> - LVP's portal slug is `lvp`: `portal.localhost:3000/lvp` locally, `portal.dev.firmivra.com/lvp` on dev.
> - Route group and folder names in `apps/web` follow the README once the app is scaffolded (Step 6.5).

# Nahid: Frontend task document

Firmivra Phase 1 (beta) · Prepared by Rasel Mridha (Technical Project Manager) · Oct 4, 2026
Beta launch: Jan 8, 2027 · Keep this file at `docs/tasks/NAHID.md` on your branch.

## 1. Your role

You are a frontend developer. You own the **client portal** at `portal.firmivra.com/{firm}` (sign-up, sign-in, the dashboard with its folder tabs, My Docs, My Profile, My Services, Intake Forms, Taxes, Messages, Invoices, appointments booking, calculators), the public **Begin Online** intake flows, and the minimal **Super Admin** screens at `admin.firmivra.com` (login, applications list, application detail with approve, request info, decline).

- **Backend pair:** Ibrahim (clients, documents, intake, services, messages, invoices and Stripe, calculator). Agree the API contract with Ibrahim on day 1 of each sprint.
- **Other APIs you consume:** Tumit (firm applications, portal sign-up and password reset, legal documents, appointments, notifications).
- **Pre-reviewer:** Fahad reads your PRs before Rasel. You pre-review Fahad's PRs.
- **Final review and merge:** Rasel only.
- **Design system:** Fahad owns `packages/ui`. Use the components there. If you need a new one, build it in `packages/ui` through a PR Fahad pre-reviews.

## 2. Rules that apply to you

**Branches and PRs**

- Create every branch from the latest `main`: `git checkout main && git pull && git checkout -b nahid/FIR-<ticket>-short-name`. Example: `nahid/FIR-57-portal-sign-up`.
- The placeholder ids in this file (like `FIR-S2-N1`) become real GitHub issue numbers when Rasel creates the issues. Use the real number in the branch name.
- Open a pull request from your branch into `main`. Never push to `main`. Only Rasel merges (squash merge).
- CI must be green before review: lint, type check, unit tests, build.
- Keep PRs under ~400 changed lines. Begin Online is big: one PR for the shared form engine pieces, then one PR per service flow.
- Every frontend PR includes a **screenshot of your screen next to the mockup** (desktop and mobile width).
- Ask Fahad for a pre-review before you request Rasel.

**Design rules**

- Screens must match Octavia's mockups. Use tokens and components from `packages/ui`. Do not invent new design tokens or hard-code colours.
- The portal and Begin Online use the **firm's brand layer** (logo, colours, contact details, legal links) loaded from the firm settings. Never hard-code "LVP" text, phone numbers, addresses or colours. The mockups use placeholder data (555 phone, two different addresses).
- Use the **simplified portal footer** (firm logo, "Powered by Firmivra", Terms of Service, Privacy Policy). Do not use the old long marketing footer.
- The brand name is **Firmivra**. The mockups say FirmVora or FirmVRA; ignore that.
- Every screen has loading (skeleton), empty, error and permission-denied states. Permission-denied must not reveal that a record exists.
- Fix the obvious mockup errors (typos like "yax", "Rusiness", "Expensss", "TOMGROW"; wrong active sidebar item) instead of copying them.

**Data and security rules**

- The API is the real access check. Hiding a button is not security.
- A client only ever sees their own data inside their own firm. The firm slug in the URL picks the tenant; never let a client switch firm or client.
- Never store tokens in `localStorage`. Use the repo's auth helper.
- Never put SSNs, EINs or ID numbers in URLs, logs or analytics. Mask them on screen.
- Nobody gets AWS access. Run everything locally with Docker (PostgreSQL, s3mock for S3, Mailpit for email; a local key instead of KMS). Follow the README.
- Do not edit `packages/db`, `infra/`, or CI workflows.

## 3. Repo map (expected layout; follow the README if it differs)

| Path | What it is | Your access |
| --- | --- | --- |
| `apps/web` | Next.js App Router. One app serves `admin.`, `app.` and `portal.` by host name. | You work here |
| `apps/web/app/(portal)/[firm]/...` | Client portal routes (`portal.firmivra.com/{firm}`) | Yours |
| `apps/web/app/(portal)/[firm]/begin/...` | Begin Online public intake | Yours |
| `apps/web/app/(admin)/...` | Super Admin routes (`admin.firmivra.com`) | Yours |
| `apps/web/app/(app)/create-account` | Public firm application form on `app.firmivra.com` | Yours (S1) |
| `apps/web/app/(app)/...` | Firm workspace | Fahad's |
| `packages/ui` | Design system and Storybook | Fahad owns; you add through PRs |
| `packages/types` | Shared types and API contracts | Shared; change only as agreed with your pair |
| `apps/api` | NestJS API | Tumit and Ibrahim |
| `packages/db`, `infra/` | Prisma schema, CDK | Rasel only |

Local URLs (expected): `portal.localhost:3000/lvp-accounting`, `admin.localhost:3000`, `app.localhost:3000`, API at `localhost:4000/api/v1`.

**Mockups:** in the shared project folder `client-info/drive-folders/`. Folder names with a trailing space: `Client Portal /` and `Super firm login and functuon /`. Screen-by-screen notes: `client-info/drive-folders/NOTES-client-portal.md` and `NOTES-begin-online.md`. Read the notes before each ticket; they list every conflict in the mockups.

## 4. Tickets by sprint

Ticket ids are placeholders: `FIR-S<sprint>-N<number>`. All API paths below are **proposed, agree with your pair** before you build.

### Summary

| Sprint | Dates | Your tickets |
| --- | --- | --- |
| 0 | Oct 5 to Oct 16 | S0-N1 portal route and component map, S0-N2 Begin Online map, S0-N3 gap list |
| 1 | Oct 19 to Oct 30 | S1-N1 firm application form, S1-N2 Super Admin login and shell, S1-N3 applications list, S1-N4 application detail and actions |
| 2 | Nov 2 to Nov 13 | S2-N1 portal landing, S2-N2 sign-up and verification, S2-N3 sign-in and password reset, S2-N4 legal links and footer |
| 3 | Nov 16 to Nov 27 | S3-N1 portal shell and home, S3-N2 My Docs, S3-N3 upload popup, S3-N4 My Profile, S3-N5 My Services |
| 4 | Nov 30 to Dec 11 | S4-N1 Begin Online entry and form engine, S4-N2 six service flows, S4-N3 review, submit, success, S4-N4 Intake Forms tab, S4-N5 Taxes tab |
| 5 | Dec 14 to Dec 25 | S5-N1 booking, reschedule, cancel, S5-N2 portal Messages and Notes, S5-N3 Invoices tab and Stripe checkout, S5-N4 calculators |
| 6 | Dec 28 to Jan 8 | S6-N1 pixel check, S6-N2 acceptance fixes, S6-N3 accessibility and responsive pass |

### Sprint 0: setup and foundations (Oct 5 to Oct 16)

No running app yet. This is mapping work; put the output in `docs/` as a PR once the repo exists.

**FIR-S0-N1 Portal route and component map**
- Build: a table of every portal screen: route, mockup file, instruction doc, components needed, API data needed. Include screens with no mockup: sign-in, forgot and reset password, My Services, Appointments, notification center, calculator, avatar menu, My Settings.
- Proposed routes: `/{firm}` (landing), `/{firm}/sign-up`, `/{firm}/sign-in`, `/{firm}/forgot-password`, `/{firm}/reset-password`, `/{firm}/home` (folder tabs), `/{firm}/documents`, `/{firm}/intake`, `/{firm}/intake/[formId]`, `/{firm}/taxes`, `/{firm}/invoices`, `/{firm}/messages`, `/{firm}/appointments`, `/{firm}/services`, `/{firm}/profile`, `/{firm}/notifications`, `/{firm}/resources/...`, `/{firm}/calculators/[key]`.
- Acceptance: every PNG in `Client Portal /` maps to a route; components list is shared with Fahad so Fahad can plan `packages/ui`.

**FIR-S0-N2 Begin Online map**
- Build: for the 6 flows (Annual Tax, Quarterly Tax, Bookkeeping, Payroll, Tax Planning, Business Development), list steps, fields, field types, conditional rules and upload slots. This becomes the form definition Ibrahim stores.
- Mockups: all 26 files in `Begin online/`. Note: `business Information.png`, `Taxes & Income.png`, `Business Expenses.png` and `Review & Submit.png` are the Quarterly Tax flow.
- Acceptance: one JSON-like definition per flow agreed with Ibrahim; review-page fields that the forms never collect are flagged.

**FIR-S0-N3 Gap list for Octavia**
- Build: a short list of screens that do not match the written instructions or have no mockup, for Rasel to send to Octavia. Start from `NOTES-client-portal.md` section 5 and `NOTES-begin-online.md` section 9.
- Acceptance: each item says what is wrong and what you propose.

### Sprint 1: sign-in and firm approval (Oct 19 to Oct 30)

Goal: a firm applies, Super Admin approves it, the firm owner activates and logs in.

**FIR-S1-N1 Public firm application form**
- Build: `app.firmivra.com/create-account`: practice type, legal name, DBA, entity type, EIN, contact, website, address, primary administrator, credentials and uploads, services, team size, client volume, referral source, requested start date, agreement and certification. Confirmation page ("Pending Review").
- Mockups: none for the form itself. Fields from `Super firm login and functuon /Firmivra_Super_Admin_Phase_1_Beta_Scope.docx` and `Firmivra_Developer_Directional_Instructions.docx` section 3, and what `When firm aplication is open.png` displays.
- Acceptance: cannot submit without the agreement; EIN format validated; uploads limited to allowed types and size; on submit the user sees Pending Review and gets no workspace access; CAPTCHA or rate-limit message handled.
- API (consumes, Tumit): `POST /api/v1/public/firm-applications`, `POST /api/v1/public/firm-applications/upload-url`.

**FIR-S1-N2 Super Admin login and shell**
- Build: `admin.firmivra.com` login and the dashboard shell. Sidebar with Dashboard, Firm Applications, Firms active; Sales, Leads/CRM, Team, Subscriptions, Billing, Support, Reports, Notifications, Audit & Security, Settings as "Coming Soon" pages.
- Mockups: `Super firm login and functuon /Super login.png`, `Dashboard Active .png`.
- Acceptance: no "create account" link on this login; non super-admin users are rejected; dashboard cards show pending applications and active firms counts (others can be placeholders).
- API (consumes, Tumit): Cognito super-admin pool via the auth helper; `GET /api/v1/admin/dashboard/summary`.

**FIR-S1-N3 Applications list**
- Build: table with applicant, firm name, practice type, submitted date, status (Pending, Info Requested, Approved, Declined), Open Application.
- Mockups: `Super firm login and functuon /Firm application.png`.
- Acceptance: filter by status; newest first; empty state.
- API (consumes, Tumit): `GET /api/v1/admin/firm-applications?status=`.

**FIR-S1-N4 Application detail with Approve, Request Information, Decline**
- Build: full application view (business, owner/admin, credentials, documents), internal notes (Firmivra only), history, and the three actions. Approved state screen.
- Mockups: `When firm aplication is open.png`, `Firm approved.png`.
- Acceptance: each action asks for confirmation; Request Information and Decline need a message; after Approve the firm shows as Active and the owner gets the activation email; actions are disabled while a request is in flight; history shows each action with who and when.
- API (consumes, Tumit): `GET /api/v1/admin/firm-applications/{id}`, `POST .../{id}/approve`, `POST .../{id}/request-info`, `POST .../{id}/decline`, `POST .../{id}/notes`.
- Note: "Open Firm Workspace" in the mockup is **not** direct access. It only works through the owner-approved support grant (Tumit, Sprint 3). Show it disabled with a tooltip until then.

### Sprint 2: portal entry and client sign-up (Nov 2 to Nov 13)

Goal: a client signs up on the firm's portal, verifies email and phone, and waits for firm approval.

**FIR-S2-N1 Branded portal landing page**
- Build: `/{firm}` landing: hero, "What You Can Do", Sign In and Create an Account panels, trust strip. Loads firm branding by slug.
- Mockups: `Client Portal /Client portal landing page.png`.
- Acceptance: unknown slug shows a not-found page; branding comes from the API; no LVP text is hard-coded.
- API (consumes, Tumit): `GET /api/v1/public/firms/{slug}` (name, logo, colours, contact, legal links, enabled features).

**FIR-S2-N2 Client sign-up, verify email, verify phone, account confirmation**
- Build: 4-step wizard: Create Account (full name, email, phone, password and confirm, account type Individual or Business, accept Terms and Privacy), Verify Email (6-digit code, resend after 45 s, change email), Verify Phone (6-digit SMS code, masked number, resend, change number), Complete ("Account Created", pending firm approval).
- Mockups: `LVP Client Portal Sign-Up Page.png`, `Verify email .png`, `Verify phone.png`, `LVP Client Portal Account Confirmation.png`.
- Acceptance: password policy shown inline; wrong code shows an error and a remaining-attempts message; resend timer works; the confirmation page says the firm will approve the account (do not promise immediate access); Terms and Privacy links point to the firm's own documents.
- API (consumes, Tumit): `POST /api/v1/portal/{slug}/sign-up`, `POST .../verify-email`, `POST .../verify-phone`, `POST .../resend-code`.

**FIR-S2-N3 Portal sign-in, forgot and reset password**
- Build: sign-in, forgot password (email), reset with code and new password, success and error states, all inside the firm's portal.
- Mockups: none. Use the landing page style.
- Acceptance: forgot password always shows the same message whether or not the account exists; a pending (not yet approved) account sees "waiting for firm approval"; a deactivated account sees a contact-the-firm message; MFA challenge supported if Cognito asks.
- API (consumes, Tumit): Cognito via the auth helper with the firm's client; `POST /api/v1/portal/{slug}/password/forgot`, `POST /api/v1/portal/{slug}/password/reset`.

**FIR-S2-N4 Firm legal links in sign-up, login and footer**
- Build: the simplified portal footer component with the firm's Terms of Service and Privacy Policy, used on every portal and Begin Online page.
- Acceptance: links come from the firm's legal documents setting; if a firm has none, fall back to the Firmivra documents and show a warning in dev only.

### Sprint 3: documents, profile, services (Nov 16 to Nov 27)

**FIR-S3-N1 Portal shell and Home**
- Build: header (firm logo, Welcome Back, bell from Fahad's kit, avatar menu), navy sidebar (Home, My Documents, Intake Forms, Messages, Appointments, Invoices & Payments, My Services, My Profile, Log Out), folder tabs, right rail (Need Help, Upcoming Appointment, Recent Activity, Quick Links).
- Mockups: `Intake form tab.png` (shell), `My docs tab.png`.
- Acceptance: the active sidebar item matches the current page (the mockups get this wrong); badges come from the API; Individual clients do not see business-only areas, and direct URLs return permission-denied.

**FIR-S3-N2 My Docs tab**
- Build: My Uploaded Documents table (file name, category, upload date, year, view, download, menu), filters (category, year, search), toggle to Firm Documents (shared with me).
- Mockups: `My docs tab.png`; spec `My Docs tab instructions.docx`.
- Acceptance: no rename, move or delete for clients; download uses a short-lived signed URL; empty states "No documents uploaded yet" and "No documents have been shared with you yet".
- API (consumes, Ibrahim): `GET /api/v1/portal/documents?source=mine|firm`, `GET /api/v1/portal/documents/{id}/download-url`.

**FIR-S3-N3 Upload popup with the upload gate**
- Build: the decision modal (tax service / business service / no open service = STOP), file picker, progress, success and failure.
- Mockups: `Upload docs popup.png`.
- Acceptance: options the client is not eligible for are disabled with a reason; STOP shows no file picker; file types and size come from the firm's settings, not hard-coded; a failed upload never shows as uploaded; upload goes straight to S3 with a pre-signed URL.
- API (consumes, Ibrahim): `GET /api/v1/portal/upload-eligibility`, `POST /api/v1/portal/documents/upload-url`, `POST /api/v1/portal/documents/{id}/complete`.

**FIR-S3-N4 My Profile tab**
- Build: account info (name and DOB locked, email, phone, address), Request Name Change modal, additional info, notification preferences link, change password, Cancel My Client Portal Account.
- Mockups: `My profile.png` (its visual style differs; use the standard portal shell). Spec `My Profile tab instructions.docx`.
- Acceptance: changing email or phone triggers re-verification; unsaved-changes warning; cancel portal account warns that it does not cancel services and needs explicit confirmation.
- API (consumes, Ibrahim): `GET/PATCH /api/v1/portal/me/profile`, `POST /api/v1/portal/me/name-change-requests`, `POST /api/v1/portal/me/deactivate`. Password change through Cognito (Tumit).

**FIR-S3-N5 My Services page**
- Build: list of the client's services grouped as Active, Recurring, Completed, Cancelled, with service type, period, status and next step.
- Mockups: none (only the "My Business Services" card in `Business Tab.png`). Design from the system; Octavia approves at demo.
- Acceptance: shows a status, not a percentage, unless the API returns a calculated progress value.
- API (consumes, Ibrahim): `GET /api/v1/portal/services`.

### Sprint 4: Begin Online, intake, taxes (Nov 30 to Dec 11)

**FIR-S4-N1 Begin Online entry page and form engine**
- Build: `/{firm}/begin` with the 6 service cards; a form renderer driven by the definitions from S0-N2: stepper, sections, all field types (masked SSN and EIN, currency, quarterly grids with totals, repeating groups, conditional fields), upload slots with "I don't have this document" and a reason, Save and Continue Later.
- Mockups: `Begin online/Begin online.png`; field patterns from all flow screens.
- Acceptance: no login needed; drafts resume from an emailed link; required fields block Next; conditional fields appear and disappear correctly; works at 375 px.
- API (consumes, Ibrahim): `GET /api/v1/public/{slug}/intake-forms`, `POST /api/v1/public/{slug}/intake-submissions` (draft), `PATCH .../{id}`, `POST .../{id}/upload-url`, `POST .../{id}/resume-link`.

**FIR-S4-N2 The six service flows**
- Build one PR per flow:
  - Annual Tax: `Annual Intake Form 1.png`, `Annual Intake Business Income 2 .png`, `Annual Intake From 3.png`, `Annual Tax Intake Form 4.png`
  - Quarterly Tax: `business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png`
  - Bookkeeping: `Bookkeeping intake.png`, `Bookkeeping Background intake.png`, `Bookkeeping Document Upload intake .png`, `Bookkeeping Review  intake.png`
  - Payroll: `Payroll intake 1.png`, `Payroll intake 2.png`, `Payroll Review intake.png`
  - Tax Planning: `Tax Planning intake 1.png`, `Tax  planning intake  2 .png`, `Tax Planning intake 3 .png`, `Tax planning intake 4.png`
  - Business Development: `Development intake 1.png`, `Development intake 2 .png`, `Development intake 3.png`, `Development Intake 4.png`
- Acceptance: step labels and counts are consistent (use the agreed labels, not the mockup mix); duplicate questions removed as agreed; yes/no questions are radios; Annual Tax captures the payment choice (from refund, pay now, pay after preparation).

**FIR-S4-N3 Review, sign and submit, success pages**
- Build: read-only review with per-section Edit, service agreement, consent checkboxes, typed or drawn signature, submit; success pages.
- Mockups: the step 4 screens above, `Success Tax Prep.png`, `Success Page for all services except taxes.png`.
- Acceptance: review shows only fields the form collected; submit is disabled until all consents and signature are present; double submit is prevented; success page promises only a confirmation email and that a team member will reach out (no account is created).
- API (consumes, Ibrahim): `POST /api/v1/public/{slug}/intake-submissions/{id}/submit`.

**FIR-S4-N4 Intake Forms tab (portal)**
- Build: seven form cards, Your Next Steps, Service Progress, Payments card, Tax Tip, and the logged-in form experience reusing the S4-N1 engine with all states (Sent, In Progress, Submitted, Needs Correction, Under Review, Completed, Expired, Archived).
- Mockups: `Intake form tab.png`; spec `Intake form instructions.docx`.
- Acceptance: clicking a card resumes an existing form; a new form is created only when the firm enables self-service, otherwise show a request or contact path; Needs Correction shows the firm's request; Submitted and Under Review are read-only.
- API (consumes, Ibrahim): `GET /api/v1/portal/intake-forms`, `POST /api/v1/portal/intake-submissions`, `PATCH /api/v1/portal/intake-submissions/{id}`, `POST .../{id}/submit`, `GET /api/v1/portal/next-steps`.

**FIR-S4-N5 Taxes tab**
- Build: tax returns table (tax year, filing type, status, date filed, actions), Tax Year filter, category cards (Quarterly, Annual Personal, Annual Business), Tax Return Payment card when a balance is due.
- Mockups: `Taxes tab.png`; spec `Tax Returns tab Instructions.docx`. The sixth folder tab must say "Messages and Notes", not "Other".
- Acceptance: statuses come from the firm's tax status list; payment never changes filing status; the payment card links to the invoice.
- API (consumes, Ibrahim): `GET /api/v1/portal/tax-returns`, `GET /api/v1/portal/tax-returns/{id}/download-url`.

### Sprint 5: appointments, messages, billing, calculator (Dec 14 to Dec 25)

Heaviest sprint and includes Dec 25. If Sprint 2 velocity is behind, the calculator moves after beta first.

**FIR-S5-N1 Client booking, reschedule and cancel**
- Build: Appointments page (upcoming and past), Schedule Now (service, staff or any, available slots, method), View Details modal, Reschedule (updates the same record), Cancel; the Upcoming Appointment card on every page.
- Mockups: none for the page; the appointment card in `Business Tab.png`.
- Acceptance: only firm-allowed slots appear; a slot taken meanwhile shows a clear error and refreshes; times show with the time zone; confirmation shown after each change.
- API (consumes, Tumit): `GET /api/v1/portal/availability`, `GET/POST /api/v1/portal/appointments`, `POST .../{id}/reschedule`, `POST .../{id}/cancel`.

**FIR-S5-N2 Portal Messages and Notes**
- Build: message table with filters (All, From firm, I Sent), search, unread dot, mark read/unread, conversation view, composer with attachments and related record; private Notes pad with Set as reminder.
- Mockups: `Messages and notes.png`; spec `Messages & Notes.docx`.
- Acceptance: sidebar badge equals live unread inbound count; a failed send keeps the text; no delete action; notes are never visible to the firm.
- API (consumes, Ibrahim): `GET /api/v1/portal/messages`, `GET /api/v1/portal/messages/unread-count`, `POST /api/v1/portal/messages`, `POST .../{id}/read`, `GET/PUT /api/v1/portal/notes`.

**FIR-S5-N3 Invoices tab with Stripe checkout**
- Build: open and past invoices, type and status filters, search, Pay Now and Make a Payment, View and Download PDF, Important Info box.
- Mockups: `invoices tab.png`; spec `Invoices tab instructions.docx`.
- Acceptance: Pay Now opens Stripe Checkout; on return the page shows "processing" until the API reports Paid (from the webhook); ACH shows pending; paid invoices hide Pay Now; cancelled invoices cannot be paid; Important Info text comes from settings.
- API (consumes, Ibrahim): `GET /api/v1/portal/invoices`, `POST /api/v1/portal/invoices/{id}/checkout-session`, `GET /api/v1/portal/invoices/{id}/pdf-url`.

**FIR-S5-N4 Tax Return Calculator and other approved calculators**
- Build: calculator pages with validated inputs, result breakdown, and a clear disclaimer that results are estimates.
- Mockups: none. Formulas and the list of approved calculators are still pending from Octavia; build with placeholder formulas behind the API.
- Acceptance: invalid input shows field errors; the disclaimer is always visible; no formula logic in the frontend (it comes from the API).
- API (consumes, Ibrahim): `GET /api/v1/calculators`, `POST /api/v1/calculators/{key}/compute`.

### Sprint 6: beta hardening and launch (Dec 28 to Jan 8)

No new features.

- **FIR-S6-N1 Pixel check:** compare every portal, Begin Online and Super Admin screen with the mockups at desktop and 375 px; post a screenshot table in the PR.
- **FIR-S6-N2 Acceptance fixes:** fix what Octavia raises during acceptance testing on dev.
- **FIR-S6-N3 Accessibility and responsive pass:** keyboard navigation, focus order, labels, contrast; check that no page leaks another client's data during loading.

## 5. Working with Claude Code

Open the repo in VS Code and start Claude Code from the repo root. Paste one of these and edit the ticket details.

**Build a portal screen from a mockup**

```
Read CLAUDE.md and docs/tasks/NAHID.md. Ticket FIR-S3-N2 (My Docs tab).
Build the page under apps/web/app/(portal)/[firm]/documents using only packages/ui components and tokens.
Do not invent new design tokens or hard-code firm names, colours or contact details; read branding from the firm settings.
Use the types in packages/types for GET /api/v1/portal/documents. Add loading, empty, error and permission-denied states.
Write tests for the filters and the empty states. Keep the change under 400 lines.
```

**Begin Online flow from the form engine**

```
Read CLAUDE.md and docs/tasks/NAHID.md. Ticket FIR-S4-N2, Payroll flow.
Add the Payroll form definition and render it with the existing form engine. Do not add one-off form code.
Use radios for yes/no questions and the agreed step labels. Add tests for required fields and conditional fields.
```

**Auth screens**

```
Read CLAUDE.md and docs/tasks/NAHID.md. Ticket FIR-S2-N3 (portal sign-in and password reset).
Use the repo's auth helper only. The forgot-password screen must show the same message whether or not the account exists.
Never store tokens in localStorage. Add tests for wrong code, expired code and pending-approval accounts.
```

**Payment flow**

```
Read CLAUDE.md and docs/tasks/NAHID.md. Ticket FIR-S5-N3.
Wire Pay Now to POST /api/v1/portal/invoices/{id}/checkout-session and redirect to Stripe Checkout.
After return, poll the invoice until the API reports Paid or Failed. Never mark it paid on the client side.
Add tests for success, cancel and failure.
```

**Before you open a PR**

```
Run lint, type check, tests and build the way CI does. Fix failures.
Write a PR description: ticket id, what changed, how to test locally, and a table for screenshots next to the mockup.
```

## 6. Definition of Done

- [ ] Code merged to `main` by Rasel with CI green
- [ ] UI matches the mockup on desktop and mobile widths (screenshot next to mockup in the PR)
- [ ] Every query is scoped to the current business (tenant isolation test included for new data); no portal screen can show another client's or firm's data
- [ ] Unit tests for business logic; API endpoint covered by an e2e test
- [ ] Audit log entry for any action on client data (the API writes it; make sure your screen uses the logged endpoint, for example downloads)
- [ ] Works on dev.firmivra.com and Rasel has accepted it

Post-beta (not in your tickets): Payroll operations, Advisory workspace, Google and Outlook calendar sync.
