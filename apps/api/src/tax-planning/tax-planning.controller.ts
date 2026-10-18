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
import { z } from 'zod';
import {
  type OkResponse,
  PlanDocumentId,
  type PlanInputCatalog,
  PlanningResourceKey,
  type PlanningCalendar,
  type PlanningClientPage,
  type PlanningResourceList,
  type PlanningStrategy,
  type PlanningStrategyPage,
  PlanningStrategyId,
  PlanStrategyId,
  type PlanVersionDetail,
  type PlanVersionList,
  type RunScreeningResult,
  type TaxOpportunityDetail,
  type TaxOpportunityEventList,
  TaxOpportunityId,
  type TaxOpportunityPage,
  type TaxPlanDetail,
  TaxPlanId,
  type TaxPlanPage,
  type TaxPlanningOverview,
  type TaxScenario,
  TaxScenarioId,
  type TaxScenarioPage,
  type CalculatorResult,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { INPUT_CATALOG } from './catalog.js';
import { TaxCalculatorService } from './calculator.service.js';
import { TaxOpportunitiesService } from './opportunities.service.js';
import { TaxOverviewService } from './overview.service.js';
import { TaxPlansService } from './plans.service.js';
import { TaxScreeningService } from './screening.service.js';
import { PlanningStrategiesService } from './strategies.service.js';
import {
  ActionBody,
  AddStrategyBody,
  AttachDocumentBody,
  CalculateBody,
  CalendarQuery,
  CreatePlanBody,
  CreateOpportunityBody,
  CreateStrategyBody,
  FinalizeBody,
  OpportunitiesQuery,
  PlanningClientsListQuery,
  ReorderBody,
  ResourcesQuery,
  SaveInputsBody,
  SaveScenarioBody,
  ScenariosQuery,
  ScreeningBody,
  SendBody,
  SendResourceBody,
  SetStatusBody,
  StrategiesQuery,
  TaxPlansListQuery,
  UpdatePlanBody,
  UpdateStrategyBody,
  UpdateStrategyLibraryBody,
} from './tax-planning-input.js';

type Out<S extends z.ZodType> = z.output<S>;

const planPipe = new ZodValidationPipe(TaxPlanId);
const planStrategyPipe = new ZodValidationPipe(PlanStrategyId);
const documentPipe = new ZodValidationPipe(PlanDocumentId);
const libraryPipe = new ZodValidationPipe(PlanningStrategyId);
const opportunityPipe = new ZodValidationPipe(TaxOpportunityId);
const scenarioPipe = new ZodValidationPipe(TaxScenarioId);
const versionPipe = new ZodValidationPipe(z.coerce.number().int().min(1).max(1_000_000));

const who = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant, businessId: tenant.businessId };
};

/**
 * Tax Planning & Strategy (contract in packages/types/src/tax-planning). Owner and Admin reach
 * every client's planning, Staff only their assigned clients' (any other is 404); the services
 * check the grid's capabilities (403 FORBIDDEN, OVERRIDE_NOT_ALLOWED, FINANCIAL_INPUTS_RESTRICTED).
 * Estimates are estimates, never guarantees. Never a portal route.
 */
@Controller('business/tax-planning')
@Access('TAX_PLANNING')
@Roles(...FIRM_STAFF)
export class TaxPlanningController {
  constructor(
    private readonly overview: TaxOverviewService,
    private readonly plans: TaxPlansService,
    private readonly library: PlanningStrategiesService,
    private readonly opportunities: TaxOpportunitiesService,
    private readonly screening: TaxScreeningService,
    private readonly calculator: TaxCalculatorService,
  ) {}

  // ----- Overview and clients -----

  @Get('overview')
  getOverview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<TaxPlanningOverview> {
    const w = who(auth, tenant);
    return this.overview.overview(w.businessId, w.tenant, w.userId);
  }

