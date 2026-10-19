import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  AddAdvisoryWorkstreamRequest,
  AdvisoryActionItemId,
  AdvisoryActionItemPage,
  AdvisoryActionItemRow,
  AdvisoryActionItemsQuery,
  AdvisoryActivityPage,
  AdvisoryActivityQuery,
  AdvisoryClientDetail,
  AdvisoryClientId,
  AdvisoryClientPage,
  AdvisoryClientRow,
  AdvisoryClientsQuery,
  AdvisoryFinancialPage,
  AdvisoryFinancialRow,
  AdvisoryFinancialsQuery,
  AdvisoryGoalDetail,
  AdvisoryGoalId,
  AdvisoryGoalPage,
  AdvisoryGoalsQuery,
  AdvisoryMeetingPage,
  AdvisoryMeetingsQuery,
  AdvisoryMilestone,
  AdvisoryMilestoneId,
  AdvisoryOverview,
  AdvisoryPlanDetail,
  AdvisoryPlanId,
  AdvisoryPlanPage,
  AdvisoryReports,
  AdvisoryReportsQuery,
  AdvisoryPlansQuery,
  AdvisoryRecommendationId,
  AdvisoryRecommendationPage,
  AdvisoryRecommendationRow,
  AdvisoryRecommendationsQuery,
  AdvisoryResourceKey,
  AdvisoryResourceList,
  AdvisoryResourcesQuery,
  AdvisoryServiceOptionList,
  AdvisorySettingsView,
  AdvisoryVersionDetail,
  AdvisoryVersionList,
  AdvisoryVersionNumber,
  AdvisoryWorkstream,
  AdvisoryWorkstreamId,
  CreateAdvisoryActionItemRequest,
  CreateAdvisoryClientRequest,
  CreateAdvisoryFinancialRequest,
  CreateAdvisoryGoalRequest,
  CreateAdvisoryMilestoneRequest,
  CreateAdvisoryPlanRequest,
  CreateAdvisoryRecommendationRequest,
  FinalizeAdvisoryPlanRequest,
  ReorderAdvisoryMilestonesRequest,
  SaveAdvisorySettingsRequest,
  SendAdvisoryPlanRequest,
  SendAdvisoryResourceRequest,
  SetAdvisoryPlanStatusRequest,
  UpdateAdvisoryActionItemRequest,
  UpdateAdvisoryClientRequest,
  UpdateAdvisoryGoalRequest,
  UpdateAdvisoryMilestoneRequest,
  UpdateAdvisoryPlanRequest,
  UpdateAdvisoryRecommendationRequest,
  UpdateAdvisoryWorkstreamRequest,
} from './schemas.js';

const BASE = '/business/advisory';
const advisoryClient = (id: string) => `${BASE}/clients/${parseInput(AdvisoryClientId, id)}`;
const plan = (id: string) => `${BASE}/plans/${parseInput(AdvisoryPlanId, id)}`;
const goal = (id: string) => `${BASE}/goals/${parseInput(AdvisoryGoalId, id)}`;
const milestone = (id: string) => `${BASE}/milestones/${parseInput(AdvisoryMilestoneId, id)}`;
const recommendation = (id: string) =>
  `${BASE}/recommendations/${parseInput(AdvisoryRecommendationId, id)}`;
const actionItem = (id: string) => `${BASE}/action-items/${parseInput(AdvisoryActionItemId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.advisory` (apps/web/src/lib/api.ts): the Business Advisory & Development module (contract
 * in ./schemas.ts). Owner and Admin reach every advisory client, Staff only their assigned
 * clients'; the permission grid's BUSINESS_ADVISORY capabilities decide the rest (403 FORBIDDEN).
 * Services come from Services & Pricing (`serviceOptions()`). Recommendations and the Business
 * Health Score are advisory tools, not guarantees: show the disclaimer, the score's factors and
 * the age of the data. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent. No business id is ever sent. Meetings are scheduled in Appointments, notes and
 * documents live in their own modules on the client's engagement.
 */
