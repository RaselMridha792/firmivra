import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  AddPayrollClientRequest,
  AddPayrollReportRequest,
  CompletePayrollRunRequest,
  CreatePayrollRunRequest,
  CreatePayrollWorkerRequest,
  LogPayrollActivityRequest,
  type PayrollActivity,
  type PayrollActivityList,
  PayrollAssignRequest,
  type PayrollChangeList,
  PayrollClientId,
  type PayrollClientPage,
  PayrollClientsQuery,
  type PayrollClientWorkspace,
  type PayrollFilingList,
  PayrollFilingsQuery,
  PayrollFrequencyRequest,
  PayrollIssueId,
  type PayrollIssue,
  type PayrollIssueList,
  PayrollIssuesQuery,
  type PayrollLineList,
  PayrollLinesQuery,
  PayrollListQuery,
  type PayrollOverview,
  PayrollOverviewQuery,
  PayrollPlanRequest,
  PayrollReasonRequest,
  PayrollRemoveServiceRequest,
  type PayrollReport,
  type PayrollReportList,
  PayrollReportsQuery,
  type PayrollRun,
  PayrollRunId,
  type PayrollRunPage,
  PayrollRunsQuery,
  type PayrollSettings,
  PayrollStatusRequest,
  type PayrollSyncQueued,
  type PayrollWorker,
  PayrollWorkerId,
  type PayrollWorkerList,
  PayrollWorkersQuery,
  type PayrollYearEnd,
  PayrollYearEndQuery,
  ReopenPayrollRunRequest,
  ResolvePayrollIssueRequest,
  SavePayrollLinesRequest,
  SavePayrollSettingsRequest,
  SavePayrollYearEndRequest,
  SubmitPayrollRunRequest,
  UpdatePayrollClientRequest,
  UpdatePayrollRunRequest,
  UpdatePayrollWorkerRequest,
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
import { PayrollClientsService } from './payroll-clients.service.js';
import { PayrollRecordsService } from './payroll-records.service.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollWorkersService } from './payroll-workers.service.js';

const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const clientId = pipe(PayrollClientId);
const runId = pipe(PayrollRunId);
const workerId = pipe(PayrollWorkerId);
const issueId = pipe(PayrollIssueId);

const csv = (text: string) =>
  new StreamableFile(Buffer.from(text, 'utf8'), { type: 'text/csv; charset=utf-8' });

/**
 * The firm's payroll tracking (contract in packages/types/src/payroll). Everyone with the
 * permission grid's PAYROLL view reads and prepares; Owner and Admin add clients, change plan,
 * frequency and assignment, pause, archive, approve, submit, complete, reopen and edit settings.
 * Staff reach only the payroll clients of clients assigned to them. The firm comes from
 * TenantGuard, never from the request. Fixed paths come before `:id` ones.
 */
@Controller('business/payroll')
@Access('PAYROLL')
@Roles(...FIRM_STAFF)
export class PayrollController {
  constructor(
    private readonly clients: PayrollClientsService,
    private readonly workers: PayrollWorkersService,
    private readonly runs: PayrollRunsService,
    private readonly records: PayrollRecordsService,
  ) {}

  // ---------- Overview, settings ----------

