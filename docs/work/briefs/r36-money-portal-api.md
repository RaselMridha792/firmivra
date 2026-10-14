# R36 money and portal: brief for the API session

Written by the R36 database session (Oct 14). The tables, rules and tests for Invoices and Payments, Services and Pricing, Messages, the Client portal tab and Settings (Company Profile and Branding) are done (PR #558, one PR for the whole chain). There is no new API and no new screen. Each rule is in `packages/db/README.md` (search "R36"); the models are in the marked R36 section at the end of `schema.prisma`.

All firm paths are under `/api/v1/business/...`, portal paths under `/api/v1/portal/{slug}/me/...`. Every write goes through `TenantPrisma`, `AuditService.log` and a zod schema in `packages/types`. Stripe is the only payment provider (PayPal and Square in the designs are not built).

## Roles and the R35 permission grid

Routes name the grid module with `@Access(...)` (see `docs/work/briefs/r35-staff-roles-api.md`). The method sets the capability (`capabilityOfMethod`): GET is VIEW, POST is CREATE, PUT and PATCH are EDIT, DELETE is DELETE. Configuration, destructive money actions and sending to many people need MANAGE; exports need EXPORT. Owner and Admin have everything; the default grid for the others:

| Module (`PermissionModule`) | Staff | Manager | Bookkeeper | Tax Preparer | Client Support | Read Only |
| --- | --- | --- | --- | --- | --- | --- |
| `INVOICES_PAYMENTS` | view, create, edit | view | view | view | none | none |
| `SERVICES_PRICING` | none | view | none | view | none | none |
| `MESSAGES` | view, create, edit | view, create, edit | view | view | view, create, edit | none |
| `CLIENT_PORTAL` | none | view | none | view | view | none |
| `SETTINGS` | none | none | none | none | none | none |

Staff has no `SERVICES_PRICING`, `CLIENT_PORTAL` or `SETTINGS` in the default grid. A firm may open them per role or per member (`role_permissions`, `member_permissions`); the API applies those over the defaults. The contract for Services (below) says "everyone with view reads", which already follows the grid.

Shorthand in the tables below: **VIEW / CREATE / EDIT / DELETE / MANAGE / EXPORT** are grid capabilities in the route's module. **System** is a job with no user.

## Invoices and Payments (`INVOICES_PAYMENTS`)

Already there: `GET/POST /business/invoices`, `GET/PUT /business/invoices/:id`, `POST :id/send`, `POST :id/cancel` (this is Void), `POST :id/payments/:paymentId/refunds`, `POST :id/offline-payments` and `POST :id/offline-payments/:offlinePaymentId/void`, `GET/POST /business/payments/setup`, portal `GET /me/invoices(/:id)` and `POST /me/invoices/:id/checkout`. The invoice number stays `INV-{year}-{n}`; the prefix in Payment Settings is a decision for Rasel. Offline payments now also take ACH, CARD and OTHER (`OfflineMethod` in `packages/types/src/payments/schemas.ts` is widened), a deposit account and a receipt flag.

| Method, path | What | Capability |
| --- | --- | --- |
| GET `/invoices/summary` | KPI cards (outstanding, paid this month, overdue, due soon by `payment_settings.due_soon_days`, collected, % vs last month) and the three charts | VIEW |
| GET `/invoices` (extend) | tabs Viewed (`invoice_tracking`), Partially Paid, Due Soon, Overdue, Voided (= CANCELED), Refunded, Archived; filters service, assigned, method, date | VIEW |
| PUT `/invoices/:id` (extend) | notes, internal note, template, options, payment methods, AutoPay, terms, tax rate, discount type, line service and tax | EDIT |
| POST `/invoices/:id/duplicate` | new draft copy | CREATE |
| GET `/invoices/:id/pdf` | secure PDF | VIEW |
| POST `/invoices/:id/remind`, `/remind-overdue`, `/receipt` | reminder or receipt through NotifyService; updates `invoice_tracking`, writes `invoice_events` | EDIT |
| POST `/invoices/:id/mark-paid` | records an offline payment of the balance with a note (the database needs money to mark PAID) | MANAGE |
| GET `/invoices/:id/payments` | Stripe, offline and refunds together | VIEW |
| GET/POST `/invoices/:id/events` | timeline, Add Note, Log Activity | VIEW / EDIT |
| POST/DELETE `/invoices/:id/archive` | `invoice_tracking.archived_at` | MANAGE |
| POST/DELETE `/invoices/:id/attachments` | `invoice_attachments`, presigned upload under the firm's prefix | EDIT |
| GET `/payments` | payment ledger (Stripe and offline) | VIEW |
| GET `/clients/:id/statement` | statement for a date range (computed); the PDF or export needs EXPORT | VIEW / EXPORT |
| CRUD `/invoice-templates`, `/invoice-tax-rates`, `/deposit-accounts` | archive and set default; never deleted | VIEW read, MANAGE write |
| GET/PUT `/payment-settings`, POST `/payment-settings/reset` | `payment_settings`; gateway status from `stripe_accounts` | MANAGE |
| GET/POST/PATCH `/recurring-invoices` (+ lines), GET `/recurring-invoices/summary` and `/upcoming` | schedules, cards (active, upcoming 30 days, MRR, paused) | VIEW read, MANAGE write |
| POST `/recurring-invoices/:id/pause`, `/resume`, `/send-now`, `/duplicate`, `/end`; GET `:id/invoices` | schedule actions | MANAGE |
| System job | makes one invoice per schedule and period (`recurring_period_on`) and retries AutoPay per settings | System |
| GET/POST/DELETE portal `me/payment-methods` | save, default and remove a Stripe method for AutoPay (`client_payment_methods`) | client login |

Open decisions: hard Delete Invoice (the database never deletes), late-fee charge (lines freeze once issued; suggest a separate invoice), tipping through Stripe (`payments.tip_cents`), a tokenized public payment link.

## Services and Pricing (`SERVICES_PRICING`)

No catalog API exists yet. **The contract in `docs/work/briefs/services-pricing-contract.md` (R43) is the API's source of truth** for paths (`/business/catalog/...`), request and response schemas (`packages/types/src/services-pricing/`), error codes and audit rules. Build exactly those routes. Its roles already match the grid (view reads; create, edit and manage change).

### Where the contract and the R36 tables overlap, and which side wins

The contract's "New database work this needs" asked for the tables now in R36. **The contract wins on everything the client sees (paths, schemas, error codes, field names); the R36 tables win on storage (table and column names, constraints, triggers).** The API maps between them. Differences to handle:

| Contract says | R36 database has | What the API does |
| --- | --- | --- |
| `packages`, `package_services`, `package_add_ons` | `service_packages`, `service_package_items`, `service_package_add_ons` | Use the R36 names in Prisma; the contract's names are only prose. |
| `service_categories`, `service_line_items`, `service_add_ons`, `promotions`, `promotion_targets` | same names, plus `service_inclusions` (What's Included and Not Included lists) and `promotion_redemptions` | Use as built. The contract's `included` and `not_included` columns are rows of `service_inclusions`. |
| `PromotionStatus`: DRAFT, SCHEDULED, ACTIVE, EXPIRED, INACTIVE | enum stores DRAFT, ACTIVE, INACTIVE only | Work SCHEDULED (before `starts_at`) and EXPIRED (after `ends_at`) out from the dates, as the schema comment says. The root of `packages/types` exports the contract's `PromotionStatus` and `BillingFrequency`, not the database enum copies. |
| `BillingFrequency` has no semi-monthly | database enum also has `SEMI_MONTHLY` | The database is the wider set; the API never offers it for a service, and accepts only the contract's seven values. |
| "existing `billing_interval` maps to `billing_frequency`" | separate `services.billing_frequency` column; `billing_interval` stays the engagement default | Write both: set `billing_frequency` from the screen, leave `billing_interval` for engagements. A RECURRING service needs a frequency other than one-time (database check). |
| `short_description` column | `services.description` is the short description; `full_description` is separate | Map `shortDescription` to `description`. |
| icon is an approved key | `services.icon_key` (a name, never a URL) | As in the contract. |
| 409 `SAVE_CONFLICT` on a stale `version` | `services` has no `version` column | Compare `updated_at` for now; ask Rasel to add a `version` column if the screens need the number. |
| 409 `DUPLICATE_NAME` unless `allowDuplicateName` | unique `(business_id, name)` | The unique index always refuses; `allowDuplicateName` cannot be honoured without a schema change. Decision for Rasel. |
| invoices snapshot name, description, quantity, rate, amount | `invoice_lines` already keep their own item name, quantity, rate and taxable flag beside `service_id` | Copy from the catalog when a line is made; editing a price never changes issued invoices. |
| `GET .../usage` counts packages, engagements, invoices, appointment types, automations | foreign keys point at `services` from engagements, invoice lines, recurring lines, package items, promotion targets, tasks | Count from those; delete only a never-used service (the database refuses otherwise with a foreign key error, answer 409 `IN_USE`). |

Also from R36: `services.client_visible` and `status` decide what the portal shows (`GET portal/services`, `portal/packages`: active and client-visible only); promotions are redeemed on invoice create (`promotion_redemptions`, one per invoice); `services.updated_by_user_id` is the "Last Updated by" column.

## Messages (`MESSAGES`)

Already there: `business/message-threads` (list, create, get, patch, post message, read, unread, unread-count), `clients/:id/message-threads`, portal `me/messages`, notes endpoints.

**Templates and consents belong to R39**, not R36 (`message_templates` and its versions, shares and favourites; `communication_consents`). The R36 tables only point at them: `outbound_messages.template_id` names an R39 template, and the bulk opt-out wall reads `communication_consents` (see the next section). Build template and consent routes from `docs/work/briefs/r39-comms-payroll-advisory-api.md`.

| Method, path | What | Capability |
| --- | --- | --- |
| GET `/message-threads` (extend) | tabs, assigned, archived, tags, mute state | VIEW |
| PATCH `/message-threads/:id` | assign (an active member of the firm), archive and restore | EDIT |
| PUT/DELETE `/message-threads/:id/mute`; POST/DELETE `/message-threads/:id/tags` | mute (1 hour, 1 day, until unmuted), tags | EDIT |
| GET/PUT `/message-settings`, PUT `/message-signature` | settings (one row per firm), own signature | MANAGE / EDIT |
| POST/PATCH `/outbound-messages`; POST `:id/send`, `/schedule`, `/cancel`; GET list | compose, draft, schedule, send; PORTAL delivery makes a conversation message | CREATE / EDIT |
| POST `/outbound-messages/audience-preview` | filters to Total, Can Receive, Cannot Receive with reasons | MANAGE (bulk) |
| POST `/outbound-messages/:id/confirm-high-volume`, `/retry` | confirmation above `bulk_confirm_threshold`; retry failed recipients only | MANAGE |
| GET `/outbound-messages/:id/recipients` (+ export) | outcomes; the export is EXPORT | VIEW / EXPORT |
| POST/DELETE `/outbound-messages/:id/files` | presigned upload under `tenant/{id}/messages/` | EDIT |
| System job | sends queued recipients, throttles, applies quiet hours and settings | System |

Database walls to respect: a bulk recipient on email or SMS is refused when the contact has a `communication_consents` row for that channel whose status is anything but `OPTED_IN` (opted out, bounced, invalid, complained); a contact with no row is not refused by the database, so the API decides whether no consent means no send. The API records such a contact as `SKIPPED` with exclusion `SUPPRESSED` instead of queuing it. A recipient is never sent twice (status path trigger). Open: replies from leads (threads are client-only); audience filters on tags and custom fields depend on the clients module's tag model.

## Client portal tab (`CLIENT_PORTAL`)

Reuses clients, documents, intake, messages, appointments, tax returns, invoices, tasks, notes and invites. Staff default has no `CLIENT_PORTAL`; Manager and Tax Preparer view, Client Support views.

| Method, path | What | Capability |
| --- | --- | --- |
| GET `/client-portal/clients` | switcher list, status and service filters | VIEW |
| GET/PUT `/client-portal/recent` | `portal_recent_clients` | VIEW |
| GET `/client-portal/clients/:id` | header, status (account status, lock, invite), last login from `client_portal_activity`, summary cards | VIEW |
| GET/PUT `/client-portal/clients/:id/visibility` (+ firm default) | `portal_module_visibility` | VIEW / MANAGE |
| POST `/client-portal/clients/:id/lock`, DELETE `/lock`; `/deactivate`, `/reactivate`, `/resend-invitation`, `/reset-access` | access actions, audited | MANAGE |
| GET `/client-portal/clients/:id/activity` | feed (the address only for MANAGE) | VIEW |
| POST `/client-portal/clients/:id/open` | staff preview, audited | MANAGE |
| System | the sign-in guards must refuse a locked client (`client_portal_locks`) and the portal API must honour visibility | System |

Needs from the documents group: Pending Review, Share to Portal and Remove from Portal (documents are fixed after insert and have no review state).

## Settings: Company Profile and Branding (`SETTINGS`)

Already there: `GET/PATCH /business/settings`, the `/business/logo` upload flow. `SETTINGS` is a sensitive module: Owner and Admin only unless the firm opens it.

| Method, path | What | Capability |
| --- | --- | --- |
| GET/PATCH `/business/settings` (extend) | profile, colours, theme, sidebar, login page, locale, currency (contrast checked in the API) | VIEW / EDIT |
| POST `/business/brand-assets/uploads`, `/confirm`, DELETE | favicon, login background, email and portal logo under the firm's prefix | MANAGE |
| GET/PUT `/business/brand-profile` | email, portal and document branding | VIEW / EDIT |
| POST `/business/branding/preview`; POST `/business/branding/publish` (writes a `business_brand_versions` row, bumps `branding_version`, optimistic check); POST `/business/branding/reset` | live preview with unsaved values, publish, reset | MANAGE |
| GET `portal/{slug}/info` (extend) | portal logo, colours, welcome, login message | public |

## Not built, by design

PayPal and Square; hard delete of invoices; template and consent tables in R36 (R39 owns them); any API or screen.
