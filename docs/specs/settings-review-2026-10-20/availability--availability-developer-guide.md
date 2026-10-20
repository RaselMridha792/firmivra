LVP Pro — Availability Settings
Developer implementation guide | Desktop | Corrections and updates to the existing Availability module
Use the approved navy main sidebar with Settings highlighted and the separate collapsible Settings sidebar with Availability highlighted. Preserve the existing UI and data. The screenshots are references; the requirements below define functionality.
# 1. Working Hours
Numbered functional references and implementation instructions:
No. | Control / scope | Developer behavior and destination
1 | Staff selection | Admin, HR, and authorized managers select employee and location; ordinary staff see only their own record and cannot edit working hours directly.
2 | Working hours | Authorized managers set weekly availability, hours and breaks, validating overlaps and time zone; saved hours feed appointment availability.
3 | Tabs | Working Hours, Blocked Time, Schedule Changes use the same shared records and role checks; preserve navigation and active tab.
4 | Permissions | Employee working-hours controls are read-only; employee can submit a Schedule Change Request for approval.
# 2. Blocked Time
Numbered functional references and implementation instructions:
No. | Control / scope | Developer behavior and destination
5 | Blocked time list | Show existing blocks, scope, reason, start/end, creator, status and affected bookings; filter by office/staff/date.
6 | Create Blocked Time | Open shared Create Block Time form; same form available from Working Hours. Employee emergency block requires a reason and is restricted to own schedule.
7 | Scope | HR/admin/authorized managers can block individuals, offices or firm-wide. Staff cannot block other people or whole firm.
8 | Smart blocking | Before applying, detect booked appointments. Offer Block Available Slots Only (protect booked slots), Reassign/Reschedule Appointments First, or Adjust Range. Never silently cancel an appointment.
# 3. Create Block Time
Numbered functional references and implementation instructions:
No. | Control / scope | Developer behavior and destination
9 | Block details | Choose permitted scope, date/time range, timezone, reason, and optionally emergency category. Reason mandatory for employee blocks.
10 | Conflict checks | List appointments in proposed range before save. Block only free slots if selected; existing bookings stay visible and unmodified.
11 | Reassignment | For affected appointments, search available same-specialty staff in the client’s chosen office; prefer fewest bookings; HR/admin may override.
12 | Save and audit | Validate, save block, update booking calendar, record actor/time/reason; notify impacted staff and authorized managers. If meeting time changes, require client confirmation.
# 4. Schedule Changes
Numbered functional references and implementation instructions:
No. | Control / scope | Developer behavior and destination
13 | Employee requests | Staff may request schedule changes with dates, appointment, reason and proposed action; do not directly change confirmed appointment without authorization.
14 | Approval queue | HR, company admin or explicitly authorized operations manager can approve, reject, reassign or reschedule; display pending and history states.
15 | Assignment logic | Within selected office only, filter by specialty and available time, then fewest bookings. If none eligible, escalate to HR/admin.
16 | Client confirmation | When time changes, offer new time to client and apply only after confirmation. Notify client, original/replacement staff, HR/admin and audit each change.
# 5. Role and accessibility matrix
No. | Control / scope | Developer behavior and destination
17 | Company admin / HR | Manage working hours, block time for any permitted scope, process requests, override assignments and view audit logs.
18 | Authorized operations manager | Same actions only to extent expressly granted by role permissions; no automatic company-wide access.
19 | Staff | View own availability, request schedule change, create emergency blocked time for self with mandatory reason; cannot modify others or approve own request.
20 | Accessibility | Keyboard-operable tabs/forms/dialogs, labeled fields, focus management, error messages, adequate contrast, readable status indicators and responsive scrolling.
# 6. Developer functional testing
T01. Role-based staff selector and unauthorized API access — Record Pass/Fail, evidence, and defect ID.
T02. Working-hours overlap and time-zone validation — Record Pass/Fail, evidence, and defect ID.
T03. Emergency employee block with required reason — Record Pass/Fail, evidence, and defect ID.
T04. Firm-wide block warns when appointments exist — Record Pass/Fail, evidence, and defect ID.
T05. Block available slots around existing appointments without cancelling them — Record Pass/Fail, evidence, and defect ID.
T06. Reassignment: same specialty, same office, fewest bookings — Record Pass/Fail, evidence, and defect ID.
T07. No eligible replacement escalates to HR/admin — Record Pass/Fail, evidence, and defect ID.
T08. Staff request approval/rejection and history — Record Pass/Fail, evidence, and defect ID.
T09. Rescheduled meeting requires client confirmation — Record Pass/Fail, evidence, and defect ID.
T10. Notification delivery and audit trail — Record Pass/Fail, evidence, and defect ID.
T11. Saved data persists after refresh and existing appointments are preserved — Record Pass/Fail, evidence, and defect ID.
T12. Keyboard and screen-reader behavior — Record Pass/Fail, evidence, and defect ID.
Final sign-off: developer must demonstrate the working implementation and tests; screenshots alone do not prove functionality.