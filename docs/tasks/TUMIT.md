# Tumit: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md` and `docs/junior/PAGE-MAP.md` first. Your page files already exist as placeholders: PAGE-MAP.md lists them.

## Your role

From Oct 7 you build screens and test, like Arfan. Rasel's Claude Code sessions build every API: the lead is finishing your T02-T04 from your branches, and T05-T09 moved to the sessions. Thank you for the T01-T04 work; your field list found real gaps that are being added now. Please don't push to your old `tumit/FIR-T0N` branches any more.

You now own the firm onboarding screens from start to end:

- the public firm application form;
- the Super Admin site (dashboard, applications, firms);
- the setup wizard, settings and team;
- the calendar and appointment screens.

On Oct 15-16 you and Arfan test everything on dev.

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
| Q03 | Oct 15-16 | Full test pass on dev (with Arfan) | |
| - | Oct 17 | Fixes from Octavia's review | |
| - | Oct 18 | Production smoke test | |

## Ticket cards

### F04a · Oct 7 · Super Admin sidebar, header and dashboard

- **Pages:** R1 creates the shell and every Super Admin page (see `docs/junior/PAGE-MAP.md`). The sidebar, header and user menu live in `apps/web/src/components/app-shell/`, shared with Fahad's firm site: you make them match the mockup. The dashboard is `admin/(console)/page.tsx`. Fahad builds the sign-in page (F02).
- **Mockup:** `docs/mockups/super-admin/Dashboard Active .png`.
- **API:** `useMe()` from the layout for the name and role. Everything else is mock data in `apps/web/src/mocks/` for now; R4 publishes the real functions on Oct 8.
- **Build:**
  1. Sidebar exactly like the mockup: Dashboard, Firm Applications (with the pending count), Firms; the other items keep their "Soon" badge.
  2. Header with the search box (no search yet), the bell and the user menu.
  3. Dashboard: the four stat cards, Recent Firm Applications with Review buttons, Quick Actions, Tasks Requiring Attention, System Status and the Platform Modules "Coming Soon" tiles. Show today's date. Leave Platform Growth as an empty card saying "Coming soon" (a chart needs a package; ask Rasel later).

**Status (Oct 8, 2026):** PR #58 is open on `tumit/FIR-F04a-admin-dashboard`. This branch now includes a normal merge of `origin/main` through `a93950a`; the dashboard mock test expectations match the current R4 fixture (4 pending applications, 2 active firms, unavailable user and revenue totals). The focused Playwright assertion passes (1/1); Windows hangs during server teardown, so the runner needs interruption after the passing result. Fresh synthetic-data desktop and 375 px screenshots are embedded in the PR description. Full CI and the path guard passed on code head `c4c11c2`; this documentation refresh is a separate follow-up. Local quick-sign-in E2E remains unverified because the API and database are not running here. Fahad's pre-review and Rasel's final approval are still required; PR #99's R1 admin mock must reach `main` before #58 can merge.

Checklist:

- [x] Close to the mockup at desktop
- [x] At 375 px, the sidebar opens as a drawer and the page has no horizontal overflow (mock-mode Playwright)
- [x] The firm site (app.localhost) still looks right with the same shell at desktop and 375 px (mock mode)
- [x] Signed-in loading, error and retry states (mock-mode Playwright)
- [x] Playwright: the dashboard loads in mock mode

**Visual follow-up (Oct 8):** Compared a 1536 px preview with `Dashboard Active .png` and adjusted the dashboard spacing, card heights, stat icon colours, the Platform Growth "(Beta)" label and the Platform Settings quick action. Platform Growth stays "Coming soon" as the ticket specifies. Ported to main on Oct 8 (F04 polish PR); the shared header and sidebar stay as on main.

### F04b · Oct 8 · Firm applications

- **Pages:** `/applications` and `/applications/[id]`, in `admin/(console)/applications/`.
- **Mockups:** `Firm application.png` (list), `When firm aplication is open.png` (detail), `Firm approved.png` (after approval), all in `docs/mockups/super-admin/`.
- **API:** R4's typed `api.firmApplications.*` contract is on `main`. Use `NEXT_PUBLIC_API_MOCK=firmApplications` for the API-shaped mock until dev data is available.
- **Build:** stat cards; tabs All, Pending, Approved, Declined with counts; search, status and date filters; table with paging. Detail page with all application fields, automated checks, internal notes and history. Actions Approve, Request Information (with a message) and Decline (with a reason), each with a confirm dialog.

