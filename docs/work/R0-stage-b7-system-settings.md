# Super Admin stage B7: System Settings (contract note)

Migration `20261017210000_r0_platform_system_settings`. This note is for the API session that
builds the Super Admin System Settings area (spec 19): the landing page, General, Branding &
Appearance, Email & Notifications, Feature Management, Data & Retention, System Configuration &
Maintenance, and Default User & Firm Settings. It also covers the platform services that read
these settings.

Security settings stay in Audit & Security. That is B4's `platform_security_policy`, including
audit retention, and System Settings links to it rather than duplicating it.

This is platform data. The Super Admin team (admin scope) and the platform's own services
(platform scope) read it; no firm scope reaches it.

## Tables

| Table | What it holds |
| --- | --- |
| `platform_settings` | one row per section: `general`, `branding`, `email_notifications`. A JSON object each, versioned |
| `platform_secret_refs` | where a secret lives (an AWS Secrets Manager ARN, or `local:<name>` in development), never the secret |
| `platform_brand_assets` | every uploaded version of a brand asset (`LOGO`, `LOGO_DARK`, `FAVICON`, `APP_ICON`, `LOGIN_BACKGROUND`) |
| `platform_brand_current` | the asset in use per kind. Delete the row to reset that kind to the built-in default |
| `platform_features` | feature flags with stable keys: default state, emergency off, dependencies |
| `platform_feature_overrides` | a firm's explicit ON or OFF. Deleted with the firm |
| `platform_retention_policies` | retention by data category, with a floor; the migration ships the categories |
| `platform_legal_holds` | a hold on a category, a firm, or one record |
| `platform_retention_runs` | a retention job's run or dry run. Counts only, never the records |
| `platform_maintenance_windows` | planned maintenance and its notice |
| `platform_job_controls` | the background jobs the platform registers; the team can pause or resume them |
| `platform_default_sets` | numbered versions of the defaults for new firms (`FIRM`) and new users (`USER`) |
| `platform_default_set_applications` | which firm defaults each firm was provisioned with. Deleted with the firm |

## What ships

**Sections.**
- `general`: `platformName` "Firmivra", `defaultTimeZone` "America/New_York", `defaultLocale`
  "en-US", `defaultCurrency` "USD", `dateFormat`, and `supportEmail`/`supportPhone` (unset).
- `branding`: `primaryAccent` and `secondaryAccent` (unset, so they use the `packages/ui` tokens),
  `appearance` "SYSTEM", `allowUserAppearance`.
- `email_notifications`: `fromName` "Firmivra", `fromEmail`/`replyTo` (unset until configured),
  `channels` {email, sms, inApp, push}, `maxRetries` 3, `retryBackoffMinutes` 5,
  `dailyCapPerRecipient` 50.

The database checks only each section's floors:
- a platform name
- a valid IANA time zone, locale and ISO currency
- `#RRGGBB` colours or unset
- `LIGHT`, `DARK` or `SYSTEM` appearance
- valid sender addresses once set
- `maxRetries` 0 to 10, and a backoff of 1 to 1,440 minutes

The API's zod schema owns the rest of each section's shape.

