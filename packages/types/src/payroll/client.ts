import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddPayrollClientRequest,
  AddPayrollReportRequest,
  CompletePayrollRunRequest,
  CreatePayrollRunRequest,
  CreatePayrollWorkerRequest,
  LogPayrollActivityRequest,
  PayrollActivity,
  PayrollActivityList,
  PayrollAssignRequest,
  PayrollChangeList,
  PayrollClientId,
  PayrollClientPage,
  PayrollClientsQuery,
  PayrollClientWorkspace,
  PayrollFilingList,
  PayrollFilingsQuery,
  PayrollFrequencyRequest,
  PayrollIssueId,
  PayrollIssueList,
  PayrollIssuesQuery,
  PayrollLineList,
  PayrollLinesQuery,
  PayrollListQuery,
  PayrollOverview,
  PayrollOverviewQuery,
  PayrollPlanRequest,
  PayrollReasonRequest,
  PayrollRemoveServiceRequest,
  PayrollReport,
  PayrollReportList,
  PayrollReportsQuery,
  PayrollRun,
  PayrollRunId,
  PayrollRunPage,
  PayrollRunsQuery,
  PayrollSettings,
  PayrollStatusRequest,
  PayrollSyncQueued,
  PayrollWorker,
  PayrollWorkerId,
  PayrollWorkerList,
  PayrollWorkersQuery,
  PayrollYearEnd,
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
  PayrollIssue,
} from './schemas.js';

const BASE = '/business/payroll';
const client = (id: string) => `${BASE}/clients/${parseInput(PayrollClientId, id)}`;
const run = (id: string) => `${BASE}/runs/${parseInput(PayrollRunId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.payroll`: the firm's payroll tracking. STAFF+ prepares; Owner and Admin add clients,
 * change plan, frequency and assignment, pause, archive, approve, submit, reopen and edit
 * settings (403 FORBIDDEN). Staff reach only the payroll clients whose client is assigned to them
 * (404 NOT_FOUND). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent. CSV exports (`GET /business/payroll/clients/export` and
 * `GET /business/payroll/runs/{id}/export`) are downloads: open them as a link, not through here.
 */
