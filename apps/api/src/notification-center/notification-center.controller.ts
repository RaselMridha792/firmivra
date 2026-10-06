import { Body, Controller, Get, Post, Put, Param, Query, HttpCode, Module } from '@nestjs/common';
import { z } from 'zod';
import {
  ListFirmNotificationsQuery,
  SaveFirmNotificationPreferencesRequest,
  ListPortalNotificationsQuery,
  SavePortalNotificationPreferencesRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationCenterService } from './notification-center.service.js';
import {
  NotificationTargets,
  NotificationDelivery,
  PendingNotificationDelivery,
} from './notification.ports.js';
import { ScopedNotificationTargets } from './notification-targets.service.js';
@Controller('business')
@Roles('OWNER', 'ADMIN', 'STAFF')
export class FirmNotificationsController {
  constructor(private readonly center: NotificationCenterService) {}
  @Get('notifications') list(
    @Query(new ZodValidationPipe(ListFirmNotificationsQuery))
    query: z.output<typeof ListFirmNotificationsQuery>,
  ) {
    return this.center.list(query);
  }
  @Get('notifications/unread-count') count() {
    return this.center.count();
  }
  @Post('notifications/:id/read') @HttpCode(200) read(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.center.read(id);
  }
  @Get('notification-preferences') preferences() {
    return this.center.preferences();
  }
  @Put('notification-preferences') save(
    @Body(new ZodValidationPipe(SaveFirmNotificationPreferencesRequest))
    body: z.output<typeof SaveFirmNotificationPreferencesRequest>,
  ) {
    return this.center.savePreferences(body.preferences);
  }
}
@Controller('portal/:slug')
@Roles('CLIENT')
export class PortalNotificationsController {
  constructor(private readonly center: NotificationCenterService) {}
  @Get('notifications') list(
    @Query(new ZodValidationPipe(ListPortalNotificationsQuery))
    query: z.output<typeof ListPortalNotificationsQuery>,
  ) {
    return this.center.list(query);
  }
  @Get('notifications/unread-count') count() {
    return this.center.count();
  }
  @Post('notifications/:id/read') @HttpCode(200) read(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.center.read(id);
  }
  @Get('notification-preferences') preferences() {
    return this.center.preferences();
  }
  @Put('notification-preferences') save(
    @Body(new ZodValidationPipe(SavePortalNotificationPreferencesRequest))
    body: z.output<typeof SavePortalNotificationPreferencesRequest>,
  ) {
    return this.center.savePreferences(body.preferences);
  }
}
@Module({
  controllers: [FirmNotificationsController, PortalNotificationsController],
  providers: [
    NotificationCenterService,
    ScopedNotificationTargets,
    { provide: NotificationTargets, useExisting: ScopedNotificationTargets },
    { provide: NotificationDelivery, useClass: PendingNotificationDelivery },
  ],
  exports: [NotificationCenterService, NotificationDelivery],
})
export class NotificationCenterModule {}
