Firmivra Security and Access Developer Guide
Developer feedback and acceptance criteria • October 19 2026
Update Settings → Security & Access using the owner’s review below. Navigation to Users & Roles, Staff Management, Integrations and Audit Log is approved. Security enforcement, session termination, integration security and alert accuracy require verification. This guide does not certify the implementation.
# Review status
Control or area | Required behavior
Review Users | APPROVED navigation to Settings → Users & Roles. MFA enforcement and enrollment remain unconfirmed.
Open Staff Management | APPROVED navigation. Destination functionality is outside this review.
Open Integrations | APPROVED navigation. Page is currently empty; integration functionality and secure key storage are untested.
Open Audit Log | APPROVED navigation. Audit completeness, accuracy and retention remain unverified.
MFA card | FIX REQUIRED: data does not load. Required badge is not proof of enforcement.
Password policy | CHANGE REQUEST: 15-character minimum; allow spaces and symbols without mandatory character mixtures.
Session limits | CHANGE REQUEST: 8-hour overall maximum, 15-minute inactivity timeout and 2-minute warning.
Session termination | Owner approves the intended rule: deactivation or password reset ends every session. Actual behavior must be tested.
# Approval boundary
Approve only the navigation and intended behavior explicitly identified above. Do not mark the entire Security & Access page as functionally approved until the acceptance tests pass. Forms & Documents will be reviewed separately.
# Top screenshot and correction locations
Figure 1. Existing top section supplied by the owner. Screenshot documents visible text and state only.
Control or area | Required behavior
Top left  MFA | Fix “Could not load this right now.” Replace static required wording with the actual firm policy and verified enrollment data.
Top right  Password Policy | Replace 12 characters and mandatory character mix. Show the approved threshold and lockout details accurately.
Bottom left  Sessions and Devices | Replace 7 days with the approved session limits. Define inactivity separately and ensure autosave does not renew an idle session.
Bottom right  Integration Access | Keep the working link. Confirm encryption, secret masking, permissions and firm isolation when integrations are implemented.
# MFA policy and password changes
MFA is enabled and required by default. Firmivra serves multiple business types. Provide firm-level policy control only where applicable requirements permit it. Only the firm owner or an explicitly authorized security administrator may change the requirement; require fresh authentication, confirmation and audit logging. Do not treat a company-type label as sufficient evidence that MFA can be disabled.
Tax firms generally must use MFA under the FTC Safeguards Rule unless a Qualified Individual approves an equivalent secure access control in writing. Do not implement an unrestricted off switch for these firms. Confirm how eligibility and documented exceptions are governed before release. Removing a firm-wide requirement must not delete existing personal MFA enrollment.
Each employee enrolls their own authentication method. Define secure recovery and administrator-assisted reset, including identity verification and re-enrollment. Log resets and policy changes without storing recovery secrets in logs. Confirm supported methods, enrollment status, enforcement points and recovery location with the developer.
Fix the MFA data-loading error and provide a retry action. Distinguish unavailable data from zero enrolled users. Never infer enforcement from the Required badge or permit a failed data request to bypass authentication.
# Password rules
Set the minimum to 15 characters across the platform. Allow spaces and special characters; remove mandatory uppercase, lowercase, number and symbol combinations. Accept long passphrases and support at least 64 characters. Keep compromised-password blocking and protections against repeated guessing. Enforce the same policy in account creation, invitations, password changes and recovery. Confirm migration behavior for existing passwords without unexpectedly locking users out.
# Failed password attempts and countdown
Five failed password attempts within a rolling 15-minute window trigger an immediate 15-minute temporary lockout on the fifth failure. This threshold is the owner’s product policy, not an OWASP-prescribed number. The lockout starts at the fifth failure, not after waiting for the counting window to finish.
Display a live countdown on the login screen, such as “Try again in 14:59.” Derive remaining time from the server expiry. Refresh, another tab, another device or client clock changes must not reset or bypass enforcement. At expiry allow another attempt; require normal authentication before access. Attempts during an active lockout must not silently restart the countdown.
Keep secure recovery available. Define increasing delays for repeated abuse and protection against attackers deliberately locking out other users. Scope counters correctly to the account, with supplementary source-level throttling. Confirm reset rules and separate MFA-code protections. Use responses that do not disclose whether an account exists. Record failures and lockouts without passwords or codes.
# Sessions and draft recovery
Control or area | Required behavior
Overall session | Maximum 8 hours from authentication even during continuous use. Require sign-in again at expiry.
Inactivity | End the session after 15 minutes without meaningful user activity. Background polling, autosave and token refresh must not count as activity.
Warning | Show a warning 2 minutes before expiry. An active user may continue before idle expiry, subject to the 8-hour maximum.
Backend enforcement | Expire session credentials on the server. Refreshing a page, changing the clock or using a trusted device must not bypass limits.
Reset or deactivation | Immediately revoke every session and refresh token for the affected user across devices. Deactivated accounts cannot sign back in.
Sensitive actions | Require fresh authentication for security changes. Clarify trusted-device behavior and which session settings are firm policy versus personal preferences.
# Preserve work before logout
Automatically save supported work as secure drafts while the user works, rather than relying on a final request after logout. Restore the latest successfully saved draft after sign-in for the same authorized user and firm. Show save status, last saved time and actionable failure feedback. Cover forms, editors and settings that accept unfinished work; document any unsupported field or workflow before sign-off.
Draft saving must not send communications, submit tax returns, activate workflows, execute payments or apply unfinished settings. Validate drafts when the user explicitly commits them. Preserve drafts without extending idle or overall session limits, exposing sensitive data in browser storage, or restoring access after a user is deactivated. Handle concurrent edits and network loss without silently overwriting newer work.
# Integration access checks
The Open Integrations link is approved. The destination is empty, so connection setup, account authorization, key encryption, secret display rules, revocation and access controls remain pending review. Verify server-side permissions and separation between firms. Do not claim secure key storage has been tested because the card describes it.
# Implementation confirmation
Developer to identify the authentication provider, current password and lockout settings, token/session revocation mechanism, firm MFA policy enforcement and autosave coverage. Return test evidence and any constraints before marking the security behavior complete.
# Security Alerts screenshot and review
Figure 2. Existing Security Alerts section. Open Audit Log navigation is approved by the owner.
The card describes failed sign-ins in the last 30 days, newest first. All visible identities show Unknown account. Confirm whether these are genuinely unmatched sign-ins, missing identity mapping or another source. Do not infer a breach or a broken identity mapping from this screenshot alone.
Verify genuine failed sign-ins appear with the correct timestamp, timezone, actor when known, source address and firm scope. Investigate repeated-looking records using event identifiers before deduplicating; identical displayed timestamps and IPs do not prove duplicate events. Confirm reliable trusted-proxy handling for source addresses.
The 30-day label is a display window, not an instruction to purge audit records after 30 days. Confirm the separate retention, access and export policy. Verify password resets, deactivation, MFA changes, lockouts and security-setting changes generate appropriate protected audit events. Secrets must never enter the log.
# Reference guidance
Product choices: 8-hour overall session, 15-minute idle timeout and 5 failures within 15 minutes followed by a 15-minute lockout. These are selected defaults, not universal legal timing requirements.
NIST SP 800-63B-4: password rules and AAL2 session guidance. AAL2 recommends no more than 24 hours overall and 1 hour inactive; the requested defaults are stricter. https://pages.nist.gov/800-63-4/sp800-63b/
OWASP Authentication Cheat Sheet: account lockout threshold, observation window, duration and denial-of-service considerations. https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
IRS Security Summit guidance on MFA for tax firms and documented equivalent controls. https://www.irs.gov/newsroom/security-summit-strengthen-defenses-against-tax-identity-theft
# Acceptance tests and completion evidence
Control or area | Required behavior
01 Navigation | All four approved links still open their intended destination with the correct firm and permissions.
02 MFA data | Card loads real firm data; unavailable requests show an honest error and retry without authentication bypass.
03 MFA enforcement | Required staff cannot access protected data until enrollment and MFA authentication complete.
04 Policy control | Only authorized roles change firm policy; confirmation, fresh authentication and audit logging occur. Required policy restrictions and approved exceptions are respected.
05 Recovery | Lost-factor reset uses identity verification, re-enrollment and audit records; no unintended permanent bypass.
06 Password policy | 14 characters rejected; valid 15-character passphrase accepted without forced character mix. Long passwords and compromised-password blocking work across every password flow.
07 Threshold | Four failures do not trigger this lockout; fifth within rolling 15 minutes immediately starts a 15-minute lockout. Failures outside the window behave correctly.
08 Countdown | Countdown remains accurate after refresh, new tabs, device changes and clock changes. Attempts during lockout do not restart it. Server blocks access until expiry.
09 Recovery and abuse | Secure recovery works during lockout. Repeated abuse controls and account-enumeration protections are tested.
10 Overall timeout | Continuous activity cannot extend a session past 8 hours without reauthentication.
11 Idle timeout | 15 minutes of inactivity expires access; background requests and autosave do not extend it. Warning appears 2 minutes before expiry.
12 Revoke sessions | Password reset or deactivation revokes all existing sessions and refresh tokens across devices.
13 Draft recovery | Work in each supported editor survives timeout and is restored only after authorized sign-in; draft saving does not execute the work.
14 Save failures | Network failure or concurrent edits produce visible feedback and safe recovery without falsely claiming every change was saved.
15 Integration security | When implemented, verify connection permissions, firm isolation, encryption, secret masking and revocation separately from navigation.
16 Alerts | Controlled failures appear with correct event details and authorized firm scope; Unknown account behavior is explained.
17 Audit and retention | Security actions are logged safely. 30-day display filter does not unintentionally delete retained records.
18 Access controls | Unauthorized users cannot change policies or access other firms’ alerts, drafts, keys or audit records.
Completion: provide test results, affected routes or components, evidence of backend enforcement and a list of any remaining limitations. Obtain final functional approval after outstanding checks pass.