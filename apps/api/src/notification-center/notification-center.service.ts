import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import { z } from 'zod';
import {
  FirmNotification,
  FirmPreference,
  FirmPreferenceResponse,
  ListFirmNotificationsResponse,
  CountFirmUnreadNotificationsResponse,
  type ListFirmNotificationsQuery,
} from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, firmContext, missing } from '../firm-common/context.js';
import { requireTables } from '../firm-common/schema.js';
import { currentActor, type FirmActor } from '../firm-common/actor.js';
import { NotificationTargets, NotificationDelivery } from './notification.ports.js';
export const InternalNotification = FirmNotification.pick({
  category: true,
  title: true,
  message: true,
  target: true,
}).extend({ recipientUserId: z.uuid(), eventKey: z.string().min(1).max(200) });
type Row = {
  id: string;
  category: FirmNotification['category'];
  title: string;
  message: string;
  targetEntityType: NonNullable<FirmNotification['target']>['entityType'] | null;
  targetEntityId: string | null;
  readAt: Date | null;
  createdAt: Date;
};
const columns = Prisma.sql`id,category,title,message,target_entity_type AS "targetEntityType",target_entity_id AS "targetEntityId",read_at AS "readAt",created_at AS "createdAt"`;
const categories = FirmNotification.shape.category.options;
@Injectable()
export class NotificationCenterService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly targets: NotificationTargets,
    private readonly delivery: NotificationDelivery,
  ) {}
  private async scoped<T>(tables: string[], fn: (tx: TxClient, ctx: FirmActor) => Promise<T>) {
    const ctx = firmContext();
    return this.db.withScope({ kind: 'business', businessId: ctx.businessId }, async (tx) => {
      await currentActor(tx, ctx);
      await requireTables(tx, tables);
      return fn(tx, ctx);
    });
  }
  private async dto(row: Row, ctx: FirmActor) {
    const candidate =
      row.targetEntityType && row.targetEntityId
        ? { entityType: row.targetEntityType, entityId: row.targetEntityId }
        : null;
    const target = candidate && (await this.targets.visible(ctx, candidate)) ? candidate : null;
    return FirmNotification.parse({
      id: row.id,
      category: row.category,
      title: row.title,
      message: row.message,
      target,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  async list(query: ListFirmNotificationsQuery) {
    const ctx = firmContext(),
      filters = {
        module: 'notifications',
        category: query.category ?? null,
        read: query.read ?? null,
      },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.scoped(['notifications'], (tx) =>
      tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT ${columns} FROM notifications WHERE business_id=${ctx.businessId}::uuid AND recipient_user_id=${ctx.userId}::uuid AND in_app=true
      ${query.category ? Prisma.sql`AND category=${query.category}` : Prisma.empty}
      ${query.read === undefined ? Prisma.empty : query.read ? Prisma.sql`AND read_at IS NOT NULL` : Prisma.sql`AND read_at IS NULL`}
      ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}
      ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`),
    );
    const items = rows.slice(0, query.limit);
    await this.audit.log('notification.listed', { type: 'notification' });
    return ListFirmNotificationsResponse.parse({
      items: await Promise.all(items.map((row) => this.dto(row, ctx))),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
  async count() {
    const [row] = await this.scoped(
      ['notifications'],
      (tx, ctx) =>
        tx.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM notifications WHERE business_id=${ctx.businessId}::uuid AND recipient_user_id=${ctx.userId}::uuid AND in_app=true AND read_at IS NULL`,
    );
    await this.audit.log('notification.counted', { type: 'notification' });
    return CountFirmUnreadNotificationsResponse.parse(row);
  }
  async read(id: string) {
    const ctx = firmContext();
    const [row] = await this.scoped(['notifications'], (tx) =>
      tx.$queryRaw<Row[]>(
        Prisma.sql`UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE business_id=${ctx.businessId}::uuid AND recipient_user_id=${ctx.userId}::uuid AND in_app=true AND id=${id}::uuid RETURNING ${columns}`,
      ),
    );
    if (!row) throw missing();
    await this.audit.log('notification.read', { type: 'notification', id });
    return this.dto(row, ctx);
  }
  private async storedPreferences(tx: TxClient, businessId: string, userId: string) {
    return tx.$queryRaw<
      FirmPreference[]
    >`SELECT category,in_app AS "inApp",email,sms FROM notification_preferences WHERE business_id=${businessId}::uuid AND user_id=${userId}::uuid`;
  }
  private effective(
    stored: FirmPreference[],
    policy: Pick<FirmPreferenceResponse, 'supportedChannels' | 'mandatoryCategories'>,
  ) {
    return categories.map((category) => {
      const row = stored.find((item) => item.category === category) ?? {
        category,
        inApp: true,
        email: false,
        sms: false,
      };
      return {
        category,
        inApp:
          policy.supportedChannels.includes('IN_APP') &&
          (row.inApp || policy.mandatoryCategories.includes(category)),
        email: policy.supportedChannels.includes('EMAIL') && row.email,
        sms: policy.supportedChannels.includes('SMS') && row.sms,
      };
    });
  }
  async preferences() {
    const ctx = firmContext(),
      policy = await this.delivery.policy(ctx.businessId);
    const preferences = await this.scoped(['notification_preferences'], async (tx) =>
      this.effective(await this.storedPreferences(tx, ctx.businessId, ctx.userId), policy),
    );
    await this.audit.log('notification.preferences_viewed', { type: 'notificationPreference' });
    return FirmPreferenceResponse.parse({ ...policy, preferences });
  }
  async savePreferences(preferences: FirmPreference[]) {
    const ctx = firmContext(),
      policy = await this.delivery.policy(ctx.businessId);
    if (new Set(preferences.map((row) => row.category)).size !== preferences.length)
      throw new BadRequestException({
        code: 'DUPLICATE_CATEGORY',
        message: 'Categories must be unique',
      });
    for (const row of preferences) {
      if (
        (row.inApp && !policy.supportedChannels.includes('IN_APP')) ||
        (row.email && !policy.supportedChannels.includes('EMAIL')) ||
        (row.sms && !policy.supportedChannels.includes('SMS'))
      )
        throw new BadRequestException({
          code: 'UNSUPPORTED_CHANNEL',
          message: 'Channel is not available',
        });
      if (policy.mandatoryCategories.includes(row.category) && !row.inApp)
        throw new BadRequestException({
          code: 'MANDATORY_NOTIFICATION',
          message: 'Mandatory notices cannot be disabled',
        });
    }
    const stored = await this.scoped(['notification_preferences'], async (tx) => {
      // Per-recipient advisory lock serializes partial preference replacement.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.businessId + ':' + ctx.userId},0))`;
      for (const row of preferences)
        await tx.$executeRaw`INSERT INTO notification_preferences (business_id,user_id,category,in_app,email,sms) VALUES (${ctx.businessId}::uuid,${ctx.userId}::uuid,${row.category},${row.inApp},${row.email},${row.sms}) ON CONFLICT (business_id,user_id,category) DO UPDATE SET in_app=EXCLUDED.in_app,email=EXCLUDED.email,sms=EXCLUDED.sms`;
      return this.storedPreferences(tx, ctx.businessId, ctx.userId);
    });
    await this.audit.log(
      'notification.preferences_updated',
      { type: 'notificationPreference' },
      { categories: preferences.map((row) => row.category) },
    );
    return FirmPreferenceResponse.parse({ ...policy, preferences: this.effective(stored, policy) });
  }
  /** Internal only; caller must establish verified request context. No recipient-selecting HTTP route. */
  async create(input: z.input<typeof InternalNotification>) {
    const body = InternalNotification.parse(input),
      ctx = firmContext(),
      policy = await this.delivery.policy(ctx.businessId);
    const result = await this.scoped(['notifications', 'notification_preferences'], async (tx) => {
      const member = await tx.membership.findFirst({
        where: { businessId: ctx.businessId, userId: body.recipientUserId, status: 'ACTIVE' },
        select: { id: true },
      });
      const account = member
        ? null
        : await tx.clientAccount.findFirst({
            where: { businessId: ctx.businessId, userId: body.recipientUserId, status: 'ACTIVE' },
            select: { id: true },
          });
      if (!member && !account) throw missing();
      const preference = this.effective(
        await this.storedPreferences(tx, ctx.businessId, body.recipientUserId),
        policy,
      ).find((row) => row.category === body.category)!;
      const existing = await tx.$queryRaw<Row[]>(
        Prisma.sql`SELECT ${columns} FROM notifications WHERE business_id=${ctx.businessId}::uuid AND recipient_user_id=${body.recipientUserId}::uuid AND event_key=${body.eventKey}`,
      );
      if (!preference.inApp && !preference.email && !preference.sms && !existing[0]) return null;
      const [row] = existing[0]
        ? existing
        : await tx.$queryRaw<Row[]>(
            Prisma.sql`INSERT INTO notifications (id,business_id,recipient_user_id,category,title,message,target_entity_type,target_entity_id,event_key,in_app) VALUES (${randomUUID()}::uuid,${ctx.businessId}::uuid,${body.recipientUserId}::uuid,${body.category},${body.title},${body.message},${body.target?.entityType ?? null},${body.target?.entityId ?? null}::uuid,${body.eventKey},${preference.inApp}) ON CONFLICT (business_id,recipient_user_id,event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING ${columns}`,
          );
      if (!row) throw missing();
      return {
        row,
        channels: [
          ...(preference.email ? ['EMAIL' as const] : []),
          ...(preference.sms ? ['SMS' as const] : []),
        ],
      };
    });
    if (!result) return null;
    await this.audit.log(
      'notification.created',
      { type: 'notification', id: result.row.id },
      { category: body.category },
    );
    if (result.channels.length)
      await this.delivery.enqueue({
        businessId: ctx.businessId,
        recipientUserId: body.recipientUserId,
        category: body.category,
        eventKey: `notification:${result.row.id}`,
        channels: result.channels,
        template: 'notification-available',
      });
    return result.row.id;
  }
}
