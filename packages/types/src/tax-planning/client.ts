import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  AddPlanStrategyRequest,
  AttachPlanDocumentRequest,
  CalculateSavingsRequest,
  CalculatorResult,
  CreatePlanningStrategyRequest,
  CreateTaxOpportunityRequest,
  CreateTaxPlanRequest,
  FinalizePlanRequest,
  OpportunityActionRequest,
  PlanInputCatalog,
  PlanDocumentId,
  PlanStrategyId,
  PlanVersionDetail,
  PlanVersionList,
  PlanVersionNumber,
  PlanningCalendar,
  PlanningCalendarQuery,
  PlanningClientPage,
  PlanningClientsQuery,
  PlanningResourceKey,
  PlanningResourceList,
  PlanningResourcesQuery,
  PlanningStrategiesQuery,
  PlanningStrategy,
  PlanningStrategyId,
  PlanningStrategyPage,
  ReorderPlanStrategiesRequest,
  RunScreeningRequest,
  RunScreeningResult,
  SavePlanInputsRequest,
  SaveScenarioRequest,
  SendPlanRequest,
  SendPlanningResourceRequest,
  SetPlanStatusRequest,
  TaxOpportunitiesQuery,
  TaxOpportunityDetail,
  TaxOpportunityEventList,
  TaxOpportunityId,
  TaxOpportunityPage,
  TaxPlanDetail,
  TaxPlanId,
  TaxPlanPage,
  TaxPlanningOverview,
  TaxPlansQuery,
  TaxScenario,
  TaxScenarioId,
  TaxScenarioPage,
  TaxScenariosQuery,
  UpdatePlanStrategyRequest,
  UpdatePlanningStrategyRequest,
  UpdateTaxPlanRequest,
} from './schemas.js';

const BASE = '/business/tax-planning';
const plan = (id: string) => `${BASE}/plans/${parseInput(TaxPlanId, id)}`;
const planStrategy = (id: string, strategyId: string) =>
  `${plan(id)}/strategies/${parseInput(PlanStrategyId, strategyId)}`;
const strategy = (id: string) => `${BASE}/strategies/${parseInput(PlanningStrategyId, id)}`;
const opportunity = (id: string) => `${BASE}/opportunities/${parseInput(TaxOpportunityId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.taxPlanning` (apps/web/src/lib/api.ts): the Tax Planning & Strategy module (contract in
 * ./schemas.ts). Owner and Admin reach every client's planning, Staff only their assigned
 * clients'; the permission grid's TAX_PLANNING capabilities decide the rest (403 FORBIDDEN). An
 * estimate is never a guarantee: show its `basis`, `dataYear` and the disclaimer. Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. No business id
 * is ever sent. Upload a plan document with the documents module for the plan's client, then link
 * it with `attachDocument()`.
 */
