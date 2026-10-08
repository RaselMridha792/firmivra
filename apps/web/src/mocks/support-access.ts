import {
  AdminSupportAccess,
  type AdminSupportAccessClient,
  AdminSupportAccessQuery,
  ApiRequestError,
  ApproveSupportAccessRequest,
  CreateSupportAccessRequest,
  FirmSupportAccess,
  parseInput,
  type SupportAccessClient,
  SupportAccessId,
  SupportAccessQuery,
  type SupportAccessStatus,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

/**
 * Mock data for `api.supportAccess` (the firm's Owner and Admins) and `api.adminSupportAccess`
 * (the Super Admins), R8. One in-memory store for both, as in the API: a request a Super Admin
 * makes shows in the firm's list. Owner and Admin read, only an Owner decides; Staff get 403 on
 * every firm call, before anything else.
 */
const HOUR = 60 * 60_000;
const firm = { id: '0199b6e0-0000-7000-8000-000000000001', name: 'Mock Firm', slug: 'mock' };
const owner = { userId: '00000000-0000-4000-8000-000000000101', name: 'Mock User' };
const admin = { userId: '0199b6e0-0000-7000-8000-0000000000a1', name: 'Mock Super Admin' };
/** Another Super Admin: the open fixtures are theirs, so the signed-in one can still ask. */
const colleague = { userId: '0199b6e0-0000-7000-8000-0000000000a2', name: 'Riley Admin (fake)' };
const requestId = (n: number) => `0199b6e1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

/** One row as the database keeps it; the status is derived, as in the API. */
interface Row {
  id: string;
  firm: typeof firm;
  admin: { userId: string; name: string };
  reason: string;
  requestedAt: string;
  approvedBy: typeof owner | null;
  expiresAt: string | null;
  endedAt: string | null;
}

let rows: Row[] | undefined;
let next = 10;

/** Built on first use (times relative to now): importing this file runs nothing. */
function store(): Row[] {
  const row = (n: number, fields: Partial<Row> & Pick<Row, 'reason' | 'requestedAt'>): Row => ({
    id: requestId(n),
    firm,
    admin,
    approvedBy: null,
    expiresAt: null,
    endedAt: null,
    ...fields,
  });
  rows ??= [
    row(1, {
      reason: 'A client upload fails with an error (fake)',
      requestedAt: at(-1),
      admin: colleague,
    }),
    row(2, {
      reason: 'Checking an invoice total the firm reported (fake)',
      requestedAt: at(-5),
      admin: colleague,
      approvedBy: owner,
      expiresAt: at(19),
    }),
    row(3, {
      reason: 'Looking into a sign-in problem (fake)',
      requestedAt: at(-80),
      approvedBy: owner,
      expiresAt: at(-56),
    }),
    row(4, {
      reason: 'Reviewing a settings question (fake)',
      requestedAt: at(-120),
      endedAt: at(-118),
    }),
  ];
  return rows;
}

function statusOf(r: Row, now = Date.now()): SupportAccessStatus {
  if (r.endedAt) return r.approvedBy ? 'REVOKED' : 'DECLINED';
  if (!r.approvedBy) return 'PENDING';
  return r.expiresAt && Date.parse(r.expiresAt) > now ? 'ACTIVE' : 'EXPIRED';
}

const RANK: Record<SupportAccessStatus, number> = {
  PENDING: 0,
  ACTIVE: 1,
  EXPIRED: 2,
  DECLINED: 2,
  REVOKED: 2,
};

/** Open ones first (pending, then active), then the rest; newest first within each. */
function ordered(list: Row[]): Row[] {
  return [...list].sort(
    (a, b) => RANK[statusOf(a)] - RANK[statusOf(b)] || b.requestedAt.localeCompare(a.requestedAt),
  );
}

/** A page by offset; the cursor is the offset as text (the API's cursor is opaque too). */
function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = cursor ? Number(cursor) || 0 : 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
}

const toFirm = (r: Row) =>
  FirmSupportAccess.parse({
    id: r.id,
    reason: r.reason,
    status: statusOf(r),
    requestedAt: r.requestedAt,
    approvedBy: r.approvedBy,
    expiresAt: r.expiresAt,
    endedAt: r.endedAt,
  });
const toAdmin = (r: Row) =>
  AdminSupportAccess.parse({
    id: r.id,
    firm: r.firm,
    admin: r.admin,
    reason: r.reason,
    status: statusOf(r),
    requestedAt: r.requestedAt,
    expiresAt: r.expiresAt,
    endedAt: r.endedAt,
  });

const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Not found');

/** In-memory `api.supportAccess`: `role` is the signed-in member's (Owner when left out). */
export function createSupportAccessMock(
  options: { role?: MockFirmRole } = {},
): SupportAccessClient {
  const role = options.role ?? 'OWNER';
  const readable = () => {
    if (role === 'STAFF') {
      throw new ApiRequestError(403, 'FORBIDDEN', 'Only the Owner and Admins see support access');
    }
  };
  const owned = () => {
    readable();
    if (role !== 'OWNER') {
      throw new ApiRequestError(403, 'FORBIDDEN', 'Only an Owner answers support access requests');
    }
  };
  const find = (id: string) => {
    const r = store().find((x) => x.id === parseInput(SupportAccessId, id).toLowerCase());
    if (!r) throw notFound();
    return r;
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      readable();
      const q = parseInput(SupportAccessQuery, query);
      const mine = ordered(store()).filter((r) => !q.status || statusOf(r) === q.status);
      const p = page(mine, q.cursor, q.limit);
      return { items: p.items.map(toFirm), nextCursor: p.nextCursor };
    },
    approve: async (id, body = {}) => {
      await mockDelay();
      owned();
      const { hours } = parseInput(ApproveSupportAccessRequest, body);
      const r = find(id);
      if (statusOf(r) !== 'PENDING') {
        throw new ApiRequestError(
          409,
          'SUPPORT_REQUEST_DECIDED',
          'This request was already answered',
        );
      }
      r.approvedBy = owner;
      r.expiresAt = at(hours);
      return toFirm(r);
    },
    decline: async (id) => {
      await mockDelay();
      owned();
      const r = find(id);
      if (statusOf(r) !== 'PENDING') {
        throw new ApiRequestError(
          409,
          'SUPPORT_REQUEST_DECIDED',
          'This request was already answered',
        );
      }
      r.endedAt = new Date().toISOString();
      return toFirm(r);
    },
    revoke: async (id) => {
      await mockDelay();
      owned();
      const r = find(id);
      if (statusOf(r) !== 'ACTIVE') {
        throw new ApiRequestError(409, 'SUPPORT_GRANT_NOT_ACTIVE', 'This grant is not active');
      }
      r.endedAt = new Date().toISOString();
      return toFirm(r);
    },
  };
}

/** In-memory `api.adminSupportAccess`: Mock Super Admin, and Mock Firm as the only firm. */
export function createAdminSupportAccessMock(): AdminSupportAccessClient {
  return {
    request: async (businessId, body) => {
      await mockDelay();
      const { reason } = parseInput(CreateSupportAccessRequest, body);
      if (businessId.toLowerCase() !== firm.id) throw notFound();
      const open = store().some(
        (r) =>
          r.firm.id === firm.id &&
          r.admin.userId === admin.userId &&
          ['PENDING', 'ACTIVE'].includes(statusOf(r)),
      );
      if (open) {
        throw new ApiRequestError(
          409,
          'SUPPORT_REQUEST_OPEN',
          'You already have an open request for this firm',
        );
      }
      const created: Row = {
        id: requestId(next++),
        firm,
        admin,
        reason,
        requestedAt: new Date().toISOString(),
        approvedBy: null,
        expiresAt: null,
        endedAt: null,
      };
      store().push(created);
      return toAdmin(created);
    },
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(AdminSupportAccessQuery, query);
      const all = ordered(store()).filter(
        (r) =>
          (!q.businessId || r.firm.id === q.businessId.toLowerCase()) &&
          (!q.status || statusOf(r) === q.status),
      );
      const p = page(all, q.cursor, q.limit);
      return { items: p.items.map(toAdmin), nextCursor: p.nextCursor };
    },
  };
}