export function createAdvisoryClient(request: ApiRequest) {
  return {
    // ----- Overview and services -----
    overview: async (): Promise<AdvisoryOverview> => request(AdvisoryOverview, `${BASE}/overview`),
    serviceOptions: async (): Promise<AdvisoryServiceOptionList['items']> =>
      (await request(AdvisoryServiceOptionList, `${BASE}/services`)).items,

    // ----- Advisory clients -----
    clients: async (query: AdvisoryClientsQuery = {}): Promise<AdvisoryClientPage> =>
      request(
        AdvisoryClientPage,
        `${BASE}/clients${toQuery(parseInput(AdvisoryClientsQuery, query))}`,
      ),
    /** 409 ALREADY_ADVISORY_CLIENT. */
    addClient: async (body: CreateAdvisoryClientRequest): Promise<AdvisoryClientDetail> =>
      request(
        AdvisoryClientDetail,
        `${BASE}/clients`,
        post(parseInput(CreateAdvisoryClientRequest, body)),
      ),
    client: async (id: string): Promise<AdvisoryClientDetail> =>
      request(AdvisoryClientDetail, advisoryClient(id)),
    updateClient: async (
      id: string,
      body: UpdateAdvisoryClientRequest,
    ): Promise<AdvisoryClientDetail> =>
      request(AdvisoryClientDetail, advisoryClient(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryClientRequest, body),
      }),
    archiveClient: async (id: string): Promise<AdvisoryClientRow> =>
      request(AdvisoryClientRow, `${advisoryClient(id)}/archive`, post()),
    restoreClient: async (id: string): Promise<AdvisoryClientRow> =>
      request(AdvisoryClientRow, `${advisoryClient(id)}/restore`, post()),
    /** 409 DUPLICATE_SERVICE. */
    addWorkstream: async (
      id: string,
      body: AddAdvisoryWorkstreamRequest,
    ): Promise<AdvisoryWorkstream> =>
      request(
        AdvisoryWorkstream,
        `${advisoryClient(id)}/workstreams`,
        post(parseInput(AddAdvisoryWorkstreamRequest, body)),
      ),
    updateWorkstream: async (
      id: string,
      workstreamId: string,
      body: UpdateAdvisoryWorkstreamRequest,
    ): Promise<AdvisoryWorkstream> =>
      request(
        AdvisoryWorkstream,
        `${advisoryClient(id)}/workstreams/${parseInput(AdvisoryWorkstreamId, workstreamId)}`,
        { method: 'PATCH', body: parseInput(UpdateAdvisoryWorkstreamRequest, body) },
      ),
    /** The client's audited advisory activity. */
    activity: async (
      id: string,
      query: AdvisoryActivityQuery = {},
    ): Promise<AdvisoryActivityPage> =>
      request(
        AdvisoryActivityPage,
        `${advisoryClient(id)}/activity${toQuery(parseInput(AdvisoryActivityQuery, query))}`,
      ),

    // ----- Business plans -----
    plans: async (query: AdvisoryPlansQuery = {}): Promise<AdvisoryPlanPage> =>
      request(AdvisoryPlanPage, `${BASE}/plans${toQuery(parseInput(AdvisoryPlansQuery, query))}`),
    createPlan: async (body: CreateAdvisoryPlanRequest): Promise<AdvisoryPlanDetail> =>
      request(
        AdvisoryPlanDetail,
        `${BASE}/plans`,
        post(parseInput(CreateAdvisoryPlanRequest, body)),
      ),
    plan: async (id: string): Promise<AdvisoryPlanDetail> => request(AdvisoryPlanDetail, plan(id)),
    /** 409 SAVE_CONFLICT, PLAN_ARCHIVED. */
    updatePlan: async (id: string, body: UpdateAdvisoryPlanRequest): Promise<AdvisoryPlanDetail> =>
      request(AdvisoryPlanDetail, plan(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryPlanRequest, body),
      }),
    /** 409 INVALID_STATUS. */
    setPlanStatus: async (
      id: string,
      body: SetAdvisoryPlanStatusRequest,
    ): Promise<AdvisoryPlanDetail> =>
      request(
        AdvisoryPlanDetail,
        `${plan(id)}/status`,
        post(parseInput(SetAdvisoryPlanStatusRequest, body)),
      ),
    /** Keeps an immutable version. 409 PLAN_NOT_READY. */
    finalizePlan: async (
      id: string,
      body: FinalizeAdvisoryPlanRequest,
    ): Promise<AdvisoryPlanDetail> =>
      request(
        AdvisoryPlanDetail,
        `${plan(id)}/finalize`,
        post(parseInput(FinalizeAdvisoryPlanRequest, body)),
      ),
    /** Delivers the finalized plan and records who, when and how. 409 PLAN_NOT_READY. */
    sendPlan: async (id: string, body: SendAdvisoryPlanRequest): Promise<AdvisoryPlanDetail> =>
      request(
        AdvisoryPlanDetail,
        `${plan(id)}/send`,
        post(parseInput(SendAdvisoryPlanRequest, body)),
      ),
    archivePlan: async (id: string): Promise<AdvisoryPlanDetail> =>
      request(AdvisoryPlanDetail, `${plan(id)}/archive`, post()),
    restorePlan: async (id: string): Promise<AdvisoryPlanDetail> =>
      request(AdvisoryPlanDetail, `${plan(id)}/restore`, post()),
    versions: async (id: string): Promise<AdvisoryVersionList['items']> =>
      (await request(AdvisoryVersionList, `${plan(id)}/versions`)).items,
    version: async (id: string, version: number): Promise<AdvisoryVersionDetail> =>
      request(
        AdvisoryVersionDetail,
        `${plan(id)}/versions/${parseInput(AdvisoryVersionNumber, version)}`,
      ),

    // ----- Financial analysis -----
    financials: async (query: AdvisoryFinancialsQuery = {}): Promise<AdvisoryFinancialPage> =>
      request(
        AdvisoryFinancialPage,
        `${BASE}/financials${toQuery(parseInput(AdvisoryFinancialsQuery, query))}`,
      ),
    /** A snapshot of a period; a correction is a new row. 403 OVERRIDE_NOT_ALLOWED, 409 INCONSISTENT_FIGURES. */
    addFinancial: async (
      id: string,
      body: CreateAdvisoryFinancialRequest,
    ): Promise<AdvisoryFinancialRow> =>
      request(
        AdvisoryFinancialRow,
        `${advisoryClient(id)}/financials`,
        post(parseInput(CreateAdvisoryFinancialRequest, body)),
      ),

    // ----- Goals and milestones -----
    goals: async (query: AdvisoryGoalsQuery = {}): Promise<AdvisoryGoalPage> =>
      request(AdvisoryGoalPage, `${BASE}/goals${toQuery(parseInput(AdvisoryGoalsQuery, query))}`),
    createGoal: async (body: CreateAdvisoryGoalRequest): Promise<AdvisoryGoalDetail> =>
      request(
        AdvisoryGoalDetail,
        `${BASE}/goals`,
        post(parseInput(CreateAdvisoryGoalRequest, body)),
      ),
    goal: async (id: string): Promise<AdvisoryGoalDetail> => request(AdvisoryGoalDetail, goal(id)),
    updateGoal: async (id: string, body: UpdateAdvisoryGoalRequest): Promise<AdvisoryGoalDetail> =>
      request(AdvisoryGoalDetail, goal(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryGoalRequest, body),
      }),
    archiveGoal: async (id: string): Promise<AdvisoryGoalDetail> =>
      request(AdvisoryGoalDetail, `${goal(id)}/archive`, post()),
    restoreGoal: async (id: string): Promise<AdvisoryGoalDetail> =>
      request(AdvisoryGoalDetail, `${goal(id)}/restore`, post()),
    addMilestone: async (
      id: string,
      body: CreateAdvisoryMilestoneRequest,
    ): Promise<AdvisoryMilestone> =>
      request(
        AdvisoryMilestone,
        `${goal(id)}/milestones`,
        post(parseInput(CreateAdvisoryMilestoneRequest, body)),
      ),
    updateMilestone: async (
      id: string,
      body: UpdateAdvisoryMilestoneRequest,
    ): Promise<AdvisoryMilestone> =>
      request(AdvisoryMilestone, milestone(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryMilestoneRequest, body),
      }),
    reorderMilestones: async (
      id: string,
      body: ReorderAdvisoryMilestonesRequest,
    ): Promise<AdvisoryGoalDetail> =>
      request(AdvisoryGoalDetail, `${goal(id)}/milestones/order`, {
        method: 'PUT',
        body: parseInput(ReorderAdvisoryMilestonesRequest, body),
      }),

    // ----- Recommendations and action items -----
    recommendations: async (
      query: AdvisoryRecommendationsQuery = {},
    ): Promise<AdvisoryRecommendationPage> =>
      request(
        AdvisoryRecommendationPage,
        `${BASE}/recommendations${toQuery(parseInput(AdvisoryRecommendationsQuery, query))}`,
      ),
    createRecommendation: async (
      body: CreateAdvisoryRecommendationRequest,
    ): Promise<AdvisoryRecommendationRow> =>
      request(
        AdvisoryRecommendationRow,
        `${BASE}/recommendations`,
        post(parseInput(CreateAdvisoryRecommendationRequest, body)),
      ),
    updateRecommendation: async (
      id: string,
      body: UpdateAdvisoryRecommendationRequest,
    ): Promise<AdvisoryRecommendationRow> =>
      request(AdvisoryRecommendationRow, recommendation(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryRecommendationRequest, body),
      }),
    actionItems: async (query: AdvisoryActionItemsQuery = {}): Promise<AdvisoryActionItemPage> =>
      request(
        AdvisoryActionItemPage,
        `${BASE}/action-items${toQuery(parseInput(AdvisoryActionItemsQuery, query))}`,
      ),
    createActionItem: async (
      body: CreateAdvisoryActionItemRequest,
    ): Promise<AdvisoryActionItemRow> =>
      request(
        AdvisoryActionItemRow,
        `${BASE}/action-items`,
        post(parseInput(CreateAdvisoryActionItemRequest, body)),
      ),
    updateActionItem: async (
      id: string,
      body: UpdateAdvisoryActionItemRequest,
    ): Promise<AdvisoryActionItemRow> =>
      request(AdvisoryActionItemRow, actionItem(id), {
        method: 'PATCH',
        body: parseInput(UpdateAdvisoryActionItemRequest, body),
      }),

    // ----- Meetings, resources, settings -----
    /** The Reports tab: live counts, by status, services, workload; the financial trend with the permission. */
    reports: async (query: AdvisoryReportsQuery = {}): Promise<AdvisoryReports> =>
      request(
        AdvisoryReports,
        `${BASE}/reports${toQuery(parseInput(AdvisoryReportsQuery, query))}`,
      ),
    meetings: async (query: AdvisoryMeetingsQuery = {}): Promise<AdvisoryMeetingPage> =>
      request(
        AdvisoryMeetingPage,
        `${BASE}/meetings${toQuery(parseInput(AdvisoryMeetingsQuery, query))}`,
      ),
    resources: async (query: AdvisoryResourcesQuery = {}): Promise<AdvisoryResourceList['items']> =>
      (
        await request(
          AdvisoryResourceList,
          `${BASE}/resources${toQuery(parseInput(AdvisoryResourcesQuery, query))}`,
        )
      ).items,
    /** 409 RESOURCE_NOT_CLIENT_FACING. */
    sendResource: async (key: string, body: SendAdvisoryResourceRequest): Promise<OkResponse> =>
      request(
        OkResponse,
        `${BASE}/resources/${parseInput(AdvisoryResourceKey, key)}/send`,
        post(parseInput(SendAdvisoryResourceRequest, body)),
      ),
    settings: async (): Promise<AdvisorySettingsView> =>
      request(AdvisorySettingsView, `${BASE}/settings`),
    saveSettings: async (body: SaveAdvisorySettingsRequest): Promise<AdvisorySettingsView> =>
      request(AdvisorySettingsView, `${BASE}/settings`, {
        method: 'PUT',
        body: parseInput(SaveAdvisorySettingsRequest, body),
      }),
  };
}
export type AdvisoryClient = ReturnType<typeof createAdvisoryClient>;
