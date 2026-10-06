# Tumit API verification - 2026-10-06

Baseline main: f6c56e8b5801e0ee0f4532065673e9fdaf98aa17. Own modules are assembled in an ignored detached local checkout, without merging main or using another developer's branch. Node 22.23.3, pnpm 10.32.1 and Docker Postgres/s3mock/Mailpit were used; frozen installation changed no tracked dependencies.

| Ticket | Tested source |
| ------ | ------------- |
| T01 | 2628d13 |
| T02 | 3c418ce |
| T03 | 78cb095 |
| T04 | d54fe49 |
| T05 | abc4ae4 |
| T06 | 98e8cd3 |
| T07 | 7ee031e |
| T08 | beddca7 |

Final combined API verification passed 138 tests in 22 files, plus 5 smoke-tool tests. Unchanged shared-types (35), DB (73) and infra (30) checks previously passed: 281 tests across these checks. API typecheck/lint/build, frozen install and all 63 OpenAPI operations passed; live Swagger registers 63/63. A concurrent fixture-DDL deadlock was fixed by serializing test files; concurrent booking requests inside suites remain tested.

The exact T09 checkout also passed recursive workspace lint/typecheck/tests: API 65, types 25, DB 73 and infra 30. Its types/API were rebuilt and baseline API tests rerun after branch switches left a stale generated source-map warning. These baseline counts are separate from the combined feature verification, not additional unique tests.

Real Postgres tests cover concurrent booking, direct overlapping writes, idempotent replay, tenant FKs/RLS, stale reminders, history, permission revalidation and support expiry/revocation. The preview uses a separate synthetic _tumit_preview_test_api database; normal local DB tables are unchanged. Live authenticated readiness passed 25/26 probes and correctly FAILED preferences (503, required 200) because R6 policy is absent. Firm/portal reads, providers/slots, admin applications and frontend routing passed. Mocked ports do not prove production integrations.

Turbo wrappers remained alive after completed tasks; direct pnpm package/recursive commands exited successfully. No Turbo config change was made. Rasel migrations/adapters/scheduler/merge, frontend agreement, Ibrahim/Octavia reviews and approved production smoke remain external handoffs. [Handoff and smoke setup](tumit-api-handoff.md) lists dependencies; authenticated smoke must fail if they are unresolved.

Latest main added auth-design documentation (#15) and deployment workflow changes (#24). All nine own branches were rebased; git diff verified API/types/scripts implementation unchanged from the tested revisions.
