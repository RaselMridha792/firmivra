'use client';

import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TASKS_KEY } from './task-shared';

/** The firm's active members, as the assignee pickers list them. */
export function useMembers() {
  const team = useApiQuery([...TASKS_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));
  return { members, query: team };
}

/** The configured task types (archived ones are left out of the pickers). */
export function useTypes() {
  const types = useApiQuery([...TASKS_KEY, 'types'], () => api.taskWork.types());
  return { types: (types.data ?? []).filter((t) => t.archivedAt === null), query: types };
}

/** Clients for the pickers and the filter (the first 100 active ones). */
export function useClients() {
  const clients = useApiQuery([...TASKS_KEY, 'clients'], () => api.clients.list({ limit: 100 }));
  return {
    clients: (clients.data?.items ?? []).map((c) => ({ id: c.id, displayName: c.displayName })),
    query: clients,
  };
}
