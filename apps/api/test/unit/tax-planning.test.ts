import { describe, expect, it } from 'vitest';
import {
  INPUT_CATALOG,
  RESOURCES,
  resourceOf,
  toResource,
} from '../../src/tax-planning/catalog.js';
import {
  CalculateBody,
  CreatePlanBody,
  SaveScenarioBody,
  UpdatePlanBody,
} from '../../src/tax-planning/tax-planning-input.js';
import {
  effectiveCents,
  estimateView,
  figuresOf,
  isStale,
  permsOf,
  planTotals,
  todayIn,
} from '../../src/tax-planning/tax-planning.common.js';
import {
  calculateSavings,
  effectiveRateBp,
  estimateStrategy,
  groupOf,
  roomUnderLimit,
  standardDeductionCents,
  tableFor,
  taxOn,
} from '../../src/tax-planning/tax-tables.js';
import { RULES } from '../../src/tax-planning/screening.service.js';

const staff = (role: string) =>
  ({ kind: 'staff', businessId: 'b', role }) as unknown as Parameters<typeof permsOf>[0];
const fig = (
  amountCents: number,
  taxYear = 2026,
  kind: 'HISTORICAL' | 'PROJECTED' | 'ADJUSTMENT' = 'PROJECTED',
) => ({
  amountCents,
  taxYear,
  kind,
});

describe('the tax tables', () => {
  it('taxes income band by band, with the bands of each filing status', () => {
    const t = tableFor(2026);
    if (!t) throw new Error('no table');
    expect(taxOn(t, 'single', 0)).toBe(0);
    // 10% of $12,400, then 12% of the rest up to $50,400.
    expect(taxOn(t, 'single', 1_240_000)).toBe(124_000);
    expect(taxOn(t, 'single', 3_000_000)).toBe(124_000 + Math.round(1_760_000 * 0.12));
    expect(taxOn(t, 'single', 8_390_000)).toBe(1_317_000);
    expect(taxOn(t, 'joint', 7_000_000)).toBeLessThan(taxOn(t, 'single', 7_000_000));
    expect(standardDeductionCents(t, 'joint')).toBe(3_220_000);
    expect(groupOf('QUALIFYING_SURVIVING_SPOUSE')).toBe('joint');
    expect(groupOf('MARRIED_FILING_SEPARATELY')).toBe('separate');
    expect(groupOf('HEAD_OF_HOUSEHOLD')).toBe('head');
    expect(tableFor(2025)).toBeDefined();
    expect(tableFor(2024)).toBeUndefined();
  });

  it('has top bands that never stop, so any income is taxed', () => {
    const t = tableFor(2025);
    if (!t) throw new Error('no table');
    expect(taxOn(t, 'single', 100_000_000_000)).toBeGreaterThan(0);
    // Marginal tax is never negative and never falls as income grows.
    let last = 0;
    for (let income = 0; income <= 100_000_000; income += 1_234_567) {
      const tax = taxOn(t, 'head', income);
      expect(tax).toBeGreaterThanOrEqual(last);
      last = tax;
    }
  });

  it('works out the calculator’s saving and its difference exactly', () => {
    const base = {
      taxYear: 2026,
      filingStatus: 'SINGLE' as const,
      baseline: { wagesCents: 10_000_000 },
      strategy: { retirementContributionCents: 1_000_000 },
    };
    const r = calculateSavings(base);
    expect(r).toMatchObject({
      baselineTaxCents: 1_317_000,
      modeledTaxCents: 1_097_000,
      differenceCents: 220_000,
      unavailableReason: null,
    });
    expect((r.baselineTaxCents ?? 0) - (r.modeledTaxCents ?? 0)).toBe(r.differenceCents);
    // Itemizing beyond the standard deduction replaces it.
    const itemized = calculateSavings({
      ...base,
      baseline: { wagesCents: 10_000_000, itemizedDeductionsCents: 2_000_000 },
    });
    expect(itemized.baselineTaxCents).toBeLessThan(r.baselineTaxCents ?? 0);
    // Deductions beyond the income cannot make tax negative.
    expect(
      calculateSavings({ ...base, strategy: { otherDeductionCents: 90_000_000 } }).modeledTaxCents,
    ).toBe(0);
    expect(
      calculateSavings({ ...base, baseline: { wagesCents: 10_000_000, creditsCents: 99_999_999 } })
        .baselineTaxCents,
    ).toBe(0);
  });

  it('says why it cannot, and never guesses', () => {
    const base = { taxYear: 2026, baseline: { wagesCents: 1 }, strategy: {} };
    for (const [input, reason] of [
      [{ ...base }, /filing status/],
      [{ ...base, filingStatus: 'SINGLE' as const, taxYear: 2031 }, /2031/],
      [{ ...base, filingStatus: 'SINGLE' as const, baseline: {} }, /income/],
      [
        {
          ...base,
          filingStatus: 'SINGLE' as const,
          baseline: { wagesCents: 1, capitalGainsCents: 1 },
        },
        /Capital gains/,
      ],
    ] as const) {
      const r = calculateSavings(input);
      expect(r.baselineTaxCents).toBeNull();
      expect(r.modeledTaxCents).toBeNull();
      expect(r.differenceCents).toBeNull();
      expect(r.unavailableReason).toMatch(reason);
      expect(r.assumptions.length).toBeGreaterThan(0);
    }
  });
});

