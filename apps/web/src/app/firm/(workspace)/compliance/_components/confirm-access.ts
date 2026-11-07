import { type MembershipRole, type PermissionModule, roleCan } from '@firmivra/types';

/**
 * AU-F31 (#1264) on a record page: who sees a filing's confirmation and who may record one, as
 * the API's rule goes. The Automations area guards both routes; confirming also needs the record
 * module's manage right (an Owner or Admin has every right). By the role's default grid only: the
 * API reads the member's own grid and decides.
 */
export function confirmAccess(
  role: MembershipRole | undefined,
  module: PermissionModule,
): { sees: boolean; may: boolean } {
  if (!role) return { sees: false, may: false };
  if (role === 'OWNER' || role === 'ADMIN') return { sees: true, may: true };
  return {
    sees: roleCan(role, 'AUTOMATIONS', 'VIEW'),
    may:
      role !== 'STAFF' && roleCan(role, 'AUTOMATIONS', 'CREATE') && roleCan(role, module, 'MANAGE'),
  };
}
