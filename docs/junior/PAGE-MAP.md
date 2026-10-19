# Page map

Firmivra · Oct 6, 2026 (evening), updated Oct 14 (R41) · who builds which page, and in which file.

## How it works

- Rasel's sessions create every page below as a placeholder inside the right layout (R1 the first ones; R13-web and R14 their own Firm Sign and calculator pages): sidebar, header, footer, the sign-in check and the menu links are done for you.
- You open your page file, replace the `<PagePlaceholder>` with the screen from its mockup, and put the screen's parts in a `_components/` folder next to the page (Next.js ignores folders that start with `_`).
- `page.tsx` stays a small server file with its `metadata` title line (the tests check each page by its tab title): no `'use client'`, `redirect()` or `notFound()` in `page.tsx`, and no title or title template in any layout except the root layout's default. A page opened straight from its URL (verify-email, verify-phone, sign-up/done, apply/done, begin/done, begin/resume, reset-password, activate) never navigates away by itself. Keep what the tests read: the nav "Main" and `AppShell`; `data-testid="firm-name"`; the header's `me-email`, the user-menu button with the role and its "Sign out"; the portal greeting "Welcome back, <first name>!"; the "Intake Form" tab; the quick sign-in buttons with the email; the sign-in headings "Super Admin console", "Firm workspace" and "Client portal: <slug>".
- Change only the files listed under your name in "Your files" at the end. CI fails a PR from your branch that changes anything else.
- Never create, move or rename a route, a layout or a page folder. A page is missing or in the wrong place? Ask Rasel, and the page's owner adds it (R1, or R13-web and R14 for their pages). The routes of the six R41 modules (Staff Management, Settings, Appointments, Leads, Intake Forms, Services & Pricing) were all created on Oct 14: see "The six modules" below.
- A page never waits for the backend: build it on the typed mocks (`docs/junior/GUIDE.md`, "Mock first"), and match its design as `docs/design-match.md` says.
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

### Super Admin console modules: Audit & Security, Billing, Subscriptions, Sales, Team, Support and Integrations (Tumit); Communications, Notifications, Reports & Analytics and System Settings (Arfan)

Rasel's decision, Oct 18. Octavia's designs and docx are in `docs/mockups/super-admin/<module>/source/` (`SOURCE-INDEX.md` maps the original names). Every route below exists on main as a title-only placeholder in `apps/web/src/app/admin/(console)/`. The same three route rules as the firm workspace apply: a page gets a route, a tab with its own content gets a route, each wizard step gets a route; modals, drawers, side panels and form panels get none (the docx says which ones). The sidebar items are Tumit's, in the console layout. Pace: 10 pages a day on Oct 18 and Oct 19.

