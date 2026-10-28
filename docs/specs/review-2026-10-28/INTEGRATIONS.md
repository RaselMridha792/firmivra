# Octavia's review of Integrations (Oct 28): change list

Source: "Integrations Developer Feedback", Review Two preparation, Firmivra DEV, LVP, Owner role, 28 Oct 2026. 29 safe UI cases: 24 pass, 4 fail (3 defects), 1 pending. Report codes are kept in every item: I-F (defect), I-UA (user addition), P (pending requirement), I-R (optional recommendation), I-T (test), IN-nnn (original guide item, 111 in total).

## Summary

1. RED: 4 (I-F02, I-F03, I-F04 defects; I-UA01 Help icons). YELLOW: 25 build/decision items (P01 to P19 and six of seven I-R; I-R05 is not scope), plus the 18-row provider readiness matrix.
2. Priorities: (1) I-F03 "All systems operational" shown with zero connections; (2) I-F02 Cancel/Back loses search, filter, sort and view; (3) I-UA01 Help icons in every area, keyboard and touch accessible; (4) P19 readiness semantics ("18 Ready to connect" vs 16 cards "Not available to connect yet."); (5) I-F04 category names.
3. Database change: none confirmed. Possible only if checks show gaps: provider readiness/registry fields (P19, P04), disconnect retention flag (P10). `IntegrationRequest` already has `status` and `internal_note` (P15). All "no, to check".
4. Roles/permissions: P02 needs server-enforced limits for connect, configure and disconnect. Today `integrations.controller.ts` uses `@Roles(...FIRM_STAFF)` plus `@Access('INTEGRATIONS')`. Default (see IN-Y20): Owner and Admin may change connections; Staff view only. Needs a decision at review.
5. Not asked of Octavia: no provider accounts now. Provider prerequisites are in section 9 for Rasel only.
6. No live action, send, sync or credential entry is part of any item. Sandbox only at gate 4.
7. Items marked "default" are our choice, reversible, shown at review, not asked of her.
8. Most Y items are fixtures and evidence (dummy-secret, connected, failing, seeded events), not UI work.
9. Report gates: 1 developer response, 2 safe fixtures, 3 Review Two retest, 4 authorized sandbox, 5 separate live decision. Build items here cover gates 1 to 3.
10. I-F03 and I-F04 are copy fixes; I-F02 is routing state; I-UA01 (Help icons) is the largest build.

Confirmed (green, keep as is, no work): I-T01 18 cards; I-T02/24 name and function search; I-T03/04 QuickBooks menu and View details with disabled authorization; I-T05/08 Payments filter and case-insensitive search; I-T06/29 sorts; I-T07/09 list view and empty result; I-T10/11 request modal Cancel and Escape; I-T12 to 14 Health, Mapping and Activity empty states; I-T15/16 API/Webhooks and Website Forms render; I-T17/18 Connected (0) and Needs Attention (0); I-T25/26 Payments filter count 18 to 2; I-T27 Microsoft four-step setup and permissions copy; I-T28 request required fields and requester; shell, sidebar, Marketplace categories and catalog (IN-002 to 005, 010, 022, 040, 043 to 047, 058, 104, 106).

Existing code (named only, not audited): firm screens under `apps/web/src/app/firm/(workspace)/integrations/` (`_components/integrations-screen.tsx`, `marketplace/_components/`, `[integrationId]/...`), API in `apps/api/src/integrations/`, request model `IntegrationRequest`.

---

