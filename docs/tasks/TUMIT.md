# Tumit: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md` and `docs/junior/PAGE-MAP.md` first. Your page files already exist as placeholders: PAGE-MAP.md lists them.

## Your role

From Oct 7 you build screens and test, like Ibrahim. Rasel's Claude Code sessions build every API: the lead is finishing your T02-T04 from your branches, and T05-T09 moved to the sessions. Thank you for the T01-T04 work; your field list found real gaps that are being added now. Please don't push to your old `tumit/FIR-T0N` branches any more.

You now own the firm onboarding screens from start to end:

- the public firm application form;
- the Super Admin site (dashboard, applications, firms);
- the setup wizard, settings and team;
- the calendar and appointment screens.

On Oct 15-16 you and Ibrahim test everything on dev.

- Pre-review pair: Fahad (you review each other's PRs)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | API (built by Rasel's sessions) |
| --- | --- | --- | --- |
| F04a | Oct 7 | Super Admin sidebar, header and dashboard | `adminAuth.me()` on main; the rest mock |
| F04b | Oct 8 | Firm applications: list, detail, approve, request info, decline | R4 |
| N04 | Oct 9 | Public firm application form, and the Super Admin firms list | R4 |
| F05 | Oct 10-11 | First-time setup wizard, settings and team | T02-T04 (lead), R2 invites |
| F09 | Oct 12-13 | Firm calendar and availability | R12 |
| N08 | Oct 14 | Portal appointments: book, reschedule, cancel | R12 |
| Q03 | Oct 15-16 | Full test pass on dev (with Ibrahim) | |
| - | Oct 17 | Fixes from Octavia's review | |
| - | Oct 18 | Production smoke test | |

## Ticket cards

### F04a · Oct 7 · Super Admin sidebar, header and dashboard

- **Pages:** R1 creates the shell and every Super Admin page (see `docs/junior/PAGE-MAP.md`). The sidebar, header and user menu live in `apps/web/src/components/app-shell/`, shared with Fahad's firm site: you make them match the mockup. The dashboard is `admin/(console)/page.tsx`. Fahad builds the sign-in page (F02).
- **Mockup:** `docs/mockups/super-admin/Dashboard Active .png`.
- **API:** `useMe()` from the layout for the name and role. The F04a dashboard uses page-local sample fixtures for the remaining metrics, applications, search results and notifications; do not change shared mocks. These fixtures are not live API data.
- **Build:**
  1. Sidebar exactly like the mockup: Dashboard, Firm Applications (with the pending count), Firms; the other items keep their "Soon" badge.
  2. Header search filters local sample firm/application/user records, supports arrow keys, Enter, Escape and clear, and links results to existing routes. The bell opens the sample notification panel with unread/read behavior; keep the user menu.
  3. Dashboard: the four stat cards, Recent Firm Applications with Review buttons, Quick Actions, Tasks Requiring Attention, System Status and the Platform Modules "Coming Soon" tiles. Show today's date. Match the mockup's static Platform Growth chart and legend with inline SVG; do not add a chart package. The growth-period selector changes the displayed sample date window and chart.

