<!--
Text export of Firmivra-Project-Draft-v2.pdf (Oct 3, 2026), made for the repo. Charts from the PDF are described in text.
Latest version: https://claude.ai/code/artifact/1020dfb5-2a9b-44d0-96ad-4e8c2254787d
Naming: this document says tenant / tenant_id. In code the tenant is the Business model and the column is business_id.
-->

# Firmivra Project Draft v2

Oct 3, 2026 · @Rasel Mridha

## Overview

Firmivra is one secure web platform where any business signs up under its own name, runs its own team, and gives each of its clients a private portal login. All businesses share Firmivra's infrastructure and database, but each business can only ever see its own data.

This draft updates the original "LVP Accounting & Taxes — Secure Client Portal" proposal (prepared by Nizam Uddin, 09/20/2026). That draft described a single custom portal for one firm, hosted in LVP's own AWS account. The direction has since changed: Firmivra becomes a multi-business platform, and LVP Accounting & Taxes becomes its first business (the beta tenant) on the tax and accounting pack.

**Purpose.** Give every business one place to manage clients, documents, intake, messages, appointments, invoices and signatures, and give every client one secure portal for the same. Security, privacy and audit readiness stay core requirements, because the first businesses handle tax data under the FTC Safeguards Rule.

What stays from the original draft: the tech stack, the security bar, the screens and workflows for tax clients, the engagement-based data model and the acceptance tests. What changes: one platform for many businesses instead of one portal for one firm, a Super Admin layer, business sign-up and approval, configurable roles, and modules a business turns on.

## Scope

**In scope.** Platform foundations and tenant isolation; public website with business sign-up; Super Admin console; business workspace with team, roles and settings; per-business branded client portal with client sign-up; core modules (documents, messages, notifications, audit); general modules (intake forms, appointments, invoices and payments, e-signature); the tax and accounting pack for LVP; AWS production deployment.

**Out of scope.** Tax preparation software, direct IRS e-filing, each business's own public marketing website (LVP's WordPress site stays separate), native mobile apps, and industry packs other than tax and accounting.

### Definitions

|Term|Meaning|
|---|---|
|Platform|Firmivra as a whole: one codebase, one deployment, shared by all businesses|
|Super Admin|The Firmivra team member who approves, suspends and oversees businesses|
|Business (tenant)|A company that signed up on Firmivra, e.g. LVP Accounting & Taxes. Firm in the tax pack|
|Owner|The person who signed the business up; controls billing and the business account|
|Staff|Team members a business invites: Admin, Staff, Viewer or a custom role|
|Client|A customer of one business who logs in to that business's portal (individual or business owner)|
|Client member|A spouse, partner or authorized person a client invites, with a separate login|
|Engagement|One service for one period for one client, e.g. "2025 Personal Tax"|
|Module|A feature set a business turns on, e.g. Appointments or Invoices|
|Pack|A bundle of modules and wording for one industry, e.g. Tax & Accounting|
|WISP|Written Information Security Plan (IRS Pub 4557 / FTC Safeguards Rule)|
|Section 7216|Federal rule on use and disclosure of tax return information|

### User types

|User|Signs in at|Enabled at launch|
|---|---|---|
|Super Admin|admin.firmivra.com|Yes|
|Business Owner|app.firmivra.com|Yes|
|Business Admin, Staff, Viewer|app.firmivra.com|Yes (LVP may keep only Owner at first)|
|Client, individual|portal.firmivra.com/{firm}|Yes|
|Client, business|portal.firmivra.com/{firm}|Yes|
|Client member (spouse, authorized)|portal.firmivra.com/{firm}|Yes, separate login, no shared accounts|
|Preparer, Bookkeeper, Assistant, Contractor|app.firmivra.com|As custom roles once each business approves its role matrix|

## Objectives and constraints

|Goal|Description|
|---|---|
|Multi-business by design|Any business can sign up, be approved and start working without code changes. Each business's data is isolated in the database itself, not only in app code|
|Security first|FTC Safeguards Rule aligned: MFA for everyone, encryption in transit and at rest, field-level encryption for SSN, ITIN, EIN and bank numbers, server-side authorization on every request, append-only audit log|
|Business-controlled data|Each business has its own encryption key and file area. Firmivra staff cannot read a business's client data without that business owner's time-limited grant|
|Secure document vault|Uploads go straight to S3 quarantine, are malware-scanned, and are downloaded only through 5-minute signed URLs. No public file URLs|
|Guided intake|Multi-step intake forms with auto-save, conditional fields, versioned submissions and e-signature, built on one form engine every business can use|
|Full business control|Work queues, client records, document requests, status tracking, invoices, signatures, internal notes and content editing, all without touching code|
|White-label portal|Each business sets its logo, colours and portal address. The LVP pack keeps the navy, gold and cream design from the original mockups|
|Responsive and accessible|Works from 360 px to 1920 px; mobile sidebar becomes a drawer with camera upload; WCAG 2.1 AA|
|Fast and reliable|95% of API requests under 500 ms, dashboard in 3 s on 4G, 99.5% monthly uptime, daily backups with point-in-time recovery|

### Mandatory constraints