| URL | Folder | Owner | Design file | Docx |
| --- | --- | --- | --- | --- |
| `/audit-security` | `(console)/audit-security/` | Tumit | `audit-security/source/audit-and-security-dashboard.jpg` | `audit-security/source/firmivra-audit-and-security-developer-instructions.docx` §2 (Page A); the supporting areas of §5 are filters of this page |
| `/audit-security/events/[eventId]` | `(console)/audit-security/events/[eventId]/` | Tumit | `audit-security/source/firmivra-security-event-details.jpg`, `audit-security/source/firmivra-audit-security-event-dashboard.jpg` | `audit-security/source/firmivra-audit-and-security-developer-instructions.docx` §3 (Page B) |
| `/audit-security/settings` | `(console)/audit-security/settings/` | Tumit | `audit-security/source/firmivra-security-settings-dashboard.jpg` | `audit-security/source/firmivra-audit-and-security-developer-instructions.docx` §4 (Page C) |
| `/billing` | `(console)/billing/` | Tumit | `billing/source/modern-saas-billing-dashboard.jpg`, `billing/source/firmivra-billing-developer-handoff-mockup.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §6 (Invoices tab) |
| `/billing/invoices/new` | `(console)/billing/invoices/new/` | Tumit | `billing/source/firmivra-create-invoice-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §7 |
| `/billing/invoices/[invoiceId]` | `(console)/billing/invoices/[invoiceId]/` | Tumit | `billing/source/firmivra-invoice-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §8 |
| `/billing/invoices/[invoiceId]/edit` | `(console)/billing/invoices/[invoiceId]/edit/` | Tumit | `billing/source/firmivra-create-invoice-dashboard.jpg` (edit mode) | `billing/source/firmivra-billing-developer-instructions.docx` §7, §8.2 |
| `/billing/recurring` | `(console)/billing/recurring/` | Tumit | `billing/source/firmivra-recurring-invoices-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §9; create and edit are a drawer |
| `/billing/estimates` | `(console)/billing/estimates/` | Tumit | `billing/source/firmivra-estimates-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §10; details are a drawer |
| `/billing/estimates/new` | `(console)/billing/estimates/new/` | Tumit | `billing/source/modern-estimate-creation-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §11 |
| `/billing/estimates/[estimateId]/edit` | `(console)/billing/estimates/[estimateId]/edit/` | Tumit | `billing/source/modern-estimate-creation-dashboard.jpg` (edit mode) | `billing/source/firmivra-billing-developer-instructions.docx` §10.2, §11 |
| `/billing/payments` | `(console)/billing/payments/` | Tumit | `billing/source/firmivra-payments-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §12; payment details are a side panel |
| `/billing/credit-notes` | `(console)/billing/credit-notes/` | Tumit | `billing/source/firmivra-credit-notes-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §13; details are a drawer |
| `/billing/credit-notes/new` | `(console)/billing/credit-notes/new/` | Tumit | `billing/source/credit-note-creation-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §14 |
| `/billing/settings` | `(console)/billing/settings/` | Tumit | `billing/source/firmivra-billing-settings-dashboard.jpg` | `billing/source/firmivra-billing-developer-instructions.docx` §15 |
| `/subscriptions` | `(console)/subscriptions/` | Tumit | `subscriptions/source/firmivra-subscription-management-dashboard.jpg`, `subscriptions/source/firmivra-subscriptions-admin-ui-mockup.jpg` | `subscriptions/source/firmivra-subscriptions-developer-package.docx` §2 to §5; the subscription detail is a panel (§4) |
| `/sales` | `(console)/sales/` | Tumit | `sales/source/firmivra-sales-center-dashboard-3.jpg` | `sales/source/firmivra-sales-pipeline-developer-instructions.docx` §2, §3, §18 to §21 |
| `/sales/pipeline` | `(console)/sales/pipeline/` | Tumit | `sales/source/firmivra-sales-pipeline-dashboard-3.jpg` | `sales/source/firmivra-sales-pipeline-developer-instructions.docx` §4 to §12 (card and list view are one page) |
| `/sales/pipeline/builder` | `(console)/sales/pipeline/builder/` | Tumit | none (no frame) | `sales/source/firmivra-sales-pipeline-developer-instructions.docx` §15 |
| `/sales/opportunities/[opportunityId]` | `(console)/sales/opportunities/[opportunityId]/` | Tumit | none (no frame) | `sales/source/firmivra-sales-pipeline-developer-instructions.docx` §22; Add Lead (§16) is a form panel on the pipeline |
| `/team` | `(console)/team/` | Tumit | `team/source/firmivra-team-management-dashboard-1.jpg`, `team/source/firmivra-team-management-dashboard-2.jpg` | `team/source/firmivre-team-section-developer-instructions.docx` §3; the message modals have no route |
| `/team/new` | `(console)/team/new/` | Tumit | `team/source/creating-team-firmivra-add-team-member-portal.jpg` | `team/source/creating-team-firmivira-team-developer-instructions-download-1.docx` §4, §24 (one form; lower levels see fewer options) |
| `/team/[memberId]/edit` | `(console)/team/[memberId]/edit/` | Tumit | none (no frame) | `team/source/creating-team-firmivira-team-developer-instructions-download-1.docx` §21 |
| `/support` | `(console)/support/` | Tumit | `support/source/modern-saas-support-ticket-dashboard.jpg` | `support/source/firmivra-support-module-developer-instructions-separated-sections.docx` §1 to §2; Create New Support Ticket is a modal (`support/source/create-new-support-ticket-modal.jpg`) |
| `/support/tickets/[ticketId]` | `(console)/support/tickets/[ticketId]/` | Tumit | `support/source/support-ticket-management-dashboard.jpg` | `support/source/firmivra-support-module-developer-instructions-separated-sections.docx` §3 |
| `/support/settings` | `(console)/support/settings/` | Tumit | `support/source/support-settings-admin-dashboard.jpg` | `support/source/firmivra-support-module-developer-instructions-separated-sections.docx` §4 |
| `/communications` | `(console)/communications/` | Arfan | `communications/source/firmivra-communications-dashboard.jpg` | `communications/source/firmivra-communications-developer-handoff.docx` §2 (the Inbox, Assigned, Unassigned, Mentions, All and Scheduled tabs filter one list) |
| `/communications/new` | `(console)/communications/new/` | Arfan | `communications/source/firmivra-new-message-dashboard.jpg` | `communications/source/firmivra-communications-developer-handoff.docx` §6 |
| `/communications/templates` | `(console)/communications/templates/` | Arfan | `communications/source/firmivra-communications-template-dashboard.jpg` | `communications/source/firmivra-communications-developer-handoff.docx` §4 |
| `/communications/templates/new` | `(console)/communications/templates/new/` | Arfan | none (Insert Image is a modal: `communications/source/create-template-image-modal.jpg`) | `communications/source/firmivra-communications-developer-handoff.docx` §5 |
| `/communications/templates/[templateId]/edit` | `(console)/communications/templates/[templateId]/edit/` | Arfan | none (edit mode of Create Template) | `communications/source/firmivra-communications-developer-handoff.docx` §5 |
| `/communications/broadcasts` | `(console)/communications/broadcasts/` | Arfan | `communications/source/broadcasts-dashboard-and-creation-panel.jpg` | `communications/source/firmivra-communications-developer-handoff.docx` §3.1 |
| `/communications/broadcasts/new` | `(console)/communications/broadcasts/new/` | Arfan | `communications/source/firmivra-create-broadcast-dashboard.jpg`, `communications/source/create-broadcast-all-channels-setup.jpg` (step 1) | `communications/source/firmivra-communications-developer-handoff.docx` §3.2 |
| `/communications/broadcasts/new/audience` | `(console)/communications/broadcasts/new/audience/` | Arfan | `communications/source/firmivra-broadcast-audience-dashboard.jpg` (step 2) | `communications/source/firmivra-communications-developer-handoff.docx` §3.2 |
| `/communications/broadcasts/new/message` | `(console)/communications/broadcasts/new/message/` | Arfan | none (step 3) | `communications/source/firmivra-communications-developer-handoff.docx` §3.2 |
| `/communications/broadcasts/new/review` | `(console)/communications/broadcasts/new/review/` | Arfan | `communications/source/create-broadcast-review-dashboard.jpg` (step 4) | `communications/source/firmivra-communications-developer-handoff.docx` §3.2, §3.3 |
| `/integrations` | `(console)/integrations/` | Tumit | `integrations/source/firmivra-integrations-admin-dashboard.jpg` | `integrations/source/firmivra-integrations-developer-guide.docx` §2, §13 (the docx names these routes) |
| `/integrations/platform` | `(console)/integrations/platform/` | Tumit | none (no frame) | `integrations/source/firmivra-integrations-developer-guide.docx` §3 |
| `/integrations/platform/new` | `(console)/integrations/platform/new/` | Tumit | `integrations/source/firmivra-integration-setup-dashboard.jpg` (step 1) | `integrations/source/firmivra-integrations-developer-guide.docx` §4 |
| `/integrations/platform/new/connection` | `(console)/integrations/platform/new/connection/` | Tumit | none (step 2) | `integrations/source/firmivra-integrations-developer-guide.docx` §4 |
| `/integrations/platform/new/settings` | `(console)/integrations/platform/new/settings/` | Tumit | none (step 3) | `integrations/source/firmivra-integrations-developer-guide.docx` §4 |
| `/integrations/platform/new/review` | `(console)/integrations/platform/new/review/` | Tumit | none (step 4) | `integrations/source/firmivra-integrations-developer-guide.docx` §4 |
| `/integrations/platform/[integrationId]` | `(console)/integrations/platform/[integrationId]/` | Tumit | `integrations/source/stripe-integration-admin-dashboard.jpg`, `integrations/source/stripe-integration-admin-dashboard-1.jpg` (Stripe as the example) | `integrations/source/firmivra-integrations-developer-guide.docx` §5 |
| `/integrations/catalog` | `(console)/integrations/catalog/` | Tumit | `integrations/source/customer-integration-catalog-dashboard.jpg` | `integrations/source/firmivra-integrations-developer-guide.docx` §6 |
| `/integrations/catalog/[catalogId]` | `(console)/integrations/catalog/[catalogId]/` | Tumit | none (no frame) | `integrations/source/firmivra-integrations-developer-guide.docx` §7 |
| `/integrations/api-webhooks` | `(console)/integrations/api-webhooks/` | Tumit | none (no frame) | `integrations/source/firmivra-integrations-developer-guide.docx` §8 |
| `/integrations/logs` | `(console)/integrations/logs/` | Tumit | none (no frame) | `integrations/source/firmivra-integrations-developer-guide.docx` §9 |
| `/integrations/usage` | `(console)/integrations/usage/` | Tumit | none (no frame) | `integrations/source/firmivra-integrations-developer-guide.docx` §10 |
| `/notifications` | `(console)/notifications/` | Arfan | `notifications/source/firmivra-notifications-dashboard.jpg` | `notifications/source/firmivra-notifications-page-developer-instructions.docx` §1 to §14 (the category tabs filter one list) |
| `/reports` | `(console)/reports/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Overview tab) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §1 |
| `/reports/firms` | `(console)/reports/firms/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Firms tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §2 |
| `/reports/revenue` | `(console)/reports/revenue/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Revenue tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §7 |
| `/reports/users` | `(console)/reports/users/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Users tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §8 |
| `/reports/feature-usage` | `(console)/reports/feature-usage/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Feature Usage tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §9 |
| `/reports/support` | `(console)/reports/support/` | Arfan | `reports/source/reports-and-analytics-dashboard.jpg` (Support tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §10 |
| `/reports/firms/[businessId]` | `(console)/reports/firms/[businessId]/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Overview tab) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/firms/[businessId]/users` | `(console)/reports/firms/[businessId]/users/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Users tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/firms/[businessId]/subscriptions` | `(console)/reports/firms/[businessId]/subscriptions/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Subscriptions tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/firms/[businessId]/feature-usage` | `(console)/reports/firms/[businessId]/feature-usage/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Feature Usage tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/firms/[businessId]/activity` | `(console)/reports/firms/[businessId]/activity/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Activity tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/firms/[businessId]/support` | `(console)/reports/firms/[businessId]/support/` | Arfan | `reports/source/firm-report-detail-dashboard.jpg` (Support tab, named only) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §3 |
| `/reports/builder` | `(console)/reports/builder/` | Arfan | `reports/source/custom-report-builder-dashboard.jpg` (step 1) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §4 |
| `/reports/builder/fields` | `(console)/reports/builder/fields/` | Arfan | `reports/source/custom-report-builder-dashboard.jpg` (step 2) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §4 |
| `/reports/builder/filters` | `(console)/reports/builder/filters/` | Arfan | `reports/source/custom-report-builder-dashboard.jpg` (step 3) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §4 |
| `/reports/builder/run` | `(console)/reports/builder/run/` | Arfan | `reports/source/custom-report-builder-dashboard.jpg` (step 4) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §4, §5 |
| `/reports/saved` | `(console)/reports/saved/` | Arfan | none (no frame) | `reports/source/firmivira-reports-analytics-developer-instructions.docx` §6 |
| `/system-settings` | `(console)/system-settings/` | Arfan | `system-settings/source/firmivra-system-settings-dashboard.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "System Settings Main Page" |
| `/system-settings/general` | `(console)/system-settings/general/` | Arfan | `system-settings/source/firmivra-general-settings-dashboard.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "General Settings" |
| `/system-settings/branding` | `(console)/system-settings/branding/` | Arfan | `system-settings/source/firmivra-branding-and-appearance-dashboard.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "Branding & Appearance" |
| `/system-settings/email-notifications` | `(console)/system-settings/email-notifications/` | Arfan | `system-settings/source/firmivra-email-and-notifications-settings.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "Email & Notifications" |
| `/system-settings/features` | `(console)/system-settings/features/` | Arfan | `system-settings/source/firmivra-feature-management-dashboard.jpg`, `system-settings/source/firmivra-feature-management-dashboard-1.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "Feature Management" |
| `/system-settings/data-retention` | `(console)/system-settings/data-retention/` | Arfan | `system-settings/source/firmivra-data-and-retention-settings.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "Data & Retention" |
| `/system-settings/configuration` | `(console)/system-settings/configuration/` | Arfan | `system-settings/source/system-configuration-dashboard.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "System Configuration & Maintenance" |
| `/system-settings/defaults` | `(console)/system-settings/defaults/` | Arfan | `system-settings/source/firmivra-default-settings-dashboard.jpg` | `system-settings/source/firmivra-system-settings-developer-instructions.docx` "Default User & Firm Settings" |

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
| `/settings/payments` (Owner connects, Admin reads only, Staff never see it) | `(workspace)/settings/payments/page.tsx` | R16 | R7 Stripe | none |
| `/settings/tax-statuses` | `(workspace)/settings/tax-statuses/` (the reference screen) | R1 | kit | none |

### The six modules: Staff Management, Settings and Appointments (Tumit); Leads, Intake Forms and Services & Pricing (Arfan; five Services & Pricing pages are Fahad's: new, [id], [id]/edit, inactive and packages/new)

Rasel's decision, Oct 14 (R41). Every route below exists on main as a placeholder that shows only the page title, built from `PageHeader`, so nobody waits for anyone: open the file and build the page from its design, on the typed mocks (`docs/junior/GUIDE.md`, "Mock first"). Folders are inside `apps/web/src/app/firm/(workspace)/`. Designs and docx are under `docs/mockups/firm-workspace/`; the docx is Octavia's written instruction for the module (`§` is its section, "Frame" its frame name).

Routes follow three rules: a page gets a route; a tab that shows its own content gets a route; each step of a wizard gets a route. A modal, a drawer, a menu, a bulk bar and a form panel get none: they open from their page. These have no route of their own: Add New Lead, send email and SMS, assign, change status, tags and bulk actions on `/leads`; Invite User and the user action menu on `/settings/users`; the New Appointment quick modal, Send Reminders and Sync Calendar (Integrations) on the calendar; the add-category, add-add-on, service-picker, add-department, add-team, change-head and promotion editors; preview of a template; row menus; the Settings sections inside one page (Intake Form Settings is one page with its eight panels).

| URL | Folder | Owner | Design file | Docx |
| --- | --- | --- | --- | --- |
| `/team` | `team/` | Tumit | `staff-management/source/staff-mangement.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §1 |
| `/team/new` | `team/new/` | Tumit | `staff-management/source/create-staff-account-info.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §2-3 |
| `/team/new/permissions` | `team/new/permissions/` | Tumit | `staff-management/source/create-staff-2.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §4-6 |
| `/team/new/security` | `team/new/security/` | Tumit | `staff-management/source/create-staff-tab-3.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §7 |
| `/team/new/details` | `team/new/details/` | Tumit | `staff-management/source/additinal-details-tab-4.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §8-10 |
| `/team/[id]/created` | `team/[id]/created/` | Tumit | `staff-management/source/succesfully-created-staff.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §11 |
| `/team/[id]` | `team/[id]/` | Tumit | `staff-management/source/edit-staff-account.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §12 |
| `/team/[id]/security` | `team/[id]/security/` | Tumit | `staff-management/source/staff-account-access-and-security.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §14 |
| `/team/[id]/security/login` | `team/[id]/security/login/` | Tumit | `staff-management/source/staff-account-access-and-security.jpg` (Login & Security tab) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §7, §14 |
| `/team/[id]/security/sessions` | `team/[id]/security/sessions/` | Tumit | `staff-management/source/staff-account-access-and-security.jpg` (Active Sessions card) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §14 |
| `/team/[id]/security/history` | `team/[id]/security/history/` | Tumit | `staff-management/source/staff-account-access-and-security.jpg` (Login History card) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §14 |
| `/team/[id]/security/permissions` | `team/[id]/security/permissions/` | Tumit | `staff-management/source/edit-staff-account.jpg` (Access Summary card) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §6, §14 |
| `/team/[id]/security/activity` | `team/[id]/security/activity/` | Tumit | `staff-management/source/staff-account-access-and-security.jpg` (Activity & Audit tab) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §14, §16 |
| `/team/departments` | `team/departments/` | Tumit | `staff-management/source/teams-and-departments.jpg` | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §13 |
| `/team/teams` | `team/teams/` | Tumit | `staff-management/source/teams-and-departments.jpg` (Teams tab) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §13 |
| `/team/org-chart` | `team/org-chart/` | Tumit | `staff-management/source/teams-and-departments.jpg` (Org Chart tab) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §13 |
| `/team/roles` | `team/roles/` | Tumit | `staff-management/source/create-staff-2.jpg` (matrix), settings/source/users-and-role.jpg (role templates) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §5-6 |
| `/team/activity` | `team/activity/` | Tumit | none (reuse Login History and Activity cards of staff-account-access-and-security.jpg) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §14, §16 |
| `/team/import` | `team/import/` | Tumit | none (no frame) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §15 |
| `/team/settings` | `team/settings/` | Tumit | none (no frame) | `staff-management/source/firmvra-staff-management-developer-guide-final.docx` §1, §3 |
| `/settings/overview` | `settings/overview/` | Tumit | `settings/source/settings.jpg` | `settings/source/firmvra-settings-developer-guide-updated.docx` §2-3 |
| `/settings/profile` | `settings/profile/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Company Profile tab) | `settings/source/firmvra-settings-developer-guide-updated.docx` §4 |
| `/settings/branding` | `settings/branding/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Branding & White Label tab) | `settings/source/firmvra-settings-developer-guide-updated.docx` §4 |
| `/settings/portal` | `settings/portal/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Client Portal Branding tab) | `settings/source/firmvra-settings-developer-guide-updated.docx` §4, §11 |
| `/settings/legal` | `settings/legal/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Documents & Legal tab) | `settings/source/firmvra-settings-developer-guide-updated.docx` §4, §11 |
| `/settings/availability` | `settings/availability/` | Tumit | `appointment/source/appointments-overview-and-calendar.jpg` (Edit My Availability panel) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §14 |
| `/settings/users` | `settings/users/` | Tumit | `settings/source/users-and-role.jpg` | `settings/source/firmvra-settings-developer-guide-updated.docx` §5-8 |
| `/settings/users/roles/new` | `settings/users/roles/new/` | Tumit | `settings/source/users-and-role.jpg` (Role Permissions, Module Permissions) | `settings/source/firmvra-settings-developer-guide-updated.docx` §5, §8 |
| `/settings/billing` | `settings/billing/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/settings/communications` | `settings/communications/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Email & Communications tab, named only) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/settings/notifications` | `settings/notifications/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/settings/forms-documents` | `settings/forms-documents/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/settings/workflow` | `settings/workflow/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/settings/security` | `settings/security/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §10 |
| `/settings/data` | `settings/data/` | Tumit | none (no frame) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11-12 |
| `/settings/preferences` | `settings/preferences/` | Tumit | `settings/source/company-profile-branding-and-white-label.jpg` (Preferences tab, named only) | `settings/source/firmvra-settings-developer-guide-updated.docx` §11 |
| `/calendar` | `calendar/` | Tumit | `appointment/source/appointments.jpg` | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §2, §10 |
| `/calendar/list` | `calendar/list/` | Tumit | `appointment/source/appointments.jpg` (List view) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §2, §10 |
| `/calendar/today` | `calendar/today/` | Tumit | `appointment/source/appointments.jpg` (Today view) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §2, §10 |
| `/calendar/new` | `calendar/new/` | Tumit | `appointment/source/appointments-overview-and-calendar.jpg` | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §3-5, §11-12, §16 |
| `/calendar/[id]` | `calendar/[id]/` | Tumit | none (no frame; the calendar chip and the upcoming row open it) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §6, §17 |
| `/calendar/[id]/edit` | `calendar/[id]/edit/` | Tumit | `appointment/source/appointments-overview-and-calendar.jpg` (Edit Existing) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §11, §17 |
| `/calendar/types` | `calendar/types/` | Tumit | none (no frame; Quick Actions "Manage Appointment Types") | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §10 |
| `/calendar/availability` | `calendar/availability/` | Tumit | `appointment/source/appointments-overview-and-calendar.jpg` (Staff Availability panel) | `appointment/source/firmivra-appointments-instructions-fresh-copy.docx` §12-15 |
| `/leads` | `leads/` | Arfan | `leads/source/leads.jpg` | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §2-6 |
| `/leads/[id]` | `leads/[id]/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §1-8 |
| `/leads/[id]/communications` | `leads/[id]/communications/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Communications tab, named only) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §6 |
| `/leads/[id]/appointments` | `leads/[id]/appointments/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Upcoming Appointments card) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §6 |
| `/leads/[id]/tasks` | `leads/[id]/tasks/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Open Tasks card) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §8 |
| `/leads/[id]/documents` | `leads/[id]/documents/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Documents & Forms tab, named only) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/leads/[id]/campaigns` | `leads/[id]/campaigns/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Campaigns tab, named only) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §2, §10 |
| `/leads/[id]/notes` | `leads/[id]/notes/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Notes tab, named only) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §6 |
| `/leads/[id]/activity` | `leads/[id]/activity/` | Arfan | `leads/source/individual-lead-profile-lead-workspace.jpg` (Recent Activity card) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §1, §8 |
| `/leads/[id]/convert` | `leads/[id]/convert/` | Arfan | `leads/source/convert-lead-to-client.jpg` (step 1) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/leads/[id]/convert/details` | `leads/[id]/convert/details/` | Arfan | `leads/source/convert-lead-to-client.jpg` (step 2) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/leads/[id]/convert/portal` | `leads/[id]/convert/portal/` | Arfan | `leads/source/convert-lead-to-client.jpg` (step 3) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/leads/[id]/convert/review` | `leads/[id]/convert/review/` | Arfan | `leads/source/convert-lead-to-client.jpg` (step 4) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/leads/[id]/convert/done` | `leads/[id]/convert/done/` | Arfan | `leads/source/convert-lead-to-client.jpg` (step 5) | `leads/source/firmivra-leads-module-developer-instructions-1.docx` §7 |
| `/intake-forms` | `intake-forms/` | Arfan | `intake-forms/source/intake-forms.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Main page) |
| `/intake-forms/builder/[formId]` | `intake-forms/builder/[formId]/` | Arfan | `intake-forms/source/create-new-intake-form.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 1) |
| `/intake-forms/builder/[formId]/preview` | `intake-forms/builder/[formId]/preview/` | Arfan | `intake-forms/source/create-new-intake-form.jpg` (Preview tab) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 1) |
| `/intake-forms/builder/[formId]/logic` | `intake-forms/builder/[formId]/logic/` | Arfan | `intake-forms/source/create-new-intake-form.jpg` (Logic & Rules tab) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 1) |
| `/intake-forms/send` | `intake-forms/send/` | Arfan | `intake-forms/source/send-intake-form.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 2) |
| `/intake-forms/[id]` | `intake-forms/[id]/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/[id]/responses` | `intake-forms/[id]/responses/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` (Responses tab, named only) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/[id]/documents` | `intake-forms/[id]/documents/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` (Uploaded Documents card) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/[id]/notes` | `intake-forms/[id]/notes/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` (Internal Notes card) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/[id]/communication` | `intake-forms/[id]/communication/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` (Communication tab, named only) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/[id]/history` | `intake-forms/[id]/history/` | Arfan | `intake-forms/source/intake-form-detail-submission-view.jpg` (Activity Timeline card) | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 3) |
| `/intake-forms/templates` | `intake-forms/templates/` | Arfan | `intake-forms/source/form-templates-dashboard.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 4) |
| `/intake-forms/settings` | `intake-forms/settings/` | Arfan | `intake-forms/source/intake-form-settings.jpg` | `intake-forms/source/firmivra-intake-forms-module-developer-instructions-updated.docx` (Frame 5) |
| `/services-pricing` | `services-pricing/` | Arfan | `services-and-pricing/source/services-and-pricing.jpg` | `services-and-pricing/source/services-and-pricing.docx` §2-3 |
| `/services-pricing/inactive` | `services-pricing/inactive/` | Fahad | `services-and-pricing/source/services-and-pricing.jpg` (Inactive Services tab) | `services-and-pricing/source/services-and-pricing.docx` §2 |
| `/services-pricing/categories` | `services-pricing/categories/` | Arfan | none (no frame; tab named in services-and-pricing.jpg) | `services-and-pricing/source/services-and-pricing.docx` §10 |
| `/services-pricing/packages` | `services-pricing/packages/` | Arfan | none (no list frame; tab named in services-and-pricing.jpg) | `services-and-pricing/source/services-and-pricing.docx` §2, §8 |
| `/services-pricing/promotions` | `services-pricing/promotions/` | Arfan | none (no frame; tab named in services-and-pricing.jpg) | `services-and-pricing/source/services-and-pricing.docx` §11 |
| `/services-pricing/new` | `services-pricing/new/` | Fahad | `services-and-pricing/source/add-edit-service.jpg` | `services-and-pricing/source/services-and-pricing.docx` §4-7 |
| `/services-pricing/[id]` | `services-pricing/[id]/` | Fahad | `services-and-pricing/source/add-edit-service.jpg` (Service Preview, View Full Page) | `services-and-pricing/source/services-and-pricing.docx` §3, §4 |
| `/services-pricing/[id]/edit` | `services-pricing/[id]/edit/` | Fahad | `services-and-pricing/source/add-edit-service.jpg` (Edit mode) | `services-and-pricing/source/services-and-pricing.docx` §4-7 |
| `/services-pricing/packages/new` | `services-pricing/packages/new/` | Fahad | `services-and-pricing/source/package-builder.jpg` | `services-and-pricing/source/services-and-pricing.docx` §8-9 |
| `/services-pricing/packages/[id]` | `services-pricing/packages/[id]/` | Arfan | `services-and-pricing/source/package-builder.jpg` (Package Preview, View Full Page) | `services-and-pricing/source/services-and-pricing.docx` §8 |
| `/services-pricing/packages/[id]/edit` | `services-pricing/packages/[id]/edit/` | Arfan | `services-and-pricing/source/package-builder.jpg` (Edit mode) | `services-and-pricing/source/services-and-pricing.docx` §8-9 |

