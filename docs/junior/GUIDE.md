# Junior developer guide

Firmivra · for Fahad, Nahid, Tumit and Ibrahim · Oct 6, 2026. Read it once, then keep it open while you work.

## Your job from Oct 7

You build **screens** in `apps/web` and **tests**. Rasel's Claude Code sessions build every API, table and sign-in flow, and publish ready-made API functions for your screens. If a screen needs data that the API functions don't give you, ask Rasel. Never add it yourself.

| You change | You never change |
| --- | --- |
| `apps/web/` (pages, components, e2e tests) | `apps/api/`, `packages/db/`, `infra/`, `.github/` |
| `packages/ui/` (Fahad only; the others ask Fahad) | `packages/types/` (the sessions publish the API functions there) |
| your own `docs/tasks/<NAME>.md` | `.env` files, `pnpm-lock.yaml`, other people's branches |

CI fails a PR from your branch if it changes anything outside these folders.

## Every morning (10 minutes)

1. Update: `git fetch origin`, then on your ticket branch `git merge origin/main`. Never rebase or force-push a branch you already pushed.
2. Run: `docker compose up -d`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`.
3. Sign in locally with a quick sign-in button:
   - Firm workspace: http://app.localhost:3000/sign-in (`owner@lvp.test`, `staff@lvp.test`, `owner@firm-b.test`)
   - Super Admin: http://admin.localhost:3000/sign-in (`superadmin@firmivra.test`)
   - Client portal: http://portal.localhost:3000/lvp/sign-in (`client@lvp.test`)
4. Open today's card in `docs/tasks/<NAME>.md`.

## How to build a screen

1. **Branch from fresh main:** `git switch -c tumit/FIR-F04a-admin-dashboard origin/main` (your name, the ticket id, a short name).
2. **Copy the reference screen** `apps/web/src/app/firm/(workspace)/settings/tax-statuses/` into your route folder and keep its structure. Its comments explain every part.
3. **Read data with the hook**, never with `fetch` or axios:

   ```tsx
   const statuses = useApiQuery(['tax-statuses'], () => api.taxStatuses.list());
   return (
     <PageState query={statuses} empty="No tax statuses yet">
       {(rows) => <StatusTable rows={rows} />}
     </PageState>
   );
   ```

   `PageState` shows the loading, empty, error and "no permission" states for you.

4. **Change data only from the browser:** in a `'use client'` component, on a click or a form submit, with `useApiMutation`. Never in a server component, a server action (`'use server'`) or a route handler: the API refuses those with 403.
5. **Forms:** `useForm` with `zodResolver(<schema from @firmivra/types>)`. Show API errors with `errorMessage(error)`.
6. **Look:** only `@firmivra/ui` components and token classes such as `bg-surface`, `bg-canvas`, `text-muted`, `border-border`, `text-danger`. No hex colours, no values like `p-[13px]`, no inline styles. Need a component that isn't there? Ask Fahad. Until he adds it, keep a small local one in your page folder.
7. **API not merged yet?** Put `NEXT_PUBLIC_API_MOCK=<module>` (or `all`) in `apps/web/.env.local` and build against the mock data. Remove it when the API is on main.
8. **Test:** put `data-testid` on the key elements and add one Playwright test in `apps/web/e2e/` (copy the reference screen's test).

Always:

- Every screen has loading, empty, error and no-permission states.
- SSN and EIN are masked (last 4 digits only).
- Your code never saves anything in localStorage or cookies.
- The API decides who may see what. The UI only hides buttons the user can't use.

## Before you open the PR

- Run `pnpm lint`, `pnpm typecheck`, `pnpm --filter @firmivra/web build` and `pnpm --filter @firmivra/web test:e2e`.
- Read your whole diff (`git diff origin/main`). You must be able to explain every line to Rasel. If you can't, delete it or ask.
- One ticket per PR, under 400 changed lines. Title like `feat: super admin dashboard (F04a)`.
- In the PR, put the mockup next to your screenshot, at desktop width and at 375 px. Hide real emails in screenshots: the repo is public.
- Your pair pre-reviews first (Fahad ↔ Tumit, Nahid ↔ Ibrahim), then Rasel's lead reviews and merges. Open the PR before the evening merge window. Tick the ticket on the Team Board when it merges.

## Stuck?

After 30 minutes, ask in the group. Send the ticket id, a screenshot, the exact error text and what you tried. Don't let an AI tool "fix" it by changing files outside your folders.

## Testing (Tumit and Ibrahim)

- Dev sites: https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp. Every merge to main reaches dev about 15 minutes later.
- Each Q ticket has a checklist. For every failure, open a GitHub issue with the Bug template: site and URL, user and role, steps, expected, actual, screenshot. Never include passwords or real data: the repo and its issues are public.
- Locally, emails land in Mailpit at http://localhost:8025.
- Turn the checks you repeat into Playwright tests in `apps/web/e2e/`.