  @Get('clients')
  clients(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(PlanningClientsListQuery)) q: Out<typeof PlanningClientsListQuery>,
  ): Promise<PlanningClientPage> {
    const w = who(auth, tenant);
    return this.overview.clients(w.businessId, w.tenant, w.userId, q);
  }

  // ----- Plans -----

  @Get('plans')
  listPlans(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TaxPlansListQuery)) q: Out<typeof TaxPlansListQuery>,
  ): Promise<TaxPlanPage> {
    const w = who(auth, tenant);
    return this.plans.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('plans')
  createPlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreatePlanBody)) body: Out<typeof CreatePlanBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.create(w.businessId, w.tenant, w.userId, body);
  }

  @Get('input-catalog')
  inputCatalog(): PlanInputCatalog {
    return { items: INPUT_CATALOG };
  }

  @Get('plans/:id')
  getPlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.get(w.businessId, w.tenant, w.userId, id);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePlanBody)) body: Out<typeof UpdatePlanBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.update(w.businessId, w.tenant, w.userId, id, body);
  }

  @Put('plans/:id/inputs')
  saveInputs(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(SaveInputsBody)) body: Out<typeof SaveInputsBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.saveInputs(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/strategies')
  addStrategy(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(AddStrategyBody)) body: Out<typeof AddStrategyBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.addStrategy(w.businessId, w.tenant, w.userId, id, body);
  }

  @Put('plans/:id/strategies/order')
  reorder(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(ReorderBody)) body: Out<typeof ReorderBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.reorderStrategies(w.businessId, w.tenant, w.userId, id, body);
  }

  @Patch('plans/:id/strategies/:strategyId')
  updateStrategy(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Param('strategyId', planStrategyPipe) strategyId: string,
    @Body(new ZodValidationPipe(UpdateStrategyBody)) body: Out<typeof UpdateStrategyBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.updateStrategy(w.businessId, w.tenant, w.userId, id, strategyId, body);
  }

  @Post('plans/:id/recalculate')
  @HttpCode(200)
  recalculate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.recalculate(w.businessId, w.tenant, w.userId, id);
  }

  @Post('plans/:id/documents')
  attachDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(AttachDocumentBody)) body: Out<typeof AttachDocumentBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.attachDocument(w.businessId, w.tenant, w.userId, id, body);
  }

  @Delete('plans/:id/documents/:documentId')
  detachDocument(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Param('documentId', documentPipe) documentId: string,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.detachDocument(w.businessId, w.tenant, w.userId, id, documentId);
  }

  @Post('plans/:id/status')
  @HttpCode(200)
  setStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(SetStatusBody)) body: Out<typeof SetStatusBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.setStatus(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/finalize')
  @HttpCode(200)
  finalize(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(FinalizeBody)) body: Out<typeof FinalizeBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.finalize(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/send')
  @HttpCode(200)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Body(new ZodValidationPipe(SendBody)) body: Out<typeof SendBody>,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.send(w.businessId, w.tenant, w.userId, id, body);
  }

  @Post('plans/:id/archive')
  @HttpCode(200)
  archivePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.archive(w.businessId, w.tenant, w.userId, id, true);
  }

  @Post('plans/:id/restore')
  @HttpCode(200)
  restorePlan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<TaxPlanDetail> {
    const w = who(auth, tenant);
    return this.plans.archive(w.businessId, w.tenant, w.userId, id, false);
  }

  @Get('plans/:id/versions')
  async versions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
  ): Promise<PlanVersionList> {
    const w = who(auth, tenant);
    return { items: await this.plans.versions(w.businessId, w.tenant, w.userId, id) };
  }

  @Get('plans/:id/versions/:version')
  version(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', planPipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<PlanVersionDetail> {
    const w = who(auth, tenant);
    return this.plans.version(w.businessId, w.tenant, w.userId, id, version);
  }

  // ----- Strategy library -----

  @Get('strategies')
  strategies(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(StrategiesQuery)) q: Out<typeof StrategiesQuery>,
  ): Promise<PlanningStrategyPage> {
    return this.library.list(tenant.businessId, q);
  }

  @Post('strategies')
  createStrategy(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateStrategyBody)) body: Out<typeof CreateStrategyBody>,
  ): Promise<PlanningStrategy> {
    const w = who(auth, tenant);
    return this.library.create(w.businessId, w.tenant, w.userId, body);
  }

  @Get('strategies/:id')
  libraryStrategy(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', libraryPipe) id: string,
  ): Promise<PlanningStrategy> {
    return this.library.get(tenant.businessId, id);
  }

  @Patch('strategies/:id')
  updateLibraryStrategy(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', libraryPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStrategyLibraryBody))
    body: Out<typeof UpdateStrategyLibraryBody>,
  ): Promise<PlanningStrategy> {
    return this.library.update(tenant.businessId, tenant, id, body);
  }

  @Post('strategies/:id/archive')
  @HttpCode(200)
  archiveLibraryStrategy(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', libraryPipe) id: string,
  ): Promise<PlanningStrategy> {
    return this.library.setArchived(tenant.businessId, tenant, id, true);
  }

  @Post('strategies/:id/restore')
  @HttpCode(200)
  restoreLibraryStrategy(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', libraryPipe) id: string,
  ): Promise<PlanningStrategy> {
    return this.library.setArchived(tenant.businessId, tenant, id, false);
  }

  // ----- Opportunities -----

  @Get('opportunities')
  listOpportunities(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(OpportunitiesQuery)) q: Out<typeof OpportunitiesQuery>,
  ): Promise<TaxOpportunityPage> {
    const w = who(auth, tenant);
    return this.opportunities.list(w.businessId, w.tenant, w.userId, q);
  }

  @Post('opportunities')
  createOpportunity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateOpportunityBody)) body: Out<typeof CreateOpportunityBody>,
  ): Promise<TaxOpportunityDetail> {
    const w = who(auth, tenant);
    return this.opportunities.create(w.businessId, w.tenant, w.userId, body);
  }

  @Get('opportunities/:id')
  opportunity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', opportunityPipe) id: string,
    @Query(new ZodValidationPipe(OpportunitiesQuery)) queue: Out<typeof OpportunitiesQuery>,
  ): Promise<TaxOpportunityDetail> {
    const w = who(auth, tenant);
    return this.opportunities.get(w.businessId, w.tenant, w.userId, id, queue);
  }

  @Post('opportunities/:id/actions')
  @HttpCode(200)
  opportunityAction(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', opportunityPipe) id: string,
    @Body(new ZodValidationPipe(ActionBody)) body: Out<typeof ActionBody>,
  ): Promise<TaxOpportunityDetail> {
    const w = who(auth, tenant);
    return this.opportunities.act(w.businessId, w.tenant, w.userId, id, body);
  }

  @Get('opportunities/:id/events')
  async opportunityEvents(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', opportunityPipe) id: string,
  ): Promise<TaxOpportunityEventList> {
    const w = who(auth, tenant);
    return { items: await this.opportunities.events(w.businessId, w.tenant, w.userId, id) };
  }

  @Post('screening/run')
  @HttpCode(200)
  runScreening(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ScreeningBody)) body: Out<typeof ScreeningBody>,
  ): Promise<RunScreeningResult> {
    const w = who(auth, tenant);
    return this.screening.run(w.businessId, w.tenant, w.userId, body);
  }

  // ----- Tax Savings Calculator -----

  @Post('calculator/calculate')
  @HttpCode(200)
  calculate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CalculateBody)) body: Out<typeof CalculateBody>,
  ): Promise<CalculatorResult> {
    const w = who(auth, tenant);
    return this.calculator.calculate(w.businessId, w.tenant, w.userId, body);
  }

  @Post('calculator/scenarios')
  saveScenario(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveScenarioBody)) body: Out<typeof SaveScenarioBody>,
  ): Promise<TaxScenario> {
    const w = who(auth, tenant);
    return this.calculator.saveScenario(w.businessId, w.tenant, w.userId, body);
  }

  @Get('calculator/scenarios')
  scenarios(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ScenariosQuery)) q: Out<typeof ScenariosQuery>,
  ): Promise<TaxScenarioPage> {
    const w = who(auth, tenant);
    return this.calculator.list(w.businessId, w.tenant, w.userId, q);
  }

  @Get('calculator/scenarios/:id')
  scenario(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', scenarioPipe) id: string,
  ): Promise<TaxScenario> {
    const w = who(auth, tenant);
    return this.calculator.get(w.businessId, w.tenant, w.userId, id);
  }

  // ----- Tax Calendar and Resources -----

  @Get('calendar')
  async calendar(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(CalendarQuery)) q: Out<typeof CalendarQuery>,
  ): Promise<PlanningCalendar> {
    const w = who(auth, tenant);
    return { items: await this.overview.calendar(w.businessId, w.tenant, w.userId, q) };
  }

  @Get('resources')
  resources(
    @Query(new ZodValidationPipe(ResourcesQuery)) q: Out<typeof ResourcesQuery>,
  ): PlanningResourceList {
    return { items: this.overview.resources(q) };
  }

  @Post('resources/:key/send')
  @HttpCode(200)
  sendResource(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('key', new ZodValidationPipe(PlanningResourceKey)) key: string,
    @Body(new ZodValidationPipe(SendResourceBody)) body: Out<typeof SendResourceBody>,
  ): Promise<OkResponse> {
    const w = who(auth, tenant);
    return this.overview.sendResource(w.businessId, w.tenant, w.userId, key, body);
  }
}