### Ibrahim's four modules: Integrations, Reports, Tax Planning & Strategy, Business Advisory & Development (Ibrahim)

Rasel's decision, Oct 17. Every route below exists on main as a placeholder that shows only the page title, so Ibrahim opens the file and builds the page from its design on the typed mocks. Folders are inside `apps/web/src/app/firm/(workspace)/`; designs and docx are under `docs/mockups/firm-workspace/`. The same three route rules apply. Creating a plan: step 1 is `/plans/new` and saves a draft; the later steps and editing use `/plans/[planId]/edit/...`. No route of their own: Request an Integration (modal), Sync Now and Reconnect, Schedule Report, Save Report and the report filter panel, the overview quick actions (Schedule Consultation, Tax Savings Calculator, Send Client Resource, Add Business Goal, Add Advisory Client), row menus.

| URL | Folder | Owner | Design file | Docx |
| --- | --- | --- | --- | --- |
| `/integrations` | `integrations/` | Ibrahim | `integrations/source/intigrations.jpg` | `integrations/source/integrations-developer-instructions.docx` §2 (Frame 1; the four tabs filter one list, so no routes) |
| `/integrations/marketplace` | `integrations/marketplace/` | Ibrahim | `integrations/source/add-integration-marketplace.jpg` | `integrations/source/integrations-developer-instructions.docx` §5, §7 (Frame 4); "Request an integration not listed" is a modal, §6 |
| `/integrations/[integrationId]` | `integrations/[integrationId]/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Overview tab) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/sync-settings` | `integrations/[integrationId]/sync-settings/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Sync Settings tab, named only) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/data-mapping` | `integrations/[integrationId]/data-mapping/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Data Mapping tab, named only) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/permissions` | `integrations/[integrationId]/permissions/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Permissions tab, named only) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/sync-history` | `integrations/[integrationId]/sync-history/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Sync History tab, named only) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/troubleshooting` | `integrations/[integrationId]/troubleshooting/` | Ibrahim | `integrations/source/manage-integration-u2013-quickbooks-online.jpg` (Troubleshooting tab, named only) | `integrations/source/integrations-developer-instructions.docx` §3 (Frame 2) |
| `/integrations/[integrationId]/connect` | `integrations/[integrationId]/connect/` | Ibrahim | `integrations/source/connect-configure-integration-u2013-microsoft-365.jpg` (step 1, Connect) | `integrations/source/integrations-developer-instructions.docx` §4 (Frame 3) |
| `/integrations/[integrationId]/connect/configure` | `integrations/[integrationId]/connect/configure/` | Ibrahim | `integrations/source/connect-configure-integration-u2013-microsoft-365.jpg` (step 2, Configure) | `integrations/source/integrations-developer-instructions.docx` §4 (Frame 3) |
| `/integrations/[integrationId]/connect/permissions` | `integrations/[integrationId]/connect/permissions/` | Ibrahim | `integrations/source/connect-configure-integration-u2013-microsoft-365.jpg` (step 3, Permissions) | `integrations/source/integrations-developer-instructions.docx` §4 (Frame 3) |
| `/integrations/[integrationId]/connect/complete` | `integrations/[integrationId]/connect/complete/` | Ibrahim | `integrations/source/connect-configure-integration-u2013-microsoft-365.jpg` (step 4, Complete) | `integrations/source/integrations-developer-instructions.docx` §4 (Frame 3) |
| `/reports` | `reports/` | Ibrahim | `reports/source/reports-page.jpg` | `reports/source/firmvra-reports-developer-guide-final-v2.docx` §1-4 (Frame 1) |
| `/reports/[reportId]` | `reports/[reportId]/` | Ibrahim | `reports/source/report-detail-view-report.jpg` | `reports/source/firmvra-reports-developer-guide-final-v2.docx` §5-7 (Frame 2); Schedule Report is a modal |
| `/reports/builder` | `reports/builder/` | Ibrahim | `reports/source/custom-report-builder-1.jpg` | `reports/source/firmvra-reports-developer-guide-final-v2.docx` §13 (Frame 3) |
| `/tax-planning` | `tax-planning/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Overview tab) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §1-4 (Frame 1) |
| `/tax-planning/clients` | `tax-planning/clients/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Clients tab, named only) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §15 |
| `/tax-planning/opportunities` | `tax-planning/opportunities/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Planning Opportunities tab, named only) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §3, §15 |
| `/tax-planning/strategies` | `tax-planning/strategies/` | Ibrahim | none (no frame) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §15 (a supporting tab the overview design does not show) |
| `/tax-planning/calendar` | `tax-planning/calendar/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Tax Calendar tab, named only) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §4, §15 |
| `/tax-planning/resources` | `tax-planning/resources/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Resources tab, named only) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §4, §15 |
| `/tax-planning/reports` | `tax-planning/reports/` | Ibrahim | `tax-planning/source/tax-planning.jpg` (Reports tab, named only) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §15 |
| `/tax-planning/opportunities/[opportunityId]` | `tax-planning/opportunities/[opportunityId]/` | Ibrahim | `tax-planning/source/planning-opportunity-strategy-review.jpg` | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §11 (Frame 3) |
| `/tax-planning/plans/new` | `tax-planning/plans/new/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 1, Client & Plan Details) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5-6 (Frame 2) |
| `/tax-planning/plans/[planId]/edit` | `tax-planning/plans/[planId]/edit/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 1, edit mode) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5-6 (Frame 2) |
| `/tax-planning/plans/[planId]/edit/financials` | `tax-planning/plans/[planId]/edit/financials/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 2, Financial Overview) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5 (Frame 2) |
| `/tax-planning/plans/[planId]/edit/goals` | `tax-planning/plans/[planId]/edit/goals/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 3, Goals & Strategies) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5 (Frame 2) |
| `/tax-planning/plans/[planId]/edit/implementation` | `tax-planning/plans/[planId]/edit/implementation/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 4, Implementation Plan) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5 (Frame 2) |
| `/tax-planning/plans/[planId]/edit/review` | `tax-planning/plans/[planId]/edit/review/` | Ibrahim | `tax-planning/source/create-edit-planning-plan.jpg` (step 5, Review & Save) | `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §5 (Frame 2) |
| `/business-advisory` | `business-advisory/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Overview tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §1 (Frame 1) |
| `/business-advisory/clients` | `business-advisory/clients/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Advisory Clients tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/plans` | `business-advisory/plans/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Business Plans tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/goals` | `business-advisory/goals/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Goals & Milestones tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/financial-analysis` | `business-advisory/financial-analysis/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Financial Analysis tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/action-plans` | `business-advisory/action-plans/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Action Plans tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/resources` | `business-advisory/resources/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Resources tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/reports` | `business-advisory/reports/` | Ibrahim | `business-advisory/source/business-advisory-and-development.jpg` (Reports tab, named only) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §8 |
| `/business-advisory/plans/new` | `business-advisory/plans/new/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 1, Business Profile) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §3-4 (Frame 2) |
| `/business-advisory/plans/[planId]/edit` | `business-advisory/plans/[planId]/edit/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 1, edit mode) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §3-4 (Frame 2) |
| `/business-advisory/plans/[planId]/edit/assessment` | `business-advisory/plans/[planId]/edit/assessment/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 2, Financial & Business Assessment) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §4 (Frame 2) |
| `/business-advisory/plans/[planId]/edit/goals` | `business-advisory/plans/[planId]/edit/goals/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 3, Goals & Strategy) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §5 (Frame 2) |
| `/business-advisory/plans/[planId]/edit/action-plan` | `business-advisory/plans/[planId]/edit/action-plan/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 4, Action Plan) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §5 (Frame 2) |
| `/business-advisory/plans/[planId]/edit/review` | `business-advisory/plans/[planId]/edit/review/` | Ibrahim | `business-advisory/source/create-edit-business-plan.jpg` (step 5, Review & Save) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §3 (Frame 2) |
| `/business-advisory/clients/[clientId]` | `business-advisory/clients/[clientId]/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Overview tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6-7 (Frame 3) |
| `/business-advisory/clients/[clientId]/plan` | `business-advisory/clients/[clientId]/plan/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Business Plan tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/financials` | `business-advisory/clients/[clientId]/financials/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Financials tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/goals` | `business-advisory/clients/[clientId]/goals/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Goals & Milestones tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/recommendations` | `business-advisory/clients/[clientId]/recommendations/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Recommendations tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/tasks` | `business-advisory/clients/[clientId]/tasks/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Tasks tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/meetings` | `business-advisory/clients/[clientId]/meetings/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Meetings tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/documents` | `business-advisory/clients/[clientId]/documents/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Documents tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/notes` | `business-advisory/clients/[clientId]/notes/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Notes tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/portal` | `business-advisory/clients/[clientId]/portal/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Client Portal tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |
| `/business-advisory/clients/[clientId]/activity` | `business-advisory/clients/[clientId]/activity/` | Ibrahim | `business-advisory/source/client-advisory-detail-growth-plan.jpg` (Activity Log tab) | `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §6 (Frame 3) |

