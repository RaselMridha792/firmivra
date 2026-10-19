import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { DownloadLink } from '../documents/schemas.js';
import { OkResponse } from '../schemas.js';
import {
  CreateReportScheduleRequest,
  DuplicateSavedReportRequest,
  ExportReportRequest,
  RecentReportPage,
  RecentReportsQuery,
  ReportCatalog,
  ReportDataSourceList,
  ReportLookupList,
  ReportLookupQuery,
  ReportResult,
  ReportRunId,
  ReportRunStatusView,
  ReportScheduleDetail,
  ReportScheduleId,
  ReportSchedulePage,
  ReportSchedulesQuery,
  ReportSettingsView,
  ReportsDashboard,
  ReportsDashboardQuery,
  RunReportRequest,
  SaveReportRequest,
  SaveReportSettingsRequest,
  SavedReportDetail,
  SavedReportId,
  SavedReportPage,
  SavedReportsQuery,
  UpdateReportScheduleRequest,
  UpdateSavedReportRequest,
} from './schemas.js';

const BASE = '/business/reports';
const saved = (id: string) => `${BASE}/saved/${parseInput(SavedReportId, id)}`;
const schedule = (id: string) => `${BASE}/schedules/${parseInput(ReportScheduleId, id)}`;
const runPath = (id: string) => `${BASE}/runs/${parseInput(ReportRunId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.reports` (apps/web/src/lib/api.ts): the Reports module (contract in ./schemas.ts). Everyone
 * with the permission grid's REPORTS view reads and runs reports; saving, scheduling and
 * exporting need Create, Edit or Manage (403 FORBIDDEN). KPI cards, detail views, the builder's
 * preview and exports all go through `run` (or an export of the same request), so they reconcile.
 * Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. No
 * business id is ever sent. An export is a run to poll: `exportReport()`, then `runStatus()`
 * until `ready`, then `download()`.
 */
