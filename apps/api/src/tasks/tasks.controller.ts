import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  AddTaskAttachmentRequest,
  type BulkTaskResult,
  ChecklistItemId,
  type OkResponse,
  ReorderChecklistRequest,
  SetTaskProgressRequest,
  type TaskAttachment,
  TaskAttachmentId,
  type TaskCalendar,
  type TaskDetail,
  TaskId,
  type TaskList,
  type TaskOverviewPage,
  type TaskSummary,
  UpdateTaskAttachmentRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TasksService } from '../workspaces/tasks.service.js';
import { actorOf } from '../workspaces/common.js';
import { TasksQuery } from '../workspaces/input.js';
import {
  BulkTaskRequest,
  CreateTaskDetailRequest,
  TaskCalendarQuery,
  TaskOverviewQuery,
  UpdateTaskDetailRequest,
} from './task-input.js';
import { TaskBulkService } from './task-bulk.service.js';
import { TaskReadService } from './task-read.service.js';
import { TaskWriteService } from './task-write.service.js';

const OK: OkResponse = { ok: true };
const idPipe = new ZodValidationPipe(TaskId);
const itemPipe = new ZodValidationPipe(ChecklistItemId);
const attachmentPipe = new ZodValidationPipe(TaskAttachmentId);

/**
 * The firm's tasks (contract in packages/types/src/tasks): the older list, create and change
 * (client record Tasks tab), and the Tasks module's overview, summary, calendar, detail, actions,
 * checklist, attachments and bulk actions. Owner, Admin and Staff (Staff: only the tasks of
 * clients assigned to them), the permission grid for the other roles (`@Access('TASKS')`). Never
 * a portal route. The firm comes from TenantGuard.
 */
@Controller('business/tasks')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TasksController {
  constructor(
    private readonly legacy: TasksService,
    private readonly reader: TaskReadService,
    private readonly writer: TaskWriteService,
    private readonly bulk: TaskBulkService,
  ) {}

  // Static routes first: ':id' would take "summary" for an id.

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<TaskSummary> {
    return this.reader.summary(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('overview')
  overview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaskOverviewQuery)) q: z.output<typeof TaskOverviewQuery>,
  ): Promise<TaskOverviewPage> {
    return this.reader.overview(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('calendar')
  calendar(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaskCalendarQuery)) q: z.output<typeof TaskCalendarQuery>,
  ): Promise<TaskCalendar> {
    return this.reader.calendar(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Post('bulk')
  @HttpCode(200)
  bulkAction(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkTaskRequest)) body: z.output<typeof BulkTaskRequest>,
  ): Promise<BulkTaskResult> {
    return this.bulk.run(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TasksQuery)) query: z.output<typeof TasksQuery>,
  ): Promise<TaskList> {
    return this.legacy.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTaskDetailRequest))
    body: z.output<typeof CreateTaskDetailRequest>,
  ): Promise<TaskDetail> {
    return this.writer.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.reader.detail(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaskDetailRequest))
    body: z.output<typeof UpdateTaskDetailRequest>,
  ): Promise<TaskDetail> {
    return this.writer.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.complete(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.reopen(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.cancel(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/progress')
  @HttpCode(200)
  progress(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetTaskProgressRequest))
    body: z.output<typeof SetTaskProgressRequest>,
  ): Promise<TaskDetail> {
    return this.writer.setProgress(tenant.businessId, actorOf(auth, tenant), id, body.progress);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.duplicate(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.archive(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDetail> {
    return this.writer.restore(tenant.businessId, actorOf(auth, tenant), id);
  }

  // ----- Checklist -----

  @Put(':id/checklist/order')
  reorderChecklist(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ReorderChecklistRequest))
    body: z.output<typeof ReorderChecklistRequest>,
  ): Promise<TaskDetail> {
    return this.writer.reorderChecklist(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/checklist/:itemId/complete')
  @HttpCode(200)
  completeItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', itemPipe) itemId: string,
  ): Promise<TaskDetail> {
    return this.writer.completeItem(tenant.businessId, actorOf(auth, tenant), id, itemId);
  }

  @Post(':id/checklist/:itemId/reopen')
  @HttpCode(200)
  reopenItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', itemPipe) itemId: string,
  ): Promise<TaskDetail> {
    return this.writer.reopenItem(tenant.businessId, actorOf(auth, tenant), id, itemId);
  }

  // ----- Attachments -----

  @Post(':id/attachments')
  addAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddTaskAttachmentRequest))
    body: z.output<typeof AddTaskAttachmentRequest>,
  ): Promise<TaskAttachment> {
    return this.writer.addAttachment(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Patch(':id/attachments/:attachmentId')
  updateAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('attachmentId', attachmentPipe) attachmentId: string,
    @Body(new ZodValidationPipe(UpdateTaskAttachmentRequest))
    body: z.output<typeof UpdateTaskAttachmentRequest>,
  ): Promise<TaskAttachment> {
    return this.writer.updateAttachment(
      tenant.businessId,
      actorOf(auth, tenant),
      id,
      attachmentId,
      body,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  async removeAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('attachmentId', attachmentPipe) attachmentId: string,
  ): Promise<OkResponse> {
    await this.writer.removeAttachment(tenant.businessId, actorOf(auth, tenant), id, attachmentId);
    return OK;
  }
}
