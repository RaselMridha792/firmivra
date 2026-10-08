import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AdminSupportAccess,
  AdminSupportAccessList,
  AdminSupportAccessQuery,
  ApproveSupportAccessRequest,
  CreateSupportAccessRequest,
  FirmSupportAccess,
  FirmSupportAccessList,
  SupportAccessId,
  SupportAccessQuery,
} from './schemas.js';

const BASE = '/business/support-access';
const BusinessId = z.uuid();

/**
 * `api.supportAccess`: the firm's support access requests. Owner and Admin read; only an Owner
 * approves, declines or revokes (403 FORBIDDEN otherwise; Staff get 403 on every call).
 */
export function createSupportAccessClient(request: ApiRequest) {
  const end = (id: string, action: 'decline' | 'revoke') =>
    request(FirmSupportAccess, `${BASE}/${parseInput(SupportAccessId, id)}/${action}`, {
      method: 'POST',
      body: {},
    });
  return {
    /** One page; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: SupportAccessQuery = {}): Promise<FirmSupportAccessList> =>
      request(FirmSupportAccessList, `${BASE}${toQuery(parseInput(SupportAccessQuery, query))}`),
    /** A pending request becomes an active grant for `hours` (1 to 72, 24 when left out). */
    approve: async (
      id: string,
      body: ApproveSupportAccessRequest = {},
    ): Promise<FirmSupportAccess> =>
      request(FirmSupportAccess, `${BASE}/${parseInput(SupportAccessId, id)}/approve`, {
        method: 'POST',
        body: parseInput(ApproveSupportAccessRequest, body),
      }),
    /** Ends a pending request without access. */
    decline: async (id: string): Promise<FirmSupportAccess> => end(id, 'decline'),
    /** Ends an active grant at once. */
    revoke: async (id: string): Promise<FirmSupportAccess> => end(id, 'revoke'),
  };
}
export type SupportAccessClient = ReturnType<typeof createSupportAccessClient>;

/** `api.adminSupportAccess`: the Super Admins' support access requests (admin site). */
export function createAdminSupportAccessClient(request: ApiRequest) {
  return {
    /** Asks a firm for access; one of its Owners answers. 409 SUPPORT_REQUEST_OPEN while open. */
    request: async (
      businessId: string,
      body: CreateSupportAccessRequest,
    ): Promise<AdminSupportAccess> =>
      request(
        AdminSupportAccess,
        `/admin/firms/${parseInput(BusinessId, businessId)}/support-access`,
        { method: 'POST', body: parseInput(CreateSupportAccessRequest, body) },
      ),
    /** Every firm's requests, or one firm's; one page at a time. */
    list: async (query: AdminSupportAccessQuery = {}): Promise<AdminSupportAccessList> =>
      request(
        AdminSupportAccessList,
        `/admin/support-access${toQuery(parseInput(AdminSupportAccessQuery, query))}`,
      ),
  };
}
export type AdminSupportAccessClient = ReturnType<typeof createAdminSupportAccessClient>;
