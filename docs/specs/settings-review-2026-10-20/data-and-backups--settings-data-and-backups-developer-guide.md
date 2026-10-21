Firmivra Data and Backups Developer Instructions
Review date: October 19, 2026 | Settings > Data & Backups
Implement the corrections below and provide evidence for the clarifications before this section is approved. These instructions cover backups, retention, cancellation, company exports, restoration, and navigation to the audit log.
# Review status
Correction means a required product or wording change. Clarification means the developer must confirm implementation, scope, or evidence. A confirmed implementation gap becomes a correction.
Approved: Open Audit Log navigation, based on the owner’s test. Audit log contents and functionality have not been reviewed. Document categories navigation has not been confirmed.
# Corrections for backups and recovery
C01  Replace “Every quarter” with “Every month” and perform actual monthly restore tests. Record the date, scope, outcome, failures, corrective work, and successful retest.
C02  Display the last successful backup and last successful restore test dates. Show failure or overdue status accurately; do not label a failed test successful.
C03  Make all firm data stored in the platform recoverable within the rolling 35-day recovery window: uploaded documents, client records, forms, notes, messages, transactions, and settings. Inventory every stored data category and address coverage gaps.
The recovery window is the age of available recovery points, not the age of a document or the time restoration takes. A five-year-old document damaged today may be recovered from a recent good recovery point if covered. “Continuous” must not imply guaranteed zero data loss.
# Clarifications for backup implementation
Q01  Confirm automatic backups run for every firm and the 35-day recovery window is actually configured. Supply configuration evidence and earliest/latest available recovery times.
Q02  Provide the coverage inventory, encryption details, backup-failure monitoring, and successful restore-test evidence. Identify data held only by external integrations and any exclusions.
Q03  State maximum expected recent data loss and restoration time, including how these were tested. Confirm whether individual items can be restored without rolling back the entire firm.
# Retention and Cancellation
# Corrections for the 90 day cancellation policy
C04  Retain the firm’s records for 90 days after cancellation takes effect. Preserve authorized read and download access during this period; restrict full company exports to firm administrators.
C05  Reactivation within the 90-day window restores normal access to retained information. Cancel scheduled deletion and all remaining deletion reminders upon successful reactivation. Do not depend on a 35-day-old backup to satisfy this 90-day requirement.
C06  Send deletion-warning emails to the firm’s designated authorized contact email addresses on file at each interval below. Every notice must state the exact deletion date and time and explain how to download records or reactivate.
30 days before deletion
20 days before deletion
10 days before deletion
5 days before deletion
2 days before deletion
1 day before deletion
12 hours before deletion
C07  Revise retention wording to distinguish record retention during service, the 90-day post-cancellation access period, and backup recovery. Remove any misleading promise that all record categories remain available indefinitely after cancellation.
# Clarifications for retention and deletion
Q04  Confirm how retention periods are configured and enforced for each firm. The screen currently lists tax records as 7 years, payroll as at least 4 years, business formation as permanent, and audit logs as never removed. These displayed values are not approved as universal legal requirements.
Q05  Reconcile category retention and permanent audit-log wording with deletion after the 90-day cancellation period. Identify any required exceptions or holds, who authorizes them, and the wording shown to the firm before implementation.
Q06  Define the exact cancellation timestamp and deletion deadline, timezone, email recipient selection, delivery-failure handling, and deletion behavior across active storage, attachments, replicas, and expiring backups. Explain any residual backup retention and protection against restoring deleted firm data.
The developer must not silently interpret “permanent” as either indefinite platform storage after cancellation or permission to delete records subject to an applicable hold. Resolve the policy conflict explicitly.
# Export Restore and Audit Log
# Corrections for company data export
C08  Activate Export Company Data on this page. Replace “not offered on this page yet; contact support” with a working export flow.
C09  Restrict full-company export requests and downloads to firm administrators. Enforce permissions on the server as well as the page, scoped to the administrator’s firm.
C10  Export all firm records and uploaded files through a secure download. Show preparation, ready, and failure states. Record who exported, when, the firm, scope, and result in the audit log. Preserve administrator export access during the 90-day cancellation period.
# Corrections for restoration
C11  Activate Restore so a firm administrator can select an available recovery point and the data to recover, then initiate restoration. Replace the support-only placeholder.
C12  Before confirmation, show the selected time, scope, and whether current data will be overwritten. Require explicit confirmation, report progress and outcome, and record the actor, time, recovery point, scope, and result in the audit log.
C13  Keep restoration isolated to the correct firm. Preserve audit history; restoration must not erase the evidence of the restore itself or silently replay external actions such as sending messages or submitting transactions.
# Clarifications for export and restore
Q07  Specify export formats, included files and relationships, completeness checks, secure download access and expiry, and handling for large exports. Identify exclusions explicitly.
Q08  Confirm available restore granularity, overwrite and conflict behavior, recovery duration, failure handling, and operational safeguards. Individual-item recovery is pending confirmation; full platform data coverage is a requirement.
# Approved navigation and pending review
A01 Approved: Open Audit Log opens the correct audit log tab, as tested by the owner. This approval covers navigation only.
Pending: Audit log event accuracy, completeness, immutability, access controls, and retention require a separate review. Document categories navigation and behavior also remain unverified.
# Acceptance Checks
The developer must provide results and evidence for these checks. None are marked passed by this document.
1. Monthly restore scheduling and evidence match the displayed policy; failed or overdue tests are visible.
2. The 35-day recovery configuration and available recovery timestamps are verified.
3. Representative records and attachments from every data category restore correctly, including old documents from a recent recovery point.
4. Backup or restore failures raise monitored alerts; last-success dates update only after success.
5. Cancellation preserves authorized read and download access for the full 90 days.
6. Administrator company exports work both during service and within the post-cancellation window.
7. Non-admin, cross-firm, and direct API export attempts are denied.
8. Each of the seven deletion notices is scheduled correctly, including the final 12-hour email, with an exact deadline and working actions.
9. Successful reactivation before the deadline restores access and cancels deletion and remaining notices.
10. Retention exceptions, deadline boundary behavior, and backup expiry follow the clarified deletion policy.
11. Exports include records and uploaded files; download permissions and audit entries are verified.
12. Restore preview, overwrite warning, confirmation, progress, success, and failure states work.
13. Cross-firm restore attempts are denied; restoration does not erase audit evidence or replay external actions.
14. Open Audit Log still opens the correct tab; audit functionality is tested separately.
15. Document categories navigation is tested and assigned its own result.
# Screen Reference
Settings > Data & Backups. Reference screen before the requested corrections. The Open Audit Log navigation approval comes from the owner’s test.