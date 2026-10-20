import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { DashboardSummary, DashboardSummaryQuery } from './schemas.js';

/**
 * `api.dashboard`: the firm dashboard's numbers (Owner, Admin and Staff). The query picks the
 * Client Pipeline period and the revenue year (the design's This Month and This Year selectors).
 */
export function createDashboardClient(request: ApiRequest) {
  return {
    summary: async (query: DashboardSummaryQuery = {}): Promise<DashboardSummary> =>
      request(
        DashboardSummary,
        `/business/dashboard/summary${toQuery(parseInput(DashboardSummaryQuery, query))}`,
      ),
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