- Production data, keys, logs and backups live in Firmivra's AWS account. Developers receive individual, least-privilege, MFA-protected IAM identities that can be revoked at any time.
- Source code lives in a Firmivra-controlled GitHub organization, with infrastructure as code and documentation.
- Development and staging use synthetic data only, never real SSNs, W-2s or IDs.
- No advertising trackers, session replay or third-party analytics on signed-in pages.
- No production data may be copied to AI services, personal cloud storage or messaging apps.
- Supported browsers: latest two versions of Chrome, Safari, Edge and Firefox, plus iOS Safari and Android Chrome. Production region us-east-1 (decided 4 Oct 2026).
- Change from the original draft: data was to live in LVP's own AWS account with LVP holding root access. On a shared platform it lives in Firmivra's account. Whether LVP still needs its own account is an open question below.

## Scope of work

### A) Platform foundations

- Multi-tenant database: every business-owned row carries tenant_id; PostgreSQL row-level security on every tenant table; the API's database role cannot bypass it
- Tenant resolved from the portal address (the firm slug in portal.firmivra.com/lvp-accounting, or a custom domain) and the signed-in session, never from a URL parameter or a client-supplied ID
- Per-business KMS key for sensitive fields and files; per-business S3 prefix
- Authentication with Cognito, sessions bound to one business, MFA for everyone
- Permission engine: named permissions grouped into roles, checked on every API route
- Audit log (platform and per business), email and SMS sending, error monitoring

### B) Workspace landing and business application

- Landing at app.firmivra.com with three cards: Welcome Back, Create a Business Account, Sign In for the First Time (invited staff only)
- Business application: practice type, legal name, DBA, entity type, EIN, contact, website, address, services, team size, client volume, requested plan, primary administrator, credentials and uploads, agreement and certification
- Email verification (6-digit code, 10-minute expiry, resend after 45 s) and phone verification that enrolls SMS MFA
- Status page for the applicant: Pending Review, Information Requested, Approved, Declined with reason

### C) Super Admin console

- Separate login at admin.firmivra.com, authenticator-app MFA only
- Dashboard: pending applications, active firms, total users, monthly revenue, recent applications, tasks, quick actions, system status
- Firm Applications: review details and automated checks; Approve, Request Information or Decline; internal notes only Firmivra sees; application history
- Approve provisions the business in one step: tenant record, portal address, encryption key, default roles, Owner access, starter modules for its business type
- Firms: Active, Pending Setup or Inactive; edit, deactivate or suspend and reactivate; Active Features (Beta) toggles for workspace, client portal, document storage and basic settings; Add Firm Manually; platform audit log viewer; Open Firm Workspace only through an Owner-approved, time-limited, logged support grant
- Sales, Leads/CRM, Team, Subscriptions, Billing, Support, Reports, Notifications, Audit & Security and System Settings as Soon shells for beta; Phase 1 only needs application, approve and activate to work

### D) Business workspace

- First-time setup wizard in 5 steps, first login only, with Save Draft and Back: Branding (logo, portal name, colours, preview), Business details (legal name locked), Team and access, Client portal (header, features, welcome message), Finish
- After login, Owner and Admin go to /admin/dashboard and staff go to /dashboard; staff are always invited and activate at /activate
- Dashboard work queues: New clients, Missing documents, Preparation, Review, Signature, Payment, Filing, Completed (labels come from the active pack)
- Client list and client record tabs: Overview, Contact, Profile details, Engagements, Documents, Messages, Invoices, Signatures, Appointments, Internal notes, Tasks, Activity
- Team: invite by email (link valid 72 hours), assign role, deactivate
- Roles: default Owner, Admin, Staff, Viewer plus custom roles; staff see only assigned clients when the role says so
- Portal settings: client self sign-up with firm approval (decided 4 Oct), direct client invites, enabled modules, client types, intake forms open for self-service, the firm's own Terms and Privacy documents; Begin Online review queue
- Content editor for resources, tips and external links
- Business audit log viewer, data export

### E) Client portal (portal.firmivra.com/{firm})

- Sign-in landing in the business's branding, Create account, Forgot password
- Client sign-up, if the firm allows it: full name, email, phone, password, account type (Individual or Business), consent; 6-digit email code, then 6-digit SMS code; MFA on every login with trusted device for 30 days
- Inactivity warning at 15 minutes, logout at 20; reset with email code plus MFA; lock after 5 failed logins
- Home: welcome header, notification bell, six folder tabs (Intake Form, Business Documents & Resources, My Uploaded Documents, Tax Returns, Receipts & Invoices, Messages and Notes), Your Next Steps and Business Action Items built from open records, Recent Activity, Quick Links, Upcoming Appointment, Need Help
- Sidebar, shown by enabled modules: Home, My Documents, Intake Forms, Messages, Appointments, Invoices & Payments, My Services, My Profile
- Client members: a client invites a spouse or authorized person with a separate login and set permissions
- My Profile: name and date of birth locked (Request Name Change goes to staff), notification preferences, password, Cancel portal account (ends the login only; records kept)
- Private client Notes with optional reminders, never sent to the firm
- Invoices: Pending, Due Soon, Paid, Upcoming, Canceled; recurring-service policy shown inline (cancel 14 days before billing, 60-day document access, 90-day reactivation)
- Sign-in, forgot password and reset password inside the firm's branded portal, with MFA, success and error states, and no hint whether an account exists
- Links to the firm's own Terms of Service and Privacy Policy at sign-up, login and in the footer; Firmivra's documents do not replace them

### F) General modules

