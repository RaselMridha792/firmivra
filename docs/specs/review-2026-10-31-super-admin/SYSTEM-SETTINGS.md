# Super Admin review (Oct 31): System Settings change list

Source: "System Settings Developer Feedback" (Review One, Oct 31, 2026, 17:48 to 17:50 UTC) against the System Settings Developer Instructions (16 pages, 19 tables). All seven categories and three empty forms inspected; nothing saved. Her codes are kept (F1, A1, P1 ...). Her unnumbered candidate rows (anchor, legal hold, required notifications) are ours: SA-SYS-Y01 to Y03. Her F5 row has three parts: F5a to F5c.

## Summary

1. F items: 7 (F1, F2, F6, F8, A1, A2, A3). Y items: 19 (F3, F4, F5a to F5c, F7, Y01 to Y03, P1 to P10). GREEN: 8 category rows, not items. Keep them working and re-test them at Review 2.
2. Her priority first: Audit Logs shortcut (F1), setting metadata (F2), maintenance notice preview (F6). Next: the approved precedence contract (F8) and the three approved additions (A1 to A3).
3. Approved precedence contract (F8), in order: mandatory platform and security restrictions; firm-locked policy; permitted user choice; fallback defaults. It replaces the conflicting guide text on General, Defaults and cross-page precedence.
4. Out of scope: the future Website tab (public pricing, packages, promotions). It goes with the Website Management pass.
5. Schema: to check for A2 (previous setting values are not stored; only a version counter), F8 (where firm locks and user choices live) and A3 (last successful test per channel).
6. Role checks: read vs edit on every category on the server; firm-locked settings refused on the server, not only hidden (F8); restore needs authorization and confirmation (A2).
7. Shared: readiness states used by Settings, Integrations and Notifications (A3); step-up reauthentication for restore (A2), same component as SA-FRM-F10.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/system-settings/`. API: `apps/api/src/admin-settings/`. DB: `PlatformSetting` (typed value, `version`, `updated_by_user_id`), `PlatformSecretRef`, `PlatformBrandAsset`, `PlatformFeature`, `PlatformFeatureOverride`, `PlatformRetentionPolicy` (`effective_from`, `version`), `PlatformLegalHold` (`held_business_id`), `PlatformRetentionRun`.

## A. Corrections and source gaps

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-SYS-F1 | F1 | General > "View Audit Logs" quick link | Opens `/audit-security?view=policies` (Security Policies). | Open the Audit Logs view filtered to System Settings changes (resource type settings). Do not copy Audit screens into Settings. | No. | None. |
| SA-SYS-F2 | F2 (source pages 4 to 8, 10, 15) | Landing cards; General; Branding; Email; Retention | Landing cards lack status and last modified; General "Updated By" blank; no version, modified or inheritance context; Retention lacks saved effective dates and minimum or lock details. | Show per setting or section: scope, saved value, effective value, where it comes from (inherited or set), editable or locked, version, last changed by and when. Landing cards show status and last modified. Retention shows effective date, legal minimum and lock. Read it all from the saved backend response. | To check: version and updated-by exist; retention minimum and lock fields may not. | Seed: settings changed by a known test login. |
| SA-SYS-F6 | F6 (source pages 12 to 13) | Schedule Maintenance form | No user-notice preview; local date and time inputs with no timezone label. | Add a sanitized preview of the notice users will see (title, message, start and end in their time). Label the inputs with the timezone (America/New_York) and show the UTC equivalent. Reject an end before the start. | No. | None. |
| SA-SYS-F8 | F8; "Approved precedence contract"; "Field mapping still needed"; "Privacy and authorization boundary" | All settings that firms or users can change | Guide text conflicts (pages 6, 14 to 15); the user approved the contract during the review. | One resolver applies the four-level order everywhere: mandatory restriction, firm-locked policy, permitted user choice, fallback default. Map every setting to one of those kinds in a single table in code. A locked control is disabled with a reason, and the server refuses the change. Explicit values stay distinct from "inherit". Reset removes an override instead of copying a default. Update the guide to match. Generic Super Admin wording never grants access to firm workspaces. | To check: where firm locks and user choices are stored today. | Role: server refuses locked changes. Seed: a firm-locked and a user-overridable setting on two firms (set K). |

## B. Approved additions

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-SYS-A1 | A1 | New: Setting control and impact map | Not present. | A per-setting map: who controls it, locked or overridable, default and effective value, affected modules, when a change takes effect, who owns rollback. Generated from the F8 mapping table, not a second copy. Demonstrate one firm-locked and one user-overridable setting. | No (generated from code). | None. |
| SA-SYS-A2 | A2 | New: version comparison and restore preview | Not present. | Compare current and previous values of a setting; preview exactly what a restore would change (and which modules and users it affects); restore needs permission, reauthentication, confirmation and an audit entry. Restore keeps unrelated settings and secret references, and never overrides security restrictions, legal holds or retention minimums. A failed restore changes nothing. | Yes, to check: previous values are not stored (only `version`); either a setting-history table or before and after values in the audit log. | Role: restore permission. Shared: step-up reauthentication. |
| SA-SYS-A3 | A3; F3 | New: readiness panel | SMS is "On" in channel defaults while SNS says "Not configured". | For each channel and integration show four states: enabled, configured, connected, last successful test (with time). "Enabled but not configured" shows a warning with a link to fix it. Same states and links in Settings, Integrations and Notifications. Configured never reads as delivered. | To check: where the last successful test time is stored. | Shared: readiness states. Seed: healthy, unconfigured and unavailable fixtures (set K). |

## C. Y items: follow-ups and candidates

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SYS-F3 | F3 | SMS on, provider not configured | Default: covered by A3; while SMS is not configured, sending by SMS is blocked with the reason shown. Verify with provider evidence. |
| SA-SYS-F4 | F4 | Dev site shows localhost URLs and version 0.0.0 | Default: set the dev environment's app and API URLs and inject the build version from CI. Check every generated link (emails, invites) uses the environment URL. |
| SA-SYS-F5a | F5 "Feature plan access" | Plan access unavailable for features | Default: rollout flags only this round; plan entitlements follow the v72 catalog in the later pricing pass. Seed harmless flags, a dependency and two firms on different plans. |
| SA-SYS-F5b | F5 "Jobs and platform tools" | No jobs; Clear Cache, Rebuild Search, Diagnostics say no tool exists | Default: keep the honest "not available yet" text. Later tools are allowlisted actions only, never arbitrary commands. |
| SA-SYS-F5c | F5 "Permission templates" | Defaults explains firms manage roles; non-interactive Edit text | Default: keep the explanation; render it as plain text, not styled like a button. |
| SA-SYS-F7 | F7 | Disabled vs Emergency Off legend | Default: labels "Off by default (firms may turn on)" and "Emergency off (all firms, no override)". Emergency off is enforced on the server; test with seeded flags. |
| SA-SYS-Y01 | "Branding anchor candidate" | Email Branding link opens `#branding` with no target | Default: add the `branding` anchor to the branding section of the Email page; if that section does not exist, link to the Branding category instead. |
| SA-SYS-Y02 | "Legal hold target scope" | New Hold has no record or firm target | Default: a hold applies to one firm (the table already has `held_business_id`) or to the whole platform; add a firm selector. Record-level holds later. Test with held and unheld synthetic records. |
| SA-SYS-Y03 | "Required notification controls" | Recipient menus include "Nobody" | Default: security alerts and payment-failure alerts are required: "Nobody" is not offered for them and the server rejects it. All other categories stay optional. |

