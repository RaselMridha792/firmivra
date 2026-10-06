import { type ApiRequest, parseInput } from '../client.js';
import { ChangeTeamRoleRequest, ListTeamResponse, TeamMember, TeamMemberId } from './schemas.js';

const BASE = '/business/team';
const one = (id: string) => `${BASE}/${parseInput(TeamMemberId, id)}`;

/**
 * `api.team` (apps/web/src/lib/api.ts): the firm's team for Owner and Admin (403 for staff),
 * also while the firm is Pending Setup (the setup wizard's Team and access step).
 * Invite with `staffAuth.createInvite` (R2), then reload the list. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createTeamClient(request: ApiRequest) {
  return {
    list: async (): Promise<TeamMember[]> => (await request(ListTeamResponse, BASE)).items,
    /** Owners only, ACTIVE members only. 409 NOT_ACTIVE, CANNOT_CHANGE_SELF; 404 unknown id. */
    changeRole: async (id: string, body: ChangeTeamRoleRequest): Promise<TeamMember> =>
      request(TeamMember, one(id), {
        method: 'PATCH',
        body: parseInput(ChangeTeamRoleRequest, body),
      }),
    /**
     * Ends their access to this firm (other firms are untouched) and cancels an open invite.
     * Admins: Staff only (403 otherwise). Repeating is harmless.
     */
    deactivate: async (id: string): Promise<TeamMember> =>
      request(TeamMember, `${one(id)}/deactivate`, { method: 'POST' }),
    /** A new activation link; the old one stops working. 409 NOT_INVITED; 429 when too often. */
    resendInvite: async (id: string): Promise<TeamMember> =>
      request(TeamMember, `${one(id)}/resend-invite`, { method: 'POST' }),
  };
}

export type TeamClient = ReturnType<typeof createTeamClient>;
