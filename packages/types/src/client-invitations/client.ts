import { type ApiRequest, parseInput } from '../client.js';
import { ClientId } from '../clients/schemas.js';
import { FirmSlug } from '../schemas.js';
import {
  ClientPortalAccess,
  OpenedPortalInvitation,
  OpenPortalInvitationRequest,
  SendPortalInvitationRequest,
} from './schemas.js';

const one = (clientId: string) => `/business/clients/${parseInput(ClientId, clientId)}`;

/**
 * `api.portalInvitations` (apps/web/src/lib/api.ts): a client's portal access and the firm's
 * invitation to it (Business Advisory B3). Owner, Admin and the client's assigned Staff; others
 * get 404. The invitation emails a sealed link to the client's email on file that opens the
 * firm's portal invitation page and then its sign-up; the firm approves the sign-up in Sign-ups.
 */
export function createPortalInvitationsClient(request: ApiRequest) {
  return {
    access: async (clientId: string): Promise<ClientPortalAccess> =>
      request(ClientPortalAccess, `${one(clientId)}/portal-access`),
    /**
     * Sends (or resends) the invitation; the earlier link stops working. 409 with the
     * `PortalInvitationBlock` code when it cannot be sent. A failed email still answers 201 with
     * `invitation.delivered: false`.
     */
    send: async (
      clientId: string,
      body: SendPortalInvitationRequest,
    ): Promise<ClientPortalAccess> =>
      request(ClientPortalAccess, `${one(clientId)}/portal-invitation`, {
        method: 'POST',
        body: parseInput(SendPortalInvitationRequest, body),
      }),
    /** The open link stops working. 409 NOT_OPEN when there is none. */
    revoke: async (clientId: string): Promise<ClientPortalAccess> =>
      request(ClientPortalAccess, `${one(clientId)}/portal-invitation/revoke`, { method: 'POST' }),
  };
}

/** The portal's signed-out invitation page (`/{firmSlug}/invitation#token=...`). */
export function createPortalInvitationClient(request: ApiRequest, firmSlug: string) {
  return {
    open: async (body: OpenPortalInvitationRequest): Promise<OpenedPortalInvitation> =>
      request(OpenedPortalInvitation, `/portal/${parseInput(FirmSlug, firmSlug)}/invitation`, {
        method: 'POST',
        body: parseInput(OpenPortalInvitationRequest, body),
      }),
  };
}

export type PortalInvitationsClient = ReturnType<typeof createPortalInvitationsClient>;
export type PortalInvitationClient = ReturnType<typeof createPortalInvitationClient>;
