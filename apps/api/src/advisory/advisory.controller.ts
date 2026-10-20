import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AdvisoryActionItemId,
  type AdvisoryActionItemPage,
  type AdvisoryActionItemRow,
  type AdvisoryActivityPage,
  type AdvisoryClientDetail,
  AdvisoryClientId,
  type AdvisoryClientPage,
  type AdvisoryClientRow,
  type AdvisoryFinancialPage,
  type AdvisoryFinancialRow,
  type AdvisoryGoalDetail,
  AdvisoryGoalId,
  type AdvisoryGoalPage,
  type AdvisoryMeetingPage,
  type AdvisoryReports,
  type AdvisoryMilestone,
  AdvisoryMilestoneId,
  type AdvisoryOverview,
  type AdvisoryPlanDetail,
  AdvisoryPlanId,
  type AdvisoryPlanPage,
  AdvisoryRecommendationId,
  type AdvisoryRecommendationPage,
  type AdvisoryRecommendationRow,
  AdvisoryResourceKey,
  type AdvisoryResourceList,
  type AdvisoryServiceOptionList,
  type AdvisorySettingsView,
  type AdvisoryVersionDetail,
  type AdvisoryVersionList,
  type AdvisoryWorkstream,
  AdvisoryWorkstreamId,
  type OkResponse,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdvisoryActionsService } from './advisory-actions.service.js';
import { AdvisoryClientsService } from './advisory-clients.service.js';
import { AdvisoryFinancialsService } from './advisory-financials.service.js';
import { AdvisoryGoalsService } from './advisory-goals.service.js';
import {
  ActionItemsQuery,
  ActivityQuery,
  AddWorkstreamBody,
  ClientsQuery,
  CreateActionItemBody,
  CreateClientBody,
  CreateFinancialBody,
  CreateGoalBody,
  CreateMilestoneBody,
  CreatePlanBody,
  CreateRecommendationBody,
  FinalizeBody,
  FinancialsQuery,
  GoalsQuery,
  MeetingsQuery,
  ReportsQuery,
  PlansQuery,
  RecommendationsQuery,
  ReorderMilestonesBody,
  ResourcesQuery,
  SendPlanBody,
  SendResourceBody,
  SetPlanStatusBody,
  SettingsBody,
  UpdateActionItemBody,
  UpdateClientBody,
  UpdateGoalBody,
  UpdateMilestoneBody,
  UpdatePlanBody,
  UpdateRecommendationBody,
  UpdateWorkstreamBody,
} from './advisory-input.js';
import { AdvisoryOverviewService } from './advisory-overview.service.js';
import { AdvisoryPlansService } from './advisory-plans.service.js';
import { AdvisoryReportsService } from './advisory-reports.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const clientPipe = new ZodValidationPipe(AdvisoryClientId);
const workstreamPipe = new ZodValidationPipe(AdvisoryWorkstreamId);
const planPipe = new ZodValidationPipe(AdvisoryPlanId);
const goalPipe = new ZodValidationPipe(AdvisoryGoalId);
const milestonePipe = new ZodValidationPipe(AdvisoryMilestoneId);
const recommendationPipe = new ZodValidationPipe(AdvisoryRecommendationId);
const actionPipe = new ZodValidationPipe(AdvisoryActionItemId);
const versionPipe = new ZodValidationPipe(z.coerce.number().int().min(1).max(1_000_000));

const who = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant, businessId: tenant.businessId };
};

/**
 * Business Advisory & Development (contract in packages/types/src/advisory). Owner and Admin reach
 * every advisory client, Staff only the clients assigned to them (any other is 404); the services
 * check the grid's capabilities (403 FORBIDDEN, OVERRIDE_NOT_ALLOWED, FINANCIALS_RESTRICTED).
 * Recommendations and the Business Health Score are advisory tools, not guarantees. Never a portal
 * route.
 */
