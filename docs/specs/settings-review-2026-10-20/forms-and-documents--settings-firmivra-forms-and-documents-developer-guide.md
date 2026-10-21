Firmivra Forms and Documents Developer Instructions
October 19, 2026 | Settings > Forms & Documents
Implement the corrections and verify all approved requirements during beta testing. Approval below reflects the owner’s review of a requirement or navigation; it does not establish that security or end-to-end functionality has passed testing.
# Allowed Files
Item | Status | Instruction and verification
File types | Approved | Keep PDF, JPG, PNG, Excel (.xlsx), and Word (.docx). Word remains allowed. Verify each format uploads and opens correctly for authorized clients and staff.
Largest file | Correction | Replace 10 MB with 100 MB per file in the page and server enforcement across upload entry points. Allow multiple-file uploads. Test below, at, and above the limit.
Office macros | Approved | Refuse Office files with macros. Confirm server-side enforcement during beta, including files renamed to look like an allowed format.
Upload experience | Required behavior | Provide upload progress, scanning status, and retry/resume for interruptions. Verify slow connections and large-file handling.
Beta readiness | Clarification | Developer must demonstrate these controls are functional for beta testing. Record evidence and results; missing or failing functionality requires correction.
Batch limits | Approved for implementation | Allow up to 20 files per batch and 500 MB combined, with a 100 MB per-file limit. Enforce all limits server-side and test capacity.
# Storage and Security
Item | Status | Instruction and verification
Private encrypted storage | Approved with testing pending | Firmivra manages storage. Keep each firm’s documents protected and isolated. Confirm encryption at rest and in transit and test denial of cross-firm access. A separate physical server per firm is not required by this approval.
Malware scan | Approved with testing pending | Scan before anyone can open, preview, or download an uploaded file. Confirm infected files are blocked or quarantined and unavailable while scanning is pending or fails.
Shared links | Correction for implementation | Client links expire after 24 hours and require no portal account. Internal links expire after 48 hours and still require staff sign-in and document permissions.
Client portal access | Required distinction | An expired sharing link must not remove the client’s authorized portal access. Clients can access retained information from the portal during the applicable account-access period. Refresh temporary file-access links as needed after checking permissions.
Link wording and expiry | Correction for implementation | Replace “signed-in people only” for external client sharing. Provide separate firm-admin toggles for client and internal verification, both ON by default. Log changes. An expired sent link must not block normal authorized portal access.
# Document Categories
Item | Status | Instruction and verification
Open Documents | Navigation approved | Owner confirmed the button opens the correct Documents section. Preserve and regression-test this destination.
Categories | Pending separate review | Review creating and assigning categories in Documents later. The card currently shows no categories. Do not mark category behavior or Documents functionality as passed.
# Retention
Item | Status | Instruction and verification
Active accounts | Correction | While the account is active, retain records until the firm deletes them, subject to retention restrictions and legal holds. Do not automatically delete merely because a displayed year count has elapsed.
Displayed periods | Clarification | Current screen: tax 7 years; payroll at least 4 years; formation permanent. Treat these as guidance pending verification, not universal legal minimums. Clarify the firm’s recordkeeping responsibility separately from Firmivra storage.
Permanent formation records | Correction | “Permanent” must not imply indefinite Firmivra storage after cancellation. Explain that the firm is responsible for preserving any required records beyond the platform access period.
Cancellation | Correction | After cancellation takes effect, retain records for 90 days with authorized viewing and downloading. Full company exports remain firm-admin only. Reactivation within that period restores normal access and cancels scheduled deletion and remaining reminders.
Deletion emails | Correction | Send notices to designated authorized contact emails 30, 20, 10, 5, 2, and 1 day, then 12 hours before deletion. Include the exact deletion deadline and download/reactivation instructions.
Legal hold | Approved for implementation | Pause deletion of affected held records even after the 90-day cancellation window. Keep held records restricted and log who places and releases each hold. Test hold enforcement and release.
Inactive meaning | Clarification | Define the trigger as cancellation taking effect. Lack of login activity alone must not start deletion. Confirm behavior for suspension or nonpayment, which has not been decided.
Consistency | Required verification | Match Data & Backups and related policies. The 35-day backup recovery window is separate from active record retention and the 90-day cancellation window.
# Forms and Templates
Item | Status | Instruction and verification
Intake Form Settings | Navigation approved | Owner confirmed it opens the Intake tab. Intake functionality remains pending separate review.
Templates | Correction | Owner encountered “Page not found.” Fix the destination and ensure the Templates page loads. Template functionality remains pending review after the fix.
Terms and Privacy | Navigation approved | Owner confirmed the destination is correct. This approval does not verify policy content or functionality.
Firm Sign | Navigation approved | Owner confirmed it opens the correct section. Signing functionality remains pending separate review.
# Implementation Status and Follow Up
Item | Status | Instruction and verification
Sent link lifetime | Resolved for implementation | Client links: 24 hours. Internal links: 48 hours. Apply expiry server-side; preserve normal authorized access within the platform.
Batch upload capacity | Resolved for implementation | 20 files per batch, 500 MB combined, 100 MB per file. Developer must validate capacity and handling of partial failures.
Retention guidance | Policy verification needed | Verify which record categories and periods apply to each firm type before presenting them as minimum requirements.
Legal holds and closure | Approved for implementation | Implement restricted preservation of held records beyond cancellation. Specify hold and release permissions, deadline timezone, recipient selection, and backup expiry behavior. Test that cancellation deletion skips held records.
Evidence | Developer response needed | Provide beta-test results, configuration evidence, and remaining gaps. An approved requirement must still be functional; failures become corrections.
Implement and test the approved sharing, code, upload, and retention requirements. No further owner decision is required for this developer package. Record test results and remaining implementation details.
# Beta Acceptance Checks
1. Upload each approved format from client and staff entry points; verify authorized access.
2. Accept files at the configured 100 MB limit and reject larger files with a clear message; verify server enforcement.
3. Upload multiple files and verify progress, scan status, interruption recovery, and documented batch limits.
4. Reject macro-enabled or disguised files; verify content validation rather than extension alone.
5. Confirm encryption and prevent cross-firm and unauthorized-client access.
6. Block pending, failed-scan, and infected files from opening, previewing, or downloading.
7. Verify sent link expiry and permission checks while retaining authorized portal access.
8. Confirm active records are not deleted solely because listed years elapse; verify authorized deletion restrictions.
9. Test cancellation access for 90 days, all seven reminder intervals, reactivation cancellation of deletion, and clarified legal-hold behavior.
10. Regression-test Open Documents, Intake, Terms & Privacy, and Firm Sign navigation.
11. Verify Templates no longer returns Page not found; record subsequent functionality review separately.
12. Test both verification toggles and channels, client access without a portal account, 24/48-hour link expiry, 10-minute single-use codes, five-attempt limit, 15-minute cooldown, resend invalidation, and limits that cannot be bypassed by resending.
# Forms and Documents Screen Reference
Reference screen before corrections. The displayed 10 MB limit must become 100 MB. Navigation results are based on the owner’s tests.
# Approved Sharing and Verification Implementation
Item | Status | Implementation
Separate toggles | Correction | Add independent client-sharing and internal-sharing code requirements to Storage & Security. Both start ON. Only authorized firm administrators can change them; audit actor, time, and old/new value.
Opposite channel | Correction | Emailed links require a code to the recipient’s verified phone when enabled. Texted links require a code to verified email. Missing second-channel information must not bypass verification.
External clients | Correction | No portal account is required. Code ON: verify before opening. Code OFF: possession of the link grants document access until its 24-hour expiry; forwarded links can therefore grant access. Clearly explain this behavior to the administrator.
Internal staff | Correction | 48-hour link expiry. Code ON adds opposite-channel verification. Code OFF removes that extra step only. Staff sign-in, permissions, and applicable MFA remain enforced.
Code controls | Approved implementation | Single-use codes expire 10 minutes after issue. Five incorrect attempts pause verification for 15 minutes. Resending invalidates the previous code and does not reset failure/cooldown counters. Rate-limit requests and resends; developer must specify concrete resend limits.
Code confidentiality | Required verification | Bind codes to the recipient and share. Do not log code values. Test used, expired, incorrect, replaced, and wrong-recipient codes, delivery failure, and missing contact methods.
Portal distinction | Approved implementation | Sent sharing-link expiry does not remove documents or revoke normal authorized portal access. Temporary file access must be renewed only after checking permissions.
Timing and review | Approved implementation | Build and test all approved requirements. Provide configuration evidence, test results, and any unresolved technical details to the owner.
Technical reference: OWASP Multifactor Authentication Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html. Supports short-lived single-use codes and attempt limits; the specific timings and batch limits above are owner-approved product choices, not values prescribed by that source.