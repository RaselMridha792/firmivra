<!--
Text export of Firmivra-System-Design.html (draft 4, 4 Oct 2026), made for the repo.
Diagrams are written out as lists. Latest version: https://claude.ai/artifact/7EZP4gygmnUgR6tWLye9s4
Naming: this document says tenant / tenant_id. In code the tenant is the Business model and the column is business_id.
-->

System design · draft 4 · 4 Oct 2026

# Firmivra platform design

One platform where any business opens its own account under its own name, runs its own team and clients, and gives each client a private portal login. Every business's data lives in Firmivra's database, but only that business can see it.

- Based on Rasel's foundation sketch
- Folds in Octavia's Phase 1 checklist, her four Drive folders (platform guide, Super Admin, Client Portal, Begin Online) and the original LVP portal draft (20 Sep 2026)
- Includes Rasel's decisions of 4 Oct 2026 and Octavia's missing-requirements list
- Design only, no code yet

**3** apps: admin, firm workspace, client portal

**8** roles across platform, business and client

**4** isolation walls: API, database, files, keys

**8 Jan** 2027 LVP beta; payroll, advisory and calendar sync right after

**6** build phases, foundations first

## Reading the sketch

The hand-drawn diagram has four levels and one rule. Here is what each part means in system terms.

| In the sketch | What it becomes |
| --- | --- |
| Firmivra | The **platform**: one codebase, one deployment, one database, shared by everyone. |
| Firmivra Super Admin | The **platform console**, used by the Firmivra team only. It approves businesses, suspends them, and sees usage and billing. It does not browse a business's client data by default. |
| Individual Business 1, 2, 3 | A **tenant**. Each business signs up under its own name and gets its own workspace, staff, roles, branding and portal address. |
| "It can handle own clients info only" | **Tenant isolation**. Every query is scoped to one business and enforced in the database itself, not only in app code. |
| C1, C2, C3 under each business | **Client accounts** that belong to one business. Business 1's C1 and Business 2's C1 are different people with no link between them. |
| "Separate login, client portal" | Each client signs in to **their business's portal** (for example `portal.firmivra.com/lvp-accounting`) with credentials separate from staff logins. |
| "Protected by their own control, but saved on Firmivra's database" | **Shared database, per-business control**: `tenant_id` on every row, row-level security, a per-business encryption key for sensitive fields and files, and an owner-approved, logged grant before any Firmivra staff can look inside. |

## Architecture

Three apps sit on one API and one database. The API works out which business a request belongs to before it touches any data, and the database refuses rows from any other business.

*Diagram: Firmivra architecture*

- **Public website**: business sign-up, pricing, legal. Sends applications to the Super Admin.
- **Firmivra Super Admin** (`admin.firmivra.com`): approve, suspend, plans, usage. Provisions and activates businesses. Every admin action goes to the append-only **platform audit log**.
- **Business 1, 2, 3**: each is a workspace with its own staff and roles (`tenant_id` = B1, B2, B3). No crossing between businesses.
- Each business has its own clients **C1, C2, C3**, each with a separate client-portal login.
- **Firmivra API (NestJS)** checks every request in order: 1. who is signed in, 2. which business (from host + session), 3. does their role allow this, 4. set the tenant context, then query.
- **One Firmivra database (RDS PostgreSQL) + S3 file storage**: platform tables (tenants, plans, admins; no client data here), then rows where tenant = B1, B2, B3 (clients, docs, invoices…), with files under `tenant/B1/*` encrypted with key K-B1, `tenant/B2/*` with K-B2, and so on.

Dashed orange lines are the isolation walls from the sketch. They hold all the way down: in the API, in the database's row-level security, in file storage paths and in encryption keys.

Platform · admin.firmivra.com

#### Super Admin console

- Firm applications: approve, request info, decline
- Firms list, status, feature toggles, add manually
- Suspend or reactivate a firm
- Phase 1 is a minimal shell; other tabs say Soon

Business · app.firmivra.com

#### Firm workspace

- Landing: Welcome Back, Create a Business Account, Sign In for the First Time
- Admins go to /admin/dashboard, staff to /dashboard
- Setup wizard, dashboard and queues
- Clients, engagements, team, roles
- Modules the business turned on
- Branding, portal settings, audit log

Client · portal.firmivra.com/{firm}

#### Client portal

- Firm-branded, custom domain optional
- Public Begin Online intake and portal sign-up
- Dashboard with Action required
- Intake, documents, messages, invoices
- Only their own records

## AWS infrastructure

This follows the stack in the original LVP draft, moved into one Firmivra AWS account in **us-east-1** (N. Virginia) that every business runs on, each isolated from the others. Only the load balancer and NAT Gateway face the internet. The containers and the database sit in private subnets, and S3, Secrets Manager and KMS are reached through VPC endpoints.

*Diagram: AWS layout*