## D. Y items: Review 2 tests (her P1 to P10)

Fixtures are dummy data set K in CHANGE-LIST.md, in an isolated dev configuration with a rollback plan.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SYS-P1 | P1 | Save and reset | Persisted reads, atomic multi-field save, reset removes overrides, unrelated categories and secrets unchanged, audit entry on save. |
| SA-SYS-P2 | P2 | Validation and concurrency | Invalid values rejected by the server; two admin sessions with stale versions (the `version` check); unauthorized and service-down states. |
| SA-SYS-P3 | P3 | Branding lifecycle | Dummy assets: type, size and dimension checks, scan, contrast, cache refresh, firm overrides, reset without touching shared defaults. |
| SA-SYS-P4 | P4 | Email and channels | Controlled QA recipient only: delivery, retries, de-duplication, suppression, required alerts, preference precedence (F8). |
| SA-SYS-P5 | P5 | Feature behavior | Seeded flags and dependencies on two firms: immutable keys, overrides, server gates, emergency off. |
| SA-SYS-P6 | P6 | Retention and holds | Synthetic aged records and holds; dry run only unless destructive execution is approved; hold beats purge; minimums enforced. Also the after-day-90 rule for closed firms (SA-FRM-Y02). |
| SA-SYS-P7 | P7 | Maintenance and jobs | After F6 and allowlisted tools: notice preview, timezone and DST, admin bypass, write restrictions. |
| SA-SYS-P8 | P8 | Defaults and provenance | New firm and user fixtures get the current defaults version; existing records keep theirs. |
| SA-SYS-P9 | P9 | Settings audit | Immutable id, UTC time shown in the user's zone, actor, key, scope, safe before and after values, never secrets. |
| SA-SYS-P10 | P10 | Security and production | Read-only and edit test logins (set L); server checks; secret handling; environment URLs and version (F4). |

## E. Schema needs (each needs Rasel's tap before any `packages/db` change)

- A2: previous setting values (a history table, or before and after values captured in the audit log), to check.
- F8: storage of firm locks and user choices, to check.
- A3: last successful test time per channel or integration, to check.
- F2: retention minimum and lock fields, to check.

## F. Role and permission notes

No new role. Read vs edit separation on the server for every category (P10); firm-locked settings refused on the server (F8); restore requires permission and reauthentication (A2).