## 1. Overview (`/integrations`, `integrations-screen.tsx`)

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-F01 | I-F03 (Medium), IN-011/019, P09 | Overview status strip and Health modal | With zero connected providers, "Last System Check: Not checked yet" sits beside "All systems operational"; the Health modal repeats "All systems operational 0". | Show "Not checked" / "No connected integrations" until a real check supports success (the string is hard-coded near lines 92 and 163 of `integrations-screen.tsx`). Define where the timestamp and counts come from and show only real values. Retest states: unknown, checked healthy, checked unhealthy (needs fixtures, see IN-Y16). Wording fix only, not a backend health diagnosis. | No, to check. |
| IN-F02 | I-F02 (Medium), I-T19/T20 | Overview to Marketplace to setup and back | A: Overview, search QuickBooks, menu, View details, Cancel lands on `/integrations/marketplace` with blank search and All Categories, not `/integrations` with the QuickBooks filter. B: Marketplace, search "website", Website & Lead Forms setup, browser Back gives blank search, All Categories, 18 cards, Most Popular/Grid. | Keep the return destination and the query, category, tab, sort and view context. Cancel returns to the true origin page and its filters. Browser Back restores the same state (URL search params or the shared origin-Back used elsewhere, per SH1 in the Oct 26 list). No guess at technical cause. Test both same-tab paths. | No. |
| IN-F03 | I-F04 (Low), I-T23 | Overview category tiles and filter | Overview shows "Document & Management", "Crm & Leads", "E & Signature", "Tax & Software", "Payroll & Hr", "Ecommerce", "Custom". Marketplace and request form use the proper names. | One display-name map used by Overview, Marketplace and the request form: Document Management, CRM & Lead Generation, E-Signature, Tax Software, Payroll & HR, E-Commerce, Custom Integrations. Filter keys and behavior unchanged. `categoryLabel` in `marketplace-shared.ts` already exists; reuse it. Retest all filters in all three areas. | No. |
| IN-Y01 | P19, I-F01/I-T21, IN-018, 060 to 079, 092, 107, 111 | Overview "18 Ready to connect", provider cards | 16 of 18 cards say "Not available to connect yet." with disabled actions; two internal setup routes (Website Forms, Custom API) are enabled. QuickBooks reads "Not Connected" and "Connection unavailable" at once. UI cannot tell supported-not-authorized from unavailable. | Define the states and drive the labels from the registry: Listed only, Supported / Not Connected, Unavailable (not yet enabled), Connected, Needs Attention. Rename or recompute "18 Ready to connect" so it counts only providers that can actually be connected now. Align each card's text and button with its state. Provide the full P19 response per provider (section 9). Default: use these five states, count only enabled providers, and show a neutral "Coming soon" for the rest. Not a proven bug. | No, to check (registry fields may already exist in `provider-registry.ts`). |
| IN-Y02 | P05, IN-011, 015 to 017, 046, 091, 093 to 095, 098, 100, 101 | Overview cards, counts, state actions | Only 18 unconnected cards and empty Connected/Needs Attention tabs. Last-sync, direction, mode absent on unconnected cards; filtered counts are not proven server counts. | Fixtures for connected, expired-auth, failed-sync, permission-error, syncing, paused, error. Show last sync/direction/mode, Manage/Sync Now/Test, reasons and recovery; a running sync blocks a duplicate trigger; Paused offers Resume; counts come from persisted state. Confirm final provider logos (initial-letter tiles are not approved art). Default: keep initial-letter tiles until real brand assets are supplied by us, labeled as placeholder in the review notes. | No, to check. |
| IN-Y03 | I-R01 | Overview filter | Optional: readiness filter (Connectable now, Coming soon, Requires admin/configuration), separate from connection status. | Default: build after IN-Y01 fixes the state meanings, as part of the same filter row. | No. |
| IN-Y04 | I-R02 | Overview filters | Optional: Clear all filters, active filter chips, matched count. | Default: adopt (small, helps IN-F02 retest). | No. |

## 2. Help icons (all Integrations areas)

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-F04 | I-UA01 (user-requested, RED) | Every Integrations area | Not an original-guide gap; no contextual help exists. | One shared Help/Info icon component from `packages/ui`. Short copy per area on what it does, inputs, prerequisites and consequences. Hover text plus keyboard focus and tap/click access, descriptive accessible label (Esc closes, not hover-only). Areas: summary/status/readiness; search and filter controls; Live/Test; provider cards; authorization/setup; scopes/permissions; sync and test-sync effects; mappings; health and logs; requests and admin lifecycle; custom API/webhooks. State real-send and security effects before the action. Static help needs no account; connected-only areas use fixtures. Retest with pointer, keyboard and touch. | No. |