- **Browsers** (admins, staff, clients) → **CloudFront + WAF** (TLS 1.2+, `*.firmivra.com`)
- **Amazon Cognito**: 3 user pools, MFA
- **VPC across two availability zones**
  - Public subnets: **Application Load Balancer**, **NAT Gateway**
  - Private subnets: **Next.js on Fargate** (pages for all 3 apps), **NestJS API on Fargate** (guards + Prisma), **RDS PostgreSQL** (Multi-AZ, encrypted, RLS), **SQS + Lambda jobs** (scan, reminders, retention)
  - Through VPC endpoints: **S3 buckets** (quarantine, vault, audit archive), **Secrets Manager** (all app secrets), **KMS** (one key per business)
- **GuardDuty for S3** (malware scan)
- **Amazon SES** (email, SPF/DKIM/DMARC) and **Amazon SNS** (SMS and MFA codes)
- **CloudTrail, GuardDuty, Security Hub**; CloudWatch alarms tagged by tenant
- **GitHub Actions → OIDC deploy** (Terraform or CDK; staging and production; no long-lived keys)
- **Stripe, DocuSign or Dropbox Sign**: webhooks to the load balancer, signature-verified

The original draft's cost estimate for one firm under 5,000 clients was roughly $200 to $350 a month. A shared platform starts near the same figure and grows with total clients and storage across all businesses.

## One request, step by step

This is what happens when an LVP client opens "My documents". The same four checks run on every route, for every role.

*Diagram: one request, browser to database*

- Client browser → Next.js: `GET portal.firmivra.com/lvp-accounting/documents`
- Next.js → NestJS API: `GET /api/v1/client/documents`
- The API runs four checks:
  1. Verify the Cognito token and MFA claim.
  2. Slug `lvp-accounting` → tenant B1; is the token's tenant B1?
  3. The role allows `documents.view`; `client_id` comes from the token.
  4. `BEGIN; SET LOCAL app.tenant_id = B1; SELECT …` against PostgreSQL.
- PostgreSQL: RLS returns only rows where tenant = B1, so only this client's rows come back.
- API → Next.js: JSON + 5-minute signed file links; the browser gets the page in LVP branding.
- Any failed check → 403, logged.

Step 2 is the tenant wall in the API. Step 4 is the same wall again in the database: even if a bug skipped step 2, PostgreSQL would still return nothing from another business.

## Tenancy & data isolation

The sketch asks for two things at once: all data in Firmivra's database, yet each business in control of its own. There are three common ways to store multi-business data.

| Option | How it works | Isolation | Cost & effort | Fit |
| --- | --- | --- | --- | --- |
| **Shared tables + row-level security** | One database, every row has `tenant_id`, the database filters by it automatically | Strong when enforced in the DB | Lowest; one migration for everyone | Recommended |
| Schema per business | One database, a separate set of tables per business | Stronger | Migrations multiply with every business | Not at the start |
| Database per business | Each business gets its own database | Strongest | Highest; hard to run hundreds | Not used: decided 4 Oct that LVP shares the one Firmivra account |

### The four walls

Wall 1 · API

#### Tenant guard

NestJS resolves the business from the host and checks it matches the token. Client IDs always come from the token, never the URL.

Wall 2 · Database

#### Row-level security

Every tenant table has a policy on `tenant_id`. The app's database role cannot bypass it; only migrations run privileged.

Wall 3 · Files

#### Tenant prefixes

Files live under `tenant/<id>/` and are served only through 5-minute signed links issued after a permission check.

Wall 4 · Keys

#### Per-business KMS key

SSN, ITIN, EIN, bank numbers and files are encrypted with that business's own key. Closing a business can destroy its key.

**Firmivra staff stay outside by default.** Super Admin sees business metadata only: name, status, plan, counts. To look at client data for support, Firmivra requests access, the business Owner approves it for a set time, and both audit logs record every view.

## Roles & permissions

Roles live in three separate planes. A role in one plane gives nothing in another. Permissions are named actions (`clients.view`, `invoices.create`), and roles are bundles of them, so a business can build custom roles such as Preparer or Bookkeeper without code changes.

Platform plane

#### Firmivra team

- **Super Admin**: everything on the platform
- **Platform Support**: business metadata; client data only with a grant
- **Billing**: plans and invoices to businesses

Business plane

#### Each business's team

- **Owner**: signed up the business; billing, close account
- **Admin**: team, roles, settings, all clients
- **Staff**: assigned clients and allowed modules
- **Viewer**: read only
- **Custom roles**: Preparer, Bookkeeper, Assistant…

Client plane

#### Each business's clients

- **Client**: individual or business account, own records only
- **Client member**: spouse or authorized person with a separate login and limited rights

### Permission matrix at launch

