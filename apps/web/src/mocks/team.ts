import {
  ApiRequestError,
  ChangeTeamRoleRequest,
  parseInput,
  type TeamClient,
  TeamMember,
  TeamMemberId,
} from '@firmivra/types';

/**
 * Mock data for `api.team`. The web kit's mock mode (NEXT_PUBLIC_API_MOCK) swaps the real
 * client for `createTeamMock()`. Synthetic data only. It checks input with the same schemas and
 * returns the API's error codes, so a screen built on it works unchanged against the API.
 */
const at = '2026-10-06T09:00:00.000Z';
const id = (n: number) => `0199b6a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const member = (
  n: number,
  name: string,
  role: TeamMember['role'],
  status: TeamMember['status'],
  invite: TeamMember['invite'] = null,
): TeamMember =>
  // Parsed, so a fixture that breaks the contract fails as soon as the mock loads.
  TeamMember.parse({
    id: id(n),
    user: { id: id(100 + n), name, email: `${name.split(' ')[0]?.toLowerCase()}@lvp.test` },
    role,
    status,
    invite,
    isYou: false,
    createdAt: at,
  });

export const teamFixtures: readonly TeamMember[] = [
  member(1, 'Olivia Owner', 'OWNER', 'ACTIVE'),
  member(2, 'Adam Admin', 'ADMIN', 'ACTIVE'),
  member(3, 'Sam Staff', 'STAFF', 'ACTIVE'),
  member(4, 'Ivy Invited', 'STAFF', 'INVITED', {
    sentAt: '2026-10-06T09:00:00.000Z',
    expiresAt: '2026-10-13T09:00:00.000Z',
  }),
  member(5, 'Eli Expired', 'STAFF', 'INVITED', {
    sentAt: '2026-09-20T09:00:00.000Z',
    expiresAt: '2026-09-27T09:00:00.000Z',
  }),
  member(6, 'Dana Former', 'STAFF', 'DEACTIVATED'),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const INVITE_DAYS = 7;

/**
 * An in-memory `api.team` with the same functions, rules and errors as the API. `role` is the
 * signed-in person (default OWNER, who is Olivia): ADMIN is Adam, who manages Staff only;
 * STAFF gets 403 FORBIDDEN on every call.
 */
export function createTeamMock(options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {}): TeamClient {
  const role = options.role ?? 'OWNER';
  const youId = role === 'ADMIN' ? id(2) : id(1);
  // Rows are replaced, never edited, and callers always get copies, like a real API response.
  let rows: TeamMember[] = teamFixtures.map((m) => ({ ...m, isYou: m.id === youId }));
  const copy = (m: TeamMember): TeamMember => ({
    ...m,
    user: { ...m.user },
    invite: m.invite && { ...m.invite },
  });
  const replace = (m: TeamMember) => {
    rows = rows.map((r) => (r.id === m.id ? m : r));
    return copy(m);
  };
  const allowed = async () => {
    await pause();
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const find = (memberId: string) => {
    const row = rows.find((r) => r.id === parseInput(TeamMemberId, memberId));
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  /** Admins act on Staff only; nobody acts on themselves. */
  const manageable = (row: TeamMember) => {
    if (role === 'ADMIN' && row.role !== 'STAFF') {
      throw fail(403, 'FORBIDDEN', 'This action is not permitted');
    }
    if (row.isYou) throw fail(409, 'CANNOT_CHANGE_SELF', 'You cannot change your own access');
  };
  const keepsAnOwner = (row: TeamMember) => {
    const others = rows.filter(
      (r) => r.id !== row.id && r.role === 'OWNER' && r.status === 'ACTIVE',
    );
    if (row.role === 'OWNER' && row.status === 'ACTIVE' && others.length === 0) {
      throw fail(409, 'LAST_ACTIVE_OWNER', 'The firm needs at least one active owner');
    }
  };
  const order = { OWNER: 0, ADMIN: 1, STAFF: 2 } as const;

  return {
    list: async () => {
      await allowed();
      return [...rows]
        .sort((a, b) => order[a.role] - order[b.role] || a.user.name.localeCompare(b.user.name))
        .map(copy);
    },
    changeRole: async (memberId, body) => {
      await allowed();
      if (role !== 'OWNER') throw fail(403, 'FORBIDDEN', 'Only an owner can change roles');
      const { role: next } = parseInput(ChangeTeamRoleRequest, body);
      const row = find(memberId);
      manageable(row);
      if (row.role === next) return copy(row);
      if (next !== 'OWNER') keepsAnOwner(row);
      return replace({ ...row, role: next });
    },
    deactivate: async (memberId) => {
      await allowed();
      const row = find(memberId);
      manageable(row);
      if (row.status === 'DEACTIVATED') return copy(row);
      keepsAnOwner(row);
      return replace({ ...row, status: 'DEACTIVATED', invite: null });
    },
    resendInvite: async (memberId) => {
      await allowed();
      const row = find(memberId);
      manageable(row);
      if (row.status !== 'INVITED') {
        throw fail(409, 'NOT_INVITED', 'This person has already activated their account');
      }
      const sent = new Date();
      const expires = new Date(sent.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
      return replace({
        ...row,
        invite: { sentAt: sent.toISOString(), expiresAt: expires.toISOString() },
      });
    },
  };
}
