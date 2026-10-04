# @firmivra/config-typescript

Shared TypeScript presets. All of them extend `strict.json` (the strict options, also used by the root `tsconfig.base.json`).

| Preset        | For                                                                      |
| ------------- | ------------------------------------------------------------------------ |
| `base.json`   | Libraries and tools: `packages/*`, `infra` (bundler resolution, no emit) |
| `nextjs.json` | `apps/web`                                                               |
| `nestjs.json` | `apps/api` (Node module resolution, decorators)                          |

Use it in a package's `tsconfig.json`: `"extends": "@firmivra/config-typescript/base.json"`.
