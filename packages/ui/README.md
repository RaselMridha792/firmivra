# @firmivra/ui

Firmivra's design system: tokens and components, shown in Storybook. Owner: Fahad (Nahid contributes through PRs Fahad pre-reviews).

- Token source: `src/tokens.ts`; `pnpm --filter @firmivra/ui tokens` generates `src/tokens.css`. `styles.css` is the Tailwind 4 CSS-first preset. See `docs/design/tokens.md` for colour meanings and inferred values.
- Components: Button, Input, Select, Checkbox, Textarea, Card, Table, Modal, Tabs, Badge, Alert, Toast, Sidebar, Header, EmptyState and Skeleton. The Foundation stories show interactive examples and all states.
- Theme root: `data-theme="firmivra"` (default), `lvpPortal` or `lvpBeginOnline`. Components resolve semantic colours; platform and tenant shells are scoped independently.
- `apps/web` imports the source directly (no build step) and the styles with `@import '@firmivra/ui/styles.css'`.

```bash
pnpm --filter @firmivra/ui storybook        # http://localhost:6006
pnpm --filter @firmivra/ui build-storybook
pnpm --filter @firmivra/ui tokens
```

Browser interaction tests live at `apps/web/e2e/design-system.spec.ts`; the web Playwright configuration starts Storybook automatically. Tests cover numeric sorting, pagination, keyboard tabs, modal focus restoration and brand/status isolation.