- Documents: every upload asks which service it is for; STOP when there is no active service, checked on the server; firm-set file types and size limits, extension and MIME check, malware scan, replacement keeps the old version, category and year filters, retention date and legal hold
- Document requests: Requested, Received, Accepted or Missing; "I don't have this document" with reason
- Intake forms: versioned form definitions per firm and service, steps, auto-save, resume, conditional and repeating fields, quarterly grids, upload slots with "I don't have this", lock on submit; states Sent, In Progress, Submitted, Needs Correction, Under Review, Completed, Expired, Archived
- Begin Online: public, firm-branded intake on the firm's website without login; drafts resume by emailed link; a submission creates a pending lead and engagement for staff review, then a portal invite
- Messages: subject threads, attachments to the vault, read receipts, email notice without content
- Appointments: firm calendar, staff availability, working hours and blocked time, client booking that writes the same record staff see, no double booking, location or video details, confirmations, reminders, reschedule and cancel where allowed, change notifications on both sides
- Invoices and payments: hosted checkout, paid only after verified webhook, duplicate events processed once
- E-signature (Firm Sign, built in): our own signing engine, no outside vendor; the signed PDF and its certificate are filed in the vault, never deleted (see "Firm Sign" below)
- Notifications: in-app bell that opens a Notification Center (read and unread, history, mark as read, opens the related record), email and SMS, per-user preferences
- Calculators: working front-end calculators with validated inputs and estimate disclaimers, Tax Return Calculator first
- Service workspaces: firm-side pages per service for status, tasks, documents, notes, messages and reports, tied to the engagement

#### Firm Sign

Decided 8 Oct: e-signature is built in, not DocuSign or Dropbox Sign. Spec: Octavia's "Firm Sign Developer Specification". Contract: `docs/api/esign.yaml`.

- Engine: pdf-lib on the API builds the packet, stamps values and signatures, flattens form fields and writes the certificate. No vendor and no webhook.
- Data: the `esign_*` tables (requests, documents, recipients, fields, verification codes, events, settings, consent versions, templates, bulk batches), each with `business_id` and RLS. `esign_events` is append-only.
- Signers: a link on the portal host (`portal.firmivra.com/{slug}/sign`), an email code, then the firm's consent text (version pinned). A signed-in client can sign from the Signature center. Details in `docs/AUTH-DESIGN.md`.
- Completion: the PDF is flattened, a certificate is added, and the SHA-256 values of the original, the final PDF and the certificate are stored. The final PDF and the certificate are filed as `FIRM_TO_CLIENT` documents in a keep-forever 'Signed Documents' category with legal hold.
- Scan exception: a `documents` row may start `CLEAN` only for the server-made final PDF or certificate of a completed request, with its key under `tenant/<id>/esign/<request>/final/` or `/certificate/`. Signer attachments and uploaded signature images always wait for the GuardDuty scan.
- Module switch: `esign` (and `calculators`) live in `business_settings.enabled_modules`. Only `app_set_business_module(business, module, enabled, reason)` changes them; the migrate role alone runs it, through `packages/db/scripts/set-module.mjs` (`MODULE_CHANGE=<slug>:<module>:on|off MODULE_REASON=...`), and each change writes a `module.enabled` or `module.disabled` audit row. When off, firm routes answer 403 `MODULE_OFF` and signer routes 404; `GET /esign/status` and the portal's signatures status never error.

### G) Tax & Accounting pack (LVP beta)

- Annual Tax intake in 4 steps (personal and filing information, business income, documents, review and sign), dynamic tax year, spouse and dependents, masked SSN with re-MFA to reveal, payment preference (from refund, pay now with 10% discount, pay after preparation)
- Quarterly Tax, Business Tax by entity type, Bookkeeping (Starter, Growth, Premium), Payroll, Tax Planning and Business Development intakes, each in Begin Online and in the portal
- Tax Returns tab: year table with client-facing statuses each firm sets (for example In Preparation, Ready for Review, Awaiting Signature, Filed/Completed) and a Tax Return Payment card; payment never changes filing status
- Form 8879 and Section 7216 consent signed separately from the service agreement
- Business Documents, Resources & Services tab with Business Startup Guide, Record Keeping, Payroll Resources, Tax Deductions and External Links, all stored as data records
- LVP's colours on client pages only; Firmivra's own screens stay navy, blue and teal
- Bookkeeping workspace (client status, documents, tasks, reconciliations and reports) and Tax Planning workspace (estimates and projections, tasks, plan progress) in the beta
- Right after beta: Payroll operations (employees and contractors, payroll runs, approval, tax filings and payments, W-2/W-3/1099, provider integration), the Business Advisory workspace, and Google/Outlook calendar sync

### H) Infrastructure and deployment

- Staging and production in AWS with Terraform or CDK
- CI/CD with GitHub Actions deploying via OIDC, no long-lived keys
- Domains admin.firmivra.com, app.firmivra.com and portal.firmivra.com/{firm} with TLS; optional custom domains per business (e.g. portal.lvpaccounting.com)
- WAF, monitoring, alarms, verified backups

## Screens

The platform has 62 screens across four apps. "From v1" screens were designed in the original LVP draft; "Octavia mockup" screens are now shown in Octavia's Drive pages.

