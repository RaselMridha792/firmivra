import type { MembershipRole } from '@firmivra/types';
import { api } from './api';
import { useApiQuery } from './query';

/**
 * The signed-in staff user's role in the firm the API acts in (GET /me and GET /business),
 * or undefined while loading, when signed out, or without an active membership there.
 * For showing and hiding UI only: the API checks the role again on every request.
 */
export function useFirmRole(): MembershipRole | undefined {
  const me = useApiQuery(['me'], () => api.me());
  const firm = useApiQuery(['current-business'], () => api.currentBusiness());
  if (!me.data || !firm.data) return undefined;
  const firmId = firm.data.id;
  return me.data.memberships.find((m) => m.business.id === firmId && m.status === 'ACTIVE')?.role;
}
