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
  /** Owner and Admin change other members; nobody changes their own access here. */
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
    manages: canManage(role) && m !== undefined && !m.isYou,
    admin: canManage(role),
  };
}