Implementation and review details: [PR #111](https://github.com/RaselMridha792/firmivra/pull/111).

Checklist:

- [x] Buttons disabled while a request is running
- [x] After an action, the list and the counts refresh
- [x] An unknown id shows not-found
- [x] Playwright: approve an application in mock mode

**Visual follow-up (Oct 8):** Widened the applications content to the console width, enlarged the headings and table text, and gave the detail actions their approve, request and decline colours (they still show as disabled while a request runs). Checked at 1672 px and 375 px. Ported to main on Oct 8 (F04 polish PR).

### N04 · Oct 9 · Public firm application form, and the firms list

- **Pages:** on the firm site, without sign-in: `/welcome` (three cards: Welcome back to sign in, Create a business account to apply, First sign-in to activate; PROJECT-DRAFT-v2.md screen 1), `/apply` (the form, with a review step at the end) and `/apply/done` (thank you). Super Admin `/firms`. Files in `firm/welcome/`, `firm/apply/` and `admin/(console)/firms/`.
- **Mockup:** none for the form. The fields come from R4's contract (they follow `docs/PROJECT-DRAFT-v2.md`, journey stage 2); use the style of the Super Admin screens. Firms list: Active, Pending Setup and Inactive, with search.
- **API:** R4's `api.firmApplications.submit` (public) and the Super Admin firms list.

Checklist:

- [x] Clear validation messages
- [x] Submitting twice is prevented while the request is running
- [x] The thank-you page says what happens next
- [x] EIN masked on the review step

**Status (Oct 8, 2026):** N04 is on `tumit/FIR-N04-apply-form`; [PR #120](https://github.com/RaselMridha792/firmivra/pull/120) is against `main`. It uses R4's submit/list/count functions, masks the EIN on review, prevents repeat submission while pending, and shows the application receipt and firm-status/search/paging states. After #99, #58 and #111 merged, the branch was merged with `origin/main` at `acf0b00`.

**UI follow-up (Oct 8):** `/firms` follows the supplied Super Admin visual language: serif heading, status cards, count tabs, search, desktop table, mobile firm cards, and paging. `/welcome`, `/apply`, and `/apply/done` use the same UI tokens and card treatment. The progress indicator reflects the two-stage flow (details, then review/submit). N04 has no dedicated page mockup; its route content follows PAGE-MAP. In the merge, the three shared shell files keep the `main` version from #58. The N04 raster banner is removed and the SVG lockup uses only `@firmivra/ui` color and type tokens. The page titles are `Welcome`, `Apply`, and `Application sent`; the firms list shows only each slug.

**Verification (Oct 8):** After the `acf0b00` merge, `pnpm format`, `pnpm lint` and `pnpm typecheck` pass. The inactive-firm assertion is scoped to its row. With the R1 mock Super Admin session from #99, the dashboard and applications mock specs no longer stub `/api/v1/admin/me`, and the non-admin no-permission case is removed because mock mode is always signed in as an admin.

**Review prep:** Fahad/Rasel review remains pending. The N04 diff is above the junior guide's 400-line review target; the PR body calls out the scope for review.

### F05 · Oct 10-11 · Setup wizard, settings and team

- **Pages:** `/setup` (5 steps, the new owner's first sign-in), `/settings/profile`, `/settings/branding`, `/settings/portal`, `/settings/legal` and `/team`. Files in `firm/setup/` (its own layout, without the sidebar), `firm/(workspace)/settings/` and `firm/(workspace)/team/`. The reference screen `/settings/tax-statuses` already exists: copy its patterns.
- **Mockup:** none. Steps from `docs/PROJECT-DRAFT-v2.md` line 108: Branding (logo, portal name, colours, preview), Business details (legal name locked), Team and access, Client portal (header, features, welcome message), Finish. Save Draft and Back on every step.
- **API:** the lead's T02 (settings, branding, legal documents, setup progress), T03 (team), T04 (tax statuses) and R2's invites (`staffAuth.createInvite`).
- **Build:** the wizard, saving progress per step; settings pages for the same fields; Terms and Privacy as versioned text (publish a new version, see older ones); the team list with invite (Owner invites Admin or Staff, Admin invites Staff), change role, deactivate and resend.

Checklist:

- [ ] The wizard works while the firm is still Pending Setup
- [ ] Owner and Admin only; staff see the no-permission state
- [ ] Playwright: finish the wizard in mock mode

**Status (Oct 8, 2026):** The wizard comes in three PRs to stay under 400 lines. Part 1 (`tumit/FIR-F05-setup-wizard`): the step frame with Save draft, Back and Continue, and Branding with a live portal preview. Part 2: Business details and Team. Part 3: Client portal and Finish. Settings and Team pages follow.

### F09 · Oct 12-13 · Firm calendar and availability

- **Pages:** `/calendar` and `/settings/availability`, in `firm/(workspace)/`.
- **Mockup:** none.
- **API:** R12's `api.appointments.*` and availability (contract by Oct 10).
- **Build:** day and week views as a simple grid from `@firmivra/ui` (ask Rasel before adding a calendar package); appointment detail (client, type, location or video details); create, reschedule and cancel; each staff member's working hours and blocked time. Show a clear message when someone else just took a slot.

### N08 · Oct 14 · Portal appointments

- **Pages:** portal `/{firm}/appointments`, in `portal/[firmSlug]/(client)/appointments/`.
- **API:** R12 (types, free slots, book, reschedule, cancel).
- **Build:** pick a type, then a free slot, then confirm; upcoming appointments with reschedule and cancel where allowed; in the firm's branding.

### Q03 · Oct 15-16 · Full test pass on dev (with Arfan)

You take the Super Admin site and the firm workspace; Arfan takes the portal and Begin Online. For every screen:

- [ ] Matches its mockup at desktop and 375 px
- [ ] Each role (Owner, Admin, Staff, Client, Super Admin) sees only what it should
- [ ] A firm B user who opens a firm A URL gets not-found
- [ ] One GitHub issue per bug (Bug template), no real data in it
- [ ] Re-test the fixed bugs on Oct 16 afternoon

## Dev sites

- https://admin.dev.firmivra.com (Super Admin)
- https://app.dev.firmivra.com (firm workspace)
- https://portal.dev.firmivra.com/lvp (LVP client portal)

## Added Oct 8 (Rasel)

### F12 · after N08 (Rasel sets the day) · Firm audit log

- **Page:** `/audit-log` in the firm workspace, `firm/(workspace)/audit-log/page.tsx` (screen 27 in `docs/PROJECT-DRAFT-v2.md`). Owner and Admin only: the menu item shows only to them, like Team and Settings.
- **Mockup:** none: use the style of the Super Admin screens.
- **API:** R12's `api.auditLog.list(query)` (contract in `packages/types/src/audit-log/`, mock in `apps/web/src/mocks/audit-log.ts`, module name `auditLog`). Read-only, newest first. Staff get 403 FORBIDDEN: show the no-permission state.
- **Build:**
  1. A table: when (`at`), who (`actor.name`; "System" when `actor` is null), action, record (`entity.type` and `entity.id`), IP. A row by "Firmivra Support" (`actor.kind` `PLATFORM`) has no person and no IP: show it as is, never look for the person behind it.
  2. Filters: a date range (both ends or neither; neither means the last 30 days; at most 366 days), the action or its start (for example `appointment.` for every appointment action), the person, the record type and id. The contract's schema gives the messages.
  3. Paging: 50 rows a page; pass `nextCursor` back as `cursor` for the next page.
  4. A row's details: its `metadata` (ids only, never passwords or document content) and `requestId`.
  5. Data export (screen 27) is not in this ticket: it has no API yet.

Checklist:

- [ ] Owner and Admin see the log; Staff see the no-permission state
- [ ] A "Firmivra Support" row shows no person and no IP
- [ ] A range over 366 days, or only one end, shows the contract's message before any request
- [ ] Loading, empty and error states
- [ ] Playwright: filter and page through the log in mock mode
