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
  type DownloadLink,
  type OkResponse,
  type RecentReportPage,
  type ReportCatalog,
  type ReportDataSourceList,
  type ReportLookupList,
  type ReportResult,
  ReportRunId,
  type ReportRunStatusView,
  type ReportScheduleDetail,
  ReportScheduleId,
  type ReportSchedulePage,
  type ReportSettingsView,
  type ReportsDashboard,
  type SavedReportDetail,
  SavedReportId,
  type SavedReportPage,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReportsExportService } from './reports-export.service.js';
import {
  CreateScheduleBody,
  DashboardQuery,
  DuplicateBody,
  ExportBody,
  LookupQuery,
  RecentQuery,
  RunBody,
  SaveBody,
  SavedQuery,
  SchedulesQuery,
  SettingsBody,
  UpdateSavedBody,
  UpdateScheduleBody,
} from './reports-input.js';
import { ReportsSavedService } from './reports-saved.service.js';
import { ReportsSchedulesService } from './reports-schedules.service.js';
import { ReportsService } from './reports.service.js';

const savedPipe = new ZodValidationPipe(SavedReportId);
const schedulePipe = new ZodValidationPipe(ReportScheduleId);
const runPipe = new ZodValidationPipe(ReportRunId);
type Out<S extends z.ZodType> = z.output<S>;

const who = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant };
};

/**
 * Reports (contract in packages/types/src/reports). Everyone with the Reports view runs reports
 * they may see; Staff see only the clients assigned to them, and money and team data are for
 * Owner, Admin and a role with Manage on Reports. Saving, scheduling and exporting are refused
 * (403) by the services for anyone without those capabilities. Never a portal route.
 */
