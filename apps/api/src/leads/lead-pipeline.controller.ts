import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateLeadRequest,
  LeadBulkRequest,
  type LeadBulkResult,
  LeadId,
  LeadMessageRequest,
  type LeadOptions,
  type LeadPipelinePage,
  LeadPipelineQuery,
  type LeadPipelineSummary,
  type LeadProfile,
  UpdateLeadRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadMessagesService } from './lead-messages.service.js';
import { LeadPipelineWriteService } from './lead-pipeline-write.service.js';
import { LeadPipelineService } from './lead-pipeline.service.js';
import type { PipelineActor } from './pipeline.shared.js';

const idPipe = new ZodValidationPipe(LeadId);

export function pipelineActor(auth: AuthContext, tenant: TenantContext): PipelineActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * The Leads page and Lead Profile (R57; contract in packages/types/src/leads/pipeline.ts). It is
 * listed before LeadsController in LeadsModule so `pipeline`, `options`, `bulk` and `messages` are
 * matched before that controller's `:id` routes.
 */
@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadPipelineController {
  constructor(
    private readonly reads: LeadPipelineService,
    private readonly writes: LeadPipelineWriteService,
    private readonly messages: LeadMessagesService,
  ) {}

  @Get('pipeline')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LeadPipelineQuery)) q: z.output<typeof LeadPipelineQuery>,
  ): Promise<LeadPipelinePage> {
    return this.reads.list(tenant.businessId, pipelineActor(auth, tenant), q);
  }

  @Get('pipeline/summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<LeadPipelineSummary> {
    return this.reads.summary(tenant.businessId, pipelineActor(auth, tenant));
  }

  @Get('options')
  options(@CurrentTenant() tenant: TenantContext): Promise<LeadOptions> {
    return this.reads.options(tenant.businessId);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateLeadRequest)) body: z.output<typeof CreateLeadRequest>,
  ): Promise<LeadProfile> {
    return this.writes.create(tenant.businessId, pipelineActor(auth, tenant), body);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(LeadBulkRequest)) body: z.output<typeof LeadBulkRequest>,
  ): Promise<LeadBulkResult> {
    return this.writes.bulk(tenant.businessId, pipelineActor(auth, tenant), body);
  }

  @Post('messages')
  @HttpCode(200)
  message(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(LeadMessageRequest)) body: z.output<typeof LeadMessageRequest>,
  ): Promise<LeadBulkResult> {
    return this.messages.send(tenant.businessId, pipelineActor(auth, tenant), body);
  }

  @Get(':id/profile')
  profile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadProfile> {
    return this.reads.profile(tenant.businessId, pipelineActor(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateLeadRequest)) body: z.output<typeof UpdateLeadRequest>,
  ): Promise<LeadProfile> {
    return this.writes.update(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }
}
