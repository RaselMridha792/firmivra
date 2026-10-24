import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { TaskBulkService } from './task-bulk.service.js';
import { TaskDraftsController } from './task-drafts.controller.js';
import { TaskDraftsService } from './task-drafts.service.js';
import { TaskReadService } from './task-read.service.js';
import { TaskSeriesController } from './task-series.controller.js';
import { TaskSeriesJob } from './task-series.job.js';
import { TaskSeriesService } from './task-series.service.js';
import { TaskTemplatesController } from './task-templates.controller.js';
import { TaskTemplatesService } from './task-templates.service.js';
import { TaskTypesController } from './task-types.controller.js';
import { TaskTypesService } from './task-types.service.js';
import { TaskWriteService } from './task-write.service.js';
import { TasksController } from './tasks.controller.js';

/**
 * The Tasks module (R55; contract in packages/types/src/tasks): the overview, detail, create and
 * change with checklist, reminders, prerequisite and attachments, the row and bulk actions, task
 * types, and drafts (R1). The older list still comes from WorkspacesModule's TasksService.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [
    // First: its routes under business/tasks/drafts must match before TasksController's ':id'.
    TaskDraftsController,
    TasksController,
    TaskTypesController,
    TaskTemplatesController,
    TaskSeriesController,
  ],
  providers: [
    TaskReadService,
    TaskWriteService,
    TaskDraftsService,
    TaskBulkService,
    TaskTypesService,
    TaskTemplatesService,
    TaskSeriesService,
    TaskSeriesJob,
  ],
  exports: [TaskReadService, TaskWriteService, TaskSeriesJob],
})
export class TasksModule {}
