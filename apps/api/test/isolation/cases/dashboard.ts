// The firm dashboard (R30): GET /api/v1/business/dashboard/summary takes no record id in its path
// or body, so it needs no case: the suite's sweep covers it like every other list (firm Q naming
// firm P is 404; firm Q's summary names none of firm P's records, its tasks included).
// test/e2e/dashboard.e2e.test.ts checks that each firm's numbers are its own.
//
// D4, Settings > Dashboard Cards: a card names one of the firm's services (`serviceId`), and the
// order names the firm's cards (`ids`). test/e2e/dashboard-cards.e2e.test.ts checks firm B against
// firm A's cards and services.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** The firm's one service card: every tax return in progress (a default, saved). */
  dashboardCard: {
    async create({ tx, businessId, owner }) {
      const card = await tx.dashboardCardTemplate.create({
        data: {
          businessId,
          slot: 1,
          serviceId: null,
          metric: 'ENGAGEMENTS_IN_STATUS',
          statusKey: 'tax:IN_PROGRESS',
          label: 'Returns In Progress',
          createdByUserId: owner.id,
          updatedByUserId: owner.id,
        },
      });
      return card.id;
    },
  },
};

const PH = '00000000-0000-4000-8000-000000000000';
// The world's `service` is an annual tax service: a tax card names it.
const taxCard = {
  serviceId: PH,
  metric: 'ENGAGEMENTS_IN_STATUS',
  statusKey: 'tax:IN_PROGRESS',
  label: 'Personal Returns In Progress',
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/settings/dashboard-cards': {
    params: {},
    bodyIds: { serviceId: 'service' },
    body: taxCard,
  },
  'POST /api/v1/business/settings/dashboard-cards/preview': {
    params: {},
    bodyIds: { serviceId: 'service' },
    body: { serviceId: PH, metric: 'ENGAGEMENTS_IN_STATUS', statusKey: 'tax:IN_PROGRESS' },
  },
  'PUT /api/v1/business/settings/dashboard-cards/order': {
    params: {},
    bodyIds: { ids: 'dashboardCard' },
    body: { ids: [PH] },
  },
  // A version the card never had: the found card answers 409 STALE_VERSION, and nothing changes.
  'PATCH /api/v1/business/settings/dashboard-cards/:id': {
    params: { id: 'dashboardCard' },
    bodyIds: { serviceId: 'service' },
    body: { ...taxCard, enabled: true, version: 999 },
    expect: 409,
  },
};
