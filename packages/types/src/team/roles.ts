import { MembershipRole } from '../schemas.js';

// The firm's eight staff roles (R35, decided by Rasel). The values match the database enum.
// What a role may do is each route's `@Roles(...)` list; a role no list names is refused
// (default deny).

/** Highest authority first. This is also the order screens list roles in. */
export const FIRM_ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'STAFF',
  'BOOKKEEPER',
  'TAX_PREPARER',
  'CLIENT_SUPPORT',
  'READ_ONLY',
] as const satisfies readonly MembershipRole[];

export const FIRM_ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  BOOKKEEPER: 'Bookkeeper',
  TAX_PREPARER: 'Tax Preparer',
  CLIENT_SUPPORT: 'Client Support',
  READ_ONLY: 'Read Only',
};

/** 0 for Owner up to 7 for Read Only: sort members by this. */
export const FIRM_ROLE_ORDER: Record<MembershipRole, number> = Object.fromEntries(
  FIRM_ROLES.map((role, index) => [role, index]),
) as Record<MembershipRole, number>;

/** The three roles that existed before R35: their routes are listed by `@Roles(...)`, as today. */
export const LEGACY_FIRM_ROLES = [
  'OWNER',
  'ADMIN',
  'STAFF',
] as const satisfies readonly MembershipRole[];
export type LegacyFirmRole = (typeof LEGACY_FIRM_ROLES)[number];

/**
 * The five roles added in R35. They reach a route only through the permission grid
 * (./permissions.ts); their data is scoped like Staff: only the clients assigned to them.
 */
export const GRID_FIRM_ROLES = [
  'MANAGER',
  'BOOKKEEPER',
  'TAX_PREPARER',
  'CLIENT_SUPPORT',
  'READ_ONLY',
] as const satisfies readonly MembershipRole[];
export type GridFirmRole = (typeof GRID_FIRM_ROLES)[number];
export const isGridFirmRole = (role: string): role is GridFirmRole =>
  (GRID_FIRM_ROLES as readonly string[]).includes(role);

/**
 * Who may give or take away each role (invite, role change, deactivate). Nobody gives Owner:
 * only the platform invites an Owner. Nobody manages their own level or above, so an Admin
 * cannot make another Admin, and a member can never be given more than the person acting can.
 */
export const ROLES_MANAGED_BY: Record<MembershipRole, readonly MembershipRole[]> = {
  OWNER: [
    'ADMIN',
    ...(['MANAGER', 'STAFF', 'BOOKKEEPER', 'TAX_PREPARER', 'CLIENT_SUPPORT', 'READ_ONLY'] as const),
  ],
  ADMIN: ['MANAGER', 'STAFF', 'BOOKKEEPER', 'TAX_PREPARER', 'CLIENT_SUPPORT', 'READ_ONLY'],
  MANAGER: [],
  STAFF: [],
  BOOKKEEPER: [],
  TAX_PREPARER: [],
  CLIENT_SUPPORT: [],
  READ_ONLY: [],
};
