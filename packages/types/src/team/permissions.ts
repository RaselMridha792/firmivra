import { PermissionCapability, PermissionModule, type MembershipRole } from '../schemas.js';

// The permission grid (R35): what each of the five newer roles may do in each module. It comes
// from Octavia's Users & Roles and Create Staff designs (docs/mockups/firm-workspace). Where the
// two screens disagree, the narrower of them wins; where the designs say nothing about a role or
// a module, the role gets the narrowest access its name implies, and no more. The comments say
// which. Owner, Admin and Staff keep the access their routes list in `@Roles(...)`; their grid
// below is what the screens show for them.
//
// The grid is the default. A firm's own changes are stored per role and per member
// (role_permissions, member_permissions) and applied by the API on top of it.

export { PermissionCapability, PermissionModule };

export type PermissionGrid = Partial<Record<PermissionModule, readonly PermissionCapability[]>>;

const V = 'VIEW' as const;
const C = 'CREATE' as const;
const E = 'EDIT' as const;
const D = 'DELETE' as const;
const A = 'APPROVE' as const;
const M = 'MANAGE' as const;
const X = 'EXPORT' as const;
const ALL = [V, C, E, D, A, M, X] as const;

/** Modules every role below Admin leaves alone unless the firm opens them. */
export const SENSITIVE_MODULES = [
  'STAFF_MANAGEMENT',
  'SETTINGS',
  'INTEGRATIONS',
] as const satisfies readonly PermissionModule[];

const everyModule = (caps: readonly PermissionCapability[]): PermissionGrid =>
  Object.fromEntries(PermissionModule.options.map((m) => [m, caps]));

/** Modules with firm routes today that Staff may use (`@Roles(...FIRM_STAFF)`): view, create, edit. */
const STAFF_MODULES = [
  'DASHBOARD',
  'CLIENTS',
  'LEADS',
  'APPOINTMENTS',
  'INTAKE_FORMS',
  'DOCUMENTS',
  'TASKS',
  'TAX_RETURNS',
  'INVOICES_PAYMENTS',
  'MESSAGES',
] as const satisfies readonly PermissionModule[];

export const DEFAULT_ROLE_PERMISSIONS: Record<MembershipRole, PermissionGrid> = {
  OWNER: everyModule(ALL),
  ADMIN: everyModule(ALL),
  STAFF: Object.fromEntries(STAFF_MODULES.map((m) => [m, [V, C, E]])),

  // Octavia's Manager has no grid in either design. Narrowest: the work Staff does, plus a
  // view of the other business modules, and nothing in Staff Management, Settings or
  // Integrations (those need Manage, which this role is never given by default).
  MANAGER: {
    ...Object.fromEntries(
      PermissionModule.options
        .filter((m) => !(SENSITIVE_MODULES as readonly string[]).includes(m))
        .map((m) => [m, [V]]),
    ),
    ...Object.fromEntries(
      STAFF_MODULES.filter((m) => m !== 'INVOICES_PAYMENTS').map((m) => [m, [V, C, E]]),
    ),
    REPORTS: [V, X],
  },

  // No grid in either design. Narrowest from the role's name: the books, with the clients and
  // files they need.
  BOOKKEEPER: {
    DASHBOARD: [V],
    CLIENTS: [V],
    DOCUMENTS: [V, C],
    TASKS: [V, C, E],
    BOOKKEEPING: [V, C, E],
    INVOICES_PAYMENTS: [V],
    MESSAGES: [V],
  },

  // Both designs show Tax Preparer. Where they disagree the narrower wins: Clients view, create,
  // edit; Leads view; Appointments view, create; Intake Forms view, create; Documents view; Tax
  // Returns view, create; Bookkeeping, Payroll and Tasks view. The other business modules are
  // view only (Create Staff step 2). Staff Management, Settings and Integrations are left out:
  // step 2 shows view there, but its own note calls them sensitive areas needing approval.
  TAX_PREPARER: {
    ...Object.fromEntries(
      PermissionModule.options
        .filter((m) => !(SENSITIVE_MODULES as readonly string[]).includes(m))
        .map((m) => [m, [V]]),
    ),
    CLIENTS: [V, C, E],
    APPOINTMENTS: [V, C],
    INTAKE_FORMS: [V, C],
    TAX_RETURNS: [V, C],
  },

  // No grid in either design. Narrowest from the role's name: the people side of the firm.
  CLIENT_SUPPORT: {
    DASHBOARD: [V],
    CLIENTS: [V, C, E],
    LEADS: [V],
    APPOINTMENTS: [V, C, E],
    INTAKE_FORMS: [V],
    DOCUMENTS: [V],
    MESSAGES: [V, C, E],
    TASKS: [V, C],
    CLIENT_PORTAL: [V],
  },

  // No grid in any design (Rasel, Oct 21): Staff's work plus Business Advisory.
  BUSINESS_CONSULTANT: {
    ...Object.fromEntries(STAFF_MODULES.map((m) => [m, [V, C, E]])),
    BUSINESS_ADVISORY: [V, C, E],
  },

  // The design names Viewer (Read Only) and nothing else. Narrowest: look, never change, and
  // not the money or the conversations.
  READ_ONLY: { DASHBOARD: [V], CLIENTS: [V], APPOINTMENTS: [V], TASKS: [V] },
};

/** Whether the role's default grid gives a capability in a module. */
export function roleCan(
  role: MembershipRole,
  module: PermissionModule,
  capability: PermissionCapability,
): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role][module]?.includes(capability) ?? false;
}

/** The capability a request needs by its HTTP method (the API's routes follow it). */
export function capabilityOfMethod(method: string): PermissionCapability | undefined {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'VIEW';
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'EDIT';
    case 'DELETE':
      return 'DELETE';
    default:
      return undefined;
  }
}
