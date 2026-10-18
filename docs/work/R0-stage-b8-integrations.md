# Super Admin stage B8: Integrations (contract note)

Migration `20261017220000_r0_platform_integrations`. This note is for the API session building the
Super Admin Integrations area (spec 14):
- the dashboard
- platform integrations: the list, the add wizard and the manage page
- the customer integration catalog and its edit page
- API & Webhooks
- Integration Logs
- Usage & Analytics

It also covers the sync and webhook workers and the daily rollup.

**Two things the spec keeps separate, and so does the schema:**
- **Platform integrations** are Firmivra's own services (Stripe, Twilio, SES, S3, AI...).
- **The catalog** is what firms may discover and connect.

A firm's own connection is the existing `integration_connections` table, in the firm's scope.
- The catalog's `provider` key matches `integration_connections.provider`.
- Provider definitions (auth type, fields, capabilities) stay in code.
- Platform health never decides catalog availability, and the other way round.

This is platform data: the Super Admin team (admin scope) and the platform's services (platform
scope) reach it; no firm scope does.

## Tables

| Table | What it holds |
| --- | --- |
| `platform_integrations` | a Firmivra service connection: provider key, category, environment (`LIVE` or `TEST`), status, `secret_ref` (a reference only), non-secret `settings`, check and sync times, version |
| `platform_integration_runs` | a sync or a connection test (`SYNC`, `TEST`): counts, retries, error, correlation id |
| `platform_integration_logs` | the central log: source, integration or provider, environment, severity, event type, outcome, error code, message, redacted `details`, request and correlation ids, the firm it concerns (`subject_business_id`), actor |
| `platform_integration_catalog` | a catalog entry per provider: firm-facing name, category, descriptions, logo, links, status, plan access, `setup`, `badges`, order, `advanced`, the platform integration it relies on |
| `platform_integration_catalog_plans` | the plans a `SELECTED_PLANS` entry is on |
| `platform_integration_catalog_firms` | a firm's `ALLOW` or `DENY` for an entry. Deleted with the firm |
| `platform_api_keys` | Firmivra-issued keys: name, prefix, last four, **SHA-256 hash only**, scopes, environment, rate limit, expiry, last use, rotation, revocation |
| `platform_webhook_endpoints` | outbound or inbound endpoints: https URL, events, `signing_secret_ref` (a reference), status, max retries |
| `platform_webhook_deliveries` | one attempt of one event to one endpoint: status code, duration, request id, error; a redelivery names the original |
| `platform_integration_usage_daily` | the daily rollup per subject (see below) |

**Categories:** `PAYMENTS_BILLING`, `COMMUNICATION`, `EMAIL`, `CLOUD_STORAGE`, `AI_AUTOMATION`,
`MLS_DATA`, `ESIGN`, `SECURITY_INFRASTRUCTURE`, `OTHER`.

**The usage rollup** is keyed by `(day, scope, subject_key)`:
- `PLATFORM_INTEGRATION`: an integration's id
- `CATALOG`: the provider key
- `API`: an API key's id

It holds requests, successes, failures, average latency, volume, cost (cents, when the provider
reports it), and for the catalog: connected firms, active firms, connects and disconnects.

## What the database guarantees

**Platform integrations**
- **Activation:** a new one is a `DRAFT`. It becomes `ACTIVE` only after a passing connection test
  (`last_check_ok`), or with `activated_without_test` set when the provider has no test endpoint
  and the admin confirmed it (spec 14, section 4). Activation is stamped.
- **Health** moves it among `ACTIVE`, `INACTIVE`, `NEEDS_ATTENTION` (with a `status_reason` code)
  and `ERROR`, from the team or the health checks (platform scope). It never goes back to draft.
- **Only a SUPER_ADMIN** disables, re-enables or removes an integration, and only a SUPER_ADMIN
  sets or changes `secret_ref` (stamped as a rotation). Disabling and removing are stamped.
- **Removal:** `REMOVED` is a final tombstone, never deleted. Revoke the secret in the secret store
  when removing.
- **One live connection** (not removed) per provider and environment.
- **Versioned saves:** every save of the configuration adds 1 to `version`. Save with the version
  read; a count of 0 means a conflict.
- **Never in a row:** secrets, tokens, or record content in `settings`, errors or the log.

