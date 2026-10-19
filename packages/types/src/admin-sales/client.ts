import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AssignSalesOpportunityRequest,
  CreateSalesFollowUpRequest,
  CreateSalesOpportunityRequest,
  CreateSalesPipelineRequest,
  CreateSalesTargetRequest,
  LinkSalesTransactionRequest,
  LogSalesActivityRequest,
  MoveSalesStageRequest,
  SalesAttentionSettings,
  SalesBulkRequest,
  SalesBulkResult,
  SalesCenterSummary,
  SalesDuplicateCheckRequest,
  SalesDuplicateList,
  type SalesDuplicateMatch,
  type SalesFeedEntry,
  SalesFeedList,
  SalesFeedQuery,
  SalesFollowUp,
  SalesFollowUpId,
  SalesFollowUpList,
  SalesLeadSources,
  type SalesLinkableSubscription,
  SalesMeta,
  SalesNote,
  SalesNoteId,
  SalesOk,
  SalesOpportunitiesQuery,
  SalesOpportunity,
  SalesOpportunityId,
  SalesOpportunityPage,
  SalesOpportunityRecord,
  SalesPeriodQuery,
  SalesPipeline,
  SalesPipelineId,
  SalesPipelineList,
  SalesPipelineSummary,
  type SalesPlan,
  SalesPlanList,
  SalesRevenueByPlan,
  SalesStageCounts,
  SalesSubscriptionList,
  SalesSubscriptionsQuery,
  SalesSummaryQuery,
  SalesTag,
  SalesTagId,
  SalesTarget,
  SalesTargetId,
  SalesTargetList,
  SalesTargetsQuery,
  SalesUpcomingQuery,
  SaveSalesAttentionSettingsRequest,
  SaveSalesNoteRequest,
  SaveSalesPipelineRequest,
  SaveSalesTagRequest,
  UpdateSalesFollowUpRequest,
  UpdateSalesOpportunityRequest,
  UpdateSalesTargetRequest,
} from './schemas.js';

const BASE = '/admin/sales';
const opportunity = (id: string) => `${BASE}/opportunities/${parseInput(SalesOpportunityId, id)}`;
const followUp = (id: string) => `${BASE}/follow-ups/${parseInput(SalesFollowUpId, id)}`;
const pipeline = (id: string) => `${BASE}/pipelines/${parseInput(SalesPipelineId, id)}`;
const target = (id: string) => `${BASE}/targets/${parseInput(SalesTargetId, id)}`;
const tag = (id: string) => `${BASE}/tags/${parseInput(SalesTagId, id)}`;
const note = (noteId: string) => `${BASE}/notes/${parseInput(SalesNoteId, noteId)}`;
const send = (method: string, body: unknown) => ({ method, body });

/** The list and KPI filters as a query string: several values in one parameter, comma separated. */
function opportunitiesQuery(query: SalesOpportunitiesQuery): string {
  const q = parseInput(SalesOpportunitiesQuery, query);
  return toQuery({ ...q, stageIds: q.stageIds?.join(',') });
}
function summaryQuery(query: SalesSummaryQuery): string {
  const q = parseInput(SalesSummaryQuery, query);
  return toQuery({ ...q, stageIds: q.stageIds?.join(',') });
}
const periodQuery = (query: SalesPeriodQuery) => toQuery(parseInput(SalesPeriodQuery, query));

/**
 * The Export Sales Report download (CSV of the records created in the period: firm, contact,
 * email, stage, owner, source, plan, value, created; cells that would run as a spreadsheet
 * formula are quoted). It is a download: open `${baseUrl}${adminSalesReportPath(query)}` as a
 * link, not through the client. 403 FORBIDDEN without the export permission.
 */
export function adminSalesReportPath(query: SalesPeriodQuery = {}): string {
  return `${BASE}/report${periodQuery(query)}`;
}

