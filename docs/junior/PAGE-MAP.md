# Page map

Firmivra · Oct 6, 2026 (evening) · who builds which page, and in which file.

## How it works

- Rasel's sessions create every page below as a placeholder inside the right layout (R1 the first ones; R13-web and R14 their own Firm Sign and calculator pages): sidebar, header, footer, the sign-in check and the menu links are done for you.
- You open your page file, replace the `<PagePlaceholder>` with the screen from its mockup, and put the screen's parts in a `_components/` folder next to the page (Next.js ignores folders that start with `_`).
- `page.tsx` stays a small server file with its `metadata` title line (the tests check each page by its tab title): no `'use client'`, `redirect()` or `notFound()` in `page.tsx`, and no title or title template in any layout except the root layout's default. A page opened straight from its URL (verify-email, verify-phone, sign-up/done, apply/done, begin/done, begin/resume, reset-password, activate) never navigates away by itself. Keep what the tests read: the nav "Main" and `AppShell`; `data-testid="firm-name"`; the header's `me-email`, the user-menu button with the role and its "Sign out"; the portal greeting "Welcome back, <first name>!"; the "Intake Form" tab; the quick sign-in buttons with the email; the sign-in headings "Super Admin console", "Firm workspace" and "Client portal: <slug>".
- Change only the files listed under your name in "Your files" at the end. CI fails a PR from your branch that changes anything else.
- Never create, move or rename a route, a layout or a page folder. A page is missing or in the wrong place? Ask Rasel, and the page's owner adds it (R1, or R13-web and R14 for their pages).
- Colours, fonts and spacing come from the tokens in `packages/ui` (Fahad's F01). Never fix a colour inside your page. A colour that looks wrong everywhere is a token: tell Fahad.
- If the placeholders are not on main yet when you start, build your parts in your `_components/` folder and don't create the page files yourself.

Paths below are inside `apps/web/src/app/`. Mockups are in `docs/mockups/`. A folder name in brackets, like `(console)`, is a route group: it holds a layout and never appears in the URL.

## Super Admin site: admin.dev.firmivra.com

| URL | File | Owner | Ticket | Mockup |
| --- | --- | --- | --- | --- |
| `/sign-in` | `admin/sign-in/page.tsx` | Fahad | F02 | `super-admin/Super login.png` |
| `/forgot-password` | `admin/forgot-password/page.tsx` | Fahad | F02 | same style |
| `/reset-password` | `admin/reset-password/page.tsx` | Fahad | F02 | same style |
| shell (sidebar, header) | `admin/(console)/layout.tsx` and `components/app-shell/` | Tumit polishes | F04a | `super-admin/Dashboard Active .png` |
| `/` | `admin/(console)/page.tsx` | Tumit | F04a | `super-admin/Dashboard Active .png` |
| `/applications` | `admin/(console)/applications/page.tsx` | Tumit | F04b | `super-admin/Firm application.png` |
| `/applications/[id]` | `admin/(console)/applications/[id]/page.tsx` | Tumit | F04b | `super-admin/When firm aplication is open.png`, `Firm approved.png` |
| `/firms` | `admin/(console)/firms/page.tsx` | Tumit | N04 | none |

Sidebar: Dashboard, Firm Applications (pending count), Firms. Then Sales, Leads / CRM, Team, Subscriptions, Billing, Support, Reports & Analytics, Notifications, Audit & Security and System Settings with a "Soon" badge: they open nothing.

## Firm workspace: app.dev.firmivra.com

Pages without the sidebar:

| URL | File | Owner | Ticket | Mockup |
| --- | --- | --- | --- | --- |
| `/sign-in` | `firm/sign-in/page.tsx` | Fahad | F02 | `super-admin/Super login.png`, Firmivra brand |
| `/forgot-password` | `firm/forgot-password/page.tsx` | Fahad | F02 | same style |
| `/reset-password` | `firm/reset-password/page.tsx` | Fahad | F02 | same style |
| `/activate` | `firm/activate/page.tsx` | Fahad | F02 | same style |
| `/welcome` | `firm/welcome/page.tsx` | Tumit | N04 | none (three cards) |
| `/apply` | `firm/apply/page.tsx` | Tumit | N04 | none |
| `/apply/done` | `firm/apply/done/page.tsx` | Tumit | N04 | none |
| `/setup` | `firm/setup/page.tsx` (signed in, own layout without the sidebar) | Tumit | F05 | none |
| `/firm-sign/in-person/[requestId]` (kiosk: the client signs on the staff's device) | `firm/(kiosk)/firm-sign/in-person/[requestId]/page.tsx` and `firm/(kiosk)/layout.tsx` | R13-web | Firm Sign | Firm Sign spec |

Pages with the sidebar, in `firm/(workspace)/`:

| URL | File | Owner | Ticket | Mockup |
| --- | --- | --- | --- | --- |
| shell | `firm/(workspace)/layout.tsx` (the firm's menu) and `components/app-shell/` (the look, Tumit's) | Fahad: menu | F03 | Super Admin style |
| `/` | `(workspace)/page.tsx` | Fahad | F03 | none |
| `/clients` | `(workspace)/clients/page.tsx` | Fahad | F06 | none |
| `/clients/[id]` | `(workspace)/clients/[id]/layout.tsx` (client header and tabs) and `page.tsx` (overview, contact, profile) | Fahad | F06 | none |
| `/clients/[id]/documents` | `(workspace)/clients/[id]/documents/page.tsx` | Fahad | F07 | none |
| `/clients/[id]/messages` | `(workspace)/clients/[id]/messages/page.tsx` (messages and internal notes) | Nahid | F10 | `client-portal/Messages and notes.png` for style |
| `/clients/[id]/invoices` | `(workspace)/clients/[id]/invoices/page.tsx` | Fahad | F10 | `client-portal/invoices tab.png` for style |
| `/sign-ups` | `(workspace)/sign-ups/page.tsx` | Fahad | F06 | none |
| `/messages` | `(workspace)/messages/page.tsx` | Nahid | F10 | none |
| `/invoices` | `(workspace)/invoices/page.tsx` | Fahad | F10 | none |
| `/workspaces` | `(workspace)/workspaces/page.tsx` | Fahad | F11 | none |
| `/workspaces/[engagementId]` | `(workspace)/workspaces/[engagementId]/page.tsx` | Fahad | F11 | none |
| `/leads` | `(workspace)/leads/page.tsx` | Arfan | F08 | none |
| `/leads/[id]` | `(workspace)/leads/[id]/page.tsx` | Tumit | F08 | none |
| `/calendar` | `(workspace)/calendar/page.tsx` | Tumit | F09 | none |
| `/team` | `(workspace)/team/page.tsx` | Tumit | F05 | none |
| `/audit-log` (Owner and Admin) | `(workspace)/audit-log/page.tsx` | Tumit | F12 | none |
| `/firm-sign` (dashboard) | `(workspace)/firm-sign/page.tsx` | R13-web | Firm Sign | `FirmSign_Dashboard_Mockup.png` (Octavia's Oct 8 files) |
| `/firm-sign/new` | `(workspace)/firm-sign/new/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/requests` | `(workspace)/firm-sign/requests/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/requests/[id]` | `(workspace)/firm-sign/requests/[id]/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/requests/[id]/prepare` | `(workspace)/firm-sign/requests/[id]/prepare/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/templates` | `(workspace)/firm-sign/templates/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/templates/[id]` | `(workspace)/firm-sign/templates/[id]/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/bulk` | `(workspace)/firm-sign/bulk/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/reports` | `(workspace)/firm-sign/reports/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/firm-sign/settings` | `(workspace)/firm-sign/settings/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/clients/[id]/signatures` | `(workspace)/clients/[id]/signatures/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/settings` | `(workspace)/settings/layout.tsx` (settings menu) and `route.ts` (`/settings` opens Profile) | R1 | | |
| `/settings/profile` | `(workspace)/settings/profile/page.tsx` | Tumit | F05 | none |
| `/settings/branding` | `(workspace)/settings/branding/page.tsx` | Tumit | F05 | none |
| `/settings/portal` | `(workspace)/settings/portal/page.tsx` | Tumit | F05 | none |
| `/settings/legal` | `(workspace)/settings/legal/page.tsx` | Tumit | F05 | none |
| `/settings/availability` | `(workspace)/settings/availability/page.tsx` | Tumit | F09 | none |
| `/settings/payments` (Owner connects, Admin reads only, Staff never see it) | `(workspace)/settings/payments/page.tsx` | R16 | R7 Stripe | none |
| `/settings/tax-statuses` | `(workspace)/settings/tax-statuses/` (the reference screen) | R1 | kit | none |

Sidebar: Dashboard, Clients, Sign-ups, Leads, Messages, Calendar, Invoices, Workspaces, Team, Audit log, Settings. Sign-ups, Team, Audit log and Settings show only for Owner and Admin.

- "Firm Sign" shows only when `api.esign.status()` says enabled. Fahad adds that menu line in F06, with the client page's "Send for Signature" button and its "Signatures" tab link.
- "Payments" (Owner and Admin) is one line in `settings/layout.tsx`. R16 adds it in the /settings/payments PR; the rest of that file stays R1's.

## Client portal: portal.dev.firmivra.com/{firm}

`{firm}` is the firm's slug, for example `lvp`. Every portal page sits under `portal/[firmSlug]/`, whose `layout.tsx` loads the firm, shows not-found for an unknown slug and sets the firm's colours (Nahid polishes it in N01).

Public pages (firm header and footer, no sidebar), in `portal/[firmSlug]/(public)/`:

| URL | File | Owner | Ticket | Mockup (`client-portal/` or `begin-online/`) |
| --- | --- | --- | --- | --- |
| header and footer | `(public)/layout.tsx` | R17 (Rasel) | N01 | `Client portal landing page.png` |
| `/{firm}` | `(public)/page.tsx` | R17 (Rasel) | N01 | `Client portal landing page.png` |
| `/{firm}/sign-in` | `(public)/sign-in/page.tsx` | R17 (Rasel) | N03 | sign-up style |
| `/{firm}/forgot-password` | `(public)/forgot-password/page.tsx` | R17 (Rasel) | N03 | sign-up style |
| `/{firm}/reset-password` | `(public)/reset-password/page.tsx` | R17 (Rasel) | N03 | sign-up style |
| `/{firm}/sign-up` | `(public)/sign-up/page.tsx` | R17 (Rasel) | N02 | `LVP Client Portal Sign-Up Page.png` |
| `/{firm}/sign-up/verify-email` | `(public)/sign-up/verify-email/page.tsx` | R17 (Rasel) | N02 | `Verify email .png` |
| `/{firm}/sign-up/verify-phone` | `(public)/sign-up/verify-phone/page.tsx` | R17 (Rasel) | N02 | `Verify phone.png` |
| `/{firm}/sign-up/done` (also where a pending client lands after sign-in) | `(public)/sign-up/done/page.tsx` | R17 (Rasel) | N02 | `LVP Client Portal Account Confirmation.png` |
| `/{firm}/begin` | `(public)/begin/page.tsx` | R22 (Rasel; from Arfan) | N07a | `Begin online.png` |
| `/{firm}/begin/annual-tax` | `(public)/begin/annual-tax/page.tsx` | R22 (Rasel; from Arfan) | N07a | `Annual Intake Form 1.png` to `Annual Tax Intake Form 4.png` |
| `/{firm}/begin/quarterly-tax` | `(public)/begin/quarterly-tax/page.tsx` | R22 (Rasel; from Arfan) | N07b | `business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png` |
| `/{firm}/begin/bookkeeping` | `(public)/begin/bookkeeping/page.tsx` | R22 (Rasel; from Arfan) | N07b | the 4 `Bookkeeping ...` files |
| `/{firm}/begin/payroll` | `(public)/begin/payroll/page.tsx` | R22 (Rasel; from Arfan) | N07b | the 3 `Payroll ...` files |
| `/{firm}/begin/tax-planning` | `(public)/begin/tax-planning/page.tsx` | R22 (Rasel; from Arfan) | N07b | the 4 `Tax planning ...` files |
| `/{firm}/begin/business-development` | `(public)/begin/business-development/page.tsx` | R22 (Rasel; from Arfan) | N07b | the 4 `Development intake ...` files |
| `/{firm}/begin/resume` | `(public)/begin/resume/page.tsx` | R22 (Rasel; from Arfan) | N07c | none |
| `/{firm}/begin/done` | `(public)/begin/done/page.tsx` | R22 (Rasel; from Arfan) | N07c | `Success Tax Prep.png`, `Success Page for all services except taxes.png` |
| form blocks for all six services | `(public)/begin/_blocks/` | R22 (Rasel; from Arfan) | N07a | |
| `/{firm}/calculators` (hub) | `(public)/calculators/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculators/tax-return` | `(public)/calculators/tax-return/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculators/quarterly-estimate` | `(public)/calculators/quarterly-estimate/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculators/tax-bracket` | `(public)/calculators/tax-bracket/page.tsx` | R14 | calculators | none yet |

The public calculator pages need no sign-in, and the firm's `calculators` module must be on.

Signer pages (firm branding, no sidebar, no sign-in, noindex), in `portal/[firmSlug]/(signing)/`:

| URL | File | Owner | Ticket | Mockup |
| --- | --- | --- | --- | --- |
| `/{firm}/sign` (the signing link; the token stays in the URL fragment) | `(signing)/sign/page.tsx` and `(signing)/layout.tsx` | R13-web | Firm Sign | Firm Sign spec |

Signed-in pages (sidebar, header, footer), in `portal/[firmSlug]/(client)/`:

| URL | File | Owner | Ticket | Mockup (`client-portal/`) |
| --- | --- | --- | --- | --- |
| shell | `(client)/layout.tsx` | R17 (Rasel) | N01 | `My docs tab.png` |
| folder tabs and right column | `(client)/(tabs)/layout.tsx` | R17 (Rasel) | N01 | `My docs tab.png` |
| `/{firm}/home` | `(client)/home/route.ts` (opens Intake Forms) | R1 | | |
| `/{firm}/intake` | `(client)/(tabs)/intake/page.tsx` | R17 (Rasel) | N06 | `Intake form tab.png` |
| `/{firm}/business` | `(client)/(tabs)/business/page.tsx` | R17 (Rasel) | N09 | `Business Tab.png` |
| `/{firm}/documents` | `(client)/(tabs)/documents/page.tsx` | R17 (Rasel) | N05 | `My docs tab.png`, `Upload docs popup.png` |
| `/{firm}/taxes` | `(client)/(tabs)/taxes/page.tsx` | R17 (Rasel) | N06 | `Taxes tab.png` |
| `/{firm}/invoices` | `(client)/(tabs)/invoices/page.tsx` | R17 (Rasel) | N09 | `invoices tab.png` |
| `/{firm}/messages` | `(client)/(tabs)/messages/page.tsx` | R17 (Rasel) | N09 | `Messages and notes.png` |
| `/{firm}/appointments` | `(client)/appointments/page.tsx` | Tumit | N08 | none |
| `/{firm}/services` | `(client)/services/page.tsx` | R17 (Rasel) | N06 | none |
| `/{firm}/profile` | `(client)/profile/page.tsx` | R17 (Rasel) | N05 | `My profile.png` |
| `/{firm}/resources/startup-guide` | `(client)/resources/startup-guide/page.tsx` | R17 (Rasel) | N10 | ` Business Startup Guide Dashboard.png` |
| `/{firm}/resources/record-keeping` | `(client)/resources/record-keeping/page.tsx` | R17 (Rasel) | N10 | `Record Keeping Best Practices Dashboard.png` |
| `/{firm}/resources/payroll` | `(client)/resources/payroll/page.tsx` | R17 (Rasel) | N10 | `payroll_resources_dashboard.png` |
| `/{firm}/resources/tax-deductions` | `(client)/resources/tax-deductions/page.tsx` | R17 (Rasel) | N10 | `LVP_Tax_Deductions_Small_Businesses.png` |
| `/{firm}/resources/external-links` | `(client)/resources/external-links/page.tsx` | R17 (Rasel) | N09 | `External links .png` |
| `/{firm}/calculator` (the signed-in hub) | `(client)/calculator/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculator/tax-return` | `(client)/calculator/tax-return/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculator/quarterly-estimate` | `(client)/calculator/quarterly-estimate/page.tsx` | R14 | calculators | none yet |
| `/{firm}/calculator/tax-bracket` | `(client)/calculator/tax-bracket/page.tsx` | R14 | calculators | none yet |
| `/{firm}/signatures` (Signature center) | `(client)/signatures/page.tsx` | R13-web | Firm Sign | Firm Sign spec |
| `/{firm}/notifications` | `(client)/notifications/page.tsx` | R17 (Rasel) | N10 | none |

Sidebar: Home, My Documents, Intake Forms, Messages (unread count), Appointments, Invoices & Payments, My Services, My Profile, Log Out.
R17 (Rasel) adds two menu lines in `(client)/layout.tsx`: "Signatures", shown only when `api.esign.status()` says enabled, and "Tax Calculators", shown only when the client's calculator list isn't empty. R14 owns the eight calculator files (the public hub and three calculators, the signed-in hub and three calculators).
Folder tabs: Intake Form, Business Documents & Resources, My Uploaded Documents, Tax Returns, Receipts & Invoices, Messages and Notes.

## Shared code

| What | Where | Owner |
| --- | --- | --- |
| Design tokens and core components | `packages/ui/` | Fahad |
| Sidebar, header and user menu for the Super Admin and firm sites | `apps/web/src/components/app-shell/` | R1 creates it, Tumit polishes it (F04a) |
| Sign-in, MFA, reset and activate screens for the firm and Super Admin sites | `apps/web/src/components/auth/` | Fahad (F02) |
| Notification bell wiring (the portal reuses it) | `apps/web/src/components/notification-bell.tsx` | Fahad (F07) |
| Page placeholder, data hooks, `PageState`, `errorMessage`, mock mode | `apps/web/src/components/`, `apps/web/src/lib/` | R1: don't change |
| API functions and mock data | `packages/types/`, `apps/web/src/lib/api.ts`, `apps/web/src/mocks/` | the API sessions: don't change |

## Your files

These are the only files a PR from your branch may change. A folder means everything inside it.

**Fahad**
- `packages/ui/`
- `apps/web/src/components/auth/`, `apps/web/src/components/sign-in-panel.tsx`, `apps/web/src/components/notification-bell.tsx`
- `apps/web/src/app/admin/sign-in/`, `admin/forgot-password/`, `admin/reset-password/`
- `apps/web/src/app/firm/sign-in/`, `firm/forgot-password/`, `firm/reset-password/`, `firm/activate/`
- `apps/web/src/app/firm/(workspace)/layout.tsx` (the firm's menu only), `(workspace)/page.tsx`, `(workspace)/_components/`, `clients/` (except `clients/[id]/signatures/`, R13-web's, and `clients/[id]/messages/`, Nahid's), `invoices/`, `sign-ups/`, `workspaces/`
- `apps/web/e2e/fahad-*.spec.ts`, `apps/web/e2e/mock/fahad-*.spec.ts`, `docs/tasks/FAHAD.md`

**Tumit**
- `apps/web/src/components/app-shell/`
- `apps/web/src/app/admin/(console)/`
- `apps/web/src/app/firm/welcome/`, `firm/apply/`, `firm/setup/`
- `apps/web/src/app/firm/(workspace)/team/`, `audit-log/`, `calendar/`, `leads/[id]/`, `settings/profile/`, `settings/branding/`, `settings/portal/`, `settings/legal/`, `settings/availability/`
- `apps/web/src/app/portal/[firmSlug]/(client)/appointments/`
- `apps/web/e2e/tumit-*.spec.ts`, `apps/web/e2e/mock/tumit-*.spec.ts`, `docs/tasks/TUMIT.md`

**Nahid** (F10's messages, from Oct 9; its invoices pages went to Fahad on Oct 10; the portal pages moved to R17)
- `apps/web/src/app/firm/(workspace)/messages/`
- `apps/web/src/app/firm/(workspace)/clients/[id]/messages/`
- `apps/web/e2e/nahid-*.spec.ts`, `apps/web/e2e/mock/nahid-*.spec.ts`, `docs/tasks/NAHID.md`

**Arfan**
- `apps/web/src/app/portal/[firmSlug]/(public)/begin/`
- `apps/web/src/app/firm/(workspace)/leads/` (the list; `leads/[id]/` is Tumit's)
- `apps/web/e2e/` (all tests, mock-mode ones too: you lead testing), `docs/tasks/ARFAN.md`
