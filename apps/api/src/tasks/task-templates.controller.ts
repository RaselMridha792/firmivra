import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { type TaskTemplate, TaskTemplateId, type TaskTemplateList } from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import {
  CreateTaskTemplateRequest,
  TaskTemplatesQuery,
  UpdateTaskTemplateRequest,
} from './task-input.js';
import { TaskTemplatesService } from './task-templates.service.js';

const idPipe = new ZodValidationPipe(TaskTemplateId);

/**
 * Task templates (contract in packages/types/src/tasks). Everyone with the Tasks view reads (and
 * starts a task from one with `templateId`); Owner and Admin make, change, duplicate and archive.
 */
@Controller('business/task-templates')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TaskTemplatesController {
  constructor(private readonly templates: TaskTemplatesService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaskTemplatesQuery)) q: z.output<typeof TaskTemplatesQuery>,
  ): Promise<TaskTemplateList> {
    return { items: await this.templates.list(tenant.businessId, q) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTaskTemplateRequest))
    body: z.output<typeof CreateTaskTemplateRequest>,
  ): Promise<TaskTemplate> {
    return this.templates.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskTemplate> {
    return this.templates.get(tenant.businessId, id);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaskTemplateRequest))
    body: z.output<typeof UpdateTaskTemplateRequest>,
  ): Promise<TaskTemplate> {
    return this.templates.update(tenant.businessId, id, body);
  }

  @Post(':id/duplicate')
  @Roles(...FIRM_MANAGERS)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskTemplate> {
    return this.templates.duplicate(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskTemplate> {
    return this.templates.archive(tenant.businessId, id);
  }

  @Post(':id/restore')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  restore(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskTemplate> {
    return this.templates.restore(tenant.businessId, id);
  }
}
