import {
  ApiRequestError,
  AuditEntry,
  type AuditLogClient,
  AuditLogQuery,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { firstClientId, type MockFirmRole, mockStaff } from './clients';
import { mockOffset } from './tasks';

/**
 * Mock data for `api.auditLog` (R12): a few synthetic entries of the kinds the API writes, one of
 * them by Firmivra Support. Owner and Admin, as in the API: Staff get 403 FORBIDDEN, before any
 * other check.
 */
const owner = {
  userId: '00000000-0000-4000-8000-000000000101',
  name: 'Mock User',
  kind: 'STAFF' as const,
};
const entryId = (n: number) => `0199b6d3-0000-7000-8000-${String(n).padStart(12, '0')}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let fixtures: readonly AuditEntry[] | undefined;

/** Built on first use (times relative to now): importing this file runs nothing. */
export function auditFixtures(): readonly AuditEntry[] {
  const entry = (n: number, fields: Partial<AuditEntry> & Pick<AuditEntry, 'action' | 'entity'>) =>
    // Parsed, so a fixture that breaks the contract fails on first use.
    AuditEntry.parse({
      id: entryId(n),
      at: minutesAgo(n * 37),
      actor: owner,
      metadata: {},
      ip: '203.0.113.10',
      requestId: `mock-request-${n}`,
      ...fields,
    });
  fixtures ??= [
    entry(1, {
      action: 'appointment.rescheduled',
      entity: { type: 'appointment', id: '0199b6c3-0000-7000-8000-000000000001' },
      actor: { ...mockStaff, kind: 'STAFF' },
    }),
    entry(2, {
      action: 'client_account.approved',
      entity: { type: 'client_account', id: '0199b6a1-0000-7000-8000-0000000000a1' },
      metadata: { clientId: firstClientId, linked: false },
    }),
    entry(3, {
      action: 'client.created',
      entity: { type: 'client', id: firstClientId },
      metadata: { from: 'portal_sign_up' },
    }),
    entry(4, {
      action: 'auth.signed_in',
      entity: { type: 'user', id: firstClientId },
      actor: {
        userId: '0199b6a1-0000-7000-8000-0000000000c1',
        name: 'Jamie Sample',
        kind: 'CLIENT',
      },
      metadata: { pool: 'CLIENT' },
    }),
    entry(5, {
      action: 'membership.invited',
      entity: { type: 'membership', id: '0199b6a0-0000-7000-8000-0000000000e1' },
      metadata: { role: 'STAFF', resent: false },
    }),
    // A Super Admin's read through a support grant: never the person or their IP.
    entry(6, {
      action: 'client.viewed',
      entity: { type: 'client', id: firstClientId },
      actor: { userId: null, name: 'Firmivra Support', kind: 'PLATFORM' },
      metadata: { via: 'support_grant' },
      ip: null,
    }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);

/** An in-memory `api.auditLog`; Owner (the default) and Admin read it. */
export function createAuditLogMock(options: { role?: MockFirmRole } = {}): AuditLogClient {
  return {
    list: async (query = {}) => {
      await mockDelay();
      if (options.role === 'STAFF') {
        throw new ApiRequestError(403, 'FORBIDDEN', 'Only the Owner and Admins read the audit log');
      }
      const q = parseInput(AuditLogQuery, query);
      const all = auditFixtures().filter(
        (e) =>
          (!q.action ||
            (q.action.endsWith('.') ? e.action.startsWith(q.action) : e.action === q.action)) &&
          (!q.actorUserId || e.actor?.userId === q.actorUserId) &&
          (!q.entityType || e.entity.type === q.entityType) &&
          (!q.entityId || e.entity.id === q.entityId) &&
          (!q.from || e.at >= q.from) &&
          (!q.to || e.at < q.to),
      );
      const start = mockOffset(q.cursor);
      const items = all.slice(start, start + q.limit);
      return copy({
        items,
        nextCursor: start + q.limit < all.length ? String(start + q.limit) : null,
      });
    },
  };
}
