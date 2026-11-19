'use client';

import {
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
  roleCan,
} from '@firmivra/types';
import { api } from './api';
import { useApiQuery } from './query';

/**
 * Dashboard Review 2, V5: what the signed-in member may do, as the server decides it (their own
 * change, their custom role, then their role). Until it arrives, and if it can't be read, the
 * role's default grid decides, which can only show more: the API still refuses anything not
 * allowed. One request for the workspace (the query is shared).
 */
export function useMyGrants(role: MembershipRole | undefined) {
  const grants = useApiQuery(['dashboard', 'permissions'], () => api.dashboard.permissions());
  return (module: PermissionModule, capability: PermissionCapability): boolean => {
    const held = grants.data?.grants[module];
    if (held) return held.includes(capability);
    return role ? roleCan(role, module, capability) : false;
  };
}
