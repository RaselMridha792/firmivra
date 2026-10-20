Settings → Locations
Developer Guide | Approved Screen References & Numbered Functional Requirements
Implementation note: Red numbers in the tables are developer callout IDs for each screenshot. Dialog behavior is specified below; it does not require a separate full page.
# Settings → Locations
SCREEN REFERENCE — Settings Locations.png
RED # / COMPONENT | DEVELOPER INSTRUCTION / CLICK BEHAVIOR
01  Location list | Display locations, assigned managers, status, and available actions.
02  Add New Location | Open the Add New Location form.
03  Location row | Open that location’s profile when selected.
04  Actions menu | Open the three-dot menu for location-specific actions.
# Location actions menu
SCREEN REFERENCE — Locations - 3 dot menu .png
RED # / COMPONENT | DEVELOPER INSTRUCTION / CLICK BEHAVIOR
01  View Profile | Open the selected location’s profile.
02  Edit Location | Open the Edit Location page with existing data populated.
03  Deactivate Location | Require confirmation and appropriate authorization; do not automatically deactivate staff accounts.
# Location profile
SCREEN REFERENCE — LVP Auburn Office Location Profile(1).png
RED # / COMPONENT | DEVELOPER INSTRUCTION / CLICK BEHAVIOR
01  Location information | Display saved location details, manager, hours and services.
02  Contact links | Email opens the default email composer; telephone initiates a call where supported.
03  Edit action | Navigate to Edit Location for this location.
04  Business hours | Show saved daily hours, including multiple time blocks.
# Add New Location
SCREEN REFERENCE — Add New Location Dashboard Form(1).png
RED # / COMPONENT | DEVELOPER INSTRUCTION / CLICK BEHAVIOR
01  Location details | Capture required location information and validate required fields.
02  Assign manager | Select an existing eligible manager; staff records are managed centrally.
03  Services Offered | Select only existing entries from Services & Pricing; no free-text creation or Other shortcut.
04  Business hours + | Add another open/close interval for the same day; prevent overlaps and disable times for closed days.
05  Save / Cancel | Save a valid location or leave with unsaved-changes confirmation.
# Edit Location
SCREEN REFERENCE — Edit Location Dashboard for Auburn Office(1).png
RED # / COMPONENT | DEVELOPER INSTRUCTION / CLICK BEHAVIOR
01  Breadcrumbs | Settings returns to Settings; Locations returns to location list; warn before leaving with unsaved changes.
02  Location information | Edit location-specific details; save validated updates.
03  EIN / business structure | Read-only here; Go to Company Profile opens Settings → Company Profile for authorized legal-entity changes.
04  Manager actions | Reassign Manager, Deactivate Manager and Go to Staff Management; edit staff details only in Staff Management.
05  Deactivate Manager dialog | Super Administrator only: confirm named manager; deactivate now or schedule future date/time; revoke access at effective time and preserve records.
06  Reassign Manager dialog | Choose an active manager; apply now or schedule future date/time; include Create New Manager link to Staff Management and return with new manager selected.
07  Go to Staff Management | Open Staff Management; preserve or warn about unsaved location edits.
08  Services Offered | Use central Services & Pricing options only, never arbitrary text.
09  Business hours | Allow multiple nonoverlapping blocks per day; saved hours flow to Location Profile.
10  Audit and scheduling | Record actor, timestamp, target and effective date; scheduled actions execute automatically and show their status.
# Cross-screen Rules & Acceptance Checks
Permissions: Only a Super Administrator may deactivate a manager; enforce authorization server-side, not only by hiding buttons.
Scheduled manager changes: use location timezone, validate future times, display pending effective date, and prevent conflicting pending changes.
Reassignment is not deactivation: reassignment changes the location manager; deactivation revokes the user’s system access at its effective time.
Before manager deactivation, prompt to assign a replacement or clearly flag an unassigned location.
Staff Management owns manager creation and personal details; Company Profile owns legal entities, EIN and business structure.
If a location belongs to a separate LLC, link to that location’s legal entity rather than automatically using the primary company.
Persist location changes to the list and profile views; never silently discard unsaved changes.
Test all breadcrumbs, emails, action menus, dialogs, scheduled jobs, audit logs, and return navigation.
Final Connection Audit — Developer Acceptance Checklist
Audit status: The guide covers the five screens and primary navigation paths. The following cases need explicit implementation decisions or acceptance tests; documentation alone does not verify working software.
ID | Area | Final-pass requirement
A01 | Settings / Locations | Breadcrumb navigation; location row selection; search/filter/sort/pagination if visible; three-dot menu dismissal and permissions.
A02 | Location profile | Email uses mailto:, phone uses tel: where supported; edit links open correct location ID; profile reflects saved manager, services, hours and status.
A03 | Add location | Required-field validation, duplicate location handling, manager eligibility, Save success/error states, Cancel and unsaved-changes warning.
A04 | Edit location | Correct location ID loaded; Save and Cancel; changes reflected in list/profile; EIN and structure remain read-only; Company Profile link resolves correct legal entity.
A05 | Manager deactivation | Only Super Admin; now vs scheduled with timezone; confirm; audit; preserve history; scheduled cancellation/editing rules need definition; no orphan location.
A06 | Manager reassignment | Active manager dropdown, create-new flow return, immediate/future scheduling, conflicts, effective-time updates and audit.
A07 | Staff Management | Go to Staff Management opens expected tab or manager record; unsaved edits handled; returning restores context.
A08 | Services and Pricing | Only centrally defined active services selectable; removed/deactivated services handled without data loss.
A09 | Business hours | Add/remove multiple daily intervals; validate opening before closing and non-overlap; closed days; time format/timezone; update profile.
A10 | Location deactivation | Confirmation, permission, location visibility/status, future appointments and staff accounts; staff accounts remain active unless separately deactivated.
A11 | Failure and edge cases | Network/save failure, unauthorized access, manager deleted/deactivated before scheduled change, conflicting concurrent edits, empty lists, loading indicators.
# Items requiring explicit product decisions
Whether location deactivation can be scheduled or only immediate.
Whether a scheduled manager change can be edited/cancelled, and by whom.
Whether a manager may manage multiple locations simultaneously.
Whether an unassigned location is allowed after manager deactivation.
Exact validation rules for duplicate locations and legal-entity changes.
Release gate: Developer should mark each audit row Passed / Failed / Not Applicable after testing. Until then, navigation completeness is specified but not technically verified.
FINAL APPROVED REQUIREMENTS — October 18, 2026
These decisions resolve the five open product questions in the preceding audit. They supersede any earlier recommendations presented as undecided.
# 1. Location deactivation
Super Administrator may Deactivate Now or Schedule Deactivation with a future date and time. Show confirmation and effective time. Scheduled deactivation executes automatically; staff accounts are not deactivated simply because their location is.
# 2. Scheduled actions can be changed
Super Administrator may edit or cancel any pending location deactivation, manager deactivation, or manager reassignment before its effective time. Provide Edit Schedule and Cancel Schedule controls, confirmations and activity history. Executed actions cannot be edited as pending.
# 3. Managers can oversee multiple locations
Staff Management Create/Edit Manager includes an Assigned Locations multi-select. One manager may be assigned to multiple locations; location access follows explicit assignments. Changing one assignment must not unintentionally remove others.
# 4. Acting manager is automatic
If a location manager is removed or deactivated without an immediate replacement, the Main Location Manager automatically becomes Acting Manager for the affected location until a new manager takes over. If a replacement is assigned immediately, do not apply the fallback. Scheduled removals trigger fallback at their effective time. Update Location Profile and activity history.
# 5. Prevent duplicate locations
Add and Edit Location must check for duplicate locations and block a true duplicate with a clear warning: “This location already exists. Please review the existing location before continuing.” Normalize and compare address and identifying information. Sharing an EIN or business name alone must not block distinct branches under one legal entity.
# Developer verification — cross-screen connections
Locations list → three-dot menu → Deactivate Location → Now / Schedule → confirmation → updated status and activity history.
Pending location/manager action → Edit Schedule / Cancel Schedule → confirmation → saved pending state and audit history.
Staff Management → Create/Edit Manager → Assigned Locations → location profile and access permissions update.
Edit Location → Reassign Manager → existing active manager or Create New Manager in Staff Management → return and apply now or later.
Manager deactivation/removal → immediate replacement OR Main Location Manager as Acting Manager → replacement ends acting assignment.
Add/Edit Location → duplicate validation → block genuine duplicate; permit distinct offices sharing an EIN.
Services Offered → Services & Pricing only; EIN/business structure → read-only link to Settings → Company Profile.
Business Hours → multiple non-overlapping intervals → Location Profile reflects saved schedule.
Unsaved edits → confirmation before navigation; failed saves → actionable error without data loss.
Acceptance note: This document specifies required behavior; the developer must test the working application against these checks.