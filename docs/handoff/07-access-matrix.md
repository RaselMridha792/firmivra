# 07. Access Control & Role-Based Permissions Matrix (RBAC)

## 1. System Identity Roles Definition
Firmivra enforces an exact, granular role-based security model across three distinct trust boundaries, matching the database schema enums (`packages/db/prisma/schema.prisma`) and application contracts (`packages/types/src/team/roles.ts`):

### 1.1 Platform Roles (`PlatformRole` Enum)
- **`SUPER_ADMIN`**: Full platform authority. Approves/suspends tenant firms, manages global subscriptions, reviews platform audit log (`app_is_admin() === true`). Never has ambient access to tenant client data.
- **`TEAM_MEMBER`**: Platform team member below the executive level. No direct admin-scope tenant access rights (`app_is_admin() === false`).

### 1.2 Firm Workspace Roles (`MembershipRole` Enum)
The firm workspace defines nine built-in member roles matching `enum MembershipRole`:
1. **`OWNER`**: Primary tenant account holder. Unrestricted authority over firm billing, subscription plans, team membership, security policies, and support access grants.
2. **`ADMIN`**: Full operational authority over firm settings, client records, and service modules. Cannot demote/remove the Owner or approve support access requests.
3. **`MANAGER`**: Management authority over department workflows, template libraries, and approvals. Cannot alter firm-wide security or billing settings.
4. **`STAFF`**: Standard firm team member. Operates on assigned clients, schedules appointments, and completes assigned tasks.
5. **`BOOKKEEPER`**: Specialized accounting role. Full create/edit authority over Bookkeeping, Documents, Tasks, and assigned clients; view-only access to Invoices/Payments and Messages.
6. **`TAX_PREPARER`**: Professional tax preparation role. View/create/edit authority over Tax Returns, Clients, Appointments, and Intake Forms; view-only access to other work modules.
7. **`CLIENT_SUPPORT`**: Client services and relationship role. Manages Appointments, Messages, Client Portal access, Leads, and client onboarding records.
8. **`BUSINESS_CONSULTANT`**: Advisory services role. Standard staff capabilities plus full authority over Business Advisory and Development plans and recommendations.
9. **`READ_ONLY`**: Audit and inspection role (formerly referred to as Viewer). Read-only access across assigned clients, documents, and non-sensitive business records; zero create, edit, or send permissions.

### 1.3 Client Portal Roles (`ClientPortalRole` Enum)
Defined on client accounts in `enum ClientPortalRole`:
- **`PRIMARY`**: Primary client account owner. Full portal access to personal documents, invoices, appointments, tax plans, and payments.
- **`SPOUSE`**: Linked spouse portal login. Can view shared client documents, appointments, and execute assigned signature packets.
- **`AUTHORIZED`**: Third-party authorized representative (e.g. corporate officer, legal counsel) with delegated portal access.

### 1.4 External E-Sign Recipient Roles (`EsignRecipientRole` Enum)
Defined on signature envelopes in `enum EsignRecipientRole`:
- `CLIENT`, `SPOUSE`, `BUSINESS_OWNER`, `EMPLOYEE`, `PREPARER`, `MANAGER`, `WITNESS`, `CUSTOM`.

---

## 2. Comprehensive Permissions Matrix Across System Roles

| Workspace Module & Capability | SUPER_ADMIN | OWNER | ADMIN | MANAGER | STAFF | BOOKKEEPER | TAX_PREPARER | CLIENT_SUPPORT | BUSINESS_CONSULTANT | READ_ONLY | Client (PRIMARY) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Platform Console (`admin.*`)** | Full | None | None | None | None | None | None | None | None | None | None |
| **Support Access Approval** | Request | Approve/Revoke | None | None | None | None | None | None | None | None | None |
| **Firm Settings & Billing** | Manage | Full | View/Edit | None | None | None | None | None | None | None | None |
| **Team Management & Roles** | Manage | Full | Full | View | View | View | View | View | View | View | None |
| **Client Records (Create/Edit)** | None | Full | Full | Full | Assigned | Assigned | Full | Full | Assigned | View | Self Only |
| **Client Portal Invites & Access** | None | Full | Full | Manage | None | None | None | Manage | None | None | None |
| **Invoices (Create / Send / Void)** | None | Full | Full | Full | View | View | View | None | View | View | Pay / View |
| **Payments & Bank Settings** | None | Full | Full | View | None | None | None | None | None | None | Make Payment |
| **Documents (Upload / Delete)** | None | Full | Full | Full | Assigned | Full | Full | View | Assigned | View | Upload / View |
| **Firm Sign (Prepare / Send)** | None | Full | Full | Full | Assigned | None | Full | None | Assigned | None | Sign / View |
| **Firm Sign (Void / Correct)** | None | Full | Full | Full | None | None | Manage | None | None | None | Decline |
| **Tax Returns (Workspace & Review)** | None | Full | Full | Full | Assigned | None | Full | None | Assigned | View | View Final |
| **Tax Planning & Strategies** | None | Full | Full | Full | Assigned | None | Full | None | Assigned | View | View Plans |
| **Planning Resources (Add/Checklist)**| None | Full | Full | Full | None | None | View | View | None | View | View Shared |
| **Bookkeeping (Reconcile / Close)** | None | Full | Full | Full | Assigned | Full | None | None | Assigned | View | None |
| **Payroll Runs (Review / Approve)** | None | Full | Full | Full | Assigned | View | None | None | Assigned | View | None |
| **Business Advisory & Development** | None | Full | Full | Full | Assigned | None | None | None | Full | View | View Plans |
| **Tasks & Workflows** | None | Full | Full | Full | Assigned | Full | View | Full | Assigned | View | View Own |
| **Templates & Branding** | None | Full | Full | Full | View | View | View | View | View | View | None |
| **Communications & Campaigns** | None | Full | Full | Full | None | None | None | Manage | None | None | Receive |
| **Firm Audit Log (View & Export)** | Support Only | Full | Full | None | None | None | None | None | None | None | None |