/**
 * `api.adminSales` (apps/web/src/lib/api.ts): Super Admin Sales (Sales Center, Sales Pipeline,
 * the opportunity record and the pipeline builder). 401 without the Super Admin site's session,
 * 403 for anyone who is not on the Super Admin team, and 403 FORBIDDEN for an action the member's
 * sales permissions do not allow (`meta().permissions`) or a record outside their record scope.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 * Screens show this module's errors with `errorMessage(error, SALES_ERRORS)`; the stage's
 * required fields come back as their own codes (VALUE_REQUIRED, OWNER_REQUIRED, PLAN_REQUIRED,
 * TRANSACTION_REQUIRED, LOST_REASON_REQUIRED, LOST_NOTE_REQUIRED), so a form can put each next
 * to its field.
 *
 * Status changes of a linked transaction come from Billing (platform scope), never from here.
 * Lead imports (D1) have no screen yet and are not in this client.
 */
export function createAdminSalesClient(request: ApiRequest) {
  return {
    /** The pickers, today, the attention settings and the member's rights. */
    meta: async (): Promise<SalesMeta> => request(SalesMeta, `${BASE}/meta`),
    /** The firm plans, in display order. */
    plans: async (): Promise<SalesPlan[]> => (await request(SalesPlanList, `${BASE}/plans`)).items,

    // The Sales Center
    /** The six numbers for a period, each against the period before. */
    centerKpis: async (query: SalesPeriodQuery = {}): Promise<SalesCenterSummary> =>
      request(SalesCenterSummary, `${BASE}/center${periodQuery(query)}`),
    /** Records per stage open in the period, and lost reasons (default pipeline unless given). */
    stageCounts: async (query: SalesPeriodQuery = {}): Promise<SalesStageCounts> =>
      request(SalesStageCounts, `${BASE}/analytics/stages${periodQuery(query)}`),
    revenueByPlan: async (query: SalesPeriodQuery = {}): Promise<SalesRevenueByPlan> =>
      request(SalesRevenueByPlan, `${BASE}/analytics/revenue-by-plan${periodQuery(query)}`),
    leadSources: async (query: SalesPeriodQuery = {}): Promise<SalesLeadSources> =>
      request(SalesLeadSources, `${BASE}/analytics/lead-sources${periodQuery(query)}`),
    /** Recent Activity, newest first; `kinds: SALES_CENTER_FEED_KINDS` for the Sales Center's. */
    activity: async (query: SalesFeedQuery = {}): Promise<SalesFeedEntry[]> => {
      const q = parseInput(SalesFeedQuery, query);
      return (
        await request(
          SalesFeedList,
          `${BASE}/activity${toQuery({ ...q, kinds: q.kinds?.join(',') })}`,
        )
      ).items;
    },
    /** Scheduled follow-ups and appointments from now on, soonest first. */
    appointments: async (query: SalesUpcomingQuery = {}): Promise<SalesFollowUp[]> => {
      const q = parseInput(SalesUpcomingQuery, query);
      return (
        await request(
          SalesFollowUpList,
          `${BASE}/follow-ups${toQuery({ ...q, kinds: q.kinds?.join(',') })}`,
        )
      ).items;
    },

    // The pipeline: board, list and KPIs
    /** The board and the list read the same records with the same filters. */
    opportunities: async (query: SalesOpportunitiesQuery = {}): Promise<SalesOpportunityPage> =>
      request(SalesOpportunityPage, `${BASE}/opportunities${opportunitiesQuery(query)}`),
    /** The KPI row, for the same filters. */
    pipelineKpis: async (query: SalesSummaryQuery = {}): Promise<SalesPipelineSummary> =>
      request(SalesPipelineSummary, `${BASE}/summary${summaryQuery(query)}`),
    /** The record page: the record, its pipeline, notes, follow-ups, communications and history. */
    opportunity: async (id: string): Promise<SalesOpportunityRecord> =>
      request(SalesOpportunityRecord, opportunity(id)),
    /** Probable duplicates of a person or firm (at most five). */
    duplicates: async (body: SalesDuplicateCheckRequest): Promise<SalesDuplicateMatch[]> =>
      (
        await request(
          SalesDuplicateList,
          `${BASE}/opportunities/duplicate-check`,
          send('POST', parseInput(SalesDuplicateCheckRequest, body)),
        )
      ).items,
    /** 409 POSSIBLE_DUPLICATE. A retried submit (same `requestId`) answers the record it made. */
    createOpportunity: async (body: CreateSalesOpportunityRequest): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        `${BASE}/opportunities`,
        send('POST', parseInput(CreateSalesOpportunityRequest, body)),
      ),
    updateOpportunity: async (
      id: string,
      body: UpdateSalesOpportunityRequest,
    ): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        opportunity(id),
        send('PATCH', parseInput(UpdateSalesOpportunityRequest, body)),
      ),
    moveStage: async (id: string, body: MoveSalesStageRequest): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        `${opportunity(id)}/stage`,
        send('POST', parseInput(MoveSalesStageRequest, body)),
      ),
    assign: async (id: string, body: AssignSalesOpportunityRequest): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        `${opportunity(id)}/assign`,
        send('POST', parseInput(AssignSalesOpportunityRequest, body)),
      ),
    /** Assign, move or tag several records at once: all or nothing. */
    bulk: async (body: SalesBulkRequest): Promise<SalesBulkResult> =>
      request(
        SalesBulkResult,
        `${BASE}/opportunities/bulk`,
        send('POST', parseInput(SalesBulkRequest, body)),
      ),
    /** Link the firm's platform subscription, or unlink it (`subscriptionId: null`). */
    linkTransaction: async (
      id: string,
      body: LinkSalesTransactionRequest,
    ): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        `${opportunity(id)}/transaction`,
        send('POST', parseInput(LinkSalesTransactionRequest, body)),
      ),
    /** The transaction picker. */
    subscriptions: async (
      query: SalesSubscriptionsQuery = {},
    ): Promise<SalesLinkableSubscription[]> =>
      (
        await request(
          SalesSubscriptionList,
          `${BASE}/subscriptions${toQuery(parseInput(SalesSubscriptionsQuery, query))}`,
        )
      ).items,
    /** Log Outreach (a call, email, text or meeting); answers the record with its new counts. */
    logOutreach: async (id: string, body: LogSalesActivityRequest): Promise<SalesOpportunity> =>
      request(
        SalesOpportunity,
        `${opportunity(id)}/activities`,
        send('POST', parseInput(LogSalesActivityRequest, body)),
      ),
    addNote: async (id: string, body: SaveSalesNoteRequest): Promise<SalesNote> =>
      request(
        SalesNote,
        `${opportunity(id)}/notes`,
        send('POST', parseInput(SaveSalesNoteRequest, body)),
      ),
    /** The author only (403 NOT_AUTHOR). */
    updateNote: async (noteId: string, body: SaveSalesNoteRequest): Promise<SalesNote> =>
      request(SalesNote, note(noteId), send('PATCH', parseInput(SaveSalesNoteRequest, body))),
    /** The author only (403 NOT_AUTHOR). */
    deleteNote: async (noteId: string): Promise<SalesOk> =>
      request(SalesOk, note(noteId), { method: 'DELETE' }),
    /** A follow-up or an appointment on the record. */
    addFollowUp: async (id: string, body: CreateSalesFollowUpRequest): Promise<SalesFollowUp> =>
      request(
        SalesFollowUp,
        `${opportunity(id)}/follow-ups`,
        send('POST', parseInput(CreateSalesFollowUpRequest, body)),
      ),
    /** Edit or reschedule while scheduled (409 FOLLOW_UP_CLOSED). */
    updateFollowUp: async (
      followUpId: string,
      body: UpdateSalesFollowUpRequest,
    ): Promise<SalesFollowUp> =>
      request(
        SalesFollowUp,
        followUp(followUpId),
        send('PATCH', parseInput(UpdateSalesFollowUpRequest, body)),
      ),
    completeFollowUp: async (followUpId: string): Promise<SalesFollowUp> =>
      request(SalesFollowUp, `${followUp(followUpId)}/complete`, send('POST', {})),
    /** Follow-ups are cancelled, never deleted. */
    cancelFollowUp: async (followUpId: string): Promise<SalesFollowUp> =>
      request(SalesFollowUp, `${followUp(followUpId)}/cancel`, send('POST', {})),

    // The pipeline builder
    pipelines: async (): Promise<SalesPipeline[]> =>
      (await request(SalesPipelineList, `${BASE}/pipelines`)).items,
    /** 409 DUPLICATE_NAME. */
    createPipeline: async (body: CreateSalesPipelineRequest): Promise<SalesPipeline> =>
      request(
        SalesPipeline,
        `${BASE}/pipelines`,
        send('POST', parseInput(CreateSalesPipelineRequest, body)),
      ),
    /** The whole layout in one step; 409 CONFLICT when it changed since `expectedUpdatedAt`. */
    savePipeline: async (id: string, body: SaveSalesPipelineRequest): Promise<SalesPipeline> =>
      request(SalesPipeline, pipeline(id), send('PUT', parseInput(SaveSalesPipelineRequest, body))),

    // Settings
    /** Creates a tag, or changes the one with `id`; 409 DUPLICATE_NAME. */
    saveTag: async (body: SaveSalesTagRequest & { id?: string }): Promise<SalesTag> => {
      const { id, ...fields } = body;
      const input = parseInput(SaveSalesTagRequest, fields);
      return id === undefined
        ? request(SalesTag, `${BASE}/tags`, send('POST', input))
        : request(SalesTag, tag(id), send('PATCH', input));
    },
    /** Removes the tag from every record. */
    deleteTag: async (id: string): Promise<SalesOk> =>
      request(SalesOk, tag(id), { method: 'DELETE' }),
    attentionSettings: async (): Promise<SalesAttentionSettings> =>
      request(SalesAttentionSettings, `${BASE}/attention-settings`),
    saveAttentionSettings: async (
      body: SaveSalesAttentionSettingsRequest,
    ): Promise<SalesAttentionSettings> =>
      request(
        SalesAttentionSettings,
        `${BASE}/attention-settings`,
        send('PUT', parseInput(SaveSalesAttentionSettingsRequest, body)),
      ),

    // Targets (D1)
    /** Live targets with their attainment, counted from the records. */
    targets: async (query: SalesTargetsQuery = {}): Promise<SalesTarget[]> =>
      (
        await request(
          SalesTargetList,
          `${BASE}/targets${toQuery(parseInput(SalesTargetsQuery, query))}`,
        )
      ).items,
    /** 409 TARGET_EXISTS; 422 TEAM_INACTIVE. */
    createTarget: async (body: CreateSalesTargetRequest): Promise<SalesTarget> =>
      request(
        SalesTarget,
        `${BASE}/targets`,
        send('POST', parseInput(CreateSalesTargetRequest, body)),
      ),
    /** 409 TARGET_ARCHIVED; 422 INVALID_TARGET_VALUE. */
    updateTarget: async (id: string, body: UpdateSalesTargetRequest): Promise<SalesTarget> =>
      request(SalesTarget, target(id), send('PATCH', parseInput(UpdateSalesTargetRequest, body))),
    /** Once and final (targets are archived, never deleted). */
    archiveTarget: async (id: string): Promise<SalesTarget> =>
      request(SalesTarget, `${target(id)}/archive`, send('POST', {})),
  };
}

export type AdminSalesClient = ReturnType<typeof createAdminSalesClient>;
