Appointments Developer Instructions
Prepared for the development team  |  October 20, 2026
Implement the corrections below and return the module for retesting. Archive and Restore status changes are approved. All other pending behaviors remain unverified until tested. Acceptance criteria translate the supplied requirements into checks for developer review.

# Status key

| Status | Meaning |
|---|---|
| Approved | Green — working behavior reported by the reviewer |
| Correction required | Red — development changes required |
| Pending test | Amber — behavior still requires verification |


# Approved behavior

| Item | Approved result |
|---|---|
| Archive and Restore | Both actions change status correctly. Public booking restrictions for archived types are still part of correction 3. |


# Corrections required

The detailed implementation table begins on the next page. Red shading indicates required changes.

# Required implementation changes

| ID and area | Developer instruction | Acceptance check |
|---|---|---|
| 1Meeting methods and validation | Allow multiple meeting methods to be selected. On save failure, highlight the exact fields with errors and preserve entered values. | Select multiple methods and save. Trigger a validation failure; verify field-specific errors and retained values. |
| 2Booking window | Add 2, 6, 12 and 24 hours and 3, 5 and 7 days. Keep Booking Window separate from Minimum Notice. | Each requested option is available and persists after saving. Changing Booking Window does not overwrite Minimum Notice. |
| 3Booking links and archive | Add Copy Booking Link and Copy Embed Code for each appointment type. Archiving must stop new public bookings. | Copied link and embed code target the correct type. Attempting a new public booking for an archived type is blocked. |
| 4Save Client inline | Add Save Client within the scheduling workflow. | Create and save a client inline, then select that saved client for the appointment without losing scheduling details. |
| 5Staff Availability | Fix availability save errors. Report conflicts only when an appointment is truly outside staff availability. | Save valid availability and reopen to verify persistence. Test appointments inside and outside the saved availability; show the conflict only for the latter. |


# Required implementation changes

| ID and area | Developer instruction | Acceptance check |
|---|---|---|
| 6Zoom link layout | Align the Zoom toggle. Provide a full-width link field with a Copy button. | Toggle and field are aligned and readable. The Copy button copies the complete Zoom link. |
| 7Multiple reminders and channels | Support SMS and multiple reminders. Allow Email, SMS and Portal selections per reminder. | Create multiple reminders with different timing and channel selections. Save and reopen to verify each reminder retains its configuration. |
| 8Client confirmation | Require client confirmation after scheduling. Until confirmed, reminders continue requesting confirmation; after confirmation, they only remind. | Test an unconfirmed appointment, confirm it, then verify later reminders no longer request confirmation. |
| 9Service intake request | Tie the intake form request to the service selected in the appointment. Track completion on the appointment record. | Request the intake form for the selected service. Complete it as the client and verify completion is recorded on the appointment. |
| 10Internal description | Keep the appointment type description internal only. | Verify staff can view the description internally and it does not appear in public booking views or client-facing appointment content. |


# Pending verification

These tests are pending, not approved. Record Pass, Fail or Blocked and attach evidence for each result.
| Test | Verification required |
|---|---|
| Draft | Save and reopen a draft; verify saved details. |
| Reschedule | Change the appointment date or time and verify the updated record. |
| Cancel | Cancel an appointment and verify its status and scheduled reminders. |
| Complete | Mark an appointment complete and verify its saved status. |
| No-show | Mark an appointment as no-show and verify its saved status. |
| Recurring | Create a recurring appointment and verify the generated dates and times. |
| Reminder delivery | Verify actual delivery for configured Email, SMS and Portal reminders. |
| Confirmation behavior | Verify confirmation requests before confirmation and reminder-only messages afterward. |
| Intake completion | Verify the service-linked form and completion recorded on the appointment. |
| Staff Status permissions | Test Staff Status actions for each configured role against the intended permissions. |


# Screenshots to attach

The supplied screenshots are embedded in the evidence appendix. Captions link each image to its correction.
S1  Meeting-method error — correction 1S2  Staff availability save error — correction 5S3  Missing Save Client button — correction 4S4  Booking window options — correction 2S5  Reminders panel — corrections 7 and 8

# Developer handoff

Return the build or version tested, completion status by correction ID, test results, and any remaining blockers. A completed correction requires a successful acceptance check before approval.

# Screenshot evidence


## S1 Meeting method save error

Correction 1 — selected methods and the displayed save error.

## S2 Staff availability save error

Correction 5 — availability settings and the displayed save error.

# Screenshot evidence


## S3 Scheduling client form

Correction 4 — client information area requiring an inline Save Client button.

## S4 Current booking window options

Correction 2 — current choices before adding the requested shorter windows.

# Screenshot evidence


## S5 Reminders panel

Corrections 7 and 8 — reminder channels and confirmation controls.

## S6 Availability conflict message

Correction 5 — conflict message to verify against saved staff availability.