export function createTaxPlanningClient(request: ApiRequest) {
  return {
    // ----- Overview and clients -----
    overview: async (): Promise<TaxPlanningOverview> =>
      request(TaxPlanningOverview, `${BASE}/overview`),
    clients: async (query: PlanningClientsQuery = {}): Promise<PlanningClientPage> =>
      request(
        PlanningClientPage,
        `${BASE}/clients${toQuery(parseInput(PlanningClientsQuery, query))}`,
      ),

    // ----- Plans -----
    plans: async (query: TaxPlansQuery = {}): Promise<TaxPlanPage> =>
      request(TaxPlanPage, `${BASE}/plans${toQuery(parseInput(TaxPlansQuery, query))}`),
    /** 409 DUPLICATE_PLAN. */
    createPlan: async (body: CreateTaxPlanRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${BASE}/plans`, post(parseInput(CreateTaxPlanRequest, body))),
    plan: async (id: string): Promise<TaxPlanDetail> => request(TaxPlanDetail, plan(id)),
    /** 409 SAVE_CONFLICT, PLAN_ARCHIVED. */
    updatePlan: async (id: string, body: UpdateTaxPlanRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, plan(id), {
        method: 'PATCH',
        body: parseInput(UpdateTaxPlanRequest, body),
      }),
    inputCatalog: async (): Promise<PlanInputCatalog['items']> =>
      (await request(PlanInputCatalog, `${BASE}/input-catalog`)).items,
    saveInputs: async (id: string, body: SavePlanInputsRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/inputs`, {
        method: 'PUT',
        body: parseInput(SavePlanInputsRequest, body),
      }),
    addStrategy: async (id: string, body: AddPlanStrategyRequest): Promise<TaxPlanDetail> =>
      request(
        TaxPlanDetail,
        `${plan(id)}/strategies`,
        post(parseInput(AddPlanStrategyRequest, body)),
      ),
    /** 403 OVERRIDE_NOT_ALLOWED for an override without the permission. */
    updateStrategy: async (
      id: string,
      strategyId: string,
      body: UpdatePlanStrategyRequest,
    ): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, planStrategy(id, strategyId), {
        method: 'PATCH',
        body: parseInput(UpdatePlanStrategyRequest, body),
      }),
    reorderStrategies: async (
      id: string,
      body: ReorderPlanStrategiesRequest,
    ): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/strategies/order`, {
        method: 'PUT',
        body: parseInput(ReorderPlanStrategiesRequest, body),
      }),
    /** Re-runs the estimates after the inputs change; earlier versions are not touched. */
    recalculate: async (id: string): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/recalculate`, post()),
    attachDocument: async (id: string, body: AttachPlanDocumentRequest): Promise<TaxPlanDetail> =>
      request(
        TaxPlanDetail,
        `${plan(id)}/documents`,
        post(parseInput(AttachPlanDocumentRequest, body)),
      ),
    detachDocument: async (id: string, documentId: string): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/documents/${parseInput(PlanDocumentId, documentId)}`, {
        method: 'DELETE',
      }),
    /** 409 INVALID_STATUS. */
    setStatus: async (id: string, body: SetPlanStatusRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/status`, post(parseInput(SetPlanStatusRequest, body))),
    /** Keeps a FINALIZED snapshot. 409 PLAN_NOT_READY. */
    finalize: async (id: string, body: FinalizePlanRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/finalize`, post(parseInput(FinalizePlanRequest, body))),
    /** Delivers the client-facing plan and keeps a SENT snapshot. 409 PLAN_NOT_READY. */
    send: async (id: string, body: SendPlanRequest): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/send`, post(parseInput(SendPlanRequest, body))),
    archivePlan: async (id: string): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/archive`, post()),
    restorePlan: async (id: string): Promise<TaxPlanDetail> =>
      request(TaxPlanDetail, `${plan(id)}/restore`, post()),
    versions: async (id: string): Promise<PlanVersionList['items']> =>
      (await request(PlanVersionList, `${plan(id)}/versions`)).items,
    version: async (id: string, version: number): Promise<PlanVersionDetail> =>
      request(PlanVersionDetail, `${plan(id)}/versions/${parseInput(PlanVersionNumber, version)}`),

    // ----- Strategy library -----
    strategies: async (query: PlanningStrategiesQuery = {}): Promise<PlanningStrategyPage> =>
      request(
        PlanningStrategyPage,
        `${BASE}/strategies${toQuery(parseInput(PlanningStrategiesQuery, query))}`,
      ),
    createStrategy: async (body: CreatePlanningStrategyRequest): Promise<PlanningStrategy> =>
      request(
        PlanningStrategy,
        `${BASE}/strategies`,
        post(parseInput(CreatePlanningStrategyRequest, body)),
      ),
    libraryStrategy: async (id: string): Promise<PlanningStrategy> =>
      request(PlanningStrategy, strategy(id)),
    updateLibraryStrategy: async (
      id: string,
      body: UpdatePlanningStrategyRequest,
    ): Promise<PlanningStrategy> =>
      request(PlanningStrategy, strategy(id), {
        method: 'PATCH',
        body: parseInput(UpdatePlanningStrategyRequest, body),
      }),
    archiveLibraryStrategy: async (id: string): Promise<PlanningStrategy> =>
      request(PlanningStrategy, `${strategy(id)}/archive`, post()),
    restoreLibraryStrategy: async (id: string): Promise<PlanningStrategy> =>
      request(PlanningStrategy, `${strategy(id)}/restore`, post()),

    // ----- Opportunities -----
    opportunities: async (query: TaxOpportunitiesQuery = {}): Promise<TaxOpportunityPage> =>
      request(
        TaxOpportunityPage,
        `${BASE}/opportunities${toQuery(parseInput(TaxOpportunitiesQuery, query))}`,
      ),
    /** The detail, with Previous and Next in the queue given by the same filters. */
    opportunity: async (
      id: string,
      queue: TaxOpportunitiesQuery = {},
    ): Promise<TaxOpportunityDetail> =>
      request(
        TaxOpportunityDetail,
        `${opportunity(id)}${toQuery(parseInput(TaxOpportunitiesQuery, queue))}`,
      ),
    /** 409 DUPLICATE_OPPORTUNITY. */
    createOpportunity: async (body: CreateTaxOpportunityRequest): Promise<TaxOpportunityDetail> =>
      request(
        TaxOpportunityDetail,
        `${BASE}/opportunities`,
        post(parseInput(CreateTaxOpportunityRequest, body)),
      ),
    /** 409 INVALID_STATUS, SAVE_CONFLICT. */
    opportunityAction: async (
      id: string,
      body: OpportunityActionRequest,
    ): Promise<TaxOpportunityDetail> =>
      request(
        TaxOpportunityDetail,
        `${opportunity(id)}/actions`,
        post(parseInput(OpportunityActionRequest, body)),
      ),
    opportunityEvents: async (id: string): Promise<TaxOpportunityEventList['items']> =>
      (await request(TaxOpportunityEventList, `${opportunity(id)}/events`)).items,
    runScreening: async (body: RunScreeningRequest = {}): Promise<RunScreeningResult> =>
      request(
        RunScreeningResult,
        `${BASE}/screening/run`,
        post(parseInput(RunScreeningRequest, body)),
      ),

    // ----- Tax Savings Calculator -----
    calculate: async (body: CalculateSavingsRequest): Promise<CalculatorResult> =>
      request(
        CalculatorResult,
        `${BASE}/calculator/calculate`,
        post(parseInput(CalculateSavingsRequest, body)),
      ),
    saveScenario: async (body: SaveScenarioRequest): Promise<TaxScenario> =>
      request(
        TaxScenario,
        `${BASE}/calculator/scenarios`,
        post(parseInput(SaveScenarioRequest, body)),
      ),
    scenarios: async (query: TaxScenariosQuery = {}): Promise<TaxScenarioPage> =>
      request(
        TaxScenarioPage,
        `${BASE}/calculator/scenarios${toQuery(parseInput(TaxScenariosQuery, query))}`,
      ),
    scenario: async (id: string): Promise<TaxScenario> =>
      request(TaxScenario, `${BASE}/calculator/scenarios/${parseInput(TaxScenarioId, id)}`),

    // ----- Tax Calendar and Resources -----
    calendar: async (query: PlanningCalendarQuery): Promise<PlanningCalendar['items']> =>
      (
        await request(
          PlanningCalendar,
          `${BASE}/calendar${toQuery(parseInput(PlanningCalendarQuery, query))}`,
        )
      ).items,
    resources: async (query: PlanningResourcesQuery = {}): Promise<PlanningResourceList['items']> =>
      (
        await request(
          PlanningResourceList,
          `${BASE}/resources${toQuery(parseInput(PlanningResourcesQuery, query))}`,
        )
      ).items,
    sendResource: async (key: string, body: SendPlanningResourceRequest): Promise<OkResponse> =>
      request(
        OkResponse,
        `${BASE}/resources/${parseInput(PlanningResourceKey, key)}/send`,
        post(parseInput(SendPlanningResourceRequest, body)),
      ),
  };
}
export type TaxPlanningClient = ReturnType<typeof createTaxPlanningClient>;
