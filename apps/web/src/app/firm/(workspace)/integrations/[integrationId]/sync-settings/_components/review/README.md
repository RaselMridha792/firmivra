# Integration Sync Settings — I01

Scope: only the existing `/integrations/[integrationId]/sync-settings` route. The page stays a server component with its metadata title. The client screen and helpers live beside this page and do not depend on the unmerged Overview PR.

## Design and specification

Reference: `docs/mockups/firm-workspace/integrations/source/manage-integration-u2013-quickbooks-online.jpg` and `integrations-developer-instructions.docx`, section 3, Frame 2.

The supplied image has Overview selected; it names Sync Settings but does not supply a separate Sync Settings body. This tab keeps the reference's common management header and six-tab navigation. Its body uses the documented Sync Controls and Sync Data sections; Overview-only connection details, mapping, history and health panels remain on their own pages.

Element inventory:

- Breadcrumb: Integrations, connected provider, Sync Settings.
- Header: provider tile, name, status badge, summary and description; last and next sync; Sync Now, View Sync History and an overflow menu.
- Navigation: six management links, with Sync Settings active.
- Sync Controls: two action buttons, Auto Sync toggle, frequency and direction selectors, scheduled-sync callout and last-sync text.
- Sync Data: every provider-supported object, checkbox, icon and description; Save Sync Settings, pending feedback, success and retryable failure text. The reference's eight QuickBooks objects are present in the synthetic fixture.
- Loading, empty, API-unreachable, forbidden and read-only states retain the header, navigation and both widget frames. Unknown metadata is not replaced with invented values.

## Behavior

- All data and mutations use the existing `api.integrations` functions through the shared query/mutation hooks. Draft fields derive from the existing contract type.
- Automatic frequency choices and sync directions come from provider capabilities. Selected objects narrow the permitted directions; a compatible fallback is chosen from that list, never assumed to be IMPORT.
- Manual mode sends a null frequency. Automatic mode requires a supported frequency. Invalid or unchanged settings cannot be saved.
- Pause/resume and refetches preserve unsaved edits. Successful saves reset the draft to the confirmed server settings; failed saves retain edits for retry.
- Read-only, loading and unavailable states cannot write settings. No new API, endpoint, schema, package, token or shared shell changes.
- Only synthetic typed fixtures are used in browser request interception; they are not production fallback data.

## Visual limitations

- The common shell's typography, spacing and branding use existing `packages/ui` tokens. No independent Sync Settings body mockup is supplied, so exact comparison of that body is unavailable.
- No approved QuickBooks logo asset is supplied; the contract-supported initial fallback remains. The existing shell's development indicators can appear in test evidence.
- Filled Phosphor icons are used. Source and tests remain within Ibrahim's page, mock and test ownership.

Validation results and the 1440px data/empty/offline plus 375px evidence are recorded in the PR after verification. Pair pre-review and final design approval are not claimed.

## Verification — Oct 20

- Nine focused Chromium scenarios passed, including save/retry, supported-direction selection, Manual/Auto frequency payloads, pause/resume with unsaved edits, empty/offline/forbidden/read-only states, and mobile overflow.
- Web TypeScript, scoped ESLint and formatting passed.
- Adjacent screenshots are verified at 1440px desktop and 375px mobile. Synthetic fixtures only.
- Latest fetched origin/main was merged before this verification. Tumit pre-review remains pending.
