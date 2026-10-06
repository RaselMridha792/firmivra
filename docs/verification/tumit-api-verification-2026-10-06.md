# Tumit API verification — 2026-10-06

Main baseline: a0bee5924f138b5786b981f57dcf4e6eef1e172f. The eight modules were assembled
from Tumit's own ticket branches in an ignored, detached local checkout for integration testing.
This assembly is not a merge, shared integration branch, production migration or deployment.

| Ticket | Tested source revision | Evidence                                                                             |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| T01    | f38dc6e                | Root and eight standalone OpenAPI documents; 63 unique operations                    |
| T02    | bb1328d                | Settings/setup, atomic legal versions and projected portal responses                 |
| T03    | 77c53a9                | Team roles/deactivation, concurrent last-owner protection, resend delegation         |
| T04    | 9cee4a3                | Unique names, atomic full ordering, archive/reference/history retention              |
| T05    | 00c825e                | ADMIN identity, platform-only application data/history and safe form projection      |
| T06    | a60bae3                | Recipient/firm isolation, deduplication, read/preferences and actual record targets  |
| T07    | 46dbb72                | DB exclusion, concurrent booking/retry, DST, hours/blocks and durable leased notices |
| T08    | 921aa79                | Owner/support-granted audit projection and business-only approved resources          |

Node 22.23.3 and pnpm 10.32.1 were used with Docker Postgres, s3mock and Mailpit locally.
pnpm install --frozen-lockfile completed without dependency or tracked lockfile changes.

| Check                              | Result                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Workspace build                    | Passed, including API and Next.js production build                            |
| Workspace typecheck / lint         | Passed                                                                        |
| API                                | 133 tests in 19 files passed                                                  |
| Shared contracts                   | 35 tests in 10 files passed                                                   |
| Existing DB isolation/invariants   | 73 tests in 7 files passed                                                    |
| Existing infra                     | 30 tests in 2 files passed                                                    |
| Read-only smoke tool               | 2 tests passed                                                                |
| Total automated tests              | 273 passed                                                                    |
| OpenAPI validation                 | Root + eight sections, 63 unique operations passed                            |
| Runtime contract registration      | All 63 operations present in preview Swagger routes                           |
| Live anonymous API smoke           | DB health 200, all ten protected feature probes 401                           |
| Live synthetic authenticated smoke | Firm/portal reads, provider/slot queries and platform application list passed |
| Existing frontend host routing     | Firm/admin sign-in and LVP portal returned 200                                |

Turbo reported completed tasks but its wrapper remained alive. Direct pnpm recursive/package
commands completed with successful exit codes; Turbo version/configuration were not changed.
DB/infra checks are unchanged baseline checks; API/types were rerun after final booking/link fixes.

Real Postgres tests cover double booking, direct app-role overlapping writes, same-firm FKs/RLS,
idempotent booking replay, stale versions/reminders, append-only histories, other recipients,
role denial, foreign records and support approval/revocation/expiry. Mock ports test exact
delegation only; they are not evidence that Rasel's production senders/storage/support adapters run.

The live preview uses a separate synthetic database ending _tumit_preview_test_api with isolated
draft fixtures and fake seeded identities. The normal local database was not given draft tables.
Expected unresolved-service behavior remains: preferences/internal notification creation require
R6 policy, and invite/logo/module-entitlement/support/icon/reminder delivery require their owner
adapters. They fail closed or retry safely. No email/SMS delivery, approval action or AWS deployment
is claimed. Document/invoice/engagement notification targets stay hidden pending owner permissions.

Frontend DTO agreement, Ibrahim pre-review, Rasel migrations/adapters/scheduler/merge, Octavia's
actual review feedback and an approved production deployment/smoke remain external handoffs.
No authenticated GitHub issue/PR/Team Board API was available in this session. Ticket IDs are
the task-document IDs; no issue creation, reviewer approval or Board Done status is claimed.
Split review submissions below 400 changed lines as dependencies merge; only Rasel merges main.
