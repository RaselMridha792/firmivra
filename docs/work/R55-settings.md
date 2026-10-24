# R55: Settings > Availability and Settings > Client Portal (Octavia's Oct 20 review)

Source: `docs/specs/settings-review-2026-10-20/CHANGE-LIST.md` (P3, "Bigger flows she specified"), with the guides `availability--availability-developer-guide.md` (items 1 to 20, tests T01 to T12) and `client-portal--client-portal-developer-guide-approved-updated.md` (sections 1 to 9). Her screenshots are in `docs/mockups/firm-workspace/settings/review-2026-10-20/client-portal/`.

## Reproduced on main (Oct 24, `main` at 73db2fcc1)

This was reproduced by reading the code and by calling the local API. The local Staff member is a Bookkeeper, whose grid has no Appointments, so every Availability call returned 403 at the guard. No local member has the Staff role with the Appointments grant.

### Availability

| Guide | On main | Evidence |
| --- | --- | --- |
| 1 Staff and location selector | Partial | "Whose hours" lists every member for every role. There's no location selector (`settings/availability/_components/availability-screen.tsx:42-50`). |
| 2 Working hours | Partial | The whole week is replaced on each save. Several ranges a day act as breaks, and overlaps within a day are refused. Times are in the firm's zone only. Saved hours feed booking. |
| 3 Tabs | Missing | One page with two cards. There's no Schedule Changes tab. |
| 4 Read-only for Staff, plus a change request | **Conflicts** | Staff edit their own hours directly, through both the API (`availability.service.ts` `mayChange`) and the screen. No request flow exists. |
| 5 Blocked time list | Partial | Shows the person or Whole firm, the reason and the times. It doesn't show the creator (the API returns `createdBy`), a status, affected bookings or filters, although the API accepts `userId`, `from` and `to`. |
| 6 Create Blocked Time | Partial | An inline form only. There's no emergency option, and the reason is optional for everyone. Staff are limited to their own schedule. |
| 7 Scope | Partial | One person, or the whole firm. There's no office scope: `blocked_times` has no office. |
| 8 and 10 Smart blocking and the conflict list | **Conflicts** | Any scheduled appointment in the range gives 409 `BLOCKS_APPOINTMENT`. A whole-firm block fails if any appointment anywhere falls in the range (`availability.service.ts:200-220`). Nothing is cancelled, but the guide's three choices don't exist and the 409 doesn't say which appointments clash. |
| 11 and 15 Reassignment (same office, same specialty, fewest bookings) | Missing | Parts to build on exist: `StaffProfile.primarySpecialty` and `serviceAreas`, `FirmOfficeMember`, `Appointment.officeId` and `serviceId`, and `pickStaff` (`appointments/calendar.ts`, which portal booking uses). |
| 12 Save, audit, notify | Partial | Saving and the audit work; the audit records "reason given" but not the reason text. Nobody is notified. |
| 13, 14 and 16 Requests, the approval queue, client confirmation | Missing | No table, API or screen. |
| 17 and 18 HR and authorized operations managers | Missing | There's no HR role. A Manager is treated as Staff in this module, and the grid's grants aren't consulted. |
| 19 Staff | **Conflicts** | Staff see every member's hours and every block's reason (`GET /business/availability`, `GET /business/blocked-times`). |

### Client Portal settings

| Guide | On main | Evidence |
| --- | --- | --- |
| 1 Dashboard | Partial | `settings/portal` is one card: a heading, a welcome message, the sign-up switch and a static preview, with "Turning portal features on and off: Soon". There are no panels and no client-perspective preview. |
| 2 Registration and office | Partial | The sign-up switch, firm approval and the Personal/Business choice exist. There's no office choice at sign-up, no office on the client, and no reassignment. |
| 3 Announcements | Partial | Creation lives in Communications (channel ANNOUNCEMENT), and there is no editor in Settings, which matches the guide. But there's no firm switch, no "Go to Communications" link, no announcements notification category, and the portal never shows announcements. |
| 4 Contact information | Missing | The signed-in portal has no contact card. The LVP public footer has a fixed address, phone and email typed into the code (`portal/[firmSlug]/(public)/_components/portal-footer.tsx:207-227`). |
| 5 Features | Missing | The six tabs are hard-coded (`portal/[firmSlug]/(client)/(tabs)/layout.tsx:11-18`). `portal_module_visibility` exists but no code reads or writes it. No rename, reorder or custom tabs. |
| 7.1 Save, Cancel, unsaved changes | Partial | Save sends only the changes and keeps them on failure. There's no Cancel and no unsaved-changes warning. |
| 7.2 Server-side permissions | Partial | Settings are Owner and Admin only. No portal endpoint checks module visibility, so a hidden tab would still open by URL or API. |
| 9.2 Mandatory personal email, SMS with consent | **Conflicts** | Clients can switch email off for every category except Account. SMS is offered whenever the login has a phone number, without checking `communication_consents`. |

