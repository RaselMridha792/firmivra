import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import { EngagementId } from '../engagements/schemas.js';
import { OkResponse } from '../schemas.js';
import {
  CreateReportRequest,
  ListWorkspacesQuery,
  MyReportList,
  MyReportsQuery,
  Report,
  ReportId,
  ReportList,
  ReportsQuery,
  UpdateReportRequest,
  Workspace,
  WorkspaceList,
} from './schemas.js';

const workspace = (id: string) => `/business/workspaces/${parseInput(EngagementId, id)}`;
const report = (id: string) => `/business/reports/${parseInput(ReportId, id)}`;

/**
 * `api.workspaces`: Bookkeeping and Tax Planning workspaces and their reports. Status and stage
 * change through `api.engagements`, tasks through `api.tasks`. Staff see their clients' only.
 */
export function createWorkspacesClient(request: ApiRequest) {
  return {
    list: async (query: ListWorkspacesQuery = {}): Promise<WorkspaceList> => {
      const q = parseInput(ListWorkspacesQuery, query);
      return request(WorkspaceList, `/business/workspaces${toQuery(q)}`);
    },
    get: async (engagementId: string): Promise<Workspace> =>
      request(Workspace, workspace(engagementId)),
    /** One page, newest first; pass `nextCursor` back as `cursor` for the next. */
    reports: async (engagementId: string, query: ReportsQuery = {}): Promise<ReportList> => {
      const path = `${workspace(engagementId)}/reports`;
      return request(ReportList, `${path}${toQuery(parseInput(ReportsQuery, query))}`);
    },
    createReport: async (engagementId: string, body: CreateReportRequest): Promise<Report> =>
      request(Report, `${workspace(engagementId)}/reports`, {
        method: 'POST',
        body: parseInput(CreateReportRequest, body),
      }),
    updateReport: async (id: string, body: UpdateReportRequest): Promise<Report> =>
      request(Report, report(id), { method: 'PATCH', body: parseInput(UpdateReportRequest, body) }),
    publishReport: async (id: string): Promise<Report> =>
      request(Report, `${report(id)}/publish`, { method: 'POST' }),
    unpublishReport: async (id: string): Promise<Report> =>
      request(Report, `${report(id)}/unpublish`, { method: 'POST' }),
    /** Drafts that were never published only; otherwise 409 REPORT_WAS_PUBLISHED. */
    deleteReport: async (id: string): Promise<OkResponse> =>
      request(OkResponse, report(id), { method: 'DELETE' }),
  };
}
export type WorkspacesClient = ReturnType<typeof createWorkspacesClient>;

/** `api.myReports(slug)`: the published reports of one of the signed-in client's services. */
export function createMyReportsClient(request: ApiRequest, firmSlug: string) {
  return {
    /** One page, newest first; pass `nextCursor` back as `cursor` for the next. */
    list: async (engagementId: string, query: MyReportsQuery = {}): Promise<MyReportList> => {
      const path = `${portalMe(firmSlug)}/services/${parseInput(EngagementId, engagementId)}/reports`;
      return request(MyReportList, `${path}${toQuery(parseInput(MyReportsQuery, query))}`);
    },
  };
}
export type MyReportsClient = ReturnType<typeof createMyReportsClient>;
