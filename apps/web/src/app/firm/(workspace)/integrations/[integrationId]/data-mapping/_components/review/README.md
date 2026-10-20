# Data Mapping — I01

Reference: Manage Integration Frame 2 and the Integrations docx section 3. The shared header, six-tab navigation, scope cards, Configure Mapping, Add Field, Cancel and Save Mapping remain in the existing main implementation introduced by R56 in #937.

## Focused improvements

- Mapping directions come from provider capabilities; new rows choose a supported default. Existing unsupported directions remain visible.
- Saves validate catalog membership, duplicate local fields, supported directions and the 200-pair contract limit before sending a request.
- Removed catalog fields stay visible and labelled unavailable until explicitly removed. A whole scope can be cleared even if no directions remain supported.
- Read-only access disables editors, add/remove and save controls. The submit handler checks access; failed connection queries cannot authorize writes using cached role data.
- Mapping-query errors keep the error/retry frame even with cached data. Failed saves preserve edits. Each scope retains its own draft and saves independently.
- Mapping icons use filled Phosphor variants. No shared shell or API files change in the PR.

## Inventory

The existing header contains provider name/status, purpose, description, last/next sync, Sync Now, history and overflow actions. Six navigation links remain. Every provider-defined scope has a title, actual mapped count, Configure Mapping, a three-column field table or quiet empty line. Editing retains local/provider/direction selectors, Add Field, remove actions, Cancel, Save and validation/retry feedback.

Synthetic fixtures cover five scopes and the seven reference mapping examples, plus an unmapped email field. Evidence is 1440px for desktop data/empty/offline states and 375px for mobile. Fixtures intercept browser requests only; production has no fixture fallback.

The shared shell uses existing tokens and an initial logo fallback. Brand asset and shared-shell differences are inherited from main and remain for design review. The screenshot's Overview-only panels are not duplicated into this tab; its mapping preview and written contract guide the editor.

Validation results are recorded in the PR. Pair pre-review and final design approval are not claimed.

## Verification — Oct 20

- Twelve focused mapping scenarios and main's existing R56 Data Mapping regression passed: 13 Chromium tests total.
- Web TypeScript, focused ESLint and formatting passed.
- Attached desktop evidence is 1440px; mobile evidence is 375px. Only synthetic fixtures are used.
- Branch starts from latest fetched main (91c46e17); no other tab or shared shell implementation changes.