@Controller('business/reports')
@Access('REPORTS')
@Roles(...FIRM_STAFF)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly saved: ReportsSavedService,
    private readonly schedules: ReportsSchedulesService,
    private readonly exports: ReportsExportService,
  ) {}

  // ----- Dashboard, catalog, builder data (static paths first) -----

  @Get()
  dashboard(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(DashboardQuery)) q: Out<typeof DashboardQuery>,
  ): Promise<ReportsDashboard> {
    const { userId } = who(auth, tenant);
    return this.reports.dashboard(tenant.businessId, tenant, userId, q);
  }

  @Get('catalog')
  catalog(@CurrentTenant() tenant: TenantContext): ReportCatalog {
    return this.reports.catalog(tenant);
  }

  @Get('sources')
  sources(@CurrentTenant() tenant: TenantContext): ReportDataSourceList {
    return { items: this.reports.sources(tenant) };
  }

  @Get('lookups')
  async lookups(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LookupQuery)) q: Out<typeof LookupQuery>,
  ): Promise<ReportLookupList> {
    const { userId } = who(auth, tenant);
    return { items: await this.reports.lookups(tenant.businessId, tenant, userId, q) };
  }

  @Post('run')
  @HttpCode(200)
  run(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(RunBody)) body: Out<typeof RunBody>,
  ): Promise<ReportResult> {
    const { userId } = who(auth, tenant);
    return this.reports.run(tenant.businessId, tenant, userId, body);
  }

  @Get('recent')
  recent(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(RecentQuery)) q: Out<typeof RecentQuery>,
  ): Promise<RecentReportPage> {
    const { userId } = who(auth, tenant);
    return this.reports.recent(tenant.businessId, tenant, userId, q);
  }

  @Get('settings')
  settings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<ReportSettingsView> {
    const { userId } = who(auth, tenant);
    return this.reports.settings(tenant.businessId, tenant, userId);
  }

  @Put('settings')
  saveSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SettingsBody)) body: Out<typeof SettingsBody>,
  ): Promise<ReportSettingsView> {
    const { userId } = who(auth, tenant);
    return this.reports.saveSettings(tenant.businessId, tenant, userId, body);
  }

  // ----- Saved reports -----

  @Get('saved')
  savedList(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SavedQuery)) q: Out<typeof SavedQuery>,
  ): Promise<SavedReportPage> {
    const { userId } = who(auth, tenant);
    return this.saved.list(tenant.businessId, tenant, userId, q);
  }

  @Post('saved')
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveBody)) body: Out<typeof SaveBody>,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.save(tenant.businessId, tenant, userId, body);
  }

  @Get('saved/:id')
  savedGet(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.get(tenant.businessId, tenant, userId, id);
  }

  @Patch('saved/:id')
  savedUpdate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
    @Body(new ZodValidationPipe(UpdateSavedBody)) body: Out<typeof UpdateSavedBody>,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.update(tenant.businessId, tenant, userId, id, body);
  }

  @Post('saved/:id/duplicate')
  savedDuplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
    @Body(new ZodValidationPipe(DuplicateBody)) body: Out<typeof DuplicateBody>,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.duplicate(tenant.businessId, tenant, userId, id, body);
  }

  @Post('saved/:id/archive')
  @HttpCode(200)
  savedArchive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.setArchived(tenant.businessId, tenant, userId, id, true);
  }

  @Post('saved/:id/restore')
  @HttpCode(200)
  savedRestore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.setArchived(tenant.businessId, tenant, userId, id, false);
  }

  @Put('saved/:id/favorite')
  favorite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.favorite(tenant.businessId, tenant, userId, id, true);
  }

  @Delete('saved/:id/favorite')
  unfavorite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', savedPipe) id: string,
  ): Promise<SavedReportDetail> {
    const { userId } = who(auth, tenant);
    return this.saved.favorite(tenant.businessId, tenant, userId, id, false);
  }

  // ----- Exports and runs -----

  @Post('exports')
  @HttpCode(200)
  exportReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ExportBody)) body: Out<typeof ExportBody>,
  ): Promise<ReportRunStatusView> {
    const { userId } = who(auth, tenant);
    return this.exports.create(tenant.businessId, tenant, userId, body);
  }

  @Get('runs/:id')
  runStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runPipe) id: string,
  ): Promise<ReportRunStatusView> {
    const { userId } = who(auth, tenant);
    return this.exports.status(tenant.businessId, tenant, userId, id);
  }

  @Get('runs/:id/download')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runPipe) id: string,
  ): Promise<DownloadLink> {
    const { userId } = who(auth, tenant);
    return this.exports.download(tenant.businessId, tenant, userId, id);
  }

  // ----- Schedules -----

  @Get('schedules')
  scheduleList(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SchedulesQuery)) q: Out<typeof SchedulesQuery>,
  ): Promise<ReportSchedulePage> {
    const { userId } = who(auth, tenant);
    return this.schedules.list(tenant.businessId, tenant, userId, q);
  }

  @Post('schedules')
  scheduleCreate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateScheduleBody)) body: Out<typeof CreateScheduleBody>,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.create(tenant.businessId, tenant, userId, body);
  }

  @Get('schedules/:id')
  scheduleGet(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.get(tenant.businessId, tenant, userId, id);
  }

  @Patch('schedules/:id')
  scheduleUpdate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
    @Body(new ZodValidationPipe(UpdateScheduleBody)) body: Out<typeof UpdateScheduleBody>,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.update(tenant.businessId, tenant, userId, id, body);
  }

  @Delete('schedules/:id')
  scheduleDelete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<OkResponse> {
    const { userId } = who(auth, tenant);
    return this.schedules.remove(tenant.businessId, tenant, userId, id);
  }

  @Post('schedules/:id/pause')
  @HttpCode(200)
  schedulePause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.setActive(tenant.businessId, tenant, userId, id, false);
  }

  @Post('schedules/:id/resume')
  @HttpCode(200)
  scheduleResume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.setActive(tenant.businessId, tenant, userId, id, true);
  }

  @Post('schedules/:id/duplicate')
  scheduleDuplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<ReportScheduleDetail> {
    const { userId } = who(auth, tenant);
    return this.schedules.duplicate(tenant.businessId, tenant, userId, id);
  }

  @Post('schedules/:id/run-now')
  @HttpCode(200)
  scheduleRunNow(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', schedulePipe) id: string,
  ): Promise<ReportRunStatusView> {
    const { userId } = who(auth, tenant);
    return this.schedules.runNow(tenant.businessId, tenant, userId, id);
  }
}
