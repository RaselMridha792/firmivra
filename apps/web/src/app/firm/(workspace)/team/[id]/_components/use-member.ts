'use client';

import type { StaffDetail } from '@firmivra/types';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { MEMBER_ERRORS, canManage } from './staff-parts';

export interface MemberState {
  member: StaffDetail | undefined;
  pending: boolean;
  /** Why the member could not be read, in the screen's words. */
  failed: string | undefined;
  notFound: boolean;
  /**
   * The signed-in person may change this member (SM14, the API's `authority.edit`): never
   * themselves, never the Original Owner, an Admin only the roles below Admin.
   */
  manages: boolean;
  /** The signed-in role may change members at all (the Notes card shows only then). */
  admin: boolean;
}

/** One member (`api.staff.get`), shared by every card of their pages through the query cache. */
export function useMember(id: string): MemberState {
  const { role } = useFirm();
  const query = useApiQuery(['staff', 'detail', id], () => api.staff.get(id));
  const m = query.data;
  return {
    member: m,
    pending: query.isPending,
    failed: query.isError ? errorMessage(query.error, MEMBER_ERRORS) : undefined,
    notFound: query.isError && errorCode(query.error) === 'NOT_FOUND',
    manages: m?.authority.edit ?? false,
    admin: canManage(role),
  };
}
