# R60: Super Admin Subscriptions (contract notes)

Part of `R60-backend.md` (step 10). Tables: R0's stage A (`platform_plans`, `platform_plan_features`,
`platform_firm_subscriptions`), B3 (`platform_subscription_changes`, invoices, payments, credit
notes, recurring schedules, firm billing profiles; `docs/work/R0-stage-b3-billing.md`) and the MRR
rollup (`platform_mrr_daily`, `r0_mrr_history`). Contract: `packages/types/src/admin-subscriptions/`
(`createAdminSubscriptionsClient`, `api.adminSubscriptions`), under `/api/v1/admin/subscriptions`.
The screen's mock (`apps/web/src/mocks/admin-subscriptions.ts`) set the method names and shapes;
the tables set what is stored and what the database refuses. This PR is the contract only; the API
follows in its own PR.

## Routes

All under `/api/v1/admin/subscriptions`.

| Method | Path                  | Client method                                | What it does                                                                                    |
| ------ | --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/meta`               | `meta()`                                     | The plans (display order, prices, seats, locations, features), today (UTC) and the trial length |
| GET    | `/summary`            | `summary(query)`                             | The seven cards, now and 30 days ago; churn for the period and the one before                   |
| GET    | `/`                   | `subscriptions(query)`                       | The table: search, plan, status or group, cycle, period; sorted and paged on the server         |
| GET    | `/available-firms`    | `availableFirms()`                           | Approved firms (Active or Pending Setup) with no subscription, for Add Subscription             |
| GET    | `/export`             | `adminSubscriptionsExportPath(query)` (link) | CSV download of the given ids or the filters; an EXPORTED event on each                         |
| GET    | `/:id`                | `subscription(id)`                           | The detail panel: dates, trial, cancellation, suspension, closure, billing, events, notes       |
| POST   | `/`                   | `create(body)`                               | Add Subscription / Start Trial for Firm (CREATED)                                               |
| POST   | `/:id/plan`           | `changePlan(id, body)`                       | Plan and cycle, now, prorated (UPGRADED / DOWNGRADED, CYCLE_CHANGED)                            |
| POST   | `/:id/seats`          | `updateSeats(id, body)`                      | Seats, now, prorated (SEATS_CHANGED)                                                            |
| POST   | `/:id/locations`      | `updateLocations(id, body)`                  | The Additional Location add-on, now, prorated (audit LOCATIONS_CHANGED)                         |
| POST   | `/:id/extend-trial`   | `extendTrial(id, body)`                      | 1 to 60 more trial days with a reason (audit TRIAL_EXTENDED)                                    |
| POST   | `/:id/convert`        | `convertToPaid(id, body)`                    | Trial to Active on a plan and cycle, first invoice issued (STATUS_CHANGED)                      |
| POST   | `/:id/auto-renew/off` | `turnOffAutoRenew(id, body)`                 | Auto-Renew off / Cancel at Period End, the §6 client request (CANCEL_REQUESTED)                 |
| POST   | `/:id/auto-renew/on`  | `reverseCancellation(id, body)`              | Reverse Cancellation, Auto-Renew back on only when chosen (STATUS_CHANGED or CANCEL_REVERSED)   |
| POST   | `/:id/suspend`        | `suspend(id, body)`                          | Pause, administrative or nonpayment suspension, now (STATUS_CHANGED)                            |
| POST   | `/:id/reactivate`     | `reactivate(id, body)`                       | Back from a suspension, or a restart of a canceled or expired one (STATUS_CHANGED)              |
| POST   | `/:id/price`          | `setPrice(id, body)`                         | A negotiated base price, or back to the plan's (audit PRICE_CHANGED)                            |
| POST   | `/:id/billing-date`   | `changeBillingDate(id, body)`                | Moves the next billing day, the days added invoiced or removed credited (audit)                 |
| POST   | `/:id/close`          | `close(id, body)`                            | Close Account, today (CANCELED)                                                                 |
| POST   | `/:id/notes`          | `addNote(id, body)`                          | An internal note (audit NOTE_ADDED with B4's investigation note)                                |

20 routes: 6 reads, 14 writes. Every write answers `SubscriptionResult` (the row after it, and the
invoice or credit note it issued), except `addNote` (the note).

**Registration order:** declare `GET /meta`, `/summary`, `/available-firms` and `/export` before
`GET /:id` (`:id` is a UUID, so a fixed path read as an id would answer 400). The writes are `POST /`
or `POST /:id/<word>`, so none can be shadowed. Every path has at most one `:id`; nested ids (an
invoice, a plan) go in the body.

**For the admin-scope sweep (the API PR):** each write needs its record in the right state: a Trial
for `extend-trial` and `convert`, Active with Auto-Renew on for `auto-renew/off`, Non-Renewing for
`auto-renew/on`, Suspended with nothing due for `reactivate`, Active or Past Due with a next billing
day for `billing-date`, an Active firm whenever money moves, and the body hooks pick another plan
or seat count than the record has (422 NO_CHANGE otherwise) and the firm's own name for `close`.

## Where the mock and the database differ

1. **Plans.** The mock hard-coded a `PlanId` enum and a price table. The database has
   `platform_plans` (UUID, code, name, base price per cycle, seats and seat price, locations and
   location price, display order, active) and `platform_plan_features`. `meta().plans` carries them;
   every request takes a `planId`. The mock's `outcome`, `priceFrom` ("From $799/mo"), `storageGb`
   and `textsPerMonth` are not stored and are left out. Enterprise: the mock allowed 20 seats; the
   database has no ceiling and no seat price ("21+ rate TBD"), so `subscriptionSeatRange` gives
   20 to 20 until a seat price exists.
2. **Prices.** Supported, as the mock: an annual cycle is 12 months of the plan's monthly price.
   `listPriceCents` (plan plus extras) and `priceCents` (as billed) are per billing cycle, and
   `monthlyCents` is the monthly equivalent (an annual price ÷ 12, rounded down, as Sales'
   projected MRR). `subscriptionPriceCents` and `subscriptionMonthlyCents` are shared by the screen
   and the API. They replace the mock's `monthlyCents` and `netMonthlyCents`.
3. **Seats.** Allowed seats are `seats_included + seats_purchased` (the demo seed's split). Seats
   in use: admin scope reads only a firm's OWNER memberships, so `seatsUsed` comes from the daily
   firm rollup (`platform_firm_metrics_daily.total_users`) and is null until the platform's job
   writes one; `usagePercent` is null with it, and the "fewer seats than in use" checks run only
   when it is known.
4. **Statuses.** The database's seven. The mock's CLOSED is CANCELLED with a `closure` (closed time
   and reason). The Status filter keeps PAYING and RENEWING_SOON; the mock's ENDED (Canceled or
   Closed) is just CANCELLED now, so the Churn card filters CANCELLED.
5. **Add-ons.** Only the Additional Location add-on is stored (`locations_purchased`, on plans with
   a location price: Enterprise), so it is `updateLocations`. AI Tools, SMS Package and Extra
   Storage have no table and are left out; the Manage Add-ons dialog shows them as not available
   yet. (AI features are a plan feature from Solo Elite on.)
6. **Discounts.** The mock had percentage discounts with a duration and promotion codes (LAUNCH50,
   LOYAL10, ANNUAL15). The database has one negotiated base price (`price_cents_override`, which
   overrides the plan's base price: extras still add at the plan's rates). `setPrice` sets it with
   a reason and who approved it, or removes it (`baseCents: null`). A percentage becomes a
   negotiated base without an end date; promotion codes and timed discounts are left out (R0's
   queued D2). The row's `discount` becomes `baseOverrideCents`. A plan change clears it.
7. **Account credit.** The mock kept a credit counter. B3 keeps credit as credit notes:
   `creditCents` is what is left on the firm's Available and Partially Applied notes, and adding a
   credit is Billing's `createCreditNote` (ADJUSTMENT, issued), not a route here.
8. **When a change applies.** The mock offered "Immediately" or "At next billing" for plans, seats
   and add-ons, a next-billing suspension and a future close date, with a `scheduled` list. No
   table holds scheduled changes (the history is insert-only and records what happened), so every
   change applies now: `effective`, `timing`, `effectiveOn` and `scheduled` are left out.
9. **Billing a change.** The mock charged a card or added a credit. The contract keeps its
   proration rule (`subscriptionProration`; the period's own length when known, else 30 or 365
   days) and bills through B3: a positive amount is an invoice on the subscription
   (`subscription_id`), issued the way Billing issues invoices; a negative one an Available credit
   note. Both come back in `SubscriptionResult`. The subscription's recurring schedule
   (`platform_recurring_invoices.subscription_id`) is kept in step: made on a paid start, its amount
   changed with the price, paused on suspension, ended with a non-renewal, canceled on close. Only
   an Active firm gets documents (Billing's rule): 409 FIRM_NOT_BILLABLE when money would move for
   another.
10. **Card on file and payment recovery.** No card, processor or payment link is stored for
    Firmivra's billing, so the Payment Method row, Update (card-update link), Send Payment Link and
    Retry Payment are left out; a payment is recorded by hand in Billing. The mock's declining card
    and `{ ok: false }` outcomes go with them.
11. **Paid start, conversion and restart.** With no charge to make, `create` (PAID),
    `convertToPaid` and a restart through `reactivate` make the subscription Active today and issue
    the first period's invoice, open until paid in Billing (see the questions).
12. **Past due.** The mock had attempts, a maximum, the next retry, the grace end and the processor
    response. The contract's `pastDue` has since when (the history), the failed payments on the
    firm's open invoices and the last failure's day and reason (B3's `failure_reason`). The retry
    schedule and the grace period have no column and are left out.
13. **Suspension kind.** Supported, mapped: no column holds it, so the API writes it in the
    suspension's audit row and reads it from the latest one; a suspension without one (a job's)
    reads NONPAYMENT when it came from Past Due, else ADMIN. Nonpayment only from Past Due (422).
14. **Reactivate.** The mock's `paymentSettled` recorded a payment and marked the invoices paid.
    The contract refuses while anything is due (409 BALANCE_DUE: record it in Billing) and needs
    `paymentConfirmed` for a nonpayment suspension. A suspension with Auto-Renew off returns to
    Non-Renewing (the mock turned Auto-Renew back on, which §6.9 forbids doing silently). The mock
    sent a closed account to "Add a new subscription", but a firm has one row (unique
    `business_id`), so a canceled or expired subscription restarts here on a plan.
15. **Auto-Renew off.** Supported: the confirmation, the source (stored as its code in
    `cancel_request_source`) and the notes (`cancel_reason`, up to 1,000; mock 500); Active becomes
    Non-Renewing, a Trial stays a Trial that won't convert. Reversal needs `autoRenewOn: true`;
    it clears the request. A Trial's reversal changes no status, so it is the audit event
    CANCEL_REVERSED.
16. **Close Account.** Today only (see 8). The firm's own status (`businesses.status`) belongs to
    the Firms module and is not changed here; access follows the subscription's status. The typed
    name is checked by the API, ignoring case, as the mock (422 CONFIRM_NAME_MISMATCH).
17. **Trial.** 14 days, extended by 1 to 60 days with a reason. `notifyFirm` and the follow-up
    line ("Expiry reminder scheduled for …") are left out: no notification is sent yet and no
    reminder is stored. `daysLeft` and `convertedOn` stay.
18. **Notifications.** The mock wrote "Firm notified: …" events. The API sends no firm email or
    text yet (no templates, see Needs), so the NOTIFICATION category is gone.
19. **History and Activity Log.** The mock kept one event list with prepared from and to strings.
    The contract's `events` read two sources: the history rows (`platform_subscription_changes`, by
    this API, Billing and the platform's jobs) and this module's audit rows for the actions no
    change kind fits (TRIAL_EXTENDED, LOCATIONS_CHANGED, PRICE_CHANGED, BILLING_DATE_CHANGED,
    CANCEL_REVERSED, NOTE_ADDED, EXPORTED). Fields are structured (plans, statuses, seats,
    locations, days, prices, reason, approver, amount, MRR after) and `subscriptionEventText`
    words them; `SUBSCRIPTION_EVENT_CATEGORY` sorts them (the History tab shows LIFECYCLE and
    BILLING, the Activity Log everything). The history rows have no from and to billing cycle, so
    CYCLE_CHANGED shows no cycles.
20. **Notes.** No table holds subscription notes. A note is B4's investigation note
    (`audit_investigation_notes`) on this module's `subscription.note_added` audit row: author and
    time kept, never edited, up to 4,000 characters (mock 1,000).
21. **Invoices and payments.** The mock's per-subscription lists (Paid, Open, Failed) become the
    firm's issued B3 invoices with Billing's eight statuses (`forSubscription` marks those on this
    subscription) and their payments (method, status, reference, failure reason; no card text).
    Resend Invoice is Billing's `sendInvoice(invoiceId)` (to the bill-to address; the email waits
    for templates and Billing records why); the mock's free choice of address is left out.
22. **Billing date.** Supported: after today and within one cycle, Active or Past Due. The days
    added are invoiced now (the mock added them to the next invoice, which no table can hold) and
    the days removed credited; `subscriptionBillingDateCents` gives the amount.
23. **Support view.** The mock started and ended a 15, 30 or 60-minute view by itself. Support
    access is R8's: a request the firm's owner approves (`api.adminSupportAccess.request`). The
    contract reads the open grant (`supportAccessUntil`) for the banner; start and end are not here
    (R8 has no admin-side end).
24. **Account owner.** The mock picked a name from a fixed list at creation. The contract reads it
    from the Sales record linked to the subscription (or to the firm): its owner, read-only.
    Add Subscription's Account owner field is left out (assign in Sales).
25. **Firm.** The mock's email and domain become the billing profile's (else the first active
    owner's) email and the application's website host; the slug and the firm's status are added.
    Search covers the name, slug, email and domain.
26. **Cards.** The same seven. The "30 days ago" figures come from the MRR rollup's row for that
    day (null without one: nothing writes the rollup yet), not from replaying events. Renewals'
    previous figure counts RENEWED history rows. Churn uses the history (paying at the period's
    start, Canceled in it), in basis points (mock: a percent with one decimal).
27. **Paging.** The mock answered every row and the table sorted and paged in the browser. The
    contract filters, sorts and pages on the server (up to 100 a page), with `all` kept. Export of
    selected rows sends their ids (up to 100).
28. **Export.** The mock returned CSV text. The contract makes it a download link
    (`adminSubscriptionsExportPath`), as the other modules' CSV exports, and records it per
    subscription. The add-ons and discount columns become extra locations and the negotiated price.
29. **Usage limits.** The mock's storage and text limits were placeholders and its usage numbers
    made up. The contract shows seats (used from the rollup) and locations (allowed only: a firm's
    offices are not readable in admin scope). Storage and texts are left out.
30. **Field errors.** The mock's `SubscriptionInputError` carried a message per field.
    `ApiRequestError` carries one code, so each rule has its own (SEATS_OUT_OF_RANGE, SEATS_IN_USE,
    PLAN_REQUIRED, …) and the dialog puts it by its field. Body rules are checked before sending.
31. **Results.** The mock answered `{ ok, message }` with prepared sentences. Writes answer the row
    and the billing documents; the screen writes its own line ("An invoice for $88.50 is open").
32. **Text.** Every text field also passes the platform tables' `platform_text_ok` (as Sales):
    reasons up to 1,000 (the database's limit; mock 500), the approver 100, notes 4,000.
33. **View Full Account** opens the Firms page (`/firms/:id`); no route here.

## Needs from others

- **R0 (D2, Subscriptions extras, already queued):** promotions and promotion codes; a
  subscription's applied discounts (percent or amount, duration, reason, approver); trial
  extensions and limit overrides. Found while writing this contract:
  - scheduled changes (plan, seats, add-ons, suspension, closure on a future day);
  - an add-on catalog and a subscription's add-ons (AI Tools, SMS Package, Extra Storage), with the
    plans that may add each;
  - `platform_firm_subscriptions.suspension_kind` (PAUSE, ADMIN, NONPAYMENT; docx §14);
  - change kinds TRIAL_EXTENDED, LOCATIONS_CHANGED, PRICE_CHANGED and BILLING_DATE_CHANGED, and
    from/to billing cycle and locations on `platform_subscription_changes`, so the History tab has
    them without the audit log;
  - a subscription notes table, if B4's investigation notes are not the place (question 4);
  - usage limits on `platform_plans` (document storage, texts a month) once the pricing sheet
    names them;
  - an admin-readable seat count (a definer function counting a firm's active staff), if seats in
    use must not wait for the daily rollup;
  - a retry schedule and grace period for failed payments (settings and the payment's retry state).
- **R1 / platform jobs:** the daily job that writes `platform_mrr_daily` and
  `platform_firm_metrics_daily` (until then the cards' trends and seats in use are empty), and the
  lifecycle job: Trial to Expired at its end, Non-Renewing to Canceled at the paid-through day,
  Past Due to Suspended when the grace period ends, RENEWED history rows at each renewal.
- **Billing (B3):** a payment processor for Firmivra's own billing (card on file, payment links,
  retries) when it lands; Billing's recurring runner and payments moving a subscription to Past Due
  and back. Credits stay Billing's (`createCreditNote`).
- **R6 (notify):** Firmivra's templates for the §10 events (trial expiring and extended, converted,
  payment failed, past-due reminder, suspended, reactivated, plan, seat and add-on change, Auto-Renew
  off, cancellation reversed).
- **R8 (support access):** an admin-side end of an open grant, if the banner's End button stays.
- **The Subscriptions API (next PR):** report status changes to the linked Sales opportunities in
  platform scope (Sales notes, B5's mapping), and write an audit row on every action. The audit
  rows are done (note 39); the Sales report is not (below, R1 / platform jobs).
- **R0 (found by the Subscriptions API):**
  - `platform_subscription_changes.amount_cents` (a change's charge or credit), so the history
    holds its money instead of the audit row (note 39);
  - a `reason` with the change kinds already asked for above (TRIAL_EXTENDED, PRICE_CHANGED with an
    `approved_by`, BILLING_DATE_CHANGED) and CANCEL_REVERSED, so those reasons leave B4's
    investigation notes (note 40);
  - `platform_invoices.subscription_id` and `platform_recurring_invoices.subscription_id`
    reference the subscription by id alone, unlike B3's other links (`(business_id, …)` keys): a
    composite key would keep an invoice or schedule on its own firm's subscription (the API always
    sets both from the same row);
  - the lifecycle job (R1, above) should also advance a subscription's period when Billing's
    runner bills its schedule: `current_period_start` and `_end`, `next_billing_date`,
    `paid_through_date`, and a RENEWED row (note 45).
- **R1 / platform jobs:** the Sales report (B5's mapping: Active, Past Due, Non-Renewing
  UNDER_CONTRACT; Expired CLOSED; Canceled TERMINATED) on every status change, in platform scope:
  the Subscriptions API runs in admin scope only and never writes `sales_opportunities`.
- **API (AuditService):** `logIn` could return the row it wrote; Subscriptions finds its own row by
  a one-off `ref` in the metadata to put the reason's note on it (note 40).
- **Billing (B3, R60):** one "today" for both modules: Billing counts days in America/New_York,
  Subscriptions in UTC (note 35).
- **Subscriptions screen owner (with the API):** a Non-Renewing subscription's changes are not
  prorated (the preview agrees); converting a trial with Auto-Renew off makes it Non-Renewing;
  reactivating a suspended trial gives a Trial; an event's amount is on its first history row only;
  the reason of TRIAL_EXTENDED, PRICE_CHANGED, BILLING_DATE_CHANGED and CANCEL_REVERSED is the
  event's `reason`.
- **Subscriptions screen owner:** switch from `mocks/admin-subscriptions.ts` to
  `api.adminSubscriptions`. Changes: plans from `meta()`; filters, sort and paging sent to the
  server; no Effective choice and no scheduled list; Manage Add-ons shows Additional Location only;
  the Discount dialog sets a negotiated base price (percentage without an end date, no promotion
  codes) and Account credit opens Billing's credit note; Payment Method, payment links and Retry
  are not available yet; Resend Invoice calls `api.adminBilling.sendInvoice`; Impersonate opens
  R8's request; the Account owner field goes; events worded with `subscriptionEventText`; the
  export is a link; previews use `previewSubscriptionChange` and `subscriptionBillingDateCents`.

## Questions for Rasel

1. Proration: the contract issues an invoice (charge) or a credit note (credit) for every
   mid-period change at once. Or should it only show and record the amount, and Billing bill it?
2. Without a card processor, a paid start, Convert to Paid and a restart make the firm Active with
   its first invoice open. The docx (§8) says never Active unless payment setup succeeds: is an
   issued invoice "set up", or should these wait for a recorded payment?
3. Close Account changes the subscription only. Should it also close the firm
   (`businesses.status` CLOSED, the Firms module's), as the mock's warning says ("access to the
   workspace and client portal ends")?
4. Notes ride on B4's audit investigation notes. Fine, or a table of their own (R0)?
5. MRR: the contract counts the paying subscriptions' prices (R0's rollup definition, Sales'
   projected MRR); Reports counts active recurring schedules. They agree while each paid
   subscription's schedule is kept in step, which the contract does. Confirm.
6. `price_cents_override` overrides the plan's base price (schema comment), so extra seats and
   locations still add. Confirm, rather than it replacing the whole price.
7. Which `subscriptions.*` permission keys guard the high-risk actions (close, price, billing date,
   suspend)? Today only Super Admins sign in, so every caller may do all of them.
8. (API) Converting a trial whose Auto-Renew was turned off makes it Non-Renewing for one paid
   period (§6.9: Auto-Renew never comes back on by itself), not Active. And a restart of a
   canceled or expired subscription turns Auto-Renew on (it is a new term the admin chose). Both
   right?

## Subscriptions API

The API PR (`apps/api/src/admin-subscriptions/`). Numbers continue the contract notes.

34. **The module.** A controller (20 routes, fixed paths before `/:id`, `@Roles('SUPER_ADMIN')`,
    every param, query and body through the contract's schemas), a reads service, a changes
    service and pure helpers (`subscriptions-math.ts`, `subscriptions-events.ts`). It is
    registered after `AdminBillingModule` and imports it for `BillingService`. Admin scope only
    (`AdminPrisma`): no firm scope, no platform scope. Prices, previews and proration are the
    contract's own functions, so the dialogs and the API answer the same numbers.
35. **Days are UTC days** (`meta.today`, trials, periods, proration, the billing date). Billing's
    pages and its recurring runner count days in America/New_York (`billing-common.ts` `today()`),
    so around midnight an invoice's Overdue or a schedule's run can be a day off the subscription.
36. **The table and the cards** load every subscription (at most 5,000) and work in memory: the
    firm from Billing's `loadFirms` (billing contact, else the first active owner; `canBill`), the
    domain from its application's `business.website` (`websiteHost`), seats in use from the latest
    `platform_firm_metrics_daily` row, credit from its Available and Partially Applied credit notes,
    an open support grant (approved, not revoked, not expired). Search, plan, cycle, status or group
    and the period (in force: started by its end, not ended before its start; Canceled ends on its
    close day, Expired on its trial's end) filter; sort keys put unknown values last either way,
    then the firm name; 25 a page. The next billing shows only while it renews (Active or Past Due
    with Auto-Renew on). The cards count now; `previous` is the MRR rollup's row for today − 30;
    renewals' previous counts distinct subscriptions with RENEWED rows in the 30 days before today;
    churn reads, per subscription, its last history row with a status before the period.
37. **The detail panel** runs Billing's due schedules first (`runDue`), then reads the firm's
    issued invoices and payments (50 each), the failed payments on its open invoices (Past Due),
    `pastDue.since` from the latest history row into Past Due, the account owner from the Sales
    record linked to the subscription (`transaction_kind` `platform_subscription`), else to the
    firm, that has an owner, the events (500) and the notes. The suspension's kind is the latest
    `subscription.suspended` audit row's `kind`.
38. **One transaction per change, under the row's lock** (`SELECT … FOR UPDATE` first): the
    contract's checks in order, then the subscription, its history row, Billing's documents, the
    schedule and the audit row. Two dialogs confirmed at once apply one after the other; a refusal
    anywhere (Billing's included) rolls all of it back. Database refusals the checks missed answer
    a code (`asSubscriptionError`: the unique `business_id` as 409 ALREADY_SUBSCRIBED, a missing
    row 404, any other check 400), never a 500.
39. **History and audit.** Each change writes its `platform_subscription_changes` row (from and to
    plan, status on every row, unchanged too, seats, reason, `mrr_cents` after it: the monthly price
    while paying, else 0, and the admin), and one platform audit row `subscription.<verb>`
    (`created`, `plan_changed`, `seats_changed`, `locations_changed`, `trial_extended`, `converted`,
    `auto_renew_off`, `cancellation_reversed`, `suspended`, `reactivated`, `price_changed`,
    `billing_date_changed`, `closed`, `note_added`, `exported`) with ids and codes only: `firmId`,
    `changeIds`, `amountCents`, `invoiceId`, `creditNoteId`, days, cents, codes. The history has
    no money column, so a history event's `amountCents` is read from the audit row naming it in
    `changeIds` (the first one only, when a plan change also changed the cycle and wrote two
    rows). The audit-only events carry `event` (TRIAL_EXTENDED, …) in their metadata.
40. **Text never goes in the audit metadata.** The reason of an audit-only event (TRIAL_EXTENDED,
    PRICE_CHANGED with its approver after a "\n\nApproved by: " line, BILLING_DATE_CHANGED,
    CANCEL_REVERSED) and an internal note are B4's investigation note on the event's audit row,
    written as the admin (the notes' RLS needs the author to be the caller). `logIn` returns no id,
    so the row is found by a one-off `ref` uuid in its metadata. A note edited in Audit & Security
    reads as its latest version; a retracted one reads as no reason.
41. **Money moves through Billing** in the change's transaction: a charge is Billing's
    `createInvoiceIn` (one line, "Team Pro (Monthly): plan change, prorated", the firm's tax rate,
    due by its terms (`firmTerms`), issued at once with `subscription_id`; its email is recorded as
    not set up, as Billing's), a credit `createCreditNoteIn` (one line, PRICE_ADJUSTMENT, issued
    Available; credit notes have no subscription column). Any change that would move money first
    checks the firm: 409 FIRM_NOT_BILLABLE unless it is Active with a billing contact (Billing's own
    check answers 400 for a missing contact).
42. **The recurring schedule** (`platform_recurring_invoices.subscription_id`, the latest Active or
    Paused one) is kept in step after every change: its line and amount at the price, its frequency
    the cycle, its next invoice the next billing day, its end the day before the paid-through day
    while Auto-Renew is off, Paused while suspended (or priced at nothing), Canceled once the
    subscription is Canceled. Only changed fields are written. A paid start, Convert to Paid, a
    restart, and a reactivation whose period ended meanwhile make the schedule if there is none and
    run today's occurrence through Billing (`runRecurringIn`): the period's first invoice is the
    schedule's, dated, due and sent as Billing's runner does. Only those make a schedule: a
    subscription paying without one (a seed, a status set by hand) gets one in Billing's drawer.
43. **What each change does, after its checks:**
    - `POST /`: the firm is Active or Pending Setup (422 FIRM_NOT_AVAILABLE, an unknown one too) and
      has none (409 ALREADY_SUBSCRIBED); the plan is active (422 PLAN_INACTIVE, an unknown one too);
      seats in the plan's range (422 SEATS_OUT_OF_RANGE) and not fewer than in use when the rollup
      knows (422 SEATS_IN_USE); locations only where sold; PAID needs a billable firm. Included
      seats and locations are the plan's, the rest purchased. Trial: from now to today + 14. Paid:
      Active, started now, a period of one cycle from today (paid through and next billing its
      end), the schedule and its first invoice. CREATED.
    - `/plan`: Trial, Active, Past Due or Non-Renewing (409 STATUS_NOT_ALLOWED); the plan (its own
      may be inactive); 422 NO_CHANGE; the preview's block; billable when money moves. Plan, cycle,
      seats and locations as the preview sets them, the new plan's included seats and locations,
      the negotiated price cleared on a new plan; a new cycle starts a new period today. UPGRADED or
      DOWNGRADED by display order (then the monthly price), and CYCLE_CHANGED when the cycle moves.
    - `/seats` and `/locations`: the same checks and proration; SEATS_CHANGED, or the audit event
      LOCATIONS_CHANGED.
    - `/extend-trial`: Trial only; the days go on the trial's end (today's, if it has none).
    - `/convert`: Trial only; the plan, the preview and a billable firm; Active (Non-Renewing if
      Auto-Renew was turned off in the trial, question 8), started now, a new period; STATUS_CHANGED;
      the schedule and its first invoice.
    - `/auto-renew/off`: 409 RENEWAL_ALREADY_OFF first, then Active or Trial only (Past Due and
      Suspended are 409 STATUS_NOT_ALLOWED); `cancel_*` set (the source as its code); Active becomes
      Non-Renewing, paid through the period's end; CANCEL_REQUESTED with the notes as its reason;
      the schedule ends with the period.
    - `/auto-renew/on`: 409 RENEWAL_ALREADY_ON first; Non-Renewing becomes Active (STATUS_CHANGED),
      a Trial stays one (the audit event CANCEL_REVERSED); `cancel_*` cleared; the schedule renews.
    - `/suspend`: a changeable status; NONPAYMENT only from Past Due; `suspended_*`; STATUS_CHANGED;
      the kind on the audit row; the schedule paused.
    - `/reactivate`: Suspended: 409 BALANCE_DUE while the firm's open invoices owe anything, then
      422 PAYMENT_CONFIRMATION_REQUIRED for a nonpayment suspension; back to Trial if it was one
      (never paid), else Active or Non-Renewing by Auto-Renew; a period that ended while suspended
      starts again today and is invoiced. Canceled or Expired: 422 PLAN_REQUIRED, an active plan,
      the preview, a billable firm; Active today on it with Auto-Renew on (question 8), the
      cancellation, closure and suspension cleared, a new schedule and its first invoice. Any other
      status: 409 STATUS_NOT_ALLOWED.
    - `/price`: not Canceled; 422 NO_CHANGE; `price_cents_override`; the schedule's amount from its
      next invoice, nothing prorated; the audit event PRICE_CHANGED.
    - `/billing-date`: 409 NO_BILLING_DATE without a next billing in the row, 422
      BILLING_DATE_OUT_OF_RANGE (after today, at most one cycle from today), 422 NO_CHANGE; the days
      added invoiced (the line's period from the old day to the new one), removed credited; the
      period moves whole (note 44), with the paid-through day and the schedule's next invoice.
    - `/close`: not Canceled; the typed name is the firm's, ignoring case and outer spaces (422
      CONFIRM_NAME_MISMATCH); Canceled, Auto-Renew off, `closed_*`, no next billing, no suspension;
      CANCELED; the schedule canceled. The firm's own status is untouched (question 3).
    - `/notes`: 404 for an unknown subscription; the audit event NOTE_ADDED and its note (201).
    - `/export`: the ids (filters then ignored) or the table's filters, by firm name, at most 1,000;
      formula-safe cells; one `subscription.exported` row (EXPORTED) per subscription.
44. **Traps found.**
    - A billing-date move that kept the period's start would leave a period shorter or longer than
      a cycle, and the contract's per-day price (`periodDays(start, next)`) for the next move or
      proration would follow it: a 10-day move after a first one could charge a full month. The
      whole period moves (its start one cycle before the new day).
    - The previews read `nextBillingOn`, which is null while Non-Renewing: a change on a
      Non-Renewing subscription is not prorated, and a cycle change does not move its period (the
      dialog and the API agree).
    - A suspended trial "back to Active" would be Active and never billed: it goes back to Trial
      (the history row into Suspended says what it was; else whether it ever started).
    - A paused schedule whose next invoice passed would make Billing's runner catch up (up to 12
      invoices) for the months suspended: a reactivation whose period ended bills today only.
    - A schedule bills at least a cent (Billing's `amountCents` ≥ 1): priced at nothing, it pauses.
    - A canceled schedule never changes (Billing's 409 SCHEDULE_CANCELED, not a contract code): only
      live schedules are touched, and a restart makes a new one.
    - The test database has no plans (seeded, not migrated, so truncated) and only an admin writes
      them: the tests make their own in admin scope.
45. **Not kept in step yet.** Billing's runner bills a subscription's next period from its schedule,
    but nothing moves the subscription's own period: once its next billing day passes, the row's
    period, next billing and proration read the old period until the lifecycle job advances it
    (Needs, R0 and R1). Linked Sales records do not follow status changes (Needs, R1).
46. **Billing change** (R60's own module, kept to new entry points). `BillingService` gained
    `createInvoiceIn(tx, body, subscriptionId?)`, `createCreditNoteIn(tx, body)`,
    `createRecurringIn(tx, body, subscriptionId?)`, `updateRecurringIn`, `setRecurringStatusIn`
    and `runRecurringIn`, each the body of the existing route method, which now calls it inside
    its own transaction (behaviour unchanged), and `firmTerms(tx, firmId)` (the firm's payment
    terms and tax rate, else Billing Settings'), which the schedule template now uses too.
    `AdminBillingModule` exports `BillingService`.
47. **Tests.** `test/unit/admin-subscriptions.test.ts` (prices, proration and previews, the row's
    dates, statuses, filters, sorting, churn, events and notes, errors, CSV),
    `test/e2e/admin-subscriptions.e2e.test.ts` (every route, the refusals, a firm Owner's 401, the
    audit rows and notes, the schedules), and `test/isolation/admin-subscriptions-writes.ts` (one
    admin-scope case per write, each on its own firm in the state it needs), wired into
    `admin-scope.test.ts` after Billing's lines (the Sales lines are on the Sales API branch).
