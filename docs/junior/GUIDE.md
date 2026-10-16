# Junior developer guide

Firmivra · for Fahad, Nahid, Tumit and Arfan · Oct 6, 2026. Read it once, then keep it open while you work.

## Your job from Oct 7

You build **screens** in `apps/web` and **tests**. Rasel's Claude Code sessions build every API, table and sign-in flow, and publish ready-made API functions for your screens. If a screen needs data that the API functions don't give you, ask Rasel. Never add it yourself.

Rasel's R1 session also creates every page as a placeholder inside its layout: the sidebar, header, footer, sign-in check and menu links are done. `docs/junior/PAGE-MAP.md` lists every page with its file, owner, ticket and mockup. You fill in your own pages.

| You change | You never change |
| --- | --- |
| the files under your name in "Your files" in `docs/junior/PAGE-MAP.md` | `apps/api/`, `packages/db/`, `infra/`, `.github/` |
| `packages/ui/` (Fahad only; the others ask Fahad) | `packages/types/` and `apps/web/src/lib/api.ts` (the contract session publishes the schemas, client functions and mocks there) |
| your own `docs/tasks/<NAME>.md` | `.env` files, `pnpm-lock.yaml`, other people's pages and branches |

CI fails a PR from your branch if it changes anything outside your files.

## Every morning (10 minutes)

