import {
  AddPlanStrategyRequest,
  ApiRequestError,
  AttachPlanDocumentRequest,
  CalculateSavingsRequest,
  CreatePlanningStrategyRequest,
  CreateTaxOpportunityRequest,
  CreateTaxPlanRequest,
  FinalizePlanRequest,
  OpportunityActionRequest,
  PlanningCalendarQuery,
  PlanningClientsQuery,
  PlanningResourcesQuery,
  PlanningStrategiesQuery,
  ReorderPlanStrategiesRequest,
  RunScreeningRequest,
  SavePlanInputsRequest,
  SaveScenarioRequest,
  SendPlanRequest,
  SendPlanningResourceRequest,
  SetPlanStatusRequest,
  TAX_PLANNING_DISCLAIMER,
  TaxOpportunitiesQuery,
  TaxPlansQuery,
  TaxScenariosQuery,
  UpdatePlanStrategyRequest,
  UpdatePlanningStrategyRequest,
  UpdateTaxPlanRequest,
  parseInput,
  type CalculatorResult,
  type MemberRef,
  type PlanInput,
  type PlanStrategy,
  type PlanVersionDetail,
  type PlanningClientRow,
  type PlanningDeadline,
  type PlanningResource,
  type PlanningStrategy,
  type SavingsEstimate,
  type TaxOpportunityDetail,
  type TaxOpportunityEvent,
  type TaxPlanDetail,
  type TaxPlanningClient,
  type TaxScenario,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';

/**
 * Mock data for `api.taxPlanning` (R55 contract, Tax Planning & Strategy). Synthetic clients only,
 * dated around today. It checks input with the contract's schemas and answers its codes:
 * DUPLICATE_PLAN, DUPLICATE_STRATEGY, DUPLICATE_OPPORTUNITY, DUPLICATE_NAME, SAVE_CONFLICT,
 * OVERRIDE_NOT_ALLOWED, INVALID_STATUS, PLAN_NOT_READY, PLAN_ARCHIVED. An estimate is an estimate:
 * each carries its tax year, basis and time, and one the model cannot make is null with its reason,
 * never invented. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=taxPlanning) starts with no plans,
 * opportunities or scenarios (the library and resources stay, as the API's catalog does).
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}
type Category = PlanningStrategy['category'];
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(v: T): T => structuredClone(v);
const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const uid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const ALEX: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000011', name: 'Alex Rivera' };

const CLIENTS = [
  ['Sarah Mitchell', 'INDIVIDUAL', 'Individual'],
  ['Johnson Family', 'INDIVIDUAL', 'Individual'],
  ['Green Leaf Café LLC', 'BUSINESS', 'Small Business'],
  ['Turner Group LLC', 'BUSINESS', 'Small Business'],
  ['Davis Consulting', 'BUSINESS', 'S Corporation'],
  ['Walker Properties', 'BUSINESS', 'Partnership'],
  ['Thompson Holdings', 'BUSINESS', 'Corporate'],
  ['Marcus Johnson', 'INDIVIDUAL', 'Individual'],
  ['Elite Properties', 'BUSINESS', 'Small Business'],
  ['Karen Thomas', 'INDIVIDUAL', 'Individual'],
] as const;
const LIBRARY: [string, Category, string, string[]][] = [
  [
    'Maximize Retirement Contributions',
    'RETIREMENT',
    'Contribute to a 401(k), SEP or SIMPLE plan to lower taxable income.',
    ['Has earned income', 'Has not reached the annual limit'],
  ],
  [
    'Health Savings Account (HSA)',
    'DEDUCTIONS',
    'Fund an HSA with a high-deductible health plan.',
    ['Enrolled in a high-deductible health plan'],
  ],
  [
    'Section 179 Equipment Deduction',
    'BUSINESS',
    'Deduct qualifying equipment bought for the business in the year.',
    ['Owns a business', 'Bought qualifying equipment'],
  ],
  [
    'Home Office Deduction',
    'DEDUCTIONS',
    'Deduct a regular and exclusive home office.',
    ['Self-employed or business owner'],
  ],
  [
    'Qualified Business Income (QBI) Deduction',
    'BUSINESS',
    'Deduct up to 20% of qualified business income.',
    ['Pass-through income'],
  ],
  [
    'Charitable Giving / Donor-Advised Fund',
    'DEDUCTIONS',
    'Bunch gifts into one year to itemize.',
    ['Gives to charity'],
  ],
  [
    'Entity Structure Review',
    'ENTITY',
    'Compare entity types for self-employment tax savings.',
    ['Self-employment income over $60,000'],
  ],
  [
    'Education Credits',
    'CREDITS',
    'Claim the American Opportunity or Lifetime Learning credit.',
    ['Has a student in college'],
  ],
  [
    'Income Timing (Defer / Accelerate)',
    'TIMING',
    'Move income or deductions between years.',
    ['Income differs by year'],
  ],
  [
    'Tax-Loss Harvesting',
    'INVESTMENT',
    'Offset gains with realized losses.',
    ['Has taxable investment accounts'],
  ],
  [
    'Estate & Gifting Review',
    'ESTATE_OTHER',
    'Use the annual gift exclusion and review the estate plan.',
    ['Net worth above the exemption'],
  ],
  [
    'Hire Family Members',
    'BUSINESS',
    'Pay reasonable wages to family who work in the business.',
    ['Owns a business', 'Family members help'],
  ],
];
const RESOURCES: PlanningResource[] = [
  {
    key: 'year-end-planning-checklist',
    title: 'Year-End Tax Planning Checklist',
    category: 'Planning',
    kind: 'CHECKLIST',
    clientFacing: true,
    url: null,
  },
  {
    key: 'retirement-planning-guide',
    title: 'Retirement Contribution Guide',
    category: 'Retirement',
    kind: 'GUIDE',
    clientFacing: true,
    url: null,
  },
  {
    key: 'small-business-deductions',
    title: 'Small Business Deductions Guide',
    category: 'Business',
    kind: 'PDF',
    clientFacing: true,
    url: null,
  },
  {
    key: 'charitable-giving-guide',
    title: 'Charitable Giving Guide',
    category: 'Deductions',
    kind: 'ARTICLE',
    clientFacing: true,
    url: null,
  },
  {
    key: 'entity-comparison',
    title: 'Choosing a Business Entity',
    category: 'Entity',
    kind: 'VIDEO',
    clientFacing: true,
    url: null,
  },
  {
    key: 'quarterly-estimates',
    title: 'Estimated Tax Payments Explained',
    category: 'Planning',
    kind: 'ARTICLE',
    clientFacing: true,
    url: null,
  },
  {
    key: 'internal-screening-rules',
    title: 'How Opportunity Screening Works',
    category: 'Internal',
    kind: 'GUIDE',
    clientFacing: false,
    url: null,
  },
];
const INPUT_CATALOG = [
  { key: 'wages', label: 'Wages & Salary', type: 'MONEY' as const, group: 'Income' },
  {
    key: 'self_employment_income',
    label: 'Self-Employment Income',
    type: 'MONEY' as const,
    group: 'Income',
  },
  { key: 'business_income', label: 'Business Income', type: 'MONEY' as const, group: 'Income' },
  {
    key: 'interest_dividends',
    label: 'Interest & Dividends',
    type: 'MONEY' as const,
    group: 'Income',
  },
  { key: 'capital_gains', label: 'Capital Gains', type: 'MONEY' as const, group: 'Income' },
  {
    key: 'itemized_deductions',
    label: 'Itemized Deductions',
    type: 'MONEY' as const,
    group: 'Deductions',
  },
  {
    key: 'retirement_contributions',
    label: 'Retirement Contributions',
    type: 'MONEY' as const,
    group: 'Deductions',
  },
  { key: 'dependents', label: 'Dependents', type: 'TEXT' as const, group: 'Household' },
];

/** The rough federal model: single-filer style brackets on the taxable income, never a guarantee. */
function modelTax(taxable: number, filing: string | undefined): number {
  const scale = filing === 'MARRIED_FILING_JOINTLY' ? 2 : 1;
  const brackets: [number, number][] = [
    [11_600 * scale, 0.1],
    [47_150 * scale, 0.12],
    [100_525 * scale, 0.22],
    [191_950 * scale, 0.24],
    [243_725 * scale, 0.32],
    [609_350 * scale, 0.35],
    [Infinity, 0.37],
  ];
  let tax = 0;
  let last = 0;
  for (const [top, rate] of brackets) {
    if (taxable > last) tax += (Math.min(taxable, top) - last) * rate;
    last = top;
  }
  return Math.round(tax);
}
const compute = (
  req: ReturnType<typeof parseInput<typeof CalculateSavingsRequest>>,
): CalculatorResult => {
  const b = req.baseline;
  const gross =
    (b.wagesCents ?? 0) +
    (b.selfEmploymentIncomeCents ?? 0) +
    (b.businessIncomeCents ?? 0) +
    (b.interestDividendsCents ?? 0) +
    (b.capitalGainsCents ?? 0) +
    (b.otherIncomeCents ?? 0);
  const assumptions = [
    'Federal income tax only; state tax is not modelled.',
    'Uses the standard deduction unless itemized deductions are higher.',
    'Self-employment tax and phase-outs are not included.',
  ];
  if (gross <= 0)
    return {
      baselineTaxCents: null,
      modeledTaxCents: null,
      differenceCents: null,
      unavailableReason: 'Enter at least one income figure to estimate.',
      assumptions,
      disclaimer: TAX_PLANNING_DISCLAIMER,
    };
  const std = req.filingStatus === 'MARRIED_FILING_JOINTLY' ? 29_200_00 : 14_600_00;
  const deduct = Math.max(std, b.itemizedDeductionsCents ?? 0);
  const baseTaxable = Math.max(0, gross - (b.adjustmentsCents ?? 0) - deduct);
  const s = req.strategy;
  const add =
    (s.retirementContributionCents ?? 0) +
    (s.hsaContributionCents ?? 0) +
    (s.section179Cents ?? 0) +
    (s.homeOfficeCents ?? 0) +
    (s.otherDeductionCents ?? 0);
  const base = Math.max(
    0,
    modelTax(baseTaxable / 100, req.filingStatus) * 100 - (b.creditsCents ?? 0),
  );
  const modeled = Math.max(
    0,
    modelTax(Math.max(0, baseTaxable - add) / 100, req.filingStatus) * 100 -
      (b.creditsCents ?? 0) -
      (s.additionalCreditCents ?? 0),
  );
  return {
    baselineTaxCents: base,
    modeledTaxCents: modeled,
    differenceCents: base - modeled,
    unavailableReason: b.state ? 'State tax is not modelled for ' + b.state + '.' : null,
    assumptions,
    disclaimer: TAX_PLANNING_DISCLAIMER,
  };
};

export function createTaxPlanningMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): TaxPlanningClient {
  const YEAR = new Date().getUTCFullYear();
  let next = 7000;
  const id = (block: string) => uid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const refs = CLIENTS.map(([name, type, label], i) => ({
    ref: {
      id: uid('d100', i + 1),
      name,
      accountType: type,
      email: `client${i + 1}@example.test`,
      phone: `(555) 010-0${i + 1}00`,
    },
    label,
  }));
  const refOf = (clientId: string) => refs.find((r) => r.ref.id === clientId)?.ref;
  const library: PlanningStrategy[] = LIBRARY.map(
    ([name, category, description, eligibility], i) => ({
      id: uid('d200', i + 1),
      name,
      category,
      description,
      defaultPriority: i % 3 === 0 ? 'HIGH' : 'MEDIUM',
      eligibility,
      requiredInputs: ['wages'],
      requiredDocuments: ['Prior-year tax return'],
      implementationChecklist: [
        'Confirm eligibility with the client',
        'Collect documents',
        'Implement before year end',
      ],
      active: true,
      archived: false,
      planCount: 0,
      openOpportunityCount: 0,
      updatedAt: nowIso(),
    }),
  );
  const estimate = (cents: number | null, basis = `Based on ${YEAR} data`): SavingsEstimate => ({
    cents,
    modelCents: cents,
    overridden: false,
    dataYear: cents === null ? null : YEAR,
    calculatedAt: cents === null ? null : nowIso(),
    basis: cents === null ? null : basis,
    unavailableReason: cents === null ? 'Add the missing income figures to estimate this.' : null,
  });
  const plans: (TaxPlanDetail & { _versions: PlanVersionDetail[] })[] = [];
  const opps: (TaxOpportunityDetail & { _events: TaxOpportunityEvent[] })[] = [];
  const scenarios: TaxScenario[] = [];

  const recompute = (p: TaxPlanDetail) => {
    const sel = p.strategies.filter((s) => s.selected && s.estimate.cents !== null);
    p.projectedSavingsCents = sel.length
      ? sel.reduce((n, s) => n + (s.estimate.cents ?? 0), 0)
      : null;
    p.strategyCount = p.strategies.filter((s) => s.selected).length;
    p.overlapNotes =
      sel.length > 1
        ? ['Retirement and HSA savings are counted once where the same income is reduced.']
        : [];
    p.etag = `e${next++}`;
    p.updatedAt = nowIso();
    p.staleData = false;
    return p;
  };
  const planStrategy = (
    lib: PlanningStrategy,
    position: number,
    cents: number | null,
    status: PlanStrategy['status'] = 'PROPOSED',
  ): PlanStrategy => ({
    id: id('d300'),
    strategyId: lib.id,
    name: lib.name,
    category: lib.category,
    custom: false,
    selected: true,
    priority: lib.defaultPriority,
    status,
    estimate: estimate(cents),
    overrideReason: null,
    overriddenBy: null,
    assumptions: null,
    implementedOn: null,
    position,
  });
  const newPlan = (
    clientIdx: number,
    name: string,
    status: TaxPlanDetail['status'],
    savings: number[],
  ): TaxPlanDetail & { _versions: PlanVersionDetail[] } => {
    const c = refs[clientIdx]!;
    const at = nowIso();
    const strategies = savings.map((cents, k) =>
      planStrategy(
        library[(clientIdx + k) % library.length]!,
        k,
        cents,
        k === 0 && status === 'IMPLEMENTED' ? 'IMPLEMENTED' : 'PROPOSED',
      ),
    );
    const inputs: PlanInput[] = [
      {
        key: 'wages',
        label: 'Wages & Salary',
        kind: 'HISTORICAL',
        taxYear: YEAR - 1,
        amountCents: (60_000 + clientIdx * 11_000) * 100,
        textValue: null,
        source: `Tax return ${YEAR - 1}`,
        asOf: at,
        note: null,
      },
      {
        key: 'business_income',
        label: 'Business Income',
        kind: 'PROJECTED',
        taxYear: YEAR,
        amountCents: c.ref.accountType === 'BUSINESS' ? (80_000 + clientIdx * 9_000) * 100 : 0,
        textValue: null,
        source: 'Client estimate',
        asOf: at,
        note: null,
      },
    ];
    const p: TaxPlanDetail & { _versions: PlanVersionDetail[] } = {
      id: id('d400'),
      client: c.ref,
      name,
      planYear: YEAR,
      planType: 'COMPREHENSIVE',
      status,
      entityLabel: c.label,
      assignedTo: ALEX,
      targetCompletionOn: day(30 + clientIdx * 4),
      nextDiscussionOn: day(3 + clientIdx),
      projectedSavingsCents: null,
      strategyCount: 0,
      version: 1,
      archived: false,
      updatedAt: at,
      filingStatus: c.ref.accountType === 'INDIVIDUAL' ? 'MARRIED_FILING_JOINTLY' : null,
      entityType: c.label,
      goals: ['REDUCE_TAXABLE_INCOME', 'INCREASE_RETIREMENT_SAVINGS'],
      otherGoal: null,
      notes: null,
      clientNotes: null,
      inputs,
      strategies,
      documents: [],
      overlapNotes: [],
      staleData: false,
      disclaimer: TAX_PLANNING_DISCLAIMER,
      canEdit: role !== 'STAFF',
      canOverride: role !== 'STAFF',
      canSend: role !== 'STAFF',
      createdAt: at,
      etag: 'e0',
      _versions: [],
    };
    recompute(p);
    return p;
  };
  const oppFor = (i: number): TaxOpportunityDetail & { _events: TaxOpportunityEvent[] } => {
    const lib = library[i % library.length]!;
    const c = refs[i % refs.length]!;
    const at = nowIso();
    const cents = i % 7 === 5 ? null : (900 + ((i * 377) % 4200)) * 100;
    const status = (
      [
        'NEW',
        'NEW',
        'UNDER_REVIEW',
        'ASSIGNED',
        'DISCUSSION_SCHEDULED',
        'NEEDS_DOCUMENTS',
        'NOT_APPLICABLE',
        'IMPLEMENTED',
      ] as const
    )[i % 8]!;
    return {
      id: id('d500'),
      client: c.ref,
      strategyId: lib.id,
      name: lib.name,
      category: lib.category,
      priority: lib.defaultPriority,
      status,
      source: 'SYSTEM',
      taxYear: YEAR,
      estimatedSavingsCents: cents,
      assignedTo: i % 2 ? ALEX : null,
      dataComplete: cents !== null,
      planId: null,
      lastEvaluatedAt: at,
      updatedAt: at,
      description: lib.description,
      ruleId: `rule-${lib.category.toLowerCase()}`,
      whyExplanation: `${c.ref.name} matches the screening rule for ${lib.name.toLowerCase()}: ${lib.eligibility[0]?.toLowerCase()}.`,
      missingData:
        cents === null ? ['Current-year income', 'Retirement contributions to date'] : [],
      clientDataUsed:
        role === 'STAFF'
          ? null
          : [
              { label: 'Wages & Salary', amountCents: (60_000 + i * 4_000) * 100, text: null },
              { label: 'Filing Status', amountCents: null, text: 'Married filing jointly' },
            ],
      estimate: estimate(cents),
      impact: {
        suggestedActionCents: cents === null ? null : Math.round(cents * 3.3),
        newTaxableIncomeCents: cents === null ? null : (72_000 - i * 500) * 100,
        effectiveRateBeforeBp: cents === null ? null : 1840,
        effectiveRateAfterBp: cents === null ? null : 1610,
      },
      recommendedActions: [
        'Review the client’s current-year figures',
        `Discuss ${lib.name.toLowerCase()} with the client`,
        'Add it to the plan if it fits',
      ],
      eligibility: lib.eligibility.map((t, k) => ({ text: t, met: k === 0 || i % 4 !== 0 })),
      documentsNeeded: [
        { index: 0, label: 'Prior-year tax return', received: i % 2 === 0 },
        { index: 1, label: 'Year-to-date income statement', received: false },
      ],
      plan: null,
      discussionOn: status === 'DISCUSSION_SCHEDULED' ? day(5) : null,
      reviewed: status !== 'NEW',
      reviewedBy: status !== 'NEW' ? mockMe : null,
      dispositionReason: status === 'NOT_APPLICABLE' ? 'The client does not own equipment.' : null,
      suppressedUntil: null,
      implementedOn: status === 'IMPLEMENTED' ? day(-10) : null,
      previousId: null,
      nextId: null,
      candidatePlans: [],
      disclaimer: TAX_PLANNING_DISCLAIMER,
      canReview: role !== 'STAFF',
      createdAt: at,
      etag: `e${next++}`,
      _events: [
        {
          id: id('d900'),
          kind: 'SCREENED',
          fromStatus: null,
          toStatus: 'NEW',
          reason: 'Found by the year-end screening',
          actor: null,
          createdAt: at,
        },
      ],
    };
  };
  if (!empty) {
    plans.push(
      newPlan(0, `${YEAR} Tax Plan`, 'IN_PROGRESS', [420_000, 310_000]),
      newPlan(1, `${YEAR} Planning`, 'SCHEDULED', [150_000]),
      newPlan(2, `${YEAR} Business Plan`, 'READY_FOR_REVIEW', [640_000, 280_000, 190_000]),
      newPlan(3, `${YEAR} Tax Strategy`, 'DRAFT', []),
      newPlan(4, `${YEAR} S-Corp Review`, 'AWAITING_CLIENT', [510_000]),
      newPlan(6, `${YEAR} Corporate Plan`, 'IMPLEMENTED', [880_000, 410_000]),
    );
    for (let i = 0; i < 18; i += 1) opps.push(oppFor(i));
    for (const l of library) {
      l.planCount = plans.filter((p) => p.strategies.some((s) => s.strategyId === l.id)).length;
      l.openOpportunityCount = opps.filter(
        (o) =>
          o.strategyId === l.id &&
          !['NOT_APPLICABLE', 'IMPLEMENTED', 'CLOSED', 'DISMISSED'].includes(o.status),
      ).length;
    }
  }
  const OPEN = [
    'NEW',
    'UNDER_REVIEW',
    'ASSIGNED',
    'DISCUSSION_SCHEDULED',
    'NEEDS_DOCUMENTS',
    'ADDED_TO_PLAN',
  ];
  const strip = <T extends object>(x: T): Omit<T, '_versions' | '_events'> => {
    const {
      _versions: _v,
      _events: _e,
      ...rest
    } = x as T & { _versions?: unknown; _events?: unknown };
    void [_v, _e];
    return rest as Omit<T, '_versions' | '_events'>;
  };
  const findPlan = (pid: string) => {
    const p = plans.find((x) => x.id === pid);
    if (!p) throw fail(404, 'NOT_FOUND', 'That plan was not found.');
    return p;
  };
  const editable = (p: TaxPlanDetail) => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
    if (p.archived) throw fail(409, 'PLAN_ARCHIVED', 'Restore the plan before changing it.');
  };
  const conflict = (p: { etag: string }, etag: string) => {
    if (etag !== p.etag)
      throw fail(
        409,
        'SAVE_CONFLICT',
        'Someone saved this after you opened it. Reload and try again.',
      );
  };
  const rowOfPlan = (p: TaxPlanDetail) => {
    const {
      filingStatus: _f,
      entityType: _e,
      goals: _g,
      otherGoal: _o,
      notes: _n,
      clientNotes: _c,
      inputs: _i,
      strategies: _s,
      documents: _d,
      overlapNotes: _ov,
      staleData: _sd,
      disclaimer: _di,
      canEdit: _ce,
      canOverride: _co,
      canSend: _cs,
      createdAt: _ca,
      etag: _et,
      ...row
    } = strip(p as TaxPlanDetail & { _versions?: never }) as TaxPlanDetail;
    void [_f, _e, _g, _o, _n, _c, _i, _s, _d, _ov, _sd, _di, _ce, _co, _cs, _ca, _et];
    return row;
  };
  const clientRow = (c: (typeof refs)[number]): PlanningClientRow => {
    const p = plans
      .filter((x) => x.client.id === c.ref.id && !x.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      client: c.ref,
      entityLabel: c.label,
      planId: p?.id ?? null,
      planName: p?.name ?? null,
      planYear: p?.planYear ?? null,
      status: p?.status ?? null,
      nextAppointmentAt: p?.nextDiscussionOn ? `${p.nextDiscussionOn}T15:00:00.000Z` : null,
      potentialSavingsCents: p?.projectedSavingsCents ?? null,
      assignedTo: p?.assignedTo ?? null,
      openOpportunities: opps.filter((o) => o.client.id === c.ref.id && OPEN.includes(o.status))
        .length,
    };
  };
  const page = <T>(items: T[], p: number, size: number) => ({
    items: items.slice((p - 1) * size, p * size),
    total: items.length,
    page: p,
    pageSize: size,
  });
  const addEvent = (
    o: { _events: TaxOpportunityEvent[] },
    kind: TaxOpportunityEvent['kind'],
    from: string | null,
    to: string | null,
    reason: string | null,
  ) =>
    o._events.unshift({
      id: id('d900'),
      kind,
      fromStatus: from as never,
      toStatus: to as never,
      reason,
      actor: mockMe,
      createdAt: nowIso(),
    });
  const findOpp = (oid: string) => {
    const o = opps.find((x) => x.id === oid);
    if (!o) throw fail(404, 'NOT_FOUND', 'That opportunity was not found.');
    return o;
  };

  return {
    overview: () =>
      run(() => {
        const rows = refs.map(clientRow);
        const live = plans.filter((p) => !p.archived);
        const inProgress = live.reduce(
          (n, p) =>
            n +
            p.strategies.filter((s) => s.status === 'IN_PROGRESS' || s.status === 'ACCEPTED')
              .length,
          0,
        );
        const byStrategy = new Map<
          string,
          {
            name: string;
            category: Category;
            ids: string[];
            clients: Set<string>;
            savings: number | null;
          }
        >();
        for (const o of opps.filter((x) => OPEN.includes(x.status))) {
          const k = o.strategyId ?? o.name;
          const e = byStrategy.get(k) ?? {
            name: o.name,
            category: o.category,
            ids: [],
            clients: new Set(),
            savings: 0,
          };
          e.ids.push(o.id);
          e.clients.add(o.client.id);
          e.savings =
            o.estimatedSavingsCents === null
              ? e.savings
              : (e.savings ?? 0) + o.estimatedSavingsCents;
          byStrategy.set(k, e);
        }
        const deadlines: PlanningDeadline[] = empty
          ? []
          : [
              {
                id: 'tax-q4',
                date: day(12),
                title: 'Q4 Estimated Tax Payment Due',
                description: 'Fourth-quarter estimated payment',
                scope: 'Individual & Business Clients',
                kind: 'TAX_DEADLINE',
              },
              {
                id: 'ms-yearend',
                date: day(40),
                title: 'Year-End Planning Meetings',
                description: 'Book year-end planning appointments',
                scope: 'All Planning Clients',
                kind: 'PLANNING_MILESTONE',
              },
              {
                id: 'tax-s',
                date: day(75),
                title: 'S Corporation Election Deadline',
                description: null,
                scope: 'Business Clients',
                kind: 'TAX_DEADLINE',
              },
            ];
        const kpi = (value: number) => ({
          value,
          deltaPercent: empty || value === 0 ? null : 12,
          comparedTo: empty || value === 0 ? null : 'vs last quarter',
        });
        return {
          activePlanningClients: kpi(rows.filter((r) => r.planId).length),
          upcomingAppointments: kpi(
            live.filter(
              (p) =>
                p.nextDiscussionOn && p.nextDiscussionOn >= day(0) && p.nextDiscussionOn <= day(30),
            ).length,
          ),
          strategiesInProgress: kpi(inProgress),
          projectedSavings: kpi(live.reduce((n, p) => n + (p.projectedSavingsCents ?? 0), 0)),
          recentClients: rows.filter((r) => r.planId).slice(0, 5),
          topOpportunities: [...byStrategy]
            .map(([k, e]) => ({
              strategyId: library.some((l) => l.id === k) ? k : null,
              name: e.name,
              category: e.category,
              clientCount: e.clients.size,
              estimatedSavingsCents: e.savings,
              firstOpportunityId: e.ids[0]!,
            }))
            .sort((a, b) => (b.estimatedSavingsCents ?? 0) - (a.estimatedSavingsCents ?? 0))
            .slice(0, 5),
          deadlines,
          resources: RESOURCES.filter((r) => r.clientFacing).slice(0, 5),
          disclaimer: TAX_PLANNING_DISCLAIMER,
          canCreatePlan: role !== 'STAFF',
          canSend: role !== 'STAFF',
        };
      }),
    clients: (q = {}) =>
      run(() => {
        const query = parseInput(PlanningClientsQuery, q);
        const term = query.search?.toLowerCase();
        let rows = refs
          .map(clientRow)
          .filter(
            (r) =>
              (!term || r.client.name.toLowerCase().includes(term)) &&
              (!query.status || r.status === query.status) &&
              (!query.planYear || r.planYear === query.planYear) &&
              (!query.entityType || r.entityLabel === query.entityType) &&
              (query.hasPlan === undefined || (query.hasPlan ? !!r.planId : !r.planId)),
          );
        const dir = query.direction === 'desc' ? -1 : 1;
        rows = rows.sort(
          (a, b) =>
            (query.sort === 'savings'
              ? (a.potentialSavingsCents ?? 0) - (b.potentialSavingsCents ?? 0)
              : query.sort === 'status'
                ? (a.status ?? '').localeCompare(b.status ?? '')
                : query.sort === 'nextAppointment'
                  ? (a.nextAppointmentAt ?? '9').localeCompare(b.nextAppointmentAt ?? '9')
                  : a.client.name.localeCompare(b.client.name)) * dir,
        );
        return page(rows, query.page, query.pageSize);
      }),
    plans: (q = {}) =>
      run(() => {
        const query = parseInput(TaxPlansQuery, q);
        const term = query.search?.toLowerCase();
        const rows = plans
          .filter(
            (p) =>
              (query.includeArchived || !p.archived) &&
              (!query.clientId || p.client.id === query.clientId) &&
              (!query.status || p.status === query.status) &&
              (!query.planYear || p.planYear === query.planYear) &&
              (!term || `${p.name} ${p.client.name}`.toLowerCase().includes(term)),
          )
          .map(rowOfPlan);
        return page(rows, query.page, query.pageSize);
      }),
    createPlan: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateTaxPlanRequest, body);
        const c = refOf(input.clientId);
        if (!c) throw fail(404, 'NOT_FOUND', 'That client was not found.');
        if (
          !input.allowDuplicate &&
          plans.some(
            (p) =>
              !p.archived &&
              p.client.id === c.id &&
              p.planYear === input.planYear &&
              p.name.toLowerCase() === input.name.toLowerCase(),
          )
        )
          throw fail(
            409,
            'DUPLICATE_PLAN',
            'This client already has a plan with that name for that year.',
          );
        const idx = refs.findIndex((r) => r.ref.id === c.id);
        const p = newPlan(idx, input.name, 'DRAFT', []);
        p.planYear = input.planYear;
        p.planType = input.planType;
        p.filingStatus = input.filingStatus ?? null;
        p.entityType = input.entityType ?? p.entityType;
        p.goals = input.goals;
        p.otherGoal = input.otherGoal ?? null;
        p.targetCompletionOn = input.targetCompletionOn ?? null;
        p.nextDiscussionOn = input.nextDiscussionOn ?? null;
        p.inputs = [];
        recompute(p);
        plans.unshift(p);
        return strip(p);
      }),
    plan: (pid) => run(() => strip(findPlan(pid))),
    updatePlan: (pid, body) =>
      run(() => {
        const input = parseInput(UpdateTaxPlanRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        const { etag: _e, ...fields } = input;
        void _e;
        Object.assign(
          p,
          Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        );
        return strip(recompute(p));
      }),
    inputCatalog: () => run(() => INPUT_CATALOG),
    saveInputs: (pid, body) =>
      run(() => {
        const input = parseInput(SavePlanInputsRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        if (role === 'STAFF')
          throw fail(403, 'FINANCIAL_INPUTS_RESTRICTED', 'The figures are restricted.');
        const keep = (p.inputs ?? []).filter(
          (x) => !input.inputs.some((n) => n.key === x.key && n.kind === x.kind),
        );
        p.inputs = [
          ...keep,
          ...input.inputs.map((n): PlanInput => ({
            key: n.key,
            label: INPUT_CATALOG.find((c) => c.key === n.key)?.label ?? n.key,
            kind: n.kind,
            taxYear: n.taxYear,
            amountCents: n.amountCents ?? null,
            textValue: n.textValue ?? null,
            source: n.source,
            asOf: n.asOf ?? nowIso(),
            note: n.note ?? null,
          })),
        ];
        return strip(recompute(p));
      }),
    addStrategy: (pid, body) =>
      run(() => {
        const input = parseInput(AddPlanStrategyRequest, body);
        const p = findPlan(pid);
        editable(p);
        if (input.kind === 'LIBRARY') {
          const l = library.find((x) => x.id === input.strategyId);
          if (!l) throw fail(404, 'NOT_FOUND', 'That strategy was not found.');
          if (p.strategies.some((s) => s.strategyId === l.id))
            throw fail(409, 'DUPLICATE_STRATEGY', 'That strategy is already in the plan.');
          const hasIncome = (p.inputs ?? []).some((i) => (i.amountCents ?? 0) > 0);
          p.strategies.push(
            planStrategy(
              l,
              p.strategies.length,
              hasIncome ? 150_000 + p.strategies.length * 90_000 : null,
            ),
          );
          if (input.priority) p.strategies[p.strategies.length - 1]!.priority = input.priority;
        } else {
          p.strategies.push({
            id: id('d300'),
            strategyId: null,
            name: input.name,
            category: input.category,
            custom: true,
            selected: true,
            priority: input.priority,
            status: 'PROPOSED',
            estimate: estimate(input.estimatedSavingsCents ?? null, 'Entered by staff'),
            overrideReason: null,
            overriddenBy: null,
            assumptions: input.assumptions ?? null,
            implementedOn: null,
            position: p.strategies.length,
          });
        }
        return strip(recompute(p));
      }),
    updateStrategy: (pid, sid, body) =>
      run(() => {
        const input = parseInput(UpdatePlanStrategyRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        const s = p.strategies.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That strategy is not in the plan.');
        if (input.selected !== undefined) s.selected = input.selected;
        if (input.priority) s.priority = input.priority;
        if (input.status) s.status = input.status;
        if (input.assumptions !== undefined) s.assumptions = input.assumptions;
        if (input.implementedOn !== undefined) s.implementedOn = input.implementedOn;
        if (input.overrideSavingsCents !== undefined) {
          if (role === 'STAFF')
            throw fail(403, 'OVERRIDE_NOT_ALLOWED', 'You may not override an estimate.');
          if (input.overrideSavingsCents === null) {
            s.estimate = { ...s.estimate, cents: s.estimate.modelCents, overridden: false };
            s.overrideReason = null;
            s.overriddenBy = null;
          } else {
            s.estimate = { ...s.estimate, cents: input.overrideSavingsCents, overridden: true };
            s.overrideReason = input.overrideReason ?? null;
            s.overriddenBy = mockMe;
          }
        }
        return strip(recompute(p));
      }),
    reorderStrategies: (pid, body) =>
      run(() => {
        const input = parseInput(ReorderPlanStrategiesRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        p.strategies = input.ids
          .map((x) => p.strategies.find((s) => s.id === x))
          .filter((s): s is PlanStrategy => !!s)
          .map((s, i) => ({ ...s, position: i }));
        return strip(recompute(p));
      }),
    recalculate: (pid) =>
      run(() => {
        const p = findPlan(pid);
        editable(p);
        return strip(recompute(p));
      }),
    attachDocument: (pid, body) =>
      run(() => {
        const input = parseInput(AttachPlanDocumentRequest, body);
        const p = findPlan(pid);
        editable(p);
        p.documents.push({
          documentId: input.documentId,
          fileName: 'Client_Document.pdf',
          category: input.category ?? null,
          planStrategyId: input.planStrategyId ?? null,
          addedBy: mockMe,
          addedAt: nowIso(),
        });
        return strip(p);
      }),
    detachDocument: (pid, did) =>
      run(() => {
        const p = findPlan(pid);
        editable(p);
        p.documents = p.documents.filter((d) => d.documentId !== did);
        return strip(p);
      }),
    setStatus: (pid, body) =>
      run(() => {
        const input = parseInput(SetPlanStatusRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        if (
          input.status === 'IMPLEMENTED' &&
          !p.strategies.some((s) => s.status === 'IN_PROGRESS' || s.status === 'IMPLEMENTED')
        )
          throw fail(
            409,
            'INVALID_STATUS',
            'Start a strategy before marking the plan implemented.',
          );
        if (input.status === 'DRAFT' && p.version > 1)
          throw fail(409, 'INVALID_STATUS', 'A plan that was finalized cannot go back to draft.');
        p.status = input.status;
        return strip(recompute(p));
      }),
    finalize: (pid, body) =>
      run(() => {
        const input = parseInput(FinalizePlanRequest, body);
        const p = findPlan(pid);
        editable(p);
        conflict(p, input.etag);
        if (p.strategies.filter((s) => s.selected).length === 0)
          throw fail(409, 'PLAN_NOT_READY', 'Select at least one strategy before finalizing.');
        p.version += 1;
        p.status = p.status === 'DRAFT' ? 'READY_FOR_REVIEW' : p.status;
        p._versions.unshift({
          version: p.version,
          event: 'FINALIZED',
          taxYear: p.planYear,
          sourceDataAsOf: nowIso(),
          createdBy: mockMe,
          createdAt: nowIso(),
          planName: p.name,
          strategies: p.strategies
            .filter((s) => s.selected)
            .map((s) => ({
              name: s.name,
              category: s.category,
              priority: s.priority,
              estimate: s.estimate,
              assumptions: s.assumptions,
            })),
          inputs: p.inputs,
          projectedSavingsCents: p.projectedSavingsCents,
          disclaimer: TAX_PLANNING_DISCLAIMER,
        });
        return strip(recompute(p));
      }),
    send: (pid, body) =>
      run(() => {
        const input = parseInput(SendPlanRequest, body);
        void input;
        const p = findPlan(pid);
        editable(p);
        if (p._versions.length === 0)
          throw fail(409, 'PLAN_NOT_READY', 'Finalize the plan before sending it.');
        p._versions.unshift({
          ...copy(p._versions[0]!),
          version: p.version,
          event: 'SENT',
          createdAt: nowIso(),
        });
        return strip(p);
      }),
    archivePlan: (pid) =>
      run(() => {
        manage();
        const p = findPlan(pid);
        p.archived = true;
        return strip(p);
      }),
    restorePlan: (pid) =>
      run(() => {
        manage();
        const p = findPlan(pid);
        p.archived = false;
        return strip(p);
      }),
    versions: (pid) =>
      run(() =>
        findPlan(pid)._versions.map(
          ({ version, event, taxYear, sourceDataAsOf, createdBy, createdAt }) => ({
            version,
            event,
            taxYear,
            sourceDataAsOf,
            createdBy,
            createdAt,
          }),
        ),
      ),
    version: (pid, v) =>
      run(() => {
        const x = findPlan(pid)._versions.find((r) => r.version === v);
        if (!x) throw fail(404, 'NOT_FOUND', 'That version was not found.');
        return x;
      }),

    strategies: (q = {}) =>
      run(() => {
        const query = parseInput(PlanningStrategiesQuery, q);
        const term = query.search?.toLowerCase();
        return page(
          library.filter(
            (s) =>
              (query.includeArchived || !s.archived) &&
              (!query.category || s.category === query.category) &&
              (query.active === undefined || s.active === query.active) &&
              (!term || s.name.toLowerCase().includes(term)),
          ),
          query.page,
          query.pageSize,
        );
      }),
    createStrategy: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreatePlanningStrategyRequest, body);
        if (library.some((s) => !s.archived && s.name.toLowerCase() === input.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME', 'A strategy with this name already exists.');
        const s: PlanningStrategy = {
          id: id('d200'),
          name: input.name,
          category: input.category,
          description: input.description ?? null,
          defaultPriority: input.defaultPriority,
          eligibility: input.eligibility,
          requiredInputs: input.requiredInputs,
          requiredDocuments: input.requiredDocuments,
          implementationChecklist: input.implementationChecklist,
          active: true,
          archived: false,
          planCount: 0,
          openOpportunityCount: 0,
          updatedAt: nowIso(),
        };
        library.unshift(s);
        return s;
      }),
    libraryStrategy: (sid) =>
      run(() => {
        const s = library.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That strategy was not found.');
        return s;
      }),
    updateLibraryStrategy: (sid, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdatePlanningStrategyRequest, body);
        const s = library.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That strategy was not found.');
        if (
          input.name &&
          library.some(
            (x) =>
              x.id !== s.id && !x.archived && x.name.toLowerCase() === input.name!.toLowerCase(),
          )
        )
          throw fail(409, 'DUPLICATE_NAME', 'A strategy with this name already exists.');
        Object.assign(
          s,
          Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        );
        s.updatedAt = nowIso();
        return s;
      }),
    archiveLibraryStrategy: (sid) =>
      run(() => {
        manage();
        const s = library.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That strategy was not found.');
        s.archived = true;
        return s;
      }),
    restoreLibraryStrategy: (sid) =>
      run(() => {
        manage();
        const s = library.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That strategy was not found.');
        s.archived = false;
        return s;
      }),

    opportunities: (q = {}) =>
      run(() => {
        const query = parseInput(TaxOpportunitiesQuery, q);
        const term = query.search?.toLowerCase();
        const dir = query.direction === 'asc' ? 1 : -1;
        const pr = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
        const rows = opps
          .filter(
            (o) =>
              (!query.status || o.status === query.status) &&
              (!query.group ||
                (query.group === 'open' ? OPEN.includes(o.status) : !OPEN.includes(o.status))) &&
              (!query.category || o.category === query.category) &&
              (!query.priority || o.priority === query.priority) &&
              (!query.source || o.source === query.source) &&
              (!query.clientId || o.client.id === query.clientId) &&
              (!query.strategyId || o.strategyId === query.strategyId) &&
              (!term || `${o.name} ${o.client.name}`.toLowerCase().includes(term)),
          )
          .sort(
            (a, b) =>
              (query.sort === 'priority'
                ? pr[a.priority] - pr[b.priority]
                : query.sort === 'client'
                  ? a.client.name.localeCompare(b.client.name)
                  : query.sort === 'updated'
                    ? a.updatedAt.localeCompare(b.updatedAt)
                    : (a.estimatedSavingsCents ?? -1) - (b.estimatedSavingsCents ?? -1)) * dir,
          )
          .map((o) => strip(o) as never as TaxOpportunityDetail)
          .map(
            ({
              description: _d,
              ruleId: _r,
              whyExplanation: _w,
              missingData: _m,
              clientDataUsed: _c,
              estimate: _e,
              impact: _i,
              recommendedActions: _ra,
              eligibility: _el,
              documentsNeeded: _dn,
              plan: _p,
              discussionOn: _do,
              reviewed: _rv,
              reviewedBy: _rb,
              dispositionReason: _dr,
              suppressedUntil: _su,
              implementedOn: _io,
              previousId: _pi,
              nextId: _ni,
              candidatePlans: _cp,
              disclaimer: _di,
              canReview: _cr,
              createdAt: _ca,
              etag: _et,
              ...row
            }) => (
              void [
                _d,
                _r,
                _w,
                _m,
                _c,
                _e,
                _i,
                _ra,
                _el,
                _dn,
                _p,
                _do,
                _rv,
                _rb,
                _dr,
                _su,
                _io,
                _pi,
                _ni,
                _cp,
                _di,
                _cr,
                _ca,
                _et,
              ],
              row
            ),
          );
        return page(rows, query.page, query.pageSize);
      }),
    opportunity: (oid, q = {}) =>
      run(() => {
        const query = parseInput(TaxOpportunitiesQuery, q);
        void query;
        const o = findOpp(oid);
        const queue = opps.filter((x) => OPEN.includes(x.status));
        const at = queue.findIndex((x) => x.id === oid);
        o.previousId = at > 0 ? queue[at - 1]!.id : null;
        o.nextId = at >= 0 && at < queue.length - 1 ? queue[at + 1]!.id : null;
        o.candidatePlans = plans
          .filter((p) => p.client.id === o.client.id && !p.archived)
          .map((p) => ({ id: p.id, name: p.name, planYear: p.planYear }));
        return strip(o);
      }),
    createOpportunity: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateTaxOpportunityRequest, body);
        const c = refOf(input.clientId);
        if (!c) throw fail(404, 'NOT_FOUND', 'That client was not found.');
        const dup = opps.find(
          (o) =>
            o.client.id === c.id &&
            o.strategyId &&
            o.strategyId === input.strategyId &&
            o.taxYear === input.taxYear &&
            OPEN.includes(o.status),
        );
        if (dup)
          throw fail(
            409,
            'DUPLICATE_OPPORTUNITY',
            'This client already has an open opportunity for that strategy.',
          );
        const o = oppFor(opps.length);
        Object.assign(o, {
          client: c,
          name: input.name,
          category: input.category,
          priority: input.priority,
          status: 'NEW',
          source: 'STAFF',
          taxYear: input.taxYear,
          strategyId: input.strategyId ?? null,
          description: input.description ?? null,
          estimatedSavingsCents: input.estimatedSavingsCents ?? null,
          assignedTo: null,
        });
        o.estimate = estimate(
          input.estimatedSavingsCents ?? null,
          input.estimateBasis ?? 'Entered by staff',
        );
        o.recommendedActions = input.recommendedActions;
        o.documentsNeeded = input.documentsNeeded.map((label, index) => ({
          index,
          label,
          received: false,
        }));
        opps.unshift(o);
        return strip(o);
      }),
    opportunityAction: (oid, body) =>
      run(() => {
        if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
        const input = parseInput(OpportunityActionRequest, body);
        const o = findOpp(oid);
        if (input.etag && input.etag !== o.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone acted on this after you opened it.');
        const from = o.status;
        const to = (s: TaxOpportunityDetail['status']) => {
          o.status = s;
          addEvent(o, 'STATUS', from, s, null);
        };
        switch (input.action) {
          case 'START_REVIEW':
            if (from !== 'NEW')
              throw fail(409, 'INVALID_STATUS', 'Only a new opportunity can start review.');
            to('UNDER_REVIEW');
            o.reviewed = true;
            o.reviewedBy = mockMe;
            break;
          case 'ADD_TO_PLAN': {
            let plan = input.planId ? plans.find((p) => p.id === input.planId) : undefined;
            if (!plan) {
              const idx = refs.findIndex((r) => r.ref.id === o.client.id);
              plan = newPlan(idx, `${YEAR} Plan`, 'DRAFT', []);
              plans.unshift(plan);
            }
            const lib = library.find((l) => l.id === o.strategyId);
            if (lib && !plan.strategies.some((s) => s.strategyId === lib.id))
              plan.strategies.push(
                planStrategy(lib, plan.strategies.length, o.estimatedSavingsCents),
              );
            recompute(plan);
            o.plan = { id: plan.id, name: plan.name };
            o.planId = plan.id;
            to('ADDED_TO_PLAN');
            break;
          }
          case 'ASSIGN':
            o.assignedTo = input.userId ? ALEX : null;
            if (input.userId) to('ASSIGNED');
            addEvent(o, 'ASSIGNED', null, null, null);
            break;
          case 'SCHEDULE_DISCUSSION':
            o.discussionOn = input.on;
            to('DISCUSSION_SCHEDULED');
            break;
          case 'SET_DOCUMENT': {
            const d = o.documentsNeeded.find((x) => x.index === input.index);
            if (d) d.received = input.received;
            addEvent(o, 'DOCUMENTS', null, null, null);
            break;
          }
          case 'MARK_NOT_APPLICABLE':
            o.dispositionReason = input.reason;
            to('NOT_APPLICABLE');
            break;
          case 'DISMISS':
            o.dispositionReason = input.reason;
            o.suppressedUntil = input.suppressedUntil ?? null;
            to('DISMISSED');
            break;
          case 'MARK_IMPLEMENTED':
            o.implementedOn = input.on;
            to('IMPLEMENTED');
            break;
          case 'CLOSE':
            to('CLOSED');
            break;
          case 'REOPEN':
            if (OPEN.includes(from)) throw fail(409, 'INVALID_STATUS', 'It is already open.');
            to('UNDER_REVIEW');
            break;
          case 'ADD_NOTE':
            addEvent(o, 'NOTE', null, null, input.note);
            break;
        }
        o.etag = `e${next++}`;
        o.updatedAt = nowIso();
        return strip(o);
      }),
    opportunityEvents: (oid) => run(() => findOpp(oid)._events),
    runScreening: (body = {}) =>
      run(() => {
        manage();
        parseInput(RunScreeningRequest, body);
        return {
          clientsScreened: refs.length,
          created: 0,
          updated: opps.length,
          skippedSuppressed: 0,
          queued: false,
        };
      }),

    calculate: (body) => run(() => compute(parseInput(CalculateSavingsRequest, body))),
    saveScenario: (body) =>
      run(() => {
        const input = parseInput(SaveScenarioRequest, body);
        const calc = input.calculation;
        const s: TaxScenario = {
          id: id('d600'),
          name: input.name ?? null,
          client: calc.clientId ? (refOf(calc.clientId) ?? null) : null,
          plan: input.planId
            ? (() => {
                const p = findPlan(input.planId!);
                return { id: p.id, name: p.name };
              })()
            : null,
          taxYear: calc.taxYear,
          filingStatus: calc.filingStatus ?? null,
          baseline: calc.baseline,
          strategy: calc.strategy,
          result: compute(calc),
          savedToPlanAt: input.planId ? nowIso() : null,
          createdBy: mockMe,
          createdAt: nowIso(),
        };
        scenarios.unshift(s);
        return s;
      }),
    scenarios: (q = {}) =>
      run(() => {
        const query = parseInput(TaxScenariosQuery, q);
        return page(
          scenarios.filter(
            (s) =>
              (!query.clientId || s.client?.id === query.clientId) &&
              (!query.planId || s.plan?.id === query.planId),
          ),
          query.page,
          query.pageSize,
        );
      }),
    scenario: (sid) =>
      run(() => {
        const s = scenarios.find((x) => x.id === sid);
        if (!s) throw fail(404, 'NOT_FOUND', 'That scenario was not found.');
        return s;
      }),

    calendar: (q) =>
      run(() => {
        const query = parseInput(PlanningCalendarQuery, q);
        const items: PlanningDeadline[] = empty
          ? []
          : [
              {
                id: 'tax-q4',
                date: day(12),
                title: 'Q4 Estimated Tax Payment Due',
                description: 'Fourth-quarter estimated payment',
                scope: 'Individual & Business Clients',
                kind: 'TAX_DEADLINE',
              },
              {
                id: 'ms-yearend',
                date: day(40),
                title: 'Year-End Planning Meetings',
                description: 'Book year-end planning appointments',
                scope: 'All Planning Clients',
                kind: 'PLANNING_MILESTONE',
              },
              {
                id: 'tax-s',
                date: day(75),
                title: 'S Corporation Election Deadline',
                description: null,
                scope: 'Business Clients',
                kind: 'TAX_DEADLINE',
              },
              {
                id: 'tax-ext',
                date: day(150),
                title: 'Extension Deadline',
                description: 'Individual returns on extension',
                scope: 'Individual Clients',
                kind: 'TAX_DEADLINE',
              },
              ...plans
                .filter((p) => p.nextDiscussionOn)
                .map((p) => ({
                  id: `ms-${p.id}`,
                  date: p.nextDiscussionOn!,
                  title: `Planning discussion: ${p.client.name}`,
                  description: p.name,
                  scope: p.client.name,
                  kind: 'PLANNING_MILESTONE' as const,
                })),
            ];
        return items
          .filter((d) => d.date >= query.from && d.date <= query.to)
          .sort((a, b) => a.date.localeCompare(b.date));
      }),
    resources: (q = {}) =>
      run(() => {
        const query = parseInput(PlanningResourcesQuery, q);
        const term = query.search?.toLowerCase();
        return RESOURCES.filter(
          (r) =>
            (!query.category || r.category === query.category) &&
            (!query.kind || r.kind === query.kind) &&
            (!term || r.title.toLowerCase().includes(term)),
        );
      }),
    sendResource: (key, body) =>
      run(() => {
        manage();
        const input = parseInput(SendPlanningResourceRequest, body);
        const r = RESOURCES.find((x) => x.key === key);
        if (!r) throw fail(404, 'NOT_FOUND', 'That resource was not found.');
        if (!r.clientFacing) throw fail(409, 'INVALID_STATUS', 'That resource is for staff only.');
        if (!refOf(input.clientId)) throw fail(404, 'NOT_FOUND', 'That client was not found.');
        return { ok: true as const };
      }),
  };
}
