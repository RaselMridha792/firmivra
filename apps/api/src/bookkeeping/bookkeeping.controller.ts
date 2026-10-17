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
  AddBookkeepingAccountRequest,
  AddBookkeepingClientRequest,
  AddBookkeepingReportRequest,
  type BookkeepingAccount,
  BookkeepingAccountId,
  type BookkeepingAccountList,
  type BookkeepingActivity,
  type BookkeepingActivityList,
  BookkeepingAssignRequest,
  BookkeepingClientId,
  type BookkeepingClientPage,
  BookkeepingClientsQuery,
  type BookkeepingClientWorkspace,
  BookkeepingCloseItemId,
  type BookkeepingConnection,
  BookkeepingConnectionId,
  type BookkeepingConnectionList,
  BookkeepingListQuery,
  type BookkeepingOverview,
  BookkeepingOverviewQuery,
  BookkeepingPauseRequest,
  type BookkeepingPeriod,
  BookkeepingPeriodId,
  type BookkeepingPeriodList,
  BookkeepingPeriodsQuery,
  BookkeepingReasonRequest,
  type BookkeepingReconciliation,
  BookkeepingReconciliationId,
  type BookkeepingReconciliationList,
  BookkeepingReopenRequest,
  BookkeepingReportId,
  type BookkeepingReportPage,
  type BookkeepingReportRow,
  BookkeepingReportsQuery,
  BookkeepingSendBackRequest,
  type BookkeepingSettings,
  type BookkeepingStatusRefreshed,
  BookkeepingStatusRequest,
  type BookkeepingSyncQueued,
  type BookkeepingSyncRunList,
  ConnectBookkeepingRequest,
  CreateBookkeepingPeriodRequest,
  CreateBookkeepingReconciliationRequest,
  DeliverBookkeepingReportRequest,
  LogBookkeepingActivityRequest,
  SaveBookkeepingSettingsRequest,
  UpdateBookkeepingAccountRequest,
  UpdateBookkeepingClientRequest,
  UpdateBookkeepingCloseItemRequest,
  UpdateBookkeepingConnectionRequest,
  UpdateBookkeepingPeriodRequest,
  UpdateBookkeepingReconciliationRequest,
  UpdateBookkeepingReportRequest,
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
import { BookkeepingClientsService } from './bookkeeping-clients.service.js';
import { BookkeepingConnectionsService } from './bookkeeping-connections.service.js';
import { BookkeepingPeriodsService } from './bookkeeping-periods.service.js';
import { BookkeepingReportsService } from './bookkeeping-reports.service.js';

const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const clientId = pipe(BookkeepingClientId);
const connectionId = pipe(BookkeepingConnectionId);
const accountId = pipe(BookkeepingAccountId);
const periodId = pipe(BookkeepingPeriodId);
const closeItemId = pipe(BookkeepingCloseItemId);
const reconciliationId = pipe(BookkeepingReconciliationId);
const reportId = pipe(BookkeepingReportId);

const csv = (text: string) =>
  new StreamableFile(Buffer.from(text, 'utf8'), { type: 'text/csv; charset=utf-8' });

/**
 * The firm's bookkeeping work (contract in packages/types/src/bookkeeping). Everyone with the
 * permission grid's BOOKKEEPING view reads and prepares; Owner and Admin add clients, change
 * cadence and assignment, pause, archive, edit settings, manage connections, approve and reopen
 * reconciliations, approve, close and reopen periods and approve and deliver reports. Staff
 * reach only the bookkeeping clients of clients assigned to them. The firm comes from
 * TenantGuard, never from the request. Fixed paths come before `:id` ones.
 */
@Controller('business/bookkeeping')
@Access('BOOKKEEPING')
@Roles(...FIRM_STAFF)
export class BookkeepingController {
  constructor(
    private readonly clients: BookkeepingClientsService,
    private readonly connections: BookkeepingConnectionsService,
    private readonly periods: BookkeepingPeriodsService,
    private readonly reports: BookkeepingReportsService,
  ) {}

  // ---------- Overview, settings ----------

