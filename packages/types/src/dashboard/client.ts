import { type ApiRequest, parseInput, toQuery } from '../client.js';
import {
  CreateDashboardCardRequest,
  DashboardCardId,
  DashboardCardPreview,
  DashboardCardSettings,
  DashboardCardTemplate,
  OrderDashboardCardsRequest,
  PreviewDashboardCardRequest,
  UpdateDashboardCardRequest,
} from './cards.js';
import { DashboardSummary, DashboardSummaryQuery } from './schemas.js';

const CARDS = '/business/settings/dashboard-cards';
const card = (id: string) => `${CARDS}/${parseInput(DashboardCardId, id)}`;

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
    /** D4: Settings > Dashboard Cards (Owner and Admin). */
    cards: {
      list: async (): Promise<DashboardCardSettings> => request(DashboardCardSettings, CARDS),
      create: async (body: CreateDashboardCardRequest): Promise<DashboardCardTemplate> =>
        request(DashboardCardTemplate, CARDS, {
          method: 'POST',
          body: parseInput(CreateDashboardCardRequest, body),
        }),
      update: async (
        id: string,
        body: UpdateDashboardCardRequest,
      ): Promise<DashboardCardTemplate> =>
        request(DashboardCardTemplate, card(id), {
          method: 'PATCH',
          body: parseInput(UpdateDashboardCardRequest, body),
        }),
      order: async (body: OrderDashboardCardsRequest): Promise<DashboardCardSettings> =>
        request(DashboardCardSettings, `${CARDS}/order`, {
          method: 'PUT',
          body: parseInput(OrderDashboardCardsRequest, body),
        }),
      preview: async (body: PreviewDashboardCardRequest): Promise<DashboardCardPreview> =>
        request(DashboardCardPreview, `${CARDS}/preview`, {
          method: 'POST',
          body: parseInput(PreviewDashboardCardRequest, body),
        }),
    },
  };
}

export type DashboardClient = ReturnType<typeof createDashboardClient>;
