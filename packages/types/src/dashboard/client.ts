import type { ApiRequest } from '../client.js';
import { DashboardSummary } from './schemas.js';

/** `api.dashboard`: the firm dashboard's numbers (Owner, Admin and Staff). */
export function createDashboardClient(request: ApiRequest) {
  return {
    summary: async (): Promise<DashboardSummary> =>
      request(DashboardSummary, '/business/dashboard/summary'),
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
