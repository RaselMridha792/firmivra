import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  type AdminTeamActivityEntry,
  AdminTeamActivityList,
  AdminTeamActivityQuery,
  AdminTeamBulkRequest,
  AdminTeamBulkResult,
  AdminTeamDecisionRequest,
  AdminTeamFormOptions,
  AdminTeamInvitationResult,
  AdminTeamMember,
  AdminTeamMemberId,
  AdminTeamMemberPage,
  AdminTeamMemberResult,
  AdminTeamMembersQuery,
  AdminTeamMeta,
  AdminTeamSummary,
  CreateAdminTeamMemberRequest,
  ResendAdminTeamInvitationRequest,
  UpdateAdminTeamMemberRequest,
} from './schemas.js';

const BASE = '/admin/team';
const member = (id: string) => `${BASE}/members/${parseInput(AdminTeamMemberId, id)}`;
const send = (method: string, body: unknown) => ({ method, body });

/** The directory's filters as a query string: several statuses in one parameter, comma separated. */
function membersQuery(query: AdminTeamMembersQuery): string {
  const q = parseInput(AdminTeamMembersQuery, query);
  return toQuery({ ...q, statuses: q.statuses?.join(',') });
}

/**
 * `api.adminTeam` (apps/web/src/lib/api.ts): Super Admin Team (the directory, the profile panel,
 * Add Team Member, Edit Team Member and the bulk actions). 401 without the Super Admin site's
 * session, 403 for anyone who is not on the Super Admin team, and 403 with this module's codes
 * (ROLE_CEILING, PERMISSION_CEILING, SCOPE_CEILING, DEPARTMENT_NOT_ALLOWED, SELF_CHANGE,
 * PEER_PROTECTED, FORBIDDEN) for anything above the caller's authority: the API checks every rule
 * again, whatever the screen offered. Someone outside the caller's directory is 404 NOT_FOUND.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * Screens show this module's errors with `errorMessage(error, ADMIN_TEAM_ERRORS)`. Every change is
 * an audit entry on the person (`activity`).
 *
 * Not here (docs/work/R60-team.md): messages to team members (a message to one member is
 * `api.adminCommunications`, a broadcast to the whole team `api.adminBroadcasts`), custom groups,
 * locations, teams, presence and the Card / List preference, which no table holds yet. Activating
 * an invitation is the Super Admin site's sign-in flow (R2), not this client.
 */
export function createAdminTeamClient(request: ApiRequest) {
  return {
    /** The signed-in member, their rights, the permission catalog and the filters' values. */
    meta: async (): Promise<AdminTeamMeta> => request(AdminTeamMeta, `${BASE}/meta`),
    /** The KPI row, from the people the signed-in member may see. */
    summary: async (): Promise<AdminTeamSummary> => request(AdminTeamSummary, `${BASE}/summary`),
    /** The cards and the table read the same people with the same filters. */
    members: async (query: AdminTeamMembersQuery = {}): Promise<AdminTeamMemberPage> =>
      request(AdminTeamMemberPage, `${BASE}/members${membersQuery(query)}`),
    /** The profile panel and Edit Team Member. */
    member: async (id: string): Promise<AdminTeamMember> => request(AdminTeamMember, member(id)),
    /** The person's audit trail, newest first. */
    activity: async (
      id: string,
      query: AdminTeamActivityQuery = {},
    ): Promise<AdminTeamActivityEntry[]> =>
      (
        await request(
          AdminTeamActivityList,
          `${member(id)}/activity${toQuery(parseInput(AdminTeamActivityQuery, query))}`,
        )
      ).items,
    /** Add Team Member's choices, or (with an id) Edit Team Member's for that person. */
    formOptions: async (memberId?: string): Promise<AdminTeamFormOptions> =>
      request(
        AdminTeamFormOptions,
        memberId === undefined ? `${BASE}/form-options` : `${member(memberId)}/form-options`,
      ),

    // Changes
    /** 409 EMAIL_TAKEN; the invitation goes out unless the role waits for the department head. */
    createMember: async (body: CreateAdminTeamMemberRequest): Promise<AdminTeamMemberResult> =>
      request(
        AdminTeamMemberResult,
        `${BASE}/members`,
        send('POST', parseInput(CreateAdminTeamMemberRequest, body)),
      ),
    /** 409 CONFLICT, PENDING_APPROVAL or STATUS_NOT_ALLOWED; 422 SUPERVISOR_INVALID. */
    updateMember: async (
      id: string,
      body: UpdateAdminTeamMemberRequest,
    ): Promise<AdminTeamMember> =>
      request(
        AdminTeamMember,
        member(id),
        send('PATCH', parseInput(UpdateAdminTeamMemberRequest, body)),
      ),
    /** Change Department, Role or Status (and Remove from Team) for several people. */
    bulkUpdate: async (body: AdminTeamBulkRequest): Promise<AdminTeamBulkResult> =>
      request(
        AdminTeamBulkResult,
        `${BASE}/members/bulk`,
        send('POST', parseInput(AdminTeamBulkRequest, body)),
      ),
    /** A new link for each person still Pending Invitation. */
    resendInvitation: async (
      body: ResendAdminTeamInvitationRequest,
    ): Promise<AdminTeamInvitationResult> =>
      request(
        AdminTeamInvitationResult,
        `${BASE}/members/invitations`,
        send('POST', parseInput(ResendAdminTeamInvitationRequest, body)),
      ),
    /** Approve or reject a VP / Director hire. 403 FORBIDDEN unless the department head or CEO. */
    decideApproval: async (
      id: string,
      body: AdminTeamDecisionRequest,
    ): Promise<AdminTeamMemberResult> =>
      request(
        AdminTeamMemberResult,
        `${member(id)}/decision`,
        send('POST', parseInput(AdminTeamDecisionRequest, body)),
      ),
  };
}

export type AdminTeamClient = ReturnType<typeof createAdminTeamClient>;
