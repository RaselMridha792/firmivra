# Tumit: task document (15-day plan)

Firmivra Phase 1 · updated Oct 5, 2026 by Rasel Mridha · delivery Oct 18, 2026
Keep this file at `docs/tasks/TUMIT.md` on your branch.

## Your role

Backend developer. You build the firm-side APIs: business settings and setup, team, tax statuses, Super Admin application data, notification center, appointments, audit log viewer and external links. Rasel owns all authentication, emails/SMS sending, documents storage and payments; you call his services.

- Pair: Fahad (agree API shapes together before you build)
- Pre-reviewer: Ibrahim
- Final review and merge: Rasel

## How we work for these 15 days

- One branch per ticket from fresh `main`: `tumit/FIR-T01-short-name`. Rebase on `origin/main` every morning and before the PR.
- Small PRs into `main`, CI green, one PR merged every day if you can. Ibrahim pre-reviews first, then Rasel reviews and merges.
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
| T01 | Oct 6 | Field lists and OpenAPI |
| T02 | Oct 7 | Business settings and setup API |
| T03 | Oct 8 | Team API |
| T04 | Oct 9 | Tax statuses API |
| T05 | Oct 10 | Super Admin applications data API |
| T06 | Oct 11-12 | Notification center API |
| T07 | Oct 13-14 | Appointments API |
| T08 | Oct 15 | Audit log viewer and external links API |
| T09 | Oct 16 | e2e tests and fixes |
| - | Oct 17 | Fixes from Octavia's review |
| - | Oct 18 | Production smoke test |

## Ticket details

### T01 · Oct 6 · Field lists and OpenAPI

List every field your modules need and send it to Rasel today (he builds all tables by Oct 8). Write the OpenAPI for your endpoints and agree it with Fahad.

### T02 · Oct 7 · Business settings and setup API

Firm profile, branding, Terms and Privacy per firm (versioned), setup progress.

### T03 · Oct 8 · Team API

List members, change role, deactivate, resend invite (uses Rasel's invite service). Owner and admin only.

### T04 · Oct 9 · Tax statuses API

Firm-defined tax statuses: create, rename, order, archive.

### T05 · Oct 10 · Super Admin applications data API

Applications list with filters and paging, application detail, status history (platform scope). Rasel's R4 does the approve, request info and decline actions.

### T06 · Oct 11-12 · Notification center API

Create notification (called by other modules), list for current user, unread count, mark read, link to the record; notification preferences. Sending email/SMS uses Rasel's NotifyService.

### T07 · Oct 13-14 · Appointments API

Working hours, blocked time, available slots, book, reschedule, cancel. A database-level lock so two clients can't book the same slot. Reminder jobs through NotifyService.

### T08 · Oct 15 · Audit log viewer and external links API

Audit log list and filters for firm owners (and Super Admin per firm), external links configuration per firm.

### T09 · Oct 16 · e2e tests and fixes

Every endpoint you own has an e2e test, including firm isolation. Fix what Fahad and Nahid report.

## Dev sites

- https://app.dev.firmivra.com (firm workspace)
- https://admin.dev.firmivra.com (Super Admin)
- https://portal.dev.firmivra.com/lvp (LVP client portal)