|#|App|Screen|Purpose|Status|
|---|---|---|---|---|
|1|Workspace|Landing (three cards)|Welcome Back, Create a Business Account, Sign In for the First Time|New|
|2|Workspace|Business application|Practice, legal and contact details, administrator, agreement|Octavia mockup|
|3|Workspace|Verify email and phone|6-digit codes, resend timer, MFA enrollment|From v1|
|4|Workspace|Application received|Pending review status and what happens next|New|
|5|Public site|Terms and Privacy|Legal pages linked from every sign-up|New|
|6|Super Admin|Login + MFA|Separate admin sign-in, authenticator app|New|
|7|Super Admin|Dashboard|Counts by status, new applications, alerts|New|
|8|Super Admin|Business applications|Queue with automated checks|New|
|9|Super Admin|Application review|Details, approve, request information, decline, internal notes|New|
|10|Super Admin|Business list|Status, plan, usage, suspend|New|
|11|Super Admin|Business detail|Metadata, users count, modules, history|New|
|12|Super Admin|Audit log and support access|Filters, grant requests|New|
|13|Super Admin|Coming Soon tabs|Placeholders for beta|New|
|14|Workspace|Login + MFA, business picker|Staff sign-in, choose business|New|
|15|Workspace|Setup wizard (5 steps)|Branding, details, team, portal, finish|New|
|16|Workspace|Dashboard and queues|Work queues and counts|From v1|
|17|Workspace|Client list|Search, filter, invite, create|From v1|
|18|Workspace|Client record (12 tabs)|Everything about one client|From v1|
|19|Workspace|Engagement detail|Status tracker, requests, documents|From v1|
|20|Workspace|Client sign-up approvals|Pending client requests|New|
|21|Workspace|Team and invites|Members, roles, deactivate|New|
|22|Workspace|Roles and permissions|Default and custom roles|New|
|23|Workspace|Portal settings and modules|Approval queue, modules, client types, legal documents|New|
|24|Workspace|Branding|Logo, colours, portal address|New|
|25|Workspace|Invoices and signatures|Create, send, track|From v1|
|26|Workspace|Content editor|Resources, tips, links|From v1|
|27|Workspace|Audit log and export|Business-only log, data export|From v1|
|28|Workspace|Billing with Firmivra|Plan and invoices (Owner only)|New|
|29|Client portal|Sign-in landing|Business branding, Sign in, Create account|From v1|
|30|Client portal|Client sign-up|Name, email, phone, password, account type|From v1|
|31|Client portal|Verify email and phone|Codes and MFA enrollment|From v1|
|32|Client portal|Awaiting approval / Account created|Status after sign-up|From v1|
|33|Client portal|Login + MFA, reset password|Sign-in and recovery|From v1|
|34|Client portal|Dashboard|Action required, activity, quick links|From v1|
|35|Client portal|My documents and upload popup|Filters, upload by reason, STOP message|From v1|
|36|Client portal|Document requests|Requested items with direct upload|From v1|
|37|Client portal|Messages|Threads, compose, attachments|From v1|
|38|Client portal|Invoices and receipts|Upcoming, past, Pay now|From v1|
|39|Client portal|Signature center|Pending and signed documents|From v1|
|40|Client portal|Appointments|Book, reschedule, cancel|From v1|
|41|Client portal|My profile and members|Contact, security, invite spouse|From v1|
|42|Tax pack|Personal Tax intake (3 steps)|Info, uploads, review and sign|From v1|
|43|Tax pack|Business Tax and Bookkeeping intakes|Entity-based forms|From v1|
|44|Tax pack|Tax Returns tab|Year table, firm-set statuses, payment card|From v1|
|45|Tax pack|Business resources and 4 guides|Startup, deductions, records, payroll|From v1|
|46|Tax pack|External Links|Approved resources, open in a new tab|Octavia mockup|
|47|Super Admin|Add Firm Manually|Create a firm without an application|New|
|48|Workspace|First sign-in (/activate)|Invited staff set password and MFA|New|
|49|Workspace|Begin Online review queue|Pending leads and engagements from public intake|New|
|50|Public site (per firm)|Begin Online service picker|Six service cards on the firm's website|Octavia mockup|
|51|Public site (per firm)|Begin Online forms (6 services)|Annual Tax, Quarterly Tax, Bookkeeping, Payroll, Tax Planning, Business Development|Octavia mockup|
|52|Public site (per firm)|Begin Online success|Confirmation email and next steps|Octavia mockup|
|53|Client portal|Business Documents & Resources tab|Business documents, Business Action Items, My Business Services|Octavia mockup|
|54|Client portal|Messages and Notes|Direction filters, unread badge, private notes with reminders|Octavia mockup|
|55|Client portal|Request Name Change and Cancel portal account|Locked name and DOB change via staff; end the login only|Octavia mockup|
|56|Client portal|My Services|Enrolled services and their status (no design yet)|New|
|57|Client portal|Notification centre|Bell list and avatar menu (no design yet)|New|
|58|Workspace|Calendar and staff availability|Firm calendar, working hours, blocked time, bookings|New|
|59|Workspace|Bookkeeping workspace|Status, documents, tasks, reconciliations, reports|New|
|60|Workspace|Tax Planning workspace|Estimates and projections, tasks, plan progress|New|
|61|Workspace|Legal documents|Firm's own Terms and Privacy for its portal|New|
|62|Tax pack|Calculators|Tax Return Calculator and other approved calculators|New|

## Security and non-functional requirements

The original draft's security bar applies to every business on the platform, with tenant isolation added on top of client isolation.