describe('the strategy estimate', () => {
  const figures = new Map([
    ['taxable_income', fig(10_000_000)],
    ['retirement_contributions', fig(1_000_000)],
    ['hsa_contributions', fig(0, 2025)],
  ]);
  const input = (requiredInputs: string[], over: object = {}) => ({
    requiredInputs,
    planYear: 2026,
    filingStatus: 'SINGLE' as const,
    figures,
    ...over,
  });

  it('prices the room left under a limit at the plan’s marginal rates', () => {
    // $24,500 limit less $10,000 deferred, all in the 22% band.
    expect(estimateStrategy(input(['retirement_contributions']))).toMatchObject({
      cents: 319_000,
      dataYear: 2026,
      reason: null,
    });
    // The HSA figure is of 2025, so the data year is the older one.
    expect(estimateStrategy(input(['hsa_contributions']))).toMatchObject({
      cents: Math.round(440_000 * 0.22),
      dataYear: 2025,
    });
    // No room, no saving.
    expect(
      estimateStrategy(
        input(['retirement_contributions'], {
          figures: new Map([...figures, ['retirement_contributions', fig(2_450_000)]]),
        }),
      ).cents,
    ).toBe(0);
  });

  it('reads AGI less the standard deduction when taxable income is missing', () => {
    const agi = new Map([
      ['agi', fig(11_610_000, 2025, 'HISTORICAL')],
      ['retirement_contributions', fig(1_000_000)],
    ]);
    // $116,100 - $16,100 = $100,000, the same as above.
    expect(estimateStrategy(input(['retirement_contributions'], { figures: agi })).cents).toBe(
      319_000,
    );
  });

  it('is unavailable, with a reason, when a figure, a model or a table is missing', () => {
    const none = (over: object) => estimateStrategy(input(['retirement_contributions'], over));
    expect(none({ figures: new Map() }).reason).toMatch(/retirement contributions/);
    expect(none({ figures: new Map([['retirement_contributions', fig(0)]]) }).reason).toMatch(
      /taxable income/,
    );
    expect(none({ filingStatus: null }).reason).toMatch(/filing status/);
    expect(none({ planYear: 2040 }).reason).toMatch(/2040/);
    expect(estimateStrategy(input(['something_else'])).reason).toMatch(/No estimate model/);
    expect(none({ filingStatus: null }).cents).toBeNull();
  });

  it('reports room and effective rates', () => {
    expect(roomUnderLimit(2026, 'retirement', 1_000_000)).toBe(1_450_000);
    expect(roomUnderLimit(2026, 'hsa', 9_999_999)).toBe(0);
    expect(roomUnderLimit(2040, 'hsa', 0)).toBeNull();
    expect(effectiveRateBp(2026, 'SINGLE', 0)).toBeNull();
    const high = effectiveRateBp(2026, 'SINGLE', 20_000_000) ?? 0;
    const low = effectiveRateBp(2026, 'SINGLE', 5_000_000) ?? 0;
    expect(high).toBeGreaterThan(low);
  });
});

