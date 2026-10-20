Firmivra Billing and Subscriptions Developer Guide
Full functionality corrections connected screens and acceptance tests
Prepared for the Firmivra developer on behalf of Octavia HolderScope Settings > BillingReview date October 18 2026
Implement the company’s subscription payments to Firmivra. Connect each card and button to the complete workflow below, including validation, confirmation, persistence and return navigation. This page manages the firm’s software subscription; customer invoices belong in the separate Invoices & Payments module.
Figure 1 Proposed billing page with connected navigation and action controls
Evidence: supplied billing screenshot and the requested mockup. The original screen reports an unconnected subscription, unavailable usage and no invoices. No successful payment or plan change was tested. Mockup values, card details, address, dates and usage figures are illustrative only; use actual authorized company data in production.
Color key: Blue — Current Plan; Teal — Usage; Purple — Payment Method; Slate — Billing Details; Green — Invoices; Navy — shared flows and tests.
# 1 Existing page and correction scope
Figure 2 Existing billing page shows disconnected and unavailable data
Area | Correction required
Current Plan | Connect the company to its subscription record. Show the actual plan, price, cycle, status and renewal information. Add Upgrade Plan, Downgrade Plan and View Plan Details.
Usage | Replace the unavailable placeholder with real plan usage, limits, period and a View Usage Details action. Show Retry for a failed request.
Payment Method | Load masked saved methods and the default. Add secure add, update, default and conditional remove flows.
Billing Details | Provide editable billing contact and address linked to the billing account. Do not use the example address from the mockup.
Invoices | Load the company’s subscription invoices newest first. Add View and Download PDF to each row, filtering and pagination.
States | Distinguish subscription not connected, no invoices, loading, provider error, past due and canceled. A failed fetch must not appear as a valid empty dataset.
Build priority: resolve subscription linkage and permissions first, then load all cards from the same billing account. Diagnose why linkage is missing before treating it as a billing status. Do not fabricate an active subscription for an unconnected workspace.
# 2 Navigation and connected screens
Location or control | Destination and return behavior
Main sidebar | Keep the established LVP navigation and highlight Settings. Selecting Settings opens its submenu; Billing is the selected subsection.
Settings > Billing | Open this Billing & Subscriptions dashboard for the authorized current company. Preserve company context through every dialog, provider page and return route.
Upgrade or Downgrade | Open the Firmivra plan-selection screen inside the app, with current plan marked and the relevant direction selected. Both buttons use the same plan catalog.
View Plan Details | Open a read only detail drawer or dialog for the current subscribed plan. Include pricing, billing cycle, features, limits, status, renewal and any scheduled change.
View Usage Details | Open the Usage Details drawer or page for this company and selected period; Back returns to Billing.
Payment controls | Open a secure payment-provider form or dialog. After completion or cancel, return to Billing and refresh the saved method list.
Edit Billing Details | Open a billing contact and address form. Save returns to the updated card; Cancel changes nothing.
Invoice View | Open that invoice’s detail viewer; Close or Back returns to the same invoice list, filters and page.
Invoice Download PDF | Download that invoice’s PDF. Stay on the current Billing page and preserve list state.
Payments submenu | Keep it distinct from Billing. Billing handles charges from Firmivra to the company. Do not send a subscription action to the client payment settings by mistake.
Plan screen dependency: the approved Firmivra pricing screen and plan catalog were not supplied for this guide. Reuse an existing approved plan screen if available. Otherwise build the selection screen described in section 4 using approved plan names, prices, features and limits. Do not invent them from the mockup.
# 3 Current Plan card
Field or action | Full functionality
Data displayed | Actual plan name and tier, subscription status, price and currency, monthly or annual interval, current billing period, renewal date, included limits and any scheduled change. Clearly identify trial or cancellation end dates when applicable.
Upgrade Plan | Open plan selection with eligible higher plans emphasized. Current plan remains marked. Allow comparison of price, features and limits before selecting.
Downgrade Plan | Open the same selection screen with eligible lower plans emphasized. Show what will be lost and whether current usage exceeds the target limits.
View Plan Details | Show the currently subscribed plan’s full details in a dialog or drawer. Include close, subscription status and next payment details. Opening the viewer makes no changes.
Plan selection | Selecting a target opens Review Plan Change, not an immediate subscription change. Show current versus target plan, cycle, estimated charge or credit, taxes when known and effective date.
Confirm and cancel | Only Confirm Plan Change submits a mutation. Disable during submission to avoid duplicates. Cancel keeps the existing plan unchanged. Require a fresh quote if pricing or eligibility changed.
Success | After confirmed provider success, refresh plan, limits, renewal data, relevant usage and invoices. Show a confirmation with new plan and effective date. A scheduled downgrade shows Pending change while the current plan remains active.
Failure | Keep the current subscription unchanged if the request fails. Show a useful retry message. A payment requiring verification returns the user to a secure provider flow; do not display success until verified.
Timing rules | Proposed default pending business approval: upgrades apply after successful payment; downgrades take effect at the next renewal. Use provider calculated proration. Never promise a refund or credit that the billing policy does not authorize.
Unavailable actions | At the highest or lowest tier, disable the unavailable direction with a reason. For canceled, unpaid, custom or unconnected accounts, show the relevant recovery or contact action instead of a dead button.
Cancellation is not the same as Downgrade. If subscription cancellation is supported by the product, expose it separately with its own end date and confirmation; do not make a lower tier silently cancel the account.
# 4 Firmivra plan selection and confirmation
Screen step | Required content and controls
1 Plan catalog | Title Change Your Firmivra Plan. Show current plan badge, approved tiers, prices with currency and interval, features, included seats and storage, and eligible Select Plan controls. Include Back to Billing.
2 Billing interval | If monthly and annual options exist, show a cycle toggle and the total payable amount for each interval. Do not imply a discount unless configured. Retain selection when opening the comparison.
3 Eligibility | Before review, check seats, storage, required features and other target limits. If blocked, explain exactly what must change and link to the relevant usage or staff screen. Never silently remove employees or delete data to downgrade.
4 Review change | Show current plan, proposed plan, cycle, next renewal, charge due now, credits and taxes when known, and the effective date. Clearly label a provider estimate versus a final total.
5 Confirm | Confirm Plan Change submits one idempotent request with the quoted price and eligibility checked again. If payment authentication is required, complete it through the provider; Cancel returns without applying the change.
6 Result | Success shows the confirmed new or scheduled plan and effective date. Back to Billing refreshes the dashboard. Failed or interrupted requests must be reconciled with provider state before offering a retry that could duplicate a charge.
7 Scheduled changes | Show the pending target and date on Current Plan. Provide View Scheduled Change and, if supported, Cancel Scheduled Change with confirmation. Canceling a pending downgrade preserves the current plan.
Not yet approved | Exact plan catalog, proration policy, downgrade timing, annual cycle rules, tax handling, refunds and cancellation rules require approved business configuration. Timing in section 3 is a proposed default, not a previously verified agreement.
Required screens to build or connect: Plan Selection, Review Plan Change, Payment Authentication when needed, Plan Change Result and Scheduled Change Details. Their screenshots were not supplied; the dashboard mockup is the visual reference, not evidence these screens already exist.
# 5 Usage card
Field or action | Full functionality
Usage summary | Show actual consumption against the current plan’s limits, with units and the measured period. Examples may include staff seats, storage and a clearly named monthly allowance; do not ship the generic Monthly usage label without defining what it measures.
Period | Show current billing start and end dates from the same subscription as Current Plan. Monthly counters reset according to the defined billing period; storage or seats may be current totals rather than resetting counters.
View Usage Details | Open a page or drawer listing metric, current amount, included limit, remaining allowance and measurement time. Include available period filters and clear metric definitions.
Progress and alerts | Calculate progress from actual data. Show approaching limit and reached limit states. Unlimited limits display Unlimited rather than an arbitrary percentage. Handle zero and missing limits safely.
At limit | Explain the affected operation and provide Upgrade Plan, which opens plan selection. Do not auto upgrade or charge for an overage without a separately approved policy and confirmation.
Data states | Show loading placeholders, genuine zero usage, or Unable to load usage with Retry. Keep error state separate from a missing subscription. Show last updated time if data is delayed.
Navigation and scope | Usage Details returns to Billing. Any link to staff seats or storage management retains company context and requires the relevant permission.
# Usage acceptance checks
Test | Expected result
Period consistency | Card and details agree with the provider billing period and configured metric definitions.
Limits | Known below limit, at limit, over limit, unlimited and zero limit records render correctly.
Upgrade handoff | Upgrade opens the same Firmivra plan catalog and displays no charge until confirmation.
Freshness | Reload and plan changes refresh limits; failures provide a working Retry.
# 6 Payment Method card
Action or state | Full functionality
Saved method display | Show provider supplied brand or method type, last four digits, expiration where applicable and Default badge. Never show full card numbers, security codes or bank credentials.
Add Payment Method | Open the provider’s secure collection form. Save validates the method with the provider; show verification steps when required. After success, refresh saved methods and confirm. Cancel creates no saved method.
Update Method | Open secure editing for the selected method. Where the provider cannot edit card details, collect and validate a replacement, set it as the subscription default, then offer to remove the old method.
Set as Default | For a nondefault saved valid method, ask confirmation and update the subscription’s collection default. Verify provider success before moving the Default badge. Disable or hide this action on the existing default.
Remove Method | Allow removal only after another valid method is saved and set as default. Identify the method in a confirmation. The only remaining method must have Remove disabled with the replacement instruction.
Replacement rule | Enforce the rule on the backend as well as in the interface. Do not remove the previous default until the replacement is accepted and the default switch succeeds. If either step fails, preserve the original method.
Multiple methods | List each masked method with its own eligible actions. A Remove action targets that method, not whichever method is currently first in the list.
No method or expired | Show Add Payment Method if none exists. Flag expired or unusable methods and offer Update Method. Do not mark a submitted but unverified method as usable.
Error and audit | Show errors for failed validation, denied updates or provider outages; do not expose sensitive provider payloads. Log actor, company, action and outcome with masked metadata only.
Exact required helper text: Add and set a replacement as default before removing your only payment method. The mockup’s Set as Default control should be disabled when the displayed method is already default. Saving a method does not automatically pay an invoice or change the plan.
# 7 Billing Details card
Field or action | Full functionality
Read view | Display the actual legal billing name, billing contact email and billing address associated with this company’s Firmivra subscription. Show tax identification fields only where supported and necessary.
Edit Billing Details | Open a prefilled form. Fields include company or legal name, contact name if used, billing email, address lines, city, state or region, postal code and country. Indicate required fields and supported regional formats.
Save | Validate required fields and email. Update the billing profile through the provider where applicable. Confirm only after persistence and refresh the card. Prevent duplicate submissions.
Cancel | Close without saving and keep the previous billing details. Warn before dismissing edited unsaved fields.
Failure | Preserve entered values and explain the validation or service error so the user can correct and retry.
Invoice effect | New billing details apply according to the provider’s invoicing policy. Never silently rewrite a finalized historical invoice. If a historical correction is needed, use the supported correction workflow.
Security and audit | Restrict editing to Owner, Admin or an explicitly authorized billing role. Log changes without unnecessary sensitive detail. Do not mistake billing contact edits for ownership changes.
The sample address and contact details in the mockup are placeholders, not the firm’s actual address. Pull saved values from the billing account; show Add Billing Details only when the data is genuinely absent.
# 8 Invoices card and document controls
Control or field | Full functionality
Invoice list | Show only Firmivra subscription invoices for the current authorized company, newest first. Columns include invoice number, issue date, amount and currency, status and row actions. Add due date or billing period to details.
View | Open the selected invoice in a dialog, drawer or invoice detail page. Display invoice number, seller and billing customer, period, line items, subtotal, discounts or credits, tax, total, paid or outstanding amount, status and payment date where available.
Viewer controls | Provide Close or Back and Download PDF. Return to the original filters and page when closing. Viewing does not change invoice data or payment status.
Download PDF | Download the selected invoice’s actual provider generated PDF with an identifiable filename such as Firmivra_Invoice_INV-1026.pdf. Stay on the list. Download from the viewer must retrieve the same document.
Unavailable document | If no PDF exists yet, disable Download with a reason or show a working retrieval error and Retry. Do not produce a blank file or claim download success when retrieval failed.
Filters | Date range and optional status filters refresh the list and reset pagination to page one. Keep invoice count and pages consistent; preserve filters when viewing and returning.
Statuses | Use provider statuses consistently, such as draft, open, paid, void or uncollectible. Show overdue only when due date and unpaid state justify it. Do not label all rows Paid by default.
Empty and failure | No invoices yet is a valid empty result. No invoices match filters is a filtered empty result. Unable to load invoices with Retry is a failure. Subscription not connected gets its own recovery message.
Protection | Invoices are read only for firm users. Do not provide Edit or Delete for finalized invoices. Authorize each invoice request and file download by company, not only by visible row or guessed ID.
An unpaid invoice may link to a separate secure provider payment flow if the product supports it. View and Download must never trigger payment automatically. A retry payment action, if added, requires a distinct review and confirmation.
# 9 Shared behavior and implementation rules
Requirement | Developer instruction
Access | Owner and Admin can manage company billing. Other users need explicit Billing View or Billing Manage permissions. Read only users cannot change plans, billing details or payment methods. Enforce all rules on backend requests and document download URLs.
Source of truth | Use the company’s mapped provider customer and subscription IDs. Reconcile confirmed provider events with application state. Never rely only on browser return navigation to mark payment or plan changes successful.
Consistency | Use one company scope and currency across cards. Refresh relevant records after successful changes; retain the old confirmed state on errors.
Concurrency | Avoid duplicate mutations from double clicks, refreshes or retried callbacks. Recheck eligibility and provider quotes at confirmation; show the latest state when another admin changed it.
Feedback | Every action must show loading, success and meaningful failure states. Keep form values on failure. Buttons have accessible labels, keyboard navigation and visible focus; dialogs close correctly and return focus.
Audit | Log plan change requested and confirmed or failed; scheduled changes; method add, default switch and removal; billing details updates; and invoice view or download events if audit coverage requires them. Include actor, company, target, time and outcome; exclude secrets.
Privacy | Use secure provider components for financial credentials. Keep credentials and payment tokens out of ordinary logs, invoice URLs in chat, and application analytics.
Connected account missing | For a firm with a purchased subscription, repair the mapping. For a firm with no subscription, show a clear Select Plan or authorized billing setup flow. For a provider outage show Retry. Do not collapse these into one generic placeholder.
Testing | Use development payment-provider records and test methods. Do not charge a real card while verifying this guide. Confirm provider state and persisted app state after refresh.
Mockup details to correct during implementation: show the actual subscribed plan name and price; define Monthly usage precisely; use real billing-period dates; disable Set as Default for the already default method; and replace all demo profile, address and invoice values.
# 10 Acceptance test register
Record Pass or Fail, build, tester, execution date and evidence for each test. All below are required tests; no end to end billing success has been verified in this review.
ID | Action and expected result
B01 Navigation | Settings > Billing opens the dashboard; both navigation levels are selected. Company scope remains intact.
B02 Data states | Test loading, connected subscription, no subscription, broken mapping and provider failure. Each produces the correct state and recovery.
B03 Plan details | View Plan Details shows the actual subscribed tier, price, interval, limits, dates and status; Close changes nothing.
B04 Upgrade entry | Upgrade opens plan selection with current plan marked, eligible higher tiers and approved prices.
B05 Downgrade entry | Downgrade opens the same catalog, highlights eligible lower tiers and explains lost features and limits.
B06 Eligibility | A downgrade below usage is blocked with specific remediation links. No data or employee is deleted automatically.
B07 Review and cancel | Plan selection leads to a complete price and effective date review. Cancel leaves subscription unchanged.
B08 Confirm upgrade | Test confirmation and required payment verification. Apply only after provider confirmation; refresh limits and billing.
B09 Scheduled downgrade | Confirm a downgrade under the configured policy; show current plan and pending target date correctly. Test scheduled cancellation if supported.
B10 Failed or repeated request | Payment failure, timeout, double click and return reload do not create duplicate charges or false success.
B11 Usage | Summary and detailed metrics match actual period and limits; test zero, unlimited, at limit and fetch failure.
B12 Add method | Secure add validates and saves a test method; Cancel and validation failure do not create unusable entries.
B13 Update and default | Replace or update a method; default switches only after validation. Existing default action is disabled.
B14 Remove protection | Only method cannot be removed through UI or backend. New default must succeed before old method removal.
B15 Billing details | Edit, validate, save, cancel and failure recovery work. Refresh shows saved data; old finalized invoices stay unchanged.
B16 Invoice View | Correct row opens correct invoice detail with line items, total, currency, status and billing identity.
B17 Invoice Download | List and viewer download the same correct PDF. File opens and matches invoice number and amount; failures provide recovery.
B18 Filters and pages | Date and status filters, pagination and returning from viewer preserve accurate results and list state.
B19 Access isolation | Authorized billing roles work; unauthorized users cannot mutate or read another company’s billing or PDFs via direct URLs.
B20 Audit and persistence | All billing changes have accurate safe audit records; refresh and provider reconciliation retain confirmed state.
# Approval dependencies
Before release confirm the approved Firmivra plan catalog and existing plan screen, metric definitions, upgrade and downgrade effective dates, proration and credit rules, cancellation policy, billing role permissions and payment-provider integration. These configuration decisions must be consistent on the plan screen, confirmation screen, invoices and dashboard.