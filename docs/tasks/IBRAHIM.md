# Ibrahim: task document (15-day plan)

Firmivra Phase 1 · updated Oct 5, 2026 by Rasel Mridha · delivery Oct 18, 2026
Keep this file at `docs/tasks/IBRAHIM.md` on your branch.

## Your role

Backend developer. You build the client-side business APIs: clients and profiles, tax status and returns, services, Begin Online intake and leads, messages, invoice records, calculators and the Bookkeeping and Tax Planning workspaces. Rasel owns authentication, file storage security, email/SMS sending and Stripe; you call his services.

- Pair: Nahid (agree API shapes together before you build)
- Pre-reviewer: Tumit
- Final review and merge: Rasel

## How we work for these 15 days

- One branch per ticket from fresh `main`: `ibrahim/FIR-I01-short-name`. Rebase on `origin/main` every morning and before the PR.
- Small PRs into `main`, CI green, one PR merged every day if you can. Tumit pre-reviews first, then Rasel reviews and merges.
- Two merge windows a day (midday and evening). Open your PR before a window.
- If a ticket is not merged by the next morning's stand-up, tell Rasel: we split it or hand it over.
- Run everything locally with Docker (Postgres, s3mock, Mailpit). Sign in locally with the dev token (`AUTH_MODE=local`, see README). No AWS access needed.
- Never commit `.env`, secrets or real client data: the repo is public.
- Do not change `packages/db`, `infra/`, `.github/workflows/` or anything under `apps/api/src/auth`, `client-auth`, `storage`, `notify`, `payments`, `support-access`. Those are Rasel's. Need a table or a field? Message Rasel the same day.
- Every endpoint uses Rasel's guards (`@Roles`, firm scope) and logs actions on client data with `AuditService.log(action, entity, metadata)`.
- 404 when the caller has no link to the firm, 403 when the role is wrong. Never return another firm's data.
- Publish the request and response types in `packages/types` and an OpenAPI section before the frontend needs it; agree it with your frontend pair.
- Unit tests for logic and an e2e test per endpoint, including a firm-B-can't-see-firm-A test.

## Your tickets

| Ticket | Day | Title |
| --- | --- | --- |
| I01 | Oct 6 | Field lists and OpenAPI |
| I02 | Oct 7 | Clients and profile API |
| I03 | Oct 8 | Client tax status API |
| I04 | Oct 9 | Services API |
| I05 | Oct 10 | Document categories and requests API |
| I06 | Oct 11 | Intake and Begin Online API |
| I07 | Oct 12 | Leads API |
| I08 | Oct 13 | Tax returns API |
| I09 | Oct 14 | Messages API |
| I10 | Oct 15 | Invoices API |
| I11 | Oct 16 | Calculators and service workspaces API |
| - | Oct 17 | Fixes from Octavia's review |
| - | Oct 18 | Production smoke test |

## Ticket details

### I01 · Oct 6 · Field lists and OpenAPI

List every field your modules need and send it to Rasel today (he builds all tables by Oct 8). Write the OpenAPI for your endpoints and agree it with Nahid.

### I02 · Oct 7 · Clients and profile API

Client CRUD for the firm, client's own profile for the portal, search and paging.

### I03 · Oct 8 · Client tax status API

Tax status per client per year, firm updates it, history, client sees it in the portal.

### I04 · Oct 9 · Services API

Services and engagements per client: active, recurring, completed, cancelled (My Services).

### I05 · Oct 10 · Document categories and requests API

Categories, firm requests a document from a client, request status. Uses Rasel's storage service for the files.

### I06 · Oct 11 · Intake and Begin Online API

Intake form definitions for the 6 services, submissions (public, rate limited), client intake form tab.

### I07 · Oct 12 · Leads API

Leads from Begin Online, review, convert lead to client (creates client + intake + service).

### I08 · Oct 13 · Tax returns API

Tax returns per client and year, status, linked documents.

### I09 · Oct 14 · Messages API

Threads between firm and client, messages, internal firm notes; notifications through Tumit's API.

### I10 · Oct 15 · Invoices API

Invoice records, lines, totals, send, status. Rasel's R7 adds Stripe checkout and payment status on top.

### I11 · Oct 16 · Calculators and service workspaces API

Calculator formulas with validation (placeholders until Octavia sends the list), Bookkeeping and Tax Planning workspace data: tasks, notes, reports. e2e tests.

## Dev sites

- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
