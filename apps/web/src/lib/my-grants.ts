'use client';

import { type PermissionCapability, type PermissionModule } from '@firmivra/types';
import { api } from './api';
import { useApiQuery } from './query';

/**
 * Dashboard Review 2, V5: what the signed-in member may do, as the server decides it (their own
 * change, their custom role, then their role). Actions stay unavailable until the server's
 * resolved grants arrive; role defaults can show actions the member cannot use. One shared query
 * serves the workspace.
 */
export function useMyGrants() {
  const grants = useApiQuery(['dashboard', 'permissions'], () => api.dashboard.permissions());
  return (module: PermissionModule, capability: PermissionCapability): boolean => {
    const held = grants.data?.grants[module];
    return held?.includes(capability) ?? false;
  };
}
