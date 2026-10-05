# @firmivra/ui

Firmivra's design system: tokens and components, shown in Storybook. Owner: Fahad (Nahid contributes through PRs Fahad pre-reviews).

- Tokens live in one file, `src/styles.css` (Tailwind 4 `@theme`). The values are placeholders until FIR-S0-F1 extracts them from `docs/mockups`.
- Components: `Button`, `Input`, `Card` to start. New UI uses only these tokens and components (CLAUDE.md rule 6).
- `PageShell` and `ComingSoon` support the public homepage. Import `@firmivra/ui/marketing.css`
  for its minimal dark theme; `src/tokens.css` reuses the shared theme with provisional
  marketing additions. The countdown uses elapsed wall-clock time and stops at zero.
- `apps/web` imports the source directly (no build step) and the styles with `@import '@firmivra/ui/styles.css'`.

```bash
pnpm --filter @firmivra/ui storybook        # http://localhost:6006
pnpm --filter @firmivra/ui build-storybook
```
