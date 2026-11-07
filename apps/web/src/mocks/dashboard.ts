import {
  ApiRequestError,
  bucketsOf,
  CreateDashboardCardRequest,
  DASHBOARD_CARD_PROBLEMS,
  DASHBOARD_CARD_SLOTS,
  type DashboardCardLink,
  type DashboardCardService,
  type DashboardCardStatusKey,
  type DashboardCardTemplate,
  type DashboardClient,
  type DashboardRange,
  type DashboardServiceCard,
  type DashboardSummary,
  DashboardSummaryQuery,
  DEFAULT_DASHBOARD_CARDS,
  dashboardCardProblem,
  OrderDashboardCardsRequest,
  parseInput,
  PreviewDashboardCardRequest,
  rangeOf,
  revenueRangeOf,
  shapeOf,
  UpdateDashboardCardRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

const ME = { userId: '0199b6a0-0000-7000-8000-0000000000f0', name: 'Mock User' };

/** D4: the firm's services a card may name (synthetic). */
function servicesOf(): DashboardCardService[] {
  const id = (n: number) => `0199b6a3-0000-7000-8000-00000000000${n}`;
  return [
    { id: id(1), name: 'Personal Tax Prep', kind: 'ANNUAL_TAX' },
    { id: id(2), name: 'Business Tax Prep', kind: 'ANNUAL_TAX' },
    { id: id(3), name: 'Bookkeeping', kind: 'BOOKKEEPING' },
    { id: id(4), name: 'Payroll', kind: 'PAYROLL' },
    { id: id(5), name: 'Tax Planning & Strategy', kind: 'TAX_PLANNING' },
  ];
}

type CardFields = Pick<DashboardCardTemplate, 'metric' | 'statusKey'> & {
  serviceId: string | null;
};

/** The list a card opens, as the API builds it. */
function linkOf(card: CardFields, range: DashboardRange): DashboardCardLink {
  const key = card.statusKey;
  if (key?.startsWith('tax:')) {
    const query: Record<string, string> =
      key === 'tax:IN_PROGRESS'
        ? { workflowGroup: 'IN_PROGRESS' }
        : { workflowStatus: key.slice('tax:'.length) };
    if (card.metric === 'COMPLETED_IN_PERIOD')
      Object.assign(query, { acceptedFrom: range.from, acceptedTo: range.to });
    if (card.serviceId) query['serviceId'] = card.serviceId;
    return { list: 'tax-returns', query };
  }
  const query: Record<string, string> = {
    serviceId: card.serviceId ?? '',
    engagementStatus: key ? key.slice('engagement:'.length) : 'ACTIVE',
  };
  if (card.metric === 'COMPLETED_IN_PERIOD')
    Object.assign(query, { completedFrom: range.from, completedTo: range.to });
  return { list: 'clients', query };
}

/** A made-up but steady count for a card (the mock has no records behind it). */
function countOf(card: CardFields): { value: number; previous: number } {
  const seed = `${card.serviceId ?? 'all'}|${card.metric}|${card.statusKey ?? ''}`;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return { value: 3 + (h % 40), previous: 3 + ((h * 7) % 40) };
}

/** The mock's saved cards: none at first, so the dashboard shows the defaults (D5). */
let saved: DashboardCardTemplate[] | undefined;
const cardsOf = () => (saved ??= []);

/**
 * Mock data for `api.dashboard` (R30): every widget filled. Synthetic data only. The numbers are
 * the firm's as a whole; the real API gives Staff those of their assigned clients. Built on
 * first use, around today.
 */
function build(query: DashboardSummaryQuery = {}): DashboardSummary {
  const q = parseInput(DashboardSummaryQuery, query);
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = Number(today.slice(0, 4));
  const custom = (from?: string, to?: string) => (from && to ? { from, to } : undefined);
  const range = rangeOf(q.period, today, custom(q.from, q.to));
  const pipeline = rangeOf(q.pipelinePeriod, today, custom(q.pipelineFrom, q.pipelineTo));
  const revenueRange = revenueRangeOf(q.revenuePeriod, today, {
    year: q.revenueYear,
    custom: custom(q.revenueFrom, q.revenueTo),
  });
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const client = (n: number, displayName: string) => ({
    id: `0199b6a1-0000-7000-8000-00000000000${n}`,
    displayName,
  });
  const service = (n: number, name: string, cents: number) => ({
    serviceId: `0199b6a3-0000-7000-8000-00000000000${n}`,
    name,
    cents,
  });
  // Money on every bar up to today, nothing after it (a year's months to come are zero).
  const pattern = [8, 14, 22, 30, 11, 18, 6, 12, 9, 15, 10, 7];
  const daily =
    shapeOf(q.revenuePeriod) === 'days' ||
    revenueRange.to.slice(0, 7) === revenueRange.from.slice(0, 7);
  const buckets = bucketsOf(revenueRange.from, revenueRange.to, shapeOf(q.revenuePeriod)).map(
    (b, i) => ({
      ...b,
      cents: b.from > today ? 0 : (pattern[i % pattern.length] ?? 0) * (daily ? 4_000 : 100_000),
    }),
  );
  const totalCents = buckets.reduce((sum, b) => sum + b.cents, 0);
  // Flow cards scale with the period's length; Today shows a first acceptance (New) and no leads.
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  // This Month keeps the design's numbers.
  const scale = (n: number) =>
    q.period === 'THIS_MONTH' ? n : Math.max(0, Math.round((n * days) / 30));
  const flows =
    q.period === 'TODAY'
      ? { newLeads: { value: 0, previous: 0 }, acceptedReturns: { value: 3, previous: 0 } }
      : {
          newLeads: { value: scale(24), previous: scale(17) },
          acceptedReturns: { value: scale(52), previous: scale(41) },
        };

  const pipelineDays = (Date.parse(pipeline.to) - Date.parse(pipeline.from)) / 86_400_000 + 1;
  const services = servicesOf();
  const mine = cardsOf();
  const serviceCards: DashboardServiceCard[] =
    mine.length === 0
      ? DEFAULT_DASHBOARD_CARDS.map((d) => ({
          ...d,
          service: null,
          ...(d.statusKey === 'tax:ACCEPTED' ? flows.acceptedReturns : { value: 38, previous: 38 }),
          link: linkOf({ ...d, serviceId: null }, range),
        }))
      : mine
          .filter((c) => c.enabled)
          .map((c) => ({
            slot: c.slot,
            label: c.label,
            metric: c.metric,
            statusKey: c.statusKey,
            service: services.find((s) => s.id === c.service?.id) ?? null,
            ...countOf({ ...c, serviceId: c.service?.id ?? null }),
            link: linkOf({ ...c, serviceId: c.service?.id ?? null }, range),
          }));
  return {
    today,
    range,
    kpis: {
      totalClients: { value: 127, previous: 113 },
      newLeads: flows.newLeads,
      returnsInProgress: { value: 38, previous: 38 },
      acceptedReturns: flows.acceptedReturns,
      outstandingInvoicesCents: { value: 1_856_000, previous: null },
      appointmentsToday: { value: 6, previous: null },
    },
    serviceCards,
    pipeline: {
      leads: 24,
      consultation: null,
      intake: 15,
      inProgress: 38,
      completed: pipeline.period === 'THIS_MONTH' ? 52 : Math.round((52 * pipelineDays) / 30),
      period: pipeline.period,
      from: pipeline.from,
      to: pipeline.to,
    },
    revenue: {
      period: q.revenuePeriod,
      from: revenueRange.from,
      to: revenueRange.to,
      totalCents,
      previousCents: totalCents > 0 ? Math.round(totalCents / 1.27) : null,
      buckets,
      byService: [
        service(1, 'Personal Tax Prep', Math.round(totalCents * 0.42)),
        service(2, 'Business Tax Prep', Math.round(totalCents * 0.24)),
        service(3, 'Bookkeeping', Math.round(totalCents * 0.14)),
        service(4, 'Payroll', Math.round(totalCents * 0.08)),
        service(5, 'Tax Planning & Strategy', Math.round(totalCents * 0.07)),
        { serviceId: null, name: null, cents: Math.round(totalCents * 0.05) },
      ],
    },
    tasksDue: [
      {
        id: '0199b6a4-0000-7000-8000-000000000001',
        title: 'Review missing docs',
        priority: 'HIGH',
        dueOn: day(0),
        client: client(1, 'Jamie Sample'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000002',
        title: 'Send organizer to new lead',
        priority: 'MEDIUM',
        dueOn: day(0),
        client: client(3, 'Riley Example'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000003',
        title: 'Complete 1120S draft',
        priority: 'HIGH',
        dueOn: day(1),
        client: client(2, 'Morgan Placeholder'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000004',
        title: 'Follow up on payment',
        priority: 'MEDIUM',
        dueOn: day(1),
        client: client(4, 'Taylor Demo'),
      },
      {
        id: '0199b6a4-0000-7000-8000-000000000005',
        title: 'Review bookkeeping Q3',
        priority: 'LOW',
        dueOn: day(3),
        client: client(5, 'Casey Fixture'),
      },
    ],
    // The real API sends null until the firm's settings hold a season (R0's columns); the mock
    // shows one so the date card can be built.
    taxSeason: { start: `${thisYear + 1}-01-15`, end: `${thisYear + 1}-05-15`, inSeason: false },
  };
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/** As the API checks a card: one of the firm's services, and choices that fit together. */
function checked(body: CardFields & { label?: string }) {
  const service = body.serviceId ? servicesOf().find((s) => s.id === body.serviceId) : null;
  if (body.serviceId && !service) throw fail(404, 'NOT_FOUND', "We couldn't find that service");
  const problem = dashboardCardProblem({
    serviceKind: service?.kind ?? null,
    metric: body.metric,
    statusKey: body.statusKey as DashboardCardStatusKey | null,
    label: body.label ?? (body.statusKey?.startsWith('tax:') ? 'Returns' : 'Clients'),
  });
  if (problem) throw fail(400, problem, DASHBOARD_CARD_PROBLEMS[problem]);
  return service ?? null;
}

export function createDashboardMock(): DashboardClient {
  const settings = () => ({
    items: cardsOf().map((c) => ({ ...c })),
    usingDefaults: cardsOf().length === 0,
    services: servicesOf(),
  });
  return {
    summary: async (query = {}) => (await mockDelay(), build(query)),
    cards: {
      list: async () => (await mockDelay(), settings()),
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateDashboardCardRequest, body);
        const service = checked(b);
        const taken = new Set(cardsOf().map((c) => c.slot));
        const slot = Array.from({ length: DASHBOARD_CARD_SLOTS }, (_, i) => i + 1).find(
          (s) => !taken.has(s),
        );
        if (!slot) throw fail(409, 'CARDS_FULL', 'A dashboard shows six service cards at most.');
        const card: DashboardCardTemplate = {
          id: `0199c0d4-0000-7000-8000-${String(slot).padStart(12, '0')}`,
          slot,
          service,
          metric: b.metric,
          statusKey: b.statusKey,
          label: b.label,
          enabled: b.enabled,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: ME,
        };
        cardsOf().push(card);
        return { ...card };
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateDashboardCardRequest, body);
        const card = cardsOf().find((c) => c.id === id);
        if (!card) throw fail(404, 'NOT_FOUND', "We couldn't find that card");
        const service = checked(b);
        if (card.version !== b.version)
          throw fail(409, 'STALE_VERSION', 'This card was changed somewhere else.');
        Object.assign(card, {
          service,
          metric: b.metric,
          statusKey: b.statusKey,
          label: b.label,
          enabled: b.enabled,
          version: card.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: ME,
        });
        return { ...card };
      },
      order: async (body) => {
        await mockDelay();
        const named = parseInput(OrderDashboardCardsRequest, body).ids;
        const cards = cardsOf();
        if (
          new Set(named).size !== named.length ||
          !named.every((i) => cards.some((c) => c.id === i))
        )
          throw fail(400, 'VALIDATION_FAILED', "Name each of the firm's cards at most once");
        const ids = [...named, ...cards.map((c) => c.id).filter((i) => !named.includes(i))];
        // As the API: the slots stay, the contents move.
        const contents = ids.map((i) => ({ ...cards.find((c) => c.id === i)! }));
        cards.forEach((c, n) => {
          const next = contents[n]!;
          if (next.id === c.id) return;
          Object.assign(c, {
            service: next.service,
            metric: next.metric,
            statusKey: next.statusKey,
            label: next.label,
            enabled: next.enabled,
            version: c.version + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: ME,
          });
        });
        return settings();
      },
      preview: async (body) => {
        await mockDelay();
        const b = parseInput(PreviewDashboardCardRequest, body);
        checked(b);
        const today = new Date().toISOString().slice(0, 10);
        return { ...countOf(b), link: linkOf(b, rangeOf('THIS_MONTH', today)) };
      },
    },
  };
}
