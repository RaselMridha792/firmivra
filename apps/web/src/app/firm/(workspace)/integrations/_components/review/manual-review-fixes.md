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
