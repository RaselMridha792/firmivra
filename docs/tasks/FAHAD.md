> **Repo notes (Oct 4, 2026).** Read `CLAUDE.md` first; it wins where this doc differs.
> - Mockups: `docs/mockups/begin-online/`, `client-portal/`, `super-admin/` (same file names as Octavia's Drive folders). Specs: `docs/specs/client-portal/`, `super-admin/`, `platform-guide/`.
> - LVP's portal slug is `lvp`: `portal.localhost:3000/lvp` locally, `portal.dev.firmivra.com/lvp` on dev.
> - Route group and folder names in `apps/web` follow the README once the app is scaffolded (Step 6.5).

# Fahad: Frontend task document

Firmivra Phase 1 (beta) · Prepared by Rasel Mridha (Technical Project Manager) · Oct 4, 2026
Beta launch: Jan 8, 2027 · Keep this file at `docs/tasks/FAHAD.md` on your branch.

## 1. Your role

You are a frontend developer. You own the **design system** (`packages/ui`, with Storybook) and the **firm workspace** at `app.firmivra.com`: login, activation, the app shell, the setup wizard, team, clients, pending sign-ups, documents, leads, service workspaces, calendar, messages and invoices on the firm side. You also build the shared notification bell and center, and a few portal pages that reuse your components (Business tab, External Links, resource dashboards).

- **Backend pair:** Tumit (auth, roles, team, sign-ups, audit, appointments, notifications). Agree the API contract with Tumit on day 1 of each sprint.
- **Other APIs you consume:** Ibrahim (clients, documents, services, intake, workspaces, messages, invoices). Agree those contracts with Ibrahim and Nahid at sprint planning.
- **Pre-reviewer:** Nahid reads your PRs before Rasel. You pre-review Nahid's PRs.
- **Final review and merge:** Rasel only.

## 2. Rules that apply to you

**Branches and PRs**

- Create every branch from the latest `main`: `git checkout main && git pull && git checkout -b fahad/FIR-<ticket>-short-name`. Example: `fahad/FIR-42-login-screen`.
- The placeholder ids in this file (like `FIR-S1-F1`) become real GitHub issue numbers when Rasel creates the issues. Use the real number in the branch name.
- Open a pull request from your branch into `main`. Never push to `main`. Only Rasel merges (squash merge).
- CI must be green before review: lint, type check, unit tests, build.
- Keep PRs small: aim for under ~400 changed lines. Split big screens into several PRs (components first, then the page, then the data wiring).
- Every frontend PR includes a **screenshot of your screen next to the mockup** (desktop and mobile width). If there is no mockup, say so and show the screen.
- Ask Nahid for a pre-review before you request Rasel.

**Design rules**

- Screens must match Octavia's mockups. Build the design system first, then real components on top of it.
- Do not invent new design tokens (colours, font sizes, spacing, radii, shadows) inside app code. If you need one, add it to `packages/ui` tokens in its own PR and explain why.
- Firmivra's own UI (Super Admin and firm workspace) is navy, blue and teal. A firm's brand colours apply only to client-facing pages (portal, Begin Online). Build theming so the portal can override brand tokens per firm.
- Every screen has loading (skeleton), empty, error and permission-denied states. Loading must never flash another record's data.

**Data and security rules**

- The frontend never decides access. Hide buttons the user cannot use, but the API is the real check.
- Never store tokens in `localStorage`. Use the auth helper from the repo (Cognito session via secure cookies).
- Never log or show SSNs, EINs or full account numbers. Mask them in the UI.
- Nobody gets AWS access. Run everything locally with Docker (PostgreSQL, s3mock for S3, Mailpit for email; a local key instead of KMS). Follow the README.
- Do not edit `packages/db`, `infra/`, or CI workflows. Ask Rasel through a GitHub issue labelled `infra` if you need a change there.

## 3. Repo map (expected layout; follow the README if it differs)

| Path | What it is | Your access |
| --- | --- | --- |
| `apps/web` | Next.js App Router. One app serves `admin.`, `app.` and `portal.` by host name (middleware picks the route group). | You work here |
| `apps/web/app/(app)/...` | Firm workspace routes (`app.firmivra.com`) | Yours |
| `apps/web/app/(portal)/[firm]/...` | Client portal routes | Nahid's; you add Business tab, External Links, resources in Sprint 4 |
| `apps/web/app/(admin)/...` | Super Admin routes | Nahid's |
| `packages/ui` | Design system: tokens, components, Storybook | Yours (Nahid contributes through PRs you pre-review) |
| `packages/types` | Shared TypeScript types and API contracts (request and response shapes) | Shared; change only as agreed with your pair |
| `apps/api` | NestJS API | Tumit and Ibrahim |
| `packages/db` | Prisma schema and migrations | Rasel only |
| `infra/` | AWS CDK | Rasel only |

Local URLs (expected): `app.localhost:3000`, `portal.localhost:3000/lvp-accounting`, `admin.localhost:3000`, API at `localhost:4000/api/v1`. Storybook at `localhost:6006`.

**Mockups:** Octavia's files are in the shared project folder `client-info/drive-folders/`. Two folder names end with a trailing space: `Client Portal /` and `Super firm login and functuon /`. There are **no mockups for the firm workspace** itself. For firm screens, use the written spec in `Super firm login and functuon /Firmivra_Developer_Directional_Instructions.docx` and `Review this first flow information/Firmivra_Platform_Structure_Developer_Guide.docx`, build from the design system, and Octavia approves at the sprint demo.

## 4. Tickets by sprint

Ticket ids are placeholders: `FIR-S<sprint>-F<number>`. All API paths below are **proposed, agree with your pair** before you build.

### Summary

| Sprint | Dates | Your tickets |
| --- | --- | --- |
| 0 | Oct 5 to Oct 16 | S0-F1 tokens, S0-F2 core components, S0-F3 firm route map |
| 1 | Oct 19 to Oct 30 | S1-F1 login, S1-F2 activate, S1-F3 app shell and role routing, S1-F4 empty dashboard |
| 2 | Nov 2 to Nov 13 | S2-F1 setup wizard, S2-F2 team page, S2-F3 clients list and detail, S2-F4 pending sign-ups |
| 3 | Nov 16 to Nov 27 | S3-F1 client documents, S3-F2 request a document, S3-F3 notification bell and center |
| 4 | Nov 30 to Dec 11 | S4-F1 leads inbox and convert, S4-F2 intake review, S4-F3 service workspace template, S4-F4 portal Business tab, S4-F5 External Links and resource dashboards |
| 5 | Dec 14 to Dec 25 | S5-F1 firm calendar, S5-F2 availability, S5-F3 firm messages and notes, S5-F4 create and send invoice |
| 6 | Dec 28 to Jan 8 | S6-F1 pixel check, S6-F2 acceptance fixes, S6-F3 accessibility and responsive pass |

### Sprint 0: setup and foundations (Oct 5 to Oct 16)

Rasel sets up the repo and CI. Start with the token work on paper or in Figma, then move into `packages/ui` as soon as the repo exists.

**FIR-S0-F1 Design tokens from Octavia's mockups**
- Build: colour, type scale, spacing, radius, shadow and breakpoint tokens. Two palettes: Firmivra (navy, blue, teal) and a firm brand layer (LVP navy and gold/orange) that the portal can override per firm.
- Mockups: all of `Client Portal /` (folder tabs, cards, sidebar), `Super firm login and functuon /Super login.png` and `Dashboard Active .png` (Firmivra palette), `Begin online/Begin online.png` (public pages).
- Colour meaning from Octavia's docs: navy/blue for navigation and actions, light blue for folders and neutral cards, soft yellow only for Business Action Items, green for done/paid, amber for awaiting/due soon, red only for blocking errors and STOP, charcoal for body text.
- Acceptance: tokens exported as CSS variables and a TypeScript object; a Storybook page shows every token; switching the brand layer changes portal colours without touching component code.
- Dependencies: repo from Rasel (end of week 1).

**FIR-S0-F2 Core components in Storybook**
- Build: Button (primary, secondary, outline, danger, link; sizes; loading), Input, Select, Checkbox, Radio, Textarea with counter, Date input, masked input (phone, EIN, SSN), Card, Table (sort, pagination, empty state), Modal, Tabs (folder-tab style), Badge and StatusPill, Sidebar layout, Header with bell and avatar, Stepper, Toast, Skeleton.
- Mockups: `Client Portal /Intake form tab.png`, `Business Tab.png`, `invoices tab.png`, `Upload docs popup.png`, `Super firm login and functuon /Firm application.png`.
- Acceptance: each component has a story with all states; keyboard focus visible; passes the Storybook accessibility check; unit test for interactive components.
- Dependencies: S0-F1.

**FIR-S0-F3 Firm workspace route map**
- Build: a written route list (as a PR to `docs/`) for `app.firmivra.com`: `/`, `/login`, `/create-account` (Nahid), `/activate`, `/admin/dashboard`, `/dashboard`, `/setup`, `/team`, `/clients`, `/clients/[id]`, `/sign-ups`, `/leads`, `/documents`, `/calendar`, `/workspaces/[serviceId]`, `/messages`, `/invoices`, `/settings`. Mark which role sees each one.
- Include the new routes from Octavia's missing requirements: calendar, service workspaces, pending sign-ups.
- For each screen with no mockup, add a short wireframe note (sections and components) so Octavia can approve it.
- Acceptance: Rasel signs off the list; every route maps to a later ticket.

### Sprint 1: sign-in and firm approval (Oct 19 to Oct 30)

Goal: a firm applies, Super Admin approves it, the firm owner activates and logs in.

**FIR-S1-F1 Landing and login screen**
- Build: `app.firmivra.com` landing with three cards (Welcome Back, Create a Business Account, Sign In for the First Time) and `/login`.
- Mockups: none for the firm side. Match the style of `Super firm login and functuon /Super login.png`. Spec: Platform Structure Developer Guide, section 2.
- Acceptance: wrong password shows a generic error; MFA challenge screen if Cognito asks for it; after login the user lands on `/admin/dashboard` (owner, admin) or `/dashboard` (staff); a user of a suspended or pending firm sees a clear blocked message.
- API (consumes, Tumit): Cognito sign-in through the auth helper; `GET /api/v1/me` returns user, role and business.
- Dependencies: Cognito pools and role claims (Tumit S1-T1).

**FIR-S1-F2 /activate screen**
- Build: first-time sign-in for invited staff and for the new firm owner after approval. Verify invite, set password, confirm, done.
- Acceptance: expired or used invite shows a clear message with "ask your admin for a new invite"; password policy shown inline; on success the user goes to `/login` or straight in.
- API (consumes, Tumit): `GET /api/v1/invites/{token}`, `POST /api/v1/auth/activate`.
- Dependencies: Tumit S1-T3.

**FIR-S1-F3 App shell and role routing**
- Build: sidebar, header (bell placeholder, avatar menu, firm name and logo), main area. Middleware that routes by host and role, and blocks routes the role cannot open.
- Sidebar items (beta): Dashboard, Clients, Leads, Documents, Calendar, Services, Messages, Invoices, Team, Settings. Items for later sprints show as disabled.
- Acceptance: staff opening an admin-only URL directly sees a permission page; shell works at 375 px with a collapsible sidebar; no flash of protected content before the session check.
- Dependencies: S1-F1.

**FIR-S1-F4 Empty firm dashboard**
- Build: admin dashboard and staff dashboard with empty-state cards (Clients, Pending sign-ups, Appointments today, Open intake, Unpaid invoices). Cards link to their routes.
- Acceptance: cards render with zero data; first-login owners are redirected to `/setup` (Sprint 2).

### Sprint 2: firm workspace and client sign-up (Nov 2 to Nov 13)

Goal: a firm sets itself up with its own Terms and Privacy, a client signs up on the portal, and the firm approves the account.

**FIR-S2-F1 First-time setup wizard**
- Build: 5 steps with a visible progress indicator: 1 Firm Branding (logo, portal display name, primary and secondary colours, HEX input, preview; legal name locked), 2 Business Details (legal name locked; DBA, entity type, EIN, email, phone, website, address, team size, services, description), 3 Team & Access (add members, roles), 4 Client Portal (portal logo, colours, header style, feature toggles, welcome message, **Terms of Service and Privacy Policy** upload or URL), 5 Finish (checklist, edit any step, Complete Setup).
- Spec: `Firmivra_Developer_Directional_Instructions.docx`, section 4. No mockup.
- Acceptance: shows only on first owner login; each step saves before moving on; Save Draft keeps progress; Back keeps saved values; Complete Setup routes to the dashboard and never shows the wizard again; the portal preview uses the brand layer from S0-F1.
- API (consumes): `GET/PUT /api/v1/business/settings` and `POST /api/v1/business/logo-upload-url` (Ibrahim), `PUT /api/v1/business/legal-documents` (Tumit), `POST /api/v1/team/invites` (Tumit), `POST /api/v1/business/setup/complete` (Ibrahim).
- Dependencies: Ibrahim S1-I1, Tumit S2-T2 and S2-T5.

**FIR-S2-F2 Team page**
- Build: team list (name, email, role, status), invite member, change role, resend invite, deactivate.
- Acceptance: only owner and admin see the page; deactivation asks for confirmation; the last owner cannot be removed or demoted (show the API error).
- API (consumes, Tumit): `GET /api/v1/team/members`, `POST /api/v1/team/invites`, `PATCH /api/v1/team/members/{id}`, `POST /api/v1/team/invites/{id}/resend`.

**FIR-S2-F3 Clients list and client detail**
- Build: clients table (search, filter by type Individual or Business, status, tax status), add client, client detail page with tabs: Profile, Documents (S3), Services (S3), Intake (S4), Tax status, Messages (S5), Invoices (S5), Activity.
- Acceptance: SSN and EIN masked; tax status changes show who changed it and when; pagination works with 500 seeded clients.
- API (consumes, Ibrahim): `GET/POST /api/v1/clients`, `GET/PATCH /api/v1/clients/{id}`, `GET /api/v1/tax-statuses`, `PUT /api/v1/clients/{id}/tax-status`.

**FIR-S2-F4 Pending sign-ups queue**
- Build: list of clients who signed up on the portal and wait for approval (name, email, phone, account type, verified email and phone, date). Approve (optionally link to an existing client record) or Decline with a reason.
- Acceptance: approving sends the client their welcome notice; declining removes the item; a possible duplicate (same email or phone) is flagged.
- API (consumes, Tumit): `GET /api/v1/client-signups?status=pending`, `POST /api/v1/client-signups/{id}/approve`, `POST /api/v1/client-signups/{id}/decline`.

### Sprint 3: documents, services, notifications (Nov 16 to Nov 27)

**FIR-S3-F1 Client documents view (firm side)**
- Build: documents tab on the client detail and a firm-wide documents page. Filters: category, service, year, status, uploaded by (client or firm). Share with client, change status, download.
- Mockups: firm-side none; reuse the table from `Client Portal /Business Tab.png` and statuses (For Your Review, New, Available).
- Acceptance: downloads go through a short-lived signed URL; sharing a document makes it appear in the client's Firm Documents view; status changes are logged.
- API (consumes, Ibrahim): `GET /api/v1/documents?clientId=`, `PATCH /api/v1/documents/{id}`, `GET /api/v1/documents/{id}/download-url`, `POST /api/v1/documents/upload-url`.

**FIR-S3-F2 Request a document**
- Build: modal to request documents from one or many clients (name, category, service, due date, note). Shows per-client success or failure for bulk requests.
- Acceptance: request appears in the client's Next Steps and Business Action Items; bulk result lists each client.
- API (consumes, Ibrahim): `POST /api/v1/document-requests`, `GET /api/v1/document-requests?clientId=`.

**FIR-S3-F3 Notification bell and center (shared UI kit)**
- Build: bell with unread count in the header, dropdown with latest items, full notification center page: read and unread, history, mark one or all as read, click goes to the linked record. Build it in `packages/ui` so Nahid uses the same component in the portal.
- Mockups: none (bell only, in every portal header). Design from the system; Octavia approves at demo.
- Acceptance: count updates when an item is read; empty state; works in workspace and portal themes; story in Storybook.
- API (consumes, Tumit): `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/read-all`.

### Sprint 4: intake, taxes, service workspaces (Nov 30 to Dec 11)

**FIR-S4-F1 Leads inbox, review lead, convert to client**
- Build: list of Begin Online submissions (service, name, email, date, status), lead detail with the read-only intake answers, documents and signature, and Convert to Client (match an existing client or create a new one).
- Acceptance: duplicate match by email, phone or EIN is suggested; converting sends the portal invite; converted leads move to the client record.
- API (consumes): `GET /api/v1/leads`, `GET /api/v1/leads/{id}` (Ibrahim), `POST /api/v1/leads/{id}/convert` (Tumit).

**FIR-S4-F2 Intake review on the client record**
- Build: intake tab on the client detail: list of forms with state (Sent, In Progress, Submitted, Needs Correction, Under Review, Completed, Expired, Archived), view a submitted version, Request Correction (keeps the original), Accept.
- Spec: `Client Portal /Intake form instructions.docx`.
- Acceptance: the client sees Completed only after the firm accepts; correction keeps both versions.
- API (consumes, Ibrahim): `GET /api/v1/clients/{id}/intake-submissions`, `POST /api/v1/intake-submissions/{id}/request-correction`, `POST /api/v1/intake-submissions/{id}/accept`.

**FIR-S4-F3 Service workspace template (Bookkeeping, Tax Planning)**
- Build: one template with status, tasks, documents, notes (internal) and reports. Bookkeeping adds a reconciliation list and report uploads; Tax Planning adds a projections table. Advisory and Payroll come after beta, so keep the template generic.
- Mockups: none. Design from the system; Octavia approves at demo.
- Acceptance: status changes show on the client's My Services; internal notes are never visible to the client.
- API (consumes, Ibrahim): `GET /api/v1/workspaces/{engagementId}`, `.../tasks`, `.../notes`, `.../reports`, `.../reconciliations`, `.../projections`.

**FIR-S4-F4 Portal Business tab**
- Build: "Business Documents, Resources, and Services" folder tab in the portal: documents table, Business Action Items (soft yellow), My Business Services, Helpful Resources, Upcoming Appointment, Recent Activity, Quick Links.
- Mockups: `Client Portal /Business Tab.png`; spec `Business tab instruction.docx`.
- Acceptance: action items come from data and disappear when done; personal (Individual) clients cannot open the tab, even by direct URL.
- API (consumes, Ibrahim): `GET /api/v1/portal/documents?scope=business`, `GET /api/v1/portal/action-items`, `GET /api/v1/portal/services`.

**FIR-S4-F5 External Links and resource dashboards**
- Build: External Links page and the resource pages (Business Startup Guide, Record Keeping, Payroll Resources, Tax Deductions), rendered from data records, not hard-coded. Firm-side editor for external links.
- Mockups: `Client Portal /External links .png`, `Business Startup Guide Dashboard.png`, `Record Keeping Best Practices Dashboard.png`, `payroll_resources_dashboard.png`, `LVP_Tax_Deductions_Small_Businesses.png`; spec `FirmVora_External_Links_Directions.docx`.
- Acceptance: links open in a new tab with `rel="noopener noreferrer"`; clicks are tracked; use the simplified footer (not the old marketing footer).
- API (consumes, Tumit): `GET/PUT /api/v1/resources/external-links`, `GET /api/v1/portal/resources`, `POST /api/v1/portal/resources/{id}/open`.
- Note: resource dashboards move after beta first if Sprint 2 velocity is behind.

### Sprint 5: appointments, messages, billing (Dec 14 to Dec 25)

Heaviest sprint and includes Dec 25. Start the calendar on day 1.

**FIR-S5-F1 Firm calendar**
- Build: day, week and month views per staff member and for the whole firm; create, view, reschedule, cancel an appointment (client, service, staff, time, method: in person, phone or video, location or link).
- Mockups: none. The appointment card in `Client Portal /Business Tab.png` shows the fields.
- Acceptance: a double-booking error from the API is shown clearly; times show in the firm's time zone with the zone label.
- API (consumes, Tumit): `GET/POST /api/v1/appointments`, `PATCH /api/v1/appointments/{id}`, `POST /api/v1/appointments/{id}/cancel`.

**FIR-S5-F2 Staff availability, working hours, blocked time**
- Build: per staff weekly working hours, blocked time ranges, appointment types and lengths.
- Acceptance: blocked time hides slots in the client booking view; staff can edit only their own unless admin.
- API (consumes, Tumit): `PUT /api/v1/staff/{id}/working-hours`, `POST/DELETE /api/v1/staff/{id}/blocked-times`, `GET /api/v1/availability`.

**FIR-S5-F3 Firm messages and notes**
- Build: inbox by client, thread view, reply with attachments, link to a record, bulk message to many clients with per-client results; internal staff notes on the client record (never shown to the client).
- Acceptance: unread counts update; attachments go to Documents; bulk send reports success or failure per client.
- API (consumes, Ibrahim): `GET /api/v1/message-threads`, `GET /api/v1/message-threads/{id}`, `POST /api/v1/message-threads/{id}/messages`, `POST /api/v1/messages/bulk`, `GET/POST /api/v1/clients/{id}/staff-notes`.

**FIR-S5-F4 Create and send invoice**
- Build: invoice list (filters by status), create invoice (client, service, line items, due date), send, view payment history.
- Acceptance: paid status comes only from the API (after Stripe confirms); no manual "mark paid" in beta unless Rasel adds it.
- API (consumes, Ibrahim): `GET/POST /api/v1/invoices`, `POST /api/v1/invoices/{id}/send`, `GET /api/v1/invoices/{id}`.

### Sprint 6: beta hardening and launch (Dec 28 to Jan 8)

No new features.

- **FIR-S6-F1 Pixel check:** compare every firm and shared screen with Octavia's mockups at desktop and 375 px; fix drift. Post a screenshot table in the PR.
- **FIR-S6-F2 Acceptance fixes:** fix the issues Octavia raises during acceptance testing on dev.
- **FIR-S6-F3 Accessibility and responsive pass:** keyboard navigation, focus order, labels, colour contrast on all your screens.

## 5. Working with Claude Code

Open the repo in VS Code and start Claude Code from the repo root. Paste one of these and edit the ticket details.

**New screen from a mockup**

```
Read CLAUDE.md and docs/tasks/FAHAD.md. I am working on ticket FIR-S2-F3 (clients list and client detail).
Build the clients list page in apps/web for app.firmivra.com using only components and tokens from packages/ui.
Do not invent new design tokens or hard-coded colours. If a component is missing, tell me first.
Use the API contract in packages/types for GET /api/v1/clients. Add loading, empty, error and permission-denied states.
Write unit tests for the table filters. Follow the repo's lint and folder conventions. Keep the change under 400 lines.
```

**New design system component**

```
Read CLAUDE.md and docs/tasks/FAHAD.md. Ticket FIR-S0-F2.
Add a Table component to packages/ui with sorting, pagination and an empty state, using the existing tokens only.
Add Storybook stories for every state and a unit test for sorting and paging. Make it keyboard accessible.
```

**Wire a page to the API**

```
Read CLAUDE.md and docs/tasks/FAHAD.md. Ticket FIR-S2-F4 (pending sign-ups queue).
Connect the page to GET /api/v1/client-signups and the approve and decline endpoints using the shared types in packages/types.
Handle API errors with the existing toast. Do not change apps/api, packages/db or infra.
Add tests that mock the API and cover approve, decline and an error.
```

**Match a screenshot**

```
Read CLAUDE.md and docs/tasks/FAHAD.md. Compare the page at apps/web/app/(portal)/[firm]/business with the mockup
"Client Portal /Business Tab.png" (I will attach it). List the differences in spacing, type and colour,
then fix them using existing tokens only. Do not add new tokens.
```

**Before you open a PR**

```
Run lint, type check, tests and build the way CI does (see package.json and the CI workflow).
Fix any failures. Then write a PR description: ticket id, what changed, how to test, and where the screenshots go.
```

## 6. Definition of Done

- [ ] Code merged to `main` by Rasel with CI green
- [ ] UI matches the mockup on desktop and mobile widths (screenshot next to mockup in the PR)
- [ ] Every query is scoped to the current business (tenant isolation test included for new data); on the frontend, no screen reads data outside the current firm and client context
- [ ] Unit tests for business logic; API endpoint covered by an e2e test
- [ ] Audit log entry for any action on client data (the API writes it; check that your screen calls the endpoint that logs)
- [ ] Works on dev.firmivra.com and Rasel has accepted it

Post-beta (not in your tickets): Payroll operations, Advisory workspace, Google and Outlook calendar sync.
