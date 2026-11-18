import { Module } from '@nestjs/common';
import { PortalTabsModule } from '../client-portal/portal-tabs.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { TasksService } from './tasks.service.js';
import {
  MyReportsController,
  ReportsController,
  WorkspacesController,
} from './workspaces.controller.js';
import { ReportsService } from './reports.service.js';
import { WorkspacesService } from './workspaces.service.js';

/** R12 step 6: tasks, the Bookkeeping and Tax Planning workspaces, and their reports. */
@Module({
  // NotificationsModule: BK-CP2's notice when a Bookkeeping report is first published.
  imports: [PortalTabsModule, NotificationsModule],
  controllers: [WorkspacesController, ReportsController, MyReportsController],
  providers: [TasksService, WorkspacesService, ReportsService],
  exports: [TasksService],
})
export class WorkspacesModule {}
