import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type OkResponse,
  type TaskDetail,
  type TaskDraft,
  TaskDraftId,
  type TaskDraftPage,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import {
  PublishTaskDraftRequest,
  SaveTaskDraftRequest,
  TaskDraftQuery,
  UpdateTaskDraftRequest,
} from './task-input.js';
import { TaskDraftsService } from './task-drafts.service.js';

const OK: OkResponse = { ok: true };
const idPipe = new ZodValidationPipe(TaskDraftId);

/**
 * Task drafts (contract in packages/types/src/tasks/drafts.ts): Save as Draft, the Drafts tab,
 * reopen, edit, publish (Save Task on a draft) and discard. Owner, Admin and Staff, the
 * permission grid for the other roles (`@Access('TASKS')`: GET views, POST creates, PATCH edits,
 * DELETE deletes). A draft without a client is its creator's alone; one with a client follows
 * the tasks' reach (Staff: their assigned clients'). Registered before TasksController, whose
 * ':id' would take "drafts" for a task id. Never a portal route; the firm comes from TenantGuard.
 */
@Controller('business/tasks/drafts')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TaskDraftsController {
  constructor(private readonly drafts: TaskDraftsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaskDraftQuery)) q: z.output<typeof TaskDraftQuery>,
  ): Promise<TaskDraftPage> {
    return this.drafts.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskDraft> {
    return this.drafts.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post()
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveTaskDraftRequest)) body: z.output<typeof SaveTaskDraftRequest>,
  ): Promise<TaskDraft> {
    return this.drafts.save(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaskDraftRequest))
    body: z.output<typeof UpdateTaskDraftRequest>,
  ): Promise<TaskDraft> {
    return this.drafts.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(PublishTaskDraftRequest))
    body: z.output<typeof PublishTaskDraftRequest>,
  ): Promise<TaskDetail> {
    return this.drafts.publish(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Delete(':id')
  async discard(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    await this.drafts.discard(tenant.businessId, actorOf(auth, tenant), id);
    return OK;
  }
}
