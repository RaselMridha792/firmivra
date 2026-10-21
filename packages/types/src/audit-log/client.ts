import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { AuditLogPage, AuditLogQuery } from './schemas.js';

/**
 * `api.auditLog`: the firm's audit log, newest first, for the firm's Owner and Admins (403 for
 * Staff). `baseUrl` ('/api/v1' in the browser) prefixes the export download link.
 */
export function createAuditLogClient(request: ApiRequest, baseUrl = '') {
  return {
    /** One page; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: AuditLogQuery = {}): Promise<AuditLogPage> => {
      const q = parseInput(AuditLogQuery, query);
      return request(AuditLogPage, `/business/audit-log${toQuery(q)}`);
    },
    /**
     * Export: GET /business/audit-log/export, a CSV of every entry matching the same filters
     * (newest first, at most 10,000; paging is ignored). Owner and Admin; the export itself is
     * logged as `audit_log.exported` with the filter names and the count.
     */
    exportUrl: (query: AuditLogQuery = {}): string => {
      const { cursor: _cursor, limit: _limit, ...filters } = parseInput(AuditLogQuery, query);
      return `${baseUrl}/business/audit-log/export${toQuery(filters)}`;
    },
  };
}
export type AuditLogClient = ReturnType<typeof createAuditLogClient>;
