# R55: Integrations

Notes for the Integrations contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-templates-api.md`.

## Steps

- [ ] 6. Integrations. 6a [x]: contract (`packages/types/src/integrations/`, `createIntegrationsClient` as `api.integrations`). 6b: API.

## Progress

- 2026-10-18: step 6a, the Integrations contract: main page (summary cards, tabs, Live/Test mode, health, data-mapping summary, recent activity), marketplace (categories, featured, sort, search), provider definitions (what each can sync, sign-in method, permissions in plain words, options, credential fields, mapping fields), connect and reconnect (OAuth redirect or write-only credentials), the Manage page (overview, sync settings, sync now, pause, resume, test, health, history, run detail, mappings, permissions, disconnect), requests for an integration not listed, and Custom API and Webhooks.

### Integrations (step 6)

1. **Providers are codes** from a catalog in the API (`IntegrationConnection.provider` is a free string the API checks). No screen hard-codes one; `overview()` and `marketplace()` list them, `provider(code)` gives the setup definition. The 18 launch providers (QuickBooks, Microsoft 365, Google Workspace, Stripe, Plaid, Dropbox Sign, Zoom, Textmagic, Website and Lead Forms, Custom API and Webhooks, a tax-software framework, a payroll framework, Square, Xero, Calendly, HubSpot, Mailchimp, Shopify) are the API's catalog, not the contract's.
2. **No secret ever comes back.** Responses carry facts and a masked tail only. OAuth tokens live in the secret store (`secretRef`); an API key is sent once, write-only, on connect. The custom-integration secret is write-only too (`rotateCustomSecret` answers its last 4 characters). If a one-time reveal of a webhook signing secret is wanted, that is a product decision, not made here.
3. **OAuth flow**: `connect` answers `{ mode: 'REDIRECT', url }`; the provider calls the API's callback, which saves the connection and sends the browser back to `/integrations/{provider}/setup?result=connected|failed`. The settings picked before connecting travel in the request and are kept until the callback (sealed in the state), so a failed authorization loses nothing. Options whose choices come from the provider (mailboxes, calendars) are marked `afterConnect` and are chosen on the Manage page after connecting.
4. **Pending records** (Integration Health) has no table: it reads the count of QUEUED sync runs until the sync engine keeps a real queue.
5. **Custom API and Webhooks** keeps its non-secret setup (endpoint, auth method, events, enabled) in `integration_connections.settings` and the secret in the secret store; no schema change. Test requests and deliveries are `integration_sync_runs` with entity `test` and `webhook`.
6. **Request an integration**: the firm creates and lists its own requests (`integration_requests`); Super Admin reviews them (status, internal note) in its own console, and the internal note is never in this contract.
7. **Disconnect**: the connection stays (status DISCONNECTED), imported records and history stay, the secret is removed and the provider's access revoked. At most one connection per provider and environment, except providers marked `multipleConnections`.
8. **Roles**: Owner and Admin always; the permission grid's INTEGRATIONS capabilities for the others (`canManage` tells the screen). Staff-level access is read-only by default.
9. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`. A mock is a frontend task (Ibrahim).
