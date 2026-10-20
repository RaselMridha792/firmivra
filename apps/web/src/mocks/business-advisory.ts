import {
  ADVISORY_DISCLAIMER,
  AddAdvisoryWorkstreamRequest,
  AdvisoryActionItemsQuery,
  AdvisoryActivityQuery,
  AdvisoryClientsQuery,
  AdvisoryFinancialsQuery,
  AdvisoryGoalsQuery,
  AdvisoryMeetingsQuery,
  AdvisoryPlansQuery,
  AdvisoryRecommendationsQuery,
  AdvisoryResourceKey,
  AdvisoryReportsQuery,
  AdvisoryResourcesQuery,
  ApiRequestError,
  CreateAdvisoryActionItemRequest,
  CreateAdvisoryClientRequest,
  CreateAdvisoryFinancialRequest,
  CreateAdvisoryGoalRequest,
  CreateAdvisoryMilestoneRequest,
  CreateAdvisoryPlanRequest,
  CreateAdvisoryRecommendationRequest,
  FinalizeAdvisoryPlanRequest,
  ReorderAdvisoryMilestonesRequest,
  SaveAdvisorySettingsRequest,
  SendAdvisoryPlanRequest,
  SendAdvisoryResourceRequest,
  SetAdvisoryPlanStatusRequest,
  UpdateAdvisoryActionItemRequest,
  UpdateAdvisoryClientRequest,
  UpdateAdvisoryGoalRequest,
  UpdateAdvisoryMilestoneRequest,
  UpdateAdvisoryPlanRequest,
  UpdateAdvisoryRecommendationRequest,
  UpdateAdvisoryWorkstreamRequest,
  parseInput,
  type AdvisoryActionItemRow,
  type AdvisoryActivity,
  type AdvisoryClient,
  type AdvisoryClientDetail,
  type AdvisoryClientRow,
  type AdvisoryFinancialRow,
  type AdvisoryGoalDetail,
  type AdvisoryGoalRow,
  type AdvisoryHealth,
  type AdvisoryKpi,
  type AdvisoryMeetingRow,
  type AdvisoryMetric,
  type AdvisoryMilestone,
  type AdvisoryPersonClient,
  type AdvisoryPlanAssessment,
  type AdvisoryPlanDetail,
  type AdvisoryPlanProfile,
  type AdvisoryPlanRow,
  type AdvisoryPlanStrategy,
  type AdvisoryRecommendationRow,
  type AdvisoryReports,
  type AdvisoryResource,
  type AdvisoryServiceOption,
  type AdvisoryVersionDetail,
  type AdvisoryVersionRow,
  type AdvisoryWorkstream,
  type MemberRef,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { clientFixtures } from './clients';
import { teamFixtures } from './team';

/**
 * Mock data for `api.advisory` (R55 contract, Business Advisory & Development). Synthetic businesses
 * only, dated around today. It checks input with the contract's schemas and answers its codes:
 * ALREADY_ADVISORY_CLIENT, DUPLICATE_SERVICE, SAVE_CONFLICT, INVALID_STATUS, PLAN_NOT_READY,
 * PLAN_ARCHIVED, INCONSISTENT_FIGURES, OVERRIDE_NOT_ALLOWED, FINANCIALS_RESTRICTED, NOT_A_MEMBER,
 * RESOURCE_NOT_CLIENT_FACING, NOT_THIS_CLIENT, plus 403 FORBIDDEN and 404 NOT_FOUND.
 *
 * Roles, as the API's permsOf (apps/api/src/advisory/advisory.common.ts): Owner and Admin reach
 * every advisory client; Staff (Sam Staff) only the clients assigned to them (any other is 404),
 * and may view figures and send, but not Advisory Admin (settings 403). The figures-restricted
 * state (FINANCIALS_RESTRICTED, money null) is for roles the grid limits; the mock role list has
 * none, so `canViewFinancials` is true here.
 * The Business Health Score follows the API's default formula (apps/api/src/advisory/health.ts).
 * `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=advisory) starts with no advisory clients; the services,
 * the resource library and the settings stay, as the API's do.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
/** 409 PLAN_NOT_READY with one `{ path, message }` line per missing part, as the API sends it. */
const notReady = (missing: string[]) =>
  new ApiRequestError(
    409,
    'PLAN_NOT_READY',
    'The plan is not ready yet',
    undefined,
    undefined,
    missing.map((message) => ({ path: 'plan', message })),
  );
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
const copy = <T>(v: T): T => structuredClone(v);
/** A stored figures row without the mock's own bookkeeping field. */
const strip = ({
  superseded: _s,
  ...f
}: AdvisoryFinancialRow & { superseded: boolean }): AdvisoryFinancialRow => f;
const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;
/** A calendar date `offset` days from today. */
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** A time `offset` days from today at `hour` local time (meetings show in business hours). */
const at = (offset: number, hour = 15) => {
  const d = new Date(Date.now() + offset * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const uid = (block: string, n: number) =>
  `0199c0f1-${block}-7000-8000-${String(n).padStart(12, '0')}`;

/**
 * The advisors are the team mock's members (mocks/team.ts), so the advisor filters, which list
 * `api.team`, find their clients: Sam Staff (the Staff role's signed-in user) and Adam Admin.
 */
const SAM: MemberRef = { userId: '0199b6a0-0000-7000-8000-000000000103', name: 'Sam Staff' };
const ADAM: MemberRef = { userId: '0199b6a0-0000-7000-8000-000000000102', name: 'Adam Admin' };
const MEMBERS: MemberRef[] = [mockMe, SAM, ADAM];

// ---------- Services (Services & Pricing) and the resource library ----------

const serviceOptions = (): AdvisoryServiceOption[] =>
  [
    [
      'Business Planning',
      'A written plan with goals, milestones and a budget.',
      ['Growth Advisory'],
    ],
    ['Growth Strategy', 'Where to grow next and what it takes.', ['Growth Advisory']],
    ['Financial Analysis', 'Margins, cash flow and budget against actual.', ['Growth Advisory']],
    ['Operational Efficiency', 'Systems, staffing and processes that scale.', []],
    ['Funding & Expansion', 'Readiness for loans, investors and a second location.', []],
    ['Business Formation', 'Entity choice, EIN and first registrations.', ['Startup Package']],
    ['Legal & Insurance Referral', 'Introductions to licensed partners.', []],
  ].map(([name, description, packages], i) => ({
    serviceId: uid('a100', i + 1),
    name: name as string,
    description: description as string,
    packages: packages as string[],
    referralOnly: name === 'Legal & Insurance Referral',
  }));

/** As the API's catalog (apps/api/src/advisory/catalog.ts). */
const resourceLibrary = (): AdvisoryResource[] =>
  (
    [
      [
        'business-formation-checklist',
        'Business Formation Checklist',
        'Formation / EIN',
        'CHECKLIST',
        true,
      ],
      ['brand-basics-guide', 'Brand Basics Guide', 'Branding', 'GUIDE', true],
      ['website-launch-checklist', 'Website Launch Checklist', 'Website', 'CHECKLIST', true],
      ['business-banking-checklist', 'Business Banking Checklist', 'Banking', 'CHECKLIST', true],
      ['funding-readiness-checklist', 'Funding Readiness Checklist', 'Funding', 'CHECKLIST', true],
      ['business-plan-template', 'Business Plan Template', 'Business Planning', 'TEMPLATE', true],
      ['market-research-guide', 'Market Research Guide', 'Market Research', 'GUIDE', true],
      ['cash-flow-basics', 'Cash Flow Basics', 'Financial Management', 'GUIDE', true],
      [
        'growth-operations-playbook',
        'Growth and Operations Playbook',
        'Growth / Operations',
        'GUIDE',
        true,
      ],
      [
        'advisory-health-score-reference',
        'Business Health Score (staff reference)',
        'Education',
        'GUIDE',
        false,
      ],
    ] as const
  ).map(([key, title, category, kind, clientFacing]) => ({
    key,
    title,
    category,
    kind,
    clientFacing,
    url: null,
  }));

/** The API's factors and default weights (apps/api/src/advisory/health.ts). */
const healthFactors = () =>
  [
    [
      'revenue_trend',
      'Revenue trend',
      'Revenue of the latest period against the one before: no change is 50, +20% or more is 100, -20% or less is 0.',
    ],
    [
      'profit_margin',
      'Profit margin',
      'Net profit over revenue of the latest period: a 25% margin or more is 100.',
    ],
    [
      'cash_flow',
      'Cash flow',
      'Positive cash flow in the latest period is 100, none is 50, negative is 0.',
    ],
    [
      'debt_ratio',
      'Debt load',
      'Debt over revenue: a quarter of revenue or less is 100, one and a half times or more is 0.',
    ],
    ['goal_progress', 'Goal progress', 'The average progress of the client’s open goals.'],
    [
      'action_completion',
      'Action items done',
      'The share of action items done, of those not cancelled.',
    ],
    [
      'budget_variance',
      'Revenue against budget',
      'Revenue of the latest period as a share of its budget, up to 100.',
    ],
  ].map(([factor, label, explanation]) => ({
    factor: factor!,
    label: label!,
    explanation: explanation!,
  }));
const DEFAULT_FORMULA = [
  { factor: 'revenue_trend', weight: 20 },
  { factor: 'profit_margin', weight: 20 },
  { factor: 'cash_flow', weight: 10 },
  { factor: 'debt_ratio', weight: 15 },
  { factor: 'goal_progress', weight: 15 },
  { factor: 'action_completion', weight: 10 },
  { factor: 'budget_variance', weight: 10 },
];

// ---------- Seed: synthetic advisory clients ----------

interface Seed {
  person: string;
  business: string;
  industry: string;
  stage: string;
  primary: string;
  additional: string[];
  status: AdvisoryClientRow['status'];
  advisor: MemberRef;
  sinceDays: number;
  entityType: string;
  years: number;
  city: string;
  state: string;
  archived?: boolean;
  /** Annual figures in dollars: [revenue, expenses, cash flow, debt, budget revenue, headcount], this year then last. */
  figures?: [number, number, number, number, number, number][];
  /** Days since the figures' as-of date. */
  figuresAgeDays?: number;
}

const SEEDS: Seed[] = [
  {
    person: 'Marcus Taylor',
    business: 'Taylor Construction LLC',
    industry: 'Construction',
    stage: 'Growth',
    primary: 'Growth Strategy',
    additional: ['Financial Analysis', 'Funding & Expansion'],
    status: 'IN_PROGRESS',
    advisor: SAM,
    sinceDays: -560,
    entityType: 'LLC',
    years: 6,
    city: 'Atlanta',
    state: 'GA',
    figures: [
      [1_250_000, 1_040_000, 185_000, 300_000, 1_200_000, 12],
      [1_059_000, 871_500, 140_000, 340_000, 1_000_000, 9],
    ],
    figuresAgeDays: 20,
  },
  {
    person: 'Sandra Lewis',
    business: 'SL Beauty Studio',
    industry: 'Beauty & Wellness',
    stage: 'Startup',
    primary: 'Business Planning',
    additional: ['Business Formation'],
    status: 'SCHEDULED',
    advisor: mockMe,
    sinceDays: -60,
    entityType: 'LLC',
    years: 1,
    city: 'Decatur',
    state: 'GA',
    figures: [[180_000, 162_000, 9_000, 45_000, 200_000, 4]],
    figuresAgeDays: 35,
  },
  {
    person: 'Kevin Martin',
    business: 'KM Logistics',
    industry: 'Transportation',
    stage: 'Growth',
    primary: 'Financial Analysis',
    additional: ['Operational Efficiency'],
    status: 'IN_PROGRESS',
    advisor: ADAM,
    sinceDays: -300,
    entityType: 'S Corporation',
    years: 8,
    city: 'Marietta',
    state: 'GA',
    figures: [
      [2_400_000, 2_256_000, -35_000, 1_900_000, 2_600_000, 26],
      [2_520_000, 2_318_000, 60_000, 1_650_000, 2_500_000, 24],
    ],
    figuresAgeDays: 45,
  },
  {
    person: 'Alicia Park',
    business: 'A.P. Consulting',
    industry: 'Professional Services',
    stage: 'Established',
    primary: 'Operational Efficiency',
    additional: [],
    status: 'NEEDS_REVIEW',
    advisor: SAM,
    sinceDays: -200,
    entityType: 'Sole Proprietorship',
    years: 11,
    city: 'Roswell',
    state: 'GA',
    figures: [
      [640_000, 448_000, 92_000, 40_000, 600_000, 5],
      [600_000, 438_000, 70_000, 55_000, 620_000, 5],
    ],
    figuresAgeDays: 15,
  },
  {
    person: 'Daniel Wright',
    business: 'Wright & Co.',
    industry: 'Retail',
    stage: 'Expansion',
    primary: 'Funding & Expansion',
    additional: ['Business Planning', 'Legal & Insurance Referral'],
    status: 'SCHEDULED',
    advisor: mockMe,
    sinceDays: -120,
    entityType: 'LLC',
    years: 4,
    city: 'Savannah',
    state: 'GA',
    figures: [[910_000, 828_000, 41_000, 210_000, 950_000, 9]],
    figuresAgeDays: 60,
  },
  {
    person: 'Priya Shah',
    business: 'Shah Dental Group',
    industry: 'Healthcare',
    stage: 'Established',
    primary: 'Growth Strategy',
    additional: [],
    status: 'ON_HOLD',
    advisor: ADAM,
    sinceDays: -700,
    entityType: 'Professional Corporation',
    years: 14,
    city: 'Alpharetta',
    state: 'GA',
    figures: [[3_100_000, 2_480_000, 310_000, 900_000, 3_000_000, 22]],
    figuresAgeDays: 420,
  },
  {
    person: 'Omar Haddad',
    business: 'Haddad Auto Care',
    industry: 'Automotive',
    stage: 'Growth',
    primary: 'Business Planning',
    additional: ['Growth Strategy'],
    status: 'COMPLETED',
    advisor: mockMe,
    sinceDays: -800,
    entityType: 'LLC',
    years: 9,
    city: 'Smyrna',
    state: 'GA',
    figures: [[1_480_000, 1_302_000, 120_000, 260_000, 1_400_000, 14]],
    figuresAgeDays: 90,
  },
  {
    person: 'Grace Kim',
    business: 'Kim Family Bakery',
    industry: 'Food & Beverage',
    stage: 'Startup',
    primary: 'Business Formation',
    additional: [],
    status: 'ARCHIVED',
    advisor: SAM,
    sinceDays: -400,
    entityType: 'LLC',
    years: 2,
    city: 'Athens',
    state: 'GA',
    archived: true,
  },
];

interface ClientState {
  id: string;
  client: AdvisoryPersonClient;
  businessName: string | null;
  industry: string | null;
  businessStage: string | null;
  status: AdvisoryClientRow['status'];
  advisor: MemberRef | null;
  since: string | null;
  archived: boolean;
  profile: AdvisoryClientDetail['businessProfile'];
  workstreams: AdvisoryWorkstream[];
  engagementId: string;
  version: number;
}
interface PlanState {
  id: string;
  advisoryClientId: string;
  name: string;
  targetYear: number;
  planType: string | null;
  status: AdvisoryPlanRow['status'];
  statusBeforeArchive: AdvisoryPlanRow['status'] | null;
  advisor: MemberRef | null;
  step: number;
  finalizedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
  createdAt: string;
  profile: AdvisoryPlanProfile;
  assessment: AdvisoryPlanAssessment;
  strategy: AdvisoryPlanStrategy;
  versions: AdvisoryVersionDetail[];
  version: number;
}
interface GoalState extends Omit<AdvisoryGoalRow, 'client' | 'milestoneCount' | 'milestonesDone'> {
  description: string | null;
  completedAt: string | null;
  statusBeforeArchive: AdvisoryGoalRow['status'] | null;
  version: number;
}
type ActionState = Omit<AdvisoryActionItemRow, 'client' | 'overdue'>;

export function createAdvisoryMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): AdvisoryClient {
  const YEAR = new Date().getUTCFullYear();
  const SERVICES = serviceOptions();
  const service = (name: string) => SERVICES.find((s) => s.name === name)!;
  const RESOURCES = resourceLibrary();
  const FACTORS = healthFactors();
  let next = 1;
  const id = (block: string) => uid(block, 9000 + next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const signedIn = role === 'STAFF' ? SAM : mockMe;
  const canViewFinancials = true;
  const canSend = true;
  const admin = () => {
    if (role === 'STAFF') throw forbidden();
  };
  const member = (userId: string | null | undefined): MemberRef | null => {
    if (userId == null) return null;
    const found =
      MEMBERS.find((m) => m.userId === userId) ??
      teamFixtures()
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({ userId: m.user.id, name: m.user.name }))
        .find((m) => m.userId === userId);
    if (!found) throw fail(409, 'NOT_A_MEMBER', 'That person is not an active member of the firm');
    return found;
  };

  // ----- State -----
  const clients: ClientState[] = [];
  const financials: (AdvisoryFinancialRow & { superseded: boolean })[] = [];
  const plans: PlanState[] = [];
  const goals: GoalState[] = [];
  const milestones: AdvisoryMilestone[] = [];
  const recommendations: AdvisoryRecommendationRow[] = [];
  const actions: ActionState[] = [];
  const meetings: (AdvisoryMeetingRow & { advisoryClientId: string })[] = [];
  const activity: (AdvisoryActivity & { advisoryClientId: string })[] = [];
  const settings = {
    healthFormula: copy(DEFAULT_FORMULA),
    staleFinancialsDays: 180,
    defaultAdvisor: mockMe as MemberRef | null,
    updatedAt: null as string | null,
  };
  const log = (
    advisoryClientId: string,
    action: string,
    message: string,
    actor: MemberRef | null = signedIn,
    when = nowIso(),
  ) => activity.unshift({ id: id('a900'), advisoryClientId, action, message, actor, at: when });

  if (!empty) {
    SEEDS.forEach((s, i) => {
      const cid = uid('a200', i + 1);
      const first = s.person.split(' ')[0]!.toLowerCase();
      const domain = s.business
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .slice(0, 18);
      const ws = (
        name: string,
        role: AdvisoryWorkstream['role'],
        n: number,
      ): AdvisoryWorkstream => ({
        id: uid('a210', (i + 1) * 10 + n),
        serviceId: service(name).serviceId,
        serviceName: name,
        role,
        status:
          s.status === 'COMPLETED'
            ? 'COMPLETED'
            : n === 0
              ? 'IN_PROGRESS'
              : n === 1
                ? 'ACCEPTED'
                : 'PROPOSED',
        packageName: service(name).packages[0] ?? null,
        startedOn: n <= 1 ? day(s.sinceDays + 7) : null,
        completedOn: s.status === 'COMPLETED' ? day(-30) : null,
        openItems: s.status === 'COMPLETED' ? 0 : 3 - n,
      });
      clients.push({
        id: cid,
        client: {
          id: uid('a220', i + 1),
          name: s.person,
          accountType: 'BUSINESS',
          email: `${first}@${domain}.example.test`,
          phone: `(404) 555-01${String(10 + i)}`,
        },
        businessName: s.business,
        industry: s.industry,
        businessStage: s.stage,
        status: s.status,
        advisor: s.advisor,
        since: day(s.sinceDays),
        archived: s.archived ?? false,
        profile: {
          entityType: s.entityType,
          yearsInBusiness: s.years,
          address: {
            line1: `${100 + i * 17} Commerce Street`,
            line2: null,
            city: s.city,
            state: s.state,
            postalCode: `30${String(300 + i * 11)}`,
            country: 'US',
          },
          website: `https://www.${domain}.example.test`,
          einMasked: `XX-XXX${String(6789 - i * 111).padStart(4, '0')}`,
        },
        workstreams: [
          ws(s.primary, 'PRIMARY', 0),
          ...s.additional.map((a, n) => ws(a, 'ADDITIONAL', n + 1)),
        ],
        engagementId: uid('a230', i + 1),
        version: 1,
      });
      (s.figures ?? []).forEach(([rev, exp, cash, debt, budget, heads], k) => {
        const end = new Date(Date.UTC(YEAR - 1 - k, 11, 31));
        const asOfOffset = -(s.figuresAgeDays ?? 30) - k * 365;
        const revenueCents = rev * 100;
        const expensesCents = exp * 100;
        financials.push({
          id: uid('a300', (i + 1) * 10 + k),
          advisoryClientId: cid,
          planId: null,
          periodStart: `${YEAR - 1 - k}-01-01`,
          periodEnd: end.toISOString().slice(0, 10),
          revenueCents,
          expensesCents,
          netProfitCents: revenueCents - expensesCents,
          marginPercent: Math.round(((revenueCents - expensesCents) / revenueCents) * 1000) / 10,
          cashFlowCents: cash * 100,
          debtCents: debt * 100,
          budgetRevenueCents: budget * 100,
          budgetExpensesCents: null,
          headcount: heads,
          source: k === 0 && i % 2 === 0 ? 'BOOKKEEPING' : 'MANUAL',
          asOf: day(asOfOffset),
          overridden: false,
          overrideReason: null,
          overriddenBy: null,
          stale: false,
          createdAt: at(asOfOffset),
          superseded: false,
        });
      });
    });
    const C = (n: number) => clients[n - 1]!;

    // Plans.
    const plan = (
      n: number,
      c: number,
      data: Partial<PlanState> & Pick<PlanState, 'name' | 'status' | 'step'>,
    ) => {
      const cl = C(c);
      const p: PlanState = {
        id: uid('a400', n),
        advisoryClientId: cl.id,
        targetYear: YEAR,
        planType: 'Growth Plan',
        statusBeforeArchive: null,
        advisor: cl.advisor,
        finalizedAt: null,
        sentAt: null,
        updatedAt: at(-3 - n),
        createdAt: at(-40 - n * 5),
        profile: {
          businessName: cl.businessName,
          entityType: cl.profile.entityType,
          industry: cl.industry,
          yearsInBusiness: cl.profile.yearsInBusiness,
          businessStage: cl.businessStage,
          productsServices: `${cl.industry} services for local customers.`,
          address: {
            line1: cl.profile.address?.line1 ?? null,
            city: cl.profile.address?.city ?? null,
            state: cl.profile.address?.state ?? null,
            postalCode: cl.profile.address?.postalCode ?? null,
          },
          primaryContact: { name: cl.client.name, email: cl.client.email, phone: cl.client.phone },
          website: cl.profile.website,
          employeeCount: 10,
          hiringPlans: 'Yes, two roles in the next 12 months.',
          keyTeamMembers: [{ name: 'Operations Manager', role: 'Operations' }],
        },
        assessment: {
          funding: {
            amountNeededCents: 25_000_000,
            purpose: 'A second location and equipment.',
            timing: 'Next 6 months',
          },
          sales: {
            customers: 'Homeowners and small commercial owners.',
            salesTrend: 'Growing about 18% a year.',
          },
          operations: { systemsChallenges: 'Job costing is done in spreadsheets.' },
          strengths: ['Strong referral base', 'Experienced crew'],
          challenges: ['Cash flow between projects', 'Hiring skilled staff'],
          dataSource: 'BOOKKEEPING',
        },
        strategy: {
          summary: 'Grow revenue 25% while lifting the margin to 15%, funded by an SBA loan.',
          areas: [
            { area: 'REVENUE_GROWTH', objective: 'Grow annual revenue by 25%.' },
            { area: 'PROFITABILITY', objective: 'Lift the profit margin to 15%.' },
            { area: 'FUNDING', objective: 'Secure $250,000 for expansion.' },
          ],
        },
        versions: [],
        version: 1,
        ...data,
      };
      plans.push(p);
      return p;
    };
    const sent = plan(1, 1, {
      name: `${YEAR} Business Growth Plan`,
      status: 'IN_PROGRESS',
      step: 5,
      finalizedAt: at(-21),
      sentAt: at(-20),
    });
    plan(2, 2, {
      name: `${YEAR} Startup Launch Plan`,
      status: 'DRAFT',
      step: 2,
      planType: 'Startup Plan',
      assessment: {},
      strategy: {},
    });
    plan(3, 3, {
      name: 'Fleet Expansion Plan',
      status: 'IN_REVIEW',
      step: 5,
      targetYear: YEAR + 1,
      planType: 'Expansion Plan',
    });
    plan(4, 4, {
      name: 'Operations Efficiency Plan',
      status: 'FINALIZED',
      step: 5,
      planType: 'Operations Plan',
      finalizedAt: at(-6),
    });
    plan(5, 5, {
      name: 'Second Location Funding Plan',
      status: 'DRAFT',
      step: 1,
      planType: 'Funding Plan',
      assessment: {},
      strategy: {},
    });
    plan(6, 7, {
      name: `${YEAR - 1} Growth Plan`,
      status: 'COMPLETED',
      step: 5,
      targetYear: YEAR - 1,
      finalizedAt: at(-300),
      sentAt: at(-298),
    });

    // Goals and milestones.
    const goal = (
      n: number,
      c: number,
      title: string,
      area: string | null,
      targetDate: string,
      status: GoalState['status'],
      progress: number,
      planN: number | null,
      milestoneTitles: string[] = [],
    ) => {
      const cl = C(c);
      const g: GoalState = {
        id: uid('a500', n),
        advisoryClientId: cl.id,
        title,
        area,
        targetDate,
        status,
        progressPercent: progress,
        owner: cl.advisor,
        planId: planN ? uid('a400', planN) : null,
        workstreamId: cl.workstreams[0]?.id ?? null,
        archived: false,
        updatedAt: at(-n),
        description: null,
        completedAt: status === 'COMPLETED' ? at(-40) : null,
        statusBeforeArchive: null,
        version: 1,
      };
      goals.push(g);
      milestoneTitles.forEach((t, k) =>
        milestones.push({
          id: uid('a510', n * 10 + k),
          goalId: g.id,
          title: t,
          targetDate: day(30 + k * 45),
          status:
            k === 0 && progress > 0
              ? 'COMPLETED'
              : k === 1 && progress > 30
                ? 'IN_PROGRESS'
                : 'NOT_STARTED',
          progressPercent: k === 0 && progress > 0 ? 100 : k === 1 && progress > 30 ? 50 : 0,
          owner: cl.advisor,
          sortOrder: k,
          completedAt: k === 0 && progress > 0 ? at(-14) : null,
        }),
      );
    };
    goal(
      1,
      1,
      'Increase annual revenue by 25%',
      'REVENUE_GROWTH',
      `${YEAR}-12-31`,
      'ON_TRACK',
      60,
      1,
      ['Sign two commercial contracts', 'Launch referral program', 'Hire a second estimator'],
    );
    goal(
      2,
      1,
      'Hire 3 additional staff members',
      'STAFFING',
      `${YEAR + 1}-03-31`,
      'ON_TRACK',
      40,
      1,
      ['Post the job openings', 'Hire the first crew lead'],
    );
    goal(
      3,
      1,
      'Expand to a second location',
      'EXPANSION',
      `${YEAR + 1}-12-31`,
      'IN_PROGRESS',
      20,
      1,
      ['Shortlist three sites'],
    );
    goal(
      4,
      1,
      'Improve profit margin to 15%',
      'PROFITABILITY',
      `${YEAR + 1}-06-30`,
      'ON_TRACK',
      70,
      1,
      ['Set up job costing'],
    );
    goal(5, 1, 'Secure $250K in funding', 'FUNDING', `${YEAR + 1}-03-31`, 'NOT_STARTED', 0, 1);
    goal(6, 2, 'Launch online booking', 'MARKETING_SALES', day(45), 'PLANNING', 20, 2, [
      'Choose a booking tool',
    ]);
    goal(7, 3, 'Add two delivery trucks', 'EXPANSION', day(120), 'AT_RISK', 35, 3, [
      'Get lender quotes',
      'Hire two drivers',
    ]);
    goal(8, 4, 'Cut admin hours by 20%', 'OPERATIONS', day(-10), 'IN_PROGRESS', 55, 4);
    goal(9, 5, 'Secure an SBA loan for the second store', 'FUNDING', day(150), 'PLANNING', 10, 5);
    goal(
      10,
      7,
      'Grow service revenue by 15%',
      'REVENUE_GROWTH',
      `${YEAR - 1}-12-31`,
      'COMPLETED',
      100,
      6,
    );

    // Recommendations.
    const rec = (
      n: number,
      c: number,
      title: string,
      category: string,
      impactLabel: string,
      impactCents: number | null,
      status: AdvisoryRecommendationRow['status'],
      clientVisible = true,
      rationale: string | null = null,
    ) =>
      recommendations.push({
        id: uid('a600', n),
        advisoryClientId: C(c).id,
        planId: plans.find((p) => p.advisoryClientId === C(c).id)?.id ?? null,
        goalId: null,
        title,
        category,
        rationale,
        impactLabel,
        impactCents,
        status,
        clientVisible,
        decidedAt: status === 'PROPOSED' ? null : at(-12),
        createdBy: C(c).advisor,
        updatedAt: at(-n),
      });
    rec(
      1,
      1,
      'SBA 7(a) Loan Opportunity',
      'Funding',
      '$250,000',
      25_000_000,
      'IN_PROGRESS',
      true,
      'Strong revenue history and collateral fit the program.',
    );
    rec(2, 1, 'Implement Job Costing System', 'Operations', '+15% Profit', null, 'PROPOSED');
    rec(3, 1, 'Tax Savings with Section 179', 'Tax Strategy', '$45,000', 4_500_000, 'IMPLEMENTED');
    rec(4, 1, 'Expand to Commercial Projects', 'Growth', '+30% Revenue', null, 'IN_PROGRESS');
    rec(
      5,
      1,
      'Hire Operations Manager',
      'Team Development',
      'Better Efficiency',
      null,
      'PROPOSED',
      false,
    );
    rec(6, 3, 'Refinance the truck loans', 'Funding', '-$1,800 a month', null, 'ACCEPTED');
    rec(
      7,
      4,
      'Move invoicing to the accounting system',
      'Operations',
      '-6 hours a week',
      null,
      'IN_PROGRESS',
    );
    rec(
      8,
      5,
      'Build a 12-month cash flow forecast',
      'Financial Management',
      'Lender-ready',
      null,
      'PROPOSED',
    );

    // Action items.
    const act = (
      n: number,
      c: number,
      title: string,
      kind: AdvisoryActionItemRow['assigneeKind'],
      assignee: MemberRef | null,
      dueOffset: number | null,
      status: AdvisoryActionItemRow['status'],
      priority: AdvisoryActionItemRow['priority'] = 'NORMAL',
      clientVisible = true,
    ) =>
      actions.push({
        id: uid('a700', n),
        advisoryClientId: C(c).id,
        planId: plans.find((p) => p.advisoryClientId === C(c).id)?.id ?? null,
        goalId: goals.find((g) => g.advisoryClientId === C(c).id)?.id ?? null,
        milestoneId: null,
        title,
        details: null,
        assigneeKind: kind,
        assignee,
        dueOn: dueOffset === null ? null : day(dueOffset),
        priority,
        status,
        clientVisible,
        completedAt: status === 'DONE' ? at(-3) : null,
        updatedAt: at(-n),
      });
    act(1, 1, 'Prepare funding application', 'STAFF', SAM, 10, 'IN_PROGRESS', 'HIGH');
    act(2, 1, 'Gather 3 vendor quotes', 'CLIENT', null, -2, 'IN_PROGRESS');
    act(3, 1, 'Complete financial projections', 'TEAM', null, 15, 'NOT_STARTED');
    act(4, 1, 'Research second location areas', 'STAFF', SAM, 30, 'NOT_STARTED');
    act(5, 1, 'Send the signed engagement letter', 'CLIENT', null, -30, 'DONE');
    act(6, 2, 'Register the business name', 'CLIENT', null, 7, 'NOT_STARTED', 'HIGH');
    act(7, 3, 'Request lender quotes', 'STAFF', ADAM, -5, 'IN_PROGRESS', 'HIGH');
    act(8, 4, 'Map the invoicing process', 'STAFF', SAM, 3, 'IN_PROGRESS');
    act(9, 5, 'Collect two years of tax returns', 'CLIENT', null, 12, 'NOT_STARTED');

    // Meetings (Appointments tagged Business Advisory).
    const meet = (
      n: number,
      c: number,
      offset: number,
      hour: number,
      type: string,
      video = true,
    ) => {
      const cl = C(c);
      meetings.push({
        appointmentId: uid('a800', n),
        startsAt: at(offset, hour),
        endsAt: at(offset, hour + 1),
        client: cl.client,
        businessName: cl.businessName,
        meetingType: type,
        joinUrl: video ? `https://meet.example.test/advisory-${n}` : null,
        location: video ? null : 'Firm office',
        advisor: cl.advisor,
        advisoryClientId: cl.id,
      });
    };
    meet(1, 1, 3, 10, 'Strategy Review');
    meet(2, 2, 5, 14, 'Business Plan Review');
    meet(3, 3, 7, 11, 'Financial Analysis');
    meet(4, 4, 10, 13, 'Growth Planning', false);
    meet(5, 5, 12, 15, 'Funding Options');
    meet(6, 1, -42, 10, 'Quarterly Review');
    meet(7, 1, -70, 11, 'Initial Consultation');
    meet(8, 3, -20, 9, 'Kickoff');

    // History of each client (newest first).
    clients.forEach((cl, i) => {
      log(
        cl.id,
        'advisory.client_added',
        'Added to the advisory program',
        cl.advisor,
        at(SEEDS[i]!.sinceDays),
      );
      if (plans.some((p) => p.advisoryClientId === cl.id))
        log(
          cl.id,
          'advisory.plan_created',
          'Business plan started',
          cl.advisor,
          at(SEEDS[i]!.sinceDays + 10),
        );
    });
    log(C(1).id, 'advisory.plan_finalized', 'Plan finalized', SAM, at(-21));
    log(C(1).id, 'advisory.plan_sent', 'Plan sent to the client portal', mockMe, at(-20));
    log(C(1).id, 'advisory.goal_updated', 'Goal progress updated', SAM, at(-4));

    // The sent plan's first version.
    const snap = snapshot(sent, 1, SAM, at(-21));
    snap.deliveredAt = at(-20);
    snap.deliveredChannel = 'portal';
    snap.deliveredBy = mockMe;
    sent.versions.push(snap);
    const prior = plans.find((p) => p.status === 'COMPLETED')!;
    const priorSnap = snapshot(prior, 1, mockMe, at(-300));
    priorSnap.deliveredAt = at(-298);
    priorSnap.deliveredChannel = 'email';
    priorSnap.deliveredBy = mockMe;
    prior.versions.push(priorSnap);
    plans
      .find((p) => p.status === 'FINALIZED')!
      .versions.push(
        snapshot(
          plans.find((p) => p.status === 'FINALIZED')!,
          1,
          SAM,
          at(-6),
        ),
      );
  }

  // ----- Reads -----
  const reachable = (c: ClientState) => role !== 'STAFF' || c.advisor?.userId === SAM.userId;
  const findClient = (advisoryClientId: string) => {
    const c = clients.find((x) => x.id === advisoryClientId);
    if (!c || !reachable(c)) throw notFound();
    return c;
  };
  const isStale = (asOf: string) => asOf < day(-settings.staleFinancialsDays);
  const liveFinancials = (advisoryClientId: string) =>
    financials
      .filter((f) => f.advisoryClientId === advisoryClientId && !f.superseded)
      .map((f) => ({ ...f, stale: isStale(f.asOf) }))
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const clientOf = (advisoryClientId: string) =>
    clients.find((c) => c.id === advisoryClientId)!.client;
  const openGoal = (g: GoalState) =>
    !g.archived && g.status !== 'COMPLETED' && g.status !== 'CANCELLED';
  /** As read: an open goal past its target date shows as OVERDUE. */
  const goalStatus = (g: GoalState): GoalState['status'] =>
    openGoal(g) && g.targetDate !== null && g.targetDate < day(0) ? 'OVERDUE' : g.status;
  const goalRow = (g: GoalState): AdvisoryGoalRow => {
    const ms = milestones.filter((m) => m.goalId === g.id);
    return {
      id: g.id,
      advisoryClientId: g.advisoryClientId,
      client: clientOf(g.advisoryClientId),
      title: g.title,
      area: g.area,
      targetDate: g.targetDate,
      status: goalStatus(g),
      progressPercent: g.progressPercent,
      owner: g.owner,
      planId: g.planId,
      workstreamId: g.workstreamId,
      milestoneCount: ms.length,
      milestonesDone: ms.filter((m) => m.status === 'COMPLETED').length,
      archived: g.archived,
      updatedAt: g.updatedAt,
    };
  };
  const goalDetail = (g: GoalState): AdvisoryGoalDetail => ({
    ...goalRow(g),
    description: g.description,
    milestones: milestones
      .filter((m) => m.goalId === g.id)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    recommendationIds: recommendations.filter((r) => r.goalId === g.id).map((r) => r.id),
    actionItemIds: actions.filter((a) => a.goalId === g.id).map((a) => a.id),
    completedAt: g.completedAt,
    etag: String(g.version),
  });
  const actionRow = (a: ActionState): AdvisoryActionItemRow => ({
    ...a,
    client: clientOf(a.advisoryClientId),
    overdue:
      a.dueOn !== null &&
      a.dueOn < day(0) &&
      (a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS'),
  });

  function health(c: ClientState): AdvisoryHealth {
    const f = liveFinancials(c.id);
    const latest = f[0];
    const before = f[1];
    const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
    const myGoals = goals.filter((g) => g.advisoryClientId === c.id && openGoal(g));
    const myActions = actions.filter(
      (a) => a.advisoryClientId === c.id && a.status !== 'CANCELLED',
    );
    const values: Record<string, number | null> = {
      revenue_trend:
        latest?.revenueCents && before?.revenueCents
          ? clamp(50 + ((latest.revenueCents - before.revenueCents) / before.revenueCents) * 250)
          : null,
      profit_margin:
        latest?.marginPercent != null ? clamp((latest.marginPercent / 25) * 100) : null,
      cash_flow:
        latest?.cashFlowCents != null
          ? latest.cashFlowCents > 0
            ? 100
            : latest.cashFlowCents === 0
              ? 50
              : 0
          : null,
      debt_ratio:
        latest?.debtCents != null && latest.revenueCents
          ? clamp(100 - ((latest.debtCents / latest.revenueCents - 0.25) / 1.25) * 100)
          : null,
      goal_progress: myGoals.length
        ? clamp(myGoals.reduce((n, g) => n + g.progressPercent, 0) / myGoals.length)
        : null,
      action_completion: myActions.length
        ? clamp((myActions.filter((a) => a.status === 'DONE').length / myActions.length) * 100)
        : null,
      budget_variance:
        latest?.revenueCents && latest.budgetRevenueCents
          ? clamp((latest.revenueCents / latest.budgetRevenueCents) * 100)
          : null,
    };
    const factors = settings.healthFormula.map(({ factor, weight }) => {
      const def = FACTORS.find((x) => x.factor === factor)!;
      return {
        factor,
        label: def.label,
        weight,
        value: values[factor] ?? null,
        explanation: def.explanation,
      };
    });
    const counted = factors.filter((x) => x.value !== null);
    const weight = counted.reduce((n, x) => n + x.weight, 0);
    return {
      score: weight
        ? Math.round(counted.reduce((n, x) => n + x.weight * x.value!, 0) / weight)
        : null,
      factors,
      computedAt: latest || myGoals.length ? at(-1) : null,
      stale: latest ? latest.stale : false,
      formulaVersion: 'v1',
    };
  }

  const clientRow = (c: ClientState): AdvisoryClientRow => {
    const primary = c.workstreams.find((w) => w.role === 'PRIMARY');
    const next = meetings
      .filter((m) => m.advisoryClientId === c.id && m.startsAt >= nowIso())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return {
      id: c.id,
      client: c.client,
      businessName: c.businessName,
      industry: c.industry,
      businessStage: c.businessStage,
      primaryService: primary ? { serviceId: primary.serviceId, name: primary.serviceName } : null,
      additionalServiceCount: c.workstreams.filter((w) => w.role === 'ADDITIONAL').length,
      nextMeetingAt: next?.startsAt ?? null,
      status: c.status,
      advisor: c.advisor,
      healthScore: health(c).score,
      since: c.since,
      archived: c.archived,
    };
  };
  const metric = (
    value: number | null,
    previous: number | null,
    periodLabel: string | null,
    source: AdvisoryMetric['source'],
    asOf: string | null,
  ): AdvisoryMetric => ({
    value,
    previous,
    deltaPercent:
      value !== null && previous
        ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10
        : null,
    periodLabel,
    source,
    asOf,
  });
  const clientDetail = (c: ClientState): AdvisoryClientDetail => {
    const f = liveFinancials(c.id);
    const [latest, before] = f;
    const label = latest ? `FY ${latest.periodEnd.slice(0, 4)}` : null;
    const myGoals = goals.filter((g) => g.advisoryClientId === c.id && openGoal(g));
    const myActions = actions.filter((a) => a.advisoryClientId === c.id).map(actionRow);
    const current = plans
      .filter((p) => p.advisoryClientId === c.id && p.status !== 'ARCHIVED')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      ...clientRow(c),
      businessProfile: c.profile,
      currentPlan: current
        ? {
            id: current.id,
            name: current.name,
            status: current.status,
            updatedAt: current.updatedAt,
          }
        : null,
      workstreams: c.workstreams,
      kpis: {
        annualRevenueCents: canViewFinancials
          ? metric(
              latest?.revenueCents ?? null,
              before?.revenueCents ?? null,
              label,
              latest?.source ?? null,
              latest?.asOf ?? null,
            )
          : null,
        netProfitCents: canViewFinancials
          ? metric(
              latest?.netProfitCents ?? null,
              before?.netProfitCents ?? null,
              label,
              latest?.source ?? null,
              latest?.asOf ?? null,
            )
          : null,
        employees: metric(
          latest?.headcount ?? null,
          before?.headcount ?? null,
          label,
          latest?.source ?? null,
          latest?.asOf ?? null,
        ),
        activeGoals: {
          count: myGoals.length,
          onTrack: myGoals.filter((g) => g.status === 'ON_TRACK').length,
          atRisk: myGoals.filter((g) => g.status === 'AT_RISK' || goalStatus(g) === 'OVERDUE')
            .length,
        },
        openTasks: {
          open: myActions.filter((a) => a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS')
            .length,
          overdue: myActions.filter((a) => a.overdue).length,
        },
      },
      health: health(c),
      counts: {
        plans: plans.filter((p) => p.advisoryClientId === c.id).length,
        goals: goals.filter((g) => g.advisoryClientId === c.id && !g.archived).length,
        recommendations: recommendations.filter((r) => r.advisoryClientId === c.id).length,
        actionItems: myActions.length,
        meetings: meetings.filter((m) => m.advisoryClientId === c.id).length,
      },
      engagementId: c.engagementId,
      disclaimer: ADVISORY_DISCLAIMER,
      canEdit: true,
      canViewFinancials,
      etag: String(c.version),
    };
  };
  const planRow = (p: PlanState): AdvisoryPlanRow => ({
    id: p.id,
    advisoryClientId: p.advisoryClientId,
    client: clientOf(p.advisoryClientId),
    name: p.name,
    targetYear: p.targetYear,
    planType: p.planType,
    status: p.status,
    advisor: p.advisor,
    step: p.step,
    currentVersion: p.versions.length,
    finalizedAt: p.finalizedAt,
    sentAt: p.sentAt,
    archived: p.status === 'ARCHIVED',
    updatedAt: p.updatedAt,
  });
  const planDetail = (p: PlanState): AdvisoryPlanDetail => {
    const f = liveFinancials(p.advisoryClientId);
    return {
      ...planRow(p),
      profile: p.profile,
      assessment: p.assessment,
      strategy: p.strategy,
      financials: canViewFinancials ? f.map(strip) : null,
      goals: goals.filter((g) => g.planId === p.id && !g.archived).map(goalRow),
      recommendations: recommendations.filter((r) => r.planId === p.id),
      actionItems: actions.filter((a) => a.planId === p.id).map(actionRow),
      workstreams: clients.find((c) => c.id === p.advisoryClientId)!.workstreams,
      sourceDataAsOf: f[0]?.asOf ?? null,
      staleFinancials: f[0] ? f[0].stale : false,
      disclaimer: ADVISORY_DISCLAIMER,
      canEdit: p.status !== 'ARCHIVED',
      canOverride: canViewFinancials,
      canSend,
      createdAt: p.createdAt,
      etag: String(p.version),
    };
  };
  function snapshot(
    p: PlanState,
    versionNo: number,
    by: MemberRef,
    when: string,
  ): AdvisoryVersionDetail {
    const f = financials.filter((x) => x.advisoryClientId === p.advisoryClientId && !x.superseded);
    return {
      versionNo,
      sourceDataAsOf:
        f
          .map((x) => x.asOf)
          .sort()
          .pop() ?? null,
      createdBy: by,
      createdAt: when,
      deliveredAt: null,
      deliveredChannel: null,
      deliveredBy: null,
      planName: p.name,
      targetYear: p.targetYear,
      profile: copy(p.profile),
      assessment: copy(p.assessment),
      strategy: copy(p.strategy),
      goals: goals
        .filter((g) => g.planId === p.id && !g.archived)
        .map((g) => ({ title: g.title, area: g.area, targetDate: g.targetDate, status: g.status })),
      recommendations: recommendations
        .filter((r) => r.planId === p.id)
        .map((r) => ({
          title: r.title,
          rationale: r.rationale,
          impactLabel: r.impactLabel,
          status: r.status,
        })),
      workstreams: (clients.find((c) => c.id === p.advisoryClientId)?.workstreams ?? []).map(
        (w) => ({
          serviceName: w.serviceName,
          status: w.status,
          role: w.role,
        }),
      ),
      financials: f.map(strip),
      disclaimer: ADVISORY_DISCLAIMER,
    };
  }
  const versionRow = ({
    versionNo,
    sourceDataAsOf,
    createdBy,
    createdAt,
    deliveredAt,
    deliveredChannel,
    deliveredBy,
  }: AdvisoryVersionDetail): AdvisoryVersionRow => ({
    versionNo,
    sourceDataAsOf,
    createdBy,
    createdAt,
    deliveredAt,
    deliveredChannel,
    deliveredBy,
  });
  const page = <T>(items: T[], p: number, size: number) => ({
    items: items.slice((p - 1) * size, p * size),
    total: items.length,
    page: p,
    pageSize: size,
  });
  const visibleClients = () => clients.filter(reachable);
  const visibleIds = () => new Set(visibleClients().map((c) => c.id));
  const findPlan = (planId: string) => {
    const p = plans.find((x) => x.id === planId);
    if (!p || !visibleIds().has(p.advisoryClientId)) throw notFound();
    return p;
  };
  const findGoal = (goalId: string) => {
    const g = goals.find((x) => x.id === goalId);
    if (!g || !visibleIds().has(g.advisoryClientId)) throw notFound();
    return g;
  };
  const checkEtag = (sent: string, current: number) => {
    if (sent !== String(current))
      throw fail(
        409,
        'SAVE_CONFLICT',
        'Someone saved this after you opened it. Reload to see their changes.',
      );
  };
  /** The plan, goal and workstream must be the client's own. */
  const ownedBy = (
    advisoryClientId: string,
    ref: {
      planId?: string | null;
      goalId?: string | null;
      workstreamId?: string | null;
      milestoneId?: string | null;
    },
  ) => {
    const bad =
      (ref.planId &&
        plans.find((p) => p.id === ref.planId)?.advisoryClientId !== advisoryClientId) ||
      (ref.goalId &&
        goals.find((g) => g.id === ref.goalId)?.advisoryClientId !== advisoryClientId) ||
      (ref.workstreamId &&
        !clients
          .find((c) => c.id === advisoryClientId)
          ?.workstreams.some((w) => w.id === ref.workstreamId)) ||
      (ref.milestoneId &&
        !milestones.some(
          (m) =>
            m.id === ref.milestoneId &&
            goals.find((g) => g.id === m.goalId)?.advisoryClientId === advisoryClientId,
        ));
    if (bad)
      throw fail(409, 'NOT_THIS_CLIENT', 'That plan, goal or service belongs to another client');
  };
  const kpi = (value: number, deltaPercent: number | null, comparedTo: string): AdvisoryKpi => ({
    value,
    deltaPercent: empty ? null : deltaPercent,
    comparedTo: empty ? null : comparedTo,
  });
  const term = (s?: string) => s?.trim().toLowerCase() || undefined;

  return {
    overview: () =>
      run(() => {
        const live = visibleClients().filter((c) => !c.archived && c.status !== 'COMPLETED');
        const ids = visibleIds();
        const myPlans = plans.filter((p) => ids.has(p.advisoryClientId));
        const upcoming = meetings
          .filter((m) => ids.has(m.advisoryClientId) && m.startsAt >= nowIso())
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const withActions = new Set(
          actions
            .filter((a) => a.planId && (a.status === 'IN_PROGRESS' || a.status === 'NOT_STARTED'))
            .map((a) => a.planId),
        );
        return {
          activeClients: kpi(live.length, 20, 'last quarter'),
          activePlans: kpi(
            myPlans.filter((p) =>
              ['DRAFT', 'IN_REVIEW', 'FINALIZED', 'SENT', 'IN_PROGRESS'].includes(p.status),
            ).length,
            29,
            'last quarter',
          ),
          upcomingMeetings: kpi(upcoming.length, 50, 'last month'),
          actionPlansInProgress: kpi(
            myPlans.filter((p) => withActions.has(p.id)).length,
            33,
            'last quarter',
          ),
          recentClients: live
            .map(clientRow)
            .sort((a, b) => (a.nextMeetingAt ?? '9').localeCompare(b.nextMeetingAt ?? '9'))
            .slice(0, 5),
          goals: goals
            .filter((g) => ids.has(g.advisoryClientId) && openGoal(g))
            .sort((a, b) => (a.targetDate ?? '9').localeCompare(b.targetDate ?? '9'))
            .slice(0, 5)
            .map(goalRow),
          meetings: upcoming.slice(0, 5).map(({ advisoryClientId: _a, ...m }) => m),
          resources: RESOURCES.filter((r) => r.clientFacing).slice(0, 5),
          serviceOptions: SERVICES,
          disclaimer: ADVISORY_DISCLAIMER,
          canCreatePlan: true,
          canManageGoals: true,
          canSend,
        };
      }),
    serviceOptions: () => run(() => SERVICES),

    // ----- Advisory clients -----
    clients: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryClientsQuery, q);
        const t = term(query.search);
        let rows = visibleClients()
          .filter(
            (c) =>
              (query.includeArchived || !c.archived) &&
              (!t ||
                [c.client.name, c.businessName ?? '', c.industry ?? ''].some((v) =>
                  v.toLowerCase().includes(t),
                )) &&
              (!query.status || c.status === query.status) &&
              (!query.advisorUserId || c.advisor?.userId === query.advisorUserId) &&
              (!query.serviceId || c.workstreams.some((w) => w.serviceId === query.serviceId)) &&
              (!query.businessStage || c.businessStage === query.businessStage),
          )
          .map(clientRow);
        const dir = query.direction === 'desc' ? -1 : 1;
        rows = rows.sort((a, b) => {
          const v =
            query.sort === 'status'
              ? a.status.localeCompare(b.status)
              : query.sort === 'nextMeeting'
                ? (a.nextMeetingAt ?? '9').localeCompare(b.nextMeetingAt ?? '9')
                : query.sort === 'health'
                  ? (a.healthScore ?? -1) - (b.healthScore ?? -1)
                  : a.client.name.localeCompare(b.client.name);
          return v * dir;
        });
        return page(rows, query.page, query.pageSize);
      }),
    addClient: (body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryClientRequest, body);
        if (clients.some((c) => c.client.id === req.clientId))
          throw fail(
            409,
            'ALREADY_ADVISORY_CLIENT',
            'This client is in the advisory program already',
          );
        const firmClient = clientFixtures().find((c) => c.id === req.clientId);
        if (!firmClient) throw notFound();
        const primary = SERVICES.find((s) => s.serviceId === req.primaryServiceId);
        if (!primary) throw notFound();
        const advisor = req.advisorUserId === undefined ? signedIn : member(req.advisorUserId);
        const c: ClientState = {
          id: id('a200'),
          client: {
            id: firmClient.id,
            name: firmClient.displayName,
            accountType: firmClient.accountType,
            email: firmClient.email,
            phone: firmClient.phone,
          },
          businessName: firmClient.profile.businessName ?? null,
          industry: req.industry ?? null,
          businessStage: req.businessStage ?? null,
          status: 'SCHEDULED',
          advisor,
          since: req.since ?? day(0),
          archived: false,
          profile: {
            entityType: firmClient.profile.entityType ?? null,
            yearsInBusiness: null,
            address: null,
            website: null,
            einMasked: null,
          },
          workstreams: [
            primary.serviceId,
            ...req.additionalServiceIds.filter((s) => s !== primary.serviceId),
          ].map((serviceId, n) => {
            const s = SERVICES.find((x) => x.serviceId === serviceId);
            if (!s) throw notFound();
            return {
              id: id('a210'),
              serviceId,
              serviceName: s.name,
              role: n === 0 ? 'PRIMARY' : 'ADDITIONAL',
              status: n === 0 ? 'ACCEPTED' : 'INTERESTED',
              packageName: n === 0 ? (req.packageName ?? null) : null,
              startedOn: null,
              completedOn: null,
              openItems: 0,
            } satisfies AdvisoryWorkstream;
          }),
          engagementId: id('a230'),
          version: 1,
        };
        if (role === 'STAFF' && advisor?.userId !== SAM.userId) c.advisor = SAM;
        clients.push(c);
        log(c.id, 'advisory.client_added', 'Added to the advisory program');
        return clientDetail(c);
      }),
    client: (advisoryClientId) => run(() => clientDetail(findClient(advisoryClientId))),
    updateClient: (advisoryClientId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryClientRequest, body);
        const c = findClient(advisoryClientId);
        checkEtag(req.etag, c.version);
        if (req.status !== undefined) c.status = req.status;
        if (req.advisorUserId !== undefined) c.advisor = member(req.advisorUserId);
        if (req.industry !== undefined) c.industry = req.industry;
        if (req.businessStage !== undefined) c.businessStage = req.businessStage;
        if (req.since !== undefined) c.since = req.since;
        c.version++;
        log(c.id, 'advisory.client_updated', 'Advisory client details updated');
        return clientDetail(c);
      }),
    archiveClient: (advisoryClientId) =>
      run(() => {
        const c = findClient(advisoryClientId);
        c.archived = true;
        c.version++;
        log(c.id, 'advisory.client_archived', 'Archived');
        return clientRow(c);
      }),
    restoreClient: (advisoryClientId) =>
      run(() => {
        const c = findClient(advisoryClientId);
        c.archived = false;
        if (c.status === 'ARCHIVED') c.status = 'ON_HOLD';
        c.version++;
        log(c.id, 'advisory.client_restored', 'Restored');
        return clientRow(c);
      }),
    addWorkstream: (advisoryClientId, body) =>
      run(() => {
        const req = parseInput(AddAdvisoryWorkstreamRequest, body);
        const c = findClient(advisoryClientId);
        const s = SERVICES.find((x) => x.serviceId === req.serviceId);
        if (!s) throw notFound();
        if (c.workstreams.some((w) => w.serviceId === req.serviceId))
          throw fail(409, 'DUPLICATE_SERVICE', 'This service is on the client already');
        if (req.role === 'PRIMARY') c.workstreams.forEach((w) => (w.role = 'ADDITIONAL'));
        const w: AdvisoryWorkstream = {
          id: id('a210'),
          serviceId: s.serviceId,
          serviceName: s.name,
          role: req.role,
          status: req.status,
          packageName: req.packageName ?? null,
          startedOn: null,
          completedOn: null,
          openItems: 0,
        };
        c.workstreams.push(w);
        c.version++;
        log(c.id, 'advisory.workstream_added', `Service added: ${s.name}`);
        return w;
      }),
    updateWorkstream: (advisoryClientId, workstreamId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryWorkstreamRequest, body);
        const c = findClient(advisoryClientId);
        const w = c.workstreams.find((x) => x.id === workstreamId);
        if (!w) throw notFound();
        if (req.role === 'PRIMARY') c.workstreams.forEach((x) => (x.role = 'ADDITIONAL'));
        if (req.role !== undefined) w.role = req.role;
        if (req.status !== undefined) w.status = req.status;
        if (req.packageName !== undefined) w.packageName = req.packageName;
        if (req.startedOn !== undefined) w.startedOn = req.startedOn;
        if (req.completedOn !== undefined) w.completedOn = req.completedOn;
        c.version++;
        log(c.id, 'advisory.workstream_updated', `Service updated: ${w.serviceName}`);
        return w;
      }),
    activity: (advisoryClientId, q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryActivityQuery, q);
        findClient(advisoryClientId);
        const rows = activity
          .filter((a) => a.advisoryClientId === advisoryClientId)
          .sort((a, b) => b.at.localeCompare(a.at))
          .map(({ advisoryClientId: _a, ...a }) => a);
        return page(rows, query.page, query.pageSize);
      }),

    // ----- Business plans -----
    plans: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryPlansQuery, q);
        const ids = visibleIds();
        const t = term(query.search);
        const rows = plans
          .filter(
            (p) =>
              ids.has(p.advisoryClientId) &&
              (query.includeArchived || p.status !== 'ARCHIVED') &&
              (!query.advisoryClientId || p.advisoryClientId === query.advisoryClientId) &&
              (!query.status || p.status === query.status) &&
              (!query.targetYear || p.targetYear === query.targetYear) &&
              (!query.planType || p.planType === query.planType) &&
              (!query.advisorUserId || p.advisor?.userId === query.advisorUserId) &&
              (!t ||
                [p.name, clientOf(p.advisoryClientId).name].some((v) =>
                  v.toLowerCase().includes(t),
                )),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(planRow);
        return page(rows, query.page, query.pageSize);
      }),
    createPlan: (body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryPlanRequest, body);
        const c = findClient(req.advisoryClientId);
        const p: PlanState = {
          id: id('a400'),
          advisoryClientId: c.id,
          name: req.name,
          targetYear: req.targetYear,
          planType: req.planType ?? null,
          status: 'DRAFT',
          statusBeforeArchive: null,
          advisor: c.advisor ?? signedIn,
          step: 1,
          finalizedAt: null,
          sentAt: null,
          updatedAt: nowIso(),
          createdAt: nowIso(),
          profile: req.profile ?? {},
          assessment: {},
          strategy: {},
          versions: [],
          version: 1,
        };
        plans.push(p);
        log(c.id, 'advisory.plan_created', 'Business plan started');
        return planDetail(p);
      }),
    plan: (planId) => run(() => planDetail(findPlan(planId))),
    updatePlan: (planId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryPlanRequest, body);
        const p = findPlan(planId);
        if (p.status === 'ARCHIVED') throw fail(409, 'PLAN_ARCHIVED', 'This plan is archived');
        checkEtag(req.etag, p.version);
        if (req.name !== undefined) p.name = req.name;
        if (req.targetYear !== undefined) p.targetYear = req.targetYear;
        if (req.planType !== undefined) p.planType = req.planType;
        if (req.step !== undefined) p.step = req.step;
        if (req.profile) p.profile = { ...p.profile, ...req.profile };
        if (req.assessment) p.assessment = { ...p.assessment, ...req.assessment };
        if (req.strategy) p.strategy = { ...p.strategy, ...req.strategy };
        p.version++;
        p.updatedAt = nowIso();
        return planDetail(p);
      }),
    setPlanStatus: (planId, body) =>
      run(() => {
        const req = parseInput(SetAdvisoryPlanStatusRequest, body);
        const p = findPlan(planId);
        checkEtag(req.etag, p.version);
        const allowed: Partial<Record<AdvisoryPlanRow['status'], AdvisoryPlanRow['status'][]>> = {
          DRAFT: ['IN_REVIEW'],
          IN_REVIEW: ['DRAFT'],
          FINALIZED: ['IN_PROGRESS'],
          SENT: ['IN_PROGRESS'],
          IN_PROGRESS: ['COMPLETED'],
          COMPLETED: ['IN_PROGRESS'],
        };
        if (!allowed[p.status]?.includes(req.status))
          throw fail(
            409,
            'INVALID_STATUS',
            `A ${p.status.toLowerCase().replace('_', ' ')} plan can't move to that status`,
          );
        p.status = req.status;
        p.version++;
        p.updatedAt = nowIso();
        log(
          p.advisoryClientId,
          'advisory.plan_status',
          `Plan status: ${req.status.toLowerCase().replace('_', ' ')}`,
        );
        return planDetail(p);
      }),
    finalizePlan: (planId, body) =>
      run(() => {
        const req = parseInput(FinalizeAdvisoryPlanRequest, body);
        const p = findPlan(planId);
        if (p.status === 'ARCHIVED') throw fail(409, 'PLAN_ARCHIVED', 'This plan is archived');
        checkEtag(req.etag, p.version);
        const f = liveFinancials(p.advisoryClientId);
        // The API's wording (apps/api/src/advisory/advisory-plans.service.ts).
        const missing = [
          !p.profile.businessName && 'Add the business name (stage 1)',
          !p.strategy.summary &&
            !p.strategy.areas?.length &&
            'Add the strategy summary or an area (stage 3)',
          !goals.some((g) => g.planId === p.id && !g.archived) &&
            'Add at least one goal to the plan',
          !f.length && 'Add the financial figures',
          f[0]?.stale && 'The financial figures are out of date; add current ones',
        ].filter((m): m is string => typeof m === 'string');
        if (missing.length) throw notReady(missing);
        const versionNo = p.versions.length + 1;
        p.versions.push(snapshot(p, versionNo, signedIn, nowIso()));
        p.status = 'FINALIZED';
        p.finalizedAt = nowIso();
        p.step = 5;
        p.version++;
        p.updatedAt = nowIso();
        log(p.advisoryClientId, 'advisory.plan_finalized', `Plan finalized (version ${versionNo})`);
        return planDetail(p);
      }),
    sendPlan: (planId, body) =>
      run(() => {
        const req = parseInput(SendAdvisoryPlanRequest, body);
        const p = findPlan(planId);
        if (!canSend) throw forbidden();
        if (p.status === 'ARCHIVED') throw fail(409, 'PLAN_ARCHIVED', 'This plan is archived');
        const v = req.version
          ? p.versions.find((x) => x.versionNo === req.version)
          : p.versions.at(-1);
        if (!v) throw notReady(['Finalize the plan first']);
        v.deliveredAt = nowIso();
        // Stored lower-case, as the API stores it.
        v.deliveredChannel = req.channel.toLowerCase();
        v.deliveredBy = signedIn;
        if (p.status === 'FINALIZED') p.status = 'SENT';
        p.sentAt = nowIso();
        p.version++;
        p.updatedAt = nowIso();
        log(p.advisoryClientId, 'advisory.plan_sent', `Plan sent (${req.channel.toLowerCase()})`);
        return planDetail(p);
      }),
    archivePlan: (planId) =>
      run(() => {
        const p = findPlan(planId);
        if (p.status !== 'ARCHIVED') p.statusBeforeArchive = p.status;
        p.status = 'ARCHIVED';
        p.version++;
        log(p.advisoryClientId, 'advisory.plan_archived', 'Plan archived');
        return planDetail(p);
      }),
    restorePlan: (planId) =>
      run(() => {
        const p = findPlan(planId);
        if (p.status === 'ARCHIVED') p.status = p.statusBeforeArchive ?? 'DRAFT';
        p.statusBeforeArchive = null;
        p.version++;
        log(p.advisoryClientId, 'advisory.plan_restored', 'Plan restored');
        return planDetail(p);
      }),
    versions: (planId) => run(() => findPlan(planId).versions.map(versionRow).reverse()),
    version: (planId, versionNo) =>
      run(() => {
        const v = findPlan(planId).versions.find((x) => x.versionNo === versionNo);
        if (!v) throw notFound();
        return canViewFinancials ? v : { ...v, financials: null };
      }),

    // ----- Financial analysis -----
    financials: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryFinancialsQuery, q);
        if (!canViewFinancials)
          throw fail(
            403,
            'FINANCIALS_RESTRICTED',
            'Financial figures need "View financial analysis"',
          );
        const ids = visibleIds();
        const rows = financials
          .filter(
            (f) =>
              ids.has(f.advisoryClientId) &&
              (query.includeSuperseded || !f.superseded) &&
              (!query.advisoryClientId || f.advisoryClientId === query.advisoryClientId) &&
              (!query.planId || f.planId === query.planId) &&
              (!query.source || f.source === query.source) &&
              (!query.from || f.periodEnd >= query.from) &&
              (!query.to || f.periodStart <= query.to),
          )
          .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
          .map((f) => ({
            ...strip(f),
            stale: isStale(f.asOf),
            client: clientOf(f.advisoryClientId),
          }));
        const sum = (
          k: 'revenueCents' | 'expensesCents' | 'netProfitCents' | 'budgetRevenueCents',
        ) => {
          const v = rows.map((r) => r[k]).filter((x): x is number => x !== null);
          return v.length ? v.reduce((n, x) => n + x, 0) : null;
        };
        const revenue = sum('revenueCents');
        const budget = sum('budgetRevenueCents');
        return {
          ...page(rows, query.page, query.pageSize),
          summary: {
            revenueCents: revenue,
            expensesCents: sum('expensesCents'),
            netProfitCents: sum('netProfitCents'),
            budgetRevenueCents: budget,
            budgetVarianceCents: revenue !== null && budget !== null ? revenue - budget : null,
          },
        };
      }),
    addFinancial: (advisoryClientId, body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryFinancialRequest, body);
        const c = findClient(advisoryClientId);
        if (!canViewFinancials)
          throw fail(
            403,
            'FINANCIALS_RESTRICTED',
            'Financial figures need "View financial analysis"',
          );
        if (req.planId) ownedBy(c.id, { planId: req.planId });
        const revenue = req.revenueCents ?? null;
        const expenses = req.expensesCents ?? null;
        let net = req.netProfitCents ?? null;
        if (revenue !== null && expenses !== null) {
          if (net !== null && net !== revenue - expenses)
            throw fail(409, 'INCONSISTENT_FIGURES', 'Net profit must be revenue minus expenses');
          net = revenue - expenses;
        }
        const earlier = financials.find(
          (f) =>
            f.advisoryClientId === c.id &&
            !f.superseded &&
            f.periodStart === req.periodStart &&
            f.periodEnd === req.periodEnd,
        );
        if (earlier && earlier.source !== 'MANUAL' && !req.override)
          throw fail(
            403,
            'OVERRIDE_NOT_ALLOWED',
            'Replacing figures from a source needs an override reason',
          );
        if (earlier) earlier.superseded = true;
        const row = {
          id: id('a300'),
          advisoryClientId: c.id,
          planId: req.planId ?? null,
          periodStart: req.periodStart,
          periodEnd: req.periodEnd,
          revenueCents: revenue,
          expensesCents: expenses,
          netProfitCents: net,
          marginPercent: revenue && net !== null ? Math.round((net / revenue) * 1000) / 10 : null,
          cashFlowCents: req.cashFlowCents ?? null,
          debtCents: req.debtCents ?? null,
          budgetRevenueCents: req.budgetRevenueCents ?? null,
          budgetExpensesCents: req.budgetExpensesCents ?? null,
          headcount: req.headcount ?? null,
          source: req.source,
          asOf: req.asOf,
          overridden: !!req.override,
          overrideReason: req.override?.reason ?? null,
          overriddenBy: req.override ? signedIn : null,
          stale: isStale(req.asOf),
          createdAt: nowIso(),
          superseded: false,
        };
        financials.push(row);
        log(
          c.id,
          'advisory.financials_added',
          req.override ? 'Financial figures overridden' : 'Financial figures added',
        );
        return strip(row);
      }),

    // ----- Goals and milestones -----
    goals: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryGoalsQuery, q);
        const ids = visibleIds();
        const t = term(query.search);
        const dir = query.direction === 'desc' ? -1 : 1;
        const rows = goals
          .filter(
            (g) =>
              ids.has(g.advisoryClientId) &&
              (query.includeArchived || !g.archived) &&
              (!query.advisoryClientId || g.advisoryClientId === query.advisoryClientId) &&
              (!query.planId || g.planId === query.planId) &&
              (!query.status || goalStatus(g) === query.status) &&
              (!query.area || g.area === query.area) &&
              (!query.ownerUserId || g.owner?.userId === query.ownerUserId) &&
              (!query.dueBefore || (g.targetDate !== null && g.targetDate <= query.dueBefore)) &&
              (!t || g.title.toLowerCase().includes(t)),
          )
          .map(goalRow)
          .sort((a, b) => {
            const v =
              query.sort === 'title'
                ? a.title.localeCompare(b.title)
                : query.sort === 'status'
                  ? a.status.localeCompare(b.status)
                  : query.sort === 'progress'
                    ? a.progressPercent - b.progressPercent
                    : query.sort === 'updated'
                      ? a.updatedAt.localeCompare(b.updatedAt)
                      : (a.targetDate ?? '9').localeCompare(b.targetDate ?? '9');
            return v * dir;
          });
        return page(rows, query.page, query.pageSize);
      }),
    createGoal: (body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryGoalRequest, body);
        const c = findClient(req.advisoryClientId);
        ownedBy(c.id, { planId: req.planId, workstreamId: req.workstreamId });
        const g: GoalState = {
          id: id('a500'),
          advisoryClientId: c.id,
          title: req.title,
          area: req.area ?? null,
          targetDate: req.targetDate ?? null,
          status: req.status,
          progressPercent: req.status === 'COMPLETED' ? 100 : req.progressPercent,
          owner: req.ownerUserId === undefined ? signedIn : member(req.ownerUserId),
          planId: req.planId ?? null,
          workstreamId: req.workstreamId ?? null,
          archived: false,
          updatedAt: nowIso(),
          description: req.description ?? null,
          completedAt: req.status === 'COMPLETED' ? nowIso() : null,
          statusBeforeArchive: null,
          version: 1,
        };
        goals.push(g);
        req.milestones.forEach((m, k) =>
          milestones.push({
            id: id('a510'),
            goalId: g.id,
            title: m.title,
            targetDate: m.targetDate ?? null,
            status: 'NOT_STARTED',
            progressPercent: 0,
            owner: member(m.ownerUserId) ?? g.owner,
            sortOrder: k,
            completedAt: null,
          }),
        );
        log(c.id, 'advisory.goal_created', 'Goal added');
        return goalDetail(g);
      }),
    goal: (goalId) => run(() => goalDetail(findGoal(goalId))),
    updateGoal: (goalId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryGoalRequest, body);
        const g = findGoal(goalId);
        checkEtag(req.etag, g.version);
        ownedBy(g.advisoryClientId, { planId: req.planId, workstreamId: req.workstreamId });
        if (req.planId !== undefined) g.planId = req.planId;
        if (req.workstreamId !== undefined) g.workstreamId = req.workstreamId;
        if (req.title !== undefined) g.title = req.title;
        if (req.description !== undefined) g.description = req.description;
        if (req.area !== undefined) g.area = req.area;
        if (req.targetDate !== undefined) g.targetDate = req.targetDate;
        if (req.ownerUserId !== undefined) g.owner = member(req.ownerUserId);
        if (req.progressPercent !== undefined) g.progressPercent = req.progressPercent;
        if (req.status !== undefined) {
          g.status = req.status;
          g.completedAt = req.status === 'COMPLETED' ? nowIso() : null;
          if (req.status === 'COMPLETED') g.progressPercent = 100;
        }
        g.version++;
        g.updatedAt = nowIso();
        log(
          g.advisoryClientId,
          'advisory.goal_updated',
          req.status === 'COMPLETED' ? 'Goal completed' : 'Goal updated',
        );
        return goalDetail(g);
      }),
    archiveGoal: (goalId) =>
      run(() => {
        const g = findGoal(goalId);
        g.archived = true;
        g.version++;
        log(g.advisoryClientId, 'advisory.goal_archived', 'Goal archived');
        return goalDetail(g);
      }),
    restoreGoal: (goalId) =>
      run(() => {
        const g = findGoal(goalId);
        g.archived = false;
        g.version++;
        log(g.advisoryClientId, 'advisory.goal_restored', 'Goal restored');
        return goalDetail(g);
      }),
    addMilestone: (goalId, body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryMilestoneRequest, body);
        const g = findGoal(goalId);
        const m: AdvisoryMilestone = {
          id: id('a510'),
          goalId: g.id,
          title: req.title,
          targetDate: req.targetDate ?? null,
          status: req.status,
          progressPercent: req.status === 'COMPLETED' ? 100 : req.progressPercent,
          owner: req.ownerUserId === undefined ? g.owner : member(req.ownerUserId),
          sortOrder: milestones.filter((x) => x.goalId === g.id).length,
          completedAt: req.status === 'COMPLETED' ? nowIso() : null,
        };
        milestones.push(m);
        g.version++;
        return m;
      }),
    updateMilestone: (milestoneId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryMilestoneRequest, body);
        const m = milestones.find((x) => x.id === milestoneId);
        if (!m) throw notFound();
        const g = findGoal(m.goalId);
        if (req.title !== undefined) m.title = req.title;
        if (req.targetDate !== undefined) m.targetDate = req.targetDate;
        if (req.ownerUserId !== undefined) m.owner = member(req.ownerUserId);
        if (req.progressPercent !== undefined) m.progressPercent = req.progressPercent;
        if (req.status !== undefined) {
          m.status = req.status;
          m.completedAt = req.status === 'COMPLETED' ? nowIso() : null;
          if (req.status === 'COMPLETED') m.progressPercent = 100;
        }
        g.version++;
        return m;
      }),
    reorderMilestones: (goalId, body) =>
      run(() => {
        const req = parseInput(ReorderAdvisoryMilestonesRequest, body);
        const g = findGoal(goalId);
        const mine = milestones.filter((m) => m.goalId === g.id);
        if (req.ids.length !== mine.length || !mine.every((m) => req.ids.includes(m.id)))
          throw fail(400, 'VALIDATION_FAILED', 'Send every milestone of the goal once');
        req.ids.forEach((mid, k) => (mine.find((m) => m.id === mid)!.sortOrder = k));
        g.version++;
        return goalDetail(g);
      }),

    // ----- Recommendations and action items -----
    recommendations: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryRecommendationsQuery, q);
        const ids = visibleIds();
        const t = term(query.search);
        const rows = recommendations
          .filter(
            (r) =>
              ids.has(r.advisoryClientId) &&
              (!query.advisoryClientId || r.advisoryClientId === query.advisoryClientId) &&
              (!query.planId || r.planId === query.planId) &&
              (!query.goalId || r.goalId === query.goalId) &&
              (!query.status || r.status === query.status) &&
              (query.clientVisible === undefined || r.clientVisible === query.clientVisible) &&
              (!t || r.title.toLowerCase().includes(t)),
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return page(rows, query.page, query.pageSize);
      }),
    createRecommendation: (body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryRecommendationRequest, body);
        const c = findClient(req.advisoryClientId);
        ownedBy(c.id, { planId: req.planId, goalId: req.goalId });
        const r: AdvisoryRecommendationRow = {
          id: id('a600'),
          advisoryClientId: c.id,
          planId: req.planId ?? null,
          goalId: req.goalId ?? null,
          title: req.title,
          category: req.category ?? null,
          rationale: req.rationale ?? null,
          impactLabel: req.impactLabel ?? null,
          impactCents: req.impactCents ?? null,
          status: 'PROPOSED',
          clientVisible: req.clientVisible,
          decidedAt: null,
          createdBy: signedIn,
          updatedAt: nowIso(),
        };
        recommendations.push(r);
        log(c.id, 'advisory.recommendation_created', 'Recommendation added');
        return r;
      }),
    updateRecommendation: (recommendationId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryRecommendationRequest, body);
        const r = recommendations.find((x) => x.id === recommendationId);
        if (!r || !visibleIds().has(r.advisoryClientId)) throw notFound();
        ownedBy(r.advisoryClientId, { planId: req.planId, goalId: req.goalId });
        const { status, ...rest } = req;
        Object.assign(
          r,
          Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        );
        if (status !== undefined && status !== r.status) {
          r.status = status;
          r.decidedAt = status === 'PROPOSED' ? null : nowIso();
        }
        r.updatedAt = nowIso();
        log(r.advisoryClientId, 'advisory.recommendation_updated', 'Recommendation updated');
        return r;
      }),
    actionItems: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryActionItemsQuery, q);
        const ids = visibleIds();
        const t = term(query.search);
        const rows = actions
          .filter((a) => ids.has(a.advisoryClientId))
          .map(actionRow)
          .filter(
            (a) =>
              (!query.advisoryClientId || a.advisoryClientId === query.advisoryClientId) &&
              (!query.planId || a.planId === query.planId) &&
              (!query.goalId || a.goalId === query.goalId) &&
              (!query.status || a.status === query.status) &&
              (!query.assigneeKind || a.assigneeKind === query.assigneeKind) &&
              (!query.assigneeUserId || a.assignee?.userId === query.assigneeUserId) &&
              (query.overdue === undefined || a.overdue === query.overdue) &&
              (!query.dueBefore || (a.dueOn !== null && a.dueOn <= query.dueBefore)) &&
              (!t || a.title.toLowerCase().includes(t)),
          )
          .sort((a, b) => (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9'));
        return page(rows, query.page, query.pageSize);
      }),
    createActionItem: (body) =>
      run(() => {
        const req = parseInput(CreateAdvisoryActionItemRequest, body);
        const c = findClient(req.advisoryClientId);
        ownedBy(c.id, { planId: req.planId, goalId: req.goalId, milestoneId: req.milestoneId });
        const a: ActionState = {
          id: id('a700'),
          advisoryClientId: c.id,
          planId: req.planId ?? null,
          goalId: req.goalId ?? null,
          milestoneId: req.milestoneId ?? null,
          title: req.title,
          details: req.details ?? null,
          assigneeKind: req.assigneeKind,
          assignee:
            req.assigneeKind === 'STAFF' ? member(req.assigneeUserId ?? signedIn.userId) : null,
          dueOn: req.dueOn ?? null,
          priority: req.priority,
          status: 'NOT_STARTED',
          clientVisible: req.clientVisible,
          completedAt: null,
          updatedAt: nowIso(),
        };
        actions.push(a);
        log(c.id, 'advisory.action_item_created', 'Action item added');
        return actionRow(a);
      }),
    updateActionItem: (actionItemId, body) =>
      run(() => {
        const req = parseInput(UpdateAdvisoryActionItemRequest, body);
        const a = actions.find((x) => x.id === actionItemId);
        if (!a || !visibleIds().has(a.advisoryClientId)) throw notFound();
        ownedBy(a.advisoryClientId, {
          planId: req.planId,
          goalId: req.goalId,
          milestoneId: req.milestoneId,
        });
        const { status, assigneeUserId, assigneeKind, ...rest } = req;
        Object.assign(
          a,
          Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        );
        if (assigneeKind !== undefined) a.assigneeKind = assigneeKind;
        if (assigneeUserId !== undefined) a.assignee = member(assigneeUserId);
        if (a.assigneeKind !== 'STAFF') a.assignee = null;
        if (status !== undefined) {
          a.status = status;
          a.completedAt = status === 'DONE' ? nowIso() : null;
        }
        a.updatedAt = nowIso();
        log(
          a.advisoryClientId,
          'advisory.action_item_updated',
          status === 'DONE' ? 'Action item done' : 'Action item updated',
        );
        return actionRow(a);
      }),

    // ----- Meetings, resources, settings -----
    meetings: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryMeetingsQuery, q);
        const ids = visibleIds();
        const now = nowIso();
        const rows = meetings
          .filter(
            (m) =>
              ids.has(m.advisoryClientId) &&
              (!query.advisoryClientId || m.advisoryClientId === query.advisoryClientId) &&
              (query.when === 'all' ||
                (query.when === 'upcoming' ? m.startsAt >= now : m.startsAt < now)),
          )
          .sort((a, b) =>
            query.when === 'past'
              ? b.startsAt.localeCompare(a.startsAt)
              : a.startsAt.localeCompare(b.startsAt),
          )
          .map(({ advisoryClientId: _a, ...m }) => m);
        return page(rows, query.page, query.pageSize);
      }),
    reports: (q = {}) =>
      run((): AdvisoryReports => {
        const query = parseInput(AdvisoryReportsQuery, q);
        const scope = visibleClients().filter(
          (c) => !c.archived && (!query.advisorUserId || c.advisor?.userId === query.advisorUserId),
        );
        const ids = new Set(scope.map((c) => c.id));
        const now = Date.now();
        const nowText = nowIso();
        const tally = <T extends string>(order: readonly T[], values: string[]) =>
          order
            .map((status) => ({ status, count: values.filter((v) => v === status).length }))
            .filter((x) => x.count > 0);
        const myPlans = plans.filter((p) => ids.has(p.advisoryClientId));
        const myGoals = goals.filter((g) => ids.has(g.advisoryClientId) && !g.archived);
        const open = myGoals.filter(openGoal);
        const myRecs = recommendations.filter((r) => ids.has(r.advisoryClientId));
        const myActions = actions.filter((a) => ids.has(a.advisoryClientId)).map(actionRow);
        const isOpen = (a: { status: string }) =>
          a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS';
        const myMeetings = meetings.filter((m) => ids.has(m.advisoryClientId));
        const upcoming = (m: { startsAt: string }) =>
          m.startsAt >= nowText && Date.parse(m.startsAt) <= now + 30 * DAY;
        const implemented = myRecs.filter(
          (r) => r.status === 'IMPLEMENTED' && r.impactCents !== null,
        );
        const services = new Map<string, AdvisoryReports['services'][number]>();
        for (const w of scope.flatMap((c) => c.workstreams)) {
          const row = services.get(w.serviceId) ?? {
            serviceId: w.serviceId,
            name: w.serviceName,
            primary: 0,
            additional: 0,
            inProgress: 0,
            completed: 0,
          };
          row[w.role === 'PRIMARY' ? 'primary' : 'additional']++;
          if (w.status === 'IN_PROGRESS') row.inProgress++;
          if (w.status === 'COMPLETED') row.completed++;
          services.set(w.serviceId, row);
        }
        const year = new Date().getFullYear();
        const current = financials.filter((f) => ids.has(f.advisoryClientId) && !f.superseded);
        const total = (
          rows: typeof current,
          k: 'revenueCents' | 'expensesCents' | 'netProfitCents',
        ) => {
          const v = rows.map((r) => r[k]).filter((x): x is number => x !== null);
          return v.length ? v.reduce((n, x) => n + x, 0) : null;
        };
        const workload = new Map<string, AdvisoryReports['advisorWorkload'][number]>();
        for (const c of scope) {
          const key = c.advisor?.userId ?? 'none';
          const row = workload.get(key) ?? {
            advisor: c.advisor,
            clients: 0,
            activePlans: 0,
            openGoals: 0,
            openActionItems: 0,
            upcomingMeetings: 0,
          };
          row.clients++;
          row.activePlans += myPlans.filter(
            (p) =>
              p.advisoryClientId === c.id && p.status !== 'COMPLETED' && p.status !== 'ARCHIVED',
          ).length;
          row.openGoals += open.filter((g) => g.advisoryClientId === c.id).length;
          row.openActionItems += myActions.filter(
            (a) => a.advisoryClientId === c.id && isOpen(a),
          ).length;
          row.upcomingMeetings += myMeetings.filter(
            (m) => m.advisoryClientId === c.id && upcoming(m),
          ).length;
          workload.set(key, row);
        }
        return {
          generatedAt: nowText,
          clients: {
            total: scope.length,
            byStatus: tally(
              [
                'IN_PROGRESS',
                'SCHEDULED',
                'NEEDS_REVIEW',
                'ON_HOLD',
                'COMPLETED',
                'ARCHIVED',
              ] as const,
              scope.map((c) => c.status),
            ),
          },
          plans: {
            total: myPlans.length,
            byStatus: tally(
              [
                'DRAFT',
                'IN_REVIEW',
                'FINALIZED',
                'SENT',
                'IN_PROGRESS',
                'COMPLETED',
                'ARCHIVED',
              ] as const,
              myPlans.map((p) => p.status),
            ),
            sentThisYear: myPlans
              .flatMap((p) => p.versions)
              .filter((v) => v.deliveredAt !== null && v.deliveredAt >= `${year}-01-01`).length,
          },
          services: [...services.values()].sort(
            (a, b) => b.primary + b.additional - (a.primary + a.additional),
          ),
          goals: {
            total: myGoals.length,
            byStatus: tally(
              [
                'NOT_STARTED',
                'PLANNING',
                'IN_PROGRESS',
                'ON_TRACK',
                'AT_RISK',
                'OVERDUE',
                'COMPLETED',
                'CANCELLED',
              ] as const,
              myGoals.map(goalStatus),
            ),
            averageProgress: open.length
              ? Math.round(open.reduce((n, g) => n + g.progressPercent, 0) / open.length)
              : null,
          },
          recommendations: {
            total: myRecs.length,
            byStatus: tally(
              [
                'PROPOSED',
                'ACCEPTED',
                'IN_PROGRESS',
                'IMPLEMENTED',
                'NOT_APPLICABLE',
                'DECLINED',
              ] as const,
              myRecs.map((r) => r.status),
            ),
            implementedImpactCents: implemented.length
              ? implemented.reduce((n, r) => n + (r.impactCents ?? 0), 0)
              : null,
          },
          actionItems: {
            open: myActions.filter(isOpen).length,
            overdue: myActions.filter((a) => a.overdue).length,
            doneLast30Days: myActions.filter(
              (a) =>
                a.status === 'DONE' &&
                a.completedAt !== null &&
                Date.parse(a.completedAt) >= now - 30 * DAY,
            ).length,
            byAssignee: (['STAFF', 'CLIENT', 'TEAM'] as const).map((kind) => ({
              kind,
              open: myActions.filter((a) => a.assigneeKind === kind && isOpen(a)).length,
            })),
          },
          meetings: {
            upcoming30Days: myMeetings.filter(upcoming).length,
            past90Days: myMeetings.filter(
              (m) => m.startsAt < nowText && Date.parse(m.startsAt) >= now - 90 * DAY,
            ).length,
          },
          financialTrend: canViewFinancials
            ? [year - 3, year - 2, year - 1].map((y) => {
                const rows = current.filter((f) => f.periodEnd.startsWith(String(y)));
                return {
                  year: y,
                  clients: new Set(rows.map((r) => r.advisoryClientId)).size,
                  revenueCents: total(rows, 'revenueCents'),
                  expensesCents: total(rows, 'expensesCents'),
                  netProfitCents: total(rows, 'netProfitCents'),
                };
              })
            : null,
          advisorWorkload: [...workload.values()].sort((a, b) => b.clients - a.clients),
          canViewFinancials,
          disclaimer: ADVISORY_DISCLAIMER,
        };
      }),
    resources: (q = {}) =>
      run(() => {
        const query = parseInput(AdvisoryResourcesQuery, q);
        const t = term(query.search);
        return RESOURCES.filter(
          (r) =>
            (!t || r.title.toLowerCase().includes(t)) &&
            (!query.category || r.category === query.category) &&
            (query.clientFacing === undefined || r.clientFacing === query.clientFacing),
        );
      }),
    sendResource: (key, body) =>
      run(() => {
        parseInput(AdvisoryResourceKey, key);
        const req = parseInput(SendAdvisoryResourceRequest, body);
        if (!canSend) throw forbidden();
        const r = RESOURCES.find((x) => x.key === key);
        if (!r) throw notFound();
        if (!r.clientFacing)
          throw fail(
            409,
            'RESOURCE_NOT_CLIENT_FACING',
            'This resource is for staff and cannot be sent',
          );
        const c = findClient(req.advisoryClientId);
        log(c.id, 'advisory.resource_sent', `Resource sent: ${r.title}`);
        return { ok: true as const };
      }),
    settings: () =>
      run(() => {
        admin();
        return {
          healthFormula: settings.healthFormula.map(({ factor, weight }) => {
            const def = FACTORS.find((x) => x.factor === factor)!;
            return { factor, label: def.label, weight, explanation: def.explanation };
          }),
          availableFactors: FACTORS,
          staleFinancialsDays: settings.staleFinancialsDays,
          defaultAdvisor: settings.defaultAdvisor,
          updatedAt: settings.updatedAt,
        };
      }),
    saveSettings: (body) =>
      run(() => {
        admin();
        const req = parseInput(SaveAdvisorySettingsRequest, body);
        if (req.healthFormula) {
          if (req.healthFormula.some((f) => !FACTORS.some((x) => x.factor === f.factor)))
            throw fail(400, 'VALIDATION_FAILED', 'Use only the available factors');
          settings.healthFormula = req.healthFormula;
        }
        if (req.staleFinancialsDays !== undefined)
          settings.staleFinancialsDays = req.staleFinancialsDays;
        if (req.defaultAdvisorUserId !== undefined)
          settings.defaultAdvisor = member(req.defaultAdvisorUserId);
        settings.updatedAt = nowIso();
        return {
          healthFormula: settings.healthFormula.map(({ factor, weight }) => {
            const def = FACTORS.find((x) => x.factor === factor)!;
            return { factor, label: def.label, weight, explanation: def.explanation };
          }),
          availableFactors: FACTORS,
          staleFinancialsDays: settings.staleFinancialsDays,
          defaultAdvisor: settings.defaultAdvisor,
          updatedAt: settings.updatedAt,
        };
      }),
  };
}