1. Update: `git fetch origin`, then on your ticket branch `git merge origin/main`. Never rebase or force-push a branch you already pushed.
2. Run: `docker compose up -d`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`.
   - Once, after the seed-ids fix (R0, Oct 8) is on main, reset your local database: `pnpm --filter @firmivra/db exec prisma migrate reset` (or drop it, then `pnpm db:migrate` and `pnpm db:seed`). The seeded ids changed, so the old rows would collide. Only synthetic data is lost.
3. Sign in locally with a quick sign-in button:
   - Firm workspace: http://app.localhost:3000/sign-in (`owner@lvp.test`, `staff@lvp.test`, `owner@firm-b.test`)
   - Super Admin: http://admin.localhost:3000/sign-in (`superadmin@firmivra.test`)
   - Client portal: http://portal.localhost:3000/lvp/sign-in (`client@lvp.test`)
4. Open today's card in `docs/tasks/<NAME>.md`.

## How to build a screen

1. **Branch from fresh main:** `git switch -c tumit/FIR-F04a-admin-dashboard origin/main` (your name, the ticket id, a short name).
2. **Open your page file** (find it in `docs/junior/PAGE-MAP.md`). Replace the `<PagePlaceholder>` with your screen, and put the screen's parts in a `_components/` folder next to the page. Never create, move or rename a route, layout or page folder: if a page is missing, ask Rasel. Copy the patterns of the reference screen `apps/web/src/app/firm/(workspace)/settings/tax-statuses/`; its comments explain every part.
   - `page.tsx` stays a small server file with its `metadata` title line (the tests check each page by its tab title): no `'use client'`, `redirect()` or `notFound()` in `page.tsx`, and no title or title template in any layout except the root layout's default. A page opened straight from its URL (verify-email, verify-phone, sign-up/done, apply/done, begin/done, begin/resume, reset-password, activate) never navigates away by itself. Keep what the tests read: the nav "Main" and `AppShell`; `data-testid="firm-name"`; the header's `me-email`, the user-menu button with the role and its "Sign out"; the portal greeting "Welcome back, <first name>!"; the "Intake Form" tab; the quick sign-in buttons with the email; the sign-in headings "Super Admin console", "Firm workspace" and "Client portal: <slug>".
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
6. **Look:** only `@firmivra/ui` components and token classes such as `bg-surface`, `bg-canvas`, `text-muted`, `border-border`, `text-danger`. No hex colours, no values like `p-[13px]`, no inline styles. Colours come from the tokens: never fix a colour inside your page; a colour that looks wrong everywhere is Fahad's to fix. Need a component that isn't there? Ask Fahad. Until he adds it, keep a small local one in your `_components/` folder. Match the design as `docs/design-match.md` says (the same text Claude Code sessions read), and use the components in `docs/ui-kit.md` first.
7. **API not merged yet?** Never wait: see "Mock first" below. Put `NEXT_PUBLIC_API_MOCK=<module>` (or `all`) in `apps/web/.env.local` and build against the mock data. Remove it when the API is on main. In mock mode the Super Admin console is signed in as Morgan Admin (`morgan.admin@example.test`); with `NEXT_PUBLIC_API_MOCK=all` in `apps/web/.env.local`, the skeleton-admin test "signed-out visitors" and the sites test "Super Admin in the admin console" fail, so list your modules instead of `all`, or remove the line, before `test:e2e`.
8. **Test:** put `data-testid` on the key elements and add one Playwright test. On mock data (while the API isn't on main): `apps/web/e2e/mock/<your-name>-<page>.spec.ts`, copied from the reference screen's `e2e/mock/tax-statuses.spec.ts`; run it with `pnpm --filter @firmivra/web test:e2e:mock`. Against the real API: `apps/web/e2e/<your-name>-<page>.spec.ts`.

## Mock first: you never wait for the backend

A page is never blocked by the API. Build it against typed mocks from day one:

1. The contract comes first. A contract session (Rasel's) writes the zod schemas and types in `packages/types`, the client functions in `apps/web/src/lib/api.ts` and the typed mock for the module in `apps/web/src/mocks/` before, or while, the API itself is built. Your page only uses what the contract gives you.
2. Set `NEXT_PUBLIC_API_MOCK=<module>` in `apps/web/.env.local` and build the page with `useApiQuery` and `useApiMutation` over `api.<module>.<function>()`. The mock answers with the same shapes, validation and error codes as the API, so when the API reaches main, the page works without changes. Remove the line then.
3. Never invent an API shape: no endpoint, field, enum value or error code that the schemas in `packages/types` don't have. Never hand-write a type for API data and never call `fetch` yourself. The contract is missing something your design needs? Write it in your `docs/tasks/<NAME>.md`, tell Rasel, and keep building the rest of the page with what exists; the design element still gets its frame with an empty state (`docs/design-match.md`, rule 2).
4. Your mock files: you may extend the mock data for your pages in `apps/web/src/mocks/` (the files listed under your name in "Your files"), with synthetic data only. Registering a new module in `apps/web/src/lib/api.ts` is the contract session's job.
5. Test on the mock: `apps/web/e2e/mock/<your-name>-<page>.spec.ts`, run with `pnpm --filter @firmivra/web test:e2e:mock`.

Placeholders not on main yet when you start? Build your parts in your `_components/` folder and don't create the page file yourself.

Always:

- Every screen has loading, empty, error and no-permission states.
- SSN and EIN are masked (last 4 digits only).
- Your code never saves anything in localStorage or cookies.
- The API decides who may see what. The UI only hides buttons the user can't use.

## Before you open the PR

- Run `pnpm lint`, `pnpm typecheck`, `pnpm --filter @firmivra/web build` and `pnpm --filter @firmivra/web test:e2e`.
- Read your whole diff (`git diff origin/main`). You must be able to explain every line to Rasel. If you can't, delete it or ask.
- One ticket or one page per PR. Title like `feat: super admin dashboard (F04a)`.
- Follow `docs/design-match.md`: tick its checklist in the PR. Put the mockup next to your screenshot at 1440 px and at 375 px, and list every difference you could not remove, and why.
- In the PR, put the mockup next to your screenshot, at desktop width and at 375 px. Hide real emails in screenshots: the repo is public.
- Your pair pre-reviews first (Fahad ↔ Tumit, Nahid ↔ Arfan), then Rasel's lead reviews and merges. Open the PR before the evening merge window. Tick the ticket on the Team Board when it merges.

## Stuck?

After 30 minutes, ask in the group. Send the ticket id, a screenshot, the exact error text and what you tried. Don't let an AI tool "fix" it by changing files outside your folders.

## Testing (Tumit and Arfan)

- Dev sites: https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp. Every merge to main reaches dev about 15 minutes later.
- Each Q ticket has a checklist. For every failure, open a GitHub issue with the Bug template: site and URL, user and role, steps, expected, actual, screenshot. Never include passwords or real data: the repo and its issues are public.
- Locally, emails land in Mailpit at http://localhost:8025.
- Turn the checks you repeat into Playwright tests in `apps/web/e2e/`.
