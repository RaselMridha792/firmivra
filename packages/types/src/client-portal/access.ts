import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

// Client Portal module (firm workspace), Access & Security: Lock Portal Access and Unlock Portal
// Access (Client Portal developer instructions 15 and 26). A lock stops the client's every login
// at once, at sign-in, on refresh and on every portal request, and keeps all records; unlocking
// restores them. Owner and Admin only; both audited.

/** A lock's reason: staff-only, never shown to the client. */
export const PORTAL_LOCK_REASON_MAX = 200;

/** The client's portal lock, or `locked: false` with the rest null. */
export const ClientPortalLock = z.object({
  clientId: z.uuid(),
  locked: z.boolean(),
  lockedAt: z.iso.datetime({ offset: true }).nullable(),
  /** The member who locked it. */
  lockedBy: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ClientPortalLock = z.infer<typeof ClientPortalLock>;

/** POST /business/client-portal/clients/{id}/lock. Locking a locked client changes nothing. */
export const LockClientPortalRequest = z.strictObject({
  reason: z.string().trim().max(PORTAL_LOCK_REASON_MAX).optional(),
});
export type LockClientPortalRequest = z.infer<typeof LockClientPortalRequest>;

const base = (clientId: string) =>
  `/business/client-portal/clients/${encodeURIComponent(clientId)}`;

/** `api.clientPortal` (apps/web/src/lib/api.ts): the firm's management of one client's portal. */
export function createClientPortalClient(request: ApiRequest) {
  return {
    lock: async (clientId: string, body: LockClientPortalRequest = {}): Promise<ClientPortalLock> =>
      request(ClientPortalLock, `${base(clientId)}/lock`, {
        method: 'POST',
        body: parseInput(LockClientPortalRequest, body),
      }),
    unlock: async (clientId: string): Promise<ClientPortalLock> =>
      request(ClientPortalLock, `${base(clientId)}/unlock`, { method: 'POST', body: {} }),
  };
}
export type ClientPortalClient = ReturnType<typeof createClientPortalClient>;
