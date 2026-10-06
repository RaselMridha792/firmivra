# Fahad: tasks

Firmivra Phase 1 · updated Oct 6, 2026 (evening) by Rasel · delivery Oct 18, 2026.
Read `docs/junior/GUIDE.md` and `docs/junior/AI-RULES.md` first.

## Your role

Frontend. You own the design system (`packages/ui`, Storybook) and the firm workspace (app.dev.firmivra.com).

From Oct 7, Tumit and Ibrahim build screens too, and Rasel's sessions build every API, so your list is shorter. The Super Admin site, setup wizard, settings, team page and calendar moved to Tumit; the leads inbox moved to Ibrahim.

You are the only one who adds to `packages/ui`. The others ask you for components.

- Pre-review pair: Tumit (you review each other's PRs)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | API (built by Rasel's sessions) |
| --- | --- | --- | --- |
| F01 | Oct 6-7 | Design tokens and core components | none |
| F02 | Oct 7 | Sign-in, MFA and activate (firm and Super Admin) | auth, on main |
| F03 | Oct 8 | Firm app shell and dashboard | `/me` and `/business`, on main |
| F06 | Oct 9-10 | Clients, client record and pending sign-ups | R10, R3 |
| F07 | Oct 11 | Firm documents and the notification bell | R5, R6 |
| F10 | Oct 12-13 | Messages, internal notes and invoices | R11, R7 |
| F11 | Oct 14-15 | Service workspaces | R12 |
| - | Oct 16 | Pixel check of all your screens | |
| - | Oct 17 | Fixes from Octavia's review | |
| - | Oct 18 | Production smoke test | |

Moved to others: F04, F05, F09 and the team page went to Tumit; F08 went to Ibrahim.

## Ticket cards

### F01 · Oct 6-7 · Design tokens and core components

Everyone builds on `packages/ui` from tomorrow, so ship it in two PRs:

- **PR 1, by Oct 7 morning:** colours, type scale, spacing, radii and shadows from the mockups (`docs/mockups/*`), plus Button, Input, Select, Checkbox, Radio, Card and Badge, each with a story.
- **PR 2, by Oct 8:** Table, Modal, Tabs, Toast, Skeleton, EmptyState, Sidebar, Header and Stepper.

Checklist:

- [ ] Components use tokens only (no hex values inside components)
- [ ] Every component has a story
- [ ] Labels on inputs and a visible focus ring
- [ ] Under 400 changed lines per PR

### F02 · Oct 7 · Sign-in, MFA and activate (firm and Super Admin)

- **Pages:** firm site `/sign-in`, `/forgot-password`, `/reset-password`, `/activate`; Super Admin site `/sign-in`, `/forgot-password`, `/reset-password`. Files go under `apps/web/src/app/firm/` and `apps/web/src/app/admin/`. Build the screens once as shared components and use them on both sites.
- **Mockup:** `docs/mockups/super-admin/Super login.png`. The firm sign-in uses the same layout with the Firmivra brand.
- **API (on main):** `staffAuth` and `adminAuth` in `apps/web/src/lib/auth.ts`: `signIn`, `submitMfaCode`, `startMfaSetup`, `forgotPassword`, `resetPassword`, `signOut`. Firm site only: `checkActivation`, `activate`. Contract: `docs/api/auth.yaml`.
- **Build:**
  1. Sign-in form (email, password). The result decides the next screen: `SIGNED_IN` goes home, `MFA_REQUIRED` goes to the code screen, `MFA_SETUP_REQUIRED` goes to MFA setup.
  2. MFA code screen (6 digits), sent with `submitMfaCode`.
  3. First MFA setup: call `startMfaSetup`, show `otpauthUri` with the kit's `<QrCode>` and `secret` as text, then ask for the first code.
  4. Forgot and reset password: show the same success text whether or not the account exists.
  5. `/activate`: the token is in the URL fragment (`#token=...`). Call `checkActivation`, let the person set a password with the rules from `PASSWORD_RULES`, then go to MFA setup.
  6. Keep the local quick sign-in buttons, shown only when `AUTH_MODE` is local.

Checklist:

- [ ] Matches the mockup at desktop and 375 px
- [ ] Errors shown with `errorMessage()`
- [ ] No token, code or password in localStorage, the URL or the console
- [ ] The existing Playwright sign-in tests still pass
- [ ] Split sign-in and activate into two PRs if it goes over 400 lines

### F03 · Oct 8 · Firm app shell and dashboard

- **Pages:** the signed-in firm workspace. The kit already created the route group `apps/web/src/app/firm/(workspace)/` with a placeholder `layout.tsx`: build the shell in that layout, so `/sign-in` and `/activate` stay without it.
- **Mockup:** none for the firm workspace. Follow the Super Admin layout (`docs/mockups/super-admin/Dashboard Active .png`) with the firm's name. Tumit builds that site, so share the sidebar and header with him through `packages/ui`.
- **API (on main):** `api.me()` for the user and role, `api.currentBusiness()` for the firm name.
- **Build:** sidebar by role (Owner and Admin also see Settings and Team), header with the firm name, a bell placeholder and a user menu with sign-out. Dashboard with eight work-queue cards (New clients, Missing documents, Preparation, Review, Signature, Payment, Filing, Completed), showing empty states for now. Signed-out visitors go to `/sign-in`.

Checklist:

- [ ] The sidebar turns into a menu button at 375 px
- [ ] Staff don't see Settings or Team
- [ ] Playwright: the owner sees Settings, staff don't

### F06 · Oct 9-10 · Clients, client record and pending sign-ups

- **Pages:** `/clients`, `/clients/[id]`, `/sign-ups`.
- **API:** R10's `api.clients.*` and R3's pending sign-ups. Both contracts arrive by Oct 8; use mock mode until they merge.
- **Build:** clients list with search and paging. Client record with the tabs Overview, Contact and Profile (this ticket), plus placeholders for Documents (F07), Messages and Invoices (F10). Pending sign-ups queue with approve and decline (Owner and Admin).

Checklist:

- [ ] SSN and EIN masked
- [ ] 403 shows the no-permission state, 404 the not-found state
- [ ] Playwright: search and open a client in mock mode

### F07 · Oct 11 · Firm documents and the notification bell

- **API:** R5's `api.documents.*` and document requests; R6's `api.notifications.*`. Contracts arrive by Oct 10.
- **Build:** client record > Documents tab: list, filter by category and year, download, request a document, request status (Requested, Received, Accepted, Missing with the client's reason). The bell: unread count, list, mark read, open the related record. Put the bell's look in `packages/ui` and its data wiring in one file in `apps/web/src/components/`, so Nahid reuses it in the portal.

### F10 · Oct 12-13 · Messages, internal notes and invoices

- **Mockups (client side, for style):** `docs/mockups/client-portal/Messages and notes.png`, `invoices tab.png`.
- **API:** R11's `api.messages.*` and internal notes, R7's `api.invoices.*`. Contracts arrive by Oct 11-12.
- **Build:** message threads per client with unread counts, compose and reply. Internal notes, visible only to the firm. Invoices: create with lines, send, statuses.

### F11 · Oct 14-15 · Service workspaces

- **API:** R12's `api.workspaces.*` (contract by Oct 10).
- **Build:** Bookkeeping and Tax Planning workspaces per engagement: status, tasks, documents, notes and reports. No mockup: use the shell and the design system.

## Dev sites

- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