| Action | Super Admin | Owner | Admin | Staff | Viewer | Client | Member |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Approve, reject, suspend a business | yes | no | no | no | no | no | no |
| See business list and usage | all | own | no | no | no | no | no |
| Read client records | grant | all | all | assigned | read | own | allowed |
| Invite staff, edit roles | no | yes | yes | no | no | no | no |
| Approve client sign-ups | no | yes | yes | if set | no | no | no |
| Complete and submit intake | no | unlock | unlock | view | view | yes | allowed |
| Upload documents | no | yes | yes | yes | no | open eng. | open eng. |
| Delete documents | no | retention | retention | no | no | own, open | no |
| View full SSN | no | re-MFA | re-MFA | if set | no | re-MFA | no |
| Change status, create invoices | no | yes | yes | if set | no | no | no |
| Make payments | no | no | no | no | no | yes | yes |
| Internal notes | no | yes | yes | yes | read | never | never |
| Branding, modules, portal settings | no | yes | yes | no | no | no | no |
| Billing with Firmivra, close business | no | yes | no | no | no | no | no |
| Audit log | platform | business | business | no | no | own logins | own logins |

Every check runs on the server, including direct links. Octavia's docs already require this for personal versus business client areas, and here it covers every role.

## User journeys

Each map follows one person from first contact to everyday use: what they do, the screen they see, what the system does behind it, and who gets notified. Pick a role.

**Who:** Octavia, owner of LVP Accounting & Taxes, or any business owner

**Goal:** Get her business on Firmivra and her clients into a branded portal

**Starts at:** app.firmivra.com → Create a Business Account

**Ends at:** Workspace dashboard with team and first clients

| Stage | Does | Screen | System | Notified |
| --- | --- | --- | --- | --- |
| 1. Discover | Picks Create a Business Account from the three-card landing | Workspace landing | Nothing stored yet | None |
| 2. Sign up | Practice type, legal name, DBA, entity, EIN, contact, address, services, team size, client volume, plan, primary administrator, credentials; signs the agreement | Business application | Rate limit, disposable-email check, creates application | Verification email and SMS codes |
| 3. Verify | Types the 6-digit email code and SMS code | Verify email & phone | Phone enrolled for MFA; application pending\_review | Super Admin: new application |
| 4. Wait | Sees Pending Review; answers if Firmivra requests more information | Application received | Automated checks shown to reviewer | Owner: request for information |
| 5. Approved | Opens the approval email | Email: Your business is approved | Tenant, slug lvp-accounting, KMS key, default roles, Owner membership, Tax pack modules; firm pending\_setup | Owner: approved (or rejected with reason) |
| 6. First login | Signs in at app.firmivra.com, sets up authenticator-app MFA | Login + MFA | Role check sends Owner/Admin to /admin/dashboard | New-device alert |
| 7. Setup wizard | Branding (logo, portal name, colours, preview), business details (legal name locked), team & access, client portal (header, features, welcome message), finish; Save Draft keeps progress | Setup wizard, 5 steps, once | Firm active ; portal live at portal.firmivra.com/lvp-accounting | None |
| 8. Build team | Invites staff with roles; optionally creates Preparer role | Team, Roles | 72-hour invite links; memberships created on accept | Staff: invitation email |
| 9. Bring clients | Adds or invites existing clients; shares the Begin Online and portal links | Clients, Portal settings | Client invites or open sign-up per chosen mode | Clients: invitation email |
| 10. Run | Works queues, approves sign-ups, checks reports, pays Firmivra plan | Dashboard, Billing | Everything scoped to tenant LVP | Bell + email per preferences |

**Who:** A Firmivra team member with the Super Admin role

**Goal:** Let good businesses in fast, keep the platform healthy, never touch client data without permission

**Starts at:** admin.firmivra.com

**Ends at:** Approved business live, audit trail complete

| Stage | Does | Screen | System | Notified |
| --- | --- | --- | --- | --- |
| 1. Sign in | Signs in with password and authenticator code | Admin login + MFA | Separate Cognito pool; optional IP allow-list | Login logged to platform audit |
| 2. Overview | Scans pending applications, active firms, total users, monthly revenue, tasks, system status | Super Admin dashboard | Metadata only, no client data | None |
| 3. Review | Opens an application, reads details and checks (duplicate name, email domain, verified phone) | Firm Applications → detail | Shows check results and history | None |
| 4a. Approve | Clicks Approve | Review → Approve | One transaction: tenant, slug, KMS key, roles, Owner membership, modules; pending\_setup | Owner: approved email |
| 4b. Reject | Requests information, or declines with a reason; keeps internal notes only Firmivra sees | Request Information / Decline | Application rejected ; nothing provisioned | Owner: rejection with reason |
| 5. Monitor | Watches firms (Active, Pending Setup, Inactive); toggles beta features; can Add Firm Manually | Firms → detail | Per-tenant counts and quotas | Alerts on abuse or quota |
| 6. Suspend | Suspends a business for non-payment or abuse; can reactivate | Business detail → Suspend | All logins for that tenant blocked; data kept | Owner: suspension notice |
| 7. Support | Clicks Open Firm Workspace to help a firm with a problem | Firm detail → Open Firm Workspace | Grant waits for Owner approval; expires automatically | Owner: access request to approve |
| 8. Audit | Reviews who did what across the platform | Platform audit log | Append-only; daily archive to S3 Object Lock | None |

**Who:** A preparer or assistant at LVP with the Staff role

**Goal:** Move each assigned client's engagement from intake to complete

**Starts at:** Invitation email, then app.firmivra.com → Sign In for the First Time

