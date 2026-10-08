import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { type Task, TaskId, type TaskList } from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from './common.js';
import { CreateTaskBody, TasksQuery, UpdateTaskBody } from './input.js';
import { TasksService } from './tasks.service.js';

/**
 * The firm's tasks (R12 step 6; contract in packages/types/src/tasks): Owner, Admin and Staff
 * (Staff: only the tasks of clients assigned to them). Never a portal route: clients never see
 * tasks. The firm comes from TenantGuard.
 */
@Controller('business/tasks')
@Roles(...FIRM_STAFF)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TasksQuery)) query: z.output<typeof TasksQuery>,
  ): Promise<TaskList> {
    return this.tasks.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTaskBody)) body: z.output<typeof CreateTaskBody>,
  ): Promise<Task> {
    return this.tasks.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(TaskId)) id: string,
    @Body(new ZodValidationPipe(UpdateTaskBody)) body: z.output<typeof UpdateTaskBody>,
  ): Promise<Task> {
    return this.tasks.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
