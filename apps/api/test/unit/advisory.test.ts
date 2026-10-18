import { describe, expect, it } from 'vitest';
import {
  advErrors,
  effectiveGoalStatus,
  mergeDocument,
  money,
  permsOf,
  settleProgress,
  slug,
  todayIn,
} from '../../src/advisory/advisory.common.js';
import { RESOURCES, resourceOf, toResource } from '../../src/advisory/catalog.js';
import {
  computeHealth,
  DEFAULT_FORMULA,
  FACTORS,
  FACTOR_KEYS,
  factorValues,
  formulaOf,
  formulaVersion,
  type HealthInput,
} from '../../src/advisory/health.js';
import {
  CreateGoalBody,
  CreatePlanBody,
  UpdatePlanBody,
} from '../../src/advisory/advisory-input.js';

const staff = (role: string) =>
  ({ kind: 'staff', businessId: 'b', role }) as unknown as Parameters<typeof permsOf>[0];

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  periods: [
    {
      revenueCents: 1_200_000,
      netProfitCents: 300_000,
      cashFlowCents: 50_000,
      debtCents: 200_000,
      budgetRevenueCents: null,
    },
    {
      revenueCents: 1_000_000,
      netProfitCents: 200_000,
      cashFlowCents: null,
      debtCents: null,
      budgetRevenueCents: null,
    },
  ],
  goalProgress: [],
  actionsDone: 0,
  actionsCounted: 0,
  ...over,
});

describe('the Business Health Score', () => {
  it('values each factor from 0 to 100, or leaves it without a value when its data is missing', () => {
    const v = factorValues(input());
    // +20% revenue is 100, a 25% margin is 100, positive cash flow is 100, debt of a sixth of revenue is 100.
    expect(v).toMatchObject({
      revenue_trend: 100,
      profit_margin: 100,
      cash_flow: 100,
      debt_ratio: 100,
      goal_progress: null,
      action_completion: null,
      budget_variance: null,
    });
    const flat = factorValues(
      input({
        periods: [
          {
            revenueCents: 1_000_000,
            netProfitCents: 0,
            cashFlowCents: -1,
            debtCents: 1_500_000,
            budgetRevenueCents: 2_000_000,
          },
          {
            revenueCents: 1_000_000,
            netProfitCents: 0,
            cashFlowCents: null,
            debtCents: null,
            budgetRevenueCents: null,
          },
        ],
        goalProgress: [20, 40],
        actionsDone: 1,
        actionsCounted: 4,
      }),
    );
    expect(flat).toMatchObject({
      revenue_trend: 50,
      profit_margin: 0,
      cash_flow: 0,
      debt_ratio: 0,
      goal_progress: 30,
      action_completion: 25,
      budget_variance: 50,
    });
    // Revenue down a lot is 0, and nothing is ever outside 0 to 100.
    const drop = factorValues(
      input({
        periods: [
          {
            revenueCents: 100,
            netProfitCents: -1_000,
            cashFlowCents: 0,
            debtCents: 0,
            budgetRevenueCents: 1,
          },
          {
            revenueCents: 1_000_000,
            netProfitCents: null,
            cashFlowCents: null,
            debtCents: null,
            budgetRevenueCents: null,
          },
        ],
      }),
    );
    expect(drop).toMatchObject({
      revenue_trend: 0,
      profit_margin: 0,
      cash_flow: 50,
      debt_ratio: 100,
      budget_variance: 100,
    });
    expect(
      factorValues({ periods: [], goalProgress: [], actionsDone: 0, actionsCounted: 0 }),
    ).toMatchObject({
      revenue_trend: null,
      profit_margin: null,
      cash_flow: null,
      debt_ratio: null,
    });
    // No prior period: no trend. No revenue: no margin and no debt ratio.
    expect(
      factorValues(
        input({
          periods: [
            {
              revenueCents: 5,
              netProfitCents: 1,
              cashFlowCents: null,
              debtCents: 1,
              budgetRevenueCents: null,
            },
          ],
        }),
      ).revenue_trend,
    ).toBeNull();
    expect(
      factorValues(
        input({
          periods: [
            {
              revenueCents: 0,
              netProfitCents: 1,
              cashFlowCents: null,
              debtCents: 1,
              budgetRevenueCents: null,
            },
          ],
        }),
      ),
    ).toMatchObject({
      profit_margin: null,
      debt_ratio: null,
    });
  });

  it('weights the factors by the formula and re-weights what is left when one is missing', () => {
    expect(DEFAULT_FORMULA.reduce((n, f) => n + f.weight, 0)).toBe(100);
    const r = computeHealth(DEFAULT_FORMULA, input({ goalProgress: [0] }));
    // 20+20+10+15 at 100 and goal progress (15) at 0, over the 80 that have a value.
    expect(r.score).toBe(Math.round(6500 / 80));
    expect(r.factors).toHaveLength(DEFAULT_FORMULA.length);
    expect(r.factors.find((f) => f.factor === 'budget_variance')?.value).toBeNull();
    expect(r.factors.every((f) => f.label.length > 0 && (f.explanation ?? '').length > 0)).toBe(
      true,
    );
    // A formula of two factors uses only those.
    const two = computeHealth(
      [
        { factor: 'profit_margin', weight: 50 },
        { factor: 'goal_progress', weight: 50 },
      ],
      input({ goalProgress: [0] }),
    );
    expect(two.score).toBe(50);
    // No data at all: no score, never a made-up one.
    const none = computeHealth(DEFAULT_FORMULA, {
      periods: [],
      goalProgress: [],
      actionsDone: 0,
      actionsCounted: 0,
    });
    expect(none.score).toBeNull();
    // A factor with weight 0 does not count.
    expect(
      computeHealth(
        [
          { factor: 'profit_margin', weight: 0 },
          { factor: 'cash_flow', weight: 100 },
        ],
        input(),
      ).score,
    ).toBe(100);
  });

  it('reads the stored formula, falls back to the default and fingerprints weights', () => {
    expect(formulaOf(undefined)).toEqual(DEFAULT_FORMULA);
    expect(formulaOf([])).toEqual(DEFAULT_FORMULA);
    expect(formulaOf([{ factor: 'nope', weight: 100 }])).toEqual(DEFAULT_FORMULA);
    expect(
      formulaOf([
        { factor: 'profit_margin', weight: 60 },
        { factor: 'nope', weight: 10 },
        { factor: 'cash_flow', weight: 40 },
      ]),
    ).toEqual([
      { factor: 'profit_margin', weight: 60 },
      { factor: 'cash_flow', weight: 40 },
    ]);
    expect(FACTORS.every((f) => FACTOR_KEYS.has(f.factor))).toBe(true);
    const a = formulaVersion([{ factor: 'x', weight: 1 }]);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(formulaVersion([{ factor: 'x', weight: 2 }])).not.toBe(a);
    expect(formulaVersion([{ factor: 'x', weight: 1 }])).toBe(a);
  });
});

