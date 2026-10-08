import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

/**
 * R12 step 6: tasks. The Bookkeeping and Tax Planning workspaces and their reports follow in the
 * next PR.
 */
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class WorkspacesModule {}
