# Fahad frontend review handoff — 7 October 2026

Branch: `fahad/local-workspace-preview`. This is an integration/review backup, not a single merge-ready PR. Frontend implementations and local validation are available; backend-dependent tickets and final visual approval are incomplete. Do not mark all tickets Done.

## Scope and source integration

The current [FAHAD.md](FAHAD.md) is Rasel's Oct 6 evening revision: Fahad owns F01, F02, F03, F06, F07, F10 and F11. Super Admin business screens, setup, settings, team and calendar moved to Tumit; leads moved to Ibrahim. Work from the user's earlier full-screen instruction remains here for review. The [original plan](FAHAD-ORIGINAL-PLAN.md) explains that earlier scope; it does not supersede the current assignment.

This branch includes origin/main `4ff2b6c`, Rasel's R1 web kit, R10 client contracts/mocks, and canonical `rasel/T02-settings-api`. It also reuses Tumit's T03 team, T04 tax-status and T05 application-read implementations. The obsolete Tumit settings controller/service and incompatible tests were replaced with Rasel's canonical settings implementation and its tests. No new backend endpoint or database schema was authored for missing features. Protected auth, database, infrastructure and workflow paths match this main base.

The reused APIs require owner review before production merge. Application-history storage is unavailable on this main base; the UI reports the service error. R10 currently supplies contracts/mocks, not a live client-record controller. Existing route placeholders were reconciled with the original frontend implementation; duplicate setup/dynamic workspace routes were removed to restore the production build.

## Ticket readiness

| Ticket | Implemented and checked locally | Remaining before Done |
| --- | --- | --- |
| F01 | All 50 supplied PNGs inspected; HEX/use, type, spacing, radius, shadow and breakpoint docs; Firmivra/LVP themes; Button, Input, Select, Checkbox, Radio, Card, Badge, Table, Modal, Tabs, Toast, Skeleton, EmptyState and Stepper stories | Reference typography/artwork/detail approval; two small ticket PRs and review/merge |
| F02 | Shared firm/admin sign-in, MFA/setup QR, forgot/reset and activation views; existing local password/reset/dev-token flows; fragment-only activation token removed from history; expired-invite handling tested against published contract | Live invite activation backend, Cognito/release verification, final mockup approval |
| F03 | Session-verified shell, firm name/role, mobile navigation, staff restrictions, denied-membership sign-out; eight required dashboard queues with empty values | Multi-membership integration with R1's typed business selector; shell handoff to Tumit; final visual review |
| F06 | Typed R10 client search/status/cursor paging, read-only contact/profile/tax-year record, masked identifiers, shared 403/404 states; synthetic pending-signup review | R10 live implementation, R3 pending approval/decline, client tabs populated with owner APIs |
| F07 | Client/global document filters and request states; reusable bell and preview read state; client tabs wired to existing screens | R5 secure files/requests and R6 notification persistence/related-record navigation |
| F10 | Client/global messages, internal-note drafts and invoices; multiple invoice lines use integer cents; unavailable send actions are disabled | R11 message/note reads and writes; R7 invoice create/send/status integration |
| F11 | Existing workspace routes show Bookkeeping/Tax Planning engagement sections, status/tasks/documents/notes/reports | R12 engagement/task/report contracts and persistence; complete visual review |

Review work for the new owners: team reads/role/deactivation use T03; settings/profile/portal/legal/setup use canonical T02; tax-status CRUD/order/archive uses T04; applications filters/paging/detail use T05 read APIs. Approve/request-info/decline, logo signing, support-access grants, calendar and lead conversion are not complete production operations.

No live screen substitutes synthetic rows when its API is unavailable. In local mode, `?preview=1` enables explicitly unsaved examples. Preview entry points include clients, sign-ups, documents, notifications, messages, invoices, workspaces and the earlier owner's review screens. Development quick sign-in is available at `/sign-in?dev=1`; the default sign-in composition has no extra development card.

## Local app

Docker Postgres, S3 mock and Mailpit are running. The 26 upstream migrations were deployed and synthetic seed data loaded. No AWS access is needed for local UI checks.

| Service | URL |
| --- | --- |
| Firm app | http://app.localhost:3000/sign-in?dev=1 |
| Super Admin | http://admin.localhost:3000/sign-in?dev=1 |
| Existing client portal | http://portal.localhost:3000/lvp/sign-in |
| Storybook | http://localhost:6006 |
| API health | http://localhost:4000/api/v1/health |
| Mailpit | http://localhost:8025 |

For a fresh local start, use the repository's local environment configuration without printing secrets:

```sh
docker compose up -d
pnpm --filter @firmivra/db generate
pnpm --filter @firmivra/db db:deploy
pnpm db:seed
pnpm --filter @firmivra/api build
# Separate terminals:
pnpm --filter @firmivra/api start
pnpm --filter @firmivra/web dev
pnpm --filter @firmivra/ui storybook
```

Individual workspace commands are used because the current Windows Turbo launcher reports a spawn error. Run builds before browser checks, and keep the API stable during them. Do not run two browser suites concurrently.

## Validation and design evidence

- API: **179 tests pass** after the canonical settings replacement; types: **76 tests pass**.
- Web production build and Storybook production build pass.
- Web/UI/API lint and API/UI/web typechecks pass; no rules are disabled.
- The final **48 browser checks** cover session refresh/redirect, local auth/MFA/reset, fragment activation, roles, client contract mocks, 403/404, component keyboard behavior, preview boundaries, settings/team/tax/application integrations, invoice arithmetic, mobile navigation, route loading, overflow and accessibility on selected screens. **Final result: 48 passed in 5.1 minutes, using one worker and the built API.** Contract-fixture tests do not prove absent live APIs.
- All supplied references are inventoried in [mockup-inventory.md](../design/mockup-inventory.md). [tokens.md](../design/tokens.md) separates normalized shared values from reference composition aliases and keeps Firmivra/LVP palettes separate.
- [Visual review](../design/review/README.md) contains five native-size desktop side-by-side comparisons, five loaded mobile captures and firm screen captures. These are review evidence, not a pixel-perfect claim. Wave artwork, substitute fonts, icons and some density/spacing differences remain. No firm-workspace reference PNGs were supplied.

## Collaboration and board

Split delivery into fresh-main, one-ticket PRs under 400 changed lines. Current task plan names Tumit as Fahad's pre-review pair; Rasel reviews and merges. This large backup branch must not be merged as one mixed PR. Remote CI, Octavia review/fixes and authorized production smoke testing have not been performed.

The supplied [Team Board](https://claude.ai/artifact/GZbgHVB8uKaA7pp1xFXWd6) was inaccessible in this environment. No external checkbox was changed. Backend-dependent features cannot be marked Done until their APIs and integration checks exist.