describe('goals, words and documents', () => {
  const current = { status: 'IN_PROGRESS' as const, progressPercent: 40, completedAt: null };

  it('keeps a status and its progress together', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    expect(settleProgress(current, { status: 'COMPLETED' }, now)).toEqual({
      status: 'COMPLETED',
      progressPercent: 100,
      completedAt: now,
    });
    expect(settleProgress(current, { progressPercent: 70 })).toMatchObject({
      status: 'IN_PROGRESS',
      progressPercent: 70,
    });
    expect(settleProgress(current, { status: 'NOT_STARTED' })).toMatchObject({
      progressPercent: 0,
      completedAt: null,
    });
    const done = { status: 'COMPLETED' as const, progressPercent: 100, completedAt: now };
    // Reopening keeps the progress and drops the completion time; the completion time stays when it stays completed.
    expect(settleProgress(done, { status: 'IN_PROGRESS' })).toEqual({
      status: 'IN_PROGRESS',
      progressPercent: 100,
      completedAt: null,
    });
    expect(settleProgress(done, { progressPercent: 100 }).completedAt).toBe(now);
    for (const bad of [
      [current, { status: 'COMPLETED', progressPercent: 50 }],
      [done, { progressPercent: 50 }],
      [current, { status: 'NOT_STARTED', progressPercent: 10 }],
    ] as const)
      expect(() => settleProgress(bad[0], bad[1])).toThrow();
  });

  it('shows an open goal past its target date as overdue', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    expect(effectiveGoalStatus('IN_PROGRESS', past, '2026-01-02')).toBe('OVERDUE');
    expect(effectiveGoalStatus('IN_PROGRESS', past, '2026-01-01')).toBe('IN_PROGRESS');
    expect(effectiveGoalStatus('COMPLETED', past, '2026-06-01')).toBe('COMPLETED');
    expect(effectiveGoalStatus('CANCELLED', past, '2026-06-01')).toBe('CANCELLED');
    expect(effectiveGoalStatus('AT_RISK', null, '2026-06-01')).toBe('AT_RISK');
    expect(effectiveGoalStatus('AT_RISK', past, '2026-06-01')).toBe('OVERDUE');
  });

  it('normalizes grouping words and refuses what the columns do not hold', () => {
    expect(slug('Revenue Growth', 'area')).toBe('revenue_growth');
    expect(slug('  tax-strategy ', 'category')).toBe('tax_strategy');
    expect(slug(null, 'area')).toBeNull();
    expect(slug(undefined, 'area')).toBeUndefined();
    for (const bad of ['', '1abc', '!!', 'a'.repeat(61)]) expect(() => slug(bad, 'area')).toThrow();
    expect(money(123_456)).toBe('$1,235');
    expect(todayIn('America/New_York', new Date('2026-06-02T02:30:00Z'))).toBe('2026-06-01');
  });

  it('merges a document at its top-level keys, and removes a key sent as null', () => {
    expect(mergeDocument({ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 3 })).toEqual({
      a: 1,
      b: { y: 2 },
      c: 3,
    });
    expect(mergeDocument({ a: 1, b: 2 }, { a: null })).toEqual({ b: 2 });
    expect(mergeDocument(null, undefined)).toEqual({});
    expect(mergeDocument({ a: 1 }, {})).toEqual({ a: 1 });
    const stored = { a: 1 };
    mergeDocument(stored, { a: 2 });
    expect(stored).toEqual({ a: 1 });
  });
});