describe('plan totals, figures and estimates', () => {
  const s = (name: string, category: string, cents: number | null, over: object = {}) => ({
    selected: true,
    status: 'PROPOSED',
    category: category as never,
    displayName: name,
    estimatedSavingsCents: cents,
    overrideSavingsCents: null,
    ...over,
  });

  it('counts savings that overlap once', () => {
    const none = planTotals([]);
    expect(none).toEqual({ cents: null, notes: [] });
    expect(planTotals([s('a', 'CREDITS', null)]).cents).toBeNull();
    const one = planTotals([s('401k', 'RETIREMENT', 300), s('Credit', 'CREDITS', 50)]);
    expect(one).toEqual({ cents: 350, notes: [] });
    const two = planTotals([
      s('401k', 'RETIREMENT', 300),
      s('IRA', 'RETIREMENT', 500),
      s('Credit', 'CREDITS', 50),
    ]);
    expect(two.cents).toBe(550);
    expect(two.notes).toEqual([expect.stringContaining('IRA')]);
  });

  it('leaves out what is dropped, declined or has no figure', () => {
    expect(
      planTotals([
        s('a', 'CREDITS', 100, { selected: false }),
        s('b', 'CREDITS', 100, { status: 'DECLINED' }),
        s('c', 'CREDITS', 100),
      ]).cents,
    ).toBe(100);
    // An override stands in for the model’s figure.
    expect(planTotals([s('a', 'CREDITS', 100, { overrideSavingsCents: 700 })]).cents).toBe(700);
    expect(effectiveCents({ estimatedSavingsCents: 1, overrideSavingsCents: 0 })).toBe(0);
  });

  it('chooses the figure the model reads: an adjustment, a projection, then the latest history', () => {
    const rows = [
      { key: 'agi', kind: 'HISTORICAL' as const, taxYear: 2024, amountCents: 1 },
      { key: 'agi', kind: 'HISTORICAL' as const, taxYear: 2025, amountCents: 2 },
      { key: 'wages', kind: 'HISTORICAL' as const, taxYear: 2025, amountCents: 5 },
      { key: 'wages', kind: 'PROJECTED' as const, taxYear: 2026, amountCents: 6 },
      { key: 'wages', kind: 'ADJUSTMENT' as const, taxYear: 2026, amountCents: 7 },
      { key: 'state', kind: 'PROJECTED' as const, taxYear: 2026, amountCents: null },
      { key: 'old', kind: 'PROJECTED' as const, taxYear: 2020, amountCents: 9 },
    ];
    const f = figuresOf(rows, 2026);
    expect(f.get('agi')).toMatchObject({ amountCents: 2, taxYear: 2025 });
    expect(f.get('wages')).toMatchObject({ amountCents: 7, kind: 'ADJUSTMENT' });
    expect(f.has('state')).toBe(false);
    expect(f.has('old')).toBe(false);
  });

  it('shows an estimate as unavailable with its reason, and says where an override came from', () => {
    const base = {
      estimatedSavingsCents: null,
      estimateDataYear: null,
      estimateCalculatedAt: null,
      overrideSavingsCents: null,
    };
    expect(estimateView(base, 'Add the figure')).toMatchObject({
      cents: null,
      basis: null,
      unavailableReason: 'Add the figure',
    });
    expect(estimateView(base, null).unavailableReason).toBe('Not calculated yet');
    const over = estimateView(
      {
        estimatedSavingsCents: 100,
        estimateDataYear: 2026,
        estimateCalculatedAt: new Date('2026-01-01T00:00:00Z'),
        overrideSavingsCents: 250,
      },
      null,
    );
    expect(over).toMatchObject({
      cents: 250,
      modelCents: 100,
      overridden: true,
      dataYear: 2026,
      unavailableReason: null,
      basis: 'Entered by an authorized person',
    });
  });

  it('tells stale figures and the firm’s day', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(isStale(null, now)).toBe(false);
    expect(isStale(new Date('2026-01-01T00:00:00Z'), now)).toBe(false);
    expect(isStale(new Date('2024-01-01T00:00:00Z'), now)).toBe(true);
    // 02:30 UTC is still the day before in New York.
    expect(todayIn('America/New_York', new Date('2026-06-02T02:30:00Z'))).toBe('2026-06-01');
    expect(todayIn('UTC', new Date('2026-06-02T02:30:00Z'))).toBe('2026-06-02');
  });
});

