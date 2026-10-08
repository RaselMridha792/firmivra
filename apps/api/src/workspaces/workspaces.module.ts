import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
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
  controllers: [TasksController, WorkspacesController, ReportsController, MyReportsController],
  providers: [TasksService, WorkspacesService, ReportsService],
})
export class WorkspacesModule {}