describe('who may do what, the library and the request schemas', () => {
  it('gives Owner and Admin everything, Staff the day-to-day, and the grid roles their row', () => {
    for (const role of ['OWNER', 'ADMIN'])
      expect(permsOf(staff(role))).toMatchObject({
        admin: true,
        createPlans: true,
        editPlans: true,
        manageGoals: true,
        manageRecs: true,
        viewFinancials: true,
        override: true,
        manageServices: true,
        send: true,
        advisoryAdmin: true,
      });
    expect(permsOf(staff('STAFF'))).toMatchObject({
      admin: false,
      createPlans: true,
      editPlans: true,
      viewFinancials: true,
      send: true,
      override: false,
      advisoryAdmin: false,
    });
    // A Tax Preparer has View only on Business Advisory.
    expect(Object.values(permsOf(staff('TAX_PREPARER'))).every((v) => v === false)).toBe(true);
    expect(Object.values(permsOf(undefined)).every((v) => v === false)).toBe(true);
    expect(Object.values(permsOf({ kind: 'client' } as never)).every((v) => v === false)).toBe(
      true,
    );
  });

  it('has unique resources and sends only client-facing ones', () => {
    const keys = RESOURCES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(resourceOf('nope')).toBeUndefined();
    expect(Object.keys(toResource(RESOURCES[0] as never))).not.toContain('summary');
    expect(RESOURCES.some((r) => !r.clientFacing)).toBe(true);
    expect(advErrors.invalid('x', 'y').getStatus()).toBe(400);
    expect(advErrors.planNotReady(['a']).getStatus()).toBe(409);
  });

  it('refuses what Postgres cannot hold', () => {
    const id = crypto.randomUUID();
    expect(
      CreatePlanBody.safeParse({ advisoryClientId: id, name: 'Plan', targetYear: 2026 }).success,
    ).toBe(true);
    expect(
      CreatePlanBody.safeParse({ advisoryClientId: id, name: 'a\u0000b', targetYear: 2026 })
        .success,
    ).toBe(false);
    expect(
      CreatePlanBody.safeParse({ advisoryClientId: id, name: '\ud800', targetYear: 2026 }).success,
    ).toBe(false);
    expect(
      CreatePlanBody.safeParse({
        advisoryClientId: id,
        name: 'Plan',
        targetYear: 2026,
        profile: { website: 'x\u0000' },
      }).success,
    ).toBe(false);
    expect(
      CreateGoalBody.safeParse({ advisoryClientId: id, title: 'Goal', targetDate: '0000-01-01' })
        .success,
    ).toBe(false);
    expect(
      CreateGoalBody.safeParse({ advisoryClientId: id, title: 'Goal', targetDate: '2026-01-01' })
        .success,
    ).toBe(true);
    expect(UpdatePlanBody.safeParse({ etag: 'e' }).success).toBe(false);
    expect(UpdatePlanBody.safeParse({ etag: 'e', profile: { ein: '12-3456789' } }).success).toBe(
      false,
    );
  });
});
