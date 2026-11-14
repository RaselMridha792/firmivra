import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { ClientPortalLock, LockClientPortalRequest } from './access.js';
import {
  ClientPortalActivityPage,
  ClientPortalActivityQuery,
  ClientPortalHeader,
  ClientPortalLogins,
  ClientPortalLoginsQuery,
  ClientPortalSummary,
  PendingClientActions,
  PortalSummaryDays,
  RecentPortalClients,
} from './management.js';
import {
  ClientPortalAccessResult,
  ClientPortalDocumentsSummary,
  ClientPortalFormsSummary,
  ClientPortalVisibility,
  UpdateClientPortalVisibilityRequest,
} from './visibility.js';

const BASE = '/business/client-portal';
const clientPath = (clientId: string) => `${BASE}/clients/${encodeURIComponent(clientId)}`;

/** `api.clientPortal` (apps/web/src/lib/api.ts): the firm's Client Portal module. */
export function createClientPortalClient(request: ApiRequest) {
  return {
    /** The member's recently opened clients, newest first. */
    recent: async (): Promise<RecentPortalClients> =>
      request(RecentPortalClients, `${BASE}/recent`),
    /** The client's header and status strip; opening it puts the client first in Recent. */
    get: async (clientId: string): Promise<ClientPortalHeader> =>
      request(ClientPortalHeader, clientPath(clientId)),
    summary: async (
      clientId: string,
      days: PortalSummaryDays = '30',
    ): Promise<ClientPortalSummary> =>
      request(ClientPortalSummary, `${clientPath(clientId)}/summary${toQuery({ days })}`),
    pendingActions: async (clientId: string): Promise<PendingClientActions> =>
      request(PendingClientActions, `${clientPath(clientId)}/pending-actions`),
    activity: async (
      clientId: string,
      query: ClientPortalActivityQuery = {},
    ): Promise<ClientPortalActivityPage> =>
      request(
        ClientPortalActivityPage,
        `${clientPath(clientId)}/activity${toQuery(parseInput(ClientPortalActivityQuery, query))}`,
      ),
    logins: async (
      clientId: string,
      query: ClientPortalLoginsQuery = {},
    ): Promise<ClientPortalLogins> =>
      request(
        ClientPortalLogins,
        `${clientPath(clientId)}/logins${toQuery(parseInput(ClientPortalLoginsQuery, query))}`,
      ),
    /** Owner and Admin: every login refused until unlocked; locking a locked client changes nothing. */
    lock: async (clientId: string, body: LockClientPortalRequest = {}): Promise<ClientPortalLock> =>
      request(ClientPortalLock, `${clientPath(clientId)}/lock`, {
        method: 'POST',
        body: parseInput(LockClientPortalRequest, body),
      }),
    unlock: async (clientId: string): Promise<ClientPortalLock> =>
      request(ClientPortalLock, `${clientPath(clientId)}/unlock`, { method: 'POST', body: {} }),
    visibility: async (clientId: string): Promise<ClientPortalVisibility> =>
      request(ClientPortalVisibility, `${clientPath(clientId)}/visibility`),
    /** Owner and Admin: only the areas sent change; audited. */
    setVisibility: async (
      clientId: string,
      body: UpdateClientPortalVisibilityRequest,
    ): Promise<ClientPortalVisibility> =>
      request(ClientPortalVisibility, `${clientPath(clientId)}/visibility`, {
        method: 'PUT',
        body: parseInput(UpdateClientPortalVisibilityRequest, body),
      }),
    /** Owner and Admin: every ACTIVE login DISABLED, records kept. */
    deactivate: async (clientId: string): Promise<ClientPortalAccessResult> =>
      request(ClientPortalAccessResult, `${clientPath(clientId)}/deactivate`, {
        method: 'POST',
        body: {},
      }),
    /** Owner and Admin: the logins deactivated here ACTIVE again. */
    reactivate: async (clientId: string): Promise<ClientPortalAccessResult> =>
      request(ClientPortalAccessResult, `${clientPath(clientId)}/reactivate`, {
        method: 'POST',
        body: {},
      }),
    /** Owner and Admin: each active login gets the password reset code by email. */
    resetAccess: async (clientId: string): Promise<ClientPortalAccessResult> =>
      request(ClientPortalAccessResult, `${clientPath(clientId)}/reset-access`, {
        method: 'POST',
        body: {},
      }),
    /** Owner and Admin: forgets the logins' authenticator apps; their sessions end. */
    resetMfa: async (clientId: string): Promise<ClientPortalAccessResult> =>
      request(ClientPortalAccessResult, `${clientPath(clientId)}/mfa/reset`, {
        method: 'POST',
        body: {},
      }),
    documentsSummary: async (clientId: string): Promise<ClientPortalDocumentsSummary> =>
      request(ClientPortalDocumentsSummary, `${clientPath(clientId)}/documents/summary`),
    formsSummary: async (clientId: string): Promise<ClientPortalFormsSummary> =>
      request(ClientPortalFormsSummary, `${clientPath(clientId)}/forms/summary`),
  };
}
export type ClientPortalClient = ReturnType<typeof createClientPortalClient>;
