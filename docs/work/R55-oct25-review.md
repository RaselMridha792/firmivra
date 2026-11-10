# R55: Octavia's review of Oct 25 (Dashboard K8, C1, C2, C5, D2, D4, D5; Client Sign-ups D)

Source: `docs/specs/review-2026-10-25/CHANGE-LIST.md` (sections A, C, D, F), `dashboard--developer-feedback.md`, `client-signups--developer-instructions.md`, `screenshots/client-signups-expanded-sidebar.png`.

## Automations and Integrations (Octavia's review of Oct 28): AU-F01 to F33, IN-F01 to F04

Rasel (Nov 4): R55 owns Automations (AU-F01 to F33; AU-D stays deferred) and Integrations (IN-F01 to F04). Order: the 13 trigger selectors (AU-F08 to F20), then AU-F01 to F03 and F28, IN-F01 and IN-F02, then the rest. Manual Event Confirmation (AU-F29 to F33) waits for Rasel's word. Source: `docs/specs/review-2026-10-28/AUTOMATIONS.md`, `INTEGRATIONS.md`.

**Design (trigger selectors):** the engine polls: each event has a loader in `automations/matching.ts` that reads the firm's records and keys each occurrence, so a run never repeats. Change events (status changed, submitted, converted) bind to the source module's own audit entries (`audit_logs`, firm-scoped, indexed by firm and time): one occurrence per audit row, read from the rule version's start. No event is invented: an event without a real audit action or record date stays unlisted (AU-Y02 default).

**PRs (one line each):**
- #1247 merged: Trigger Event label (AU-F03); Clients, Leads, Intake Forms and Documents events (AU-F08 to F11).
- #1251 merged: Tax Returns, Tax Planning and Business Advisory events (AU-F12 to F14). AU-F15 Custom stays empty: no custom field or date exists, and its manual confirmation came with AU-F29 to F33.
- #1252 merged: Bookkeeping and Payroll events (AU-F16, F17) and the client's consent change (AU-F18).
- #1258 merged: Applies To at every width, in words (AU-F01); Logs tabs (AU-F02); Rule Owner, changed only by an Owner or Admin (AU-F28).
- #1259 merged: Integrations IN-F01 to F04 (honest health, Cancel and Back keep the list, one set of category names, HelpTip per area).
- #1264 merged: Manual Event Confirmation (AU-F29 to F33).
- #1267 merged: trigger anchors, the sentence with an example, the time zone, the bad-number check (AU-F04 to F07).
- #1268 merged: the match count before any action (AU-F21); operators named per field, lists for Is any of (AU-F23). AU-F22 and the new operators (On, Within a Period, Does Not Contain) wait: each needs a field or operator the catalog does not have.
- #1270 merged: Move up and down for actions (AU-F24); Add and Remove client tags by the firm's tag ids (part of AU-F27).
- #1273 merged: Notify staff (part of AU-F27; bell only, the lead's one-off notifications exception) and the events with no client: Staff Management (AU-F19), Integrations (AU-F20), firm-wide Communications (AU-F18).
- #1276 merged: loop detection knows the tag and assign actions, and an action that changes nothing records nothing (fix to #1270); Assign client (part of AU-F27).
- #1278 merged: Send client email (AU-F25) through Messages' outbound email (OutboundMessagesService exported: the lead's one-off exception).
- #1280 merged: Tags and Assigned staff conditions on every client and lead event, with the firm's own tags and members as the choices (AU-F22, part).
- #1282 merged: Request documents (AU-F27) through Documents' own request (DocumentRequestsService exported: the lead's one-off exception).
- #1285 merged: Send intake form (AU-F27) through Intake Forms' own send (IntakeSendService, already exported), one per run and action.
- #1290 merged: Update client status and Update client priority (AU-F27, a typed allowlist), and the Client status changed event with old and new status (AU-F08).
- #1297 merged: the rest of AU-F22 (the client's context on every client record's event; each record's own due date, balance, payment status, progress, assignee, type, confirmation, service, jurisdiction and tax year) and AU-F23's remaining operators (On, Within the last / next N days, Does not contain).
- #1300 merged: Invite client to book, Schedule lead follow-up and Request approval (AU-F27), with actions that work on the event's own record (LeadPipelineTabsService and TaxReturnReviewService exported: the lead's one-off exceptions).
- #1301 merged: Create task from a template and visible to the client, Send client text message, Create deadline and Add service (AU-F26; ComplianceDeadlineActionsService and EngagementsService exported: the lead's one-off exceptions).
- #1304 merged: Conditional branch as an action's Only if, and Send resource (AU-F26).
- #1308 merged: AU-Y evidence: rule states, a rule that matches nothing, the server permission matrix, and time boundaries across the clock change; the evidence map below.
- #1311 merged: honest provider states and Ready to Connect, readiness filter, filter chips with Clear all, featured follows the category, Keep draft or Discard on a request, and the disconnect outcome (IN-Y01, Y03, Y04, Y05, Y06, Y17).
- #1312 merged: the shared date range (opt-in names and the reversed-range check) on for Support, the Sales pipeline and Integrations Usage, and Support's date ranges kept in the address (SA-PIP-PL01, SA-SUP-R1, SA-INT-R4 part).
- #1314 merged: the platform integration wizard's Save and continue, Draft saved, and Keep or Discard on Cancel (SA-INT-R1, R2); broadcasts without the legacy side panel and with Save and continue (SA-COM-R7, R8); Statuses in the report builder (SA-RPT-R8).
- #1315 merged: connect copy in each provider's own terms and the registry's facts before connecting (IN-Y11, Y12).
- #1319 merged: New Message asks before unsaved edits are lost (SA-COM-R5); Reports' firm links open the Super Admin's own firm-scoped views (SA-RPT-R4, R5).
- #1321 merged: New Message's one merge-field chooser (SA-COM-R4) and MRR at each month end beside Collected payments (SA-RPT-R3).
- #1327 merged: Insert Image in New Message (SA-COM-R2); integrations managed by the Owner and Admin only (IN-Y20); the applications list view in the address and no workspace shortcut (SA-APP-F11, F12).
- #1330 merged: report builder exports to CSV, Excel and PDF from the same run (SA-RPT-R1).
- #1333 merged: a staff session row per firm (SHA-256 of the firm and the sign-in's id), 401 SESSION_REVOKED and the web signs out, Login History from `auth.firm_session_started` (Rasel's approval through the lead, Nov 7).
- #1338 (`rasel/R55-account-authority`): SM14 part A, the account authority rules on every staff route and Settings > Users, the detail's `authority` for the screens, the Original Owner badge; Integrations reads Firmivra, not LVP Pro.
- #1357 (`rasel/R55-platform-rollups`): the daily job for the firm metrics, feature usage and integration usage rollups (per-firm reads under RLS), and the Usage page's plan distribution (SA-INT-R3).

