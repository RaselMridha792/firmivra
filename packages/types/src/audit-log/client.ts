import {
  type ApiDownload,
  type ApiFile,
  type ApiRequest,
  csvRecordCount,
  parseInput,
  toQuery,
} from '../client.js';
import { AuditLogPage, AuditLogQuery } from './schemas.js';

/** An export as the API sent it, with the number of entries it holds. */
export interface AuditLogExport extends ApiFile {
  entries: number;
}

/**
 * `api.auditLog`: the firm's audit log, newest first, for the firm's Owner and Admins (403 for
 * Staff). `download` fetches the export with the session (lib/api.ts passes createDownload).
 */
export function createAuditLogClient(request: ApiRequest, download: ApiDownload) {
  return {
    /** One page; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: AuditLogQuery = {}): Promise<AuditLogPage> => {
      const q = parseInput(AuditLogQuery, query);
      return request(AuditLogPage, `/business/audit-log${toQuery(q)}`);
    },
    /**
     * Export: GET /business/audit-log/export, a CSV of every entry matching the same filters
     * (newest first, at most 10,000; paging is ignored). Owner and Admin; the export itself is
     * logged as `audit_log.exported` with the filter names and the count. A refusal (an ended
     * session, 403, 500) is an ApiRequestError, never a file.
     */
    export: async (query: AuditLogQuery = {}): Promise<AuditLogExport> => {
      const { cursor: _cursor, limit: _limit, ...filters } = parseInput(AuditLogQuery, query);
      const file = await download(`/business/audit-log/export${toQuery(filters)}`, 'audit-log.csv');
      return { ...file, entries: csvRecordCount(file.text) };
    },
  };
}
export type AuditLogClient = ReturnType<typeof createAuditLogClient>;
