# T02: business settings/setup implementation

The nine routes in `settings.yaml` are registered in SettingsModule with the existing guards.
Shared Zod requests/responses are in `packages/types/src/firm-settings.ts`.
Current main's FirmLegalDocument stores Markdown in **body**; the API calls it **bodyMarkdown**.

- Existing profile/contact/branding/signup settings can be read/changed by OWNER/ADMIN.
  Legal name, slug, business status and tenant identity are not writable.
- Legal publication and setup updates lock this firm's Business row within `Database.withScope`.
  Concurrent publication allocates distinct versions; published versions remain immutable.
- Completion rechecks branding, contact details, an active owner and both published legal kinds.
  Repeated completion retains its original timestamp and does not approve/activate a firm.
- Portal settings/legal are projected for a verified active client; internal contact/progress/storage keys are excluded.
- Every successful route audits safe ids/field names or step/version metadata, never document/contact contents.

## Owner-managed integrations

`SettingsAssets` is a Nest provider port for Rasel's storage/module entitlement services.
Until wired, new logo keys and newly activated modules return a clear 503; clearing a key,
keeping existing modules and disabling modules do not require those services. A stored logo URL
is null until the signing adapter is available. This does not fake an S3 upload or grant paid access.

PortalName/header/welcome reads are null if the requested columns are absent. Writes check the
schema within the transaction and return 503 SCHEMA_NOT_READY, rolling back any accompanying
profile edits. These are not silently stored inside setupProgress. Rasel owns the migrations.

## Verification

Tests cover all routes, foreign-firm 404 and wrong-role 403, DTO projections, unknown/context fields,
invalid timezone, concurrent legal versions, original-version retrieval, incomplete/idempotent setup,
dependency rollback and redacted audit metadata. Suites create independent synthetic firms and
use a stable ephemeral HTTP listener so concurrent requests do not close each other's test server.

Pair approval, schema handoff and merge remain pending. This branch starts at origin/main a0bee59.