export function createPayrollClient(request: ApiRequest) {
  return {
    overview: async (query: PayrollOverviewQuery = {}): Promise<PayrollOverview> =>
      request(
        PayrollOverview,
        `${BASE}/overview${toQuery(parseInput(PayrollOverviewQuery, query))}`,
      ),

    // Clients
    clients: async (query: PayrollClientsQuery = {}): Promise<PayrollClientPage> =>
      request(
        PayrollClientPage,
        `${BASE}/clients${toQuery(parseInput(PayrollClientsQuery, query))}`,
      ),
    addClient: async (body: AddPayrollClientRequest): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${BASE}/clients`,
        post(parseInput(AddPayrollClientRequest, body)),
      ),
    getClient: async (id: string): Promise<PayrollClientWorkspace> =>
      request(PayrollClientWorkspace, client(id)),
    updateClient: async (
      id: string,
      body: UpdatePayrollClientRequest,
    ): Promise<PayrollClientWorkspace> =>
      request(PayrollClientWorkspace, client(id), {
        method: 'PATCH',
        body: parseInput(UpdatePayrollClientRequest, body),
      }),
    setStatus: async (id: string, body: PayrollStatusRequest): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/status`,
        post(parseInput(PayrollStatusRequest, body)),
      ),
    pause: async (id: string, body: PayrollReasonRequest = {}): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/pause`,
        post(parseInput(PayrollReasonRequest, body)),
      ),
    resume: async (id: string): Promise<PayrollClientWorkspace> =>
      request(PayrollClientWorkspace, `${client(id)}/resume`, post({})),
    archive: async (id: string, body: PayrollReasonRequest = {}): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/archive`,
        post(parseInput(PayrollReasonRequest, body)),
      ),
    removeService: async (
      id: string,
      body: PayrollRemoveServiceRequest,
    ): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/remove-service`,
        post(parseInput(PayrollRemoveServiceRequest, body)),
      ),
    assign: async (id: string, body: PayrollAssignRequest): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/assign`,
        post(parseInput(PayrollAssignRequest, body)),
      ),
    setFrequency: async (
      id: string,
      body: PayrollFrequencyRequest,
    ): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/frequency`,
        post(parseInput(PayrollFrequencyRequest, body)),
      ),
    setPlan: async (id: string, body: PayrollPlanRequest): Promise<PayrollClientWorkspace> =>
      request(
        PayrollClientWorkspace,
        `${client(id)}/plan`,
        post(parseInput(PayrollPlanRequest, body)),
      ),
    changes: async (id: string, query: PayrollListQuery = {}): Promise<PayrollChangeList> =>
      request(
        PayrollChangeList,
        `${client(id)}/changes${toQuery(parseInput(PayrollListQuery, query))}`,
      ),
    sync: async (id: string): Promise<PayrollSyncQueued> =>
      request(PayrollSyncQueued, `${client(id)}/sync`, post({})),

    // Activities
    activities: async (id: string, query: PayrollListQuery = {}): Promise<PayrollActivityList> =>
      request(
        PayrollActivityList,
        `${client(id)}/activities${toQuery(parseInput(PayrollListQuery, query))}`,
      ),
    logActivity: async (id: string, body: LogPayrollActivityRequest): Promise<PayrollActivity> =>
      request(
        PayrollActivity,
        `${client(id)}/activities`,
        post(parseInput(LogPayrollActivityRequest, body)),
      ),

    // Workers
    workers: async (id: string, query: PayrollWorkersQuery = {}): Promise<PayrollWorkerList> =>
      request(
        PayrollWorkerList,
        `${client(id)}/workers${toQuery(parseInput(PayrollWorkersQuery, query))}`,
      ),
    addWorker: async (id: string, body: CreatePayrollWorkerRequest): Promise<PayrollWorker> =>
      request(
        PayrollWorker,
        `${client(id)}/workers`,
        post(parseInput(CreatePayrollWorkerRequest, body)),
      ),
    updateWorker: async (
      id: string,
      workerId: string,
      body: UpdatePayrollWorkerRequest,
    ): Promise<PayrollWorker> =>
      request(PayrollWorker, `${client(id)}/workers/${parseInput(PayrollWorkerId, workerId)}`, {
        method: 'PATCH',
        body: parseInput(UpdatePayrollWorkerRequest, body),
      }),

    // Runs
    runs: async (query: PayrollRunsQuery = {}): Promise<PayrollRunPage> =>
      request(PayrollRunPage, `${BASE}/runs${toQuery(parseInput(PayrollRunsQuery, query))}`),
    clientRuns: async (id: string, query: PayrollListQuery = {}): Promise<PayrollRunPage> =>
      request(PayrollRunPage, `${client(id)}/runs${toQuery(parseInput(PayrollListQuery, query))}`),
    createRun: async (id: string, body: CreatePayrollRunRequest): Promise<PayrollRun> =>
      request(PayrollRun, `${client(id)}/runs`, post(parseInput(CreatePayrollRunRequest, body))),
    getRun: async (id: string): Promise<PayrollRun> => request(PayrollRun, run(id)),
    updateRun: async (id: string, body: UpdatePayrollRunRequest): Promise<PayrollRun> =>
      request(PayrollRun, run(id), {
        method: 'PATCH',
        body: parseInput(UpdatePayrollRunRequest, body),
      }),
    runLines: async (id: string, query: PayrollLinesQuery = {}): Promise<PayrollLineList> =>
      request(PayrollLineList, `${run(id)}/lines${toQuery(parseInput(PayrollLinesQuery, query))}`),
    saveRunLines: async (id: string, body: SavePayrollLinesRequest): Promise<PayrollLineList> =>
      request(PayrollLineList, `${run(id)}/lines`, {
        method: 'PUT',
        body: parseInput(SavePayrollLinesRequest, body),
      }),
    runIssues: async (id: string, query: PayrollIssuesQuery = {}): Promise<PayrollIssueList> =>
      request(
        PayrollIssueList,
        `${run(id)}/issues${toQuery(parseInput(PayrollIssuesQuery, query))}`,
      ),
    checkRun: async (id: string): Promise<PayrollIssueList> =>
      request(PayrollIssueList, `${run(id)}/issues/check`, post({})),
    resolveIssue: async (
      id: string,
      issueId: string,
      body: ResolvePayrollIssueRequest,
    ): Promise<PayrollIssue> =>
      request(PayrollIssue, `${run(id)}/issues/${parseInput(PayrollIssueId, issueId)}`, {
        method: 'PATCH',
        body: parseInput(ResolvePayrollIssueRequest, body),
      }),
    saveDraft: async (id: string): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/save-draft`, post({})),
    markReady: async (id: string): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/ready`, post({})),
    approve: async (id: string): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/approve`, post({})),
    submit: async (id: string, body: SubmitPayrollRunRequest): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/submit`, post(parseInput(SubmitPayrollRunRequest, body))),
    complete: async (id: string, body: CompletePayrollRunRequest = {}): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/complete`, post(parseInput(CompletePayrollRunRequest, body))),
    reopen: async (id: string, body: ReopenPayrollRunRequest): Promise<PayrollRun> =>
      request(PayrollRun, `${run(id)}/reopen`, post(parseInput(ReopenPayrollRunRequest, body))),

    // Filings, reports, year-end
    filings: async (id: string, query: PayrollFilingsQuery = {}): Promise<PayrollFilingList> =>
      request(
        PayrollFilingList,
        `${client(id)}/filings${toQuery(parseInput(PayrollFilingsQuery, query))}`,
      ),
    reports: async (id: string, query: PayrollReportsQuery = {}): Promise<PayrollReportList> =>
      request(
        PayrollReportList,
        `${client(id)}/reports${toQuery(parseInput(PayrollReportsQuery, query))}`,
      ),
    addReport: async (id: string, body: AddPayrollReportRequest): Promise<PayrollReport> =>
      request(
        PayrollReport,
        `${client(id)}/reports`,
        post(parseInput(AddPayrollReportRequest, body)),
      ),
    yearEnd: async (id: string, query: PayrollYearEndQuery = {}): Promise<PayrollYearEnd> =>
      request(
        PayrollYearEnd,
        `${client(id)}/year-end${toQuery(parseInput(PayrollYearEndQuery, query))}`,
      ),
    saveYearEnd: async (
      id: string,
      taxYear: number,
      body: SavePayrollYearEndRequest,
    ): Promise<PayrollYearEnd> =>
      request(PayrollYearEnd, `${client(id)}/year-end/${Math.trunc(taxYear)}`, {
        method: 'PUT',
        body: parseInput(SavePayrollYearEndRequest, body),
      }),

    // Settings
    settings: async (): Promise<PayrollSettings> => request(PayrollSettings, `${BASE}/settings`),
    saveSettings: async (body: SavePayrollSettingsRequest): Promise<PayrollSettings> =>
      request(PayrollSettings, `${BASE}/settings`, {
        method: 'PUT',
        body: parseInput(SavePayrollSettingsRequest, body),
      }),
  };
}
export type PayrollClient = ReturnType<typeof createPayrollClient>;
