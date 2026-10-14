// Tax Planning, part 3 (R38): opportunities and their history. Isolation between firms and the
// rules of migration r38_tax_planning_opportunities. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let planA: string;
let planStrategyA: string;
let otherClientA: string;
let year = 2040;
const A = () => db.forBusiness(f.firmA);
const now = () => new Date();
const strategy = () =>
  A().taxPlanningStrategy.create({
    data: { businessId: f.firmA, name: `S ${Math.random()}`, category: 'RETIREMENT' },
  });
const opportunity = (data: Record<string, unknown> = {}) =>
  A().taxOpportunity.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      name: 'Maximize retirement contributions',
      category: 'RETIREMENT',
      taxYear: ++year,
      source: 'SYSTEM',
      ...data,
    },
  });
const set = (id: string, data: Record<string, unknown>) =>
  A().taxOpportunity.update({ where: { id }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38to');
  planA = (
    await A().taxPlan.create({
      data: { businessId: f.firmA, clientId: f.clientA, name: 'Plan (fake)', planYear: 2027 },
    })
  ).id;
  planStrategyA = (
    await A().taxPlanStrategy.create({
      data: {
        businessId: f.firmA,
        planId: planA,
        displayName: 'C',
        customName: 'C',
        customCategory: 'TIMING',
      },
    })
  ).id;
  otherClientA = (
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    )
  ).id;
});