@Controller('business/advisory')
@Access('BUSINESS_ADVISORY')
@Roles(...FIRM_STAFF)
export class AdvisoryController {
  constructor(
    private readonly overview: AdvisoryOverviewService,
    private readonly clients: AdvisoryClientsService,
    private readonly plans: AdvisoryPlansService,
    private readonly financials: AdvisoryFinancialsService,
    private readonly goals: AdvisoryGoalsService,
    private readonly actions: AdvisoryActionsService,
    private readonly reportsService: AdvisoryReportsService,
  ) {}

  // ----- Overview and services -----

  @Get('overview')
  getOverview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdvisoryOverview> {
    const w = who(auth, tenant);
    return this.overview.overview(w.businessId, w.tenant, w.userId);
  }

  @Get('services')
  async services(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdvisoryServiceOptionList> {
    const w = who(auth, tenant);
    return { items: await this.overview.services(w.businessId, w.tenant, w.userId) };
  }

  // ----- Advisory clients -----

  @Get('clients')
  listClients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ClientsQuery)) q: Out<typeof ClientsQuery>,
  ): Promise<AdvisoryClientPage> {
    const w = who(auth, tenant);
    return this.clients.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('clients')
  addClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateClientBody)) body: Out<typeof CreateClientBody>,
  ): Promise<AdvisoryClientDetail> {
    const w = who(auth, tenant);
    return this.clients.add(w.businessId, w.tenant, w.userId, body);
  }

  @Get('clients/:id')
  getClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
  ): Promise<AdvisoryClientDetail> {
    const w = who(auth, tenant);
    return this.clients.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('clients/:id')
  updateClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
    @Body(new ZodValidationPipe(UpdateClientBody)) body: Out<typeof UpdateClientBody>,
  ): Promise<AdvisoryClientDetail> {
    const w = who(auth, tenant);
    return this.clients.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('clients/:id/archive')
  @HttpCode(200)
  archiveClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
  ): Promise<AdvisoryClientRow> {
    const w = who(auth, tenant);
    return this.clients.setArchived(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('clients/:id/restore')
  @HttpCode(200)
  restoreClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
  ): Promise<AdvisoryClientRow> {
    const w = who(auth, tenant);
    return this.clients.setArchived(w.businessId, w.tenant, w.userId, id, false);
  }

  @Post('clients/:id/workstreams')
  addWorkstream(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
    @Body(new ZodValidationPipe(AddWorkstreamBody)) body: Out<typeof AddWorkstreamBody>,
  ): Promise<AdvisoryWorkstream> {
    const w = who(auth, tenant);
    return this.clients.addWorkstream(w.businessId, w.tenant, w.userId, id, body);
  }

  @Patch('clients/:id/workstreams/:workstreamId')
  updateWorkstream(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
    @Param('workstreamId', workstreamPipe) workstreamId: string,
    @Body(new ZodValidationPipe(UpdateWorkstreamBody)) body: Out<typeof UpdateWorkstreamBody>,
  ): Promise<AdvisoryWorkstream> {
    const w = who(auth, tenant);
    return this.clients.updateWorkstream(w.businessId, w.tenant, w.userId, id, workstreamId, body);
  }

  @Get('clients/:id/activity')
  activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
    @Query(new ZodValidationPipe(ActivityQuery)) q: Out<typeof ActivityQuery>,
  ): Promise<AdvisoryActivityPage> {
    const w = who(auth, tenant);
    return this.clients.activity(w.businessId, w.tenant, w.userId, id, q);
  }

  @Post('clients/:id/financials')
  addFinancial(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) id: string,
    @Body(new ZodValidationPipe(CreateFinancialBody)) body: Out<typeof CreateFinancialBody>,
  ): Promise<AdvisoryFinancialRow> {
    const w = who(auth, tenant);
    return this.financials.add(w.businessId, w.tenant, w.userId, id, body);
  }

  // ----- Business plans -----

  @Get('plans')
  listPlans(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(PlansQuery)) q: Out<typeof PlansQuery>,
  ): Promise<AdvisoryPlanPage> {
    const w = who(auth, tenant);
    return this.plans.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('plans')
  createPlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreatePlanBody)) body: Out<typeof CreatePlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.create(w.businessId, w.tenant, w.userId, body);
  }

  @Get('plans/:id')
  getPlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePlanBody)) body: Out<typeof UpdatePlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/status')
  @HttpCode(200)
  setPlanStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(SetPlanStatusBody)) body: Out<typeof SetPlanStatusBody>,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.setStatus(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/finalize')
  @HttpCode(200)
  finalizePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(FinalizeBody)) body: Out<typeof FinalizeBody>,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.finalize(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/send')
  @HttpCode(200)
  sendPlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(SendPlanBody)) body: Out<typeof SendPlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.send(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/archive')
  @HttpCode(200)
  archivePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.setArchived(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('plans/:id/restore')
  @HttpCode(200)
  restorePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<AdvisoryPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.setArchived(w.businessId, w.tenant, w.userId, id, false);
  }

  @Get('plans/:id/versions')
  async versions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<AdvisoryVersionList> {
    const w = who(auth, tenant);
    return { items: await this.plans.versions(w.businessId, w.tenant, w.userId, id) };
  }

  @Get('plans/:id/versions/:version')
  version(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<AdvisoryVersionDetail> {
    const w = who(auth, tenant);
    return this.plans.version(w.businessId, w.tenant, w.userId, id, version);
  }

  // ----- Financial analysis -----

  @Get('financials')
  listFinancials(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(FinancialsQuery)) q: Out<typeof FinancialsQuery>,
  ): Promise<AdvisoryFinancialPage> {
    const w = who(auth, tenant);
    return this.financials.list(w.businessId, w.tenant, w.userId, q);
  }

  // ----- Goals and milestones -----

  @Get('goals')
  listGoals(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(GoalsQuery)) q: Out<typeof GoalsQuery>,
  ): Promise<AdvisoryGoalPage> {
    const w = who(auth, tenant);
    return this.goals.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('goals')
  createGoal(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateGoalBody)) body: Out<typeof CreateGoalBody>,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.create(w.businessId, w.tenant, w.userId, body);
  }

  @Get('goals/:id')
  getGoal(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('goals/:id')
  updateGoal(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGoalBody)) body: Out<typeof UpdateGoalBody>,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('goals/:id/archive')
  @HttpCode(200)
  archiveGoal(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.setArchived(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('goals/:id/restore')
  @HttpCode(200)
  restoreGoal(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.setArchived(w.businessId, w.tenant, w.userId, id, false);
  }

  @Post('goals/:id/milestones')
  addMilestone(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
    @Body(new ZodValidationPipe(CreateMilestoneBody)) body: Out<typeof CreateMilestoneBody>,
  ): Promise<AdvisoryMilestone> {
    const w = who(auth, tenant);
    return this.goals.addMilestone(w.businessId, w.tenant, w.userId, id, body);
  }

  @Put('goals/:id/milestones/order')
  reorderMilestones(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', goalPipe) id: string,
    @Body(new ZodValidationPipe(ReorderMilestonesBody)) body: Out<typeof ReorderMilestonesBody>,
  ): Promise<AdvisoryGoalDetail> {
    const w = who(auth, tenant);
    return this.goals.reorderMilestones(w.businessId, w.tenant, w.userId, id, body);
  }

  @Patch('milestones/:id')
  updateMilestone(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', milestonePipe) id: string,
    @Body(new ZodValidationPipe(UpdateMilestoneBody)) body: Out<typeof UpdateMilestoneBody>,
  ): Promise<AdvisoryMilestone> {
    const w = who(auth, tenant);
    return this.goals.updateMilestone(w.businessId, w.tenant, w.userId, id, body);
  }

  // ----- Recommendations and action items -----

  @Get('recommendations')
  listRecommendations(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(RecommendationsQuery)) q: Out<typeof RecommendationsQuery>,
  ): Promise<AdvisoryRecommendationPage> {
    const w = who(auth, tenant);
    return this.actions.listRecommendations(w.businessId, w.tenant, w.userId, q);
  }

  @Post('recommendations')
  createRecommendation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateRecommendationBody))
    body: Out<typeof CreateRecommendationBody>,
  ): Promise<AdvisoryRecommendationRow> {
    const w = who(auth, tenant);
    return this.actions.createRecommendation(w.businessId, w.tenant, w.userId, body);
  }

  @Patch('recommendations/:id')
  updateRecommendation(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', recommendationPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRecommendationBody))
    body: Out<typeof UpdateRecommendationBody>,
  ): Promise<AdvisoryRecommendationRow> {
    const w = who(auth, tenant);
    return this.actions.updateRecommendation(w.businessId, w.tenant, w.userId, id, body);
  }

  @Get('action-items')
  listActionItems(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ActionItemsQuery)) q: Out<typeof ActionItemsQuery>,
  ): Promise<AdvisoryActionItemPage> {
    const w = who(auth, tenant);
    return this.actions.listActionItems(w.businessId, w.tenant, w.userId, q);
  }

  @Post('action-items')
  createActionItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateActionItemBody)) body: Out<typeof CreateActionItemBody>,
  ): Promise<AdvisoryActionItemRow> {
    const w = who(auth, tenant);
    return this.actions.createActionItem(w.businessId, w.tenant, w.userId, body);
  }

  @Patch('action-items/:id')
  updateActionItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', actionPipe) id: string,
    @Body(new ZodValidationPipe(UpdateActionItemBody)) body: Out<typeof UpdateActionItemBody>,
  ): Promise<AdvisoryActionItemRow> {
    const w = who(auth, tenant);
    return this.actions.updateActionItem(w.businessId, w.tenant, w.userId, id, body);
  }

  // ----- Meetings, resources, settings -----

  @Get('meetings')
  meetings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MeetingsQuery)) q: Out<typeof MeetingsQuery>,
  ): Promise<AdvisoryMeetingPage> {
    const w = who(auth, tenant);
    return this.overview.meetings(w.businessId, w.tenant, w.userId, q);
  }

  /** The Reports tab: live counts for the clients the caller reaches; figures need the permission. */
  @Get('reports')
  reports(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ReportsQuery)) q: Out<typeof ReportsQuery>,
  ): Promise<AdvisoryReports> {
    const w = who(auth, tenant);
    return this.reportsService.reports(w.businessId, w.tenant, w.userId, q);
  }

  @Get('resources')
  resources(
    @Query(new ZodValidationPipe(ResourcesQuery)) q: Out<typeof ResourcesQuery>,
  ): AdvisoryResourceList {
    return { items: this.overview.resources(q) };
  }

  @Post('resources/:key/send')
  @HttpCode(200)
  sendResource(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('key', new ZodValidationPipe(AdvisoryResourceKey)) key: string,
    @Body(new ZodValidationPipe(SendResourceBody)) body: Out<typeof SendResourceBody>,
  ): Promise<OkResponse> {
    const w = who(auth, tenant);
    return this.overview.sendResource(w.businessId, w.tenant, w.userId, key, body);
  }

  @Get('settings')
  settings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AdvisorySettingsView> {
    const w = who(auth, tenant);
    return this.overview.settings(w.businessId, w.tenant, w.userId);
  }

  @Put('settings')
  saveSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SettingsBody)) body: Out<typeof SettingsBody>,
  ): Promise<AdvisorySettingsView> {
    const w = who(auth, tenant);
    return this.overview.saveSettings(w.businessId, w.tenant, w.userId, body);
  }
}
