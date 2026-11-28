# 07. Access Control & Role-Based Permissions Matrix (RBAC)

## 1. System Identity Roles Definition
Firmivra enforces a granular role-based security model across three distinct trust boundaries:

### 1.1 Platform Roles (Super Admin Scope)
- **`SUPER_ADMIN`**: Full platform authority. Approves/suspends tenant firms, manages global subscriptions, reviews platform audit log. Never has ambient access to tenant client data.
- **`PLATFORM_SUPPORT`**: Ephemeral support agent. Granted temporary, read-only access to a specific tenant's audit and support logs only upon explicit, logged approval by the firm's Owner.

### 1.2 Firm Workspace Roles (Tenant Business Scope)
- **`OWNER`**: Primary tenant account holder. Unrestricted authority over firm billing, subscription plans, team membership, security policies, and support access grants.
- **`ADMIN`**: Full operational authority over firm settings, client records, and service modules. Cannot demote/remove the Owner or approve support access requests.
- **`MANAGER`**: Management authority over department workflows, template libraries, and approvals. Cannot alter firm-wide security or billing settings.
- **`PREPARER`**: Professional accounting and tax staff. Can prepare returns, manage client files, and send signature packets.
- **`STAFF`**: Standard firm team member. Can interact with assigned clients, schedule appointments, and complete assigned tasks.
- **`VIEWER`**: Read-only firm collaborator or external auditor. Can inspect records but cannot modify data, send communications, or issue invoices.

### 1.3 Client Portal & External Roles
- **`CLIENT_PRIMARY`**: Primary client account owner. Full portal access to personal documents, invoices, appointments, tax plans, and payments.
- **`CLIENT_SECONDARY`**: Linked spouse or secondary family member. Can view shared documents and sign assigned packets.
- **`GUEST_SIGNER`**: External recipient authenticated via email token or access code for one-off signature packets.

---

## 2. Comprehensive Permissions Matrix

| Workspace Module & Capability | Super Admin | Owner | Admin | Manager | Preparer | Staff | Viewer | Client Portal |
|---|---|---|---|---|---|---|---|---|
| **Platform Console (`admin.*`)** | Full | None | None | None | None | None | None | None |
| **Support Access Approval** | Request | Approve/Revoke | None | None | None | None | None | None |
| **Firm Settings & Billing** | Manage | Manage | View/Edit | None | None | None | None | None |
| **Team Management & Roles** | Manage | Full | Full | View | View | View | View | None |
| **Client Records (Create/Edit)** | None | Full | Full | Full | Full | Assigned | View | Self Only |
| **Client Portal Invites & Access** | None | Full | Full | Manage | Manage | None | None | None |
| **Invoices (Create / Send / Void)** | None | Full | Full | Full | Create/Edit | View | View | Pay / View |
| **Payments & Bank Settings** | None | Full | Full | View | View | None | None | Make Payment |
| **Documents (Upload / Delete)** | None | Full | Full | Full | Full | Assigned | View | Upload / View |
| **Firm Sign (Prepare / Send)** | None | Full | Full | Full | Full | Assigned | None | Sign / View |
| **Firm Sign (Void / Correct)** | None | Full | Full | Full | Manage | None | None | Decline |
| **Tax Returns (Workspace & Review)** | None | Full | Full | Full | Full | Assigned | View | View Final |
| **Tax Planning & Strategies** | None | Full | Full | Full | Full | Assigned | View | View Plans |
| **Planning Resources (Add/Checklist)**| None | Full | Full | Full | Full | None | View | View Shared |
| **Bookkeeping & Payroll** | None | Full | Full | Full | Full | Assigned | View | None |
| **Tasks & Workflows** | None | Full | Full | Full | Full | Assigned | View | View Own |
| **Templates & Branding** | None | Full | Full | Full | View | View | View | None |
| **Communications & Campaigns** | None | Full | Full | Full | Create | None | None | Receive |
| **Firm Audit Log (View & Export)** | Support Only | Full | Full | None | None | None | None | None |