**Ends at:** Engagement marked Complete, client notified

| Stage | Does | Screen | System | Notified |
| --- | --- | --- | --- | --- |
| 1. Join | Opens invite link, sets password, sets up MFA | /activate | Membership in LVP with Staff role | Owner: staff joined |
| 2. Sign in | Signs in; picks LVP if they work for several businesses | Login + MFA, business picker | Session bound to one tenant; staff land on /dashboard | None |
| 3. Queues | Sees only assigned clients in New, Missing documents, Preparation, Review… | Dashboard queues | Filtered by assigned\_user\_id | None |
| 4. Client record | Opens a client; reads intake, documents, messages | Client record tabs | Full SSN hidden; reveal needs re-MFA if role allows | Reveal logged |
| 5. Request | Requests a missing W-2 with a due date | Document requests | Request requested | Client: bell + email (no content) |
| 6. Review | Accepts or marks the upload missing; adds an internal note | Engagement detail | Scan must be clean before preview | Client: request accepted |
| 7. Advance | Moves the engagement to Review, then Signature | Status tracker | Status history row; audit event | Client: status changed |
| 8. Sign & bill | Sends Form 8879 and 7216 consent, creates the invoice (if role allows) | Signatures, Invoices | Provider envelope; invoice due | Client: signature and invoice |
| 9. Complete | After e-file is accepted, uploads the final return and closes | Tax returns | Engagement complete ; uploads close | Client: return ready |

**Who:** An LVP personal tax client (business clients follow the same path with the Business intake and tab)

**Goal:** Get the 2025 return filed without emailing documents

**Starts at:** LVP's website: Begin Online (new client) or Client Portal → portal.firmivra.com/lvp-accounting

**Ends at:** Final return downloaded

| Stage | Does | Screen | System | Notified |
| --- | --- | --- | --- | --- |
| 1. Arrive | Lands on LVP-branded page, clicks Create an account | Sign-in landing | Slug lvp-accounting → tenant LVP, theme loaded | None |
| 2. Sign up | Full name, email, phone, password, account type Individual, consent | Client sign-up | Client account in tenant LVP only | Email and SMS codes |
| 3. Verify | Enters both codes | Verify email & phone | MFA enrolled; account pending until LVP approves | LVP: new sign-up to approve |
| 4. Approved | LVP staff approve the sign-up; client gets an access email and signs in with MFA | Account created, Login + MFA | Linked to a client record; engagement 2025 Personal Tax opened | Client: welcome |
| 5. Dashboard | Sees Action required: complete intake | Client dashboard | Action list from open items | None |
| 6. Intake | Fills the 4-step Annual Tax intake; uploads ID and W-2s or marks "I don't have this"; picks how to pay; signs | Intake Forms → Personal Tax | Auto-save; submit locks version 1 | LVP: intake submitted |
| 7. Requests | Uploads the missing 1099 from Your Next Steps; the upload pop-up asks which service it is for | Upload pop-up, My Documents | No active service = STOP; else quarantine → scan → vault | LVP: document received |
| 8. Sign & pay | Signs 8879 and 7216 consent; pays invoice | Signature center, Invoices | Paid only after verified webhook | Receipt email |
| 9. Track | Watches the return move to Awaiting Signature, then Filed | Tax Returns tab | Reads status history | Each status change |
| 10. Download | Downloads the final return after re-MFA | Tax returns | 5-minute signed link; download logged | None |

Client-facing return statuses from Octavia's Tax Returns doc (each firm can configure its own). Payment is tracked on the invoice and never changes the filing status:

1. In Preparation
2. Ready for Review
3. Awaiting Signature
4. Filed / Completed

**Who:** The client's spouse, or an authorized bookkeeper

**Goal:** Help with the joint return without sharing the primary client's login

**Starts at:** Invitation sent by the primary client

**Ends at:** Their own part signed and uploaded

| Stage | Does | Screen | System | Notified |
| --- | --- | --- | --- | --- |
| 1. Invited | Primary client adds spouse and picks what they may see and do | My profile → Members | client\_members row, relation spouse | Spouse: invite email, 72 h link |
| 2. Join | Sets password, verifies email and phone | Accept invite, Verify | Separate login and MFA; no shared accounts | Primary client: member joined |
| 3. Dashboard | Sees only the sections allowed | Client dashboard | Permissions from client\_members | None |
| 4. Contribute | Uploads own W-2, fills spouse section if allowed | Documents, Intake | Full SSN never shown to members | LVP: upload received |
| 5. Sign | Signs their own line on Form 8879 | Signature center | Each signer authenticated separately | Primary and LVP: signed |
| 6. Removed | Primary client or LVP removes access when needed | Members | Tokens revoked at once | Member: access removed |

## Sign-up flows

### A business joins Firmivra

*Diagram: business onboarding (lanes: Owner, Firmivra, Super Admin)*

