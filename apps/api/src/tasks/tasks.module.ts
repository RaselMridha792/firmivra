import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { TaskBulkService } from './task-bulk.service.js';
import { TaskReadService } from './task-read.service.js';
import { TaskTypesController } from './task-types.controller.js';
import { TaskTypesService } from './task-types.service.js';
import { TaskWriteService } from './task-write.service.js';
import { TasksController } from './tasks.controller.js';

/**
 * The Tasks module (R55; contract in packages/types/src/tasks): the overview, detail, create and
 * change with checklist, reminders, prerequisite and attachments, the row and bulk actions, and
 * task types. The older list still comes from WorkspacesModule's TasksService.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [TasksController, TaskTypesController],
  providers: [TaskReadService, TaskWriteService, TaskBulkService, TaskTypesService],
  exports: [TaskReadService, TaskWriteService],
})
export class TasksModule {}