## 3. Marketplace (`/integrations/marketplace`) and request modal

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-Y05 | I-R03 | Request modal Cancel | Cancel retained the draft on reopening (observed behavior, not data loss). | Default: adopt. Cancel/close asks Keep draft or Discard; Escape keeps the draft. | No. |
| IN-Y06 | I-R04 | Marketplace featured row | Payments category leaves unrelated featured cards while search filters them. | Default: featured cards follow the category filter (same as search). | No. |
| IN-Y07 | P14, IN-049, 056, 105 | Request modal Submit | Fields pass (required name and connection, optional website/reason, requester auto-filled). Submit was not pressed; destination and notification effects undisclosed. | Prove Submit stores an `IntegrationRequest` (read it back) and shows a confirmation, with no external email or SMS. State side effects in the modal. Provide a disposable DEV create/read fixture with notifications suppressed. Default: internal-only, no outbound notification in DEV; external notification is a later switch, not part of this build. | No, to check (`IntegrationRequest` exists). |
| IN-Y08 | P15, IN-057 | Request administration | No queue, status or notes route in Owner screens (backend absence not proven). | Show the lifecycle New, Reviewing, Planned, In Development, Available, Declined/Not Feasible, internal notes, durable changes, and requester status notifications with delivery suppressed (audit shows the notice). Name the route and role (Super Admin console `admin.*` is the likely place; confirm). Seeded request needed. | No, to check (`status`, `internal_note` columns exist). |

## 4. Setup and connect flow (`[integrationId]/connect/...`)

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-Y09 | P11, IN-034 to 036, 038, 039, 103 | Four-step setup, e.g. Microsoft | Steps and options visible; no auth, callback, save, test or initial sync was run. | Developer end-to-end evidence (sandbox or test double): redirect/callback success, failure and retry without losing configuration; preferences save and reload; connection test and sample sync; completion truthful. Explain any test-sync effect before the click. Seeded failure cases. | No, to check. |
| IN-Y10 | P12, IN-014, 096 | Live/Test toggle | Live Mode control visible and unchanged; effect undocumented. | Document what the toggle does and show that credentials, data and jobs cannot cross environments; mark providers without sandbox honestly. Default: the toggle selects which environment's connection is viewed and used; it never moves credentials or data between environments and never changes an active live configuration. | No, to check. |
| IN-Y11 | I-R06 | Custom API and Website Forms setup copy | Generic OAuth redirect wording. | Default: adopt. Tailored copy, explain what the action does and when endpoint/configuration is collected. | No. |
| IN-Y12 | I-R07 | Setup / cards | Optional: read-only sync direction, frequency, auth method, sandbox support before connecting. | Default: adopt, fed by the same registry fields as IN-Y01 (no second source). | No, to check. |

## 5. Manage connected integration (`[integrationId]/...`: overview, sync-settings, data-mapping, permissions, sync-history, troubleshooting)

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-Y13 | P06, IN-023 to 028, 102 | Manage page, six tabs | No connected Manage page reachable (zero connections). | Two connected-provider fixtures. Show logo/name, last/next sync, connected-since, company, environment, method, Update/Disconnect, all six tabs, manual/pause/resume, frequency/direction/next run, supported object selection with save and reload. Isolated scheduler. | No, to check. |
| IN-Y14 | P07, IN-020, 030, 033, 084 | Data Mapping | Shortcut shows "Connect an integration before mapping fields" (correct). No mapping run. | Fixture with source/provider fields and external IDs. Configure Mapping saves and reloads; repeated and duplicate events do not create duplicate financial records; reconciliation-safe, auditable. Synthetic data only. | No, to check. |
| IN-Y15 | P08, IN-021, 029, 086, 108 | Activity and Sync History | "No integration activity yet". Audit Log link exists. | Seed successful and failed syncs and every event class (connect, disconnect, configure, sync, error, test) with actor, time, count, result; failed-item detail; no full secrets; audit linkage. | No, to check. |
| IN-Y16 | P09, IN-019, 031, 087, 090 | Health, errors, Run Connection Test | Four zero counters; wording defect is IN-F01. | Known healthy and unhealthy auth/API/sync fixtures; real check provenance; business-friendly error plus redacted admin detail; safe Run Connection Test. | No, to check. |
| IN-Y17 | P10, IN-032, 089, 097 | Disconnect and reconnect | No fixture; no disconnect attempted; retention policy not supplied. | Confirmation text before action, retention outcome, neutral Disconnected/Reconnect state, controlled reconnect without duplicate data. Default retention (to confirm at review, not asked of her): tokens and credentials removed at once; imported records and audit history kept; the link marked Disconnected; nothing of the client's deleted. | No, to check (a disconnected state or retention marker may be needed). |
| IN-Y18 | P13, IN-048 | Catalog with a connected provider | All cards unconnected; no multi-account policy. | Connected provider shows Manage, not Connect; duplicate connection refused server-side and in the UI. Default: one connection per provider per firm. | No, to check. |