export function createReportsClient(request: ApiRequest) {
  return {
    // ----- Dashboard, catalog, builder data -----
    dashboard: async (query: ReportsDashboardQuery = {}): Promise<ReportsDashboard> =>
      request(ReportsDashboard, `${BASE}${toQuery(parseInput(ReportsDashboardQuery, query))}`),
    catalog: async (): Promise<ReportCatalog> => request(ReportCatalog, `${BASE}/catalog`),
    /** The builder's data sources and their fields (only what the caller may see). */
    sources: async (): Promise<ReportDataSourceList['items']> =>
      (await request(ReportDataSourceList, `${BASE}/sources`)).items,
    lookups: async (query: ReportLookupQuery): Promise<ReportLookupList['items']> =>
      (
        await request(
          ReportLookupList,
          `${BASE}/lookups${toQuery(parseInput(ReportLookupQuery, query))}`,
        )
      ).items,

    // ----- Run -----
    /** Run Report, Refresh Preview, and every change of a detail view's controls. */
    run: async (body: RunReportRequest): Promise<ReportResult> =>
      request(ReportResult, `${BASE}/run`, post(parseInput(RunReportRequest, body))),
    recent: async (query: RecentReportsQuery = {}): Promise<RecentReportPage> =>
      request(RecentReportPage, `${BASE}/recent${toQuery(parseInput(RecentReportsQuery, query))}`),

    // ----- Saved reports -----
    saved: async (query: SavedReportsQuery = {}): Promise<SavedReportPage> =>
      request(SavedReportPage, `${BASE}/saved${toQuery(parseInput(SavedReportsQuery, query))}`),
    /** 409 DUPLICATE_NAME. */
    save: async (body: SaveReportRequest): Promise<SavedReportDetail> =>
      request(SavedReportDetail, `${BASE}/saved`, post(parseInput(SaveReportRequest, body))),
    savedReport: async (id: string): Promise<SavedReportDetail> =>
      request(SavedReportDetail, saved(id)),
    /** 409 SAVE_CONFLICT, DUPLICATE_NAME, REPORT_ARCHIVED; 403 NOT_THE_OWNER. */
    updateSaved: async (id: string, body: UpdateSavedReportRequest): Promise<SavedReportDetail> =>
      request(SavedReportDetail, saved(id), {
        method: 'PATCH',
        body: parseInput(UpdateSavedReportRequest, body),
      }),
    /** Save As: a private copy. */
    duplicateSaved: async (
      id: string,
      body: DuplicateSavedReportRequest = {},
    ): Promise<SavedReportDetail> =>
      request(
        SavedReportDetail,
        `${saved(id)}/duplicate`,
        post(parseInput(DuplicateSavedReportRequest, body)),
      ),
    archiveSaved: async (id: string): Promise<SavedReportDetail> =>
      request(SavedReportDetail, `${saved(id)}/archive`, post()),
    restoreSaved: async (id: string): Promise<SavedReportDetail> =>
      request(SavedReportDetail, `${saved(id)}/restore`, post()),
    favorite: async (id: string): Promise<SavedReportDetail> =>
      request(SavedReportDetail, `${saved(id)}/favorite`, { method: 'PUT' }),
    unfavorite: async (id: string): Promise<SavedReportDetail> =>
      request(SavedReportDetail, `${saved(id)}/favorite`, { method: 'DELETE' }),

    // ----- Export -----
    /** 403 EXPORT_NOT_ALLOWED. Answers a run: poll `runStatus`, then `download`. */
    exportReport: async (body: ExportReportRequest): Promise<ReportRunStatusView> =>
      request(ReportRunStatusView, `${BASE}/exports`, post(parseInput(ExportReportRequest, body))),
    runStatus: async (runId: string): Promise<ReportRunStatusView> =>
      request(ReportRunStatusView, runPath(runId)),
    /** A 5-minute link; 409 RUN_NOT_READY until the file is made. */
    download: async (runId: string): Promise<DownloadLink> =>
      request(DownloadLink, `${runPath(runId)}/download`),

    // ----- Schedules -----
    schedules: async (query: ReportSchedulesQuery = {}): Promise<ReportSchedulePage> =>
      request(
        ReportSchedulePage,
        `${BASE}/schedules${toQuery(parseInput(ReportSchedulesQuery, query))}`,
      ),
    createSchedule: async (body: CreateReportScheduleRequest): Promise<ReportScheduleDetail> =>
      request(
        ReportScheduleDetail,
        `${BASE}/schedules`,
        post(parseInput(CreateReportScheduleRequest, body)),
      ),
    schedule: async (id: string): Promise<ReportScheduleDetail> =>
      request(ReportScheduleDetail, schedule(id)),
    updateSchedule: async (
      id: string,
      body: UpdateReportScheduleRequest,
    ): Promise<ReportScheduleDetail> =>
      request(ReportScheduleDetail, schedule(id), {
        method: 'PATCH',
        body: parseInput(UpdateReportScheduleRequest, body),
      }),
    pauseSchedule: async (id: string): Promise<ReportScheduleDetail> =>
      request(ReportScheduleDetail, `${schedule(id)}/pause`, post()),
    resumeSchedule: async (id: string): Promise<ReportScheduleDetail> =>
      request(ReportScheduleDetail, `${schedule(id)}/resume`, post()),
    duplicateSchedule: async (id: string): Promise<ReportScheduleDetail> =>
      request(ReportScheduleDetail, `${schedule(id)}/duplicate`, post()),
    /** Run Now: a new snapshot with the current definition and data. */
    runScheduleNow: async (id: string): Promise<ReportRunStatusView> =>
      request(ReportRunStatusView, `${schedule(id)}/run-now`, post()),
    /** Delete Schedule: stops future runs; earlier runs and history stay. */
    deleteSchedule: async (id: string): Promise<OkResponse> =>
      request(OkResponse, schedule(id), { method: 'DELETE' }),

    // ----- Metric settings -----
    settings: async (): Promise<ReportSettingsView> =>
      request(ReportSettingsView, `${BASE}/settings`),
    saveSettings: async (body: SaveReportSettingsRequest): Promise<ReportSettingsView> =>
      request(ReportSettingsView, `${BASE}/settings`, {
        method: 'PUT',
        body: parseInput(SaveReportSettingsRequest, body),
      }),
  };
}
export type ReportsClient = ReturnType<typeof createReportsClient>;
