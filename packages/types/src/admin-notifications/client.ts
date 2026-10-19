import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AdminNotification,
  AdminNotificationId,
  AdminNotificationSummary,
  AdminNotificationUnreadCount,
  BulkAdminNotificationsRequest,
  BulkAdminNotificationsResponse,
  ListAdminNotificationsQuery,
  ListAdminNotificationsResponse,
  MarkAllAdminNotificationsReadRequest,
  MarkAllAdminNotificationsReadResponse,
  RecentAdminNotifications,
  RecentAdminNotificationsQuery,
} from './schemas.js';

const BASE = '/admin/notifications';
const one = (id: string) => `${BASE}/${parseInput(AdminNotificationId, id)}`;

/**
 * `api.adminNotifications` (apps/web/src/lib/api.ts): the signed-in Super Admin's own
 * notifications (the Notifications page and the bell). 401 without the Super Admin site's session,
 * 403 for anyone who is not a Super Admin. Another member's item is 404 NOT_FOUND. Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. Screens show
 * this module's errors with `errorMessage(error, ADMIN_NOTIFICATION_ERRORS)`.
 */
export function createAdminNotificationsClient(request: ApiRequest) {
  const action = (id: string, verb: 'read' | 'unread' | 'resolve' | 'dismiss') =>
    request(AdminNotification, `${one(id)}/${verb}`, { method: 'POST', body: {} });
  return {
    /** One page, newest first. */
    list: async (
      query: ListAdminNotificationsQuery = {},
    ): Promise<ListAdminNotificationsResponse> =>
      request(
        ListAdminNotificationsResponse,
        `${BASE}${toQuery(parseInput(ListAdminNotificationsQuery, query))}`,
      ),
    /** The summary cards, without filters. */
    summary: async (): Promise<AdminNotificationSummary> =>
      request(AdminNotificationSummary, `${BASE}/summary`),
    /** The bell's badge. */
    unreadCount: async (): Promise<AdminNotificationUnreadCount> =>
      request(AdminNotificationUnreadCount, `${BASE}/unread-count`),
    /** The bell's drop-down. */
    recent: async (query: RecentAdminNotificationsQuery = {}): Promise<RecentAdminNotifications> =>
      request(
        RecentAdminNotifications,
        `${BASE}/recent${toQuery(parseInput(RecentAdminNotificationsQuery, query))}`,
      ),
    /** One item. Reading changes nothing: the screen calls `read` when the member opens it. */
    get: async (id: string): Promise<AdminNotification> => request(AdminNotification, one(id)),
    read: async (id: string): Promise<AdminNotification> => action(id, 'read'),
    unread: async (id: string): Promise<AdminNotification> => action(id, 'unread'),
    /** Items that ask for work only. 409 NOT_ACTIONABLE or ALREADY_CLOSED. */
    resolve: async (id: string): Promise<AdminNotification> => action(id, 'resolve'),
    /** Any item; never touches the source record. 409 ALREADY_CLOSED. */
    dismiss: async (id: string): Promise<AdminNotification> => action(id, 'dismiss'),
    /** One action on up to 100 items; the ones it does not apply to come back in `skipped`. */
    bulk: async (body: BulkAdminNotificationsRequest): Promise<BulkAdminNotificationsResponse> =>
      request(BulkAdminNotificationsResponse, `${BASE}/bulk`, {
        method: 'POST',
        body: parseInput(BulkAdminNotificationsRequest, body),
      }),
    /** Every unread item matching the filter (the page's current filter). */
    markAllRead: async (
      body: MarkAllAdminNotificationsReadRequest = {},
    ): Promise<MarkAllAdminNotificationsReadResponse> =>
      request(MarkAllAdminNotificationsReadResponse, `${BASE}/mark-all-read`, {
        method: 'POST',
        body: parseInput(MarkAllAdminNotificationsReadRequest, body),
      }),
  };
}

export type AdminNotificationsClient = ReturnType<typeof createAdminNotificationsClient>;
