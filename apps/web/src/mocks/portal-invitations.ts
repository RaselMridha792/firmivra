import {
  ApiRequestError,
  type ClientPortalAccess,
  ClientId,
  OpenPortalInvitationRequest,
  parseInput,
  PORTAL_INVITATION_DAYS,
  PORTAL_INVITATIONS_PER_DAY,
  type PortalInvitationClient,
  type PortalInvitationsClient,
  SendPortalInvitationRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { advisoryClientContacts } from './business-advisory';
import { clientFixtures } from './clients';

const DAY_MS = 24 * 60 * 60 * 1000;
const SENDER = 'Morgan Example';
/** The one link the mock hands out, so the portal page can be tried with `#token=mock-...`. */
const MOCK_TOKEN = 'mock-portal-invitation-token-0001';

interface State {
  sent: { id: string; at: number; revokedAt: number | null }[];
}

/**
 * Contract mock for `api.portalInvitations` (Business Advisory B3): a client of the clients mock or
 * of the advisory mock, with no portal login; sends and revokes in memory, as the API's rules say.
 * A client of the clients mock with a login is HAS_LOGIN; one without an email, NO_EMAIL.
 */
export function createPortalInvitationsMock(): PortalInvitationsClient {
  const states = new Map<string, State>();
  const stateOf = (id: string) => {
    const s = states.get(id) ?? { sent: [] };
    states.set(id, s);
    return s;
  };
  const view = (clientId: string): ClientPortalAccess => {
    const id = parseInput(ClientId, clientId);
    const record = clientFixtures().find((c) => c.id === id);
    const contact = advisoryClientContacts().find((c) => c.id === id);
    if (!record && !contact) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
    const name = record?.displayName ?? contact!.name;
    const email = record ? record.email : contact!.email;
    const logins = record?.portalLogins ?? [];
    const state = stateOf(id);
    const latest = state.sent.at(-1);
    const today = state.sent.filter((s) => s.at > Date.now() - DAY_MS).length;
    const linked = logins.some((l) => ['INVITED', 'PENDING_APPROVAL', 'ACTIVE'].includes(l.status));
    const expiresAt = latest ? latest.at + PORTAL_INVITATION_DAYS * DAY_MS : 0;
    return {
      clientId: id,
      clientName: name,
      recipient: email ? { name, email } : null,
      logins,
      invitation: latest
        ? {
            id: latest.id,
            sentAt: new Date(latest.at).toISOString(),
            sentBy: SENDER,
            expiresAt: new Date(expiresAt).toISOString(),
            delivered: true,
            revokedAt: latest.revokedAt ? new Date(latest.revokedAt).toISOString() : null,
            state: linked
              ? 'ACCEPTED'
              : latest.revokedAt
                ? 'REVOKED'
                : expiresAt <= Date.now()
                  ? 'EXPIRED'
                  : 'OPEN',
          }
        : null,
      blocked: !email
        ? 'NO_EMAIL'
        : linked
          ? 'HAS_LOGIN'
          : today >= PORTAL_INVITATIONS_PER_DAY
            ? 'DAILY_LIMIT'
            : null,
    };
  };
  return {
    access: async (clientId) => {
      await mockDelay();
      return view(clientId);
    },
    send: async (clientId, body) => {
      await mockDelay();
      parseInput(SendPortalInvitationRequest, body);
      const before = view(clientId);
      if (before.blocked) throw new ApiRequestError(409, before.blocked, 'Cannot send');
      stateOf(before.clientId).sent.push({
        id: crypto.randomUUID(),
        at: Date.now(),
        revokedAt: null,
      });
      return view(clientId);
    },
    revoke: async (clientId) => {
      await mockDelay();
      const before = view(clientId);
      if (before.invitation?.state !== 'OPEN') {
        throw new ApiRequestError(409, 'NOT_OPEN', 'No open invitation to revoke.');
      }
      stateOf(before.clientId).sent.at(-1)!.revokedAt = Date.now();
      return view(clientId);
    },
  };
}

/** Contract mock for the portal's invitation page: `#token=mock-portal-invitation-token-0001`. */
export function portalInvitationMock(firmSlug: string): PortalInvitationClient {
  return {
    open: async (body) => {
      await mockDelay();
      const { token } = parseInput(OpenPortalInvitationRequest, body);
      if (token !== MOCK_TOKEN) {
        throw new ApiRequestError(410, 'INVITATION_INVALID', 'This invitation link has expired.');
      }
      return {
        firmName: firmSlug === 'lvp' ? 'LVP Accounting & Taxes' : 'Sample Firm',
        name: 'Marcus Taylor',
        maskedEmail: 'm•••@taylorconstruction.example.test',
        expiresAt: new Date(Date.now() + PORTAL_INVITATION_DAYS * DAY_MS).toISOString(),
      };
    },
  };
}
