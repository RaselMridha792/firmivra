import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import { type TaskType, TaskTypeId, type TaskTypeList } from '@firmivra/types';
import { Access, CurrentTenant, FIRM_MANAGERS, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SaveTaskTypeRequest } from './task-input.js';
import { TaskReadService } from './task-read.service.js';
import { TaskTypesService } from './task-types.service.js';

const idPipe = new ZodValidationPipe(TaskTypeId);

/**
 * The firm's task types (contract in packages/types/src/tasks). Everyone with the Tasks view
 * reads; Owner and Admin add, rename, archive and restore. The firm comes from TenantGuard.
 */
@Controller('business/task-types')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TaskTypesController {
  constructor(
    private readonly reader: TaskReadService,
    private readonly types: TaskTypesService,
  ) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<TaskTypeList> {
    return { items: await this.reader.types(tenant.businessId) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveTaskTypeRequest)) body: z.output<typeof SaveTaskTypeRequest>,
  ): Promise<TaskType> {
    return this.types.create(tenant.businessId, body);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveTaskTypeRequest)) body: z.output<typeof SaveTaskTypeRequest>,
  ): Promise<TaskType> {
    return this.types.update(tenant.businessId, id, body);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskType> {
    return this.types.archive(tenant.businessId, id);
  }

  @Post(':id/restore')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  restore(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskType> {
    return this.types.restore(tenant.businessId, id);
  }
}
