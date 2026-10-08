import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import {
  ListNotificationsQuery,
  MarkAllNotificationsReadResponse,
  NotificationId,
  NotificationItem,
  NotificationList,
  NotificationPreferences,
  UnreadNotificationCount,
  UpdateNotificationPreferencesRequest,
} from './schemas.js';

/**
 * The calls of both sites, under `base()` (the person's own routes). One shape for both, so the
 * bell (apps/web/src/components/notification-bell.tsx) takes either client. Bad input rejects
 * with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
function createCalls(request: ApiRequest, base: () => string) {
  const list = () => `${base()}/notifications`;
  const preferences = () => `${base()}/notification-preferences`;
  return {
    /** One page, newest first, with the unread count; pass `nextCursor` back as `cursor`. */
    list: async (query: ListNotificationsQuery = {}): Promise<NotificationList> =>
      request(NotificationList, `${list()}${toQuery(parseInput(ListNotificationsQuery, query))}`),
    /** The bell's badge. Cheap: poll it, at most once a minute and when the tab gets focus. */
    unreadCount: async (): Promise<number> =>
      (await request(UnreadNotificationCount, `${list()}/unread-count`)).count,
    /** Before opening its `notificationLink`. Repeating is harmless (the first readAt stays). */
    markRead: async (id: string): Promise<NotificationItem> =>
      request(NotificationItem, `${list()}/${parseInput(NotificationId, id)}/read`, {
        method: 'POST',
        body: {},
      }),
    /** "Mark all as read". */
    markAllRead: async (): Promise<MarkAllNotificationsReadResponse> =>
      request(MarkAllNotificationsReadResponse, `${list()}/read-all`, { method: 'POST', body: {} }),
    /** Every category's email and SMS choice, and the channels to show. */
    preferences: async (): Promise<NotificationPreferences> =>
      request(NotificationPreferences, preferences()),
    /** Changes only the categories and channels given; answers all of them. */
    updatePreferences: async (
      body: UpdateNotificationPreferencesRequest,
    ): Promise<NotificationPreferences> =>
      request(NotificationPreferences, preferences(), {
        method: 'PATCH',
        body: parseInput(UpdateNotificationPreferencesRequest, body),
      }),
  };
}

export type NotificationsClient = ReturnType<typeof createCalls>;
/** The same calls as `api.notifications`, for the portal. */
export type MyNotificationsClient = NotificationsClient;

/**
 * `api.notifications` (apps/web/src/lib/api.ts): the signed-in member's own notifications and
 * preferences, in the firm the request acts in (the firm site's bell, F07).
 */
export function createNotificationsClient(request: ApiRequest): NotificationsClient {
  return createCalls(request, () => '/business/me');
}

/**
 * `api.myNotifications(firmSlug)`: the signed-in client's own at one firm (the portal's bell, the
 * Notification Center (N10) and My Profile > Notification Preferences (N05)).
 */
export function createMyNotificationsClient(
  request: ApiRequest,
  firmSlug: string,
): MyNotificationsClient {
  return createCalls(request, () => portalMe(firmSlug));
}