|Requirement|Description|
|---|---|
|Tenant isolation|Business A can never see Business B's users, clients, files, messages or IDs. Enforced by PostgreSQL row-level security and per-tenant S3 prefixes, proven by automated cross-tenant tests on every API route|
|Client isolation|Inside a business, Client A can never see Client B's records. The client ID comes from the session token, never from the URL|
|Platform staff access|Super Admin sees business metadata only. Reading client data needs an Owner-approved, time-limited support grant, logged in both audit logs|
|Access control|Server-side authorization on every API call and file access; URLs, hidden fields and client-supplied IDs are never a basis for authorization|
|Encryption|TLS 1.2+ with HSTS; RDS, S3 and backups encrypted with KMS; SSN, ITIN, EIN and bank numbers encrypted at application level with a per-business key|
|MFA|Required for every user. Super Admin, Owners and Admins must use an authenticator app, not SMS|
|OWASP Top 10|Parameterized queries, output encoding, CSRF, SSRF and upload protections|
|Headers and cookies|Secure, HttpOnly, SameSite=Strict cookies; CSP, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy|
|Upload security|Magic-byte type check, size limit, malware scan, separate quarantine bucket, files renamed to UUIDs|
|Logging and audit|No passwords, tokens, full SSNs, card data or document content in logs; append-only audit log plus CloudTrail nobody can delete|
|Secrets|AWS Secrets Manager only, never in code or the browser|
|Dependencies|Dependabot or Snyk; Critical fixed within 7 days, High within 30|
|Privacy and retention|Data minimization; retention date on every document (tax 7 years, payroll at least 4, formation permanent); legal hold; each business can export or close its account|
|Incident response|Runbook per incident type; notify affected businesses; FTC notice within 30 days if unencrypted data of 500+ clients is exposed|
|Abuse protection|Rate limits on sign-up, login and verification codes; disposable-email checks on business sign-up; WAF rules|
|Noisy neighbour|Per-business rate limits and storage quotas so one business cannot slow others|
|Performance|95% of API requests within 500 ms; 99.5% monthly uptime; no planned maintenance Jan 15 to Apr 15|
|Backups|Daily snapshots, 35-day point-in-time recovery, RPO 24 h, RTO 8 h, quarterly restore test|
|Accessibility|WCAG 2.1 AA: keyboard navigation, visible focus, 4.5:1 contrast (test gold on cream), labelled forms|
|Maintainability|TypeScript, linting, 70%+ backend unit-test coverage, infrastructure as code, runbooks in the repository|

## Architecture and tech stack

One Next.js frontend serves all three web surfaces (public site, workspace, client portal) and picks the business from the host name. One NestJS API sits behind it on ECS Fargate in private subnets, with CloudFront and WAF in front, Cognito for sign-in, RDS PostgreSQL for data and S3 for files. The browser talks only to CloudFront and Cognito.

*Chart in the PDF: platform architecture on AWS. The same layout is written out under "AWS infrastructure" in docs/SYSTEM-DESIGN.md.*

Every API request runs the same four checks: who is signed in, which business the request belongs to, whether their role allows the action, and only then the query, inside a transaction that sets the tenant for row-level security.

|Layer|Technology|Multi-business notes|
|---|---|---|
|Frontend|Next.js (React, TypeScript), Tailwind CSS, React Hook Form + Zod|Middleware reads the firm slug in the portal path (or a custom domain) to load the business's branding and modules; theme tokens per business|
|API|NestJS (Node.js, TypeScript), role and permission guards, Prisma ORM with migrations|A tenant guard sets `app.tenant_id` with `SET LOCAL` in each request's transaction; a Prisma extension wraps every query in it|
|Authentication|Amazon Cognito (User Pool, MFA, Advanced Security)|One pool for staff, one for clients; custom claims carry tenant and role; Super Admin in its own pool|
|Database|Amazon RDS PostgreSQL, Multi-AZ, encrypted; intake answers in JSONB|Row-level security on every tenant table; app connects as a role without BYPASSRLS|
|Files|Amazon S3 (quarantine, vault, audit archive) + KMS, Block Public Access, versioning|Keys under tenant/<id>/...; one KMS key per business|
|Background jobs|SQS + Lambda + EventBridge Scheduler|Every job message carries tenant_id; malware scan, reminders, retention|
|Malware scan|GuardDuty Malware Protection for S3 (or ClamAV Lambda)|Same for all businesses|
|Email / SMS|Amazon SES (SPF, DKIM, DMARC) and Amazon SNS, decided 4 Oct|Sender name per business; custom sending domain later|
|Payments|Stripe with hosted checkout (decided 4 Oct)|Stripe Connect so each business is paid into its own account (to confirm)|
|E-signature|Firm Sign, built in (decided 8 Oct): pdf-lib on the API|No outside vendor and no webhook; signed files stay in the business's own S3 prefix and key|
|Security and monitoring|WAF, CloudTrail, GuardDuty, Security Hub, CloudWatch, Secrets Manager|Alerts tagged by tenant|
|IaC and CI/CD|Terraform or AWS CDK; GitHub Actions + OIDC|Staging and production; preview environments optional|

### Environments

- Local: Docker Compose (PostgreSQL, s3mock for S3, Mailpit for email; SMS to the API log; a local encryption key instead of KMS), synthetic data only, with two seeded test businesses to exercise isolation
- Staging: Firmivra AWS, separate account or VPC, synthetic data only
- Production: Firmivra AWS at admin.firmivra.com, app.firmivra.com and portal.firmivra.com; real data only after go-live approval
- One VPC across two Availability Zones; only the load balancer and NAT Gateway in public subnets; ECS and RDS private; S3 and Secrets Manager via VPC endpoints; RDS reachable only from the API security group

