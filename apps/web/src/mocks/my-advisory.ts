import {
  ADVISORY_DISCLAIMER,
  AdvisoryPlanId,
  ApiRequestError,
  ApproveMyAdvisoryPlanRequest,
  type MyAdvisory,
  type MyAdvisoryClient,
  type MyAdvisoryPlan,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// BA-CP (Client Portal Review One): the signed-in client's Business Advisory in mock mode, as the
// API (apps/api/src/advisory/my-advisory.service.ts) answers it: only what the firm marked for
// the client, each delivered plan read-only at the version delivered; a plan never delivered,
// archived or of another client is 404. B10: Approve takes exactly the version awaiting the
// client's approval (409 INVALID_STATUS otherwise) and the plan is then approved. Synthetic data.

const copy = <T>(value: T): T => structuredClone(value);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Not found');
const invalid = (message: string) => new ApiRequestError(409, 'INVALID_STATUS', message);

export const MY_ADVISORY_PLAN_IDS = {
  /** B10: sent for the client's approval. */
  review: '0199d600-0000-7000-8000-000000000004',
  growth: '0199d600-0000-7000-8000-000000000001',
  launch: '0199d600-0000-7000-8000-000000000002',
  /** Another client's plan (or one never delivered): the mock answers 404, as the API does. */
  hidden: '0199d600-0000-7000-8000-000000000003',
} as const;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const dayFrom = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function seed(): { view: MyAdvisory; plans: MyAdvisoryPlan[] } {
  const plans: MyAdvisoryPlan[] = [
    {
      id: MY_ADVISORY_PLAN_IDS.review,
      name: '2027 Expansion Plan (sample)',
      targetYear: 2027,
      version: 1,
      deliveredAt: ago(1),
      state: 'AWAITING_APPROVAL',
      approval: null,
      businessName: 'Sample Bakery LLC',
      summary: 'Add catering and a delivery van in the new year.',
      focusAreas: [{ area: 'REVENUE_GROWTH', objective: 'Catering as a second line of sales' }],
      goals: [
        {
          title: 'Book ten catering orders a month',
          area: 'REVENUE_GROWTH',
          targetDate: dayFrom(240),
          status: 'NOT_STARTED',
        },
      ],
      recommendations: [
        {
          title: 'Lease the van instead of buying it',
          rationale: 'Keeps cash for the catering launch.',
          impactLabel: 'Better cash flow',
          status: 'PROPOSED',
        },
      ],
      services: [{ name: 'Business Planning', status: 'IN_PROGRESS' }],
      disclaimer: ADVISORY_DISCLAIMER,
      can: { approve: true },
    },
    {
      id: MY_ADVISORY_PLAN_IDS.growth,
      name: '2026 Growth Plan (sample)',
      targetYear: 2026,
      version: 2,
      deliveredAt: ago(3),
      state: 'DELIVERED',
      approval: null,
      businessName: 'Sample Bakery LLC',
      summary: 'Open a second location and steady the cash flow before the move.',
      focusAreas: [
        { area: 'EXPANSION', objective: 'A second shop by the fall' },
        { area: 'FINANCIAL_MANAGEMENT', objective: 'Three months of cash on hand' },
      ],
      goals: [
        {
          title: 'Sign a lease for the second shop',
          area: 'EXPANSION',
          targetDate: dayFrom(120),
          status: 'IN_PROGRESS',
        },
        {
          title: 'Build a 3-month cash reserve',
          area: 'FINANCIAL_MANAGEMENT',
          targetDate: dayFrom(200),
          status: 'NOT_STARTED',
        },
      ],
      recommendations: [
        {
          title: 'Apply for an SBA 7(a) loan',
          rationale: 'Spreads the build-out cost over ten years.',
          impactLabel: 'Lower monthly payments',
          status: 'ACCEPTED',
        },
      ],
      services: [
        { name: 'Business Planning', status: 'IN_PROGRESS' },
        { name: 'Funding Readiness', status: 'ACCEPTED' },
      ],
      disclaimer: ADVISORY_DISCLAIMER,
      can: { approve: false },
    },
    {
      id: MY_ADVISORY_PLAN_IDS.launch,
      name: '2025 Launch Plan (sample)',
      targetYear: 2025,
      version: 1,
      deliveredAt: ago(220),
      state: 'IN_PREPARATION',
      approval: null,
      businessName: 'Sample Bakery LLC',
      summary: 'Form the company and open the first shop.',
      focusAreas: [{ area: 'BUSINESS_SETUP', objective: 'Entity, EIN and bank account' }],
      goals: [
        {
          title: 'Open the first shop',
          area: 'BUSINESS_SETUP',
          targetDate: null,
          status: 'COMPLETED',
        },
      ],
      recommendations: [],
      services: [{ name: 'Business Formation', status: 'COMPLETED' }],
      disclaimer: ADVISORY_DISCLAIMER,
      can: { approve: false },
    },
  ];
  const row = ({
    id,
    name,
    targetYear,
    version,
    deliveredAt,
    state,
    approval,
  }: MyAdvisoryPlan) => ({
    id,
    name,
    targetYear,
    version,
    deliveredAt,
    state,
    approval,
  });
  return {
    plans,
    view: {
      enrolled: true,
      businessName: 'Sample Bakery LLC',
      advisor: 'Olivia Owner',
      services: [
        { name: 'Business Planning', status: 'IN_PROGRESS' },
        { name: 'Funding Readiness', status: 'ACCEPTED' },
      ],
      plans: plans.map(row),
      recommendations: [
        {
          id: '0199d601-0000-7000-8000-000000000001',
          title: 'Apply for an SBA 7(a) loan',
          category: 'funding',
          rationale: 'Spreads the build-out cost over ten years.',
          impactLabel: 'Lower monthly payments',
          impactCents: null,
          status: 'ACCEPTED',
        },
        {
          id: '0199d601-0000-7000-8000-000000000002',
          title: 'Track job costs per order',
          category: 'operations',
          rationale: null,
          impactLabel: '+8% Profit',
          impactCents: 1_200_000,
          status: 'PROPOSED',
        },
      ],
      tasks: [
        {
          id: '0199d602-0000-7000-8000-000000000001',
          title: 'Gather three contractor quotes',
          details: 'For the second shop build-out.',
          dueOn: dayFrom(-2),
          status: 'IN_PROGRESS',
          overdue: true,
          forYou: true,
        },
        {
          id: '0199d602-0000-7000-8000-000000000002',
          title: 'Prepare the loan application package',
          details: null,
          dueOn: dayFrom(21),
          status: 'NOT_STARTED',
          overdue: false,
          forYou: false,
        },
      ],
      resources: [
        {
          key: 'funding-readiness-checklist',
          title: 'Funding Readiness Checklist',
          category: 'Funding',
          kind: 'CHECKLIST',
          summary: 'What lenders and investors look for before they say yes.',
          format: 'SECURE_LINK',
          sentAt: ago(5),
        },
        {
          key: 'cash-flow-basics',
          title: 'Cash Flow Basics',
          category: 'Financial Management',
          kind: 'GUIDE',
          summary: 'How to read and forecast your cash flow.',
          format: 'PDF',
          sentAt: ago(6),
        },
      ],
      files: [
        {
          id: '0199d603-0000-7000-8000-000000000001',
          fileName: 'Second shop budget (sample).pdf',
          sharedAt: ago(4),
        },
      ],
      disclaimer: ADVISORY_DISCLAIMER,
    },
  };
}

/** An in-memory `api.myAdvisory(slug)`. `enrolled: false` is a client outside the program. */
export function createMyAdvisoryMock(options: { enrolled?: boolean } = {}): MyAdvisoryClient {
  let state: ReturnType<typeof seed> | undefined;
  const all = () => (state ??= seed());
  return {
    get: async () => {
      await mockDelay();
      if (options.enrolled === false)
        return {
          enrolled: false,
          businessName: null,
          advisor: null,
          services: [],
          plans: [],
          recommendations: [],
          tasks: [],
          resources: [],
          files: [],
          disclaimer: ADVISORY_DISCLAIMER,
        };
      return copy(all().view);
    },
    plan: async (id) => {
      await mockDelay();
      const planId = parseInput(AdvisoryPlanId, id);
      const p = options.enrolled === false ? undefined : all().plans.find((x) => x.id === planId);
      if (!p) throw notFound();
      return copy(p);
    },
    // B28, as the API: only a resource sent as a PDF downloads (404 otherwise).
    resourcePdf: async (key) => {
      await mockDelay();
      const r =
        options.enrolled === false ? undefined : all().view.resources.find((x) => x.key === key);
      if (r?.format !== 'PDF') throw notFound();
      return {
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Mock PDF: ${r.title}`)}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    },
    approve: async (id, body) => {
      await mockDelay();
      const planId = parseInput(AdvisoryPlanId, id);
      const { version } = parseInput(ApproveMyAdvisoryPlanRequest, body);
      const state = all();
      const p = options.enrolled === false ? undefined : state.plans.find((x) => x.id === planId);
      if (!p) throw notFound();
      // As the API: only the plan awaiting approval, at exactly the version sent for it.
      if (p.state !== 'AWAITING_APPROVAL')
        throw invalid('This plan is not waiting for your approval');
      if (version !== p.version)
        throw invalid(`Version ${version} is not the one awaiting your approval: reload the plan`);
      p.state = 'APPROVED';
      p.approval = { version, approvedAt: new Date().toISOString() };
      p.can = { approve: false };
      const listed = state.view.plans.find((x) => x.id === planId);
      if (listed) Object.assign(listed, { state: p.state, approval: p.approval });
      return copy(p);
    },
  };
}

let mocks: Map<string, MyAdvisoryClient> | undefined;

/** `api.myAdvisory(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myAdvisoryMock(firmSlug: string): MyAdvisoryClient {
  mocks ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = mocks.get(key);
  if (found) return found;
  const created = createMyAdvisoryMock();
  mocks.set(key, created);
  return created;
}