## What can be built now, and what needs the schema

| | Can be built on current tables | Needs a schema change (R0) |
| --- | --- | --- |
| Availability | (a) The blocked time list: creator column, staff and date filters, location filter through `FirmOfficeMember`. (b) Conflict preview, the clashing appointments named in the 409, and **"Block available slots only"**, saved as several blocks around the bookings. (c) A required reason on a staff member's own block. (d) Notify the affected staff. | `schedule_change_requests` (requester, appointment, dates, reason, proposed action, status, decided by and at, replacement staff, escalated, and the proposed new time with the client's answer). `blocked_times.office_id`, and the `appointments_rules` trigger made aware of it. An EMERGENCY block kind or category. An HR role, or a decision that HR is a custom role. |
| Client Portal | (e) Contact details from Company Profile and Locations instead of fixed text (portal pages). (f) Module on and off for the five modules already in the `PortalModule` enum, enforced on the portal API (portal pages and several APIs). (g) Email locked on for personal and service notices, and SMS only with consent (notifications). (h) Announcements shown in the portal, from Communications. | `clients.office_id` (the assigned office). Switches for main or local office display and each contact method (`business_settings` columns or a portal settings table). Announcement on/off and channel policy. An `ANNOUNCEMENTS` notification category. A Business Resources module value, plus `label` and `sort_order` on `portal_module_visibility`. Custom tabs: a table with label, template key, order, portal type and targeting, plus a tab link on documents. |

## Built on Oct 25 (the parts without schema)

| Part | Branch, PR | What works now | What still needs schema |
| --- | --- | --- | --- |
| (e) Contact | #1122 | The portal's contact comes from Company Profile, each field falling back to the main office in Locations, plus its hours: the LVP public footer and the Need Help? cards. | The local office (`clients.office_id`), and the switches for corporate or local office and each contact method. |
| (f) Features | #1123 | Five tabs switch on and off in Settings > Client Portal, with a warning, Save and Cancel; the portal API refuses a hidden tab (403 `MODULE_OFF`); the menu, folder tabs, Quick Links, Send a Message and Contact Us follow. | Business Documents & Resources as a module value, rename (`label`), reorder (`sort_order`), custom tabs and per-client targeting. |
| (g) Notifications | `rasel/R55-portal-notify-consent` | Email is always on for clients (400 `EMAIL_ALWAYS_ON`); SMS only with their Text box on and never after a STOP or an unsubscribe in `communication_consents`; the card shows the opt-in wording and explains a stop. | The announcement channel policy and an `ANNOUNCEMENTS` category. Rasel's decision on recording the portal opt-in as consent. |
| (h) Announcements | `rasel/R55-portal-announcements` | Published announcements show in the portal, by their "Where", inside their window: a dismissable card on the tabs and View All Announcements. | The firm's announcements switch, login-page announcements, and server-side read state. |

## Needs from others

- **R0 (schema), Availability:** `schedule_change_requests` and the reschedule proposal; `blocked_times.office_id` with the trigger; an emergency block kind.
- **R0 (schema), Client Portal:** `clients.office_id`; portal contact and announcement settings; the `ANNOUNCEMENTS` category; `portal_module_visibility.label` and `sort_order` plus a Business Resources value; custom tabs.
- **Rasel (decisions):** whether the portal's Text box also records an SMS opt-in in `communication_consents` (it would then count for SMS campaigns too); and whether a dismissed announcement should be remembered on the server rather than per browser.

## Decided (Rasel, Oct 24 evening; reversible defaults)

1. **Availability:** Staff working hours are read-only now. Staff change their hours through a request once the request flow exists (schema).
2. **HR** is a custom role, not a new built-in role.
3. **Client Portal:** R55 may change the portal pages, but only for the parts that need no schema: (e) contact details from Company Profile and Locations, (f) module on and off for the five modules in the enum, (g) personal email locked on and SMS only with consent, (h) announcements shown in the portal. The schema items wait for R1 and Rasel's tap.
4. **Order:** Leads first (search, bulk Convert, Preferred, Begin Online duplicates), then the Client Portal parts without schema.