### Estimated monthly AWS cost

The original draft estimated roughly $200–350 per month for one firm under 5,000 clients (two small Fargate tasks, RDS db.t4g.small Multi-AZ, a few hundred GB of S3, WAF, GuardDuty, NAT Gateway). A shared platform starts at about the same cost and grows with total clients and storage across all businesses. This needs confirming with the AWS Pricing Calculator.

## Database structure and access control

The original draft's model stays: every document, intake, signature, invoice and message thread belongs to an engagement, and every engagement belongs to a client. On top of it, every business-owned table gains tenant_id, and authorization becomes two checks: does this record belong to the signed-in user's business, and is the user allowed to see this client.

### Platform tables (no tenant_id)

|Table|Key columns|Notes|
|---|---|---|
|tenants|id, display_name, legal_name, business_type, status (pending_review / pending_setup / active / suspended / closed), slug, custom_domain, kms_key_id, pack, created_at|One row per business|
|tenant_applications|id, submitted_data (JSONB), checks, status, reviewed_by, reason, reviewed_at|Sign-up queue|
|platform_users|id, cognito_sub, email, role (super_admin / support / billing), status|Firmivra team|
|plans, subscriptions|plan limits; tenant_id, plan_id, status, renews_at, processor_ref|What each business pays Firmivra|
|support_grants|tenant_id, platform_user_id, granted_by, scope, expires_at|Time-limited access, owner approved|
|users|id, cognito_sub, email, phone, full_name, status, last_login_at|Staff identity, can belong to several businesses; no password stored|

### Tenant tables (tenant_id on every row, row-level security on)

|Table|Key columns|Notes|
|---|---|---|
|memberships|tenant_id, user_id, role_id, status|Which staff belong to which business|
|roles, role_permissions|tenant_id, name, is_default; permission keys|Owner, Admin, Staff, Viewer + custom|
|tenant_settings|tenant_id, branding, signup_mode, enabled_modules, client_types|Per-business configuration|
|clients|tenant_id, id, account_type (individual / business), state, address, dob_enc, ssn_enc, ssn_last4, custom_fields (JSONB)|`_enc` columns use the business's KMS key|
|client_users|tenant_id, id, cognito_sub, email, phone, status|Portal logins, scoped to one business|
|client_members|tenant_id, client_id, client_user_id, relation (primary / spouse / authorized), permissions|Separate spouse login|
|client_businesses|tenant_id, client_id, legal_name, dba, ein_enc, ein_last4, entity_type, formation_state|Several per client (tax pack)|
|engagements|tenant_id, id, client_id, service, period, status, assigned_user_id, opened_at, closed_at|Uploads allowed only while open|
|engagement_status_history|tenant_id, engagement_id, from_status, to_status, changed_by, changed_at, note|Source of the status tracker|
|intake_submissions|tenant_id, id, engagement_id, form_type, form_version, answers (JSONB), state, version, submitted_at|New row on every change|
|documents|tenant_id, id, engagement_id, client_id, s3_key, original_name, mime, size, sha256, category, tax_year, direction, scan_status, retention_until, legal_hold, uploaded_by, deleted_at|s3_key under tenant/<id>/|
|document_requests|tenant_id, id, engagement_id, title, status, not_applicable_reason, due_date|"I don't have this document" lives here|
|esign_requests|tenant_id, id, client_id, engagement_id, status, original_sha256, final_sha256, certificate_sha256, final_document_id, certificate_document_id|Firm Sign; frozen once sent, never deleted after send|
|esign_recipients, esign_fields|tenant_id, request_id; signer, order, auth method, token_hash, signed_at, signer_ip; field type, page, position, value_enc|Only the link token's SHA-256 is stored|
|esign_events|tenant_id, request_id, recipient_id, type, actor, ip, user_agent, created_at|Append-only; feeds the certificate|
|invoices, payments|tenant_id, number, line_items, amount_cents, status, processor_ref; processor_event_id (unique)|No card data; webhook idempotency|
|message_threads, messages|tenant_id, client_id, subject; sender, body, attachment_document_id, read_at|Attachments in the vault|
|appointments|tenant_id, client_id, service, type, method, starts_at, external_ref|Free 5-minute call is phone-only (LVP)|
|internal_notes, tasks|tenant_id, engagement_id or client_id, author, body, due_at, status|Never returned by the client API|
|notifications|tenant_id, recipient, type, payload (no sensitive data), read_at|Bell icon|
|resources, external_links, tips|tenant_id, slug, title, body or url, category, state, published|Content editor; packs ship defaults|
|audit_events|tenant_id (null for platform events), actor, action, target_type, target_id, ip, user_agent, at, metadata|UPDATE and DELETE denied; daily S3 Object Lock archive|

### Permission matrix at launch

