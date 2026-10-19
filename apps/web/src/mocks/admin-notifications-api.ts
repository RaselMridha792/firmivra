import {
  type AdminNotification,
  type AdminNotificationsClient,
  type AdminNotificationStatus,
  ApiRequestError,
  BulkAdminNotificationsRequest,
  ListAdminNotificationsQuery,
  MarkAllAdminNotificationsReadRequest,
  parseInput,
  RecentAdminNotificationsQuery,
} from '@firmivra/types';
import { mockDelay, mockedEmpty } from '../lib/mock';
import { createAdminNotificationFixtures } from './admin-notifications';

/**
 * `api.adminNotifications` in mock mode (R56): the contract's calls on Arfan's S08 fixtures
 * (mocks/admin-notifications.ts, unchanged), mapped to the contract's shape. Same rules and error
 * codes as the API: resolve only items that ask for work, resolved and dismissed are final, the
 * content never changes. Synthetic data only. Nothing is built until the first call.
 */
const ME = { userId: '0199c1a0-0000-7000-8000-0000000000ff', name: 'Mock Super Admin' };
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const uuid = (n: number) => `0199c1a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** The day in US Eastern time, as the API counts "today". */
const easternDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

const statusIs = (n: AdminNotification, s: AdminNotificationStatus) =>
  s === 'UNREAD' ? n.readAt === null : s === 'READ' ? n.readAt !== null : n.attention === s;

export function createAdminNotificationsMock(): AdminNotificationsClient {
  let rows: AdminNotification[] | undefined;
  const all = () => {
    rows ??= mockedEmpty('adminNotifications')
      ? []
      : createAdminNotificationFixtures().map((f, i) => ({
          id: uuid(i + 1),
          category: f.category,
          type: `${f.category.toLowerCase()}.${f.title.toLowerCase().replace(/[^a-z]+/g, '_')}`,
          priority: f.priority,
          title: f.title,
          body: f.description,
          source: { type: f.relatedType, id: null, label: f.relatedName },
          business: null,
          requiresAction: f.attention === 'ACTION_REQUIRED',
          attention: f.attention,
          readAt: f.isRead ? f.occurredAt : null,
          resolvedAt: null,
          resolvedBy: null,
          dismissedAt: null,
          occurredAt: f.occurredAt,
          createdAt: f.occurredAt,
        }));
    return rows;
  };
  const find = (id: string) => {
    const n = all().find((x) => x.id === id);
    if (!n) throw fail(404, 'NOT_FOUND', 'Not found');
    return n;
  };
  const closed = (n: AdminNotification) =>
    n.attention === 'RESOLVED' || n.attention === 'DISMISSED';
  /** Applies one action, or says why it does not apply. */
  const apply = (n: AdminNotification, action: 'READ' | 'UNREAD' | 'RESOLVE' | 'DISMISS') => {
    const now = new Date().toISOString();
    if (action === 'READ') n.readAt ??= now;
    else if (action === 'UNREAD') n.readAt = null;
    else if (closed(n)) throw fail(409, 'ALREADY_CLOSED', 'Already resolved or dismissed');
    else if (action === 'RESOLVE') {
      if (!n.requiresAction) throw fail(409, 'NOT_ACTIONABLE', 'Asks for no work');
      Object.assign(n, { attention: 'RESOLVED', resolvedAt: now, resolvedBy: ME });
    } else Object.assign(n, { attention: 'DISMISSED', dismissedAt: now });
    return { ...n };
  };
  const matches = (
    n: AdminNotification,
    q: Omit<ListAdminNotificationsQuery, 'page' | 'pageSize'>,
  ) => {
    const term = q.search?.toLowerCase();
    return (
      (!q.category || n.category === q.category) &&
      (!q.status || statusIs(n, q.status)) &&
      (!q.priority || n.priority === q.priority) &&
      (!q.from || n.occurredAt >= q.from) &&
      (!q.to || n.occurredAt < q.to) &&
      (!term || `${n.title} ${n.body ?? ''} ${n.source.label ?? ''}`.toLowerCase().includes(term))
    );
  };
  const newest = () => [...all()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListAdminNotificationsQuery, query);
      const hits = newest().filter((n) => matches(n, q));
      const start = (q.page - 1) * q.pageSize;
      return {
        items: hits.slice(start, start + q.pageSize).map((n) => ({ ...n })),
        total: hits.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async () => {
      await mockDelay();
      const today = easternDay(new Date().toISOString());
      const list = all();
      return {
        total: list.length,
        unread: list.filter((n) => n.readAt === null).length,
        actionRequired: list.filter((n) => n.attention === 'ACTION_REQUIRED').length,
        critical: list.filter((n) => n.priority === 'CRITICAL' && !closed(n)).length,
        resolvedToday: list.filter((n) => n.resolvedAt && easternDay(n.resolvedAt) === today)
          .length,
      };
    },
    unreadCount: async () => {
      await mockDelay();
      return { count: all().filter((n) => n.readAt === null).length };
    },
    recent: async (query = {}) => {
      await mockDelay();
      const { limit } = parseInput(RecentAdminNotificationsQuery, query);
      return {
        items: newest()
          .slice(0, limit)
          .map((n) => ({ ...n })),
        unread: all().filter((n) => n.readAt === null).length,
      };
    },
    get: async (id) => (await mockDelay(), { ...find(id) }),
    read: async (id) => (await mockDelay(), apply(find(id), 'READ')),
    unread: async (id) => (await mockDelay(), apply(find(id), 'UNREAD')),
    resolve: async (id) => (await mockDelay(), apply(find(id), 'RESOLVE')),
    dismiss: async (id) => (await mockDelay(), apply(find(id), 'DISMISS')),
    bulk: async (body) => {
      await mockDelay();
      const { ids, action } = parseInput(BulkAdminNotificationsRequest, body);
      let updated = 0;
      const skipped: string[] = [];
      for (const id of new Set(ids)) {
        try {
          apply(find(id), action);
          updated += 1;
        } catch {
          skipped.push(id);
        }
      }
      return { updated, skipped };
    },
    markAllRead: async (body = {}) => {
      await mockDelay();
      const q = parseInput(MarkAllAdminNotificationsReadRequest, body);
      const hits = all().filter((n) => n.readAt === null && matches(n, q));
      for (const n of hits) apply(n, 'READ');
      return { updated: hits.length };
    },
  };
}
