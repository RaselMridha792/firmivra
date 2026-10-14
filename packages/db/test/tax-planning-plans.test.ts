// Tax Planning, part 1 (R38): the strategy library, planning plans and their strategies.
// Isolation between firms and the rules of migration r38_tax_planning_plans. Runs as the app
// role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const strategy = (data: Record<string, unknown> = {}) =>
  A().taxPlanningStrategy.create({
    data: {
      businessId: f.firmA,
      name: `Strategy ${randomUUID()}`,
      category: 'RETIREMENT',
      ...data,
    },
  });
const plan = (data: Record<string, unknown> = {}) =>
  A().taxPlan.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      name: 'Plan (fake)',
      planYear: 2027,
      ...data,
    },
  });
const planStrategy = (planId: string, data: Record<string, unknown> = {}) =>
  A().taxPlanStrategy.create({
    data: { businessId: f.firmA, planId, displayName: 'Strategy (fake)', ...data },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38tp');
});

describe('isolation', () => {
  it('another firm sees no strategy, plan or plan strategy', async () => {
    const s = await strategy();
    const p = await plan();
    await planStrategy(p.id, { strategyId: s.id });
    const B = db.forBusiness(f.firmB);
    expect(await B.taxPlanningStrategy.findMany()).toEqual([]);
    expect(await B.taxPlan.findMany()).toEqual([]);
    expect(await B.taxPlanStrategy.findMany()).toEqual([]);
    expect(
      await failure(
        B.taxPlan.create({
          data: { businessId: f.firmA, clientId: f.clientA, name: 'x', planYear: 2027 },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("a plan cannot use another firm's client, assignee, engagement or strategy", async () => {
    expect(await failure(plan({ clientId: f.clientB }))).toMatch(/foreign key/i);
    expect(await failure(plan({ assignedUserId: f.memberB }))).toMatch(/foreign key/i);
    const engB = await createEngagement(owner, f.firmB, f.clientB, 'TAX_PLANNING');
    expect(await failure(plan({ engagementId: engB }))).toMatch(
      /foreign key|Tax Planning engagement/i,
    );
    const sB = await db.forBusiness(f.firmB).taxPlanningStrategy.create({
      data: { businessId: f.firmB, name: 'B strategy', category: 'CREDITS' },
    });
    const p = await plan();
    expect(await failure(planStrategy(p.id, { strategyId: sB.id }))).toMatch(
      /foreign key|active strategy/i,
    );
  });
});

describe('strategy library', () => {
  it('has a unique name per firm, a checked shape, and archived means inactive', async () => {
    await strategy({ name: 'Section 179' });
    expect(await failure(strategy({ name: 'Section 179' }))).toMatch(/unique/i);
    for (const data of [
      { name: ' ' },
      { eligibility: [] },
      { implementationChecklist: {} },
      { implementationChecklist: new Array(31).fill({ label: 'x' }) },
      { requiredInputs: new Array(31).fill('agi') },
      { archivedAt: new Date() },
    ]) {
      expect(await failure(strategy(data))).toMatch(/check constraint/i);
    }
    await expect(strategy({ active: false, archivedAt: new Date() })).resolves.toBeTruthy();
  });
});

describe('plans', () => {
  it('check the name, year, goals and the custom goal', async () => {
    await expect(
      plan({ goals: ['REDUCE_TAXABLE_INCOME', 'OTHER'], otherGoal: 'Pay for a wedding' }),
    ).resolves.toBeTruthy();
    for (const data of [
      { name: ' ' },
      { planYear: 1999 },
      { goals: ['OTHER', 'OTHER'] },
      { otherGoal: 'Pay for a wedding' }, // needs the OTHER goal
      { goals: ['OTHER'], otherGoal: ' ' },
      { notes: 'x'.repeat(5001) },
    ]) {
      expect(await failure(plan(data))).toMatch(/check constraint/i);
    }
    await expect(plan()).resolves.toMatchObject({
      status: 'DRAFT',
      planType: 'COMPREHENSIVE',
      goals: [],
    });
  });

  it('may repeat for a client and year (duplicates are the API warning), and keep their client', async () => {
    const p = await plan();
    await expect(plan()).resolves.toBeTruthy();
    const other = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    );
    expect(
      await failure(A().taxPlan.update({ where: { id: p.id }, data: { clientId: other.id } })),
    ).toMatch(/cannot change client/);
  });

  it('sit in a Tax Planning engagement of the same client, or none', async () => {
    const tax = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
    expect(await failure(plan({ engagementId: tax }))).toMatch(/Tax Planning engagement/);
    const planning = await createEngagement(owner, f.firmA, f.clientA, 'TAX_PLANNING');
    await expect(plan({ engagementId: planning })).resolves.toBeTruthy();
    const otherClient = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    );
    const foreign = await createEngagement(owner, f.firmA, otherClient.id, 'TAX_PLANNING');
    expect(await failure(plan({ engagementId: foreign }))).toMatch(/foreign key/i);
  });
});

describe('plan strategies', () => {
  it('are a library strategy once per plan, or a custom one with a name and category', async () => {
    const p = await plan();
    const s = await strategy();
    await planStrategy(p.id, { strategyId: s.id });
    expect(await failure(planStrategy(p.id, { strategyId: s.id }))).toMatch(/unique/i);
    for (const data of [
      { customName: 'Prepay tax' }, // needs a category
      { customCategory: 'TIMING' },
      { strategyId: s.id, customName: 'x', customCategory: 'TIMING' },
      { displayName: ' ' },
    ]) {
      expect(await failure(planStrategy(p.id, data))).toMatch(/check constraint|unique/i);
    }
    const custom = { customName: 'Prepay tax', customCategory: 'TIMING' };
    await planStrategy(p.id, custom);
    expect(await failure(planStrategy(p.id, { ...custom, customName: 'PREPAY TAX' }))).toMatch(
      /unique/i,
    );
    expect(await failure(planStrategy(p.id))).toMatch(/check constraint/i); // neither
  });

  it('only an active library strategy can be added, and a plan strategy keeps its plan', async () => {
    const p = await plan();
    const p2 = await plan();
    const inactive = await strategy({ active: false });
    expect(await failure(planStrategy(p.id, { strategyId: inactive.id }))).toMatch(
      /active strategy/,
    );
    const ps = await planStrategy(p.id, { customName: 'Custom', customCategory: 'ENTITY' });
    expect(
      await failure(A().taxPlanStrategy.update({ where: { id: ps.id }, data: { planId: p2.id } })),
    ).toMatch(/keeps its plan/);
    // Taking a strategy out of a plan is allowed; the library strategy stays.
    const s = await strategy();
    const withLib = await planStrategy(p.id, { strategyId: s.id });
    await A().taxPlanStrategy.delete({ where: { id: withLib.id } });
    expect(await A().taxPlanningStrategy.findUnique({ where: { id: s.id } })).not.toBeNull();
  });

  it('keep an estimate with its data year, never a negative one, and an override with its reason', async () => {
    const p = await plan();
    let n = 0;
    const make = (data: Record<string, unknown>) =>
      planStrategy(p.id, { customName: `C${++n}`, customCategory: 'DEDUCTIONS', ...data });
    for (const data of [
      { estimatedSavingsCents: -1 },
      { estimateDataYear: 2025 }, // needs an estimate
      { estimatedSavingsCents: 100, estimateDataYear: 1999 },
      { overrideSavingsCents: 100 },
      { overrideSavingsCents: 100, overrideByUserId: f.memberA },
      { overrideSavingsCents: 100, overrideByUserId: f.memberA, overrideReason: ' ' },
      { overrideReason: 'Why' },
      { status: 'IMPLEMENTED' }, // needs its date
      { implementedOn: new Date('2026-12-01') },
      { position: -1 },
    ]) {
      expect(await failure(make(data))).toMatch(/check constraint/i);
    }
    await expect(
      make({
        estimatedSavingsCents: 650000,
        estimateDataYear: 2025,
        overrideSavingsCents: 500000,
        overrideReason: 'Lower eligible income',
        overrideByUserId: f.memberA,
      }),
    ).resolves.toBeTruthy();
    await expect(
      make({ status: 'IMPLEMENTED', implementedOn: new Date('2026-12-01') }),
    ).resolves.toBeTruthy();
    // An unavailable estimate stays null: nothing is invented.
    await expect(make({})).resolves.toMatchObject({ estimatedSavingsCents: null });
  });
});
