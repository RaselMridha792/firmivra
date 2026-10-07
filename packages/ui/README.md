# @firmivra/ui

Firmivra's design system: tokens and components, shown in Storybook. Owner: Fahad (Nahid contributes through PRs Fahad pre-reviews).

- Tokens live in `src/styles.css` (Tailwind 4 `@theme`): Firmivra navy/blue/teal, type, spacing, radii, shadows and breakpoints from `docs/mockups`. Normalized accessible colours and browser font substitutes still require visual approval.
- Themes: a firm's portal and Begin Online use the firm's own colours. The page puts `data-theme="portal"` or `data-theme="begin-online"` on its top element, and sets `--color-firm-primary`, `--color-firm-accent` and, optionally, `--color-firm-intake` (Begin Online's action colour; it falls back to the accent) on that element or an ancestor. The theme turns them into the navigation, heading, action, link and focus tokens on that element, so values set on a child are ignored.
- Components: Button (primary, secondary, ghost, outline, dark), Input, Select, Checkbox, Radio, Card and Badge, each with a story. Shared keyboard focus uses the focus token. Sidebar/header belong to the app shell, outside F01.
- `apps/web` imports the source directly (no build step) and the styles with `@import '@firmivra/ui/styles.css'`.

```bash
pnpm --filter @firmivra/ui storybook        # http://localhost:6006
pnpm --filter @firmivra/ui build-storybook
```
