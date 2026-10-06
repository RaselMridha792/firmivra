# Tumit API verification - 2026-10-06

Baseline main: a0bee5924f138b5786b981f57dcf4e6eef1e172f. Own modules are assembled in an ignored detached local checkout, without merging main or using another developer's branch. Node 22.23.3, pnpm 10.32.1 and Docker Postgres/s3mock/Mailpit were used; frozen installation changed no tracked dependencies.

| Ticket | Tested source |
| ------ | ------------- |
| T01 | f38dc6e |
| T02 | f825402 |
| T03 | a0223b7 |
| T04 | 33f8fe5 |
| T05 | 00c825e |
| T06 | a60bae3 |
| T07 | 46dbb72 |
| T08 | 921aa79 |

Earlier combined checks passed: API 133, types 35, DB 73 and infra 30 tests; workspace build/typecheck/lint; root plus eight OpenAPI sections with 63 operations, all registered in live Swagger. Settings permission revalidation passed 77 package tests; team suspension passed 74; tax baseline passed 72 plus its new suspension regression. Both smoke tools passed 5 tests. Final combined permission-regression verification is pending rerun.

Real Postgres tests cover concurrent booking, direct overlapping writes, idempotent replay, tenant FKs/RLS, stale reminders, history, role/recipient isolation and support expiry/revocation. The preview uses a separate synthetic _tumit_preview_test_api database; normal local DB tables are unchanged. Expected R6 preferences failure is 503. Mocked adapter tests do not prove production delivery/storage/support integrations.

Turbo wrappers remained alive after completed tasks; direct pnpm package/recursive commands exited successfully. No Turbo config change was made. Rasel migrations/adapters/scheduler/merge, frontend agreement, Ibrahim/Octavia reviews and approved production smoke remain external handoffs. [Handoff and smoke setup](tumit-api-handoff.md) lists dependencies; authenticated smoke must fail if they are unresolved.
