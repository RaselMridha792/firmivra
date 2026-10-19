import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import type {
  AdminNotification,
  AdminNotificationErrorCode,
  AdminNotificationSummary,
  BulkAdminNotificationsRequest,
  BulkAdminNotificationsResponse,
  ListAdminNotificationsQuery,
  ListAdminNotificationsResponse,
  MarkAllAdminNotificationsReadRequest,
  RecentAdminNotifications,
  RecentAdminNotificationsQuery,
} from '@firmivra/types';
import { ADMIN_NOTIFICATION_ERRORS } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  actionPatch,
  AUDITED_CATEGORIES,
  filtersWhere,
  PLATFORM_TIME_ZONE,
  startOfDayIn,
} from './admin-notifications.rules.js';

type Action = 'READ' | 'UNREAD' | 'RESOLVE' | 'DISMISS';
type Row = Prisma.PlatformNotificationGetPayload<{
  include: { business: { select: { id: true; name: true } } };
}>;
const include = { business: { select: { id: true, name: true } } } as const;
const newestFirst = [{ occurredAt: 'desc' as const }, { id: 'desc' as const }];

const failure = (code: AdminNotificationErrorCode) =>
  code === 'NOT_FOUND'
    ? new NotFoundException({ code, message: ADMIN_NOTIFICATION_ERRORS[code] })
    : new ConflictException({ code, message: ADMIN_NOTIFICATION_ERRORS[code] });

/**
 * The signed-in Super Admin's notification center (R0 stage B1, `platform_notifications`). Admin
 * scope only: the database shows a member only their own items, and only the read state and the
 * attention ever change. Producers (platform scope) are other modules' work, not this service's.
 */
@Injectable()
export class AdminNotificationsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(
    q: z.output<typeof ListAdminNotificationsQuery>,
  ): Promise<ListAdminNotificationsResponse> {
    const where = filtersWhere(this.admin.adminUserId, q);
    const db = this.admin.db;
    const [rows, total] = await Promise.all([
      db.platformNotification.findMany({
        where,
        include,
        orderBy: newestFirst,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.platformNotification.count({ where }),
    ]);
    return { items: await this.shape(rows), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(now = new Date()): Promise<AdminNotificationSummary> {
    const mine = { recipientUserId: this.admin.adminUserId };
    const count = (where: Prisma.PlatformNotificationWhereInput) =>
      this.admin.db.platformNotification.count({ where: { ...mine, ...where } });
    const [total, unread, actionRequired, critical, resolvedToday] = await Promise.all([
      count({}),
      count({ readAt: null }),
      count({ attention: 'ACTION_REQUIRED' }),
      count({ priority: 'CRITICAL', attention: { in: ['NONE', 'ACTION_REQUIRED'] } }),
      count({ resolvedAt: { gte: startOfDayIn(PLATFORM_TIME_ZONE, now) } }),
    ]);
    return { total, unread, actionRequired, critical, resolvedToday };
  }

  async unreadCount(): Promise<{ count: number }> {
    const count = await this.admin.db.platformNotification.count({
      where: { recipientUserId: this.admin.adminUserId, readAt: null },
    });
    return { count };
  }

  async recent(
    q: z.output<typeof RecentAdminNotificationsQuery>,
  ): Promise<RecentAdminNotifications> {
    const recipientUserId = this.admin.adminUserId;
    const db = this.admin.db;
    const [rows, unread] = await Promise.all([
      db.platformNotification.findMany({
        where: { recipientUserId },
        include,
        orderBy: newestFirst,
        take: q.limit,
      }),
      db.platformNotification.count({ where: { recipientUserId, readAt: null } }),
    ]);
    return { items: await this.shape(rows), unread };
  }

  async get(id: string): Promise<AdminNotification> {
    const row = await this.admin.db.platformNotification.findFirst({
      where: { id, recipientUserId: this.admin.adminUserId },
      include,
    });
    if (!row) throw failure('NOT_FOUND');
    const [item] = await this.shape([row]);
    return item as AdminNotification;
  }

  /** One action on one item; resolving or dismissing a security or billing item is audited. */
  async act(id: string, action: Action): Promise<AdminNotification> {
    await this.admin.transaction(async (tx) => {
      const outcome = await this.apply(tx, id, action);
      if (outcome !== 'done') throw failure(outcome);
    });
    return this.get(id);
  }

  /** Up to 100 items in one transaction; items the action does not apply to are skipped. */
  async bulk(
    body: z.output<typeof BulkAdminNotificationsRequest>,
  ): Promise<BulkAdminNotificationsResponse> {
    return this.admin.transaction(async (tx) => {
      let updated = 0;
      const skipped: string[] = [];
      for (const id of new Set(body.ids)) {
        if ((await this.apply(tx, id, body.action)) === 'done') updated += 1;
        else skipped.push(id);
      }
      return { updated, skipped };
    });
  }

  async markAllRead(
    body: z.output<typeof MarkAllAdminNotificationsReadRequest>,
  ): Promise<{ updated: number }> {
    const where = filtersWhere(this.admin.adminUserId, body);
    const { count } = await this.admin.db.platformNotification.updateMany({
      where: { AND: [where, { readAt: null }] },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /** Checks and writes one action inside the caller's transaction; never throws for the rules. */
  private async apply(
    tx: TxClient,
    id: string,
    action: Action,
  ): Promise<'done' | AdminNotificationErrorCode> {
    const adminUserId = this.admin.adminUserId;
    const row = await tx.platformNotification.findFirst({
      where: { id, recipientUserId: adminUserId },
      select: {
        readAt: true,
        requiresAction: true,
        attention: true,
        category: true,
        sourceType: true,
        sourceId: true,
      },
    });
    if (!row) return 'NOT_FOUND';
    const patch = actionPatch(row, action, adminUserId);
    if ('error' in patch) return patch.error;
    if (patch.data) await tx.platformNotification.update({ where: { id }, data: patch.data });
    if ((action === 'RESOLVE' || action === 'DISMISS') && AUDITED_CATEGORIES.has(row.category)) {
      await this.audit.logIn(
        tx,
        action === 'RESOLVE' ? 'platform_notification.resolved' : 'platform_notification.dismissed',
        { type: 'platform_notification', id },
        { category: row.category, sourceType: row.sourceType, sourceId: row.sourceId },
      );
    }
    return 'done';
  }

  /** Rows to the contract's shape, with the names of whoever resolved them. */
  private async shape(rows: Row[]): Promise<AdminNotification[]> {
    const ids = [...new Set(rows.flatMap((r) => (r.resolvedByUserId ? [r.resolvedByUserId] : [])))];
    const names = new Map(
      ids.length
        ? (
            await this.admin.db.user.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name])
        : [],
    );
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      type: r.type,
      priority: r.priority,
      title: r.title,
      body: r.body,
      source: { type: r.sourceType, id: r.sourceId, label: r.sourceLabel },
      business: r.business ? { id: r.business.id, name: r.business.name } : null,
      requiresAction: r.requiresAction,
      attention: r.attention,
      readAt: r.readAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedByUserId
        ? { userId: r.resolvedByUserId, name: names.get(r.resolvedByUserId) ?? 'Firmivra team' }
        : null,
      dismissedAt: r.dismissedAt?.toISOString() ?? null,
      occurredAt: r.occurredAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