describe('who may do what', () => {
  it('gives Owner and Admin everything, Staff the day-to-day, and the grid roles their row', () => {
    for (const role of ['OWNER', 'ADMIN']) {
      expect(permsOf(staff(role))).toMatchObject({
        admin: true,
        create: true,
        edit: true,
        review: true,
        manageStrategies: true,
        override: true,
        send: true,
        viewInputs: true,
        planningAdmin: true,
      });
    }
    expect(permsOf(staff('STAFF'))).toMatchObject({
      admin: false,
      create: true,
      edit: true,
      review: true,
      send: true,
      viewInputs: true,
      manageStrategies: false,
      override: false,
      planningAdmin: false,
    });
    // A Tax Preparer has View on Tax Planning only: nothing else.
    expect(permsOf(staff('TAX_PREPARER'))).toEqual({
      admin: false,
      create: false,
      edit: false,
      review: false,
      manageStrategies: false,
      override: false,
      send: false,
      viewInputs: false,
      planningAdmin: false,
    });
    expect(permsOf(undefined).create).toBe(false);
    expect(permsOf({ kind: 'client' } as never).edit).toBe(false);
  });
});

describe('the catalogs and the rules', () => {
  it('has unique input keys and resources, and sends only client-facing resources', () => {
    const keys = INPUT_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^[a-z][a-z0-9_]{1,59}$/.test(k))).toBe(true);
    const resources = RESOURCES.map((r) => r.key);
    expect(new Set(resources).size).toBe(resources.length);
    expect(resourceOf('nope')).toBeUndefined();
    expect(Object.keys(toResource(RESOURCES[0] as never))).not.toContain('summary');
    expect(RESOURCES.some((r) => !r.clientFacing)).toBe(true);
  });

  it('screens by rules that read figures the plan takes', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const rule of RULES) {
      expect(INPUT_CATALOG.map((i) => i.key)).toContain(rule.inputKey);
      expect(rule.actions.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });
});

describe('the request schemas beyond the contract', () => {
  const plan = { clientId: crypto.randomUUID(), planYear: 2026, name: 'Plan' };
  it('refuses what the columns cannot hold', () => {
    expect(CreatePlanBody.safeParse(plan).success).toBe(true);
    expect(CreatePlanBody.safeParse({ ...plan, name: 'a\u0000b' }).success).toBe(false);
    expect(CreatePlanBody.safeParse({ ...plan, name: '\ud800' }).success).toBe(false);
    expect(CreatePlanBody.safeParse({ ...plan, otherGoal: 'x' }).success).toBe(false);
    expect(
      CreatePlanBody.safeParse({ ...plan, goals: ['OTHER'], otherGoal: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      CreatePlanBody.safeParse({ ...plan, goals: ['OTHER'], otherGoal: 'Own goal' }).success,
    ).toBe(true);
    expect(CreatePlanBody.safeParse({ ...plan, targetCompletionOn: '0000-01-01' }).success).toBe(
      false,
    );
    expect(UpdatePlanBody.safeParse({ etag: 'e', clientNotes: 'x'.repeat(2_001) }).success).toBe(
      false,
    );
    expect(UpdatePlanBody.safeParse({ etag: 'e', clientNotes: 'x'.repeat(2_000) }).success).toBe(
      true,
    );
    const calc = { taxYear: 2026, baseline: {}, strategy: {} };
    expect(CalculateBody.safeParse(calc).success).toBe(true);
    expect(SaveScenarioBody.safeParse({ name: 'x'.repeat(121), calculation: calc }).success).toBe(
      false,
    );
  });
});