**For Review 2 (lead, Nov 7):** Send client email (AU-F25) goes through Messages, so a client's "email" is the portal message plus an email notice to the client's address; the text stays in the portal and is never in the email (Messages' rule). A client without portal access gets nothing: the step fails with Messages' reason (NO_PORTAL_ACCESS) and the draft is canceled.

**For Review 2 (lead, Nov 7):** Request documents (AU-F27) names a service kind, not a service: it asks under the client's oldest ACTIVE service of that kind; with none open, the step fails with Documents' NO_OPEN_SERVICE and nothing is created. Title, instructions, an optional category (a live one of the firm) and a due date N days after the run.

**For Review 2 (lead, Nov 7):** Update allowed field (AU-F27) is a typed allowlist: Client status (New, Pending documents, In progress, Active, On hold; never Inactive, which stays behind APPROVE) and Priority (High, Medium, Low, or none). Clients has no status route, so the engine writes the change as Clients' own update does: the client's row locked, an archived client refused, a Staff owner only on their own clients, `updated_by` = the rule's owner (the database's status history names them), and a `client.updated` entry with the field and its old and new value. Name, email, phone, account type and the tax-year status stay out (a rule's one fixed value would overwrite every matching client; a firm's tax status can read "Filed"). That entry is the Client status changed event (AU-F08), so loop detection blocks a rule on it that sets the status.

**For Review 2 (AU-F22 and F23 defaults, Nov 7):**
- Every event about one client's record (a task, an invoice, a form, a return...) can test that client's status, tags, assigned staff, state, the day they were added and their last activity. A client's own events already test its status, tags and staff. Lead events and the firm's own events (staff, integrations, sends) have no client, so they get none of these.
- Dates are the firm's days. "Within the last / next N days" counts today. There is no "last contact": the client's recorded last activity is offered under that name.
- An overdue invoice's balance is its total less what was paid, online or offline, as Invoices counts it. Its payment status is Unpaid or Partly paid (an overdue invoice is never paid).
- An appointment reads Pending until someone confirms it.
- Not listed, since no record has them: a team on a client or record, and approved custom fields (there's no allowlist of a firm's custom fields).

**For Review 2 (lead, Nov 7): the AU-F27 requests**
- **Invite client to book:** a portal message through Messages with a link to the client's portal Appointments page. It never books; the client picks a time under Appointments' rules.
- **Schedule lead follow-up:** offered on lead events only. It goes through Leads' own follow-up (a type, due N days after the run, a note), for open leads only: a closed lead fails with Leads' LEAD_CLOSED.
- **Request approval:** offered on tax return events only. It adds a PENDING step through Tax Returns, and Automations never decides it. The reviewer can never be the rule's owner (blocked when the rule is turned on) or the return's preparer (SELF_APPROVAL at run time). The same pending step for the same reviewer is never added twice.

