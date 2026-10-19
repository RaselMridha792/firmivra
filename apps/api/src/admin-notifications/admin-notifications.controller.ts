import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminNotification,
  AdminNotificationId,
  type AdminNotificationSummary,
  type AdminNotificationUnreadCount,
  BulkAdminNotificationsRequest,
  type BulkAdminNotificationsResponse,
  ListAdminNotificationsQuery,
  type ListAdminNotificationsResponse,
  MarkAllAdminNotificationsReadRequest,
  type MarkAllAdminNotificationsReadResponse,
  type RecentAdminNotifications,
  RecentAdminNotificationsQuery,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminNotificationsService } from './admin-notifications.service.js';

const Id = new ZodValidationPipe(AdminNotificationId);

/**
 * The Super Admin's notification center and bell (contract: packages/types/src/admin-notifications).
 * Every route is the signed-in member's own items. Static routes come before `:id`.
 */
@Controller('admin/notifications')
@Roles('SUPER_ADMIN')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListAdminNotificationsQuery))
    query: z.output<typeof ListAdminNotificationsQuery>,
  ): Promise<ListAdminNotificationsResponse> {
    return this.notifications.list(query);
  }

  @Get('summary')
  summary(): Promise<AdminNotificationSummary> {
    return this.notifications.summary();
  }

  @Get('unread-count')
  unreadCount(): Promise<AdminNotificationUnreadCount> {
    return this.notifications.unreadCount();
  }

  @Get('recent')
  recent(
    @Query(new ZodValidationPipe(RecentAdminNotificationsQuery))
    query: z.output<typeof RecentAdminNotificationsQuery>,
  ): Promise<RecentAdminNotifications> {
    return this.notifications.recent(query);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(
    @Body(new ZodValidationPipe(BulkAdminNotificationsRequest))
    body: z.output<typeof BulkAdminNotificationsRequest>,
  ): Promise<BulkAdminNotificationsResponse> {
    return this.notifications.bulk(body);
  }

  @Post('mark-all-read')
  @HttpCode(200)
  markAllRead(
    @Body(new ZodValidationPipe(MarkAllAdminNotificationsReadRequest))
    body: z.output<typeof MarkAllAdminNotificationsReadRequest>,
  ): Promise<MarkAllAdminNotificationsReadResponse> {
    return this.notifications.markAllRead(body);
  }

  @Get(':id')
  get(@Param('id', Id) id: string): Promise<AdminNotification> {
    return this.notifications.get(id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', Id) id: string): Promise<AdminNotification> {
    return this.notifications.act(id, 'READ');
  }

  @Post(':id/unread')
  @HttpCode(200)
  unread(@Param('id', Id) id: string): Promise<AdminNotification> {
    return this.notifications.act(id, 'UNREAD');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@Param('id', Id) id: string): Promise<AdminNotification> {
    return this.notifications.act(id, 'RESOLVE');
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@Param('id', Id) id: string): Promise<AdminNotification> {
    return this.notifications.act(id, 'DISMISS');
  }
}

@Module({
  controllers: [AdminNotificationsController],
  providers: [AdminPrisma, AdminNotificationsService],
})
export class AdminNotificationsModule {}
