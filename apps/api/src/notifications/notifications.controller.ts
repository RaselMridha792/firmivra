import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ListNotificationsQuery,
  type MarkAllNotificationsReadResponse,
  NotificationId,
  type NotificationItem,
  type NotificationList,
  type NotificationPreferences,
  type UnreadNotificationCount,
  UpdateNotificationPreferencesRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Notifier } from './notifier.js';
import { type Me, NotificationsService } from './notifications.service.js';

const idPipe = new ZodValidationPipe(NotificationId.transform((v) => v.toLowerCase()));
const listPipe = new ZodValidationPipe(ListNotificationsQuery);
/** POST bodies are `{}` (docs/api/notifications.yaml, Empty). */
const emptyPipe = new ZodValidationPipe(z.strictObject({}));
const updatePipe = new ZodValidationPipe(UpdateNotificationPreferencesRequest);

/** The signed-in person, from AuthGuard and TenantGuard: never from the URL or the body. */
function meOf(auth: AuthContext | undefined, tenant: TenantContext | undefined): Me {
  if (!auth || !tenant) throw new Error('notification routes need a signed-in person in a firm');
  return tenant.kind === 'client'
    ? {
        businessId: tenant.businessId,
        userId: auth.userId,
        side: 'client',
        clientAccountId: tenant.clientAccountId,
      }
    : { businessId: tenant.businessId, userId: auth.userId, side: 'staff' };
}

/**
 * The same six routes on both sites (R6 step 7, docs/api/notifications.yaml). Guards run first
 * (cross-site 415 and 403, 401, the tenant guard's 400, 404 and 403), then the pipes' 400, then
 * the service's 404 for an item that is not the caller's own.
 */
abstract class NotificationRoutes {
  constructor(protected readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Query(listPipe) query: z.output<typeof ListNotificationsQuery>,
  ): Promise<NotificationList> {
    return this.notifications.list(meOf(auth, tenant), query);
  }

  @Get('notifications/unread-count')
  unreadCount(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
  ): Promise<UnreadNotificationCount> {
    return this.notifications.unreadCount(meOf(auth, tenant));
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  markAllRead(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(emptyPipe) _body: object,
  ): Promise<MarkAllNotificationsReadResponse> {
    return this.notifications.markAllRead(meOf(auth, tenant));
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  markRead(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Param('id', idPipe) id: string,
    @Body(emptyPipe) _body: object,
  ): Promise<NotificationItem> {
    return this.notifications.markRead(meOf(auth, tenant), id);
  }

  @Get('notification-preferences')
  preferences(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
  ): Promise<NotificationPreferences> {
    return this.notifications.getPreferences(meOf(auth, tenant));
  }

  @Patch('notification-preferences')
  updatePreferences(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(updatePipe) body: z.output<typeof UpdateNotificationPreferencesRequest>,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(meOf(auth, tenant), body);
  }
}

/** The firm site: the member's own, in the firm the request acts in (every role). */
@Controller('business/me')
@Roles(...FIRM_STAFF)
export class NotificationsController extends NotificationRoutes {
  constructor(notifications: NotificationsService) {
    super(notifications);
  }
}

/** The portal: the client login's own at this firm. */
@Controller('portal/:firmSlug/me')
@Roles('CLIENT')
export class MyNotificationsController extends NotificationRoutes {
  constructor(notifications: NotificationsService) {
    super(notifications);
  }
}

/**
 * The notification center's routes and `Notifier`, the helper other modules import to write a
 * bell item (and its email copy) for an event.
 */
@Module({
  controllers: [NotificationsController, MyNotificationsController],
  providers: [NotificationsService, Notifier],
  exports: [Notifier],
})
export class NotificationsModule {}
