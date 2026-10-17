import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AddBookkeepingAccountRequest,
  AddBookkeepingClientRequest,
  AddBookkeepingReportRequest,
  BookkeepingAccount,
  BookkeepingAccountId,
  BookkeepingAccountList,
  BookkeepingActivity,
  BookkeepingActivityList,
  BookkeepingAssignRequest,
  BookkeepingClientId,
  BookkeepingClientPage,
  BookkeepingClientsQuery,
  BookkeepingClientWorkspace,
  BookkeepingCloseItemId,
  BookkeepingConnection,
  BookkeepingConnectionId,
  BookkeepingConnectionList,
  BookkeepingListQuery,
  BookkeepingOverview,
  BookkeepingOverviewQuery,
  BookkeepingPauseRequest,
  BookkeepingPeriod,
  BookkeepingPeriodId,
  BookkeepingPeriodList,
  BookkeepingPeriodsQuery,
  BookkeepingReasonRequest,
  BookkeepingReconciliation,
  BookkeepingReconciliationId,
  BookkeepingReconciliationList,
  BookkeepingReopenRequest,
  BookkeepingReportId,
  BookkeepingReportPage,
  BookkeepingReportRow,
  BookkeepingReportsQuery,
  BookkeepingSendBackRequest,
  BookkeepingSettings,
  BookkeepingStatusRefreshed,
  BookkeepingStatusRequest,
  BookkeepingSyncQueued,
  BookkeepingSyncRunList,
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
} from './schemas.js';

const BASE = '/business/bookkeeping';
const client = (id: string) => `${BASE}/clients/${parseInput(BookkeepingClientId, id)}`;
const connection = (id: string) => `${BASE}/connections/${parseInput(BookkeepingConnectionId, id)}`;
const account = (id: string) => `${BASE}/accounts/${parseInput(BookkeepingAccountId, id)}`;
const period = (id: string) => `${BASE}/periods/${parseInput(BookkeepingPeriodId, id)}`;
const recon = (id: string) =>
  `${BASE}/reconciliations/${parseInput(BookkeepingReconciliationId, id)}`;
const report = (id: string) => `${BASE}/reports/${parseInput(BookkeepingReportId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.bookkeeping`: the firm's bookkeeping work. STAFF+ prepares; Owner and Admin add clients,
 * change cadence, assignment and reviewer, pause, archive, edit settings, approve and reopen
 * reconciliations, approve, close and reopen periods and approve and deliver reports (403
 * FORBIDDEN). Staff reach only the bookkeeping clients whose client is assigned to them (404
 * NOT_FOUND). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is
 * sent. The CSV exports (`GET /business/bookkeeping/clients/export` and
 * `GET /business/bookkeeping/reports/export`) are downloads: open them as a link, not through here.
 * Tasks, notes, documents and document requests are the shared modules', listed by the
 * workspace's `engagementId`.
 */
