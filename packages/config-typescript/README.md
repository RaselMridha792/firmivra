# @firmivra/config-typescript

Shared TypeScript presets. All of them extend `strict.json` (the strict compiler options, also used by the root `tsconfig.base.json`). Presets only point inside this package, so every tool resolves them the same way.

| Preset         | For                                                                                 |
| -------------- | ----------------------------------------------------------------------------------- |
| `base.json`    | Code bundled by another tool: `packages/ui`, `infra` (bundler resolution, no emit)  |
| `library.json` | Packages compiled to `dist/` for Node: `packages/db`, `packages/types` (ES modules) |
| `nextjs.json`  | `apps/web`                                                                          |
| `nestjs.json`  | `apps/api` (Node ES modules, decorators)                                            |

Use it in a package's `tsconfig.json`: `"extends": "@firmivra/config-typescript/library.json"`.
