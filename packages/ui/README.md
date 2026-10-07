# @firmivra/ui

Firmivra's design system: tokens and components, shown in Storybook. Owner: Fahad (Nahid contributes through PRs Fahad pre-reviews).

- Tokens live in `src/styles.css` (Tailwind 4 `@theme`): Firmivra navy/blue/teal and separate LVP portal/intake palettes, type, spacing, radii, shadows and breakpoints from `docs/mockups`. Normalized accessible colours and browser font substitutes still require visual approval.
- Components: Button, Input, Select, Checkbox, Radio, Card and Badge, each with a story. Shared keyboard focus uses the focus token. Sidebar/header belong to the app shell, outside F01.
- `apps/web` imports the source directly (no build step) and the styles with `@import '@firmivra/ui/styles.css'`.

```bash
pnpm --filter @firmivra/ui storybook        # http://localhost:6006
pnpm --filter @firmivra/ui build-storybook
```
