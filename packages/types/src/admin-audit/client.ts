import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  AdminAssignAlertRequest,
  AdminAuditEventDetail,
  AdminAuditEventId,
  AdminAuditEventPage,
  AdminAuditEventQuery,
  AdminAuditExport,
  AdminAuditExportRequest,
  AdminAuditFacets,
  AdminAuditNote,
  AdminAuditNoteId,
  AdminAuditNoteRequest,
  AdminAuditRespondRequest,
  AdminAuditRespondResult,
  AdminAuditSummary,
  AdminAuditSummaryQuery,
  AdminCloseAlertRequest,
  AdminResolveAlertRequest,
  AdminSecurityAlert,
  AdminSecurityAlertId,
  AdminSecurityAlertPage,
  AdminSecurityAlertQuery,
  AdminSecuritySettingsRecord,
  SaveAdminSecuritySettingsRequest,
} from './schemas.js';

const BASE = '/admin/audit';
const event = (id: string) => `${BASE}/events/${parseInput(AdminAuditEventId, id)}`;
const alert = (id: string) => `${BASE}/alerts/${parseInput(AdminSecurityAlertId, id)}`;
const note = (id: string) => `${BASE}/notes/${parseInput(AdminAuditNoteId, id)}`;
const post = (body: unknown = {}) => ({ method: 'POST', body });

/**
 * `api.adminAudit` (apps/web/src/lib/api.ts): Super Admin Audit & Security (R55). Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createAdminAuditClient(request: ApiRequest) {
  return {
    // The dashboard
    facets: async (): Promise<AdminAuditFacets> => request(AdminAuditFacets, `${BASE}/facets`),
    summary: async (query: AdminAuditSummaryQuery = {}): Promise<AdminAuditSummary> =>
      request(
        AdminAuditSummary,
        `${BASE}/summary${toQuery(parseInput(AdminAuditSummaryQuery, query))}`,
      ),
    events: async (query: AdminAuditEventQuery = {}): Promise<AdminAuditEventPage> =>
      request(
        AdminAuditEventPage,
        `${BASE}/events${toQuery(parseInput(AdminAuditEventQuery, query))}`,
      ),
    /** The filtered list as a file (at most ADMIN_AUDIT_EXPORT_MAX rows; 409 EXPORT_TOO_LARGE). */
    exportEvents: async (body: AdminAuditExportRequest): Promise<AdminAuditExport> =>
      request(AdminAuditExport, `${BASE}/exports`, post(parseInput(AdminAuditExportRequest, body))),

    // One event
    event: async (id: string): Promise<AdminAuditEventDetail> =>
      request(AdminAuditEventDetail, event(id)),
    /** A response action; 409 ACTION_UNAVAILABLE when `actions[]` says it is not available. */
    respond: async (id: string, body: AdminAuditRespondRequest): Promise<AdminAuditRespondResult> =>
      request(
        AdminAuditRespondResult,
        `${event(id)}/respond`,
        post(parseInput(AdminAuditRespondRequest, body)),
      ),
    addNote: async (id: string, body: AdminAuditNoteRequest): Promise<AdminAuditNote> =>
      request(AdminAuditNote, `${event(id)}/notes`, post(parseInput(AdminAuditNoteRequest, body))),
    /** A correction: a new note that supersedes yours (409 NOTE_STATE otherwise). */
    editNote: async (noteId: string, body: AdminAuditNoteRequest): Promise<AdminAuditNote> =>
      request(
        AdminAuditNote,
        `${note(noteId)}/edit`,
        post(parseInput(AdminAuditNoteRequest, body)),
      ),
    retractNote: async (noteId: string): Promise<AdminAuditNote> =>
      request(AdminAuditNote, `${note(noteId)}/retract`, post()),

    // Alerts
    alerts: async (query: AdminSecurityAlertQuery = {}): Promise<AdminSecurityAlertPage> =>
      request(
        AdminSecurityAlertPage,
        `${BASE}/alerts${toQuery(parseInput(AdminSecurityAlertQuery, query))}`,
      ),
    acknowledgeAlert: async (id: string): Promise<AdminSecurityAlert> =>
      request(AdminSecurityAlert, `${alert(id)}/acknowledge`, post()),
    resolveAlert: async (id: string, body: AdminResolveAlertRequest): Promise<AdminSecurityAlert> =>
      request(
        AdminSecurityAlert,
        `${alert(id)}/resolve`,
        post(parseInput(AdminResolveAlertRequest, body)),
      ),
    dismissAlert: async (
      id: string,
      body: AdminCloseAlertRequest = {},
    ): Promise<AdminSecurityAlert> =>
      request(
        AdminSecurityAlert,
        `${alert(id)}/dismiss`,
        post(parseInput(AdminCloseAlertRequest, body)),
      ),
    assignAlert: async (id: string, body: AdminAssignAlertRequest): Promise<AdminSecurityAlert> =>
      request(
        AdminSecurityAlert,
        `${alert(id)}/assign`,
        post(parseInput(AdminAssignAlertRequest, body)),
      ),

    // Security Settings
    settings: async (): Promise<AdminSecuritySettingsRecord> =>
      request(AdminSecuritySettingsRecord, `${BASE}/policy`),
    /** 409 SAVE_CONFLICT when someone saved first. */
    saveSettings: async (
      body: SaveAdminSecuritySettingsRequest,
    ): Promise<AdminSecuritySettingsRecord> =>
      request(AdminSecuritySettingsRecord, `${BASE}/policy`, {
        method: 'PUT',
        body: parseInput(SaveAdminSecuritySettingsRequest, body),
      }),
  };
}
export type AdminAuditClient = ReturnType<typeof createAdminAuditClient>;
