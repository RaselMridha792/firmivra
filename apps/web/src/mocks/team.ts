import {
  ApiRequestError,
  ChangeTeamRoleRequest,
  CreateInviteRequest,
  type InviteResponse,
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

let fixtures: readonly TeamMember[] | undefined;

/** Six members in every role and status. Built on first use: importing this file runs nothing. */
export function teamFixtures(): readonly TeamMember[] {
  fixtures ??= [
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
  return fixtures;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const INVITE_DAYS = 7;

/** `staffAuth.createInvite` (R2) in mock mode: invites land in the same team list. */
export type CreateInviteMock = (body: CreateInviteRequest) => Promise<InviteResponse>;

/**
 * An in-memory `api.team` with the same functions, rules and errors as the API. `role` is the
 * signed-in person (default OWNER, who is Olivia): ADMIN is Adam, who manages Staff only;
 * STAFF gets 403 FORBIDDEN on every call. `createInvite` follows R2's invite rules on the same
 * rows; lib/auth.ts uses it as `staffAuth.createInvite` (through `sharedTeamMock`), so a screen can
 * invite, then reload.
 */
export function createTeamMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): TeamClient & { createInvite: CreateInviteMock } {
  const role = options.role ?? 'OWNER';
  const youId = role === 'ADMIN' ? id(2) : id(1);
  // Rows are replaced, never edited, and callers always get copies, like a real API response.
  let rows: TeamMember[] = teamFixtures().map((m) => ({ ...m, isYou: m.id === youId }));
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
  const newInvite = () => {
    const sent = new Date();
    const expires = new Date(sent.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000);
    return { sentAt: sent.toISOString(), expiresAt: expires.toISOString() };
  };
  /** R2's rule: Owners invite Admins and Staff, Admins invite Staff; only the platform, Owners. */
  const mayInvite = (wanted: TeamMember['role']) => {
    const allowedRoles = role === 'OWNER' ? ['ADMIN', 'STAFF'] : ['STAFF'];
    if (!allowedRoles.includes(wanted)) {
      throw fail(403, 'FORBIDDEN', 'You cannot invite this role');
    }
  };
  let nextId = 50;

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
      if (row.status !== 'ACTIVE') {
        throw fail(409, 'NOT_ACTIVE', 'Invite this person again to change their role');
      }
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
        throw fail(409, 'NOT_INVITED', 'This person has no open invite');
      }
      mayInvite(row.role);
      return replace({ ...row, invite: newInvite() });
    },
    createInvite: async (body) => {
      await allowed();
      const input = parseInput(CreateInviteRequest, body);
      mayInvite(input.role);
      const email = input.email.toLowerCase();
      const existing = rows.find((r) => r.user.email.toLowerCase() === email);
      if (existing?.status === 'ACTIVE') {
        throw fail(409, 'ALREADY_MEMBER', 'This person already works at this firm');
      }
      if (existing) mayInvite(existing.role);
      const invite = newInvite();
      const row: TeamMember = existing
        ? { ...existing, role: input.role, status: 'INVITED', invite }
        : {
            id: id(nextId),
            user: { id: id(100 + nextId++), name: input.name, email: input.email },
            role: input.role,
            status: 'INVITED',
            invite,
            isYou: false,
            createdAt: invite.sentAt,
          };
      if (existing) replace(row);
      else rows = [...rows, row];
      return {
        id: id(900 + nextId),
        membershipId: row.id,
        email: row.user.email,
        name: input.name,
        role: input.role === 'ADMIN' ? 'ADMIN' : 'STAFF',
        expiresAt: invite.expiresAt,
      };
    },
  };
}

let shared: ReturnType<typeof createTeamMock> | undefined;

/**
 * The one team mock that `api.team` and `staffAuth.createInvite` (lib/auth.ts) share in mock
 * mode, so an invite shows in the team list. Built on first use.
 */
export function sharedTeamMock(role?: 'OWNER' | 'ADMIN' | 'STAFF') {
  shared ??= createTeamMock({ role });
  return shared;
}
