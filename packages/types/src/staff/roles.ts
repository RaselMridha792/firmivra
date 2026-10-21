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
 * A firm's own role (Create Custom Role, the Roles count; custom_roles). It starts from a built-in
 * role (`basedOn`, never Owner, never changed) and keeps its own whole grid. A member with it has
 * `basedOn` as their role, so every check by role stays as it is; for the cells, the custom grid
 * decides in place of the role's, and the member's own Allow or Deny still wins. Archived, never
 * deleted.
 */
export const CustomRole = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  basedOn: MembershipRole,
  /** People with this role, not counting inactive ones. */
  memberCount: z.number().int(),
  /** Archived roles cannot be given; the people who still have one keep its grid. */
  archivedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type CustomRole = z.infer<typeof CustomRole>;

/** GET /business/roles. */
export const RoleList = z.object({
  items: z.array(RoleSummary),
  /** The firm's live custom roles, by name (archived ones are left out). */
  custom: z.array(CustomRole).optional(),
});
export type RoleList = z.infer<typeof RoleList>;

/**
 * POST /business/roles/custom: Save Role (Create Custom Role, then Set Permissions). The role and
 * its grid are saved together: the grid is `basedOn`'s current grid in this firm (defaults plus
 * the firm's changes; the template itself never changes) with `grants` on top. Owner and Admin
 * only. 409 ROLE_NAME_TAKEN for a live role of the same name (built-in labels included); 400
 * PERMISSION_NEEDS_VIEW for a capability without View in its module; 409 PERMISSION_ESCALATION
 * when `grants` gives more than `basedOn` has here, until resent with acknowledgeEscalation.
 */
export const CreateCustomRoleRequest = z.strictObject({
  name: text(60),
  description: text(300, 'many').optional(),
  basedOn: MembershipRole.exclude(['OWNER']),
  /** The cells Set Permissions changed from the template's grid. */
  grants: PermissionGrants.optional(),
  acknowledgeEscalation: z.boolean().optional(),
});
export type CreateCustomRoleRequest = z.input<typeof CreateCustomRoleRequest>;

/** GET /business/roles/custom/{id}: one custom role and its whole grid (source FIRM_ROLE). */
export const CustomRoleDetail = z.object({
  role: CustomRole,
  cells: z.array(PermissionCell),
  /** Who last saved it. */
  updatedBy: z.string().nullable(),
});
export type CustomRoleDetail = z.infer<typeof CustomRoleDetail>;

/**
 * PATCH /business/roles/custom/{id}: rename, describe, or Edit Permissions (the cells changed).
 * Same rules as create; escalation is measured against `basedOn`'s grid in this firm. An archived
 * role cannot be changed (409 CUSTOM_ROLE_ARCHIVED). The people with it get the new grid on their
 * next request.
 */
export const UpdateCustomRoleRequest = z
  .strictObject({
    name: text(60).optional(),
    description: text(300, 'many').nullable().optional(),
    grants: PermissionGrants.optional(),
    acknowledgeEscalation: z.boolean().optional(),
  })
  .refine(
    (b) => b.name !== undefined || b.description !== undefined || b.grants !== undefined,
    'Change something first',
  );
export type UpdateCustomRoleRequest = z.input<typeof UpdateCustomRoleRequest>;

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
