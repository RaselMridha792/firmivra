# Settings tab: Octavia's review, change list (Oct 20, 2026)

Source: Octavia's Fiverr note of Oct 20 (7:44 PM her time) plus her Drive folder for the Settings tab (17 developer guides and 38 screenshots). Guides are in this folder as markdown, one file per area. Her screenshots are in `docs/mockups/firm-workspace/settings/review-2026-10-20/<area>/`. Her notes say most sections were "approved at first review"; what she asks for is below. She will send one Drive per section, so this file is extended per section (see the end).

How to read it:
- **P0**: she called it out in her note, do first.
- **P1**: a defect she hit while testing (page not found, data not loading, a save that fails).
- **P2**: a changed rule or value (numbers, wording, behavior).
- **P3**: new or bigger flow she specified (build after P0 to P2).
- "On main" is what we checked on origin/main at 13:43 UTC. "Check" means the session that takes the item must look at main and dev first, because the guides are written against her test of an older dev build and some items may already be fixed.
- Her guides say destination pages stay "pending review" unless marked approved. Do not touch anything marked approved or "keep as is".

## P0. Her one explicit change

"Active Companies" becomes **Locations** in the firm workspace. Active Companies stays only in Super Admin.

Guide: `overview--firmiva-settings-overview-clarified-1.md` (items 1 to 31). Mockups: `.../overview/`. The design shows the Settings submenu with a new **Locations** entry under Overview and **Profile** renamed **Company Profile**.

| # | Change | On main |
|---|---|---|
| 1 | Add **Locations** to the Settings submenu, right below Overview | Missing: no `settings/locations` route |
| 2 | Rename **Profile** to **Company Profile** (label only) | Still "Profile" (`settings/layout.tsx:11`) |
| 3 | KPI card **Active Companies** becomes **Active Locations** (count of active offices, link "Manage Locations") | Still "Active Companies" (`overview-screen.tsx:146`) |
| 4 | **Staff Users** note "Across all companies" becomes "Across all locations"; count each person once; links to Users and Roles | Still "Across all companies" (`:161`) |
| 5 | **Pending Applications** card becomes **Subscription & Locations** (for example "2 / 5 Locations used", "Manage Plan" opens Billing) | Still "Pending Applications" |
| 6 | **Security Alerts / View Alerts** keeps the card but opens Security & Access filtered to unresolved alerts (not Notifications); badge on Settings in the main sidebar | Check |
| 7 | Search placeholder becomes "Search clients, locations, or team members..." and searches those three | Not done |
| 8 | The "?" button opens a shared Help & Support slide-out (Help Center, Contact Support, Report a Problem) instead of an email | "Report a Problem" missing |
| 9 | Account menu: My Profile, My Settings, Help & Support, Sign Out (Admin Panel only if authorized) | "My Settings" missing |
| 10 | **Company Applications** table becomes **Location Management** (name, address, assigned staff, manager, status, actions) | Still "Company Applications" |
| 11 | "View All Locations" and "+ Add Location" buttons | Missing |
| 12 | Row actions View, Edit and a three-dot menu (Manage Staff, Assign/Change Manager, Set Primary, Activate/Deactivate, View History) | Missing |
| 13 | Quick Settings card **Company Management** becomes **Location Management**, link "Manage Locations" | Still "Manage Companies" (`:44`) |
| 14 to 16 | Branding, Billing, Users, Security, Data quick links: keep as is | Keep |
| 17 | Recent Administrative Activity: keep design, filter to this firm's events | Check |
| 18 | Collapsible main sidebar (icons only, hover labels, remembers choice) | Check |
| 19 | Security badge on Settings in the sidebar, opens Security & Access | Check |
| 20 | Profile permissions (everyone gets My Profile and My Settings; self-edit photo, phone, password, preferences) | Check |
| 21 | New (+) menu: keep as is | Keep |
| 23 to 30 | Clarifications that apply in Locations, Billing and Staff Management (location actions match Locations, downgrade warning, scheduled deactivation, manager replacement, duplicate check). See the Locations module below | with Locations |

