# Integrations list: manual review fixes

- Live Mode now uses the shared Toggle beside its visible label; Test Mode and the switch
  control the same LIVE/TEST value. Keyboard use is covered.
- ProviderCard is isolated from the screen. Two actions use equal-width grid columns;
  one action fills the row. Available cards keep Connect/Configure; connected cards keep
  Manage and the current contract-based Sync Now/Test choice. Read-only access hides mutations.
- Data is unchanged: Docker-backed local providers that are AVAILABLE must not be styled as connected.

## Contract gap requiring Rasel

The reference has QuickBooks Manage + Sync Now, Stripe Manage + Test despite AUTO mode,
and Microsoft 365 Manage only despite AUTO mode. IntegrationCard supplies a primary action,
connection status and syncMode, but no secondary-action capability or choice. syncMode alone
cannot reproduce those three different presentations faithfully. The existing rule remains
AUTO => Sync Now, MANUAL => Test, for connected cards only. No provider names, capabilities,
connection statuses or API fields were invented to simulate the reference.

To finish the exact per-provider action matrix, the contract owner must supply the supported
card actions or a documented capability rule. The request is also recorded in PR #761.
Validation: 7 focused mock browser tests, web TypeScript and changed-file ESLint pass. The local list and marketplace real-API smoke tests pass. Desktop/mobile and empty/offline review screenshots were refreshed.

## Oct 20 review update

List: unknown summary and tab counts now use a dash; all four status tabs fit at 1440px using existing grid/spacing tokens. Offline assertions follow the existing mapping-unavailable state. Seven focused browser tests, web TypeScript and focused ESLint passed.

Latest origin/main was merged before this verification. Synthetic data, empty and API-unreachable screenshots are 1440px; mobile evidence is 375px. The source mockup was cropped into three regions and compared with the rendered page. Existing asset/token/shell differences remain documented; exact visual sign-off and Tumit pre-review are pending. Evidence is published on the existing ibrahim/FIR-I01-integrations-screenshots branch.
