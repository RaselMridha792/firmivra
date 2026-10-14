import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { SearchText, text } from '../clients/text.js';
import { MembershipRole } from '../schemas.js';
import {
  InvitationOutcome,
  PermissionGrants,
  StaffListItem,
  StaffStatusFilter,
} from '../staff/schemas.js';

// Settings > Users & Roles (R42 contract): the user table, its KPIs, export and Invite User.
// The role grid on the same page is api.roles (staff/roles.ts); the row menu's actions (reset
// password or MFA, sign out, deactivate, reactivate, resend or revoke invite) are api.staff.
// Owner and Admin only. A firm has one company: the design's "All Companies" filter and Company
// column are for platform admins; the firm API answers its own name.

/** GET /business/users. Search matches name, email and role. */
export const UsersQuery = z.strictObject({
  search: SearchText.optional(),
  role: MembershipRole.optional(),
  status: StaffStatusFilter.optional().default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type UsersQuery = z.input<typeof UsersQuery>;

/** A Users & Roles row: the directory's row plus the company name. */
export const FirmUser = StaffListItem.extend({ company: z.string() });
export type FirmUser = z.infer<typeof FirmUser>;

export const FirmUserList = z.object({
  items: z.array(FirmUser).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type FirmUserList = z.infer<typeof FirmUserList>;

/** GET /business/users/summary: Total Users, Active Users, Pending Invitations, Roles. */
export const UsersSummary = z.object({
  total: z.number().int(),
  addedThisMonth: z.number().int(),
  active: z.number().int(),
  pendingInvitations: z.number().int(),
  /** Roles in use at the firm (of the eight). */
  roles: z.number().int(),
  /** The "Custom roles" KPI: optional until custom roles exist (staff/roles.ts CustomRole). */
  customRoles: z.number().int().optional(),
});
export type UsersSummary = z.infer<typeof UsersSummary>;

/**
 * POST /business/users/invite: Invite User. Fewer fields than Create Staff; the person gets a
 * secure, time-limited activation link. 409 DUPLICATE_EMAIL for an existing member or invite.
 */
export const InviteUserRequest = z.strictObject({
  name: text(120),
  email: Email,
  role: MembershipRole.exclude(['OWNER']),
  /** "Additional Permissions": direct overrides on top of the role. */
  permissions: PermissionGrants.optional(),
});
export type InviteUserRequest = z.input<typeof InviteUserRequest>;

export const InviteUserResponse = z.object({
  user: FirmUser,
  invitation: InvitationOutcome,
});
export type InviteUserResponse = z.infer<typeof InviteUserResponse>;
