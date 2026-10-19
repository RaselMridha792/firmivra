'use client';

import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { COMPLIANCE_KEY } from './compliance-shared';

/** The firm's active members, as the assignee pickers list them. */
export function useMembers() {
  const team = useApiQuery([...COMPLIANCE_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));
  return { members, query: team };
}

/** Clients for the pickers and the filter (the first 100 active ones). */
export function useClients() {
  const clients = useApiQuery([...COMPLIANCE_KEY, 'clients'], () =>
    api.clients.list({ limit: 100 }),
  );
  return {
    clients: (clients.data?.items ?? []).map((c) => ({ id: c.id, displayName: c.displayName })),
    query: clients,
  };
}

export function useSettings() {
  return useApiQuery([...COMPLIANCE_KEY, 'settings'], () => api.compliance.settings());
}