|Action|Super Admin|Owner|Admin|Staff|Viewer|Client|Client member|
|---|---|---|---|---|---|---|---|
|Approve, reject, suspend a business|Yes|No|No|No|No|No|No|
|See business list and usage|All|Own|No|No|No|No|No|
|Read a business's client records|With grant|All|All|Assigned|Read only|Own|As permitted|
|Invite staff, edit roles|No|Yes|Yes|No|No|No|No|
|Approve client sign-ups|No|Yes|Yes|If allowed|No|No|No|
|Complete and submit intake|No|View, unlock|View, unlock|View|View|Yes|As permitted|
|Upload documents|No|Yes|Yes|Yes|No|Open engagement|Open engagement|
|Delete documents|No|Retention rules|Retention rules|No|No|Own, open engagement|No|
|View full SSN|No|Re-MFA, logged|Re-MFA, logged|If allowed, re-MFA|No|Re-MFA|No|
|Change status, create invoices|No|Yes|Yes|If allowed|No|No|No|
|Make payments|No|No|No|No|No|Yes|Yes|
|Internal notes|No|Yes|Yes|Yes|Read|No|No|
|Branding, modules, portal settings|No|Yes|Yes|No|No|No|No|
|Billing with Firmivra, close business|No|Yes|No|No|No|No|No|
|Audit log|Platform|Business|Business|No|No|Own login history|Own login history|

## API and integrations

REST API at /api/v1, split by audience. Every request carries a Cognito token. The business comes from the host and the token's tenant claim, and on client routes the client ID comes from the token, never the URL.

