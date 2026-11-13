import {
  ApiRequestError,
  ClientId,
  type ClientPortalActivityItem,
  type ClientPortalClient,
  ClientPortalActivityQuery,
  type ClientPortalHeader,
  type ClientPortalLock,
  LockClientPortalRequest,
  parseInput,
  type PendingClientAction,
  RECENT_PORTAL_CLIENTS,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures } from './clients';

const DAY_MS = 24 * 60 * 60 * 1000;
const MEMBER = 'Morgan Example';
const PORTAL = 'https://portal.localhost:3001/lvp';

/**
 * Contract mock for `api.clientPortal` (the firm workspace's Client Portal module) on the clients
 * mock's synthetic clients. Recent Clients, the lock and the activity live in memory; the summary,
 * pending actions and login history are fixed synthetic numbers. Builds nothing on import.
 */
export function createClientPortalMock(): ClientPortalClient {
  const recent: { id: string; at: number }[] = [];
  const locks = new Map<string, ClientPortalLock>();
  let activity: Map<string, ClientPortalActivityItem[]> | null = null;

  const record = (clientId: string) => {
    const id = parseInput(ClientId, clientId);
    const index = clientFixtures().findIndex((c) => c.id === id);
    const found = clientFixtures()[index];
    if (!found) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
    return { found, number: `CL-${10024 + index}` };
  };
  const lockOf = (clientId: string): ClientPortalLock =>
    locks.get(clientId) ?? {
      clientId,
      locked: false,
      lockedAt: null,
      lockedBy: null,
      reason: null,
    };
  const events = (clientId: string): ClientPortalActivityItem[] => {
    activity ??= new Map();
    let list = activity.get(clientId);
    if (!list) {
      const ago = (days: number, hours = 10) =>
        new Date(Date.now() - days * DAY_MS - hours * 3_600_000).toISOString();
      const client = record(clientId).found.displayName;
      const row = (
        n: number,
        type: string,
        at: string,
        actor: ClientPortalActivityItem['actor'],
      ): ClientPortalActivityItem => ({
        id: `0199d100-0000-7000-8000-${String(n).padStart(12, '0')}`,
        at,
        type,
        actor,
        entity: null,
        ip: `198.51.100.${n}`,
      });
      list = record(clientId).found.portalLogins.length
        ? [
            row(1, 'document.uploaded', ago(0, 2), { kind: 'CLIENT', name: client }),
            row(2, 'message.sent', ago(1, 5), { kind: 'CLIENT', name: client }),
            row(3, 'appointment.booked', ago(2), { kind: 'CLIENT', name: client }),
            row(4, 'invoice.viewed', ago(4), { kind: 'CLIENT', name: client }),
            row(5, 'intake.submitted', ago(5), { kind: 'CLIENT', name: client }),
            row(6, 'portal.signed_in', ago(6), { kind: 'CLIENT', name: client }),
          ]
        : [];
      activity.set(clientId, list);
    }
    return list;
  };

  return {
    recent: async () => {
      await mockDelay();
      return {
        items: recent.slice(0, RECENT_PORTAL_CLIENTS).map(({ id, at }) => {
          const { found, number } = record(id);
          return {
            id,
            number,
            name: found.displayName,
            email: found.email,
            viewedAt: new Date(at).toISOString(),
          };
        }),
      };
    },
    get: async (clientId) => {
      await mockDelay();
      const { found, number } = record(clientId);
      const at = recent.findIndex((r) => r.id === found.id);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift({ id: found.id, at: Date.now() });
      const lock = lockOf(found.id);
      const active = found.portalLogins.some((l) => l.status === 'ACTIVE');
      const pending = found.portalLogins.some((l) => l.status === 'PENDING_APPROVAL');
      const latest = events(found.id)[0];
      const header: ClientPortalHeader = {
        client: {
          id: found.id,
          number,
          name: found.displayName,
          accountType: found.accountType,
          status: active ? 'ACTIVE' : 'NEW',
          email: found.email,
          phone: found.phone,
          clientSince: '2024-01-12',
          archived: !!found.archivedAt,
        },
        portal: {
          status: lock.locked
            ? 'LOCKED'
            : active
              ? 'ACTIVE'
              : pending
                ? 'PENDING_APPROVAL'
                : 'NOT_ACTIVATED',
          lock,
          logins: found.portalLogins,
          portalSince: active ? '2024-01-12T15:00:00.000Z' : null,
          lastLogin: active ? new Date(Date.now() - 6 * DAY_MS).toISOString() : null,
          lastActivity: latest ? { at: latest.at, type: latest.type } : null,
          mfa: active ? 'ENABLED' : null,
          invitation: null,
          invitationBlocked: found.email ? (active || pending ? 'HAS_LOGIN' : null) : 'NO_EMAIL',
          link: PORTAL,
        },
        can: { manageAccess: true, invite: true },
      };
      return header;
    },
    summary: async (clientId, days = '30') => {
      await mockDelay();
      const { found } = record(clientId);
      const has = found.portalLogins.length > 0;
      return {
        days: Number(days),
        documents: { added: has ? 5 : 0, pendingReview: has ? 2 : 0 },
        messages: { inRange: has ? 3 : 0, unread: has ? 1 : 0 },
        appointments: {
          upcoming: has ? 1 : 0,
          next: has ? new Date(Date.now() + 5 * DAY_MS).toISOString() : null,
        },
        taxReturns: { total: has ? 2 : 0, inProgress: has ? 1 : 0 },
        invoices: { issued: has ? 3 : 0, outstandingCents: has ? 29000 : 0 },
        intakeForms: { sent: has ? 1 : 0, pending: 0, needsReview: has ? 1 : 0 },
      };
    },
    pendingActions: async (clientId) => {
      await mockDelay();
      const { found } = record(clientId);
      if (!found.portalLogins.length) return { items: [] };
      const item = (
        kind: PendingClientAction['kind'],
        count: number,
        title: string,
        n: number,
        extra: Partial<PendingClientAction> = {},
      ): PendingClientAction => ({
        kind,
        count,
        title,
        recordId: `0199d200-0000-7000-8000-${String(n).padStart(12, '0')}`,
        amountCents: null,
        dueOn: null,
        at: null,
        overdue: false,
        ...extra,
      });
      return {
        items: [
          item('DOCUMENTS_REQUESTED', 2, 'W-2 forms (fake)', 1, { dueOn: '2026-11-20' }),
          item('INTAKE_INCOMPLETE', 1, 'Business Information Form', 2),
          item('SIGNATURE_REQUIRED', 1, 'Form 8879 (e-File Authorization)', 3),
          item('INVOICE_OUTSTANDING', 1, 'INV-1001', 4, {
            amountCents: 29000,
            dueOn: '2026-11-20',
          }),
          item('APPOINTMENT_UPCOMING', 1, 'Tax Review Meeting', 5, {
            at: new Date(Date.now() + 5 * DAY_MS).toISOString(),
          }),
        ],
      };
    },
    activity: async (clientId, query = {}) => {
      await mockDelay();
      const q = parseInput(ClientPortalActivityQuery, query);
      const all = events(record(clientId).found.id).filter(
        (e) =>
          (!q.actor || e.actor.kind === q.actor) &&
          (!q.type || e.type === q.type || e.type.startsWith(`${q.type}.`)),
      );
      const start = q.cursor ? Number(q.cursor) : 0;
      const items = all.slice(start, start + q.limit);
      return {
        items,
        nextCursor: start + q.limit < all.length ? String(start + q.limit) : null,
      };
    },
    logins: async (clientId) => {
      await mockDelay();
      const { found } = record(clientId);
      const email = found.portalLogins[0]?.email ?? null;
      if (!email) return { items: [], nextCursor: null };
      const at = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
      return {
        items: [
          {
            id: '0199d300-0000-7000-8000-000000000001',
            at: at(6),
            event: 'SIGNED_IN',
            email,
            ip: '198.51.100.7',
            until: null,
          },
          {
            id: '0199d300-0000-7000-8000-000000000002',
            at: at(6.01),
            event: 'SIGN_IN_FAILED',
            email,
            ip: '198.51.100.7',
            until: null,
          },
        ],
        nextCursor: null,
      };
    },
    lock: async (clientId, body = {}) => {
      await mockDelay();
      const { found } = record(clientId);
      const { reason } = parseInput(LockClientPortalRequest, body);
      if (!locks.has(found.id)) {
        locks.set(found.id, {
          clientId: found.id,
          locked: true,
          lockedAt: new Date().toISOString(),
          lockedBy: MEMBER,
          reason: reason || null,
        });
      }
      return lockOf(found.id);
    },
    unlock: async (clientId) => {
      await mockDelay();
      const { found } = record(clientId);
      locks.delete(found.id);
      return lockOf(found.id);
    },
  };
}