1. Owner: sign up (business + owner).
2. Owner: verify (email + SMS code).
3. Firmivra: application created (`pending_review`).
4. Super Admin: review (approve, request info, decline).
5. On approve, Firmivra provisions the business (tenant, key, roles) and emails the owner.
6. Owner: first login + setup wizard, then invites the team and clients.

On decline, the owner is emailed with the reason.

### A client joins a business

Clients only ever join one specific business. The business picks which doors are open in portal settings: invite only, public sign-up with approval, or public sign-up with auto-approve. Octavia's guide says clients join only through their firm, while her portal mockups show public sign-up (name, email, phone, password, Individual or Business, then email and SMS codes). **Decided 4 Oct:** clients sign up themselves on the firm's portal and the firm approves each account before it opens. Staff can still invite a client directly; the auto-approve option stays off.

*Diagram: client sign-up*

- Two ways in: **staff invite** (email link, valid 72 hours) or **public sign-up** (`/lvp-accounting/signup`).
- Both: set a password, verify email + phone (MFA enrolled).
- Approval needed?
  - No (invited, or auto-approve on) → portal access.
  - Yes → staff approve and link a client record → portal access (account active).

### A new client starts online (Begin Online)

Octavia's 26 Begin Online mockups sit on the firm's public website, before any login. A visitor picks one of six services, fills a multi-step form, signs the service agreement and submits. No account is created; the firm reviews first and invites the client to the portal after.

*Diagram: Begin Online*

