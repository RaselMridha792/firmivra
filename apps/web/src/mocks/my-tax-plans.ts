import {
  ApiRequestError,
  ApproveMyTaxPlanRequest,
  CreateMyTaxPlanRequest,
  type MyTaxPlan,
  type MyTaxPlansClient,
  parseInput,
  TaxPlanId,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// P4-8: the signed-in client's tax plans in mock mode, as the API (my-tax-plans.service.ts) keeps
// them: listed once sent, read-only at the version sent, Approve for exactly the version awaiting
// review, and a question, revision or meeting request that moves a plan waiting on the client to
// the firm (Needs Review). A closed plan takes no request; another plan id is 404. Synthetic data.

const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Not found');
const invalid = (message: string) => new ApiRequestError(409, 'INVALID_STATUS', message);

export const MY_TAX_PLAN_IDS = {
  review: '0199d500-0000-7000-8000-000000000001',
  approved: '0199d500-0000-7000-8000-000000000002',
  closed: '0199d500-0000-7000-8000-000000000003',
} as const;

const DISCLAIMER =
  'These are estimates from the information you gave us and the current tax law. They are not a guarantee of tax savings.';

/** Each plan with the version awaiting review (null when none is). */
type Plan = MyTaxPlan & { awaiting: number | null };

function seed(): Plan[] {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const base = {
    disclaimer: DISCLAIMER,
    requests: [],
    approval: null,
    can: { approve: false, request: true },
  };
  return [
    {
      ...base,
      id: MY_TAX_PLAN_IDS.review,
      name: '2026 Tax Strategy (sample)',
      planYear: 2026,
      version: 2,
      sentAt: day(2),
      state: 'AWAITING_REVIEW',
      strategies: [
        {
          name: 'Retirement contributions',
          category: 'Retirement',
          estimatedSavingsCents: 410_000,
        },
        { name: 'Home office deduction', category: 'Deductions', estimatedSavingsCents: 125_000 },
        { name: 'Charitable bunching', category: 'Charitable', estimatedSavingsCents: null },
      ],
      projectedSavingsCents: 535_000,
      awaiting: 2,
    },
    {
      ...base,
      id: MY_TAX_PLAN_IDS.approved,
      name: '2025 Year-End Plan (sample)',
      planYear: 2025,
      version: 1,
      sentAt: day(120),
      state: 'APPROVED',
      strategies: [
        { name: 'Health savings account', category: 'Health', estimatedSavingsCents: 98_000 },
      ],
      projectedSavingsCents: 98_000,
      approval: { version: 1, approvedOn: day(110).slice(0, 10), method: 'PORTAL' },
      awaiting: null,
    },
    {
      ...base,
      id: MY_TAX_PLAN_IDS.closed,
      name: '2024 Plan (sample)',
      planYear: 2024,
      version: 1,
      sentAt: day(400),
      state: 'CLOSED',
      strategies: [],
      projectedSavingsCents: null,
      awaiting: null,
      can: { approve: false, request: false },
    },
  ];
}

/** An in-memory `api.myTaxPlans(slug)`. */
export function createMyTaxPlansMock(): MyTaxPlansClient {
  let plans: Plan[] | undefined;
  const all = () => (plans ??= seed());
  const find = (id: string) => {
    const p = all().find((x) => x.id === parseInput(TaxPlanId, id));
    if (!p) throw notFound();
    return p;
  };
  const view = (p: Plan): MyTaxPlan => {
    const { awaiting, ...rest } = p;
    const open = p.state !== 'CLOSED';
    return copy({
      ...rest,
      can: {
        approve: open && awaiting !== null && p.approval?.version !== awaiting,
        request: open,
      },
    });
  };
  return {
    list: async () => {
      await mockDelay();
      return all()
        .slice()
        .sort((a, b) => b.planYear - a.planYear)
        .map(({ id, name, planYear, version, sentAt, state }) =>
          copy({ id, name, planYear, version, sentAt, state }),
        );
    },
    get: async (id) => {
      await mockDelay();
      return view(find(id));
    },
    ask: async (id, body) => {
      await mockDelay();
      const p = find(id);
      const input = parseInput(CreateMyTaxPlanRequest, body);
      if (p.state === 'CLOSED')
        throw invalid('This plan is closed: send the firm a message instead');
      p.requests.unshift({
        id: crypto.randomUUID(),
        kind: input.kind,
        body: input.body.trim(),
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      });
      // As the API: a plan waiting on the client (or approved by them) goes to the firm.
      if (p.state === 'AWAITING_REVIEW' || p.state === 'APPROVED') p.state = 'REQUEST_WITH_FIRM';
      return view(p);
    },
    approve: async (id, body) => {
      await mockDelay();
      const p = find(id);
      const input = parseInput(ApproveMyTaxPlanRequest, body);
      if (p.awaiting === null || p.state === 'CLOSED')
        throw invalid('This plan is not waiting for your approval');
      if (p.awaiting !== input.version)
        throw invalid(
          `Version ${input.version} is not the one awaiting your approval: reload the plan`,
        );
      if (p.approval?.version === p.awaiting)
        throw invalid(`Version ${p.awaiting} is already approved`);
      p.approval = {
        version: p.awaiting,
        approvedOn: new Date().toISOString().slice(0, 10),
        method: 'PORTAL',
      };
      p.state = 'APPROVED';
      p.awaiting = null;
      return view(p);
    },
  };
}

let mocks: Map<string, MyTaxPlansClient> | undefined;

/** `api.myTaxPlans(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myTaxPlansMock(firmSlug: string): MyTaxPlansClient {
  mocks ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = mocks.get(key);
  if (found) return found;
  const created = createMyTaxPlansMock();
  mocks.set(key, created);
  return created;
}
