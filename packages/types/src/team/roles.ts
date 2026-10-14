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
