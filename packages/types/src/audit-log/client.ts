import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { AuditLogPage, AuditLogQuery } from './schemas.js';

/** `api.auditLog`: the firm's audit log, newest first, for the firm's Owner and Admins (403 for Staff). */
export function createAuditLogClient(request: ApiRequest) {
  return {
    /** One page; pass `nextCursor` back as `cursor` for the next. */
    list: async (query: AuditLogQuery = {}): Promise<AuditLogPage> => {
      const q = parseInput(AuditLogQuery, query);
      return request(AuditLogPage, `/business/audit-log${toQuery(q)}`);
    },
  };
}
export type AuditLogClient = ReturnType<typeof createAuditLogClient>;