## 6. Custom API and Webhooks (`/integrations/...` custom setup)

| ID | Report | Screen | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-Y19 | P16, IN-059 | Custom API & Webhooks setup | Route works; preconnection shows generic authorization, Events, frequency/direction, permissions. Docs, auth method, endpoint, event selection, test request, secret rotation/revocation, logs, enable/disable not visible there (absence not established). | Show every listed clause, or say where endpoint/configuration is collected. Fixture with a local/sandbox endpoint, test-only secret, outbound delivery suppressed, logs. Automated evidence for rotation and revocation. | No, to check (see `custom-integration.service.ts`). |

## 7. Security, roles, architecture (cross-cutting evidence)

| ID | Report | Area | Observed | Build or fix | Schema? |
| --- | --- | --- | --- | --- | --- |
| IN-Y20 | P02, IN-007, 109 | Role enforcement | Owner session only; no denial test. | DEV sessions for Owner, authorized staff, unauthorized staff; a role matrix and server-level allow/deny tests for connect, configure, disconnect (hidden buttons do not count); sanitized results. Default matrix (role change, confirm at review): Owner and Admin connect/configure/disconnect; Staff view only; role and firm come from the database per request, not token claims. | No. |
| IN-Y21 | P03, IN-008, 037, 041, 042, 085, 108 | Secrets and token lifecycle | No secrets visible on pre-connection forms; storage unproven. | Dummy-secret fixture; show masking, encryption (see `secret-store.ts`), least-privilege scope matrix matched to the permission copy, refresh, rotation, revocation, expired/revoked tokens leading to Needs Attention with recovery. Logs redacted. | No, to check. |
| IN-Y22 | P04, IN-009, 080, 081 | Adapter and registry architecture | Cards visible; implementation not inspected. | Evidence: adapter interface, registry schema (provider, category, capabilities, supported objects, auth method, directions, environments, status, version), a second-provider fixture, and a provider added without page changes. | No, to check. |
| IN-Y23 | P17, IN-082, 083, 088 | Background jobs, webhooks | Nothing executed. | Queued isolated job completes after browser close; injected outage, rate limit, partial failure, duplicates; valid, invalid and replayed signed events; invalid and replayed rejected with no external delivery. | No. |
| IN-Y24 | P18, IN-110 | Acceptance suite | None run. | Dated results for six scenarios: successful connection, expired authorization, provider outage, failed sync, duplicate event, disconnect/reconnect, with test doubles; link to IN-Y09, 14, 17, 20, 21, 23. | No. |
| IN-Y25 | P01, IN-001, 006, 099 | Visual and responsive | Desktop 1165 px only; shell consistent; initial-letter tiles; no connected frame or mockup images supplied. | Check against `docs/mockups/firm-workspace/` (our own copy, no request to her); screenshots at phone, tablet and desktop showing no clipping; connected Manage frame via IN-Y13 fixtures; security and scalability design note for IN-001. | No. |

