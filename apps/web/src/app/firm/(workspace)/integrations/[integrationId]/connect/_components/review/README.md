# Connect and Configure Integration (I01, Frame 3)

Scope: only the four pre-existing Connect, Configure, Permissions and Complete routes.
Provider definitions, supported settings and permissions come from api.integrations.provider.
Writes use api.integrations.connect and api.integrations.test through useApiMutation.
This branch is independent of the unmerged list and marketplace PRs.

## Design inventory

Reference: docs/mockups/firm-workspace/integrations/source/connect-configure-integration-u2013-microsoft-365.jpg.
Written behavior: integrations-developer-instructions.docx section 4.
The header/authorization area, preferences area and permission/completion area were cropped,
enlarged and inspected independently before the final comparison.

- Shared shell: sidebar, top search/actions, user menu and footer remain owned by the shell.
- Breadcrumb: Integrations, Add Integration, provider.
- Provider header: logo fallback, name, description, connection badge, Learn More.
- Left rail: 4 numbered links, active state, label and explanatory line per step.
- Authorization: numbered title, explanation, provider sign-in, secure authorization notice,
  included-capabilities panel (4 sync objects plus the provider's appointment/email-linking options).
- Preferences: 3 framed columns. Data to Sync has 4 Microsoft object checkboxes and descriptions.
  Sync Settings has frequency, direction, calendar and 2 labelled toggles.
  Account options has the mailbox, 5 folder checkboxes and Add Custom Folder.
- Permission panel: numbered title, subtitle, shield, 5 provider permissions. Object permissions
  disappear when that object is not selected; always-required profile access stays.
- Completion: numbered title, explanation, test-sync checkbox and hint, Cancel, Connect & Continue.
  Actual connected/test results appear only after the API returns them.
- Empty, loading, offline and denied access retain all four section frames.

## Intentional differences and blockers

- Shared PageHeader uses the site's serif display font; all other text uses the shared font,
  spacing and colour tokens. The mockup's tighter spacing, branded blue and global shell are
  not overrides to the current design system.
- No approved Microsoft logo asset exists in the kit. A filled Phosphor Plugs tile is used.
  The provider authorization button uses LockKey. Entity icons are filled Phosphor equivalents.
- The generic options use the provider catalog's defaults, not the sample mailbox or checkmarks
  from the image. Mailbox choices are unavailable until authorization; no account is fabricated.
- Add Custom Folder stays visible but disabled: the current provider catalog exposes an
  enumerated folder list and no custom-folder capability. This needs a contract decision.
- Unsupported directions are omitted from the selector and supported choices are explained.
- Setup keeps the contract-provided environment internally and sends it with the connection
  request. The selector is intentionally hidden because it is absent from the approved mockup;
  Microsoft 365 therefore uses the provider's default environment.
- Backend handoff: apps/api/src/integrations/integrations-callback.controller.ts returns OAuth
  users to /integrations/{provider}/setup?result=connected|failed, but PAGE-MAP's existing pages
  are /integrations/{provider}/connect/... . Rasel must align the callback destination.
  No new route or API file was created to work around this mismatch.
- API-key credentials exist only in component memory and the single write-only request.
  Only validated non-secret settings are retained in sessionStorage, scoped to firm/user/provider.
  No user/session/token is stored there.

## Review evidence

Screenshots are synthetic fixtures, not production fallback data.
Desktop: 1440 px. Mobile: 375 px, with no horizontal overflow.
See the adjacent PNGs for data, empty, offline and denied/read-only examples.
Validation results and the current backend limitation are recorded in the PR.

## Oct 20 review update

Connect: all desktop state screenshots now explicitly use a 1440 x 1100 viewport, including empty, offline, forbidden and read-only. Twelve focused browser tests, web TypeScript and focused ESLint passed. The backend OAuth callback still targets /setup; its owner must align it with the existing /connect routes.

Latest origin/main was merged before this verification. Synthetic data, empty and API-unreachable screenshots are 1440px; mobile evidence is 375px. The source mockup was cropped into three regions and compared with the rendered page. Existing asset/token/shell differences remain documented; exact visual sign-off and Tumit pre-review are pending. Evidence is published on the existing ibrahim/FIR-I01-integrations-screenshots branch.
