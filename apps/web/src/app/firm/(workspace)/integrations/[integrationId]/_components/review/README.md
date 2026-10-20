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

## Oct 20 review update

Overview: frequency and direction are Select controls populated from provider capabilities; Auto Sync writes existing typed settings and resumes a paused connection when enabled. Failed updates show a useful error, and read-only/offline controls stay disabled. Unknown environment is no longer labelled Live. Five focused browser tests, web TypeScript and focused ESLint passed. Desktop screenshots explicitly use 1440px.

Latest origin/main was merged before this verification. Synthetic data, empty and API-unreachable screenshots are 1440px; mobile evidence is 375px. The source mockup was cropped into three regions and compared with the rendered page. Existing asset/token/shell differences remain documented; exact visual sign-off and Tumit pre-review are pending. Evidence is published on the existing ibrahim/FIR-I01-integrations-screenshots branch.