export function createBookkeepingClient(request: ApiRequest) {
  return {
    overview: async (query: BookkeepingOverviewQuery = {}): Promise<BookkeepingOverview> =>
      request(
        BookkeepingOverview,
        `${BASE}/overview${toQuery(parseInput(BookkeepingOverviewQuery, query))}`,
      ),
    settings: async (): Promise<BookkeepingSettings> =>
      request(BookkeepingSettings, `${BASE}/settings`),
    saveSettings: async (body: SaveBookkeepingSettingsRequest): Promise<BookkeepingSettings> =>
      request(BookkeepingSettings, `${BASE}/settings`, {
        method: 'PUT',
        body: parseInput(SaveBookkeepingSettingsRequest, body),
      }),

    // Clients
    clients: async (query: BookkeepingClientsQuery = {}): Promise<BookkeepingClientPage> =>
      request(
        BookkeepingClientPage,
        `${BASE}/clients${toQuery(parseInput(BookkeepingClientsQuery, query))}`,
      ),
    addClient: async (body: AddBookkeepingClientRequest): Promise<BookkeepingClientWorkspace> =>
      request(
        BookkeepingClientWorkspace,
        `${BASE}/clients`,
        post(parseInput(AddBookkeepingClientRequest, body)),
      ),
    /** Sync All Clients: asks every connected client's provider for a sync. */
    syncAll: async (): Promise<BookkeepingSyncQueued> =>
      request(BookkeepingSyncQueued, `${BASE}/clients/sync`, post({})),
    /** Re-works the status of every client whose status the rules set (Owner and Admin). */
    refreshStatuses: async (): Promise<BookkeepingStatusRefreshed> =>
      request(BookkeepingStatusRefreshed, `${BASE}/clients/refresh-status`, post({})),
    getClient: async (id: string): Promise<BookkeepingClientWorkspace> =>
      request(BookkeepingClientWorkspace, client(id)),
    updateClient: async (
      id: string,
      body: UpdateBookkeepingClientRequest,
    ): Promise<BookkeepingClientWorkspace> =>
      request(BookkeepingClientWorkspace, client(id), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingClientRequest, body),
      }),
    setStatus: async (
      id: string,
      body: BookkeepingStatusRequest,
    ): Promise<BookkeepingClientWorkspace> =>
      request(
        BookkeepingClientWorkspace,
        `${client(id)}/status`,
        post(parseInput(BookkeepingStatusRequest, body)),
      ),
    pause: async (id: string, body: BookkeepingPauseRequest): Promise<BookkeepingClientWorkspace> =>
      request(
        BookkeepingClientWorkspace,
        `${client(id)}/pause`,
        post(parseInput(BookkeepingPauseRequest, body)),
      ),
    resume: async (id: string): Promise<BookkeepingClientWorkspace> =>
      request(BookkeepingClientWorkspace, `${client(id)}/resume`, post({})),
    archive: async (
      id: string,
      body: BookkeepingReasonRequest = {},
    ): Promise<BookkeepingClientWorkspace> =>
      request(
        BookkeepingClientWorkspace,
        `${client(id)}/archive`,
        post(parseInput(BookkeepingReasonRequest, body)),
      ),
    assign: async (
      id: string,
      body: BookkeepingAssignRequest,
    ): Promise<BookkeepingClientWorkspace> =>
      request(
        BookkeepingClientWorkspace,
        `${client(id)}/assign`,
        post(parseInput(BookkeepingAssignRequest, body)),
      ),
    sync: async (id: string): Promise<BookkeepingSyncQueued> =>
      request(BookkeepingSyncQueued, `${client(id)}/sync`, post({})),
    activities: async (
      id: string,
      query: BookkeepingListQuery = {},
    ): Promise<BookkeepingActivityList> =>
      request(
        BookkeepingActivityList,
        `${client(id)}/activities${toQuery(parseInput(BookkeepingListQuery, query))}`,
      ),
    logActivity: async (
      id: string,
      body: LogBookkeepingActivityRequest,
    ): Promise<BookkeepingActivity> =>
      request(
        BookkeepingActivity,
        `${client(id)}/activities`,
        post(parseInput(LogBookkeepingActivityRequest, body)),
      ),

    // Connections
    connections: async (id: string): Promise<BookkeepingConnectionList> =>
      request(BookkeepingConnectionList, `${client(id)}/connections`),
    connect: async (id: string, body: ConnectBookkeepingRequest): Promise<BookkeepingConnection> =>
      request(
        BookkeepingConnection,
        `${client(id)}/connections`,
        post(parseInput(ConnectBookkeepingRequest, body)),
      ),
    updateConnection: async (
      connectionId: string,
      body: UpdateBookkeepingConnectionRequest,
    ): Promise<BookkeepingConnection> =>
      request(BookkeepingConnection, connection(connectionId), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingConnectionRequest, body),
      }),
    disconnect: async (connectionId: string): Promise<BookkeepingConnection> =>
      request(BookkeepingConnection, `${connection(connectionId)}/disconnect`, post({})),
    reconnect: async (connectionId: string): Promise<BookkeepingConnection> =>
      request(BookkeepingConnection, `${connection(connectionId)}/reconnect`, post({})),
    syncRuns: async (
      connectionId: string,
      query: BookkeepingListQuery = {},
    ): Promise<BookkeepingSyncRunList> =>
      request(
        BookkeepingSyncRunList,
        `${connection(connectionId)}/syncs${toQuery(parseInput(BookkeepingListQuery, query))}`,
      ),

    // Accounts
    accounts: async (id: string): Promise<BookkeepingAccountList> =>
      request(BookkeepingAccountList, `${client(id)}/accounts`),
    addAccount: async (
      id: string,
      body: AddBookkeepingAccountRequest,
    ): Promise<BookkeepingAccount> =>
      request(
        BookkeepingAccount,
        `${client(id)}/accounts`,
        post(parseInput(AddBookkeepingAccountRequest, body)),
      ),
    updateAccount: async (
      accountId: string,
      body: UpdateBookkeepingAccountRequest,
    ): Promise<BookkeepingAccount> =>
      request(BookkeepingAccount, account(accountId), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingAccountRequest, body),
      }),

    // Periods and the close
    periods: async (
      id: string,
      query: BookkeepingPeriodsQuery = {},
    ): Promise<BookkeepingPeriodList> =>
      request(
        BookkeepingPeriodList,
        `${client(id)}/periods${toQuery(parseInput(BookkeepingPeriodsQuery, query))}`,
      ),
    createPeriod: async (
      id: string,
      body: CreateBookkeepingPeriodRequest,
    ): Promise<BookkeepingPeriod> =>
      request(
        BookkeepingPeriod,
        `${client(id)}/periods`,
        post(parseInput(CreateBookkeepingPeriodRequest, body)),
      ),
    getPeriod: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, period(periodId)),
    updatePeriod: async (
      periodId: string,
      body: UpdateBookkeepingPeriodRequest,
    ): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, period(periodId), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingPeriodRequest, body),
      }),
    startPeriod: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, `${period(periodId)}/start`, post({})),
    markPeriodReady: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, `${period(periodId)}/ready`, post({})),
    sendPeriodBack: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, `${period(periodId)}/send-back`, post({})),
    approvePeriod: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, `${period(periodId)}/approve`, post({})),
    closePeriod: async (periodId: string): Promise<BookkeepingPeriod> =>
      request(BookkeepingPeriod, `${period(periodId)}/close`, post({})),
    reopenPeriod: async (
      periodId: string,
      body: BookkeepingReopenRequest,
    ): Promise<BookkeepingPeriod> =>
      request(
        BookkeepingPeriod,
        `${period(periodId)}/reopen`,
        post(parseInput(BookkeepingReopenRequest, body)),
      ),
    updateCloseItem: async (
      periodId: string,
      itemId: string,
      body: UpdateBookkeepingCloseItemRequest,
    ): Promise<BookkeepingPeriod> =>
      request(
        BookkeepingPeriod,
        `${period(periodId)}/close-items/${parseInput(BookkeepingCloseItemId, itemId)}`,
        { method: 'PATCH', body: parseInput(UpdateBookkeepingCloseItemRequest, body) },
      ),

    // Reconciliations
    reconciliations: async (periodId: string): Promise<BookkeepingReconciliationList> =>
      request(BookkeepingReconciliationList, `${period(periodId)}/reconciliations`),
    createReconciliation: async (
      periodId: string,
      body: CreateBookkeepingReconciliationRequest,
    ): Promise<BookkeepingReconciliation> =>
      request(
        BookkeepingReconciliation,
        `${period(periodId)}/reconciliations`,
        post(parseInput(CreateBookkeepingReconciliationRequest, body)),
      ),
    getReconciliation: async (id: string): Promise<BookkeepingReconciliation> =>
      request(BookkeepingReconciliation, recon(id)),
    saveReconciliation: async (
      id: string,
      body: UpdateBookkeepingReconciliationRequest,
    ): Promise<BookkeepingReconciliation> =>
      request(BookkeepingReconciliation, recon(id), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingReconciliationRequest, body),
      }),
    markReconciliationReady: async (id: string): Promise<BookkeepingReconciliation> =>
      request(BookkeepingReconciliation, `${recon(id)}/ready`, post({})),
    approveReconciliation: async (id: string): Promise<BookkeepingReconciliation> =>
      request(BookkeepingReconciliation, `${recon(id)}/approve`, post({})),
    reopenReconciliation: async (
      id: string,
      body: BookkeepingReopenRequest,
    ): Promise<BookkeepingReconciliation> =>
      request(
        BookkeepingReconciliation,
        `${recon(id)}/reopen`,
        post(parseInput(BookkeepingReopenRequest, body)),
      ),

    // Reports
    reports: async (query: BookkeepingReportsQuery = {}): Promise<BookkeepingReportPage> =>
      request(
        BookkeepingReportPage,
        `${BASE}/reports${toQuery(parseInput(BookkeepingReportsQuery, query))}`,
      ),
    clientReports: async (
      id: string,
      query: BookkeepingReportsQuery = {},
    ): Promise<BookkeepingReportPage> =>
      request(
        BookkeepingReportPage,
        `${client(id)}/reports${toQuery(parseInput(BookkeepingReportsQuery, query))}`,
      ),
    addReport: async (
      id: string,
      body: AddBookkeepingReportRequest,
    ): Promise<BookkeepingReportRow> =>
      request(
        BookkeepingReportRow,
        `${client(id)}/reports`,
        post(parseInput(AddBookkeepingReportRequest, body)),
      ),
    getReport: async (reportId: string): Promise<BookkeepingReportRow> =>
      request(BookkeepingReportRow, report(reportId)),
    updateReport: async (
      reportId: string,
      body: UpdateBookkeepingReportRequest,
    ): Promise<BookkeepingReportRow> =>
      request(BookkeepingReportRow, report(reportId), {
        method: 'PATCH',
        body: parseInput(UpdateBookkeepingReportRequest, body),
      }),
    startReport: async (reportId: string): Promise<BookkeepingReportRow> =>
      request(BookkeepingReportRow, `${report(reportId)}/start`, post({})),
    submitReport: async (reportId: string): Promise<BookkeepingReportRow> =>
      request(BookkeepingReportRow, `${report(reportId)}/submit-review`, post({})),
    sendReportBack: async (
      reportId: string,
      body: BookkeepingSendBackRequest = {},
    ): Promise<BookkeepingReportRow> =>
      request(
        BookkeepingReportRow,
        `${report(reportId)}/send-back`,
        post(parseInput(BookkeepingSendBackRequest, body)),
      ),
    approveReport: async (reportId: string): Promise<BookkeepingReportRow> =>
      request(BookkeepingReportRow, `${report(reportId)}/approve`, post({})),
    deliverReport: async (
      reportId: string,
      body: DeliverBookkeepingReportRequest,
    ): Promise<BookkeepingReportRow> =>
      request(
        BookkeepingReportRow,
        `${report(reportId)}/deliver`,
        post(parseInput(DeliverBookkeepingReportRequest, body)),
      ),
  };
}
export type BookkeepingClient = ReturnType<typeof createBookkeepingClient>;
