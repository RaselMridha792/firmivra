import {
  ApiRequestError,
  CreateFirmBillingRequest,
  type FirmBillingClient,
  type FirmBillingInvoice,
  type FirmBillingOverview,
  type FirmBillingPlanChoice,
  type FirmBillingRequest,
  FirmBillingInvoicesQuery,
  parseInput,
  SUBSCRIPTION_CYCLE_LABELS,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.firmBilling` (Settings > Billing & Subscriptions). Synthetic data only.
 * STAFF gets 403 FORBIDDEN, like the API; requests follow the API's rules (a blocked or current
 * plan is 409 PLAN_NOT_AVAILABLE; the same `requestId` answers the first request). `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=firmBilling) is a firm with no subscription and no invoices.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';

const plan = (
  code: string,
  name: string,
  priceCents: number,
  includedSeats: number,
  includedLocations: number,
  extra: Partial<FirmBillingPlanChoice>,
): FirmBillingPlanChoice => ({
  code,
  name,
  priceCents,
  billingCycle: 'MONTHLY',
  includedSeats,
  maxSeats: null,
  seatPriceCents: 1_500,
  includedLocations,
  locationPriceCents: 2_500,
  features: [
    { key: 'portal', label: 'Client portal' },
    { key: 'esign', label: 'Firm Sign' },
  ],
  direction: 'UPGRADE',
  blockers: [],
  ...extra,
});

/** The ladder, built on first use. */
const plans = (): FirmBillingPlanChoice[] => [
  plan('SOLO_CORE', 'Solo Core', 4_900, 2, 1, {
    maxSeats: 2,
    seatPriceCents: null,
    direction: 'DOWNGRADE',
    blockers: ['8 active staff users; Solo Core allows 2'],
  }),
  plan('TEAM_PRO', 'Team Pro', 9_900, 10, 2, { direction: 'CURRENT' }),
  plan('PRACTICE_PLUS', 'Practice Plus', 19_900, 20, 3, {}),
];

const invoice = (n: number, day: string): FirmBillingInvoice => ({
  id: `0199c0e0-0e00-7000-8000-${String(n).padStart(12, '0')}`,
  number: `INV-${n}`,
  invoiceDate: day,
  dueDate: day,
  periodStart: day,
  periodEnd: day,
  totalCents: 9_900,
  balanceCents: 0,
  currency: 'usd',
  status: 'PAID',
  billTo: { name: 'Sample Billing Contact', email: 'billing@lvp.test' },
  lines: [
    { description: 'Team Pro (Monthly)', quantity: 1, unitPriceCents: 9_900, amountCents: 9_900 },
  ],
  subtotalCents: 9_900,
  discountCents: 0,
  taxCents: 0,
  paidCents: 9_900,
  creditedCents: 0,
  refundedCents: 0,
  notes: null,
  payments: [{ paidOn: day, amountCents: 9_900, method: 'CARD', status: 'COMPLETED' }],
});

/** Three paid monthly invoices, built on first use. */
const invoices = () => [
  invoice(1026, '2026-10-18'),
  invoice(1025, '2026-09-18'),
  invoice(1024, '2026-08-18'),
];

function overview(empty: boolean): FirmBillingOverview {
  return {
    subscription: empty
      ? null
      : {
          status: 'ACTIVE',
          plan: plans()[1]!,
          billingCycle: 'MONTHLY',
          priceCents: 9_900,
          currency: 'usd',
          seatsAllowed: 10,
          locationsAllowed: 2,
          periodStart: '2026-10-18',
          periodEnd: '2026-11-17',
          nextBillingOn: '2026-11-18',
          trialEndsOn: null,
          accessEndsOn: null,
          autoRenew: true,
        },
    usage: {
      seats: { used: 8, allowed: empty ? null : 10 },
      locations: { used: 1, allowed: empty ? null : 2 },
      pendingInvitations: 1,
      measuredAt: '2026-10-24T09:00:00.000Z',
    },
    billingDetails: {
      companyName: 'LVP Accounting & Taxes',
      legalName: 'Sample Legal Name LLC',
      contactName: empty ? null : 'Sample Billing Contact',
      contactEmail: empty ? null : 'billing@lvp.test',
      address: ['100 Sample Road', 'Springfield, GA 30000', 'United States'],
      paymentTermDays: empty ? null : 30,
    },
    lastPayment: empty
      ? null
      : { method: 'CARD', amountCents: 9_900, paidOn: '2026-10-18', invoiceNumber: 'INV-1026' },
    plans: empty ? plans().map((p) => ({ ...p, direction: 'UPGRADE' as const })) : plans(),
    requests: [],
  };
}

export function createFirmBillingMock(
  options: { role?: MockRole; empty?: boolean } = {},
): FirmBillingClient {
  const empty = options.empty ?? false;
  const requests: FirmBillingRequest[] = [];
  const keys = new Map<string, string>();
  let next = 1011;
  const allowed = async () => {
    await mockDelay();
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const issued = empty ? [] : invoices();
  return {
    overview: async () => {
      await allowed();
      return { ...overview(empty), requests: requests.slice(0, 10) };
    },
    invoices: async (query = {}) => {
      const q = parseInput(FirmBillingInvoicesQuery, query);
      await allowed();
      const rows = q.range === '3M' ? issued.slice(0, 2) : issued;
      const start = (q.page - 1) * q.pageSize;
      return {
        items: rows
          .slice(start, start + q.pageSize)
          .map(({ billTo: _b, lines: _l, payments: _p, ...row }) => ({
            ...row,
          })),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    invoice: async (id) => {
      await allowed();
      const found = issued.find((i) => i.id === id);
      if (!found) throw new ApiRequestError(404, 'NOT_FOUND', 'That invoice was not found');
      return found;
    },
    invoicePdfUrl: (id) => `/api/v1/business/billing/invoices/${id}/pdf`,
    request: async (input) => {
      const body = parseInput(CreateFirmBillingRequest, input);
      await allowed();
      const known = requests.find((r) => r.id === keys.get(body.requestId));
      if (known) return known;
      let summary = 'Billing contact change';
      if (body.kind === 'PLAN_CHANGE') {
        if (empty)
          throw new ApiRequestError(409, 'NO_SUBSCRIPTION', 'No subscription is connected yet.');
        const target = plans().find((p) => p.code === body.planCode);
        if (!target || target.blockers.length || target.direction === 'CURRENT')
          throw new ApiRequestError(
            409,
            'PLAN_NOT_AVAILABLE',
            'That plan is not available. Choose another one.',
            undefined,
            undefined,
            (target?.blockers ?? []).map((message) => ({ path: 'planCode', message })),
          );
        summary = `Plan change: Team Pro to ${target.name} (${SUBSCRIPTION_CYCLE_LABELS[body.billingCycle]})`;
      }
      const made: FirmBillingRequest = {
        id: `0199c0e0-0f00-7000-8000-${String(next).padStart(12, '0')}`,
        number: `#${next++}`,
        kind: body.kind,
        summary,
        status: 'OPEN',
        submittedAt: new Date().toISOString(),
        submittedBy: 'Sam Sample',
        latestReply: null,
      };
      keys.set(body.requestId, made.id);
      requests.unshift(made);
      return made;
    },
  };
}
