import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  DismissLeadDuplicateRequest,
  type LeadDuplicateList,
  MergeLeadsRequest,
  type OkResponse,
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
  type LeadReport,
  type LeadReportLeads,
  LeadReportLeadsQuery,
  LeadReportQuery,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadMergeService } from './lead-merge.service.js';
import { LeadMessagesService } from './lead-messages.service.js';
import { LeadReportsService } from './lead-reports.service.js';
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
    private readonly merges: LeadMergeService,
    private readonly reports: LeadReportsService,
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

  /** Leads R2 18: the funnel and aging (Reports > Leads). */
  @Get('reports/funnel')
  funnel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LeadReportQuery)) q: z.output<typeof LeadReportQuery>,
  ): Promise<LeadReport> {
    return this.reports.report(tenant.businessId, pipelineActor(auth, tenant), q);
  }

  /** The leads behind one of the report's numbers. */
  @Get('reports/funnel/leads')
  funnelLeads(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LeadReportLeadsQuery)) q: z.output<typeof LeadReportLeadsQuery>,
  ): Promise<LeadReportLeads> {
    return this.reports.leads(tenant.businessId, pipelineActor(auth, tenant), q);
  }

  @Get('options')
  options(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<LeadOptions> {
    return this.reads.options(tenant, auth.userId);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateLeadRequest)) body: z.output<typeof CreateLeadRequest>,
  ): Promise<LeadProfile> {
    return this.writes.create(tenant.businessId, pipelineActor(auth, tenant), body, tenant);
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(LeadBulkRequest)) body: z.output<typeof LeadBulkRequest>,
  ): Promise<LeadBulkResult> {
    return this.writes.bulk(tenant.businessId, pipelineActor(auth, tenant), body, tenant);
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

  /** R2 15: possible duplicates (static path, before ':id'). */
  @Get('duplicates')
  duplicates(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<LeadDuplicateList> {
    return this.merges
      .duplicates(tenant.businessId, pipelineActor(auth, tenant))
      .then((items) => ({ items }));
  }

  @Post('duplicates/dismiss')
  @HttpCode(200)
  dismissDuplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(DismissLeadDuplicateRequest))
    body: z.output<typeof DismissLeadDuplicateRequest>,
  ): Promise<OkResponse> {
    return this.merges.dismiss(tenant.businessId, pipelineActor(auth, tenant), body);
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(MergeLeadsRequest)) body: z.output<typeof MergeLeadsRequest>,
  ): Promise<LeadProfile> {
    return this.merges.merge(tenant.businessId, pipelineActor(auth, tenant), id, body);
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
    return this.writes.update(tenant.businessId, pipelineActor(auth, tenant), id, body, tenant);
  }
}
