# Settings confirm checks: R60's answers (Oct 23)

Octavia's checklist: `docs/specs/review-2026-10-21/settings--confirm-checks-supplement.md` (Oct 19).
Owners from `CHANGE-LIST.md` section E: R60 answers checks 1, 3, 4, 5, 6, 7, 10 and 11 (1, 3 and 4
with R56; 6 and 7 with R1). Checks 2 and 9 are R55's. Check 8 has no owner named and is not
answered here.

Checked on `main` at `1ba08116` (Oct 23), on the local stack (LVP's Owner) and by reading the code.
"Built" means the function works end to end; a page that saves a value nobody uses is
"Partially built". Nothing was changed to answer these checks.

| # | Check | Status | Page |
| --- | --- | --- | --- |
| 1 | Settings Overview | Partially built | /settings/overview |
| 3 | Ownership transfer | Not built (last-Owner protection built) | none |
| 4 | Branding and login customization | Partially built | /settings/profile |
| 5 | Branding across surfaces | Partially built | emails, portal; documents not |
| 6 | Security and access | Partially built | /settings/security, /settings/users |
| 7 | Data and backups | Not built (the page states the facts) | /settings/data |
| 10 | Tab-to-page mapping | Mapped (table below) | 17 Settings pages |
| 11 | Shared time zone, currency, language | Partially built | /settings/preferences |

The most urgent finding is in check 6: **Sign Out All Sessions ends no real session.**

## 1. Settings Overview: Partially built

- **Page:** /settings/overview. One call feeds it (`GET /api/v1/business/settings/overview`).
- **Works:**
  - Staff Users: count, and how many joined this month.
  - Security Alerts: lockouts, failed sign-in bursts and MFA resets in the last 7 days.
  - Recent activity: the newest 5 audit entries. View All opens /audit-log.
  - Quick Settings: Branding, Users & Roles, Billing, Security and Data open their pages.
  - Each firm sees only its own numbers.
- **Not working:**
  - Active Companies and Pending Applications always show "—" for a firm. They belong to Platform Administration, which this checklist excludes.
  - Company Applications is a fixed sentence, and its View All is plain text, not a link.
  - Connected applications: no widget.
  - Quick Settings: Company Management goes to an anchor on the same page. Customize Branding opens /settings/branding, but the logo, favicon and login controls are on /settings/profile.
  - The activity rows are not links.
  - If the call fails, the numbers show "—" and the activity says it did not load, but there is **no Retry**. The Security Alerts card still says "Review required".
- **Tests:**
  - API e2e `settings-overview.e2e.test.ts`: the counts, the week's alerts, firm B's own numbers, Staff refused.
  - Mock `tumit-settings-overview.spec.ts`.
  - No test covers the empty or failure states.
- **Result:** Pass (Oct 23): the API e2e and the mock spec. The empty and failure states were looked at on the page only; no test covers them.
- **Remaining:** Retry on failure; real targets for Company Management, Company Applications and the activity rows; a decision on connected applications.

## 3. Ownership transfer: Not built

- **Page:** none. There is no Change Owner action for the firm or in Super Admin, which only resends the owner's invitation.
- **Built:** the firm can never lose its last active Owner.
  - The database refuses to demote, deactivate or remove the last active Owner.
  - The API answers "the firm must keep an Owner" (409 `LAST_ACTIVE_OWNER`).
  - Nobody can change their own access, and only an Owner manages Admins.
- **Not built:**
  - A transfer: who starts it, who accepts it, cancelling, and the audit entry.
  - There is no protection for the last Admin; only the Owner is protected.
- **Tests:**
  - Database tests `settings-team.test.ts` and `membership-roles.test.ts` (last owner).
  - API e2e `users.e2e.test.ts` "never leaves the firm without its Owner, nor lets anyone remove themselves".
  - `team.e2e.test.ts`: two demotions at once, and the firm keeps an Owner.
- **Result:** Pass (Oct 23): `users.e2e.test.ts`. The database and team tests were not rerun here (CI runs them on every PR). No transfer exists to test.
- **For Rasel and Octavia to decide:**
  - Where the transfer lives: the firm's Settings, or Super Admin.
  - Who accepts it.
  - Whether the old Owner becomes an Admin.
  - Whether the last Admin needs the same protection.

## 4. Branding and login customization: Partially built

- **Page:** /settings/profile, not /settings/branding (see check 10).
- **Works:**
  - Logo and favicon: upload, replace and remove.
  - Login background image and login message (200 characters).
  - Live Preview with Dashboard, Portal, Login and Emails tabs.
  - Save, Preview Full Platform, and Reset with a confirm.
  - The API checks each file's type, its size and its actual bytes. If a replacement fails, the previous image stays.
  - Low-contrast colours are refused.
  - A save made over a newer one is refused instead of overwriting it.
  - Each save is versioned and audited, and stays within the firm.
- **Not working:**
  - **The favicon, login background and login message are saved but never shown.** No sign-in page, page head or portal reads them.
  - The login background's drop zone shows the logo's size limit instead of its own 5 MB.
- **Tests:**
  - API e2e `branding.e2e.test.ts`: the favicon upload, serve, replace and remove; a wrong type and false bytes refused; reset of chosen groups; stale save refused; Owner and Admin only.
  - Database `branding.test.ts`: firm isolation.
  - Mock `tumit-settings.spec.ts` (preview and reset) and `r28-logo.spec.ts`.
  - No test covers the favicon or the login screens on the web.
- **Result:** Pass (Oct 23): `branding.e2e.test.ts`, `tumit-settings.spec.ts`, and `r28-logo.spec.ts`'s upload, replace and remove tests. The favicon and login screens cannot pass: nothing shows them.
- **Remaining:** show the favicon in the page head and the login background and message on the sign-in pages; fix the drop zone's limit.

## 5. Branding across surfaces: Partially built

- **Emails:** the firm's name, colours, light logo and time zone are applied.
  - The Communications fields (From Name, Reply-To, header, footer, disclaimer) are saved but **not used** by the email sender.
  - Emails already sent show the firm's *current* logo, because the logo link always serves the newest one, or none once it is removed. So old emails do not stay as they were.
- **Client portal:** the firm's colours, logo, portal name and welcome text are applied. The portal-only logo and colour overrides have no screen and are not used.
- **Documents:** letterhead, signature block and legal text exist in the API only. They have no screen and no PDF uses them.
  - Firm Sign certificates name the firm in one row.
  - Intake PDFs say "Firmivra" as the producer.
- **Tests:** none check what an email, portal page or PDF actually shows.
- **Result:** No test covers this; checked by reading the code (Oct 23).
- **Remaining:**
  - Use the Communications fields in emails.
  - Decide whether a sent email keeps its logo (store a copy per brand version).
  - Build letterhead and signature screens and use them in PDFs.
  - Use or remove the portal overrides.

## 6. Security and access: Partially built

- **Pages:** /settings/security (firm rules) and Users & Roles (per member).
- **Enforced:**
  - **Failed sign-in protection:** 5 failures on one account in 15 minutes lock it for 15 minutes, on any network. A successful password reset lifts the lock (merged Oct 21).
  - **Deactivate or Lock:** firm access ends on the member's next request.
  - **Reset MFA:** signs the member out of every device.
- **Not enforced:**
  - **Sign Out All Sessions ends no real session.** It marks rows in a session table that sign-in never writes, and it does not sign the member out. Its test checks the rows only. (Users & Roles is R55's page; the fix is a sign-out through Cognito, as Reset MFA does.)
  - Trusted devices: no list and no revoke. The per-member settings (trusted devices, auto logout, maximum sessions, allowed IPs and countries, alert switches) are saved but nothing reads them.
  - Session timeout: the 8-hour limit and 15-minute idle timeout are not in force; a session can refresh for 7 days. The page says so.
  - 15-character passwords: not in force (Cognito still asks 12 with a mix). The page says so.
  - Security alerts: none are sent. The failed sign-in list shows "Unknown account" for staff, because those failures go to the platform's log.
- **Tests:**
  - API e2e `sign-in-limits.e2e.test.ts` (account lockout).
  - `staff-security.e2e.test.ts` "resets MFA and signs the sessions out".
  - Mock `tumit-settings-security.spec.ts` (4).
- **Result:** Pass (Oct 23): `sign-in-limits.e2e.test.ts`, `staff-security.e2e.test.ts` and `tumit-settings-security.spec.ts`. The Sign Out All Sessions test passes, but it proves only that rows are marked, not that anyone is signed out.
- **Remaining:** a real Sign Out All Sessions; session limits (R1 and R2, written in `R60-settings.md` item 1); trusted devices; alerts; the staff failure list.

## 7. Data and backups: Not built

- **Page:** /settings/data. It states facts and has no buttons:
  - Last backup and last restore test: "Not recorded yet".
  - Export: not available yet.
  - Restore: through support.
- **Exists:**
  - The database keeps 35 days of backups, and document old versions are kept 35 days (R1's infra).
  - There is no backup, restore or full-export API, and no AWS Backup plan.
  - No restore has been tested.
- **Tests:** mock `tumit-settings-data.spec.ts` (the page's statements).
- **Result:** Pass (Oct 23): `tumit-settings-data.spec.ts`, which checks the page's statements. Nothing exists yet to back up, restore or export, so nothing of that was tested.
- **Remaining:** R1's backup plan and monthly restore test with a recorder; the R0 tables for exports, restores and deletion; then the API and the page's real dates. All are listed in `R60-settings.md`, "Data & Backups". A restore test must run in an isolated environment, never on live firm data.

## 10. Tab-to-page mapping

The Settings menu has 17 pages: Overview, Company Profile, Branding, Client portal, Terms & Privacy, Availability, Users & roles, Billing, Payments, Communications, Notifications, Forms & documents, Workflow & automations, Security & access, Data & backups, Preferences and Tax statuses.
- /settings opens Company Profile.
- Staff see only Availability and Tax statuses.
- The six-tab bar shows only on Company Profile; the other five pages have the menu only.

| Original tab | Current page | Controls | Without a home, or saved but unused |
| --- | --- | --- | --- |
| Company Profile | /settings/profile | Company Name, EIN, Website, Business Type, Entity Type, Tagline, Short Description, legal name (read-only); Address, City, State, ZIP, Phone, Support Email; Save Changes | Primary or admin email (in the contract, no field). Time zone is on Preferences |
| Branding and White Label | /settings/profile (most) and /settings/branding | Profile: Company Logo, Favicon; Primary, Secondary, Accent, Background, Sidebar, text and Button colours; Light, Dark or System; sidebar style and position; logo text; rounded corners; Login Background, Login Message; Live Preview; Save, Preview Full Platform, Reset. Branding: portal name, primary and accent colours, dark and light logos, sidebar slogan and motto, preview, Save | Primary and accent colours and the light logo can be changed on both pages (one stored value). Theme mode, sidebar style and position, logo text, rounded corners, secondary and background colours, favicon and login are saved but not applied |
| Email and Communications | /settings/communications | From Name, Reply-To Email, Header, Footer, Disclaimer, Preview, Save Changes | No email-logo field; emails do not use these fields yet (check 5) |
| Client Portal Branding | /settings/portal | Portal heading, Welcome message, client sign-up, preview, Save | The portal name is on /settings/branding; the portal's own logo and colours have no screen |
| Documents and Legal | /settings/legal and /settings/forms-documents | Legal: Terms of Service, Privacy Policy and intake agreements with versions, publish, PDF. Forms & documents: allowed files, storage and security, categories, retention, forms and templates | Letterhead, header and footer, signature block and legal text: API only, no screen |
| Preferences | /settings/preferences | Time Zone, Language & Region, Currency, Date Format, Number Format, Live Example, Save Changes | Only the time zone is applied; 2 of the 3 number formats are refused on save |

Every original tab has a page. The functions without a home are the admin email field, the email logo, the portal's own logo and colours, and letterhead and signature. They are saved-but-unused or API-only, as listed.

## 11. Shared time zone, currency, language: Partially built

- **Page:** /settings/preferences, the only place they are edited. Company Profile has none of them.
- **Stored once:** time zone, language, currency and date format sit on the firm's one settings row. The intended overrides are separate: a staff member's own time zone, an office's, and an appointment's (empty means the firm's).
- **Applied:** the time zone. The calendar, clients, dashboard, leads, engagements, Firm Sign and emails read it.
- **Not applied:**
  - Language: saved only. Clients and staff see English, and there is no translation library yet. The columns for staff and client choices are a written item with Rasel.
  - Currency and date format: saved only. The screens format as en-US and USD everywhere.
  - Number format: the page offers three, and the API refuses two of them (only 1,234.56).
  - Old amounts are never converted (nothing converts).
- **Tests:**
  - Mock `tumit-settings-preferences.spec.ts`: the live example and save; English stays and old amounts do not convert.
  - API e2e `branding.e2e.test.ts`: other number formats refused.
- **Result:** Pass (Oct 23): `tumit-settings-preferences.spec.ts`, and the number-format refusal in `branding.e2e.test.ts`.
- **Remaining:**
  - Apply the date format and the firm's currency in the screens.
  - Offer only the number format that saves, until the others are built.
  - Language after R0's columns and Rasel's choice of phase (`R60-settings.md` item 2).

## Evidence

Test runs on Oct 23 (local, `main` at `1ba08116`):

- API e2e, 46 of 46 passed: `settings-overview`, `branding`, `sign-in-limits`, `staff-security`
  and `users` (`apps/api/test/e2e/`).
- Mock specs, 21 of 25 passed: `tumit-settings-overview`, `tumit-settings`,
  `tumit-settings-security`, `tumit-settings-data`, `tumit-settings-preferences` and `r28-logo`
  (`apps/web/e2e/mock/`). The 4 that failed are `r28-logo.spec.ts` "the sidebar logo fills the
  width" (squarer and transparent-padding logos). They fail only on Windows: the test opens its
  image at a path with the drive letter doubled (`F:\F:\...\logo-square.png`). They are about
  the sidebar logo's size, not these checks.
- Not run: the database tests and `team.e2e.test.ts` (check 3); CI runs them.
