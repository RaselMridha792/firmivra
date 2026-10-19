# R55: Super Admin System Settings

Contract: `packages/types/src/admin-settings/` (`api.adminSettings`). API: `apps/api/src/admin-settings/` (next PR). Design: `docs/mockups/super-admin/system-settings/` (nine frames and the developer instructions). Tables: R0 stage B7 (`docs/work/R0-stage-b7-system-settings.md`).

## Steps

- [x] 1. Contract: the landing, General, Branding (with assets), Email & Notifications (with the test send), secrets (references only), features and firm overrides, retention policies, runs and legal holds, maintenance windows and jobs, firm and user defaults.
- [ ] 2. API, with unit, e2e and admin-scope WRITES cases.

## Decisions (contract)

1. The three sections are typed (`AdminGeneralSettings`, `AdminBrandingSettings`, `AdminEmailSettings`); the page's fields the database has no column check for live in the section's JSON (the database allows extra keys inside a section). Every save names the version (409 SAVE_CONFLICT).
2. Secrets are references (a Secrets Manager ARN) with an optional hint; never stored or returned. Custom SMTP is the `smtp` reference.
3. Security settings and audit retention stay Audit & Security's (`api.adminAudit.settings`); system health stays `GET /admin/system-status`.
4. Retention runs are queued for the retention worker (a dry run by default); the API never deletes.

## Not in the contract (no table, or forbidden by the instructions)

- Backups (frequency, retention, location), automatic archiving and deletion-request settings, data export settings and "Export Data Now", storage usage: no table.
- Environment variables (forbidden), cache and search tools, diagnostics, job schedules, system logs: no table; the job list shows the `platform_job_controls` rows.
- Default role templates and permission templates, onboarding flows: no table.
- Email templates, transactional emails, reminders, email logs, delivery rate and bounces: no platform table (Communications' templates are R56's).
- Platform legal pages (Terms, Privacy), Help Center, product updates, feedback: no table; the General toggles are preferences only.
- Custom CSS (a security risk) and email branding: no table.
- Feature groups, plan access per feature, beta and coming-soon states, rollout cohorts: `platform_features` has none (plan access could come from `platform_plan_features` later).
