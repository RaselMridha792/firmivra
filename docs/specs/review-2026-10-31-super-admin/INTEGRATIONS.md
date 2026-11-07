# Super Admin review (Oct 31): Integrations change list

Source: "Integrations Developer Feedback" (Review One, Oct 31, 2026) against the Integrations Developer Guide (Oct 14, 13 pages). Six areas reviewed: dashboard, Platform Integrations, Customer Catalog, API & Webhooks, Logs, Usage. Her codes are kept (R1, Y1 ...). Keep three concepts apart in every item: Platform Connection, Catalog Entry, Customer Firm Connection.

## Summary

1. F items: 4 (SA-INT-R1 to R4). Y items: 12 (SA-INT-Y1 to Y12). GREEN: 12 checks (G1 to G12), not items. Keep them working and re-test them at Review 2.
2. Her priority 1: draft-save disclosure (R1) and immediate refresh after save (R2). Priority 2: adoption by plan (R3) and the custom-range mismatch (R4). Priority 3: operational fixtures before connection, catalog, key, webhook and security tests.
3. Keep the Stripe Test draft `int_001` (Draft, step 2 of 4, not connected). Do not delete it.
4. Schema: none. R3 is a read query (catalog-plan links and firm subscriptions already exist).
5. Role checks: view, configure, secret, disable and catalog-access permissions enforced on the server (Y8).
6. Shared: "save and continue" pattern with SA-COM-R8 (R1); `packages/ui` date-range control (R4); readiness states from SA-SYS-A3 (Y3).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/integrations/`. API: `apps/api/src/admin-integrations/`. DB: platform integration tables and `PlatformIntegrationCatalogPlan` (catalog entry to plan).

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-INT-R1 | R1 (sections 4, 14) | Add integration wizard > General > Next | Next shows "Saving" and creates a draft; a separate Save Draft also exists. | Label the button "Save and continue" and show "Draft saved" with the time. Cancel on a saved draft keeps it and offers "Discard draft"; Cancel on an unsaved one asks first. Next on an existing draft updates it, never creates a second one. | No. | Shared: same pattern as SA-COM-R8. |
| SA-INT-R2 | R2 (sections 2 to 4, 14) | Integrations list and cards after save | Back through normal links still shows zero; only a full reload shows the draft and Total 1. | After any save, refresh the list and card queries (invalidate the cache) so the draft appears at once. Drafts count in Total, never in Active. | No. | None. |
| SA-INT-R3 | R3 (section 10) | Usage > Catalog scope | "Connected firms are not counted by plan yet." | Count customer firm connections per catalog entry grouped by the firm's current plan. Empty state says "No firm has connected this yet" (not "not counted"). Counts follow connects, disconnects and plan changes. Drill-down shows counts only, no other firm's data. | No (read query). | Seed: firm connections on two plans (set I). |
| SA-INT-R4 | R4 (sections 10, 14) | Usage > API > Custom range | Inputs changed to Oct 1 to 15, but URL, cards and chart stayed on Oct 25 to 31 after blur and Enter. Reversed range gave no error. No Apply button. | Apply a valid range to URL, cards and chart together (on change, or add an Apply button; one way across all Usage scopes). Reject reversed ranges inline. Re-test with the date picker and keyboard on populated data. | No. | Shared: date-range control. |

## B. Y items: Review 2 tests (her Y1 to Y12)

Fixtures are dummy data set I in CHANGE-LIST.md. Sandbox providers only; no real credential, sync or delivery.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-INT-Y1 | Y1 | Isolated fixtures | One fixture of each concept (platform connection, catalog entry, customer firm connection) with expected outcomes; prove sandbox and recipient isolation first. |
| SA-INT-Y2 | Y2 | Wizard steps 3 and 4, provider auth | Stripe test-mode connection: success and failure, environment separation, a failed mandatory test blocks activation, redacted review, safe Cancel, no duplicate on double submit. |
| SA-INT-Y3 | Y3 | Configured service | One working sandbox connection: six management tabs, health, sync, uptime, usage, errors, log links; reconnect keeps the old connection until the new one passes; disable and remove with impact warnings. Readiness labels follow SA-SYS-A3. |
| SA-INT-Y4 | Y4 | Catalog lifecycle | Enabled, Disabled and Coming Soon entries with plan restrictions; customer preview read-only; Coming Soon visible but not connectable; allow and deny precedence by plan, firm and role. |
| SA-INT-Y5 | Y5 | API keys | One test key with label, scope and expiry; full key shown once; later only prefix and last four; rotate and revoke with restricted roles. |
| SA-INT-Y6 | Y6 | Webhooks | Sandbox endpoint delivering to a sink: signing secret, event subscriptions, payload redaction, attempt history, retry, idempotency. |
| SA-INT-Y7 | Y7 | Usage and logs | Seeded events with known metrics across scopes, plans and environments; rate limits; date bounds; combined log filters; CSV export redaction. |
| SA-INT-Y8 | Y8 | Permissions | Restricted test logins (set L); view, configure, secret, disable and catalog-access checks in UI and API. |
| SA-INT-Y9 | Y9 | Secrets and audit | Engineering evidence: encrypted storage, no plaintext in logs, errors, exports or audit; no full secret after save; audit actor, time, target, action, result. |
| SA-INT-Y10 | Y10 | Reliability | Sandbox scenarios: outage vs bad credentials, retry and backoff, partial failure, rollback; a disabled integration never re-enables by itself. |
| SA-INT-Y11 | Y11 | Data and navigation | More than one page of integrations; configured detail routes; deep links from errors and notifications with a safe fallback. |
| SA-INT-Y12 | Y12 | Usability and performance | Phone width, keyboard, large data; logo, file and URL limits checked on the server; date input with ordinary typing (after R4). |

## C. Schema needs

None.

## D. Role and permission notes

No role change. Server enforcement of integration permissions (Y8) and secret handling (Y9).