**Runs.** The team or the scheduler queues a run. Only the worker (platform scope) moves it,
`QUEUED` → `RUNNING` → `SUCCEEDED`, `PARTIAL` or `FAILED` (with an error code), stamping the times.
What was asked never changes, and a finished run never changes.

**The log**
- It is insert-only.
- The database stamps the time for the app role and the actor in admin scope.
- `PLATFORM_INTEGRATION` events name their integration; `FIRM_CONNECTION` events name the provider
  and the firm.
- `subject_business_id` has no foreign key, so the log outlives the firm.
- Retention is B7's (`communications` or a category you add).

**The catalog**
- The provider key never changes, and every save is a new version, stamped.
- New entries start `DISABLED`.
- A logo goes under `platform/integrations/<entry id>/` (PNG, WebP or JPEG).

**Who sees and can connect an entry** (the API resolves it in this order):
1. `DISABLED` hides it from everyone.
2. A firm's `DENY` hides it.
3. A firm's `ALLOW` shows it, whatever the plan.
4. `ALL_PLANS` shows it; `SELECTED_PLANS` shows it to firms on a listed plan.
5. `COMING_SOON` is visible but not connectable.

Warn before a save removes access from firms that are already connected (count them from the
rollup, or the firm's own scope).

**API keys**
- Only a SUPER_ADMIN issues one.
- Store only the SHA-256 hash; show the full key **once**, at creation.
- The prefix names the environment: `fv_test_…` or `fv_live_…`.
- A key never changes; rotate by issuing a new key with `rotated_from_id` (it must name a live key)
  and revoking the old one.
- Revoked once, stamped, by a SUPER_ADMIN or the platform (expiry).
- Only the platform records `last_used_at`.

**Webhooks**
- URLs are https.
- Only a SUPER_ADMIN sets `signing_secret_ref` (a rotation, stamped). Show the signing secret once,
  at creation.
- **Deliveries:** the platform records each attempt `PENDING` and writes its result once
  (`SUCCEEDED` or `FAILED`, with a status code or error). A redelivery (the team's, after
  confirmation) is a later attempt of the same event to the same endpoint. Keep the receiver's side
  idempotent on `event_id`.

**The usage rollup** is written only by the platform's daily job (upsert).
- Cross-firm adoption comes from here, never from reading firms' connections in admin scope.
- The job reads each firm's `integration_connections` in that firm's scope.

## Endpoints the screens need

All under `/api/v1/admin/integrations`.
- **Dashboard:** `GET /summary` (total, active, needs attention, errors).
- **Platform integrations:**
  - `GET /platform` (search, category, status, environment), `POST /platform` (a draft)
  - `GET`/`PATCH /platform/:id` (with `version`)
  - `POST .../test`, `.../activate`, `.../disable`, `.../enable`, `.../remove`
  - `PUT .../credentials` (SUPER_ADMIN only)
  - `GET .../runs`, `GET .../usage`
- **Catalog:** `GET /catalog` (status, plan), `POST /catalog`, `GET`/`PATCH /catalog/:id`,
  `PUT`/`DELETE .../plans/:planId`, `PUT`/`DELETE .../firms/:businessId`, `GET .../preview`.
- **API keys:** `GET /api-keys`, `POST /api-keys` (returns the key once), `.../rotate`,
  `.../revoke`.
- **Webhooks:** `GET`/`POST`/`PATCH /webhooks`, `GET /webhooks/:id/deliveries`,
  `POST /deliveries/:id/redeliver`.
- **Logs:** `GET /logs` (integration, severity, event type, environment, date, outcome, request or
  correlation id), `GET /logs/:id`, `POST /logs/export` (B1 export jobs).
- **Usage:** `GET /usage?scope=&subject=&from=&to=`.
- **Audit:** every sensitive change (credentials, keys, signing secrets, enable/disable/remove,
  plan and firm access, redelivery) writes `audit_logs` (category `INTEGRATION`, or `SECURITY` for
  credentials and keys), never with a secret.

## Needs from R1

- Secrets Manager: the API role reads the referenced ARNs; a SUPER_ADMIN-only path writes and
  rotates them.
- An IAM grant for `platform/integrations/*` (catalog logos).
- The workers: sync and test runs, webhook delivery, the health checks and the daily rollup.

## Not in this stage

- Firms' own connections (`integration_connections`, already there).
- Demo rows (Stage 5).