  @Get('overview')
  overview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(PayrollOverviewQuery)) q: z.output<typeof PayrollOverviewQuery>,
  ): Promise<PayrollOverview> {
    return this.clients.overview(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('settings')
  @Roles(...FIRM_MANAGERS)
  settings(@CurrentTenant() tenant: TenantContext): Promise<PayrollSettings> {
    return this.clients.getSettings(tenant.businessId);
  }

  @Put('settings')
  @Roles(...FIRM_MANAGERS)
  saveSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(SavePayrollSettingsRequest)) body: z.output<typeof SavePayrollSettingsRequest>,
  ): Promise<PayrollSettings> {
    return this.clients.saveSettings(tenant.businessId, actorOf(auth, tenant), body);
  }

  // ---------- Payroll clients ----------

  @Get('clients')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(PayrollClientsQuery)) q: z.output<typeof PayrollClientsQuery>,
  ): Promise<PayrollClientPage> {
    return this.clients.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  /** The list's filters as a CSV (needs the grid's EXPORT). No pay figures. */
  @Get('clients/export')
  @Access('PAYROLL', 'EXPORT')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="payroll-clients.csv"')
  async exportClients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(PayrollClientsQuery)) q: z.output<typeof PayrollClientsQuery>,
  ): Promise<StreamableFile> {
    return csv(await this.clients.exportCsv(tenant.businessId, actorOf(auth, tenant), q));
  }

  @Post('clients')
  @Roles(...FIRM_MANAGERS)
  add(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(AddPayrollClientRequest)) body: z.output<typeof AddPayrollClientRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.add(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get('clients/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('clients/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(UpdatePayrollClientRequest)) body: z.output<typeof UpdatePayrollClientRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/status')
  @HttpCode(200)
  status(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollStatusRequest)) body: z.output<typeof PayrollStatusRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.setStatus(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/pause')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollReasonRequest)) body: z.output<typeof PayrollReasonRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.pause(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/resume')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.resume(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('clients/:id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollReasonRequest)) body: z.output<typeof PayrollReasonRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.archive(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/remove-service')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  removeService(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollRemoveServiceRequest)) body: z.output<typeof PayrollRemoveServiceRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.removeService(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/assign')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  assign(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollAssignRequest)) body: z.output<typeof PayrollAssignRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.assign(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/frequency')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  frequency(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollFrequencyRequest)) body: z.output<typeof PayrollFrequencyRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.setFrequency(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/plan')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  plan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(PayrollPlanRequest)) body: z.output<typeof PayrollPlanRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.clients.setPlan(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('clients/:id/changes')
  changes(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollListQuery)) q: z.output<typeof PayrollListQuery>,
  ): Promise<PayrollChangeList> {
    return this.clients.changes(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/sync')
  @HttpCode(202)
  sync(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<PayrollSyncQueued> {
    return this.clients.sync(tenant.businessId, actorOf(auth, tenant), id);
  }

  // ---------- Activities ----------

  @Get('clients/:id/activities')
  activities(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollListQuery)) q: z.output<typeof PayrollListQuery>,
  ): Promise<PayrollActivityList> {
    return this.clients.activities(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/activities')
  logActivity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(LogPayrollActivityRequest)) body: z.output<typeof LogPayrollActivityRequest>,
  ): Promise<PayrollActivity> {
    return this.clients.logActivity(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ---------- Workers ----------

  @Get('clients/:id/workers')
  listWorkers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollWorkersQuery)) q: z.output<typeof PayrollWorkersQuery>,
  ): Promise<PayrollWorkerList> {
    return this.workers.list(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/workers')
  addWorker(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(CreatePayrollWorkerRequest)) body: z.output<typeof CreatePayrollWorkerRequest>,
  ): Promise<PayrollWorker> {
    return this.workers.add(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Patch('clients/:id/workers/:workerId')
  updateWorker(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Param('workerId', workerId) worker: string,
    @Body(pipe(UpdatePayrollWorkerRequest)) body: z.output<typeof UpdatePayrollWorkerRequest>,
  ): Promise<PayrollWorker> {
    return this.workers.update(tenant.businessId, actorOf(auth, tenant), id, worker, body);
  }

  // ---------- Runs ----------

  @Get('runs')
  listRuns(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(PayrollRunsQuery)) q: z.output<typeof PayrollRunsQuery>,
  ): Promise<PayrollRunPage> {
    return this.runs.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('clients/:id/runs')
  clientRuns(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollListQuery)) q: z.output<typeof PayrollListQuery>,
  ): Promise<PayrollRunPage> {
    return this.runs.clientRuns(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/runs')
  createRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(CreatePayrollRunRequest)) body: z.output<typeof CreatePayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.runs.create(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('runs/:id')
  getRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<PayrollRun> {
    return this.runs.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('runs/:id')
  updateRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Body(pipe(UpdatePayrollRunRequest)) body: z.output<typeof UpdatePayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.runs.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  /** The run's pay lines as a CSV (needs the grid's EXPORT). Holds pay: audited. */
  @Get('runs/:id/export')
  @Access('PAYROLL', 'EXPORT')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="payroll-run.csv"')
  async exportRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<StreamableFile> {
    return csv(await this.runs.exportCsv(tenant.businessId, actorOf(auth, tenant), id));
  }

  @Get('runs/:id/lines')
  runLines(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Query(pipe(PayrollLinesQuery)) q: z.output<typeof PayrollLinesQuery>,
  ): Promise<PayrollLineList> {
    return this.runs.lines(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Put('runs/:id/lines')
  saveRunLines(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Body(pipe(SavePayrollLinesRequest)) body: z.output<typeof SavePayrollLinesRequest>,
  ): Promise<PayrollLineList> {
    return this.runs.saveLines(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('runs/:id/issues')
  runIssues(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Query(pipe(PayrollIssuesQuery)) q: z.output<typeof PayrollIssuesQuery>,
  ): Promise<PayrollIssueList> {
    return this.runs.issues(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('runs/:id/issues/check')
  @HttpCode(200)
  checkRun(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<PayrollIssueList> {
    return this.runs.check(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('runs/:id/issues/:issueId')
  resolveIssue(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Param('issueId', issueId) issue: string,
    @Body(pipe(ResolvePayrollIssueRequest)) body: z.output<typeof ResolvePayrollIssueRequest>,
  ): Promise<PayrollIssue> {
    return this.runs.resolveIssue(tenant.businessId, actorOf(auth, tenant), id, issue, body);
  }

  @Post('runs/:id/save-draft')
  @HttpCode(200)
  saveDraft(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<PayrollRun> {
    return this.runs.saveDraft(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('runs/:id/ready')
  @HttpCode(200)
  ready(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<PayrollRun> {
    return this.runs.markReady(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('runs/:id/approve')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
  ): Promise<PayrollRun> {
    return this.runs.approve(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('runs/:id/submit')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  submit(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Body(pipe(SubmitPayrollRunRequest)) body: z.output<typeof SubmitPayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.runs.submit(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('runs/:id/complete')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Body(pipe(CompletePayrollRunRequest)) body: z.output<typeof CompletePayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.runs.complete(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('runs/:id/reopen')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  reopen(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', runId) id: string,
    @Body(pipe(ReopenPayrollRunRequest)) body: z.output<typeof ReopenPayrollRunRequest>,
  ): Promise<PayrollRun> {
    return this.runs.reopen(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ---------- Filings, reports, year-end ----------

  @Get('clients/:id/filings')
  filings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollFilingsQuery)) q: z.output<typeof PayrollFilingsQuery>,
  ): Promise<PayrollFilingList> {
    return this.records.filings(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Get('clients/:id/reports')
  reports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollReportsQuery)) q: z.output<typeof PayrollReportsQuery>,
  ): Promise<PayrollReportList> {
    return this.records.reports(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/reports')
  addReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(AddPayrollReportRequest)) body: z.output<typeof AddPayrollReportRequest>,
  ): Promise<PayrollReport> {
    return this.records.addReport(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('clients/:id/year-end')
  yearEnd(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(PayrollYearEndQuery)) q: z.output<typeof PayrollYearEndQuery>,
  ): Promise<PayrollYearEnd> {
    return this.records.yearEnd(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Put('clients/:id/year-end/:taxYear')
  saveYearEnd(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Param('taxYear', pipe(PayrollYearEndQuery.shape.taxYear.unwrap())) year: number,
    @Body(pipe(SavePayrollYearEndRequest)) body: z.output<typeof SavePayrollYearEndRequest>,
  ): Promise<PayrollYearEnd> {
    return this.records.saveYearEnd(tenant.businessId, actorOf(auth, tenant), id, year, body);
  }
}
