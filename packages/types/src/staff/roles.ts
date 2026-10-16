import { z } from 'zod';
import { text } from '../clients/text.js';
import { MembershipRole, PermissionCapability, PermissionModule } from '../schemas.js';
import { PermissionCell, PermissionGrants } from './schemas.js';

// Roles and the permission grid (R42 contract), shared by Create Staff step 2 and Settings >
// Users & Roles. The defaults are code (team/permissions.ts); a firm's changes are role_permissions
// rows. Owner and Admin only. The Owner role cannot be changed; a change that gives what the actor
// cannot grant is 403 CANNOT_GRANT; Edit (or any capability) without View is 400
// PERMISSION_NEEDS_VIEW; more than the default needs acknowledgeEscalation (409
// PERMISSION_ESCALATION). Users & Roles' "Admin" column is MANAGE.

const DateTime = z.iso.datetime({ offset: true });

/** One role in the Role selector and Role Templates. */
export const RoleSummary = z.object({
  role: MembershipRole,
  label: z.string(),
  /** Create Staff's "Role Description" panel. */
  description: z.string(),
  memberCount: z.number().int(),
  /** The firm changed this role's grid (Reset to Default is offered). */
  customized: z.boolean(),
  /** Owner: the grid is shown, never changed. */
  locked: z.boolean(),
});
export type RoleSummary = z.infer<typeof RoleSummary>;

/**
 * A firm's own role ("Create Custom Role", the "Custom roles" KPI). No table yet: it needs a
 * custom_roles table and a membership column (Staff Management / Settings, to build). Until
 * then the list is empty and create answers 501 NOT_IMPLEMENTED.
 */
export const CustomRole = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  basedOn: MembershipRole,
  memberCount: z.number().int(),
});
export type CustomRole = z.infer<typeof CustomRole>;

/** GET /business/roles. */
export const RoleList = z.object({
  items: z.array(RoleSummary),
  /** Optional: supplied once custom roles exist (see CustomRole). */
  custom: z.array(CustomRole).optional(),
});
export type RoleList = z.infer<typeof RoleList>;

export const CreateCustomRoleRequest = z.strictObject({
  name: text(60),
  description: text(300, 'many').optional(),
  basedOn: MembershipRole.exclude(['OWNER']),
});
export type CreateCustomRoleRequest = z.input<typeof CreateCustomRoleRequest>;

/** GET /business/roles/{role}/permissions: the grid for a role, defaults plus the firm's rows. */
export const RolePermissions = z.object({
  role: MembershipRole,
  cells: z.array(PermissionCell),
  updatedAt: DateTime.nullable(),
  updatedBy: z.string().nullable(),
});
export type RolePermissions = z.infer<typeof RolePermissions>;

/** PUT /business/roles/{role}/permissions: Save Changes with the whole grid shown. */
export const SaveRolePermissionsRequest = z.strictObject({
  grants: PermissionGrants,
  acknowledgeEscalation: z.boolean().optional(),
});
export type SaveRolePermissionsRequest = z.input<typeof SaveRolePermissionsRequest>;

/** A module of the grid with the "Permission Details" explanation. */
export const PermissionModuleInfo = z.object({
  module: PermissionModule,
  label: z.string(),
  description: z.string(),
  /** The capabilities this module supports (others show as unavailable). */
  capabilities: z.array(PermissionCapability),
});
export type PermissionModuleInfo = z.infer<typeof PermissionModuleInfo>;

/** GET /business/permission-modules. */
export const PermissionModuleList = z.object({
  modules: z.array(PermissionModuleInfo),
  capabilities: z.array(
    z.object({ capability: PermissionCapability, label: z.string(), description: z.string() }),
  ),
});
export type PermissionModuleList = z.infer<typeof PermissionModuleList>;