## P3 (new module). Settings > Locations

Guide: `locations--final-lvp-locations-settings-final-developer-guide.md`. Mockups: `.../locations/` (list, three-dot menu, profile, add form, edit form).

- List with manager, status, actions, search and filters; three-dot menu: View Profile, Edit Location, Deactivate Location.
- Profile (modal over the list): details, manager, hours, services, mailto and tel links.
- Add and Edit: required fields, services only from Services & Pricing, several non-overlapping hours blocks per day, closed days, manager chosen from existing staff (created in Staff Management), EIN and structure read-only with a link to Company Profile, unsaved-changes warning.
- Final decisions (Oct 18): Super Admin can deactivate now or schedule it; pending changes can be edited or cancelled; one manager can have several locations (an "Assigned Locations" multi-select in Staff Management); when a manager is removed without a replacement the Main Location Manager becomes Acting Manager; block true duplicate locations with the exact message in the guide (same EIN or name alone must not block).
- On main: no Locations routes, no Locations API. The only table is `FirmOffice` (name, address, isMain, archivedAt), too thin for this. It needs a schema request (phone, email, status, timezone, manager, hours, services, scheduled actions) to R0, and Rasel's own yes on a card because `packages/db` changes.
- Same offices feed Client Portal registration ("client chooses from active office locations") and Availability ("employee and location"), so keep one source.

## P1. Defects she hit (fix first, small)

| Area | Defect | Guide |
|---|---|---|
| Communications | Text Messages card, "Open Communications" gives "Page not found". Route to the real Communications module, with the unsaved-changes prompt. Everything else on this page is approved: do not rebuild | `communications--...` |
| Workflow & Automations | "Open Automations" and "Open Tasks" give "Page not found". On main both routes exist (`moduleHref('automations')`, `('tasks')`), so check what the link builds on dev | `workflow-and-automations--...` |
| Workflow & Automations | Appointment Types: In-Person alone saves, Phone alone saves, **In-Person + Phone + Zoom together fails**. Fix multi-method save with specific errors; persist after refresh. Add a second "Back to Workflow & Automations" button (not on main yet) on every page opened from this hub | same |
| Forms & Documents | "Templates" card gives "Page not found" | `forms-and-documents--...` |
| Security | MFA card shows "Could not load this right now"; must load real firm data | `security--...` |
| Users & Roles | Counters show "Not loaded", employee table does not load, invitation returns a vague "We could not find that", reset and deactivate selectors are empty, custom role creation unavailable, Admin permission edit rejected while Manager works | `users-and-roles--...` |
| Preferences | Spanish saves but the interface stays English | `preferences--...` |
| Billing | Page shows "no subscription connected", usage unavailable, no invoices | `billing--...` |

## P2. Changed values and wording

| Page | Change | On main |
|---|---|---|
| Security | Password: **15-character minimum**, spaces and symbols allowed, no forced character mix (today shows 12 and a mix). Lockout: 5 failures within 15 minutes gives a 15-minute lockout. Sessions: **8 hours maximum, 15 minutes idle, warning 2 minutes before** (today "7 days"). Deactivation or password reset ends every session. MFA required by default; only the owner or a security admin changes it, with fresh sign-in and audit | Shows "12 characters" (`security-screen.tsx:101`) and "7 days" (`:121`) |
| Data & Backups | "Every quarter" becomes **"Every month"** with real monthly restore tests; show last successful backup and last restore test; 35-day recovery window for all firm data; 90-day post-cancellation access; seven deletion emails (30, 20, 10, 5, 2, 1 day, 12 hours); wording change on retention | Still "Every quarter" (`data-screen.tsx:53`) |
| Forms & Documents | Max file **100 MB** (not 10), up to 20 files and 500 MB per batch; Word allowed, macros refused; client links expire in 24 hours, internal links 48 hours; two admin toggles for code verification (client and internal), both on; retention wording (records kept until the firm deletes them while active; "permanent" must not imply Firmivra stores forever) | No "100 MB" on main |
| Preferences | Add three toggles under Regional Settings: "Apply company-wide language", "Allow employees to choose their language", "Allow clients to choose their language"; real Spanish translation of the interface; currency changes never convert old amounts | No such toggles |
| Notifications | Employee **email is always on** (locked checked control, enforced on the server, existing OFF migrated to ON). SMS choices only after a verified mobile number is attached; show why they are unavailable otherwise. Delivery results must be recorded | Check |
| Branding | Nine controls approved: keep as is. Only open items are live-site checks (does a saved logo show on the real sidebar, footer and emails) | Keep |
| Terms & Privacy | Approved, no change | Keep |

