# 03. Dependency & Open Source License Inventory

## 1. Open Source Licensing Policy & Certification
Firmivra enforces a strict intellectual property and licensing compliance standard:
- **Permissive Open Source Elective Standard**: Production runtime dependencies must be governed by commercially permissive open-source licenses: **MIT**, **Apache-2.0**, **BSD-2-Clause**, **BSD-3-Clause**, or **ISC**.
- **Dual-Licensed Components**: Where a dependency offers dual licensing terms (such as `jszip`, which is dual-licensed under `MIT OR GPL-3.0-or-later`, pulled transitively by `mammoth` for DOCX extraction), Firmivra explicitly elects and uses the component under its permissive **MIT** license option. No GPL or reciprocal copyleft obligations attach to or govern the Firmivra platform or its distribution.
- **Build-Time Tooling Note**: Tooling utilized solely during development or build time and not distributed in runtime images (such as `lightningcss`, licensed under MPL-2.0 and utilized by Tailwind CSS v4 during static asset compilation) is isolated from production runtimes.
- **Audited Compliance**: All third-party copyrights and permissive notices are acknowledged in standard distribution manifests.

---

## 2. Production Runtime Dependency Catalog

### 2.1 Backend Core (`apps/api`)
| Package | Version | Purpose | License |
|---|---|---|---|
| `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | `^11.0.0` | Application backend framework & HTTP routing | MIT |
| `prisma`, `@prisma/client` | `^7.10.0` | Database ORM and PostgreSQL type-safe query generation | Apache-2.0 |
| `@aws-sdk/client-s3` | `^3.700.0` | Object storage client for document packets and uploads | Apache-2.0 |
| `@aws-sdk/client-cognito-identity-provider` | `^3.700.0` | AWS Cognito identity pool management | Apache-2.0 |
| `@aws-sdk/client-ses` | `^3.700.0` | Email dispatch service integration | Apache-2.0 |
| `@aws-sdk/client-kms` | `^3.700.0` | Per-tenant customer master key cryptographic operations | Apache-2.0 |
| `aws-jwt-verify` | `^4.0.1` | Cryptographic JWT signature verification against Cognito JWKS | Apache-2.0 |
| `stripe` | `^17.0.0` | Payment gateway and webhook signature processing | MIT |
| `pdf-lib` | `^1.17.1` | PDF composition, field stamping, packet generation, and certificates | MIT |
| `mammoth` | `1.8.0` | DOCX Word document extraction (transitive `jszip` used under MIT) | BSD-2-Clause |
| `sanitize-html` | `^2.13.0` | HTML content sanitization and XSS mitigation | MIT |
| `zod` | `^4.6.5` | Schema validation and contract enforcement | MIT |

### 2.2 Frontend Core (`apps/web`)
| Package | Version | Purpose | License |
|---|---|---|---|
| `next` | `^16.0.0` | Web application framework (App Router & Server Components) | MIT |
| `react`, `react-dom` | `^19.0.0` | Declarative UI component library | MIT |
| `@tanstack/react-query` | `^5.62.0` | Asynchronous state management and caching | MIT |
| `tailwindcss` | `^4.0.0` | Utility-first styling engine | MIT |
| `lucide-react` | `^0.468.0` | UI icon components | ISC |
| `@phosphor-icons/react` | `^2.1.7` | Action and navigation iconography | MIT |
| `clsx`, `tailwind-merge` | `^2.1.1` | Class composition utilities | MIT |

### 2.3 Shared Packages & Infrastructure
| Package / Workspace | Direct Dependencies | Purpose | License |
|---|---|---|---|
| `packages/types` | `zod` | Shared schemas and type contracts | MIT |
| `packages/db` | `@prisma/client`, `pg` | Database schema & connection pooling | Apache-2.0 / MIT |
| `packages/ui` | React, Phosphor/Lucide | Shared accessible design system components | MIT |
| `infra` (`@firmivra/infra`) | `aws-cdk-lib`, `constructs` | CloudFormation CDK infrastructure constructs | Apache-2.0 |

---

## 3. Vulnerability Scanning & Maintenance Protocol
1. **Automated Dependabot Sweeps**: Dependabot is enabled on the repository default branch to alert and patch vulnerable dependencies.
2. **Deterministic Builds**: Every build uses `pnpm install --frozen-lockfile` against `pnpm-lock.yaml`, ensuring cryptographic integrity of all downloaded tarballs via SHA-512 hashes.
3. **Audit Execution**:
   ```bash
   pnpm audit --audit-level high
   ```