Not in the firm workspace: the Settings design also lists "Company Applications" and "Companies". The docx calls them platform-level, so they belong to the Super Admin console (`admin/`), and no firm route exists for them. Services & Pricing and Integrations in the Settings menu open `/services-pricing` and `/integrations`; Audit Log opens `/audit-log`; Payments & Payouts is `/settings/payments` (R16); Reports from Staff Management and Appointments opens `/reports`.

Sidebar: Dashboard, Clients, Sign-ups, Leads, Appointments, Intake Forms, Documents, Client Portal, Tax Returns, Bookkeeping, Payroll, Tax Planning & Strategy, Business Advisory & Development, Invoices & Payments, Messages, Communications, Tasks, Automations, Compliance & Deadlines, Reports, Templates, Services & Pricing, Workspaces, Firm Sign, Audit log, Staff Management, Integrations, Settings. Intake Forms opens `/intake-forms` and Services & Pricing opens `/services-pricing`; the other modules still open the shared module page. Sign-ups, Staff Management, Audit log and Settings show only for Owner and Admin. The Settings menu (`settings/layout.tsx`, R1's) lists Overview, Profile, Branding, Client portal, Terms & Privacy, Availability, Users & roles, Billing, Payments, Communications, Notifications, Forms & documents, Workflow & automations, Security & access, Data & backups, Preferences and Tax statuses.

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
| API functions and mock data | `packages/types/`, `apps/web/src/lib/api.ts`, `apps/web/src/mocks/` | the contract session writes them first; you only extend the mock files listed under your name in "Your files" |

## Your files

These are the only files a PR from your branch may change. A folder means everything inside it.

**Fahad**
- `packages/ui/`
- `apps/web/src/components/auth/`, `apps/web/src/components/sign-in-panel.tsx`, `apps/web/src/components/notification-bell.tsx`
- `apps/web/src/app/admin/sign-in/`, `admin/forgot-password/`, `admin/reset-password/`
- `apps/web/src/app/firm/sign-in/`, `firm/forgot-password/`, `firm/reset-password/`, `firm/activate/`
- `apps/web/src/app/firm/(workspace)/layout.tsx` (the firm's menu only), `(workspace)/page.tsx`, `(workspace)/_components/`, `clients/` (except `clients/[id]/signatures/`, R13-web's, and `clients/[id]/messages/`, Nahid's), `invoices/`, `sign-ups/`, `workspaces/`
- Five Services & Pricing pages (Rasel, Oct 15), in `apps/web/src/app/firm/(workspace)/`: `services-pricing/new/`, `services-pricing/[id]/` (with its `edit/`), `services-pricing/inactive/` and `services-pricing/packages/new/`; from Oct 17 also `services-pricing/categories/`, `services-pricing/packages/` (all package pages) and `services-pricing/promotions/`; and `apps/web/src/mocks/services-pricing.ts` and `mocks/services-pricing-*.ts` (shared with Arfan)
- `apps/web/e2e/fahad-*.spec.ts`, `apps/web/e2e/mock/fahad-*.spec.ts`, `docs/tasks/FAHAD.md`

**Tumit** (Staff Management, Settings and Appointments, from Oct 14)
- `apps/web/src/components/app-shell/`
- `apps/web/src/app/admin/(console)/` (all of it except Arfan's four Super Admin modules: `communications/`, `notifications/`, `reports/`, `system-settings/`); from Oct 18 that includes `audit-security/`, `billing/`, `subscriptions/`, `sales/`, `team/` and `support/` (26 routes), and from Oct 19 `integrations/` (12 routes, from Arfan), and new `apps/web/src/mocks/admin-*.ts` for them
- `apps/web/src/app/firm/welcome/`, `firm/apply/`, `firm/setup/`
- `apps/web/src/app/portal/[firmSlug]/(public)/begin/` (Begin Online, shared with Arfan, from Oct 19)
- `apps/web/src/app/firm/(workspace)/team/` (Staff Management, 20 routes), `audit-log/`, `calendar/` (Appointments, 8 routes), `settings/` (all of it except `settings/layout.tsx`, `settings/route.ts`, `settings/payments/` and `settings/tax-statuses/`)
- `apps/web/src/app/portal/[firmSlug]/(client)/appointments/`
- `apps/web/src/mocks/team.ts`, `mocks/settings.ts`, `mocks/appointments.ts` and new `mocks/staff-*.ts`, `mocks/settings-*.ts`, `mocks/appointments-*.ts` (synthetic data only; registering a module in `lib/api.ts` is the contract session's)
- From Oct 17, in `apps/web/src/app/firm/(workspace)/`: `intake-forms/builder/`, `intake-forms/templates/` and `intake-forms/send/` (shared with Arfan); and `apps/web/src/mocks/intake-forms.ts` and `mocks/intake-forms-*.ts`
- `apps/web/e2e/tumit-*.spec.ts`, `apps/web/e2e/mock/tumit-*.spec.ts`, `docs/tasks/TUMIT.md`

**Nahid** (F10's messages, from Oct 9; its invoices pages went to Fahad on Oct 10; the portal pages moved to R17)
- `apps/web/src/app/firm/(workspace)/messages/`
- `apps/web/src/app/firm/(workspace)/clients/[id]/messages/`
- `apps/web/e2e/nahid-*.spec.ts`, `apps/web/e2e/mock/nahid-*.spec.ts`, `docs/tasks/NAHID.md`

**Arfan** (Leads, Intake Forms and Services & Pricing, from Oct 14)
- `apps/web/src/app/portal/[firmSlug]/(public)/begin/` (shared with Tumit from Oct 19)
- `apps/web/src/app/firm/(workspace)/leads/` (the list, the lead profile `leads/[id]/` and its tabs and convert steps; 14 routes), `intake-forms/` (13 routes), `services-pricing/` (6 routes: the list, categories, packages list, `packages/[id]`, `packages/[id]/edit` and promotions; `new`, `[id]`, `[id]/edit`, `inactive` and `packages/new` moved to Fahad on Oct 15)
- `apps/web/src/mocks/leads.ts`, `mocks/intake-forms.ts`, `mocks/services-pricing.ts` and new `mocks/leads-*.ts`, `mocks/intake-forms-*.ts`, `mocks/services-pricing-*.ts` (synthetic data only; registering a module in `lib/api.ts` is the contract session's)
- From Oct 18, the Super Admin console in `apps/web/src/app/admin/(console)/`: `communications/`, `notifications/`, `reports/` and `system-settings/` (36 routes; `integrations/` moved to Tumit on Oct 19), and new `apps/web/src/mocks/admin-communications*.ts`, `mocks/admin-notifications*.ts`, `mocks/admin-reports*.ts`, `mocks/admin-system-settings*.ts`
- `apps/web/e2e/` (all tests, mock-mode ones too: you lead testing), `docs/tasks/ARFAN.md`

**Ibrahim** (Integrations, Reports, Tax Planning & Strategy and Business Advisory & Development, from Oct 17)
- `apps/web/src/app/firm/(workspace)/integrations/` (12 routes), `reports/` (3 routes), `tax-planning/` (14 routes), `business-advisory/` (25 routes)
- new `apps/web/src/mocks/integrations.ts`, `mocks/reports.ts`, `mocks/tax-planning.ts`, `mocks/business-advisory.ts` and `mocks/integrations-*.ts`, `mocks/reports-*.ts`, `mocks/tax-planning-*.ts`, `mocks/business-advisory-*.ts` (synthetic data only; registering a module in `lib/api.ts` is the contract session's)
- `apps/web/e2e/ibrahim-*.spec.ts`, `apps/web/e2e/mock/ibrahim-*.spec.ts`, `docs/tasks/IBRAHIM.md`