**Status (Oct 7, 2026):** F04a is pushed through `f9c525c` to `tumit/FIR-F04a-admin-dashboard`, synchronized with the latest `main`, and open as [PR #58](https://github.com/RaselMridha792/firmivra/pull/58) with title `feat: super admin dashboard (F04a)`. GitHub CI is green. Fahad's pre-review and Rasel's final review are requested and still pending. Dashboard values remain local sample fixtures. This ticket PR has not been merged.

Checklist:

- [x] Recheck the desktop and 375 px layout after the latest interaction changes. Browser screenshots at 1536x1024 and 375x812 show the dashboard fitting each viewport; the mobile document has no horizontal overflow.
- [ ] Confirm the firm site (`app.localhost`) still looks right with the shared shell. The latest-main merge now includes the firm workspace layout, but no firm-site browser/visual check was run for this PR.
- [x] Verify loading, error and retry states with the signed-in layout.
- [x] Run the F04a Playwright suite against the correctly host-routed Super Admin dev server: 7/7 tests passed.

#### F04a functional preview behavior

The dashboard controls below work against the F04a sample fixtures; they do not call or claim to represent live API data:

- Search filters the local application, firm and user records. Arrow keys and Enter select results; Escape and the clear button close the results.
- The notification bell opens the sample pending-application alert, shows its unread count and can mark the alert read. Selecting it opens the application review route.
- The growth selector changes the displayed sample date window and chart. The available fixture contains one sample application; active firms and revenue remain zero.
- The pending attention item and existing application/firm actions navigate to their current routes. Platform Settings opens an explanation because its route/API is not part of F04a. Metrics with no route/data do not show fake links.
- Search and notification fixtures live beside the F04a dashboard in `admin/(console)/_components/dashboard-data.ts`. The shared app shell receives these props only from the Super Admin layout, so the firm workspace keeps its existing header behavior.

#### F04a verification record (Oct 7, 2026)

- GitHub CI for PR #58 passed formatting, lint, typecheck, repository tests and production build. The first run exposed the logo's missing static-image type declaration on a clean runner; `apps/web/src/components/app-shell/next-image.d.ts` fixes it.
- TypeScript check passed: `node node_modules/typescript/bin/tsc --noEmit` from `apps/web`.
- ESLint passed for the changed shell, dashboard, layout, data and Playwright files.
- Playwright coverage includes desktop/mobile layout, search, notification read state, chart range selection, settings preview, pending-task navigation, and loading/error/retry states. After the latest-main merge, all 7 cases reported `ok` in Chromium against the local F04a dev server on port 3001. The temporary runner did not exit during dev-server teardown and was interrupted after all cases completed; rerun with the standard repository command before final merge. The temporary Playwright config was removed after verification.
- The test mocks `GET /api/v1/admin/me`; this verifies the F04a UI and auth-state handling, not backend availability or live dashboard data. Dashboard metrics and records remain sample fixtures.
- The 1536x1024 desktop and 375x812 mobile screenshots were reviewed. The mobile document width stays within 375 px. The latest-main merge includes the firm workspace layout, but the firm shared-shell visual check remains open.
- In local development, Super Admin routes use the `admin.localhost` host. Bare `localhost` is not assigned to an app area by `src/proxy.ts`, so `/applications` there returns 404 by design; use `http://admin.localhost:<port>/applications` instead. The F04a branch's applications page is still the F04b placeholder.
- Run the owned spec with `pnpm --filter @firmivra/web test:e2e -- tumit-dashboard.spec.ts` when the repository package manager is available; rerun backend-authenticated checks against the real dev API when credentials and the service are available.

### F04b · Oct 8 · Firm applications

- **Pages:** `/applications` and `/applications/[id]`, in `admin/(console)/applications/`.
- **Mockups:** `Firm application.png` (list), `When firm aplication is open.png` (detail), `Firm approved.png` (after approval), all in `docs/mockups/super-admin/`.
- **API:** R4's `api.firmApplications.*` (contract by Oct 8; mock until it merges).
- **Build:** stat cards; tabs All, Pending, Approved, Declined with counts; search, status and date filters; table with paging. Detail page with all application fields, automated checks, internal notes and history. Actions Approve, Request Information (with a message) and Decline (with a reason), each with a confirm dialog.

Checklist:

- [ ] Buttons disabled while a request is running
- [ ] After an action, the list and the counts refresh
- [ ] An unknown id shows not-found
- [ ] Playwright: approve an application in mock mode

### N04 · Oct 9 · Public firm application form, and the firms list

- **Pages:** on the firm site, without sign-in: `/welcome` (three cards: Welcome back to sign in, Create a business account to apply, First sign-in to activate; PROJECT-DRAFT-v2.md screen 1), `/apply` (the form, with a review step at the end) and `/apply/done` (thank you). Super Admin `/firms`. Files in `firm/welcome/`, `firm/apply/` and `admin/(console)/firms/`.
- **Mockup:** none for the form. The fields come from R4's contract (they follow `docs/PROJECT-DRAFT-v2.md`, journey stage 2); use the style of the Super Admin screens. Firms list: Active, Pending Setup and Inactive, with search.
- **API:** R4's `api.firmApplications.submit` (public) and the Super Admin firms list.

Checklist:

- [ ] Clear validation messages
- [ ] Submitting twice is impossible
- [ ] The thank-you page says what happens next
- [ ] EIN masked on the review step

### F05 · Oct 10-11 · Setup wizard, settings and team

- **Pages:** `/setup` (5 steps, the new owner's first sign-in), `/settings/profile`, `/settings/branding`, `/settings/portal`, `/settings/legal` and `/team`. Files in `firm/setup/` (its own layout, without the sidebar), `firm/(workspace)/settings/` and `firm/(workspace)/team/`. The reference screen `/settings/tax-statuses` already exists: copy its patterns.
- **Mockup:** none. Steps from `docs/PROJECT-DRAFT-v2.md` line 108: Branding (logo, portal name, colours, preview), Business details (legal name locked), Team and access, Client portal (header, features, welcome message), Finish. Save Draft and Back on every step.
- **API:** the lead's T02 (settings, branding, legal documents, setup progress), T03 (team), T04 (tax statuses) and R2's invites (`staffAuth.createInvite`).
- **Build:** the wizard, saving progress per step; settings pages for the same fields; Terms and Privacy as versioned text (publish a new version, see older ones); the team list with invite (Owner invites Admin or Staff, Admin invites Staff), change role, deactivate and resend.

Checklist:

- [ ] The wizard works while the firm is still Pending Setup
- [ ] Owner and Admin only; staff see the no-permission state
- [ ] Playwright: finish the wizard in mock mode

### F09 · Oct 12-13 · Firm calendar and availability

- **Pages:** `/calendar` and `/settings/availability`, in `firm/(workspace)/`.
- **Mockup:** none.
- **API:** R12's `api.appointments.*` and availability (contract by Oct 10).
- **Build:** day and week views as a simple grid from `@firmivra/ui` (ask Rasel before adding a calendar package); appointment detail (client, type, location or video details); create, reschedule and cancel; each staff member's working hours and blocked time. Show a clear message when someone else just took a slot.

### N08 · Oct 14 · Portal appointments

- **Pages:** portal `/{firm}/appointments`, in `portal/[firmSlug]/(client)/appointments/`.
- **API:** R12 (types, free slots, book, reschedule, cancel).
- **Build:** pick a type, then a free slot, then confirm; upcoming appointments with reschedule and cancel where allowed; in the firm's branding.

### Q03 · Oct 15-16 · Full test pass on dev (with Ibrahim)

You take the Super Admin site and the firm workspace; Ibrahim takes the portal and Begin Online. For every screen:

- [ ] Matches its mockup at desktop and 375 px
- [ ] Each role (Owner, Admin, Staff, Client, Super Admin) sees only what it should
- [ ] A firm B user who opens a firm A URL gets not-found
- [ ] One GitHub issue per bug (Bug template), no real data in it
- [ ] Re-test the fixed bugs on Oct 16 afternoon

## Dev sites

- https://admin.dev.firmivra.com (Super Admin)
- https://app.dev.firmivra.com (firm workspace)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
