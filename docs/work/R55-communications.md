# R55: Communications

Notes for the Communications contract (contract-only PR; the API comes later in the queue). Other notes: `R55-handoff.md`, `R55-templates-api.md`, `R55-integrations.md`, `R55-automations.md`.

## Steps

- [ ] 11. Communications. 11a [x]: contract (`packages/types/src/communications/`, `createCommunicationsClient` as `api.communications`). 11b: API (with the delivery job and provider events).

## Progress

- 2026-10-18: step 11a, the Communications contract: overview (metric cards, channel readiness, recent, scheduled, templates, segments), the lists behind the tabs, the New Communication draft (from a channel or a template snapshot), the channel-aware composer (autosave with etag, channel change with confirmation, preview, test send, attachments, announcements with a publish window), senders, Choose Recipients (candidates by view, select all, audience with automatic and manual exclusions and the final count), Review & Send, send, schedule, reschedule, cancel, pause and resume, results (metrics, funnel, trend, recipients, activity, export), duplicate, resend failed, follow-up, archive, segments and lists with a criteria builder and live preview, and consent.

### Communications (step 11)

1. **Templates stay in the Templates module.** `POST /communications` with `templateId` and `POST .../use-template` copy a snapshot into the draft (the master is never changed); the draft keeps `template_id` and `template_version` for the audit. `save-as-template` makes a NEW template. Merge fields are `api.templates.mergeFields()`; preview reuses the Templates `RenderedTemplate`. The Templates API's `TemplateRenderService` renders and records the use (`message_template_uses`, purpose `communication`) on a real send only, never on a test or preview.
2. **Frozen at send.** Leaving DRAFT or SCHEDULED freezes the content, sender and audience as an immutable snapshot (`communications` row, `communication_audience_entries.criteria_snapshot`, `communication_recipients`). Resend Failed, Duplicate and Follow-Up make a NEW draft (`source_communication_id`, `source_kind`); the original never changes. A scheduled campaign locks a few minutes before its send time (`lockedAt`).
3. **Eligibility is recalculated on the server right before every send** (consent and suppression by channel, invalid or missing address, duplicates across segments and individuals, company boundaries, Staff reach). Automatic exclusions cannot be overridden; manual ones are kept with the campaign. If the final count moved since the review, send answers 409 `AUDIENCE_CHANGED` and the screen confirms the new count (`expectedFinalCount`).
4. **Idempotent send.** `idempotencyKey` (`communications.idempotency_key`) makes a double click, a retry or a repeated request answer the same campaign. Delivery runs in a background job; the browser need not stay open. Provider events are normalized to the delivery statuses (`communication_events`, unique `provider_event_id`).
5. **Providers and senders come from Integrations.** Channel readiness (`channels` on the overview, `senders`) reads the connected email or SMS provider and its verified sender identities; a disconnected or expired provider blocks a production send with the route to Integrations. The first API has no provider adapter: until an email or SMS provider is connected, the channels are not ready (`CHANNEL_UNAVAILABLE`). Test send needs the same provider and, for email and SMS, a Templates or Communications message in `NotifyService` (R6) that this module does not own.
6. **Masking.** Addresses and numbers are never returned in full: recipients carry `addressMask` ("j***@example.com"); exports are masked CSV. Logs and audit hold ids and codes only.
7. **Opens are directional.** Not every provider reports opens and clicks; `supports` says which the cards can show.
8. **Roles and reach.** Owner and Admin may always; the grid's COMMUNICATIONS capabilities decide Create, Edit, Send, Schedule, Export, Resend, Archive, Templates and Segments; Staff reach only clients assigned to them in the candidate lists and segment counts.
9. **Schema gaps (no schema change made):**
   - **Sender identities** have no table: they are derived from `integration_connections.settings` (non-secret options) of the email and SMS providers; the sender id in this contract is the connection's id plus the identity key, made by the API.
   - **Announcement locations** (where the portal shows an announcement) have no table; the API serves the portal's known locations from code. A published announcement shows in the portal through `communications` rows of channel ANNOUNCEMENT between `publish_starts_at` and `publish_ends_at`, so the portal API needs a read route (a Client Portal task, not here).
   - **Segment criteria fields** are the API's catalog (status, service, tags, state, appointment and invoice status, tax year, workflow status, created date, last communication, custom fields).
   - **Scheduled campaign lock time** is a rule in the API, not a column.
10. **No mock** yet: the client is real-API only in `apps/web/src/lib/api.ts`.
