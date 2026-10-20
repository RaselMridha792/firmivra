import type { Prisma } from '@firmivra/db';
import type {
  AdminNotificationAction,
  AdminNotificationErrorCode,
  AdminNotificationStatus,
  ListAdminNotificationsQuery,
} from '@firmivra/types';
import type { z } from 'zod';

/** "Today" on the summary is the calendar day in US Eastern time, as on the other admin pages. */
export const PLATFORM_TIME_ZONE = 'America/New_York';

/** Midnight of `now`'s calendar day in `timeZone`, as an instant. */
export function startOfDayIn(timeZone: string, now = new Date()): Date {
  const part = (type: string, d: Date) =>
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone, [type]: 'numeric', hourCycle: 'h23' })
        .formatToParts(d)
        .find((p) => p.type === type)?.value,
    );
  const guess = new Date(Date.UTC(part('year', now), part('month', now) - 1, part('day', now)));
  // How far the zone's wall clock is from UTC at that moment (e.g. -4 h in New York in summer).
  const wall = Date.UTC(
    part('year', guess),
    part('month', guess) - 1,
    part('day', guess),
    part('hour', guess) % 24,
    part('minute', guess),
  );
  return new Date(guess.getTime() - (wall - guess.getTime()));
}

/** The page's five statuses as columns: the read state, or the attention. */
export function statusWhere(
  status: AdminNotificationStatus,
): Prisma.PlatformNotificationWhereInput {
  switch (status) {
    case 'UNREAD':
      return { readAt: null };
    case 'READ':
      return { readAt: { not: null } };
    default:
      return { attention: status };
  }
}

type Filters = Omit<z.output<typeof ListAdminNotificationsQuery>, 'page' | 'pageSize'>;

/** The member's own items matching the filters (row-level security says "own" too). */
export function filtersWhere(
  recipientUserId: string,
  q: Partial<Filters>,
): Prisma.PlatformNotificationWhereInput {
  const and: Prisma.PlatformNotificationWhereInput[] = [{ recipientUserId }];
  if (q.category) and.push({ category: q.category });
  if (q.status) and.push(statusWhere(q.status));
  if (q.priority) and.push({ priority: q.priority });
  if (q.from || q.to)
    and.push({
      occurredAt: {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lt: new Date(q.to) } : {}),
      },
    });
  if (q.search) {
    const contains = { contains: q.search, mode: 'insensitive' as const };
    and.push({ OR: [{ title: contains }, { body: contains }, { sourceLabel: contains }] });
  }
  return { AND: and };
}

/** The state an action looks at. */
export interface ItemState {
  readAt: Date | null;
  requiresAction: boolean;
  attention: 'NONE' | 'ACTION_REQUIRED' | 'RESOLVED' | 'DISMISSED';
}

/**
 * What one action writes, or why it does not apply. Read and unread work on any item; resolve
 * only on an open item that asks for work; dismiss on any open item. Resolved and dismissed are
 * final. The database stamps `resolved_at` and `dismissed_at` with the attention.
 */
export function actionPatch(
  item: ItemState,
  action: z.output<typeof AdminNotificationAction>,
  adminUserId: string,
  now = new Date(),
):
  | { data: Prisma.PlatformNotificationUncheckedUpdateInput | null }
  | { error: AdminNotificationErrorCode } {
  if (action === 'READ') return { data: item.readAt ? null : { readAt: now } };
  if (action === 'UNREAD') return { data: item.readAt ? { readAt: null } : null };
  if (item.attention === 'RESOLVED' || item.attention === 'DISMISSED')
    return { error: 'ALREADY_CLOSED' };
  if (action === 'RESOLVE') {
    if (!item.requiresAction) return { error: 'NOT_ACTIONABLE' };
    return { data: { attention: 'RESOLVED', resolvedByUserId: adminUserId } };
  }
  return { data: { attention: 'DISMISSED' } };
}

/** Resolving or dismissing these writes an audit row (B1); marking read does not. */
export const AUDITED_CATEGORIES: ReadonlySet<string> = new Set([
  'SECURITY',
  'BILLING_SUBSCRIPTIONS',
]);
