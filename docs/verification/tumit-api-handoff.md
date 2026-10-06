# Tumit API handoff

All assigned API code is on separate ticket branches based on main a0bee59. Authentication,
approval actions, DB migrations, infra, storage, senders and payments remain Rasel-owned.
The frontend is unchanged. Frontend DTO agreement, Ibrahim pre-review and Rasel merge are pending.

| Ticket | Branch                             | Implemented HTTP operations                                               |
| ------ | ---------------------------------- | ------------------------------------------------------------------------- |
| T02    | tumit/FIR-T02-business-settings    | 9: profile, settings, setup, firm legal versions and portal projection    |
| T03    | tumit/FIR-T03-team-api             | 4: list, role, deactivate, invite resend delegation                       |
| T04    | tumit/FIR-T04-tax-statuses         | 5: list, create, rename, order, archive                                   |
| T05    | tumit/FIR-T05-application-data     | 3: platform list, safe detail, history                                    |
| T06    | tumit/FIR-T06-notification-center  | 10: current-user center/preferences, plus internal creation               |
| T07    | tumit/FIR-T07-appointments         | 26: types, hours, blocks, providers, slots, canonical booking/history     |
| T08    | tumit/FIR-T08-audit-external-links | 6: firm/support audit viewer, resource configuration and portal directory |
| T09    | tumit/FIR-T09-verification         | Verification and read-only deployment smoke tooling                       |

Each feature branch includes shared Zod contracts, a standalone OpenAPI section, unit/endpoint
tests, firm isolation cases and an implementation note describing actual dependencies. Isolated
draft table fixtures are not migrations and reject execution outside the API test database.

Owner-managed handoffs:

- R0/R4: portal content fields, application status history, notifications/preferences, appointment
  tables with forced RLS/same-firm FKs/exclusion invariant, durable reminder leases and external links.
  The latest field request is on tumit/FIR-T01-field-lists-openapi.
- R2/R3: SettingsAssets and InviteResender adapters; no auth/token/email implementation is duplicated.
- R6: NotificationDelivery.policy/enqueue, AppointmentNotifier.enqueue, consent, mandatory categories,
  durable idempotent delivery, and scheduler registration of AppointmentJobs.runDue(trustedBusinessId).
- Support/storage: ApprovedSupportAccess.withFirm supplies a currently approved scoped transaction;
  ExternalLinkIcons checks own assets and resolves safe signed URLs. Default unresolved access is denied.
- Module owners: ScopedNotificationTargets implements actual appointment/resource permissions;
  document/invoice/engagement owners still supply their adapters. Unresolved targets are hidden.
  initializeDirectory can be wired to verified firm setup/activation.

Combined verification on Oct 6 passed: 133 API tests, 35 shared-types tests, 73 DB tests,
30 infra tests and 2 smoke-tool tests. Workspace build, typecheck and lint passed; all 63
OpenAPI operations validate and are registered in the synthetic local preview. See
[verification evidence](tumit-api-verification-2026-10-06.md) for source revisions and limits.

These branches exceed the 400-line PR limit if submitted as complete modules. Do not open oversized
combined PRs or merge/push main. Review/split shared DTOs, logic, controllers and tests as small PRs
from fresh main as dependencies merge; split the long scheduling service and OpenAPI paths for review.
Only Rasel merges. No frontend agreement, issue submission, PR/pre-review or Team Board Done status
is claimed without the actual action/review.

Deployment smoke (after feature routes are merged/deployed):

```powershell
$env:API_BASE_URL = '<deployment API base ending /api/v1>'
$env:FIRM_SLUG = '<configured firm slug>'
node scripts/api-smoke.mjs
```

This checks DB health plus anonymous denial on registered feature GET routes. It sends no credentials
or mutation requests and prints no response bodies. Missing routes fail instead of passing as denial.
Authenticated production workflows need Rasel's approved deployment and test identities; local tests
and a prepared smoke script are not a production deployment or a production smoke pass.
