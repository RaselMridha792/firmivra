# Nahid: task document (15-day plan)

Firmivra Phase 1 · updated Oct 5, 2026 by Rasel Mridha · delivery Oct 18, 2026
Keep this file at `docs/tasks/NAHID.md` on your branch.

## Your role

Frontend developer. You own the client portal (portal.dev.firmivra.com/{firm}) and Begin Online. Firm branding (logo, colours) applies on these pages only.

- Pair: Ibrahim (agree API shapes together before you build)
- Pre-reviewer: Fahad
- Final review and merge: Rasel

## How we work for these 15 days

- One branch per ticket from fresh `main`: `nahid/FIR-N01-short-name`. Rebase on `origin/main` every morning and before the PR.
- Small PRs into `main`, CI green, one PR merged every day if you can. Fahad pre-reviews first, then Rasel reviews and merges.
- Two merge windows a day (midday and evening). Open your PR before a window.
- If a ticket is not merged by the next morning's stand-up, tell Rasel: we split it or hand it over.
- Run everything locally with Docker (Postgres, s3mock, Mailpit). Sign in locally with the dev token (`AUTH_MODE=local`, see README). No AWS access needed.
- Never commit `.env`, secrets or real client data: the repo is public.
- Do not change `packages/db`, `infra/`, `.github/workflows/` or anything under `apps/api/src/auth`, `client-auth`, `storage`, `notify`, `payments`, `support-access`. Those are Rasel's. Need a table or a field? Message Rasel the same day.
- Screens match Octavia's mockups. Every frontend PR shows your screen next to the mockup (desktop and mobile). No mockup: build from the design system and say so in the PR.
- Every screen has loading, empty, error and no-permission states. The API is the real access check; the UI only hides what the user can't use.
- Never store tokens in localStorage. Use the auth helper in `apps/web/src/lib/auth`.
- Mask SSN, EIN and account numbers everywhere.

## Your tickets

| Ticket | Day | Title |
| --- | --- | --- |
| N01 | Oct 6 | Portal layout and landing |
| N02 | Oct 7 | Client sign-up and verification |
| N03 | Oct 8 | Portal sign-in and password reset |
| N04 | Oct 9 | Public firm application form |
| N05 | Oct 10 | My Docs and My Profile |
| N06 | Oct 11 | My Services, Taxes and Intake tabs |
| N07 | Oct 12-13 | Begin Online flows |
| N08 | Oct 14 | Appointments |
| N09 | Oct 15 | Messages, Invoices, Business tab, External links |
| N10 | Oct 16 | Calculators, notifications and pixel check |
| - | Oct 17 | Fixes from Octavia's review |
| - | Oct 18 | Production smoke test |

## Ticket details

### N01 · Oct 6 · Portal layout and landing

Map every portal and Begin Online mockup to a route. Portal layout with firm branding from settings (logo, colours, firm name), landing page, footer with the firm's Terms and Privacy links.

Mockups: docs/mockups/client-portal/Client portal landing page.png

### N02 · Oct 7 · Client sign-up and verification

Sign-up form (with the firm's Terms and Privacy checkbox), verify email code, verify phone code, account confirmation (pending firm approval). Built against Rasel's `docs/api/client-auth.yaml`.

Mockups: docs/mockups/client-portal/LVP Client Portal Sign-Up Page.png, Verify email .png, Verify phone.png, LVP Client Portal Account Confirmation.png

### N03 · Oct 8 · Portal sign-in and password reset

Sign-in, optional MFA, forgot password, reset password (the message never says whether the account exists).

Mockups: No mockup: use the sign-up style

### N04 · Oct 9 · Public firm application form

Apply to Firmivra form for new firms, review and thank-you page (Rasel R4 API).

Mockups: docs/mockups/super-admin/Firm application.png

### N05 · Oct 10 · My Docs and My Profile

My Docs tab, upload popup (presigned upload from Rasel R5), document list and status, My Profile tab (I02).

Mockups: docs/mockups/client-portal/My docs tab.png, Upload docs popup.png, My profile.png, My Docs tab instructions.docx, My Profile tab instructions.docx

### N06 · Oct 11 · My Services, Taxes and Intake tabs

My Services (active, recurring, completed, cancelled) (I04), Taxes tab with tax status and returns (I03, I08), Intake form tab (I06).

Mockups: docs/mockups/client-portal/Taxes tab.png, Intake form tab.png, Tax Returns tab Instructions.docx, Intake form instructions.docx

### N07 · Oct 12-13 · Begin Online flows

Start page, the 6 service flows (Annual tax, Bookkeeping, Payroll, Tax Planning, Development, Business), Review and Submit, success pages (I06).

Mockups: docs/mockups/begin-online/all 26 files

### N08 · Oct 14 · Appointments

Book an appointment from available slots, reschedule, cancel (T07).

Mockups: No mockup

### N09 · Oct 15 · Messages, Invoices, Business tab, External links

Portal Messages, Invoices tab with Pay button (Stripe checkout from Rasel R7, invoices from I10), Business tab, External links, resource dashboards.

Mockups: docs/mockups/client-portal/Messages and notes.png, invoices tab.png, Business Tab.png, External links .png, Business Startup Guide Dashboard.png, Record Keeping Best Practices Dashboard.png, payroll_resources_dashboard.png and the matching .docx

### N10 · Oct 16 · Calculators, notifications and pixel check

Tax Return Calculator and other approved calculators with the disclaimer (I11), notification center using Fahad's component, then pixel check of every portal and Begin Online screen.

Mockups: docs/mockups/client-portal/LVP_Tax_Deductions_Small_Businesses.png

## Dev sites

- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