|Area|Routes|Guard|
|---|---|---|
|Public|POST /public/business-signup, POST /public/verify, GET /public/tenant-by-host (branding only)|Rate limited, no auth|
|Platform|/platform/applications, /platform/applications/{id}/approve, /reject, /platform/tenants, /platform/tenants/{id}/suspend, /platform/audit-log, /platform/support-grants|Super Admin pool + authenticator MFA|
|Workspace|/workspace/setup, /workspace/queues, /workspace/clients (CRUD, invite, deactivate), /workspace/clients/{id}.*, /workspace/client-signups, /workspace/engagements/{id}/status, /workspace/document-requests, /workspace/documents/{id}, /workspace/invoices, /esign/* (Firm Sign), /workspace/notes, /workspace/tasks, /workspace/team, /workspace/roles, /workspace/settings, /workspace/cms.*, /workspace/audit-log, /workspace/export|Staff pool + membership + permission per route|
|Firm Sign signer|/portal/{slug}/sign/* (session, code, consent, envelope, adopt, finish, decline, completed copy)|Public, strict throttle; link token in the URL fragment, then the `fv_sign_{slug}` cookie and an email code; 404 when the module is off|
|Client|/client/me, /client/dashboard, /client/engagements, /client/intakes/{id} (GET, PUT, submit), /client/documents (upload-url, complete, list, download-url, delete), /client/document-requests, /client/tax-returns, /client/threads, /client/signatures, /client/invoices/{id}/checkout, /client/appointments, /client/notifications, /client/resources, /client/members, /client/sensitive/reveal|Client pool + tenant match + client scope|

### Webhooks (public, signature-verified)

|Path|Source|Verification|
|---|---|---|
|POST /webhooks/payments|Payment processor|Provider signature + idempotency on event ID; tenant taken from the stored invoice, never from the payload|
|POST /webhooks/scheduling|Scheduling provider, if external|Secret token per business|
|S3 / GuardDuty events to SQS|AWS internal|IAM, not public|

### Third-party services

- E-signature: none. Firm Sign is built in (decided 8 Oct). Remote signing of Form 8879 waits for the identity check IRS Pub 1345 requires
- Payments: Stripe (decided 4 Oct); Connect for per-business payouts still to confirm
- Fee from refund: the tax software's bank product; the portal only stores the preference
- Email / SMS: Amazon SES and Amazon SNS (decided 4 Oct), with A2P 10DLC registration
- Payroll provider: chosen after the beta
- Scheduling: built-in module, or Calendly / Acuity
- Malware scan: GuardDuty Malware Protection for S3

## Deliverables and acceptance criteria

### Deliverables

- Platform foundations with tenant isolation, auth, permissions and audit
- Public website with business sign-up and legal pages
- Super Admin console
- Business workspace with setup wizard, team, roles, settings and content editor
- Per-business client portal with client sign-up and approval
- General modules: documents, requests, intake engine, messages, appointments, invoices and payments, e-signature, notifications
- Tax & Accounting pack with LVP onboarded as the first business
- AWS staging and production built with infrastructure as code
- Security testing: cross-tenant and cross-client authorization tests, vulnerability scan, upload tests, backup restore
- Handover: source, architecture diagrams, schema, runbooks, incident runbook, AWS inventory and access list in Firmivra's repository

### Acceptance criteria (before go-live)

- [ ] Business A cannot see Business B's data by any path, verified by automated tests on every route
- [ ] Client A cannot see Client B's records, files or messages by any path, inside one business
- [ ] Super Admin cannot read client data without an active support grant, and each grant is logged
- [ ] A new business can sign up, be approved, finish the setup wizard and invite a client without help
- [ ] A client can join a business's portal (invite or sign-up, as the firm chooses), upload a file for an active service, and staff see the same record
- [ ] A Begin Online submission creates a pending lead and engagement, never a login, and staff can turn it into a client with a portal invite
- [ ] A client cannot book a slot that is already taken, and client and firm always see the same appointment
- [ ] Every notification in the Notification Center opens its related record
- [ ] Password reset works inside the firm's portal and never reveals whether an account exists
- [ ] MFA works for every user type and cannot be disabled; session timeout, reset and deactivation work
- [ ] No public S3 object; downloads only via time-limited signed URLs; SSN and EIN encrypted at field level with the business's key
- [ ] Uploads blocked without an open engagement; malware files held
- [ ] Intake auto-save, resume, versioning and conditional fields work
- [ ] Payment webhooks reject forged signatures and process duplicates once
- [ ] Firm Sign: a PDF goes to 2 sequential signers with link plus email code and consent; the final PDF and certificate are filed with their SHA-256 values; unknown, expired, used and wrong-firm links all get the same answer
- [ ] No SSN, amounts or document content in email or SMS; no trackers on signed-in pages
- [ ] Audit log records all important actions and nobody can delete it; WAF, CloudTrail and GuardDuty alerts active
- [ ] Backup restore documented; all screens tested on desktop and mobile

## Build phases and timeline

Work follows Rasel's order: foundations first, then Super Admin, role-based access, and the public client portal, then modules and the LVP pack.

*Chart in the PDF: 6 build phases with 5 gates. The phases and gates are written out under "Build phases" in docs/SYSTEM-DESIGN.md.*

Delivery: Oct 18, 2026. It includes everything above except payroll operations, the Business Advisory workspace and Google/Outlook calendar sync, which ship right after. The original draft's 7 days and $400 covered a single-firm portal, so each phase gets its own estimate.

## Changes from the original draft

|Topic|Original draft (09/20/2026)|This version|
|---|---|---|
|Product|Custom portal for one firm, LVP|Multi-business platform; LVP is the first business|
|Hosting and ownership|LVP's AWS account and GitHub, LVP holds root|Firmivra's AWS and GitHub; each business controls its data through isolation, its own key and support grants|
|Address|portal.lvpaccounting.com|portal.firmivra.com/{firm}, with `admin.` and `app.firmivra.com` for Firmivra and firms; custom domain optional|
|Backend users|Owner/Admin only; other roles disabled|Owner, Admin, Staff, Viewer and custom roles per business|
|Client sign-up|Open question at first; Octavia's newer pages disagree (guide: firm invite only; mockups: public sign-up)|Each business picks: invite only, public with approval, or auto-approve; Begin Online creates a lead, not a login|
|New layers|None|Public business sign-up, Super Admin console, setup wizard, modules and packs|
|Data model|Client and engagement scoped|Same, plus `tenant_id` and row-level security on every table|
|Tech stack|Next.js, NestJS, Prisma, Cognito, RDS, S3, ECS|Unchanged, with tenant context added|
|Timeline and budget|7 days, $400 fixed|Not realistic for this scope; to be re-estimated per phase|
|Return tracker|10 stages including Payment|Client statuses set by each firm; payment stays on the invoice|
|Super Admin access|Octavia's newer mockup has an Open Firm Workspace button|Only through an Owner-approved, time-limited, logged support grant|

## Inputs needed

- Firmivra AWS account and GitHub organization, with least-privilege developer access
- Choice of payment, SMS and scheduling providers (e-signature is built in), and the tax software bank product for "Pay from my refund"
- Firmivra legal entity, address and contacts for Terms and Privacy
- LVP's real business phone and address (mockups show (770) 123-4567, 555 numbers, and 1993 vs 1393 Duncan Lane)
- LVP's final service agreement text, remaining Useful Links URLs (13 of about 35 provided), and prior-year returns 2020–2024 if they are to be imported
- Approval of the LVP mockup fixes listed in the original draft (no Settings menu, Notes & Messages as 6th tab, one invoice filter, and others)
- Designs for screens Octavia's pages link but do not show: Appointments, My Services, My Settings, notification centre, avatar menu, portal sign-in and password reset
- One agreed set of mockup fixes: brand spelling, sidebar and tab names, one footer, Begin Online step counts, payroll retention 4 vs 7 years, typos
- LVP's final Terms of Service and Privacy Policy with effective dates
- The list of approved calculators with their formulas and tax year

## Decisions (4 Oct 2026)

Rasel decided these on 4 October 2026.

|Question|Decision|
|---|---|
|Beta scope|Delivery: Oct 18, 2026, with all missing requirements except payroll operations, Advisory and calendar sync, which ship right after|
|AWS region|us-east-1 (N. Virginia)|
|AWS account|One Firmivra account for all firms, isolated per firm; no separate LVP account|
|Client sign-up|Self sign-up on the firm portal, then the firm approves|
|Super Admin access|Only with the firm Owner's time-limited, logged approval|
|Payments|Stripe|
|Payroll provider|Chosen after beta|
|Email and SMS|Amazon SES and SNS|

## Open questions

- [ ] Is Firmivra still Octavia's product, widened to all businesses, or a separate platform?
- [ ] Should Super Admin approve every business, or can some auto-activate?
- [ ] Which business types come after tax and accounting?
- [ ] How do businesses pay Firmivra: plans, trial length, limits?
- [ ] Stripe Connect for per-business payouts, or one Stripe account per firm?
- [ ] Are the citizenship question and Social Security card uploads needed for LVP?
- [ ] Does the 10% discount apply to all LVP services or only Personal Tax?
- [ ] Is the Annual Tax intake 4 steps everywhere now (Begin Online shows 4; the earlier portal showed 3)?
- [ ] Expected number of businesses and clients in year one, and peak concurrent users?
- [ ] Brand spelling: Firmivra, FirmVora or FirmVRA?
- [ ] Should a Begin Online submission ever create a portal account automatically?
