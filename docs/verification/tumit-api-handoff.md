# Tumit API handoff

T02 settings (9 HTTP operations), T03 team (4), T04 tax statuses (5), T05 applications (3), T06 notifications (10), T07 appointments (26) and T08 audit/resources (6) are on separate tumit/FIR-T02 through FIR-T08 ticket branches. T01 contains the missing-field request and OpenAPI; T09 contains verification and read-only smoke tools. All branches start from main a0bee59.

Rasel handoffs: R0/R4 migrations with tenant RLS, same-firm FKs and booking exclusion; R2/R3 settings assets/invite resend; R6 notification policy/enqueue and appointment delivery/scheduler; approved support access and resource icon storage. Document/invoice/engagement owners provide notification target permissions. Default adapters deny unresolved operations; test draft tables are not migrations. See each module's implementation note and [verification evidence](tumit-api-verification-2026-10-06.md).

Feature branches need PRs below 400 changed lines as dependencies merge onto main. Ibrahim pre-review, frontend DTO agreement and Rasel merge remain pending; only Rasel merges. No issue submission, reviewer approval or Team Board Done is claimed without the actual action.

After the routes are deployed, run node scripts/api-smoke.mjs for anonymous protection/DB health, or node scripts/api-authenticated-smoke.mjs for signed-in checks. Configure:

- API_BASE_URL: deployment base ending /api/v1; HTTPS except localhost.
- FIRM_SLUG: configured firm slug, default lvp.
- SMOKE_FIRM_ID, SMOKE_OTHER_FIRM_ID: distinct firm UUIDs; the owner belongs only to the first.
- SMOKE_OWNER_TOKEN, SMOKE_CLIENT_TOKEN: approved synthetic Owner and BUSINESS-client identities for the first firm, supplied securely in environment variables.

The signed-in tool verifies identities, firm/portal reads and role/tenant denials using GET only. It rejects unsafe configuration, follows no redirects and outputs only path/status. Missing routes or a 503 dependency fail readiness. Never commit tokens, create production users through dev endpoints or count a synthetic local run as production verification.
