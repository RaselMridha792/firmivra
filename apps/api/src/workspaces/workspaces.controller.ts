import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  EngagementId,
  type MyReportList,
  type OkResponse,
  type Report,
  ReportId,
  type ReportList,
  type Workspace,
  type WorkspaceList,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf, clientAccountOf } from './common.js';
import {
  CreateReportBody,
  MyReportsListQuery,
  ReportsListQuery,
  UpdateReportBody,
  WorkspacesQuery,
} from './input.js';
import { ReportsService } from './reports.service.js';
import { WorkspacesService } from './workspaces.service.js';

const engagementPipe = new ZodValidationPipe(EngagementId);
const reportPipe = new ZodValidationPipe(ReportId);

/**
 * Bookkeeping and Tax Planning workspaces and their reports (R12 step 6; contract in
 * packages/types/src/workspaces): Owner, Admin and Staff (Staff: their clients' only).
 */
@Controller('business/workspaces')
@Roles(...FIRM_STAFF)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(WorkspacesQuery)) query: z.output<typeof WorkspacesQuery>,
  ): Promise<WorkspaceList> {
    return this.workspaces.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Get(':engagementId')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('engagementId', engagementPipe) engagementId: string,
  ): Promise<Workspace> {
    return this.workspaces.get(tenant.businessId, actorOf(auth, tenant), engagementId);
  }

  @Get(':engagementId/reports')
  listReports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('engagementId', engagementPipe) engagementId: string,
    @Query(new ZodValidationPipe(ReportsListQuery)) query: z.output<typeof ReportsListQuery>,
  ): Promise<ReportList> {
    return this.reports.list(tenant.businessId, actorOf(auth, tenant), engagementId, query);
  }

  @Post(':engagementId/reports')
  createReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('engagementId', engagementPipe) engagementId: string,
    @Body(new ZodValidationPipe(CreateReportBody)) body: z.output<typeof CreateReportBody>,
  ): Promise<Report> {
    return this.reports.create(tenant.businessId, actorOf(auth, tenant), engagementId, body);
  }
}

/** One report: edit, publish, unpublish, delete (never-published drafts only). */
@Controller('business/reports')
@Roles(...FIRM_STAFF)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportPipe) id: string,
    @Body(new ZodValidationPipe(UpdateReportBody)) body: z.output<typeof UpdateReportBody>,
  ): Promise<Report> {
    return this.reports.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportPipe) id: string,
  ): Promise<Report> {
    return this.reports.publish(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportPipe) id: string,
  ): Promise<Report> {
    return this.reports.unpublish(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportPipe) id: string,
  ): Promise<OkResponse> {
    return this.reports.remove(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/**
 * The signed-in client's published reports of one of their services (portal My Services). The
 * client comes from the session, never the URL.
 */
@Controller('portal/:firmSlug/me/services/:engagementId/reports')
@Roles('CLIENT')
export class MyReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Param('engagementId', engagementPipe) engagementId: string,
    @Query(new ZodValidationPipe(MyReportsListQuery)) query: z.output<typeof MyReportsListQuery>,
  ): Promise<MyReportList> {
    return this.reports.mine(tenant.businessId, clientAccountOf(tenant), engagementId, query);
  }
}