**Retention categories** (in days; the floor is the migration's and fixed):

| Category | Keep | Disposition | Archive after | Floor |
| --- | --- | --- | --- | --- |
| `communications` | 1,095 | delete | 365 | 365 |
| `support_tickets` | 2,555 | delete | 730 | 1,095 |
| `platform_notifications` | 365 | delete | – | 90 |
| `export_files` | 7 | delete | – | 1 |
| `declined_firm_applications` | 730 | delete | – | 365 |
| `lost_sales_records` | 1,095 | anonymize | – | 180 |
| `platform_billing` | 2,555 | archive | 730 | 2,555 (tax records, 7 years) |

These defaults and floors are my proposal. Rasel can change the values on the page, or the floors
by migration.

**Default sets:** version 1 for `FIRM` and for `USER`:
- `regional`: time zone and locale unset, so they inherit General
- `notifications`: email on, SMS off, in-app on
- `features`: none

No features, job controls, brand assets or secret references ship.

## What the database guarantees

**Sections, retention policies and the policy row.** Every save adds 1 to `version`; the database
does it and stamps who and when. Save with `updateMany({ where: { key, version }, data })`; a count
of 0 means someone saved first, so reload and show the conflict.
- Sections are never added or removed by the app.
- A retention category and its floor never change.
- A retention change applies from `effective_from`, which is never in the past.
- Retention never goes below the floor.

**Secrets**
- Only a reference is stored, checked against the ARN or `local:` pattern, plus a `hint` of up to
  8 safe characters (e.g. `****` or a key id's last 4). Show "configured" and the hint, never a
  value.
- A new reference is a rotation (`rotated_at`, stamped).
- **Only a SUPER_ADMIN writes secret references and retention policies** (spec 19: elevated
  permission). Other team members read them.

**Brand assets**
- Raster only: no SVG, which can carry script.
  - logo: PNG or WebP
  - favicon: PNG or ICO
  - app icon: PNG
  - login background: JPEG, PNG or WebP
- At most 5 MB, under `platform/branding/<asset id>/` in S3.
- An upload never changes; the scanner (platform scope) records its result once.
- The asset in use must be a clean asset of its kind.
- Every version is kept, so cached clients stay correct; serve assets with their id in the URL.

**Features**
- Keys are stable (`[a-z][a-z0-9_.]*`).
- `depends_on` must name existing features, never itself.
- A feature that others depend on can't be deleted.

The effective state for a firm, which the API resolves server-side:
1. `emergency_disabled` means off.
2. Any required feature that is effectively off means off.
3. The firm's override, if any.
4. Otherwise `default_state`.

Plan entitlements are separate (stage A's plan features). Gate a feature on both.

**Legal holds**
- A hold covers exactly one thing: a category, a firm (`held_business_id`), or a record
  (`record_type` and `record_id`).
- It is released once, with a reason; the database stamps the release and the creation.
- **A firm under an active hold cannot be deleted**: `app_delete_business_data` fails with "the
  firm is under a legal hold (name); release it first".
- A released hold stays on record after its firm is deleted, with the firm link cleared.
- Retention jobs must skip anything under an active hold and count it in `held_count`.

**Retention runs**
- A run is queued by a team member or the scheduler. It records the policy version it ran against
  (the database sets it).
- Lifecycle: `QUEUED` → `RUNNING` → `COMPLETED` or `FAILED`, moved only by the worker (platform
  scope). A queued run can be cancelled.
- What was asked never changes.
- A dry run affects nothing (`affected_count` stays 0).
- Each real run also writes an `audit_logs` summary.

**Maintenance windows**
- Lifecycle: `SCHEDULED` (editable) → `ACTIVE` → `COMPLETED`, or `SCHEDULED` → `CANCELLED`.
- While active, only the notice and the end time change.
- The end is after the start; the database stamps the actual start and end.
- `admin_bypass` lets Super Admins sign in during the window.

**Job controls**
- Only the platform registers a job and records its runs (`last_run_at`, `last_status`,
  `last_error`).
- A team member only pauses (with a reason) or resumes a job.
- Nothing here runs commands; the API exposes only allowlisted actions (spec 19).

**Default sets**
- Each save is the next version for its kind (the database numbers it), and versions never change.
- The newest version is the one in use.
- Provisioning a firm writes `platform_default_set_applications` once, with a `FIRM` set.
- Changing defaults never touches existing firms or users.

## Resolution order (spec 19)

1. A security or compliance hard rule, or a platform-wide restriction (an emergency off, a channel
   disabled in `email_notifications.channels`).
2. The global setting.
3. The firm's explicit override.
4. The user's explicit preference.
5. The firm or user default (the default set applied).
6. The application's hard fallback.

## Endpoints the screens need

All under `/api/v1/admin/system-settings`.
- **Landing:** `GET /` returns the categories with last modified (who and when) and the
  maintenance state.
- **Sections:** `GET` and `PUT /sections/:key`, where `PUT` carries the `version` it read.
  `POST /email/test` sends a test (audited, not a save).
- **Secrets:** `GET /secrets` (configured or not, plus the hint), `PUT` and `DELETE /secrets/:key`
  (SUPER_ADMIN only).
- **Branding:**
  - `POST /branding/assets` (upload ticket), `GET /branding/assets?kind=`
  - `PUT /branding/current/:kind`, and `DELETE` to reset
- **Features:**
  - `GET /features` (with effective state for a firm), `POST`/`PATCH /features`,
    `POST .../emergency-disable`
  - `PUT`/`DELETE /features/:key/firms/:businessId`
- **Retention:**
  - `GET` and `PATCH /retention/:category` (SUPER_ADMIN only)
  - `POST /retention/:category/runs` (`dryRun` defaults to true), `GET /retention/runs`
  - holds: `GET`/`POST /holds`, `POST /holds/:id/release`
- **Maintenance:** `GET`/`POST`/`PATCH /maintenance`, `POST .../start`, `.../complete`,
  `.../cancel`; jobs: `GET /jobs`, `POST /jobs/:key/pause` and `/resume`.
- **Defaults:** `GET /defaults/:kind`, `POST /defaults/:kind` (a new version),
  `GET /defaults/:kind/versions`.

**Audit.** Every save and action writes `audit_logs` (category `SYSTEM`, or `SECURITY` for
secrets and emergency disables). Include the setting key, scope, old and new value summaries,
reason and result, and **never** a secret value.

## Needs from R1

- An IAM grant for the `platform/branding/*` S3 prefix (API write; public or CDN read for the
  current assets).
- Secrets Manager access for the API role, read-only on the referenced ARNs.

## Not in this stage

- The retention and maintenance workers themselves (API or R1).
- Demo rows (Stage 5).
