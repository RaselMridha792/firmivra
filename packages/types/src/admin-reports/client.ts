import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse, PlatformReportType } from '../schemas.js';
import {
  AdminFeatureUsageQuery,
  AdminFeatureUsageReport,
  AdminFirmReport,
  AdminFirmsReport,
  AdminFirmsReportQuery,
  AdminReportCatalog,
  AdminReportExportRequest,
  AdminReportFile,
  AdminReportRange,
  AdminReportResult,
  AdminReportRunRequest,
  AdminReportsOverview,
  AdminRevenueReport,
  AdminSavedReport,
  AdminSavedReportList,
  AdminSavedReportRunQuery,
  AdminSupportReport,
  AdminUsersReport,
  SaveAdminReportRequest,
  UpdateAdminReportRequest,
} from './schemas.js';

const BASE = '/admin/reports';
const id = (value: string) => parseInput(z.uuid(), value);
const range = (q: AdminReportRange) => toQuery(parseInput(AdminReportRange, q));
const post = (body: unknown = {}) => ({ method: 'POST', body });

/**
 * `api.adminReports` (apps/web/src/lib/api.ts): Super Admin Reports & Analytics (R55). A figure
 * with no source is null (show "Not available"), never zero. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createAdminReportsClient(request: ApiRequest) {
  return {
    overview: async (q: AdminReportRange = {}): Promise<AdminReportsOverview> =>
      request(AdminReportsOverview, `${BASE}/overview${range(q)}`),
    revenue: async (q: AdminReportRange = {}): Promise<AdminRevenueReport> =>
      request(AdminRevenueReport, `${BASE}/revenue${range(q)}`),
    users: async (q: AdminReportRange = {}): Promise<AdminUsersReport> =>
      request(AdminUsersReport, `${BASE}/users${range(q)}`),
    featureUsage: async (q: AdminFeatureUsageQuery = {}): Promise<AdminFeatureUsageReport> =>
      request(
        AdminFeatureUsageReport,
        `${BASE}/feature-usage${toQuery(parseInput(AdminFeatureUsageQuery, q))}`,
      ),
    support: async (q: AdminReportRange = {}): Promise<AdminSupportReport> =>
      request(AdminSupportReport, `${BASE}/support${range(q)}`),
    firms: async (q: AdminFirmsReportQuery = {}): Promise<AdminFirmsReport> =>
      request(AdminFirmsReport, `${BASE}/firms${toQuery(parseInput(AdminFirmsReportQuery, q))}`),
    firm: async (businessId: string, q: AdminReportRange = {}): Promise<AdminFirmReport> =>
      request(AdminFirmReport, `${BASE}/firms/${id(businessId)}${range(q)}`),

    // Custom Report Builder
    fields: async (type: PlatformReportType): Promise<AdminReportCatalog> =>
      request(
        AdminReportCatalog,
        `${BASE}/builder/fields${toQuery({ type: parseInput(PlatformReportType, type) })}`,
      ),
    run: async (body: AdminReportRunRequest): Promise<AdminReportResult> =>
      request(
        AdminReportResult,
        `${BASE}/builder/run`,
        post(parseInput(AdminReportRunRequest, body)),
      ),
    /** CSV in the answer (409 EXPORT_TOO_LARGE past ADMIN_REPORT_EXPORT_MAX rows). */
    export: async (body: AdminReportExportRequest): Promise<AdminReportFile> =>
      request(
        AdminReportFile,
        `${BASE}/builder/export`,
        post(parseInput(AdminReportExportRequest, body)),
      ),

    // Saved reports
    saved: async (): Promise<AdminSavedReportList> =>
      request(AdminSavedReportList, `${BASE}/saved`),
    save: async (body: SaveAdminReportRequest): Promise<AdminSavedReport> =>
      request(AdminSavedReport, `${BASE}/saved`, post(parseInput(SaveAdminReportRequest, body))),
    updateSaved: async (
      reportId: string,
      body: UpdateAdminReportRequest,
    ): Promise<AdminSavedReport> =>
      request(AdminSavedReport, `${BASE}/saved/${id(reportId)}`, {
        method: 'PATCH',
        body: parseInput(UpdateAdminReportRequest, body),
      }),
    deleteSaved: async (reportId: string): Promise<OkResponse> =>
      request(OkResponse, `${BASE}/saved/${id(reportId)}`, { method: 'DELETE' }),
    runSaved: async (
      reportId: string,
      q: AdminSavedReportRunQuery = {},
    ): Promise<AdminReportResult> =>
      request(
        AdminReportResult,
        `${BASE}/saved/${id(reportId)}/run${toQuery(parseInput(AdminSavedReportRunQuery, q))}`,
        post(),
      ),
    duplicateSaved: async (reportId: string): Promise<AdminSavedReport> =>
      request(AdminSavedReport, `${BASE}/saved/${id(reportId)}/duplicate`, post()),
  };
}
export type AdminReportsClient = ReturnType<typeof createAdminReportsClient>;
