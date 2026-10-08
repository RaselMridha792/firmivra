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
- **Build:** each service from the N07a blocks. One PR per one or two services, each under 400 lines.

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

## Dev sites

- https://portal.dev.firmivra.com/lvp (LVP client portal)
- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
