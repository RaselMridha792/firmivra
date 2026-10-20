Firmivra Payments Settings Developer Guide
Corrections and required flows for the existing Payments pagePrepared for the developer • October 18 2026
Update Settings → Payments using the original screen and revised design below. Stripe is already automatically attached, as confirmed by the owner. Preserve that integration; do not require an initial Connect Stripe step. Add optional Square and PayPal connections and complete the payment and payout controls.
Scope: this guide updates the existing Payments page. Billing and Subscription remains the separate area for the firm’s payments to Firmivra. The screenshots document visible UI and proposed layout, not proof that backend flows have been tested.
# Original screen and correction locations
Control or area | Required behavior
A  Stripe card | Keep the existing attached Stripe account. Add Manage Connection and live readiness details.
B  Empty content area | Add Square and PayPal cards, accepted payment controls and provider payout settings.
C  Navigation | Restore the LVP main sidebar and Settings submenu shown in the revised screenshot. Highlight Settings and Payments.
# Revised page and placement map
Figure 2 is the proposed target layout. Use the tables as the functional specification when the mockup abbreviates behavior. All connection badges, toggles and provider capabilities must use live firm-specific data.
Control or area | Required behavior
Left navigation | Main sidebar: Settings active. Settings submenu: Payments active. Preserve other destinations and navigation history.
Top content row | Stripe, Square and PayPal provider cards. Stripe remains attached; other providers are optional.
Lower left | Accepted Client Payments and default processor controls.
Lower right | Payout Settings for the selected connected provider. Add a provider selector when multiple providers are connected.
Bottom link | Open the main Invoices & Payments module with the current firm preserved.
Color key: blue tables cover navigation and payment controls; green covers Stripe; gray covers Square; pale blue covers PayPal; lavender covers payouts. Each card has its own table.
# Stripe card corrections and flow
Control or area | Required behavior
Existing integration | Retain the automatically attached Stripe account and existing payment references. Do not create duplicate accounts or ask this firm to connect again.
Status | Read status from the provider integration. Separate Connected from Payments enabled and Payouts enabled. Show Action Required when verification or capability restrictions exist.
Manage Connection | Open the existing authorized Stripe account management flow, hosted or embedded according to the current integration. Return to this page and refresh status.
Return and cancel | On verified return refresh server-side status. Cancel preserves the current connection and settings. Failure shows a retry action without falsely showing success.
Disconnection | Do not expose a generic disconnect action for the automatic Stripe integration unless the product explicitly supports it. Never delete transaction history.
# Square card addition and flow
Control or area | Required behavior
Connect Square | Start secure provider authorization for the signed-in firm. Bind the callback to that firm and session; request only required permissions.
Success | Verify the authorization server-side, save credentials securely, fetch merchant details and payment capabilities, then show Connected and Manage Connection.
Cancel or failure | Return without changing settings. Show Not connected or the actual prior state and an actionable retry message.
Manage Connection | Open account details and supported provider management. Support reconnect for expired or revoked authorization.
Disconnect optional provider | Confirm impact. Require replacement of affected default routes first. Preserve historical payments, refunds and reconciliation access where supported.
# PayPal card addition and flow
Control or area | Required behavior
Connect PayPal | Start the supported business onboarding and authorization flow. Production platform approval and provider prerequisites must be completed before enabling live connections.
Success | Verify merchant identity and readiness server-side before offering PayPal at checkout. Show Manage Connection after connection.
Cancel or failure | Keep PayPal checkout off until ready. Preserve other payment methods and display retry guidance.
Manage and disconnect | Show the connected business and actual capabilities. Reconnection and confirmed disconnection follow the same history-preservation rules as Square.
# Accepted Client Payments card
Control or area | Required behavior
Default card processor | List only connected, payment-ready providers supported for card routing. Stripe is the starting default. Select → validate capability → save → confirm. Never move an existing charge to another provider.
Credit and debit cards | On permits supported card checkout through the selected card processor. Off removes new card checkout options; existing charges and records remain accessible.
ACH bank payments | Enable only when the chosen ACH route is connected and capable. If the default card processor lacks ACH support, keep a separately configured eligible ACH provider such as Stripe. Do not assume all processors support identical methods.
PayPal checkout | Enable only after PayPal onboarding and readiness checks. Clients see PayPal alongside the enabled card and bank methods.
Saving controls | Add a visible Save Changes button for these settings; draft changes remain unsaved until confirmation. Cancel or leaving with unsaved changes offers discard or stay. On failure retain draft values and show an error.
Prevent invalid setup | Reject unavailable provider choices and prevent unintentionally disabling the last online method when online invoice payment is required. Explain the dependency.
Client experience | Checkout shows only enabled, supported methods. Display pending ACH as Processing until verified success; do not mark the invoice Paid at initiation.
# Payout Settings card
Control or area | Required behavior
Provider selector | Default to Stripe. When other providers are connected, select the provider whose payout information is being managed. Each maintains its own destination.
Manage Bank Account | Open the selected provider’s secure supported bank-management flow. Do not collect raw bank credentials in an ordinary Firmivra form. On return refresh masked bank name, last four digits and verification state when available.
Missing bank account | Show Add Bank Account or Complete Setup. A connected processor may still require payout verification.
Instant Payouts | For Stripe, Check Eligibility fetches actual account and destination eligibility. Offer an eligible debit card or eligible bank account only when supported. Never offer credit cards as payout destinations.
Payout confirmation | If requesting payouts is implemented, show amount, destination, provider fee and net amount before confirmation. Validate available balance and eligibility server-side; show pending, paid or failed from provider updates.
Ineligible account | Explain that standard bank payouts remain available according to account status; do not promise instant availability. New Stripe accounts may not qualify immediately.
Manage with provider | Square and PayPal payout actions use their own supported management paths. Do not reuse Stripe eligibility or bank details for them.
# Connected flows and backend requirements
Control or area | Required behavior
Invoice creation | Persist enabled checkout methods and provider routing according to documented invoice policy. Refresh current capability before accepting a new payment.
Payment confirmation | Use signed provider events and server-side verification as the source of truth. A client redirect alone never marks an invoice paid.
Duplicate protection | Use idempotency for payment creation and payout requests. Deduplicate provider events and tolerate out-of-order delivery.
Transaction records | Store firm, provider, merchant account, provider transaction ID, invoice ID, amount, currency, method and status. Reconcile gross, fees, net and refunds without treating bank payouts as additional revenue.
Refunds | The original provider processes refunds. Main Invoices & Payments opens payment details and refund actions; this settings page configures defaults and connections.
Permissions | Owner or staff with explicit payment-settings permission can change providers, routing and payout settings. Enforce on the server. Other staff receive read-only or restricted views.
Firm isolation | Scope all tokens, callbacks, queries, cache entries and events to the correct firm. Branding comes from the firm; LVP is the screenshot example.
Audit events | Log actor, firm, time, action, provider, before and after non-sensitive state, result and correlation ID. Never log raw card details, bank credentials or access tokens.
Loading and errors | Use loading indicators, unavailable states and retry controls. Never hard-code Connected or On. Preserve safe settings on network or provider failure.
Accessibility | Keyboard access, visible focus, labeled toggles, status text in addition to color, and responsive stacking without hidden actions.
# Implementation clarifications
The generated image is a layout reference. Replace “No account details displayed” with actual masked information when available, or an explicit setup state. Add Save Changes and Cancel for editable payment defaults. Add a payout provider selector for multiple connected providers. Keep Stripe attached without an initial connection step. Square and PayPal require completed integrations before their buttons can perform real authorization.
This guide defines required behavior; it does not certify existing code or provider-account eligibility. The developer must confirm the current Stripe account model and available management components, Square production authorization, and PayPal platform onboarding requirements before release.
# Developer acceptance tests
Control or area | Required behavior
01 | Existing firm loads with the same attached Stripe account; no Connect Stripe prompt or duplicate account.
02 | Connected status and payment or payout restrictions reflect provider data.
03 | Manage Stripe opens the correct account flow and refreshes on return.
04 | Square connects to the correct firm; denial and cancellation preserve existing settings.
05 | PayPal onboarding verifies readiness before enabling checkout.
06 | Revoked authorization produces Action Required and reconnect guidance.
07 | Default processor lists only connected capable choices and persists after reload.
08 | Changing card processor leaves historical payments on the original provider.
09 | ACH routing remains explicit when card and ACH providers differ.
10 | Save and Cancel behave correctly; failure does not falsely report success.
11 | Client checkout reflects enabled card, ACH and PayPal options only.
12 | ACH processing stays pending until provider-confirmed success; failure restores the correct balance.
13 | Bank account management uses the correct provider and refreshes masked details.
14 | Stripe ineligible accounts cannot request Instant Payouts.
15 | Eligible payout confirmation shows destination, fees and net; retries do not duplicate payouts.
16 | Provider switching never exposes another provider’s bank details.
17 | Optional-provider disconnection resolves active default dependencies and preserves history.
18 | Refunds use the original payment provider and update invoice balance correctly.
19 | Duplicate or out-of-order events do not duplicate receipts, revenue or status transitions.
20 | Unauthorized staff and cross-firm requests cannot change settings or view sensitive details.
21 | All setting changes create safe audit records without credentials.
22 | Settings and Payments highlights, browser back, and Invoices & Payments link work.
23 | Keyboard, mobile reflow, empty data and provider/network error states are usable.
# Provider documentation
Stripe payouts: https://docs.stripe.com/payouts
Stripe Instant Payouts: https://docs.stripe.com/payouts/instant-payouts
Square authorization: https://developer.squareup.com/docs/oauth-api/overview
PayPal seller onboarding: https://developer.paypal.com/platforms/seller-onboarding
Provider support checked October 18 2026. Availability remains account, country and integration dependent. These references support provider capabilities; page flows above are Firmivra implementation requirements.