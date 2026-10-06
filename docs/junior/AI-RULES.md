# Rules for AI coding tools

Firmivra · Oct 6, 2026. These rules apply whichever AI tool you use (Claude Code, Cursor, Copilot, ChatGPT or any other). The repo's `AGENTS.md` and `CLAUDE.md` point tools here, but don't count on it: paste the starter prompt at the start of every ticket.

## Starter prompt

Copy this, fill in the last line, and send it as the first message for each ticket:

```text
You are helping a junior developer build one screen in the Firmivra repo
(Next.js 16 App Router, React 19, Tailwind 4, TypeScript strict).
First read CLAUDE.md, docs/junior/GUIDE.md, docs/junior/AI-RULES.md, docs/junior/PAGE-MAP.md and apps/web/AGENTS.md.
Rules:
1. Only change the files listed for me under "Your files" in docs/junior/PAGE-MAP.md,
   and new files in a _components/ folder next to my page.
   Never touch apps/api, packages/db, packages/types, infra, .github, pnpm-lock.yaml or any .env file
   (I edit apps/web/.env.local myself).
2. My page file already exists as a placeholder: replace the placeholder, keep the layout.
   Never create, move or rename a route, layout or page folder; if a page is missing, STOP and tell me.
   Copy the patterns of the reference screen apps/web/src/app/firm/(workspace)/settings/tax-statuses/.
3. Get data only through api.<module>.<function>() with useApiQuery / useApiMutation.
   No fetch, no axios, no server actions, no route handlers, no new API routes.
4. If the data I need is not in the api functions listed in my ticket, STOP and tell me.
   Never invent an endpoint, a field or a table.
5. UI only from @firmivra/ui and Tailwind token classes. No hex colours, no values like p-[13px], no inline styles.
6. Every screen has loading, empty, error and no-permission states (use PageState).
7. No new npm packages. No `any`, no @ts-ignore, no eslint-disable.
8. Plan first: list the files you will create or change, and wait for my OK before writing code.
9. Keep the whole change under 400 lines.
My ticket: <paste the ticket card from docs/tasks/<NAME>.md>
```

## What AI tools get wrong in this repo

| The AI does this | Do this instead |
| --- | --- |
| Creates `middleware.ts` | Next.js 16 uses `src/proxy.ts`, and you never change it |
| Creates a new page, layout or route folder | Your page already exists: edit it. Missing? Ask Rasel |
| Changes the sidebar, header or another person's page | Only your files from PAGE-MAP.md |
| Uses `pages/`, `getServerSideProps` or `next/router` | App Router only: `src/app/...` and `next/navigation` |
| Saves data with a server action (`'use server'`) or `app/api/.../route.ts` | Call `api.<module>.<fn>()` from a `'use client'` component |
| Calls `fetch('/api/v1/...')` or axios | Use the `api` functions: they handle cookies and errors |
| Invents an endpoint or a field | Stop and ask Rasel |
| Stores the user or a token in localStorage | Never: the session is an HttpOnly cookie |
| Adds a package (dates, icons, charts, a UI kit) | Ask Rasel first |
| Writes SQL, Prisma or NestJS code | Not your job: ask Rasel |
| "Cleans up" files your ticket doesn't need | Change only what the ticket needs |
| Turns off a lint rule or skips a test to make CI green | Fix the cause, or ask |

Next.js 16 is newer than most AI tools know. When the AI is unsure about a Next.js API, ask it to read the docs in `node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).

## Before you commit

- Read the whole diff yourself. Ask the AI to explain any line you don't understand. If you still don't understand it, don't commit it.
- Never let the AI run `git push --force`, `git reset --hard`, `git rebase` on a pushed branch, or delete branches.
- Never paste real client data, passwords or `.env` contents into an AI tool.