describe('isolation', () => {
  it('another firm sees no opportunity or event', async () => {
    const o = await opportunity();
    await A().taxOpportunityEvent.create({
      data: { businessId: f.firmA, opportunityId: o.id, kind: 'SCREENED' },
    });
    const B = db.forBusiness(f.firmB);
    expect(await B.taxOpportunity.findMany()).toEqual([]);
    expect(await B.taxOpportunityEvent.findMany()).toEqual([]);
    expect(
      await failure(
        B.taxOpportunity.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            name: 'x',
            category: 'CREDITS',
            taxYear: 2027,
            source: 'STAFF',
          },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("refuses another firm's client, assignee, strategy and plan", async () => {
    expect(await failure(opportunity({ clientId: f.clientB }))).toMatch(/foreign key/i);
    expect(await failure(opportunity({ assignedUserId: f.memberB }))).toMatch(/foreign key/i);
    const sB = await db.forBusiness(f.firmB).taxPlanningStrategy.create({
      data: { businessId: f.firmB, name: 'B', category: 'CREDITS' },
    });
    expect(await failure(opportunity({ strategyId: sB.id }))).toMatch(/foreign key/i);
    const planB = await db.forBusiness(f.firmB).taxPlan.create({
      data: { businessId: f.firmB, clientId: f.clientB, name: 'B', planYear: 2027 },
    });
    expect(await failure(opportunity({ planId: planB.id }))).toMatch(/foreign key|plan must be/i);
  });
});

describe('opportunities', () => {
  it('start NEW with no review, and keep estimates and rates sane', async () => {
    await expect(opportunity()).resolves.toMatchObject({
      status: 'NEW',
      dataComplete: true,
      reviewedAt: null,
      estimatedSavingsCents: null,
    });
    for (const data of [
      { name: ' ' },
      { taxYear: 1999 },
      { estimatedSavingsCents: -1 },
      { effectiveRateBeforeBp: 10001 },
      { clientDataUsed: {} },
      { recommendedActions: new Array(21).fill('x') },
      { documentsNeeded: {} },
    ]) {
      expect(await failure(opportunity(data))).toMatch(/check constraint/i);
    }
    await expect(
      opportunity({
        estimatedSavingsCents: 650000,
        suggestedActionCents: 2300000,
        newTaxableIncomeCents: 11930000,
        effectiveRateBeforeBp: 1800,
        effectiveRateAfterBp: 1600,
        clientDataUsed: [{ label: 'AGI', amountCents: 14230000 }],
      }),
    ).resolves.toBeTruthy();
  });

  it('flag thin data and say what is missing', async () => {
    expect(await failure(opportunity({ dataComplete: false }))).toMatch(/check constraint/i);
    expect(await failure(opportunity({ missingData: ['health plan type'] }))).toMatch(
      /check constraint/i,
    );
    await expect(
      opportunity({ dataComplete: false, missingData: ['health plan type'] }),
    ).resolves.toBeTruthy();
  });

  it('are not a recommendation until reviewed: adding to a plan needs a review and a plan', async () => {
    const o = await opportunity();
    expect(await failure(set(o.id, { status: 'ADDED_TO_PLAN', planId: planA }))).toMatch(
      /check constraint/i,
    );
    expect(
      await failure(
        set(o.id, { status: 'ADDED_TO_PLAN', reviewedAt: now(), reviewedByUserId: f.memberA }),
      ),
    ).toMatch(/check constraint/i);
    await expect(
      set(o.id, {
        status: 'ADDED_TO_PLAN',
        planId: planA,
        planStrategyId: planStrategyA,
        reviewedAt: now(),
        reviewedByUserId: f.memberA,
      }),
    ).resolves.toMatchObject({ status: 'ADDED_TO_PLAN' });
  });

  it('need a reason to be not applicable or dismissed, which a reopen clears', async () => {
    const o = await opportunity();
    for (const status of ['NOT_APPLICABLE', 'DISMISSED'] as const) {
      expect(await failure(set(o.id, { status }))).toMatch(/check constraint/i);
      expect(await failure(set(o.id, { status, dispositionReason: ' ' }))).toMatch(
        /check constraint/i,
      );
    }
    expect(await failure(set(o.id, { dispositionReason: 'Not eligible' }))).toMatch(
      /check constraint/i,
    );
    await set(o.id, {
      status: 'DISMISSED',
      dispositionReason: 'Client declined',
      suppressedUntil: new Date('2027-06-01'),
    });
    expect(await failure(set(o.id, { suppressedUntil: null, status: 'UNDER_REVIEW' }))).toMatch(
      /check constraint/i,
    );
    await expect(
      set(o.id, { status: 'UNDER_REVIEW', dispositionReason: null, suppressedUntil: null }),
    ).resolves.toMatchObject({ status: 'UNDER_REVIEW' });
    expect(await failure(opportunity({ suppressedUntil: new Date('2027-06-01') }))).toMatch(
      /check constraint/i,
    );
  });

  it('one open opportunity per client, library strategy and year; a dismissed one frees it', async () => {
    const s = await strategy();
    const make = (data: Record<string, unknown> = {}) =>
      A().taxOpportunity.create({
        data: {
          businessId: f.firmA,
          clientId: f.clientA,
          strategyId: s.id,
          name: 'S',
          category: 'RETIREMENT',
          taxYear: 2030,
          source: 'SYSTEM',
          ...data,
        },
      });
    const first = await make();
    expect(await failure(make())).toMatch(/unique/i);
    await expect(make({ taxYear: 2031 })).resolves.toBeTruthy();
    await expect(make({ clientId: otherClientA })).resolves.toBeTruthy();
    await set(first.id, { status: 'DISMISSED', dispositionReason: 'Client declined' });
    await expect(make()).resolves.toBeTruthy();
    // Custom (no library strategy) opportunities are not limited.
    await expect(opportunity({ taxYear: 2030 })).resolves.toBeTruthy();
    await expect(opportunity({ taxYear: 2030 })).resolves.toBeTruthy();
  });

  it("keep their client, strategy, year and source, and the plan is the client's", async () => {
    const o = await opportunity();
    for (const data of [{ clientId: otherClientA }, { taxYear: 2099 }, { source: 'MANUAL' }]) {
      expect(await failure(set(o.id, data))).toMatch(/keeps its client/);
    }
    const otherPlan = await A().taxPlan.create({
      data: { businessId: f.firmA, clientId: otherClientA, name: 'Other', planYear: 2027 },
    });
    expect(await failure(set(o.id, { planId: otherPlan.id }))).toMatch(/plan must be the client's/);
    const otherPlanStrategy = await A().taxPlanStrategy.create({
      data: {
        businessId: f.firmA,
        planId: otherPlan.id,
        displayName: 'X',
        customName: 'X',
        customCategory: 'ENTITY',
      },
    });
    expect(
      await failure(set(o.id, { planId: planA, planStrategyId: otherPlanStrategy.id })),
    ).toMatch(/one of the plan's/);
  });

  it('are implemented with their date, then only closed; closed is final', async () => {
    const o = await opportunity({ reviewedAt: now(), reviewedByUserId: f.memberA });
    expect(await failure(set(o.id, { status: 'IMPLEMENTED' }))).toMatch(/check constraint/i);
    await set(o.id, { status: 'IMPLEMENTED', implementedOn: new Date('2026-12-01') });
    expect(await failure(set(o.id, { status: 'UNDER_REVIEW', implementedOn: null }))).toMatch(
      /can only be closed/,
    );
    await set(o.id, { status: 'CLOSED' });
    expect(await failure(set(o.id, { status: 'NEW' }))).toMatch(/cannot be reopened/);
  });
});

describe('history', () => {
  it('is insert-only, and a status event names the new status', async () => {
    const o = await opportunity();
    const add = (data: Record<string, unknown>) =>
      A().taxOpportunityEvent.create({
        data: { businessId: f.firmA, opportunityId: o.id, kind: 'NOTE', ...data },
      });
    const e = await add({ reason: 'Called the client' });
    expect(
      await failure(A().taxOpportunityEvent.update({ where: { id: e.id }, data: { reason: 'x' } })),
    ).toMatch(/permission denied/i);
    expect(await failure(A().taxOpportunityEvent.delete({ where: { id: e.id } }))).toMatch(
      /permission denied/i,
    );
    for (const data of [
      { kind: 'STATUS' },
      { toStatus: 'DISMISSED' },
      { reason: 'x'.repeat(501) },
      { details: [] },
    ]) {
      expect(await failure(add(data))).toMatch(/check constraint/i);
    }
    await expect(
      add({ kind: 'STATUS', fromStatus: 'NEW', toStatus: 'UNDER_REVIEW', actorUserId: f.memberA }),
    ).resolves.toBeTruthy();
  });
});
