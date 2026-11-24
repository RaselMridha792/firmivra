# Arfan: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md` and `docs/junior/PAGE-MAP.md` first. Your page files already exist as placeholders: PAGE-MAP.md lists them.

## Your role

From Oct 7 you build screens and lead testing. Rasel's Claude Code sessions build every API, so your I01-I11 tickets moved to them.

You own the new-client flow screens: Begin Online (all six services, review, sign and submit, success pages) and the firm's leads inbox with "convert to client". You also lead testing: you check every flow on the dev sites and turn the checks into Playwright tests.

- Pre-review pair: Nahid (you review each other's PRs)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | API (built by Rasel's sessions) |
| --- | --- | --- | --- |
| N07a | Oct 7-8 | Begin Online: entry page, form blocks, Annual Tax | none yet |
| N07b | Oct 9-10 | Begin Online: the other five services | none yet |
| Q01 | Oct 10 (morning) | Test: sign-in on the three dev sites | |
| N07c | Oct 11 | Begin Online: review, sign, submit, save and resume, success | R11, R5 |
| F08 | Oct 12 | Leads inbox and convert to client (firm side) | R11 |
| Q02 | Oct 13 | Test: the whole onboarding path on dev | |
| Q04 | Oct 14 | Playwright tests for Begin Online and leads | |
| Q03 | Oct 15-16 | Full test pass on dev (with Tumit) | |
| - | Oct 17 | Fixes from Octavia's review | |
| - | Oct 18 | Production smoke test | |

## Ticket cards

### N07a · Oct 7-8 · Begin Online: entry page, form blocks, Annual Tax

- **Pages:** on the portal site, `/{firm}/begin` (the service picker) and `/{firm}/begin/annual-tax`, in `portal/[firmSlug]/(public)/begin/`. Public, no sign-in. R1 creates the page files.
- **Mockups:** in `docs/mockups/begin-online/`: `Begin online.png`, `Annual Intake Form 1.png`, `Annual Intake Business Income 2 .png`, `Annual Intake From 3.png`, `Annual Tax Intake Form 4.png`. Read `docs/specs/NOTES-begin-online.md` first: it lists every field and the mockup mistakes to ignore.
- **API:** none yet. Keep the answers in form state. R11 publishes the save and submit functions by Oct 9.
- **Build, in this order:**
  1. Form blocks in `apps/web/src/app/portal/[firmSlug]/(public)/begin/_blocks/` (start here: it doesn't need the placeholders): Stepper, numbered section panel, Yes/No question, radio group, checkbox group, repeater (for dependents and businesses), quarterly grid (Q1-Q4 plus an auto-summed total), upload tile with "I don't have this document" and a reason, masked SSN input with show and hide, review card with Edit. All six services reuse these.
  2. The entry page with the six service cards, in the firm's branding (not LVP's website header).
  3. Annual Tax in 4 steps. Step 2 appears only when "Business" was chosen. Step 4 is the review, with Edit links back to each step.

Checklist:

- [ ] Validation with zod and clear messages
- [ ] SSN masked (last 4) on the review step
- [ ] The tax year is the current one, not hard-coded
- [ ] Nothing stored in localStorage
- [ ] Works at 375 px

### N07b · Oct 9-10 · Begin Online: the other five services

- **Pages:** in `portal/[firmSlug]/(public)/begin/`: `quarterly-tax/`, `bookkeeping/`, `payroll/`, `tax-planning/` and `business-development/`.
- **Mockups:** Quarterly Tax (`business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png`), Bookkeeping (4 files), Payroll (3), Tax Planning (4) and Business Development (4), all in `docs/mockups/begin-online/`. `NOTES-begin-online.md` maps each file to its service.
- **Build:** each service from the N07a blocks. One PR per service (one ticket or one page per PR).

### Q01 · Oct 10 (morning) · Test: sign-in on the three dev sites

Rasel gives you test accounts on dev. Never post their passwords anywhere. On app.dev, admin.dev and portal.dev/lvp, check:

- [ ] Sign-in
- [ ] First-time MFA setup with an authenticator app, then the MFA code
- [ ] The wrong-password message
- [ ] Forgot and reset password
- [ ] Sign-out
- [ ] Signing in on one site doesn't sign you in on another
- [ ] Everything also works at 375 px

Open one GitHub issue per failure (Bug template).

### N07c · Oct 11 · Begin Online: review, sign, submit, save and resume

- **Pages:** `begin/resume/` (opened from the resume link) and `begin/done/` (the success page for each service).
- **Mockups:** the review pages, `Success Page for all services except taxes.png`, `Success Tax Prep.png`.
- **API:** R11's `api.beginOnline.*` (start, save a step, email a resume link, submit) and draft uploads (R11 with R5).
- **Build:** "Save and Continue Later" (the API emails a resume link) and resuming from that link; uploads in the tiles; the signature (typed full name and a checkbox until Rasel confirms the e-sign tool); submit; the success page for each service.

### F08 · Oct 12 · Leads inbox and convert to client

- **Pages:** firm workspace `/leads` and `/leads/[id]`, in `firm/(workspace)/leads/`.
- **API:** R11's `api.leads.*`.
- **Build:** the list of Begin Online submissions (New, Reviewed, Converted, Declined); lead detail with the intake answers (SSN masked); "Convert to client" (creates the client and sends a portal invite); decline with a reason.

### Q02 · Oct 13 · Test: the whole onboarding path on dev

Run the whole path on dev and open a bug for every break:

1. A new firm applies (`/apply` on app.dev).
2. The Super Admin approves it.
3. The owner opens the invite email, activates, sets up MFA and finishes the setup wizard.
4. The owner invites a staff member, who activates.
5. A client signs up on the new firm's portal and verifies email and phone.
6. The firm approves the client; the client signs in and uploads a document; the firm sees it.
7. A Begin Online submission shows up in the firm's leads and converts to a client.

Use only the test emails Rasel gives you: dev sends email only to approved addresses.

### Q04 · Oct 14 · Playwright tests for Begin Online and leads

Locally, with mock mode off: Annual Tax from start to the success page; validation errors on step 1; save and resume; a lead converts to a client. Read emails from Mailpit (http://localhost:8025) when a test needs one.

### Q03 · Oct 15-16 · Full test pass on dev (with Tumit)

You take the portal and Begin Online; Tumit takes the Super Admin site and the firm workspace. Use the checklist in Tumit's Q03 card.

## Super Admin console (Oct 18-19, Rasel)

Octavia's Super Admin designs are in `docs/mockups/super-admin/<module>/source/` with their docx (`SOURCE-INDEX.md` maps the original names). Your 48 routes exist as title-only placeholders in `apps/web/src/app/admin/(console)/`; PAGE-MAP.md lists each one with its design file and docx section. Build mock first on new `apps/web/src/mocks/admin-<module>*.ts` files (synthetic data only), following `docs/design-match.md`. Tumit builds Audit & Security, Billing, Subscriptions, Sales, Team and Support. The sidebar items are Tumit's (the console layout). Pace: 10 pages a day on Oct 18 and Oct 19; a wizard counts as one page with its steps, a page with tabs as one page with its tabs.

| Ticket | Day | Module | Routes |
| --- | --- | --- | --- |
| S07 | Oct 18 | System Settings | 8 |
| S08 | Oct 18 | Notifications | 1 |
| S09 | Oct 18 | Integrations | 12 |
| S10 | Oct 19 | Communications | 10 |
| S11 | Oct 19 | Reports & Analytics | 17 |

### S07 · Oct 18 · Super Admin System Settings

- **Pages** (in `admin/(console)/system-settings/`): `/system-settings`, `/system-settings/general`, `/system-settings/branding`, `/system-settings/email-notifications`, `/system-settings/features`, `/system-settings/data-retention`, `/system-settings/configuration`, `/system-settings/defaults`.
- **Mockups and docx:** `docs/mockups/super-admin/system-settings/source/`; the PAGE-MAP row of each route names its frame and docx section. Modals, drawers and side panels named there get no route: build them on their page.
- **API:** none yet. Build on the typed mocks; when a contract lands in `packages/types`, switch to it without changing the page frame.

Checklist:

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

### S08 · Oct 18 · Super Admin Notifications

- **Pages** (in `admin/(console)/notifications/`): `/notifications`.
- **Mockups and docx:** `docs/mockups/super-admin/notifications/source/`; the PAGE-MAP row of each route names its frame and docx section. Modals, drawers and side panels named there get no route: build them on their page.
- **API:** none yet. Build on the typed mocks; when a contract lands in `packages/types`, switch to it without changing the page frame.

Checklist:

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

### S09 · Oct 18 · Super Admin Integrations

- **Pages** (in `admin/(console)/integrations/`): `/integrations`, `/integrations/platform`, `/integrations/platform/new`, `/integrations/platform/new/connection`, `/integrations/platform/new/settings`, `/integrations/platform/new/review`, `/integrations/platform/[integrationId]`, `/integrations/catalog`, `/integrations/catalog/[catalogId]`, `/integrations/api-webhooks`, `/integrations/logs`, `/integrations/usage`.
- **Mockups and docx:** `docs/mockups/super-admin/integrations/source/`; the PAGE-MAP row of each route names its frame and docx section. Modals, drawers and side panels named there get no route: build them on their page.
- **API:** none yet. Build on the typed mocks; when a contract lands in `packages/types`, switch to it without changing the page frame.

Checklist:

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

### S10 · Oct 19 · Super Admin Communications

- **Pages** (in `admin/(console)/communications/`): `/communications`, `/communications/new`, `/communications/templates`, `/communications/templates/new`, `/communications/templates/[templateId]/edit`, `/communications/broadcasts`, `/communications/broadcasts/new`, `/communications/broadcasts/new/audience`, `/communications/broadcasts/new/message`, `/communications/broadcasts/new/review`.
- **Mockups and docx:** `docs/mockups/super-admin/communications/source/`; the PAGE-MAP row of each route names its frame and docx section. Modals, drawers and side panels named there get no route: build them on their page.
- **API:** none yet. Build on the typed mocks; when a contract lands in `packages/types`, switch to it without changing the page frame.

Checklist:

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

### S11 · Oct 19 · Super Admin Reports & Analytics

- **Pages** (in `admin/(console)/reports/`): `/reports`, `/reports/firms`, `/reports/revenue`, `/reports/users`, `/reports/feature-usage`, `/reports/support`, `/reports/firms/[businessId]`, `/reports/firms/[businessId]/users`, `/reports/firms/[businessId]/subscriptions`, `/reports/firms/[businessId]/feature-usage`, `/reports/firms/[businessId]/activity`, `/reports/firms/[businessId]/support`, `/reports/builder`, `/reports/builder/fields`, `/reports/builder/filters`, `/reports/builder/run`, `/reports/saved`.
- **Mockups and docx:** `docs/mockups/super-admin/reports/source/`; the PAGE-MAP row of each route names its frame and docx section. Modals, drawers and side panels named there get no route: build them on their page.
- **API:** none yet. Build on the typed mocks; when a contract lands in `packages/types`, switch to it without changing the page frame.

Checklist:

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

## Dev sites

- https://portal.dev.firmivra.com/lvp (LVP client portal)
- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