- Visitor, no login:
  1. Pick a service (6 cards on the firm's site).
  2. Fill the form (3–4 steps, save for later).
  3. Upload (or "I don't have this").
  4. Review and sign (agreement, consents).
  5. Submit (confirmation email).
- Firm:
  6. Pending lead + engagement in the firm's review queue.
  7. Staff review (match or create the client).
  8. Portal invite (files carried over).

| Service | Steps | Notable |
| --- | --- | --- |
| Annual Tax (tax preparation) | 4 | Filing status, spouse, dependents, business income; asks how to pay: from refund, pay now (10% off) or after preparation |
| Quarterly Tax | 4 | Q1–Q4 grids for income, expenses and estimated payments that total automatically |
| Bookkeeping | 4 | Starter, Growth or Premium package (no prices shown); system access noted without passwords |
| Payroll | 3 | Employees, pay schedule, state accounts; full service agreement |
| Tax Planning | 4 | Goals and income picture; no uploads |
| Business Development | 4 | Stage, goals and support wanted; ends on the general success page |

This needs a form engine, not six hard-coded forms: versioned form definitions per firm and service, repeating groups (dependents, owners, states), conditional questions, quarterly grids, upload slots with "I don't have this" and a reason, and a signature record with agreement version, IP and time.

**Same person, two businesses.** If one person is a client of both Business 1 and Business 2, they get two separate portal accounts, one per business, exactly as the sketch draws it. Staff are different: one staff identity can hold memberships in several businesses and picks one after sign-in.

## Status lifecycles

Every account moves through a small set of states. Only the listed actor can move it.

*Diagram: account states*

- Business: `pending_review` → approve → `active`; `pending_review` → decline → `declined`; `active` → suspend → `suspended` → reactivate → `active`; `active` → Owner closes → `closed`.
- Client account: `invited / pending` → approved → `active` → deactivate → `deactivated`.
- Records stay for retention (tax 7 years) even after deactivation or closing.

| Octavia's label | State here | Meaning |
| --- | --- | --- |
| Pending Review | pending\_review | Application submitted; Super Admin may approve, request information or decline |
| Pending Setup | pending\_setup | Approved and provisioned; Owner has not finished the setup wizard |
| Active | active | Wizard finished; workspace and portal live |
| Inactive | suspended | Deactivated by Super Admin; logins blocked, data kept |

**Two kinds of client cancellation.** Cancelling the portal account (My Profile) only ends the login; records stay. Cancelling a recurring service is a request by email or portal message at least 14 days before the next billing date. After a service is cancelled the client keeps document access for 60 days and can reactivate within 90 days. These texts are set centrally and shown on the invoices page.

## Data model

The original LVP draft centred everything on the **engagement**: one service for one period for one client. That stays. Every table on the right gains `tenant_id` and a row-level security policy.

*Diagram: core entities*

- Platform tables: `tenants` (id, slug, status, kms_key_id, pack, plan), `users` (staff identity, Cognito sub), `tenant_applications` (sign-up queue), `platform_users`, `grants` (Firmivra team, support access).
- Tenant-scoped tables (`tenant_id` + RLS): `memberships` (user + role per business), `roles` (permission keys), `tenant_settings` (branding, modules, sign-up), `audit_events` (append-only), `clients` (individual / business; ssn_enc, custom_fields), `client_users`, `members` (portal logins: primary, spouse, authorized), `appointments`, `notes` (tasks, per client), `engagements` (service, period, status, assigned_user_id).
- Belongs to an engagement: `documents` (vault, scan, retention), `document_requests`, `intake_submissions` (versioned), `signature_requests` (never deleted), `invoices` → `payments`, `message_threads` → `messages`, `engagement_status_history`, `client_businesses` (tax pack).

Dots mark the "many" end. Authorization is always the same two questions: does this row's business match the session, and is this user allowed to see this client.

| Table | Scope | Key fields | Rule |
| --- | --- | --- | --- |
| tenants | platform | id, display\_name, legal\_name, business\_type, status, slug, custom\_domain, kms\_key\_id, pack | One per business |
| users | platform | id, cognito\_sub, email, phone, full\_name, status | No password stored; Cognito holds it |
| clients | tenant | tenant\_id, account\_type, state, address, dob\_enc, ssn\_enc, ssn\_last4, custom\_fields | `_enc` uses the business's key |
| engagements | tenant | tenant\_id, client\_id, service, period, status, assigned\_user\_id | Uploads only while open |
| documents | tenant | tenant\_id, engagement\_id, s3\_key, sha256, category, tax\_year, direction, scan\_status, retention\_until, legal\_hold | Download only after clean scan |
| intake\_submissions | tenant | tenant\_id, engagement\_id, form\_type, form\_version, answers (JSONB), state, version | New row on every change |
| invoices, payments | tenant | tenant\_id, amount\_cents, status, processor\_ref; processor\_event\_id unique | Paid only by verified webhook |
| audit\_events | both | tenant\_id (null = platform), actor, action, target, ip, at | UPDATE and DELETE denied |

## Modules & packs

Octavia's docs and the LVP draft are written for tax and accounting firms. Rasel's direction is any business. A shared core with switchable modules and industry packs serves both.

Industry packs

- Tax & Accounting: tax returns, Begin Online and seven intake forms (personal, business, quarterly, planning, bookkeeping, payroll, advisory), 8879 + 7216, resource library, Tax Return Calculator, Bookkeeping and Tax Planning workspaces
- After beta: Payroll operations, Advisory workspace
- Later: clinics, legal, agencies…

General modules

- Intake form engine (public and in-portal)
- Appointments & calendar
- Notification Center
- Service workspaces
- Calculators
- Invoices & payments
- E-signature
- Tasks
- Reports
- Content editor

Core (everyone)

- Tenancy
- Accounts & MFA
- Roles
- Clients & engagements
- Client portal
- Documents
- Messages
- Notifications
- Audit
- Branding

The business type picked at sign-up sets the starter modules and the words in the UI ("client" or "patient", "firm" or "business", "engagement" or "case"). Custom fields per business cover small differences without new code.

## Tech stack

Taken from the original LVP draft, with the multi-business changes noted on each.

Frontend

**Next.js, React, TypeScript, Tailwind**

React Hook Form + Zod for intakes. Middleware reads the host to load each business's theme and modules.

API

**NestJS + Prisma**

Auth, tenant and permission guards on every route. A Prisma extension runs each request in a transaction with `SET LOCAL app.tenant_id`.

Auth

**Amazon Cognito**

Three pools: platform admins, business staff, clients. Custom claims carry tenant and role. MFA everywhere.

Database

**RDS PostgreSQL, Multi-AZ**

Row-level security on every tenant table. Intake answers in JSONB. App role has no BYPASSRLS.

Files

**S3 + KMS**

Quarantine, vault and audit buckets; Block Public Access; `tenant/<id>/` prefixes; key per business.

Jobs

**SQS, Lambda, EventBridge**

Malware scan, reminders, retention. Every message carries `tenant_id`.

Messaging

**Amazon SES and SNS**

Sender name per business. Emails never carry SSNs, amounts or document content.

Payments & e-sign

**Stripe; DocuSign or Dropbox Sign**

Stripe decided 4 Oct, with hosted checkout; Stripe Connect so each business is paid into its own account (to confirm).

Ops

**Terraform or CDK, GitHub Actions**

OIDC deploys, staging and production, WAF, CloudTrail, GuardDuty, Security Hub, Secrets Manager.

## Security & privacy

The LVP draft's security bar becomes the platform bar, with tenant isolation on top of client isolation.

| Area | Requirement |
| --- | --- |
| Tenant isolation | Business A can never reach Business B's data by any path, proven by automated cross-tenant tests on every route |
| Client isolation | Client ID always from the token; Client A never sees Client B inside one business |
| MFA | Everyone. Super Admin, Owner and Admin must use an authenticator app. Trusted device 30 days for clients |
| Sessions | Inactivity warning at 15 minutes, logout at 20; lock after 5 failed logins; Log out revokes all tokens |
| Encryption | TLS 1.2+ with HSTS; KMS on RDS, S3, backups; SSN, ITIN, EIN, bank numbers encrypted per business; re-MFA to reveal |
| Uploads | Magic-byte check, 10 MB limit, quarantine bucket, malware scan, UUID file names, 5-minute signed downloads |
| Web | OWASP Top 10; Secure, HttpOnly, SameSite=Strict cookies; CSP, X-Frame-Options DENY |
| Logging | No passwords, tokens, full SSNs, card data or document content in logs; append-only audit; CloudTrail |
| Privacy | No trackers or session replay on signed-in pages; synthetic data only in dev and staging; no production data in AI tools |
| Retention | Tax 7 years, payroll at least 4, formation permanent; legal hold; per-business export and close |
| Abuse | Rate limits on sign-up, login and codes; per-business quotas so one business cannot slow the others |
| Reliability | 95% of requests under 500 ms; 99.5% uptime; no planned maintenance Jan 15 to Apr 15; 35-day point-in-time recovery; quarterly restore test |

**Tax data rules.** Tax businesses fall under the FTC Safeguards Rule, IRS Pub 4557 (WISP) and Section 7216 consent. The core must keep consent records, security logs and breach handling so the tax pack can comply. FTC notice is due within 30 days if unencrypted data of 500 or more clients is exposed.

## Build phases

Order follows Rasel's plan: foundations first, then Super Admin, role-based access, and the public client portal. Each phase ends with a gate that must pass before the next starts.

Phase 0
Foundations

#### Tenancy, auth and the four walls

- Repo, AWS staging via IaC, CI/CD with OIDC
- Next.js and NestJS skeletons, Prisma schema with `tenant_id` and RLS
- Cognito pools, MFA, sessions bound to one business
- Permission engine and default roles
- S3 buckets, per-tenant prefixes and KMS keys
- Audit log, SES and SMS, monitoring

**Gate:** automated tests prove Business 1 cannot read any Business 2 row or file through any route.

Phase 1
Super Admin

#### Business application and a minimal Super Admin

- Workspace landing, Create a Business Account, verification
- Admin login, dashboard, Firm Applications: approve, request info, decline
- Approve provisions the tenant end to end; Add Firm Manually
- Firms list, feature toggles, deactivate; other tabs as Soon shells

**Gate:** a new business signs up, is approved, and its Owner signs in.

Phase 2
Workspace

#### Business workspace and role-based access

- Setup wizard, dashboard and queues
- Clients, client record, engagements
- Team invites, default and custom roles
- Branding, portal settings, business audit log

**Gate:** Staff see only assigned clients and Viewers change nothing, checked server-side.

Phase 3
Client portal

#### Public client portal

- Branded portal at `portal.firmivra.com/{firm}`, custom domain optional
- Client self sign-up (email and SMS codes), firm approval queue; sign-in, forgot and reset password
- My Services, Notification Center, LVP Terms and Privacy links
- Home with six folder tabs, upload gate, Next Steps, messages and private notes, profile with locked name/DOB, cancel portal account

**Gate:** a client signs up, is approved, uploads a file, and staff see the same record.

Phase 4
Modules

#### General modules

- Intake form engine with versioned forms, Begin Online public intake
- Full appointments: firm calendar, staff availability and blocked time, client booking, no double booking, reminders, reschedule and cancel
- Invoices and payments, e-signature
- Two-way notifications, bulk actions with per-client results

**Gate:** webhooks reject forged events and process duplicates once; Octavia's action-to-record map passes.

Phase 5
Tax pack

#### Tax & Accounting pack, LVP beta, go-live

- Six Begin Online flows and seven portal intake forms; Tax Returns tab; resource library as data
- Working calculators, Tax Return Calculator first
- Service workspaces for Bookkeeping and Tax Planning
- LVP onboarded as the first business
- Security testing, production deploy, handover

**Gate:** Octavia's 20 beta checks and the draft's go-live criteria all pass.

**Beta scope, decided 4 Oct.** The LVP beta stays on 8 January 2027 and includes every item on Octavia's missing-requirements list except three, which ship right after: payroll operations (payroll runs, filings, W-2/1099, provider integration; provider chosen later), the Business Advisory workspace, and Google/Outlook calendar sync.

**Octavia's priority.** Her Super Admin scope says the primary focus is the firm workspace and client portal; Super Admin only needs the application → approve → activate path in Phase 1. Phase 1 above is kept that small so Phases 2 and 3 start early.

**Timeline and budget.** The original draft promised the single-firm portal in 7 days for $400. This platform is several times that scope, so each phase needs its own estimate once the open questions are answered.

## What Octavia's Drive pages add

The four Drive folders hold a platform guide, Super Admin scope, 7 portal instruction docs and 49 mockups. This is what they settle.

| Area | What the pages say |
| --- | --- |
| Three apps | `admin.firmivra.com` for Super Admin (separate login, no public sign-up), `app.firmivra.com` for firms, `portal.firmivra.com/{firm}` for clients. Firmivra's own screens stay navy, blue and teal; firm colours only on client pages. |
| Super Admin, Phase 1 | Minimal shell. Dashboard cards (pending applications, active firms, users, revenue), Firm Applications with Approve / Request Information / Decline and internal notes, Firms with Active / Pending Setup / Inactive and beta feature toggles. Ten other tabs marked Soon. |
| Firm workspace | Three-card landing (Welcome Back, Create a Business Account, Sign In for the First Time). Admins land on /admin/dashboard, staff on /dashboard. Staff are always invited. Five-step setup wizard shown once. |
| Client portal | Sidebar (Home, My Documents, Intake Forms, Messages, Appointments, Invoices & Payments, My Services, My Profile) and six folder tabs on Home. Next Steps and Business Action Items are built from open records, never typed by staff. |
| Upload gate | Every upload asks what it is for. With no active service the answer is STOP; the portal is not storage. Checked on the server, not just in the pop-up. |
| Portal extras | Private client notes with reminders, locked name and date of birth with a Request Name Change flow, Cancel portal account separate from cancelling services, invoice states Pending / Due Soon / Paid / Upcoming / Canceled, a resource library stored as data with safe external links. |
| Begin Online | Public intake for six services on the firm's website, ending in a signed agreement. Creates a lead for review, not an account. |
| Still missing | No designs yet for Appointments, My Services, My Settings, the notification centre, the avatar menu, or the portal sign-in and password reset screens. Octavia's missing-requirements list (4 Oct) makes all of these required, plus working calculators, each firm's own Terms and Privacy links, and service workspaces. |

**Fix in the mockups before build.** Brand spelled FirmVora and FirmVRA; sidebar and tab names change between screens; four different footers; LVP's address shows as 1393 and 1993 Duncan Lane; payroll records kept 4 or 7 years; a 555 phone number; Begin Online step counts that disagree; typos such as "yax", "Rusiness", "Expensss" and "TOMGROW".

## Where this differs from Octavia's docs

| Topic | Octavia's checklist and LVP draft | This design |
| --- | --- | --- |
| Product | Draft: a custom portal owned by LVP. Checklist: SaaS for tax and accounting firms | Multi-business platform for any business; LVP is the first business |
| Hosting | LVP's own AWS account and GitHub, LVP holds root | Decided: one Firmivra AWS account in us-east-1 for all firms; each business controls its data through isolation, its own key and support grants |
| Address | Draft: portal.lvpaccounting.com. Guide: admin., app. and portal.firmivra.com/{firm} | Same as the guide; custom domain as an option |
| Naming | Firm, Firm Admin, Owner/Admin | Business, Owner, Admin, Staff; the tax pack can still say Firm |
| Backend roles | Owner/Admin only; Preparer and others disabled | Owner, Admin, Staff, Viewer and custom roles per business |
| Client sign-up | Guide: clients join only through their firm. Portal mockups: public sign-up for current and prospective clients. Begin Online: intake with no account | Decided: self sign-up on the firm portal, then firm approval; staff may also invite. Begin Online creates a lead, not a login |
| Super Admin access | "Open Firm Workspace" button on each firm | Opens only through an Owner-approved, time-limited, logged support grant |
| Return tracker | Draft: 10 stages incl. Payment. Portal doc: 4 example statuses, payment kept separate | Follows the portal doc; statuses configurable per firm |
| Portal sections | Fixed list incl. Tax Returns, Business tab, working calculators | Built from enabled modules; tax sections come from the tax pack |
| Build order | Checklist: payments, calendar, intake first. Draft: auth, portal core, features in 7 days | Foundations and isolation, Super Admin, workspace, portal, then modules and the tax pack |
| Same as the docs | Super Admin approval before a business goes live, the 5-step setup wizard, invited staff, locked legal name, upload only with an active service, the tech stack, engagement-based data model, server-side access checks, one canonical record set, signed URLs and malware scan, webhook rules, retention and audit rules | |

## Decisions and open questions

### Decided by Rasel, 4 Oct 2026

| Question | Decision |
| --- | --- |
| Beta scope | Beta stays on 8 Jan 2027 with all missing requirements except payroll operations, Advisory and calendar sync, which ship right after |
| AWS region | us-east-1 (N. Virginia) |
| AWS account | One Firmivra account for all firms, isolated per firm; no separate LVP account |
| Client sign-up | Self sign-up on the firm portal, then the firm approves |
| Super Admin access | Only with the firm Owner's time-limited, logged approval |
| Payments | Stripe |
| Payroll provider | Chosen after beta |
| Email and SMS | Amazon SES and SNS |

### Still open

Is Firmivra still Octavia's product, now widened, or a separate platform of ours?
:   This decides the brand owner and the legal entity in the Terms.

Will Octavia send LVP's final Terms of Service and Privacy Policy?
:   The portal must link LVP's own documents at sign-up, login and in the footer; Firmivra's documents do not replace them.

Which calculators are approved, and with what formulas and tax year?
:   Needed before the Tax Return Calculator can be built.

Stripe Connect, or one Stripe account per firm?
:   The design assumes Connect so each firm is paid into its own account.

Which e-signature vendor, and which video tool for appointments?
:   DocuSign or Dropbox Sign; Zoom or a plain meeting link.

How do businesses pay Firmivra?
:   Plans, trial length and limits per plan.

Which business types come right after tax and accounting?
:   This shapes the next general modules and the wording.

How many businesses and clients in the first year?
:   The LVP draft planned for under 5,000 clients for one firm.

Brand spelling: Firmivra, FirmVora or FirmVRA?
:   All three appear in Octavia's files; this page uses Firmivra.

Firmivra platform design · draft 4 · 4 October 2026 · prepared for Rasel Mridha
