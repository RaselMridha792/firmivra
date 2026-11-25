import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateTaskCommentRequest,
  type OkResponse,
  type PendingTaskAcknowledgements,
  type TaskAcknowledgements,
  type TaskComment,
  TaskCommentId,
  type TaskComments,
  TaskId,
  UpdateTaskCommentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import { TaskCollabService } from './task-collab.service.js';

const idPipe = new ZodValidationPipe(TaskId);
const commentPipe = new ZodValidationPipe(TaskCommentId);

/**
 * Tasks Review Two T-C01 and T-C02 (Q36; contract packages/types/src/tasks/collab.ts): the
 * assignment acknowledgment and the task's internal discussion. The same people as the task
 * itself (Staff: the tasks of clients assigned to them); never a portal route.
 */
@Controller('business/tasks')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TaskCollabController {
  constructor(private readonly collab: TaskCollabService) {}

  @Get('acknowledgements/pending')
  pending(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<PendingTaskAcknowledgements> {
    return this.collab.pending(tenant.businessId, actorOf(auth, tenant));
  }

  @Get(':id/acknowledgements')
  acknowledgements(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskAcknowledgements> {
    return this.collab.acknowledgements(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskAcknowledgements> {
    return this.collab.acknowledge(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get(':id/comments')
  comments(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskComments> {
    return this.collab.comments(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/comments')
  comment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateTaskCommentRequest))
    body: z.output<typeof CreateTaskCommentRequest>,
  ): Promise<TaskComment> {
    return this.collab.comment(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Patch(':id/comments/:commentId')
  editComment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('commentId', commentPipe) commentId: string,
    @Body(new ZodValidationPipe(UpdateTaskCommentRequest))
    body: z.output<typeof UpdateTaskCommentRequest>,
  ): Promise<TaskComment> {
    return this.collab.editComment(tenant.businessId, actorOf(auth, tenant), id, commentId, body);
  }

  @Delete(':id/comments/:commentId')
  async deleteComment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('commentId', commentPipe) commentId: string,
  ): Promise<OkResponse> {
    await this.collab.deleteComment(tenant.businessId, actorOf(auth, tenant), id, commentId);
    return { ok: true };
  }
}
