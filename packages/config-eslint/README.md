# @firmivra/config-eslint

Shared ESLint 10 flat configs.

| Preset   | For                                                  |
| -------- | ---------------------------------------------------- |
| `base`   | TypeScript and JavaScript rules, Prettier-compatible |
| `node`   | `packages/db`, `infra`, tooling                      |
| `nestjs` | `apps/api` (adds type-aware promise rules)           |
| `react`  | `packages/ui`                                        |
| `nextjs` | `apps/web`                                           |

Use it in a package's `eslint.config.mjs`: `export { default } from '@firmivra/config-eslint/nestjs';`
