'use client';

import type { MembershipRole } from '@firmivra/types';
import type { ReactNode } from 'react';
import { useFirmRole } from '../lib/role';

/**
 * Shows its children only to these firm roles, for example buttons that change data:
 *   <RequireRole roles={['OWNER', 'ADMIN']}><Button>Add status</Button></RequireRole>
 * It only hides UI. The API decides who may do what and answers 403 otherwise.
 */
export function RequireRole({
  roles,
  children,
  fallback = null,
}: {
  roles: readonly MembershipRole[];
  children: ReactNode;
  /** Shown instead, for example a short "Only owners and admins can change this." */
  fallback?: ReactNode;
}) {
  const role = useFirmRole();
  return <>{role && roles.includes(role) ? children : fallback}</>;
}
