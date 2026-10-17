import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type SeriesPreview,
  TaskOccurrenceId,
  type TaskOccurrence,
  type TaskOccurrencePage,
  type TaskSeriesDetail,
  TaskSeriesId,
  type TaskSeriesPage,
} from '@firmivra/types';
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
  CreateTaskSeriesRequest,
  SeriesPreviewRequest,
  SkipFutureRequest,
  SkipOccurrenceRequest,
  TaskOccurrencesQuery,
  TaskSeriesQuery,
  UpdateTaskSeriesRequest,
} from './task-input.js';
import { TaskSeriesService } from './task-series.service.js';

const idPipe = new ZodValidationPipe(TaskSeriesId);

/**
 * Recurring tasks (contract in packages/types/src/tasks). Everyone with the Tasks view reads (Staff:
 * the series of clients assigned to them, else 404); Owner and Admin make and change them.
 */
@Controller('business/task-series')
@Access('TASKS')
@Roles(...FIRM_STAFF)
export class TaskSeriesController {
  constructor(private readonly series: TaskSeriesService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaskSeriesQuery)) q: z.output<typeof TaskSeriesQuery>,
  ): Promise<TaskSeriesPage> {
    return this.series.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  // A calculation, not a change: it saves nothing. Before ':id', which would take "preview".
  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SeriesPreviewRequest)) body: z.output<typeof SeriesPreviewRequest>,
  ): Promise<SeriesPreview> {
    return this.series.preview(tenant.businessId, body);
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTaskSeriesRequest))
    body: z.output<typeof CreateTaskSeriesRequest>,
  ): Promise<TaskSeriesDetail> {
    return this.series.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskSeriesDetail> {
    return this.series.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaskSeriesRequest))
    body: z.output<typeof UpdateTaskSeriesRequest>,
  ): Promise<TaskSeriesDetail> {
    return this.series.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/pause')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskSeriesDetail> {
    return this.series.pause(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/resume')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskSeriesDetail> {
    return this.series.resume(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/stop')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  stop(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaskSeriesDetail> {
    return this.series.stop(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/skip-future')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  skipFuture(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SkipFutureRequest)) _body: z.output<typeof SkipFutureRequest>,
  ): Promise<TaskSeriesDetail> {
    return this.series.skipFuture(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get(':id/occurrences')
  occurrences(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(TaskOccurrencesQuery)) q: z.output<typeof TaskOccurrencesQuery>,
  ): Promise<TaskOccurrencePage> {
    return this.series.occurrences(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post(':id/occurrences/:occurrenceId/skip')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  skip(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('occurrenceId', new ZodValidationPipe(TaskOccurrenceId)) occurrenceId: string,
    @Body(new ZodValidationPipe(SkipOccurrenceRequest))
    body: z.output<typeof SkipOccurrenceRequest>,
  ): Promise<TaskOccurrence> {
    return this.series.skip(tenant.businessId, actorOf(auth, tenant), id, occurrenceId, body);
  }
}
