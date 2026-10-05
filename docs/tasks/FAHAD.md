# Fahad: task document (15-day plan)

Firmivra Phase 1 · updated Oct 5, 2026 by Rasel Mridha · delivery Oct 18, 2026
Keep this file at `docs/tasks/FAHAD.md` on your branch.

## Your role

Frontend developer. You own the design system (`packages/ui`, Storybook), the firm workspace (app.dev.firmivra.com) and the Super Admin screens (admin.dev.firmivra.com).

- Pair: Tumit (agree API shapes together before you build)
- Pre-reviewer: Nahid
- Final review and merge: Rasel

## How we work for these 15 days

- One branch per ticket from fresh `main`: `fahad/FIR-F01-short-name`. Rebase on `origin/main` every morning and before the PR.
- Small PRs into `main`, CI green, one PR merged every day if you can. Nahid pre-reviews first, then Rasel reviews and merges.
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
| F01 | Oct 6 | Design tokens and core components |
| F02 | Oct 7 | Firm sign-in, MFA and /activate screens |
| F03 | Oct 8 | App shell and firm dashboard |
| F04 | Oct 9 | Super Admin shell and applications |
| F05 | Oct 10 | First-time setup wizard and settings |
| F06 | Oct 11 | Team, clients and pending sign-ups |
| F07 | Oct 12 | Firm documents and notification bell |
| F08 | Oct 13 | Leads inbox and convert |
| F09 | Oct 14 | Calendar and availability |
| F10 | Oct 15 | Messages, notes and invoices |
| F11 | Oct 16 | Service workspaces and pixel check |
| - | Oct 17 | Fixes from Octavia's review |
| - | Oct 18 | Production smoke test |

## Ticket details

### F01 · Oct 6 · Design tokens and core components

Tailwind preset with colours, type scale, spacing, radii and shadows taken from Octavia's mockups. Components in Storybook: button, input, select, checkbox, card, table, modal, tabs, badge, toast, sidebar, header, empty state, skeleton.

Mockups: All mockup folders under docs/mockups/

### F02 · Oct 7 · Firm sign-in, MFA and /activate screens

Sign-in, MFA code, first-time MFA setup (QR), /activate (set password from invite link), sign-out. Built against Rasel's auth contract `docs/api/auth.yaml`; works locally with the dev token until real auth merges.

Mockups: docs/mockups/super-admin/Super login.png (same style)

### F03 · Oct 8 · App shell and firm dashboard

Sidebar, header with firm name and user menu, routing by role (owner, admin, staff), firm dashboard with summary cards (empty states for now).

Mockups: No mockup: firm workspace spec in docs/specs/

### F04 · Oct 9 · Super Admin shell and applications

Super Admin sign-in (reuse F02), shell, applications list with filters, application detail with approve, request info and decline (Tumit T05 + Rasel R4 APIs).

Mockups: docs/mockups/super-admin/Dashboard Active .png, Firm application.png, When firm aplication is open.png, Firm approved.png

### F05 · Oct 10 · First-time setup wizard and settings

Wizard after activation: firm profile, branding (logo, colours), Terms and Privacy upload/text, tax statuses. Settings pages for the same (Tumit T02, T04).

Mockups: No mockup: docs/specs/

### F06 · Oct 11 · Team, clients and pending sign-ups

Team page with invite, change role, deactivate (T03). Clients list with search and client detail with tabs (I02, I03). Pending sign-ups queue with approve and decline (Rasel R3).

Mockups: No mockup

### F07 · Oct 12 · Firm documents and notification bell

Client documents view, request a document, document status (I05, Rasel R5). Notification bell and center as a shared component in packages/ui: unread count, list, mark read, link to the record (T06). Nahid reuses it in the portal.

Mockups: No mockup

### F08 · Oct 13 · Leads inbox and convert

Leads list from Begin Online, review a lead with its intake answers, convert to client (I06, I07).

Mockups: No mockup

### F09 · Oct 14 · Calendar and availability

Firm calendar (day and week), staff working hours, blocked time, appointment detail (T07).

Mockups: No mockup

### F10 · Oct 15 · Messages, notes and invoices

Firm messages with a client, internal notes, create invoice with lines, send invoice, invoice status (I09, I10).

Mockups: docs/mockups/client-portal/Messages and notes.png, invoices tab.png (client side, for style)

### F11 · Oct 16 · Service workspaces and pixel check

Bookkeeping and Tax Planning workspace: status, tasks, documents, notes, reports (I11). Then pixel check of all your screens against the mockups.

Mockups: No mockup

## Dev sites

- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