## P3. Bigger flows she specified

- **Company Profile** (`company-profile--...`): "Request Change" modal for legal name, EIN and licensing (goes to Firmivra to review, never edits directly); contact edit modal; copyable links (portal, intake forms, appointments, services; no made-up links); links to Branding for logo, theme and login page; login-page preview.
- **Billing** (`billing--...`): Upgrade, Downgrade, View Plan Details, Usage Details, payment methods (add, default, remove), billing details, invoice list with View and Download PDF; a downgrade below current location usage must warn and block until resolved.
- **Payments** (`payments--...`): Stripe is already attached, so **no "Connect Stripe" step**; add Manage Connection and readiness status; add optional Square and PayPal cards; accepted payment methods and default processor; payout settings with a provider selector; restore the main and Settings sidebars on this page.
- **Client Portal settings** (`client-portal--...`): clients pick an active office at registration (admin can reassign); no announcement editor here, the Communications link opens creation; per-office contact display switches and separate SMS, phone, email, secure-message toggles; six default modules can be toggled, renamed, reordered, plus one custom tab; hiding never deletes data.
- **Availability** (`availability--...`): working hours, blocked time (individual, office, firm), smart blocking around booked appointments (never cancel silently), schedule change requests with approval queue, reassignment (same office and specialty, fewest bookings), client confirmation when a time changes.
- **Users & Roles** (`users-and-roles--...`): counters, search, CSV export of all pages, invite flow from an existing staff record (24-hour code, 30-minute reset link), role editing with Owner and Admin authority, individual Inherit/Allow/Deny overrides, custom role with a Set Permissions dialog (screen does not exist yet), change role, revoke invitation, unlock, reactivate, bulk actions, last-administrator protection, read-only audit log.
- **Data & Backups** extra: working "Export Company Data" (admin only, audit logged) and "Restore" (admin picks a recovery point, sees what gets overwritten, confirms, progress and result, audit logged) instead of "contact support".

## Items that wait on her side or on live tests

- SMS delivery cannot be tested until a mobile number is attached; email and SMS must both pass for her final approval of Notifications.
- Live-site Branding checks LIVE-01 to LIVE-06 are hers.
- Terms & Privacy final live test is hers.
- Her screenshots show mockup data (names, addresses, counts); the build must use live firm data.

## Staff Management (14 pages)

Not in this Drive. The 14 pages she listed (Create Staff steps 1 to 4 and success, Edit Staff Account, Staff Settings, Bulk Upload, Activity and Login History, and the six Access and Security tabs) are the earlier design batch already in `docs/mockups/firm-workspace/staff-management/source/`, and all of them exist on main under `apps/web/src/app/firm/(workspace)/team/` (new, new/details, new/permissions, new/security, [id]/created, [id], settings, import, activity, [id]/security with activity, history, login, permissions, sessions). Her feedback on them comes with her next Drive. The only Staff Management link in this batch is the manager "Assigned Locations" multi-select.

## How to extend this list

When a new section Drive arrives: convert guides to `docs/specs/settings-review-2026-10-20/<area>--*.md`, screenshots to `docs/mockups/firm-workspace/settings/review-2026-10-20/<area>/`, add a row group here with P0 to P3 and the "On main" check, and tell the sessions that own the area.