(Counts: IN-Y01 to IN-Y25 = 25 yellow items; I-R05 is explicitly not scope and is covered by IN-Y02, IN-Y13, IN-Y15, IN-Y16.)

## 8. Rules for every item

Match the existing look and `packages/ui` tokens; no placeholder or debug text; tenant-scoped and audited; a test for each fix (unit plus e2e plus tenant-isolation where data is new). Synthetic data only. Nothing in this list connects, syncs, sends, charges or contacts a provider or real person; notifications stay suppressed in DEV.

## 9. Provider-readiness prerequisites (for Rasel only; do not ask Octavia to create accounts)

The report requires, for every provider, this response (P19), in this order: meaning and capability (listed only / supported Not Connected / unavailable / Connected / Needs Attention; supported objects, sync directions, auth method, environments); developer and provider work first (adapter, commercial or API access, provider application or verification, named owner, approval lead time); when the firm must act (account type, permissions, secure steps, whether a sandbox is enough); and validation (enable, authorize, configure, test, validate; isolated test destination; success and failure evidence; rollback and disconnect plan; separate live gate). The report gives no sandbox needs, approvals, lead times or owners itself: each cell below is for us to fill, none is known from the report. Octavia acts only at the developer-confirmed sandbox step, then separately for live.

| Report code | Provider | Tier | Card state seen | Our response to fill (capability, sandbox, approval and lead time, owner, firm-action point) |
| --- | --- | --- | --- | --- |
| IN-061 | QuickBooks Online | P0 Must | Disabled | Open: bookkeeping, customers, invoices, expenses, payments |
| IN-062 | Microsoft 365 / Outlook / OneDrive / SharePoint | P0 | Disabled (setup screens exist) | Open: email, calendar, contacts, files |
| IN-063 | Google Workspace / Gmail / Calendar / Drive | P0 | Disabled | Open: email, calendar, contacts/files |
| IN-064 | Stripe | P0 | Disabled | Open: online payments, reconciliation |
| IN-065 | Plaid | P0 | Disabled | Open: bank/account feeds |
| IN-066 | Dropbox Sign | P0 | Disabled | Open: e-signature and signed-document return |
| IN-067 | Zoom | P0 | Disabled | Open: virtual appointment links |
| IN-068 | Textmagic or selected SMS provider | P0 | Disabled | Open: two-way SMS (provider selection is ours) |
| IN-069 | Website & Lead Forms / Webhooks | P0 | Enabled internal setup, untested | Open: no external account expected; test endpoint needed |
| IN-070 | Custom API & Webhooks | P0 | Enabled internal setup, untested | Open: no external account; local/sandbox endpoint |
| IN-071 | Tax preparation software connector framework | P1 High | Disabled | Open: provider-specific as API access permits |
| IN-072 | Payroll provider framework | P1 | Disabled | Open: provider-specific as supported |
| IN-073 | Square | P1 | Disabled | Open: payments and transactions |
| IN-074 | Xero | P1 | Disabled | Open: alternative accounting |
| IN-075 | Calendly | P1 | Disabled | Open: scheduling and availability |
| IN-076 | HubSpot | P1 | Disabled | Open: CRM, leads, contacts |
| IN-077 | Mailchimp | P1 | Disabled | Open: audiences and campaigns |
| IN-078 | Shopify | P1 | Disabled | Open: commerce/order data |

IN-079 (P2 expansion) is future, demand and API dependent; not a missing live connector and not part of immediate acceptance. Common prerequisites to record per row: provider developer account or app registration, app review or verification, commercial/API terms, redirect URIs per environment (from config, not code), sandbox availability, who at Firmivra owns it. Do not request or store secrets in any document.

## 10. Report gates (for sequencing)

1 Developer response: IN-F01 to IN-F04, Help status, P19 table. 2 Safe fixtures (IN-Y rows), notifications suppressed, routes and expected outcomes named. 3 Review Two retest of the four failed checks, Help accessibility, green regressions. 4 Authorized sandbox with isolated data. 5 Separate live decision. No live action is authorized by the report.
