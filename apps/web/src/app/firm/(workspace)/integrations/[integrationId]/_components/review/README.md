# Manage integration overview review

Scope: `/integrations/[integrationId]` Overview only. The branch starts from fresh main and does
not depend on another unmerged integration branch.

The screen uses `api.integrations.connection`, `sync`, `pause`, `resume`, `updateSettings`, `test`
and `disconnect`. All displayed values come from `IntegrationConnectionDetail`; no provider,
connection or capability fields are inferred in the UI. Tests use synthetic QuickBooks-shaped
contract fixtures.

States covered: data, empty, API unavailable and mobile. Empty/API-unavailable states retain every
approved widget frame. Disconnect requires confirmation and explains that imported records and
history remain.

Known visual difference: the repository contains no QuickBooks logo asset, so the provider header
uses a token-coloured initial. No external asset or hard-coded brand colour was added.

Validation: four focused Chromium tests pass (data/actions, empty, API unavailable and 375px),
with committed 1440px and mobile review screenshots. Web TypeScript and changed-file ESLint pass.