  @Get('overview')
  overview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(BookkeepingOverviewQuery)) q: z.output<typeof BookkeepingOverviewQuery>,
  ): Promise<BookkeepingOverview> {
    return this.clients.overview(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('settings')
  @Roles(...FIRM_MANAGERS)
  settings(@CurrentTenant() tenant: TenantContext): Promise<BookkeepingSettings> {
    return this.clients.getSettings(tenant.businessId);
  }

  @Put('settings')
  @Roles(...FIRM_MANAGERS)
  saveSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(SaveBookkeepingSettingsRequest))
    body: z.output<typeof SaveBookkeepingSettingsRequest>,
  ): Promise<BookkeepingSettings> {
    return this.clients.saveSettings(tenant.businessId, actorOf(auth, tenant), body);
  }

  // ---------- Bookkeeping clients ----------

  @Get('clients')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(BookkeepingClientsQuery)) q: z.output<typeof BookkeepingClientsQuery>,
  ): Promise<BookkeepingClientPage> {
    return this.clients.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('clients/export')
  @Access('BOOKKEEPING', 'EXPORT')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="bookkeeping-clients.csv"')
  async exportClients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(BookkeepingClientsQuery)) q: z.output<typeof BookkeepingClientsQuery>,
  ): Promise<StreamableFile> {
    return csv(await this.clients.exportCsv(tenant.businessId, actorOf(auth, tenant), q));
  }

  @Post('clients')
  @Roles(...FIRM_MANAGERS)
  add(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(AddBookkeepingClientRequest)) body: z.output<typeof AddBookkeepingClientRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.add(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('clients/sync')
  @HttpCode(200)
  syncAll(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<BookkeepingSyncQueued> {
    return this.clients.syncAll(tenant.businessId, actorOf(auth, tenant));
  }

  @Post('clients/refresh-status')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  refreshStatuses(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<BookkeepingStatusRefreshed> {
    return this.clients.refreshStatuses(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('clients/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('clients/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(UpdateBookkeepingClientRequest))
    body: z.output<typeof UpdateBookkeepingClientRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/status')
  @HttpCode(200)
  status(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(BookkeepingStatusRequest)) body: z.output<typeof BookkeepingStatusRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.setStatus(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('clients/:id/pause')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(BookkeepingPauseRequest)) body: z.output<typeof BookkeepingPauseRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.pause(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Post('clients/:id/resume')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.resume(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('clients/:id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(BookkeepingReasonRequest)) body: z.output<typeof BookkeepingReasonRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.archive(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Post('clients/:id/assign')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  assign(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(BookkeepingAssignRequest)) body: z.output<typeof BookkeepingAssignRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    return this.clients.assign(tenant.businessId, actorOf(auth, tenant), id, body.assignedUserId);
  }

  @Post('clients/:id/sync')
  @HttpCode(200)
  sync(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingSyncQueued> {
    return this.clients.sync(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get('clients/:id/activities')
  activities(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(BookkeepingListQuery)) q: z.output<typeof BookkeepingListQuery>,
  ): Promise<BookkeepingActivityList> {
    return this.clients.activities(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/activities')
  logActivity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(LogBookkeepingActivityRequest)) body: z.output<typeof LogBookkeepingActivityRequest>,
  ): Promise<BookkeepingActivity> {
    return this.clients.logActivity(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ---------- Connections and accounts ----------

  @Get('clients/:id/connections')
  listConnections(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingConnectionList> {
    return this.connections.list(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('clients/:id/connections')
  @Roles(...FIRM_MANAGERS)
  connect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(ConnectBookkeepingRequest)) body: z.output<typeof ConnectBookkeepingRequest>,
  ): Promise<BookkeepingConnection> {
    return this.connections.connect(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Patch('connections/:id')
  @Roles(...FIRM_MANAGERS)
  updateConnection(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', connectionId) id: string,
    @Body(pipe(UpdateBookkeepingConnectionRequest))
    body: z.output<typeof UpdateBookkeepingConnectionRequest>,
  ): Promise<BookkeepingConnection> {
    return this.connections.updateConnection(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('connections/:id/disconnect')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  disconnect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', connectionId) id: string,
  ): Promise<BookkeepingConnection> {
    return this.connections.disconnect(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('connections/:id/reconnect')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  reconnect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', connectionId) id: string,
  ): Promise<BookkeepingConnection> {
    return this.connections.reconnect(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get('connections/:id/syncs')
  syncRuns(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', connectionId) id: string,
    @Query(pipe(BookkeepingListQuery)) q: z.output<typeof BookkeepingListQuery>,
  ): Promise<BookkeepingSyncRunList> {
    return this.connections.syncRuns(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Get('clients/:id/accounts')
  accounts(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingAccountList> {
    return this.connections.accounts(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('clients/:id/accounts')
  addAccount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(AddBookkeepingAccountRequest)) body: z.output<typeof AddBookkeepingAccountRequest>,
  ): Promise<BookkeepingAccount> {
    return this.connections.addAccount(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Patch('accounts/:id')
  updateAccount(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', accountId) id: string,
    @Body(pipe(UpdateBookkeepingAccountRequest))
    body: z.output<typeof UpdateBookkeepingAccountRequest>,
  ): Promise<BookkeepingAccount> {
    return this.connections.updateAccount(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ---------- Periods and the close ----------

  @Get('clients/:id/periods')
  listPeriods(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(BookkeepingPeriodsQuery)) q: z.output<typeof BookkeepingPeriodsQuery>,
  ): Promise<BookkeepingPeriodList> {
    return this.periods.list(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/periods')
  createPeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(CreateBookkeepingPeriodRequest))
    body: z.output<typeof CreateBookkeepingPeriodRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.periods.create(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('periods/:id')
  getPeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('periods/:id')
  updatePeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
    @Body(pipe(UpdateBookkeepingPeriodRequest))
    body: z.output<typeof UpdateBookkeepingPeriodRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.periods.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('periods/:id/start')
  @HttpCode(200)
  startPeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.start(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/ready')
  @HttpCode(200)
  readyPeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.markReady(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/send-back')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  sendPeriodBack(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.sendBack(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/approve')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  approvePeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.approve(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/close')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  closePeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingPeriod> {
    return this.periods.close(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/reopen')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  reopenPeriod(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
    @Body(pipe(BookkeepingReopenRequest)) body: z.output<typeof BookkeepingReopenRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.periods.reopen(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Patch('periods/:id/close-items/:itemId')
  updateCloseItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
    @Param('itemId', closeItemId) itemId: string,
    @Body(pipe(UpdateBookkeepingCloseItemRequest))
    body: z.output<typeof UpdateBookkeepingCloseItemRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.periods.updateCloseItem(tenant.businessId, actorOf(auth, tenant), id, itemId, body);
  }

  // ---------- Reconciliations ----------

  @Get('periods/:id/reconciliations')
  listReconciliations(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
  ): Promise<BookkeepingReconciliationList> {
    return this.periods.reconciliations(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('periods/:id/reconciliations')
  createReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', periodId) id: string,
    @Body(pipe(CreateBookkeepingReconciliationRequest))
    body: z.output<typeof CreateBookkeepingReconciliationRequest>,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.createReconciliation(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('reconciliations/:id')
  getReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reconciliationId) id: string,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.getReconciliation(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('reconciliations/:id')
  saveReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reconciliationId) id: string,
    @Body(pipe(UpdateBookkeepingReconciliationRequest))
    body: z.output<typeof UpdateBookkeepingReconciliationRequest>,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.saveReconciliation(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('reconciliations/:id/ready')
  @HttpCode(200)
  readyReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reconciliationId) id: string,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.markReconciliationReady(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('reconciliations/:id/approve')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  approveReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reconciliationId) id: string,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.approveReconciliation(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('reconciliations/:id/reopen')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  reopenReconciliation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reconciliationId) id: string,
    @Body(pipe(BookkeepingReopenRequest)) body: z.output<typeof BookkeepingReopenRequest>,
  ): Promise<BookkeepingReconciliation> {
    return this.periods.reopenReconciliation(
      tenant.businessId,
      actorOf(auth, tenant),
      id,
      body.reason,
    );
  }

  // ---------- Reports ----------

  @Get('reports')
  listReports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(BookkeepingReportsQuery)) q: z.output<typeof BookkeepingReportsQuery>,
  ): Promise<BookkeepingReportPage> {
    return this.reports.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get('reports/export')
  @Access('BOOKKEEPING', 'EXPORT')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Disposition', 'attachment; filename="bookkeeping-reports.csv"')
  async exportReports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(BookkeepingReportsQuery)) q: z.output<typeof BookkeepingReportsQuery>,
  ): Promise<StreamableFile> {
    return csv(await this.reports.exportCsv(tenant.businessId, actorOf(auth, tenant), q));
  }

  @Get('clients/:id/reports')
  clientReports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(BookkeepingReportsQuery)) q: z.output<typeof BookkeepingReportsQuery>,
  ): Promise<BookkeepingReportPage> {
    return this.reports.listForClient(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/reports')
  addReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(AddBookkeepingReportRequest)) body: z.output<typeof AddBookkeepingReportRequest>,
  ): Promise<BookkeepingReportRow> {
    return this.reports.add(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('reports/:id')
  getReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
  ): Promise<BookkeepingReportRow> {
    return this.reports.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('reports/:id')
  updateReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
    @Body(pipe(UpdateBookkeepingReportRequest))
    body: z.output<typeof UpdateBookkeepingReportRequest>,
  ): Promise<BookkeepingReportRow> {
    return this.reports.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('reports/:id/start')
  @HttpCode(200)
  startReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
  ): Promise<BookkeepingReportRow> {
    return this.reports.start(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('reports/:id/submit-review')
  @HttpCode(200)
  submitReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
  ): Promise<BookkeepingReportRow> {
    return this.reports.submitForReview(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('reports/:id/send-back')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  sendReportBack(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
    @Body(pipe(BookkeepingSendBackRequest)) body: z.output<typeof BookkeepingSendBackRequest>,
  ): Promise<BookkeepingReportRow> {
    return this.reports.sendBack(tenant.businessId, actorOf(auth, tenant), id, body.note);
  }

  @Post('reports/:id/approve')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  approveReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
  ): Promise<BookkeepingReportRow> {
    return this.reports.approve(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('reports/:id/deliver')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  deliverReport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', reportId) id: string,
    @Body(pipe(DeliverBookkeepingReportRequest))
    body: z.output<typeof DeliverBookkeepingReportRequest>,
  ): Promise<BookkeepingReportRow> {
    return this.reports.deliver(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
