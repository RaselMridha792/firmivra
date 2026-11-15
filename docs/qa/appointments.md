# Appointments: Review 2 QA map

This file maps every row of Octavia's Appointments Review 2 to the PR that changed it and the test that covers it:
- the Review One corrections (A0 and 1 to 10);
- the pending tests (P1 to P10);
- the additional corrections (B1 to B11);
- the approved additions (A1 to A3);
- the checks she found working (W1 to W11).

A row that needed no code gets the exact steps on dev that show it instead. A row still open is a **GAP** with a plan. The report is kept privately, outside the repo; rows are named by their IDs and headings only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- db tests: `packages/db/test/`
- Isolation: `apps/api/test/isolation/` (every firm route, both firms)

**Steps on dev.** Use `https://app.dev.firmivra.com` with the QA logins Rasel hands over:
- `qa-owner-b@`, `qa-admin-b@` and `qa-staff-b@dev.firmivra.com` (all in Test Firm B);
- `qa-client-b@dev.firmivra.com`, a Test Firm B client, at `https://portal.dev.firmivra.com/test-firm-b`.

Test Firm B has twelve upcoming appointments for a synthetic client (QA seed part 4, #1463). They are marked reminded, so nothing is emailed by itself. Use the synthetic client for any row that sends something.

**Notices, for P2 to P5 and P7**

| Action | What the client gets | What the firm gets |
| --- | --- | --- |
| A booking | a bell item and an email | a bell item (Owners, Admins and the client's assigned member) |
| A reschedule (new time or staff member) | a bell item and an email | a bell item |
| A booking the firm made | its emails ask the client to confirm, and the portal shows Confirm Appointment (**row 8**) | Confirmed once the client confirms; later reminders stop asking |
| The automatic reminder (the job, inside the 24 hours before) | a bell item and an email, with the reminder's own note (B7) | a bell item |
| Send Reminder by hand | an email, with the reminder's own note | nothing |
| Cancel | a bell item and an email to their primary login, with the reason staff gave (**P3**) | nothing |
| Complete or No-show | nothing (internal outcomes) | nothing |

Text messages for appointments are not sent yet (no text template), so a Text reminder is kept but not delivered.

## Review One corrections

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| A0: Archive and Restore status | Done | approved earlier; #1478 | The archived-booking check is now proven. e2e `booking-link` "the signed-in client books the exact type of the link; an archived or hidden type is refused": free times and booking are 404, and nothing is written. Mock `r56-booking-link` "an archived type, one clients cannot book online, and no type are refused plainly". Dev: archive a bookable type in Appointments > Manage Appointment Types, then open its Booking Link: "… Is No Longer Offered". |
| 1: Meeting methods and validation | Done | #1440 (db), #1445 | e2e `scheduling` "meeting methods (A1)". Mock `r56-appointments-review` "A1 and Review 2 (P1 row 1): several methods save together; Other Video Meeting names its platform". Dev: tick In-Person, Zoom / Video and Other Video Meeting, name a platform, Save, then reload. Without a platform the field says so and keeps your entries. |
| 2: Booking window | Done | #1440 (db), #1445 | Mock `r56-appointments-review` "A3, A10 and Review 2 (P1 row 2): the window in hours or days, notice in hours, all kept". Dev: choose 2, 6 and 12 hours ahead in turn; each is kept after reload, and Minimum Notice stays as set. |
| 3: Booking links and archive | Done | #1478 | Every type's menu has Copy Booking Link and Copy Embed Code, and its settings show both. The embed is a button, not an iframe; the dialog says why. e2e `booking-link` (exact type, states, button code, cross-firm 404, public read never shows the staff-only description). Isolation: a case for the firm route, and the public route excluded with its reason. Mock `r56-booking-link` (5). |
| 4: Save Client inline | Verified (Octavia) | (earlier) | Mock `r56-appointments-review` "A5: Save Client saves the typed contact as a client and chooses it; entries stay". |
| 5: Staff Availability | Verified (Octavia); buffers added | #1421 | e2e `scheduling` "counts the booked type's buffers before saving, as the save does (Review 2, Appointments B11)". Mock `r56-appointments-review` "A2: weekly hours and time off save together …". |
| 6: Zoom link layout | Verified (Octavia) | (earlier) | Mock `r56-appointments-review` "A6: the video link has its own full-width row …". |
| 7: Multiple reminders and channels | Done | #1453 | Mock `r56-appointments-review` "Review 2 (row 7): an appointment keeps two reminders on one channel". Automatic delivery is under **P7**. |
| 8: Client confirmation | Done | #1507 | e2e `my-appointments` "the firm books it and the client is asked; once they confirm, the firm sees it and reminders stop asking" and "one the client booked never asks; another client's is 404; a cancelled one is 409". Mock `r56-portal-confirm` "an appointment the firm booked asks the client to confirm it, once". Staff Confirm (Pending to Confirmed) still works: e2e `scheduling` "turns Pending into Confirmed, once, and audits it". Dev: book a Test Firm B appointment for the synthetic client; as `qa-client-b`, Appointments shows "We booked this for you. Please confirm it." and Confirm Appointment. |
| 9: Service intake request | Evidence | (earlier, A9) | e2e `intake-workspace-actions` "A9: a type asks for its service form; a form sent for an appointment shows on it until completed". Mock `r56-appointments-review` "A9: a type names its intake form; the appointment sends it and shows it waiting". Dev: give a type a Required intake form, book it for the synthetic client, Send Intake Form, complete it as `qa-client-b`; the appointment's Related Items shows it completed. |
| 10: Internal description | Done | (earlier A10), #1478 | e2e `booking-link` "shows a visitor the type without signing in, and never its staff-only description". The portal's bookable types carry no description, and no appointment email reads it. Dev: give a type a staff-only description; the portal's Schedule an Appointment and the booking link page don't show it. |

## Pending tests

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| P1: Draft | Done | #1448 (db), #1451 | The cause: Save as Draft had no storage behind it, so nothing was written and the error showed. A member's draft is now kept in `appointment_drafts` (64 KB, RLS). e2e `scheduling` "drafts (Review 2, Save as Draft)". Mock `r56-appointments-review` "Review 2 (Save as Draft): a draft keeps the form, reopens from Your saved drafts, and goes with the booking". |
| P2: Reschedule | Evidence | (R12) | e2e `appointments` "reschedule moves the time and the staff member; the detail lists who did what". e2e `scheduling` "a new time or staff member is a reschedule: history, a notice, and the conflict check". e2e `appointments` "tells the client's primary login about a booking and a new time; nothing for a cancel". Dev: reschedule a Test Firm B appointment; its history shows the move, and the synthetic client gets the new time. |
| P3: Cancel | Done | #1501 | The client is told, as the Cancel dialog says: a bell item and an email to their primary login, with the reason staff gave. e2e `appointments` "tells the client's primary login about a booking, a new time and a cancel (Review 2 P3)" and "cancelled, completed and no-show are final (409 APPOINTMENT_CLOSED)". Mock `r56-appointments-review` "Review 2 (P3): Cancel says the client is told, and that they see the reason". |
| P4: Complete | Evidence | (R12) | Same e2e: final once done. Nothing is sent. Dev: Complete a past Test Firm B appointment; the status is Completed and nothing is emailed. |
| P5: No-show | Evidence | (R12) | As P4: final, and nothing is sent. |
| P6: Recurring | Verified (Octavia) | (earlier), #1509 | e2e `scheduling` "repeats weekly and makes one appointment per occurrence in a series". Mock `r56-appointments-review` "Review 2 (B4, B5): the summary shows the repeat and its count …". |
| P7: Reminder delivery | Evidence | #1462 (history) | e2e `notify-jobs` "appointment reminders: a due appointment once (bell on both sides, the email copy)" and "a rescheduled appointment gets a reminder for its new time". A reminder, sent by hand or automatically, shows in the appointment's notice history (B8). Text is pending, as the notices table says. |
| P8: Confirmation behavior | Done | #1507 | As row 8. |
| P9: Intake completion | Evidence | (earlier, A9) | As row 9. |
| P10: Staff Status permissions | Evidence | (R12, R58) | e2e `scheduling` "is 404 for Staff on someone else's and for another firm, 409 once closed". e2e `appointments` "Staff get 404 for a Busy appointment's detail and every change, and a client not theirs". Dev: as `qa-staff-b`, an appointment of a client not assigned to you shows as Busy and has no actions. |

## Additional corrections

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| B1: Appointment type and location mismatch | Done | #1453 | Mock `r56-appointments-review` "Review 2 (B1): choosing a type sets one of its methods, and the others are off". |
| B2: Unsaved details after availability detour | Done | #1453 | Mock "Review 2 (B2): the unsaved form is kept through Edit My Availability and Back". |
| B3: Return navigation preserves context | Done | #1462 | Mock "Review 2 (B3): Back from an appointment returns to the same list filters and calendar view". |
| B4: Selected recurrence in Appointment Summary | Done | #1421, #1509 | Mock `r56-appointments-review` "Review 2 (B4, B5): the summary shows the repeat and its count, and End Time follows the type". Dev: Repeat Every week, 6 times; the summary says it. |
| B5: Calculated End Time matches duration | Done | #1421, #1509 | The same mock. Dev: a 15-minute type at 3:00 PM sets the End Time to 3:15 PM, and the summary agrees. |
| B6: All Day label in Today | Done | #1421, #1509 | Mock `r56-appointments-review` "Review 2 (B6): Today labels an all-day appointment All Day". Dev: an all-day appointment reads All Day in Today. |
| B7: Notification and reminder customization | Done | #1465 | e2e `scheduling` "carries the firm's own words …". Unit `notify-templates`. Mock "Review 2 (B7, B9): …". |
| B8: Notice history after sent reminder | Done | #1462 | e2e `scheduling` "emails the client now, counts it, and leaves the automatic schedule alone": the appointment's notice history shows the reminder, after a fresh read too. |
| B9: Client instructions in client notices | Done | #1465 | As B7: Email, Portal and Text are chosen apart; internal notes never reach the client. |
| B10: Company timezone default and override | Done | #1494 | e2e `scheduling` "Review 2 (B10): …" (default, override kept, a firm change moves nothing). Mock "Review 2 (B10): …". Preferences' Time Zone says what a change does. The New York header was the browser's zone, fixed by Dashboard U2 (#1452). |
| B11: Pre-save buffer conflict display | Done | #1421 | e2e `scheduling` "counts the booked type's buffers before saving, as the save does". |

## Approved additions

| Row | Status | PR | Plan |
| --- | --- | --- | --- |
| A1: Group appointments | Done | #1500 (db), #1513 | Schedule Appointment and Edit have Other Attendees: up to 20 other clients of the firm, never the appointment's own client. Each is checked as the client is (another firm's client or one a Staff member does not see 404, archived 409) and is double booked as the client would be, on every booking path. Staff see them on the record; Drafts and Duplicate keep them. In the portal an attendee sees the appointment read only and never who else attends; each notice and reminder goes to one person with their own name, and only the client is asked to confirm. e2e `appointment-attendees` (10, with firm B's portal and a non-attending client of the same firm 404). Isolation: the attendee body ids. Unit `scheduling` (attendee conflicts). Mock `r55-appointment-attendees`. Dev: schedule with Other Attendees, open the record, then sign in to an attendee's portal. |
| A2: Resource management and booking | Done | #1511 (db), #1524 | **Settings > Appointment Settings** (Owner and Admin; Staff get 403): Rooms per office (Add, Rename, Archive; a room's archive is final, the database's rule since R37, and the dialog says so) and Equipment, one row per physical item, of one office or any office (Add, Edit, Archive, Restore). **Schedule Appointment** has an Equipment pick beside Room, up to 5 items: an office's own only for an in-person appointment there. The detail shows them. An item another live appointment holds then is 409 SCHEDULING_CONFLICT naming the item and never the other appointment's client, and is never booked anyway; the database refuses it whatever the check saw (an exclusion constraint, as for rooms). e2e `appointment-resources` (12): who manages, the name rules, another firm's office, room or item 404, the options, the overlap (back to back fine, a cancel frees it), the place rule, Edit Existing (add, release, a move onto a held time refused, an archived item kept), the check before saving, drafts and Duplicate; audit rows hold ids only. db `appointment-equipment` (4). Isolation: `cases/appointment-resources.ts`, and `equipmentIds` in the scheduling cases. Mock `r56-appointment-resources` (4). Dev: in Settings > Appointment Settings add "QA Projector" to the main office; book an in-person appointment there with it; book another at an overlapping time with it: "QA Projector is already booked at this time." Known limit, as for rooms before: the portal's reschedule times don't count rooms or items, so a client's move onto a time its room or item is held is 409 SLOT_TAKEN. |
| A3: Appointment waitlist | Partly done: the Settings card waits for Settings > Appointment Settings | #1503 (db), #1516, #1521 | The firm's switch and its one mode (automatic confirmation or staff approval) are in the API (`/business/appointment-waitlist/settings`, Owner and Admin). A client joins the waitlist for one of their own upcoming appointments in the portal. A job every 5 minutes offers the earliest opening to one entry at a time (never one time to two), by a bell item and an email of times only, to clients whose portal access is active. The client takes it (the appointment moves, or staff approve it) or turns it down. The time is checked again first (409 OFFER_TAKEN, and the entry waits again), and the original time stands until the move. e2e `appointment-waitlist` (6), unit `waitlist`, isolation cases for the six routes, mock `r55-portal-waitlist`. Left: the Waitlist card in Settings > Appointment Settings, after R56's page is on main. |

## Verified working (Octavia, Nov 8)

| Row | Status | Test |
| --- | --- | --- |
| W1: List filters and search | Kept | Mock `tumit-calendar-list` "lists, searches and filters appointments"; `r56-appointments-review` "Review 2 (B3): Back from an appointment returns to the same list filters and calendar view" |
| W2: Calendar display and detail navigation | Kept | Mock `tumit-calendar` "shows the week, Upcoming Appointments and the right column" and "a day from the small month shows its week …"; `tumit-calendar-detail` "shows the appointment and confirms it …" |
| W3: Form prefill and retention | Kept | Mock `tumit-calendar-new` "opens on the date and hour picked on the calendar"; `r56-appointments-review` "Review 2 (B2): the unsaved form is kept through Edit My Availability and Back" |
| W4: All Day form and saved persistence | Kept | Mock `r56-appointments-review` "Review 2 (B6): Today labels an all-day appointment All Day" (an all-day appointment scheduled, then shown) |
| W5: Normal scheduling save and reload | Kept | Mock `tumit-calendar-new` "checks the form, shows the staff day and schedules an appointment"; `tumit-calendar-edit` "fills the form from the appointment and saves a change" |
| W6: Internal note persistence | Kept | Mock `tumit-calendar-detail` "… adds a note …"; e2e `scheduling` notes "works after the meeting too, and refuses empty, long and unknown input" |
| W7: Cancel edit discards changes | Kept | Mock `tumit-calendar-edit` "W7 (Review 2, verified working): Cancel on Edit leaves the appointment as it was" (new with this map) |
| W8: Saved record in calendar and Upcoming | Kept | Mock `tumit-calendar` "shows the week, Upcoming Appointments and the right column" |
| W9: Today date scope and detail link | Kept | Mock `tumit-calendar-today` "shows today" |
| W10: Availability conflicts and timezones | Kept | Mock `tumit-calendar-new` "… shows the staff day …"; `r56-appointments-review` "A2: weekly hours and time off save together …"; e2e `scheduling` "refuses a time the staff member, client or room already has with 409 SCHEDULING_CONFLICT" and "Review 2 (B10): …" |
| W11: Required fields and time range | Kept | Mock `tumit-calendar-new` "checks the form …"; `r56-appointments-review` "A2: a wrong range is marked on its field and focused, and nothing is sent" |

## GAP list

1. **A3**, the Waitlist card in Settings > Appointment Settings (R55's), now that the page exists (#1524).
