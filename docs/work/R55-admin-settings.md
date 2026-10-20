# R55: Super Admin System Settings

Contract: `packages/types/src/admin-settings/` (`api.adminSettings`). API: `apps/api/src/admin-settings/` (next PR). Design: `docs/mockups/super-admin/system-settings/` (nine frames and the developer instructions). Tables: R0 stage B7 (`docs/work/R0-stage-b7-system-settings.md`).

## Steps

- [x] 1. Contract: the landing, General, Branding (with assets), Email & Notifications (with the test send), secrets (references only), features and firm overrides, retention policies, runs and legal holds, maintenance windows and jobs, firm and user defaults.
- [x] 2. API, with unit, e2e and admin-scope WRITES cases (`rasel/R55-admin-settings-api`, stacked on #876 for `writeAdminEvent`).

## Decisions (contract)

1. The three sections are typed (`AdminGeneralSettings`, `AdminBrandingSettings`, `AdminEmailSettings`); the page's fields the database has no column check for live in the section's JSON (the database allows extra keys inside a section). Every save names the version (409 SAVE_CONFLICT).
2. Secrets are references (a Secrets Manager ARN) with an optional hint; never stored or returned. Custom SMTP is the `smtp` reference.
3. Security settings and audit retention stay Audit & Security's (`api.adminAudit.settings`); system health stays `GET /admin/system-status`.
4. Retention runs are queued for the retention worker (a dry run by default); the API never deletes.

## Notes (API)

1. `apps/api/src/admin-settings/`: `AdminSettingsController` (`/admin/system-settings`, `@Roles('SUPER_ADMIN')`), `AdminSettingsService` (landing, sections, test email, secrets), `AdminBrandingService` (branding and images), `AdminFeaturesService`, `AdminOperationsService` (retention, runs, holds, maintenance, jobs, defaults), `settings.mappers.ts`.
2. Everything runs in admin scope: the database's triggers stamp who saved and bump versions from `app_current_admin_id()`. A brand image's scan result is set in platform scope (the only scope allowed to), at once with `SCAN_MODE=local`.
3. The test email uses the configured sender (SES or SMTP, as NotifyService builds it); with `EMAIL_MODE=log` it answers `accepted: false` and the reason (so it never fails the page in development or tests). Audited either way, never saved.
4. A firm's effective feature state: emergency off, then a required feature that is off for it, then its override, then the default. Dependency cycles and unknown keys are refused (409 FEATURE_DEPENDENCY).
5. Default sets: a save adds a version (the database numbers it); a FIRM set refuses a feature that is off for the platform or an inactive plan. The seeded version 1 (`regional`, `notifications`, `features: {}`) reads with defaults; saves also keep `regional` for the older readers.
6. Audit rows: `system_settings.*` (SYSTEM; SECURITY for secrets and emergency switches), with field names and counts, never a secret or a reference.

## Status reads (Oct 20)

- `GET /admin/system-settings/email/status`: the sender, the custom SMTP reference, the last Send Test Email (its audit row). The 24-hour delivery rate and bounces are null.
- `GET /admin/system-settings/health`: api, database and storage reached now (ONLINE or DOWN; storage gives up after 3 s); email, SMS and payments CONFIGURED or NOT_CONFIGURED from their settings, never called.

## Needs from others (API)

- **R0:** a platform-readable daily count of email deliveries and bounces (a table or a view over `notification_deliveries`, which only a firm scope reads), for Email Delivery Status.
- **R1 (infra):** S3 write, read and delete on `platform/branding/*` of the documents bucket for the API role, and GuardDuty results for that prefix routed to the API. The scan router only knows `tenant/<firm>/...` keys today, so in AWS a brand image stays PENDING (and cannot be put in use) until a platform route exists.
- **R1:** `APP_VERSION` and `APP_ENV` in the API task's environment for System Information (it falls back to the package version and NODE_ENV).

## Not in the contract (no table, or forbidden by the instructions)

- Backups (frequency, retention, location), automatic archiving and deletion-request settings, data export settings and "Export Data Now", storage usage: no table.
- Environment variables (forbidden), cache and search tools, diagnostics, job schedules, system logs: no table; the job list shows the `platform_job_controls` rows.
- Default role templates and permission templates, onboarding flows: no table.
- Email templates, transactional emails, reminders, email logs, delivery rate and bounces: no platform table (Communications' templates are R56's).
- Platform legal pages (Terms, Privacy), Help Center, product updates, feedback: no table; the General toggles are preferences only.
- Custom CSS (a security risk) and email branding: no table.
- Feature groups, plan access per feature, beta and coming-soon states, rollout cohorts: `platform_features` has none (plan access could come from `platform_plan_features` later).
