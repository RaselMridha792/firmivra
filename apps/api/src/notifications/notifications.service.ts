import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type DeliveryChannel,
  type MarkAllNotificationsReadResponse,
  NotificationCategory,
  type NotificationItem,
  type NotificationList,
  type NotificationPreferences,
  type NotificationTargetKind,
  NotificationTargetKind as TargetKind,
  type UpdateNotificationPreferencesRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { DEFAULT_CHOICE, isLockedCategory, PreferenceSource } from '../notify/preferences.js';
import { decodeTimeCursor, encodeTimeCursor } from '../workspaces/paging.js';
import { notificationText, type Side } from './notification-text.js';

/** Whose notifications: the signed-in person (AuthGuard) in the firm TenantGuard resolved. */
export interface Me {
  businessId: string;
  userId: string;
  side: Side;
  /** The client login (portal side): its verified phone offers SMS. */
  clientAccountId?: string;
}

type ListQuery = { unreadOnly: boolean; cursor?: string; limit: number };
type UpdateBody = z.output<typeof UpdateNotificationPreferencesRequest>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

const itemSelect = {
  id: true,
  category: true,
  type: true,
  entityType: true,
  entityId: true,
  payload: true,
  readAt: true,
  createdAt: true,
} as const;
type Row = {
  id: string;
  category: NotificationCategory;
  type: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

type ClientIds = (tx: TxClient, businessId: string, ids: string[]) => Promise<Map<string, string>>;
const byId = (rows: { id: string; clientId: string }[]) =>
  new Map(rows.map((r) => [r.id, r.clientId]));

/**
 * The client each record belongs to, for `target.clientId` on the firm site, read from the record
 * itself (never the payload). Kinds without a client page answer null.
 */
const CLIENT_OF: Partial<Record<NotificationTargetKind, ClientIds>> = {
  document: async (tx, businessId, ids) =>
    byId(
      await tx.document.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  document_request: async (tx, businessId, ids) =>
    byId(
      await tx.documentRequest.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  intake: async (tx, businessId, ids) => {
    const rows = await tx.intake.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, engagement: { select: { clientId: true } } },
    });
    return new Map(rows.flatMap((r) => (r.engagement ? [[r.id, r.engagement.clientId]] : [])));
  },
  engagement: async (tx, businessId, ids) =>
    byId(
      await tx.engagement.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  tax_return: async (tx, businessId, ids) =>
    byId(
      await tx.taxReturn.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  message_thread: async (tx, businessId, ids) =>
    byId(
      await tx.messageThread.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  appointment: async (tx, businessId, ids) =>
    byId(
      await tx.appointment.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
  invoice: async (tx, businessId, ids) =>
    byId(
      await tx.invoice.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, clientId: true },
      }),
    ),
};

/**
 * The bell, the Notification Center and the preferences of the signed-in person (R6 step 7;
 * docs/api/notifications.yaml). Every query filters by the firm (row-level security and the
 * `businessId` column) and by the person: another person's item is 404, also in the same firm.
 */
@Injectable()
export class NotificationsService {
  private readonly preferences: PreferenceSource;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
    private readonly audit: AuditService,
  ) {
    this.preferences = new PreferenceSource(database);
  }

  private inFirm<T>(me: Me, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: me.businessId }, fn);
  }

  private mine(me: Me) {
    return { businessId: me.businessId, recipientUserId: me.userId };
  }

  /** Newest first; the cursor is the last item's (createdAt, id), so marking read never shifts a page. */
  async list(me: Me, query: ListQuery): Promise<NotificationList> {
    const after = query.cursor === undefined ? null : decodeTimeCursor(query.cursor);
    return this.inFirm(me, async (tx) => {
      const rows = await tx.notification.findMany({
        where: {
          ...this.mine(me),
          ...(query.unreadOnly ? { readAt: null } : {}),
          ...(after
            ? {
                OR: [
                  { createdAt: { lt: after.at } },
                  { createdAt: after.at, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: itemSelect,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: await this.items(tx, me, page),
        nextCursor:
          rows.length > query.limit && last
            ? encodeTimeCursor({ at: last.createdAt, id: last.id })
            : null,
        unreadCount: await tx.notification.count({ where: { ...this.mine(me), readAt: null } }),
      };
    });
  }

  async unreadCount(me: Me): Promise<{ count: number }> {
    const count = await this.database
      .forBusiness(me.businessId)
      .notification.count({ where: { ...this.mine(me), readAt: null } });
    return { count };
  }

  /** Marks one read; a repeat keeps the first readAt. Not the caller's own: 404. */
  async markRead(me: Me, id: string): Promise<NotificationItem> {
    return this.inFirm(me, async (tx) => {
      await tx.notification.updateMany({
        where: { ...this.mine(me), id, readAt: null },
        data: { readAt: new Date() },
      });
      const row = await tx.notification.findFirst({
        where: { ...this.mine(me), id },
        select: itemSelect,
      });
      if (!row) throw notFound();
      const [item] = await this.items(tx, me, [row]);
      if (!item) throw notFound();
      return item;
    });
  }

  /** Every unread item that is not newer than this request. */
  async markAllRead(me: Me): Promise<MarkAllNotificationsReadResponse> {
    const now = new Date();
    const { count } = await this.database.forBusiness(me.businessId).notification.updateMany({
      where: { ...this.mine(me), readAt: null, createdAt: { lte: now } },
      data: { readAt: now },
    });
    return { marked: count };
  }

  async getPreferences(me: Me): Promise<NotificationPreferences> {
    return this.answer(me, await this.smsOffered(me));
  }

  /**
   * Upserts each category given (only the switches given change), in one transaction, and audits
   * the change: the categories and switches only (consent to texts). `sms: true` while SMS is not
   * offered is 400.
   */
  async updatePreferences(me: Me, body: UpdateBody): Promise<NotificationPreferences> {
    const sms = await this.smsOffered(me);
    if (!sms && body.items.some((i) => i.sms === true)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Text messages are not available for you yet',
        details: [{ path: 'items', message: 'SMS is not offered: add a verified phone number' }],
      });
    }
    await this.inFirm(me, async (tx) => {
      for (const item of body.items) {
        const set = {
          ...(item.email === undefined ? {} : { email: item.email }),
          ...(item.sms === undefined ? {} : { sms: item.sms }),
        };
        await tx.notificationPreference.upsert({
          where: {
            businessId_userId_category: {
              businessId: me.businessId,
              userId: me.userId,
              category: item.category,
            },
          },
          create: {
            businessId: me.businessId,
            userId: me.userId,
            category: item.category,
            ...DEFAULT_CHOICE,
            ...set,
          },
          update: set,
        });
      }
      await this.audit.logIn(
        tx,
        'notification_preferences.updated',
        { type: 'user', id: me.userId },
        { items: body.items.map((i) => ({ category: i.category, email: i.email, sms: i.sms })) },
        { businessId: me.businessId, actorUserId: me.userId },
      );
    });
    return this.answer(me, sms);
  }

  /**
   * SMS shows once texts can go out (a registered number, SMS_MODE=sns) and the person has a
   * verified phone number: a client login whose phone was verified at sign-up. Staff have no
   * verified number in Firmivra yet, so EMAIL only.
   */
  private async smsOffered(me: Me): Promise<boolean> {
    if (this.config.sms.mode !== 'sns' || me.side !== 'client' || !me.clientAccountId) {
      return false;
    }
    const account = await this.database.forBusiness(me.businessId).clientAccount.findFirst({
      where: { businessId: me.businessId, id: me.clientAccountId, userId: me.userId },
      select: { phoneVerifiedAt: true, user: { select: { phone: true } } },
    });
    return Boolean(account?.phoneVerifiedAt && account.user.phone);
  }

  private async answer(me: Me, sms: boolean): Promise<NotificationPreferences> {
    const saved = await this.preferences.choices(me.businessId, me.userId);
    const channels: DeliveryChannel[] = sms ? ['EMAIL', 'SMS'] : ['EMAIL'];
    return {
      channels,
      items: NotificationCategory.options.map((category) => {
        const locked = isLockedCategory(category);
        const choice = locked ? DEFAULT_CHOICE : (saved.get(category) ?? DEFAULT_CHOICE);
        return { category, email: choice.email, sms: sms && choice.sms, locked };
      }),
    };
  }

  /** Rows as items: text made per event and side; the firm site's clientId from the record. */
  private async items(tx: TxClient, me: Me, rows: Row[]): Promise<NotificationItem[]> {
    const clients = new Map<string, string>();
    if (me.side === 'staff') {
      const byKind = new Map<NotificationTargetKind, string[]>();
      for (const row of rows) {
        const kind = TargetKind.safeParse(row.entityType);
        if (kind.success) byKind.set(kind.data, [...(byKind.get(kind.data) ?? []), row.entityId]);
      }
      for (const [kind, ids] of byKind) {
        const found = await CLIENT_OF[kind]?.(tx, me.businessId, [...new Set(ids)]);
        for (const [id, clientId] of found ?? []) clients.set(`${kind}:${id}`, clientId);
      }
    }
    return rows.flatMap((row) => {
      const kind = TargetKind.safeParse(row.entityType);
      if (!kind.success) return [];
      return [
        {
          id: row.id,
          category: row.category,
          ...notificationText(row.type, row.category, row.payload, me.side),
          target: {
            kind: kind.data,
            id: row.entityId,
            clientId: clients.get(`${kind.data}:${row.entityId}`) ?? null,
          },
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });
  }
}