**For Review 2 (lead, Nov 7): AU-F26 coverage**
- **Already covered:**
  - Create task, Portal message (Send client message), Email (AU-F25), Internal notification (Notify staff), Update status, Assign, Document request, Add tag and Add note;
  - Delay (each action's delay);
  - Appointment: Invite client to book, which never books.
- **Create task:** it also takes one of the firm's task templates (which fills what the rule leaves out) and Visible to client.
- **Send client text message:** it goes through Messages' outbound text, with consent, opt-in, the firm's texting setting and the provider. Production starts without texting, so the step fails with Messages' own reason and nothing is sent.
- **Create deadline:** through Compliance's own create. The same deadline (client, name, type and day) is never added twice.
- **Add service:** through Engagements' own create, with no billing date, so it never starts billing. A client with that service already open gets nothing new.
- **Conditional Branch:** an action may carry Only if conditions on the event's own fields, all of which must hold.
  - They're checked when the action's turn comes, against the record as it is then (the run's occurrence of the event).
  - If they don't hold, the step is SKIPPED ("Its condition was not met"), and the actions that depend on it skip too.
- **Send resource:** a portal message linking one of the firm's published portal resources (on its category's portal page) or links, never a file outside them.
  - Portal resources are for business clients (Content's rule), so an individual client gets nothing and the step fails with BUSINESS_ONLY.
- **Not offered:**
  - Create Invoice: an invoice is money and needs line items. The reminder is Send client message or Send client email on Invoice overdue, with the invoice number as a merge field.
  - Webhook / Integration: no vetted outbound webhook exists.

**AU-Y evidence for Review 2 (the change list's defaults; tests in `apps/api/test/e2e/automations.e2e.test.ts` and `test/unit/automations.test.ts`):**
- **Y01, rule states:**
  - Save Draft is DRAFT; Save and Activate is ACTIVE (also after a fresh read); a copy is DRAFT with its own id; activation is not a run.
  - Test: "Save Draft is a draft, Save and Activate is active, a copy is a draft". A template opens as a draft for review ("uses a template to make a draft for review").
- **Y02, events:** each listed event binds to a real source (`matching.ts`, `audit-events.ts`); "lists each module's events, each with a real source". There's no Anniversary, Account Activated, Manager Changed, or open or click event.
- **Y03, timing:** the five presets only; no custom timing is built.
- **Y04, import:** both inputs kept and no picker added; the template import tests cover it.
- **Y05 (Rasel, Oct 29: no seeded message templates):** the TP-F18 starters installed for LVP are the active templates. Tests create the draft template and the one not offered to Automations themselves.
  - Eligibility: kind PORTAL_MESSAGE for Send client message and EMAIL for Send client email, status ACTIVE, and `includeInAutomations` on.
- **Y06, channels:**
  - Send client message is the portal message.
  - Send client email is Messages' email (the portal message plus an email notice).
  - Send client text message is Messages' SMS.
  - Messages' own contact and consent checks apply to each.
- **Y07, Manual Event Confirmation:** the defaults are in place (AU-F29 to F33 tests).
- **Y08, business days:** not offered. Invoice timing follows IP-F06 (firm days, open balances).
- **Y09, time:**
  - Firm time zone first.
  - Unit tests cover exact boundaries, a zero offset, no date, quiet hours across both 2026 clock changes, and Within N days across the change ("times boundaries, zero offsets and the clock change").
- **Y10, contracts and safety:**
  - Run key = event, record and occurrence; dedupe days per rule; loop and chain checks ("finds a rule that starts itself…"); only module services are called; logs keep ids.
  - Tests: the run engine and loop tests.
- **Y11, overview:** "shows the overview: counts, health and recent activity". The formulas are in `overview.service.ts`.
- **Y12, Y13, copies and archive:** "pauses, copies, archives and restores". A copy is a new id with no run history, and the original is unchanged; archive keeps history; Test runs nothing.
- **Y14, dry run:** "count and sample what a rule would act on, create nothing…" (no task, message or note).
- **Y15, settings:**
  - "keeps the firm's settings, for an Automation Admin to change"; "waits for a delay, and honours quiet hours".
  - Safety threshold: "stops a rule that would act on too much".
- **Y16, Y19, order, retry and loops:**
  - "runs its actions in order once"; "retries only the failed, retryable actions"; "a rule on a tag or assignment change can't take the action…".
  - Only if and dependency skips are covered too.
- **Paused and archived rules (the lead, Nov 7, a fix found with Y18):**
  - While a rule is paused, its waiting actions are held: they never run and aren't lost, and they run once it's turned on again. Pausing offers HOLD (the default, replacing FINISH) or CANCEL.
  - Archiving cancels the waiting actions, with the reason "The rule was archived".
  - A member's own re-run of a run (with its reason) still runs: it's that member's act, not a waiting action.
  - Test: "holds a paused rule's waiting actions, runs them once it is on again, and cancels them on archive".
- **Y17, no matches:** a warning in the rule's test, and the rule still saves and turns on ("a rule that matches nothing right now warns…").
- **Y18:** synthetic log rows (success, failed, skipped, pending) come in R1's seed part 3. The export test checks the file's columns and who may export.
- **Y20, permissions:** the server matrix for Owner, Admin, Staff and Tax preparer (view, write, activate, export, settings), checked against the role grid, plus another firm's Owner getting 404 ("enforces the automation rights on the server for each role"). The audit entries are covered by the tests for each feature.

**For Review 2: IN-Y01, Y03, Y04, Y06 (the change list's defaults)**
- **Provider states, from the registry:**
  - Not connected (connectable now);
  - Not available yet (listed, not enabled: no Connect);
  - Connected, Needs Attention, Syncing, Paused, Disconnected (from the connection).
- **Counts:**
  - "Ready to Connect" counts only connectable, unconnected providers, with "N more coming soon".
  - The Not Connected tab counts every unconnected provider.
- **Readiness filter:** Connectable now or Coming soon, apart from the status tabs.
- **Filter chips:** each active filter shows as a chip you can remove, with Clear all and the shown count.
- **Marketplace:** the featured row follows the category, as the search does.
- **Request modal:** Cancel on a started request asks Keep draft or Discard; Escape or close keeps the draft (IN-Y05).
- **Disconnect (IN-Y17):** the dialog states the outcome before you confirm, using the default retention:
  - tokens and credentials removed at once, and the connection marked Disconnected;
  - imported records and audit and sync history kept, and none of the clients' data deleted;
  - a later reconnect doesn't duplicate records.
- **Connect step (IN-Y11, Y12):**
  - Its subtitle says what connecting does for that provider and sign-in method: the provider's page for OAuth, a write-only API key, a provider link, or built in. Website Forms and API & Webhooks say what is set up there and what is not.
  - A read-only list from the registry shows sign-in, sync direction, how often, and whether a Test environment exists, before anything is connected.
- **IN-Y18:** one connection per provider per environment, already refused by the API ("connects at once, once per environment") with the Manage-connection notice.
- **IN-Y20 (Rasel, Nov 7: yes):** connect, configure, sync and disconnect are for the firm's Owner and Admin only, on the server (canManageIntegrations) and on screen (canManage). Staff views. A grid role views only what its grid gives (a Manager has no Integrations right by default). Another firm's Owner gets 404.

**For Review 2: Super Admin light items (review of Oct 31)**
- **The shared date range** (`packages/ui` DateRangePicker) takes an opt-in `strict` (the lead: backward compatible, existing screens unchanged unless they opt in).
  - Each date gets a spoken name, for example "Created Date: From, start date".
  - An end before the start stays on screen with "End date is before start date" and is never passed on.
  - On for Support (Created, Last Activity), the Sales pipeline and Integrations Usage.
- **Support's date ranges** live in the address (createdFrom/createdTo, activityFrom/activityTo), so a reload or another page keeps them. They show as a chip and count in Filters (n).
- **Wizards (SA-INT-R1, SA-COM-R8):**
  - A step that saves says "Save and continue". The integration wizard says "Draft saved" with the time.
  - Cancel on a saved, unchanged draft offers Keep draft or Discard draft (removePlatform). Unsaved changes still ask first.
  - Next never makes a second draft: step 1 updates the draft it made.
- **SA-INT-R2:** every wizard save refreshes the admin-integrations queries, the list's included. The mock API keeps no new drafts, so it's shown on the real stack.
- **SA-INT-R3 (parked):** counting firm connections by plan needs a rollup column (lead: option b), so it's a schema question for Rasel.
- **Broadcasts (SA-COM-R7):** the legacy side panel is gone. Every Create Broadcast opens the four-step wizard.
- **Report builder (SA-RPT-R8):** default labels pluralise properly ("All Subscription Statuses", "All Categories").
- **New Message (SA-COM-R5):** recipients, CC and BCC, subject or text not yet sent or saved make Cancel, an in-app link or a reload ask "Discard this message?" (Keep editing or Discard; Discard sends nothing). It reuses the firm side's unsaved guard. The browser's own Back isn't caught (the App Router can't stop it).
- **Firm-scoped links (SA-RPT-R4, R5):** a link from Reports' firm view into the firm's data opens only the Super Admin's own views, never the firm workspace (the lead, consistent with SA-APP-F12):
  - Subscriptions searched by the firm's name;
  - Billing with that firm picked (`?firm=`);
  - Support filtered to the firm (`?firm=`), which is the firm's full ticket history, every status.

  Ticket numbers open the exact ticket.
- **Merge fields (SA-COM-R4):** New Message's Merge Field buttons open one chooser over the central list (ADMIN_COMM_MERGE_FIELDS, the same six as Templates) and insert at the cursor of the subject or the body. The API fills each field per recipient, and a field with no value is left empty.
- **MRR (SA-RPT-R3):** the overview's Revenue Trend shows MRR at each month's end, from the paying subscriptions' daily rollup (platform_mrr_daily, never list prices), beside Collected payments (payments received). 0 where the rollup has no day yet.
- **Insert Image (SA-COM-R2):** New Message's toolbar has Insert image, the same picker as Templates (upload or the library, clean files only). It puts a reference ("[Image: name]") at the cursor, as a template does. Inline images stay apart from attachments.
- **Applications list (SA-APP-F11):** tab, status, date range, search and page live in the address. Detail links carry the list in `?from=`, so the detail's Back and the browser's Back open the list exactly as it was. Back follows only a path on this site.
- **No workspace shortcut (SA-APP-F12):** "Open Firm Workspace" is gone from Application and Firm detail. The server already refuses a Super Admin session any firm route (no firm context for the ADMIN pool) except through the owner-approved support grant, which is SA-FRM-F09 to F13's path.
- **Rasel (Nov 7), the order after these:**
  1. Firm Applications (SA-APP-F01 to F12) as soon as R1's schema merges.
  2. Firms (FRM-F01 to F13), the Team console guard, and System Settings restore through the audit's before and after (never secrets).
  3. Staff Management, Tasks A4, Leads L8, Services S2/S4 and Settings > Payments.
- **SA-INT-R3 and the platform rollups (Rasel's yes, Nov 10; the lead's option 3):** one platform job (`apps/api/src/platform-rollups/rollups.job.ts`), hourly, rewriting yesterday and today (UTC).
  - It lists the firms in platform scope and reads each in its own scope (forBusiness, the normal RLS), one short transaction per firm. It writes only platform rows. No SECURITY DEFINER function, no schema.
  - `platform_firm_metrics_daily` and `platform_feature_usage_daily`: one firm's own counts, keyed by its id (the Firm Report Detail's rows). `platform_integration_usage_daily`: sums with no firm id. Catalog entries get connected, active, connects, disconnects, firm requests and connected firms by plan; Firmivra's own integrations get requests from their logs and latency and volume from their runs.
  - documents.generate counts 'document.uploaded' and 'agreement.created' (the lead's Review 2 default: no "generated" action exists).
  - One task at a time (advisory lock); a firm that fails is logged by id and left out of that run; each run is audited with counts only. PLATFORM_ROLLUPS=on|off (off under tests).
  - The Usage page's Plan Distribution reads connected firms by plan on the range's last day (firms without a plan are left out); its empty text is "No firm has connected this yet".
- **SM14, account authority (Rasel's default through the lead, Nov 7; defaults 1 to 4 approved):**
  1. The Original Owner is the firm's first Owner membership (the account its application created). No schema change: nobody, the Original Owner included, can demote or deactivate that account, so it stays the first.
  2. Owner-level (the Original Owner and delegated Owners) acts on everyone below the Original Owner, other delegates included. Giving the Owner role, or taking it from a delegate, is the Original Owner's alone (Edit Staff and Settings > Users).
  3. Reset MFA is owner-level only. An Admin acts only on the roles below Admin: Edit, Reset Password, Resend Invitation, Sign Out Sessions, Lock and Unlock, Deactivate and Reactivate. Below Admin, nobody acts on another account.
  4. Owner-level access is given by promoting an existing member on Edit Staff. Invites and Create Staff stay below Owner.
  - One rule (packages/types, `team/authority.ts`) for the API, which checks it on every staff route and on Settings > Users, and for the screens, which read the member detail's `authority`. The Original Owner has a badge.
  - Self-service (part B, the lead's placement): a Security card on My Profile with Sign Out All Other Sessions and Change My Password, for every tier.
- **Exports (SA-RPT-R1):**
  - The builder exports CSV, Excel (XLSX) and PDF from the same run and columns as the preview, each audited with its format. Excel and PDF use the reports' writers.
  - CSV holds the title, generated time, period and filters above the table. The PDF holds the title and period. The Excel sheet is the table.
  - Up to 10,000 rows, inline. More is refused with "narrow the filters" (EXPORT_TOO_LARGE). A background PlatformExportJob for larger exports isn't built: no admin export has needed one at this size.
- **SA-PIP-PL01's menu** (Add Lead, Add Opportunity, Build Pipeline) already had text names, so the date popup was the open part.

**Default (lead, Nov 4; shown at Review 2):** an event is never listed when every rule on it would fail. Staff Management (AU-F19), Integrations (AU-F20) and firm-wide Communications sends (AU-F18) have no client, and today's actions (Create Task, Send Client Message, Add Client Note) all need one, so those events ship in the same PR as the first staff-facing action (AU-F26 Internal Notification / AU-F27 Notify Assigned Staff or Team).

**Manual Event Confirmation (AU-F29 to F33), design (`rasel/R55-au-confirm`, from main):**
- F29: `automation_settings.manual_confirmation_enabled` (R1, on main) in Automation Settings; only an Owner or Admin changes it (403), audited (`automation_settings.updated` plus from/to); off by default.
- F30: confirmable events (external outcomes, AU-Y07): tax return accepted, tax return rejected, payroll filing confirmed, deadline filing confirmed. Each rule on one picks its source: Integration verified, Manual confirmation or Either, kept in the version's `settings` JSON as `triggerSource` (no schema). Integration verified shows "not available yet": no vetted integration event exists.
- F31: `automation_event_confirmations` (R1 #1238): one row per occurrence (`occurrence_key` = `<event>:<record id>:<occurrence>`, unique per firm), so no bulk. API `POST /business/automations/confirmations` (master on, else 409; Owner/Admin, or Staff with that module's manage right), `GET` for a record. Audited; never changes the source record. The confirm dialog lives in Automations until the owning sessions add record-page buttons (asked the lead).
- F32: provider evidence is set once on the same row (`provider_*`), so the occurrence key and the runs keyed by it stay the same: nothing reruns.
- F33: a confirmation only records a known fact; it never files, submits, charges, pays, changes consent or grants rights. Tests per limit.

**Not listed (no real source, AU-Y02 default):** client onboarding completed, client follow-up due, no contact for a period, anniversary, custom client trigger; lead qualified (no qualification step) and lead no-response; intake started; document expiration (no expiry date).

**Needs from others:**
- R1 (seed part 3, AU-Y18): the synthetic automation rule and log rows sent to the lead on Nov 7. AU-Y05 needs no seed (Rasel's Oct 29 rule).
- AU-F28 Rule Owner: build on the existing `automation_rules.owner_user_id` (lead, Nov 4: yes, no schema change).
- AU-F29, F30 and F33: start on main's `automation_settings.manual_confirmation_enabled` (lead, Nov 4). AU-F31 and F32 wait for R1's `automation_event_confirmations` migration and its Deploy dev.

## Invoices & Payments (Octavia's review of Oct 27, section A): IP-F01 to F05, F12, F13

Rasel (Oct 28): R55 takes IP-F01 to F05, F12 and F13. R56 owns F06 to F09, F17 and F20 to F24 (do not touch those files); R60 is on Messages only.

**Found:** the R36 migration already holds every Create Invoice field on `invoices` (`payment_terms`, `notes_to_client`, `internal_note`, `template_id`, `assigned_user_id`, `tax_rate_id`, `email_client`, `allow_tip`, `require_payment_before_due`, `recurring_invoice_id`), plus `payment_settings`, `invoice_tax_rates`, `invoice_templates`, `invoice_attachments` and `recurring_invoices`. The firm invoice API and screens used none of it. No schema change is needed for F02 to F05 or F13.

**Done:** IP-F13 (Settings > Payments: Invoice Defaults, Reminders & Automations, Taxes & Fees; tax rates and templates). A firm that never saved has every option off; the table's own column defaults turn `auto_receipts`, `send_reminders`, `notify_overdue` and `auto_apply_payments` on, so the API writes every field explicitly. A migration flipping those defaults would make the database agree (Rasel's card, not needed for the feature).

**Open:**
- IP-F13 #1209, IP-F01 #1211 and IP-F02 #1216: merged.
- IP-F05 on `rasel/R55-ip-f05-recurring`: Create Invoice's Recurring card. Off keeps a one-time invoice. On: the named frequencies (weekly, biweekly, semi-monthly, monthly, quarterly, semiannual, annual) or Custom, every 1 to 52 weeks, months or years (R1's #1217), and an end rule (never, a date, or after 2 to 120 invoices). A recurring draft keeps a `recurring_invoices` row that waits PAUSED, so nothing is made or sent from a draft. Sending the invoice starts it ACTIVE from the day the invoice opens, as its first period (`invoices.recurring_period_on`). Auto-send and AutoPay are written off (IP-010: recurrence authorizes neither). Turning Recurring off, or canceling the draft, ends the schedule (no DELETE grant). An end before the second invoice is 409 RECURRING_END_TOO_SOON. The period math is shared (`recurringPeriodOn` in packages/types), counted from the start so month ends hold. Nothing generates the later invoices yet: that is IP-F18's job (the Recurring Invoices screen and its daily run; not assigned to R55). "Firm-configured" frequencies have no table; Custom covers them.

Rasel's two approved additions are merged: Custom frequency (#1217, wired in F05) and `payment_settings.custom_term_days` (#1220, Oct 28; dev gets it with Deploy dev run 833).

**Open (Oct 28, late):**
- IP-F05 #1224 (`rasel/R55-ip-f05-recurring`): Recurring card, Custom every 1 to 52 weeks, months or years.
- Firm's own terms #1225 (`rasel/R55-firm-payment-terms`, from main): `PaymentTerm` takes `net_<days>` (1 to 365); Settings > Payments' "Your payment terms" (up to 12; default terms must be offered); Create Invoice offers the standard four plus the firm's list; 409 TERMS_NOT_OFFERED for terms the firm doesn't offer (a draft keeps its own).
- Both #1224 and #1225 add an `InvoiceErrorCode` and an `INVOICE_ERRORS` line in the same spot of `packages/types/src/payments/schemas.ts`, and both touch `invoice-editor.tsx`: whichever merges second needs `origin/main` merged (keep both codes).

**Next, in order (one PR each; no further schema needed):**
1. **IP-F03** (done Oct 29 on `rasel/R55-ip-f03-f04`, stacked on #1224 and #1225; merge `origin/main` after they merge):
   - Assigned Staff (`assigned_user_id`: an ACTIVE member, 404 otherwise); Invoice Template (`template_id`: a live template, a draft keeps its own); Tax (`tax_rate_id`: a live rate, a draft keeps one archived since; `invoice_lines.taxable` per line). The database computes the tax; `invoiceTaxCents` mirrors it exactly (BigInt), and the summary, preview, firm detail and portal detail show "Tax (name rate)".
   - Attachments (`documentIds`, up to 10, `invoice_attachments`): the client's shared, clean files, not trashed or archived (404; 409 ATTACHMENT_NOT_SHAREABLE for internal or unchecked). Left out keeps the draft's; [] removes them. Read back only while still shareable. The drop zone uploads into the client's Documents (shared) under the invoice's service.
   - A recurring draft's schedule copies the rate, staff, template and taxable lines.
   - Isolation: the invoice cases map `taxRateId`, `assignedUserId`, `templateId` and `documentIds`.
2. **IP-F04** (done Oct 29 on local branch `rasel/R55-ip-f04-options`, stacked on #1230; no PR until a slot frees). Rasel's defaults (Oct 29), all reversible:
   - **Email** (`email_client`): Create Invoice's "Send email notification to client" starts unchecked. Off, the invoice opens in the client's portal with its bell item and no email copy (`InvoiceNotices` reads the invoice's choice for `invoice.sent`, on Send and on the scheduled open). A recurring draft's schedule gets `delivery` PORTAL (EMAIL_AND_PORTAL when on). Left out of the API body: kept on update, and on create the column's default (on), so older callers and R56's tests still email; the form always sends it. With it off, IP-F07's Sent never shows (no email is dispatched).
   - **Allow tip** (`allow_tip`): shown only while Settings > Payments' Tipping is on; stored only. Pay Now still charges the balance due; the tip joins the Stripe charge in a later PR once Stripe test mode is verified. The client's portal shows nothing about tips yet.
   - **Require payment before due date** (`require_payment_before_due`): shown only while that setting is on. The client's invoice shows "Please pay before the due date, {date}." while it can be paid; Pay Now stays where it is. No blocking, no extra email.
   - Tip or before-due turned on while the setting is off is 409 OPTION_NOT_ENABLED; a draft keeps one it already has.
   - Not wired: the mockup's "Include attached files with invoice" (`include_attachments`); choosing files (IP-F03) already is that choice. Rasel's word if the box should show.
3. **IP-F12** (Rasel, Oct 29: build as planned; receipts only when Automatic Receipts is on or Send Receipt is ticked; the firm's own notice stays). Done Oct 29 on local branch `rasel/R55-ip-f12-receipts`, stacked on F04; no PR until a slot frees (max 3). No schema change:
   - **Deposit accounts** (`deposit_accounts`: name 1 to 80, unique per firm, one default, archive only): `GET/POST /business/settings/payment-preferences/deposit-accounts`, `PUT .../:id`, `POST .../:id/archive`, Owner and Admin, audited, as tax rates and templates are. Settings > Payments gets a "Deposit accounts" card.
   - **Record Payment**: `depositAccountId` (a live account of the firm, 404 otherwise; preselected default; the empty state links to Settings) and `sendReceipt` (left out: the firm's `autoReceipts`; the box starts from it). `OfflinePayment` gains `depositAccount {id, name}` and `receiptSentAt`; the invoice's payments and Recent Payments show "Deposited To".
   - **Receipts**: `payment.received` keeps going to the firm (audience staff). The client's copy (audience client) goes only after the payment succeeded (offline: recorded; Stripe: the webhook's success) and only when `sendReceipt`/`autoReceipts` says so; a `RECEIPT_SENT` invoice event (with `payment_id` or `offline_payment_id`) is written in the same step under an advisory lock on the payment, so a retried request or webhook never sends a second automatic one. A replayed record (same idempotency key) sends nothing.
   - **Manual Send/Resend**: `POST /business/invoices/:id/payments/:paymentId/receipts` and `.../offline-payments/:offlinePaymentId/receipts` (Owner and Admin; the id in the path, as refunds and voids, so the isolation suite maps each): a succeeded Stripe payment or a live offline one (409 otherwise), always sends, writes `RECEIPT_SENT`, audited. The invoice page shows "Receipt sent {date}" and Send Receipt or Resend Receipt per payment.
   - **This changes a current email**: today every recorded payment and every Stripe success emails the client automatically; after F12 only with Automatic Receipts on (off by default) or the box ticked. Rasel approved (Oct 29).
   - Record Payment answers the invoice after the receipt step, so `receiptSentAt` shows at once.
   - Tests: e2e `invoice-receipts` (deposit accounts, record with an account, receipts gating and dedupe, Stripe gating and a retried webhook, manual resend, voided 409), isolation (`depositAccountId` and the new routes), mock spec `r55-invoice-receipts`. Locally the isolation suite still flags only file downloads and exports against s3mock (environment).
   - R56's #1222 changes `record-payment.tsx`, and #1221 and #1222 change `invoice-detail.tsx` and `mocks/invoices.ts`: merge `origin/main` after they land.

**Schema for Rasel's card:** none needed. Optional: flip `payment_settings`' column defaults (`auto_receipts`, `send_reminders`, `notify_overdue`, `auto_apply_payments`) to false so the database agrees with "nothing on by default"; the API already writes every field.
## Handoff (Oct 25, late; for the next R55)

Read first: `CLAUDE.md`, `docs/work/README.md`, this file, and Octavia's `docs/specs/review-2026-10-25/CHANGE-LIST.md` (A and D), `client-signups--developer-instructions.md` and `screenshots/client-signups-expanded-sidebar.png`.

### Open PRs

| PR | Branch | What |
| --- | --- | --- |
| #1154 | `rasel/R55-dashboard-help` | D2: Help & Support's in-app message (`POST /business/support/messages`, a Portal ticket in the Super Admin queue, idempotent by `requestId`, audited), Call Firmivra on the company phone, four verified common questions; no live chat (none exists). |
| #1156 | `rasel/R55-pipeline-drilldown` | C5: each pipeline stage opens its list filtered to what it counts, on the lists' definitions (R60's #1147). New Lead in the period, Intake not finished now (`/intake-forms?tab=open`, new list view), In Progress by workflow status now, Accepted in the period (the stage renamed from Completed). An e2e proves each stage equals its list's total. |

Merged this round: #1141 (checkout test gate), #1143 (schema requests), #1146 (C1, C2, K8).

### Next, in order

1. **Client Sign-ups screen (D1, no schema)**, its own PR when a slot frees:
   - today's API (`apps/api/src/client-auth/client-sign-ups.*`) lists Waiting and Declined only, oldest first, with no counts or search. Extend it: an Approved tab, tenant-wide counts per tab, search (name or email), Date submitted sort (newest first, stable id tie-break), filters (date range, potential-match status), server paging, first page after a filter change;
   - the screen to the image: Clients group in the sidebar with Sign-ups active; the header card **Client self-sign-up approval** (radios read-only until the setting exists, "Manage settings", "Authorized admins only"); the Checks column (Potential match amber / No match found green, text not colour only) from today's `existingClient` candidate until `match_status` lands; the Resolve Existing Account panel (actions disabled with the plain reason until the flow exists); the activity list (submitted, email verified, decisions); the client view preview (Sign In, Reset Password, Contact Firm only); Back with restored tab, search, filters, page and scroll (B01 to B04); states and accessibility from spec section 10.
2. **D5**: after R60's K5 (merged in #1147) and R1's `dashboard_card_templates` migration.
3. **Client Sign-ups flow (D2 to D4)**: after R1's migrations merge. Read R1's PR first. R1 added rules beyond Request 2: no DELETE on card templates; verifications append-only; a null `client_account_id` only for `POLICY_CHANGE` operations; existing accounts stay `match_status` UNCHECKED, which means nothing to review. The defaults are in CHANGE-LIST.md D3. Report F01 to F14, S01 to S16 and B01 to B04 as Pass, Fail or Blocked with evidence.

### Decided this round

- The pipeline's Intake and In Progress are open now; only Leads and Accepted follow the widget's period. The intake list filters its dates at UTC midnight, so a period-bound Intake would not reconcile.
- Help shows Firmivra's company phone (`lib/company.ts`, confirmed by Octavia) with no hours. The platform's support phone and the support desk's hours are Super Admin settings that the firm scope cannot read (the `platform_settings` policy). Showing them needs a read path: Rasel's word, or a database view (R1).

## Schema requests for Rasel's tap (R0 drafts the migration; R55 does not touch `packages/db`)

### Request 1: Dashboard D4 (Settings service-card templates)

One new table, firm-scoped (RLS on `business_id`, like every firm table):

`dashboard_card_templates`
| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid (uuid7) | primary key |
| `business_id` | uuid | FK `businesses`, RLS |
| `slot` | smallint | 1 to 6; unique with `business_id` |
| `service_id` | uuid null | FK `(business_id, id)` on `services`, restrict |
| `metric` | enum `DashboardCardMetric` (`ACTIVE_ENGAGEMENTS`, `ENGAGEMENTS_IN_STATUS`, `COMPLETED_IN_PERIOD`) | not null |
| `status_key` | text null | the engagement or tax status the metric counts; null for `ACTIVE_ENGAGEMENTS` |
| `label` | text | 1 to 40 characters, trimmed |
| `enabled` | boolean | default true |
| `version` | int | default 1, for stale-edit refusal |
| `created_by_user_id`, `updated_by_user_id` | uuid | FK membership |
| `created_at`, `updated_at` | timestamptz | |

Fixed cards are not rows (Total Clients, New Leads, Outstanding Invoices). The tax outcome card defaults to Accepted Returns (D5) when no row overrides it, and a row can never put a non-tax metric under a tax label (the API checks the label against the metric).

### Request 2: Client Sign-ups (D2 to D4), one request

Today the request is the `client_accounts` row (`PENDING_APPROVAL`, `ACTIVE`, `DECLINED`). There is no approval mode, version, match flag, verification or operation record. All new tables are firm-scoped (RLS on `business_id`, FK `(business_id, client_account_id)` to `client_accounts`, restrict).

1. **Approval mode with version**, on `business_settings`:
   - `client_signup_mode` enum `ClientSignupMode` (`MANUAL`, `AUTOMATIC`), not null, default `MANUAL`;
   - `client_signup_policy_version` int, not null, default 1 (raised by each change; a PATCH sends the version it read);
   - `client_signup_policy_changed_at` timestamptz null, `client_signup_policy_changed_by_user_id` uuid null (FK membership).
2. **Request version and potential-match flag**, on `client_accounts`:
   - `version` int, not null, default 1 (each decision or resolution raises it; stale writes are 409);
   - `match_status` enum `SignupMatchStatus` (`UNCHECKED`, `NO_MATCH`, `POTENTIAL_MATCH`, `NOT_A_MATCH`, `LINKED`, `RESTORED`), not null, default `UNCHECKED`, separate from `status`;
   - `match_checked_at` timestamptz null;
   - `decision_policy_version` int null (the policy version an approval or decline used), `decided_automatically` boolean, not null, default false.
3. **Match review**: `client_signup_match_candidates`
   - `id`, `business_id`, `client_account_id`, `candidate_client_id` (FK `clients`, restrict);
   - `matched_on` text[] (`email`, `phone`, `name_and_birth_date`, ...: field names, never values);
   - `resolution` enum `SignupCandidateResolution` (`OPEN`, `NOT_A_MATCH`, `VERIFIED`), default `OPEN`;
   - `reviewed_by_user_id` uuid null (FK membership), `reviewed_at` timestamptz null, `rationale` text null (at most 500);
   - `created_at`, `updated_at`; unique `(business_id, client_account_id, candidate_client_id)`.
4. **Verification record**: `client_signup_verifications`
   - `id`, `business_id`, `client_account_id`, `candidate_client_id`;
   - `contact_ref` enum `SignupContactRef` (`CLIENT_PHONE`, `CLIENT_EMAIL`, `CLIENT_CONTACT`): which contact **on the canonical record** was called, never the value or a sign-up contact;
   - `call_outcome` enum (`REACHED`, `NOT_REACHED`);
   - `identity_result` enum (`VERIFIED`, `NOT_VERIFIED`);
   - `permission_scope` enum (`RESTORE_ACCESS`, `LINK_RECORD`, `BOTH`) null, `permission_recorded_at` timestamptz null;
   - `actor_user_id` (FK membership), `created_at`. Append-only (no update or delete grant). No evidence, recordings or passwords.
5. **Resolution and operation records**: `client_signup_operations`
   - `id`, `business_id`, `client_account_id`;
   - `kind` enum `SignupOperationKind` (`APPROVE`, `DECLINE`, `LINK_EXISTING`, `RESTORE_ACCESS`, `NOT_A_MATCH`, `KEEP_PENDING`, `INVITE_DELIVERY`, `RECOVERY_DELIVERY`, `POLICY_CHANGE`);
   - `idempotency_key` text, `request_hash` text (a hash of the payload, to refuse key reuse with other data);
   - `status` enum (`COMMITTED`, `PENDING`, `SUCCEEDED`, `FAILED`);
   - `result` jsonb (client id, state, version: no tokens or identity evidence), `attempts` int default 0, `last_error_code` text null, `correlation_id` uuid;
   - `actor_user_id` uuid null (null for an automatic decision), `created_at`, `updated_at`;
   - unique `(business_id, idempotency_key)`; unique `(business_id, client_account_id, kind)` where `kind` in (`INVITE_DELIVERY`, `RECOVERY_DELIVERY`), so a delivery is never dispatched twice.

Audit stays in `audit_logs` (every action, old and new state, correlation id). Grants: the app role may insert and select every new table, update `client_signup_match_candidates` and `client_signup_operations`, and never delete.

## What is built without schema (this round)

- Dashboard: see "Dashboard" below.
- Sign-ups screen (D1): list, tenant-wide counts per tab, search, Date submitted sort (newest first by default), filters, Back with restored context, states and accessibility. The Checks column reads the existing email-link candidate (`existingClient`) until `match_status` lands.

## Dashboard (K8, C1, C2, C5, D2, D5)

- Periods are the firm's (business settings time zone). Month, quarter and year mean to date; Last Month and Last Year mean the full period; Custom is validated (start on or before end, end not after today).
- Comparisons use the equivalent elapsed period before: yesterday, last week to the same weekday, last month to the same day, the quarter before to the same elapsed day, last year to the same day. Last Month and Last Year compare with the full period before, and Custom with the same number of days just before.
- D5 depends on K5 (R60: Accepted Returns) and on Request 1 (D4).
